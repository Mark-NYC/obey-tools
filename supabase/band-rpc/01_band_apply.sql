-- /band write path: one atomic server-side function per edit.
--
-- Why: band_data UPDATE is restricted to signed-in users, so taps from
-- anonymous visitors matched 0 rows and were silently dropped. The page also
-- rewrote the whole JSON blob on every tap behind a compare-and-swap loop.
--
-- band_apply() locks the single band_data row, applies ONE small change by
-- city/leader NAME, and returns the stored result. Anyone with the page link
-- can call it (approved 2026-10-25), but only these narrow operations are
-- possible — direct table writes stay restricted to signed-in users.
--
-- Ops (p_args):
--   set_post        {city, leader, key, value:boolean}
--   adjust_counter  {city, field:'baptismsYTD'|'churchesYTD', delta:int}
--   step_stream     {city, delta:int}
--   add_leader      {city, name}
--   remove_leader   {city, name}
--   add_city        {name, totalChurches:int, streamDepth}
--   delete_city     {city}
-- Returns {cities, last_modified}.

create or replace function public.band_apply(p_op text, p_args jsonb, p_device text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cities   jsonb;
  v_city     jsonb;
  v_leaders  jsonb;
  v_ph       jsonb;
  ci         int;
  li         int;
  v_name     text;
  v_key      text;
  v_field    text;
  v_delta    int;
  v_n        int;
  v_levels   text[] := array['1st Gen','2nd Gen','3rd Gen','4th Gen'];
  v_ts       timestamptz := clock_timestamp();
begin
  select cities into v_cities from band_data where id = 'main' for update;
  if not found then raise exception 'band_data row missing'; end if;
  if jsonb_typeof(v_cities) is distinct from 'array' then v_cities := '[]'::jsonb; end if;

  if p_op <> 'add_city' then
    select (o - 1)::int into ci
      from jsonb_array_elements(v_cities) with ordinality as e(c, o)
     where c->>'name' = p_args->>'city'
     limit 1;
    if ci is null then raise exception 'Unknown city: %', p_args->>'city'; end if;
    v_city := v_cities->ci;
    v_leaders := case when jsonb_typeof(v_city->'leaders') = 'array' then v_city->'leaders' else '[]'::jsonb end;
  end if;

  if p_op in ('set_post', 'remove_leader') then
    v_name := case when p_op = 'set_post' then p_args->>'leader' else p_args->>'name' end;
    select (o - 1)::int into li
      from jsonb_array_elements(v_leaders) with ordinality as e(l, o)
     where l->>'name' = v_name
     limit 1;
    if li is null then raise exception 'Unknown leader: %', v_name; end if;
  end if;

  if p_op in ('add_leader', 'add_city') then
    v_name := btrim(coalesce(p_args->>'name', ''));
    if v_name = '' or length(v_name) > 80 or v_name ~ '[[:cntrl:]<>]' then
      raise exception 'Invalid name';
    end if;
  end if;

  case p_op
  when 'set_post' then
    v_key := p_args->>'key';
    if v_key !~ '^\d{4}-\d{1,2}-[24]$' then raise exception 'Invalid meeting key: %', v_key; end if;
    v_ph := v_leaders->li->'postHistory';
    if jsonb_typeof(v_ph) is distinct from 'object' then v_ph := '{}'::jsonb; end if;
    if (p_args->>'value')::boolean then
      v_ph := v_ph || jsonb_build_object(v_key, true);
    else
      v_ph := v_ph - v_key;
    end if;
    v_leaders := jsonb_set(v_leaders, array[li::text, 'postHistory'], v_ph);
    v_city := jsonb_set(v_city, '{leaders}', v_leaders);

  when 'adjust_counter' then
    v_field := p_args->>'field';
    if v_field not in ('baptismsYTD', 'churchesYTD') then raise exception 'Invalid field: %', v_field; end if;
    v_delta := (p_args->>'delta')::int;
    if abs(v_delta) > 1000 then raise exception 'Invalid delta'; end if;
    v_n := greatest(0, coalesce((v_city->>v_field)::int, 0) + v_delta);
    v_city := jsonb_set(v_city, array[v_field], to_jsonb(v_n));
    if v_field = 'churchesYTD' then
      v_city := jsonb_set(v_city, '{totalChurches}', to_jsonb(v_n));
    end if;

  when 'step_stream' then
    v_delta := (p_args->>'delta')::int;
    v_n := coalesce(array_position(v_levels, v_city->>'streamDepth'), 1) + sign(v_delta)::int;
    v_n := least(array_length(v_levels, 1), greatest(1, v_n));
    v_city := jsonb_set(v_city, '{streamDepth}', to_jsonb(v_levels[v_n]));
    v_city := jsonb_set(v_city, '{totalStreamDepth}', to_jsonb(v_levels[v_n]));

  when 'add_leader' then
    if exists (select 1 from jsonb_array_elements(v_leaders) l where l.value->>'name' = v_name) then
      raise exception 'Leader already exists: %', v_name;
    end if;
    v_leaders := v_leaders || jsonb_build_array(jsonb_build_object('name', v_name, 'postHistory', '{}'::jsonb));
    v_city := jsonb_set(v_city, '{leaders}', v_leaders);

  when 'remove_leader' then
    v_city := jsonb_set(v_city, '{leaders}', v_leaders - li);

  when 'add_city' then
    if exists (select 1 from jsonb_array_elements(v_cities) c where c.value->>'name' = v_name) then
      raise exception 'City already exists: %', v_name;
    end if;
    v_n := greatest(0, coalesce((p_args->>'totalChurches')::int, 0));
    v_key := coalesce(p_args->>'streamDepth', '1st Gen');
    if not (v_key = any(v_levels)) then v_key := '1st Gen'; end if;
    v_cities := v_cities || jsonb_build_array(jsonb_build_object(
      'name', v_name, 'leaders', '[]'::jsonb, 'baptismsYTD', 0,
      'churchesYTD', v_n, 'totalChurches', v_n,
      'streamDepth', v_key, 'totalStreamDepth', v_key, 'momentumHistory', '[]'::jsonb));

  when 'delete_city' then
    v_cities := v_cities - ci;

  else
    raise exception 'Unknown op: %', p_op;
  end case;

  if p_op not in ('add_city', 'delete_city') then
    v_cities := jsonb_set(v_cities, array[ci::text], v_city);
  end if;

  update band_data
     set cities = v_cities, last_modified = v_ts, modified_by = left(p_device, 64)
   where id = 'main';

  return jsonb_build_object('cities', v_cities, 'last_modified', v_ts);
end;
$$;

revoke all on function public.band_apply(text, jsonb, text) from public;
grant execute on function public.band_apply(text, jsonb, text) to anon, authenticated;
