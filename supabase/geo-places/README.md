# Worldwide places — runbook

Makes every mapped row country-aware so `/view-progress` never merges
same-named cities (Paris, TX vs Paris, FR) and names show in English.

| Column | Example |
|---|---|
| `country_code` | `US` |
| `region` | `Texas` |
| `place_key` | `US\|Texas\|Paris` — what the map groups by |
| `place_label` | `Paris, TX, US` — what the map shows |

New conversations get these from `/geo.js` (called by `conversation-box.html`).
Old rows get them from the backfill script.

## Location privacy

Exact GPS points are never stored or shared:

| Where | Stored precision | Place text |
|---|---|---|
| Most countries | 2 decimals (~1 km) | neighbourhood + city |
| Restricted countries (Open Doors WWL top 50 + others) | 1 decimal (~11 km) | city only |
| Country unknown | 1 decimal (fail safe) | as geocoded |

`/geo.js` rounds in the browser (and before sending to the WordPress API);
`02_privacy.sql` enforces the same thing with a trigger, so cached old app
versions can't bypass it. Only ~100 m precision is ever sent to the geocoder.
On the map, restricted countries also hide leader names and live-feed cities.
Keep the country list identical in `geo.js` and `02_privacy.sql`; review yearly.

## Order matters

1. **Columns.** Supabase → SQL editor → paste [`01_schema.sql`](./01_schema.sql) → Run.
2. **Privacy trigger.** Paste [`02_privacy.sql`](./02_privacy.sql) → Run.
   New writes are rounded from here on.
3. **Backfill old rows.** Locally, with the service role key (Settings → API):

   ```sh
   export SUPABASE_URL=https://mjiswwujcsmayuytoaul.supabase.co
   export SUPABASE_SERVICE_ROLE_KEY=...   # never commit this
   export GEOCODE_CONTACT=you@example.com
   node scripts/backfill-places.mjs          # dry run
   node scripts/backfill-places.mjs --apply  # write
   ```

   **No terminal?** Paste [`04_backfill_in_database.sql`](./04_backfill_in_database.sql)
   into the SQL editor instead, then run `select * from public.geo_backfill_batch(40);`
   repeatedly until `remaining_pairs` is 0. Same result, done by Supabase itself.

   1 lookup/second (Nominatim policy), cached by ~100 m. Re-runnable: only
   touches rows where `place_key` is null. It also rewrites `city` and
   `location_text` to the English names so old and new rows match. Each row
   it updates gets rounded by the trigger.
4. **Round the rest.** Paste [`03_coarsen_existing.sql`](./03_coarsen_existing.sql)
   → Run. Catches rows the backfill couldn't place.
5. **Ship the front end** (merge the branch).

> **Steps 3 and 4 are one-way.** Precise coordinates are destroyed, on purpose.
> Don't keep a backup of the precise values — a backup is the leak.

The pages tolerate any order: if the columns don't exist yet, the map reads
without them and the conversation box retries the insert without them. But
until step 3 runs, old rows group under bare city names and new rows under
`place_key`, so a city can show twice.

## Signed-in reads only

Run [`05_signed_in_reads_only.sql`](./05_signed_in_reads_only.sql): the read
policy on `conversation_events` applied to `anon` too, so the public anon key
could read every event without an account.

## Verify

```sql
select place_label, count(*) from conversation_events
group by place_label order by 2 desc limit 20;

select count(*) filter (where place_key is null and latitude is not null) as pending
from conversation_events;
```

## Rollback

Rounded coordinates can't be un-rounded. This only removes the objects:

```sql
drop trigger if exists conversation_events_geo_coarsen on public.conversation_events;
drop trigger if exists church_assessments_geo_coarsen on public.church_assessments;
drop function if exists public.geo_coarsen();
drop function if exists public.geo_is_restricted(text);
alter table public.conversation_events
  drop column if exists country_code, drop column if exists region,
  drop column if exists place_key,    drop column if exists place_label;
alter table public.church_assessments
  drop column if exists country_code, drop column if exists region,
  drop column if exists place_key,    drop column if exists place_label;
```
