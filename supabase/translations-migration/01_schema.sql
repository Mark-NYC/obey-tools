-- ============================================================================
-- STEP 1 — Translation admin schema (Phase 0). NO runtime impact.
--
-- Creates the five translation tables + the orthogonal admin flag. Enables RLS
-- with DENY-by-default; access is granted in 02_authz.sql. Fully reversible via
-- 99_rollback.sql. English stays canonical in /lang/en.json — these tables are
-- a mirror the app does not yet read (the live site keeps using static JSON
-- until Phase 3/4).
--
-- Roles are kept ORTHOGONAL to the existing profiles.role ('user'|'leader'):
-- translation access never reuses the 'leader' role.
-- ============================================================================

begin;

-- Orthogonal admin flag. Does not touch 'user'/'leader' semantics.
alter table public.profiles
  add column if not exists is_translation_admin boolean not null default false;

-- ── languages ───────────────────────────────────────────────────────────────
create table if not exists public.languages (
  code          text primary key
                  check (code ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  english_name  text not null,
  native_name   text not null,
  direction     text not null default 'ltr' check (direction in ('ltr','rtl')),
  is_active     boolean not null default false,   -- appears in public selector
  is_source     boolean not null default false,   -- exactly one row: 'en'
  sort_order    int  not null default 100,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists languages_one_source
  on public.languages (is_source) where is_source;

-- ── translation_keys — English skeleton, one row per LEAF ───────────────────
create table if not exists public.translation_keys (
  id              bigint generated always as identity primary key,
  key_path        text not null unique,          -- dotted incl. numeric indices
  namespace       text not null,
  area            text not null,
  value_type      text not null default 'string' check (value_type in ('string','html')),
  is_translatable boolean not null default true, -- reserved; every leaf is content in v1
  array_group     text,                          -- outermost ancestor array => atomic unit
  source_value    text not null,
  source_hash     text not null,                 -- sha256(source_value)
  html_signature  text,                          -- for value_type='html': markup fingerprint
  context         text,
  is_active       boolean not null default true,
  updated_at      timestamptz not null default now()
);
create index if not exists translation_keys_ns    on public.translation_keys (namespace);
create index if not exists translation_keys_area  on public.translation_keys (area);
create index if not exists translation_keys_array on public.translation_keys (array_group)
  where array_group is not null;

-- ── translation_values — one row per key × language ─────────────────────────
create table if not exists public.translation_values (
  id             bigint generated always as identity primary key,
  key_id         bigint not null references public.translation_keys(id) on delete cascade,
  language_code  text   not null references public.languages(code)      on delete cascade,
  value          text,                            -- NULL => missing => English fallback
  workflow_status text not null default 'draft'
                   check (workflow_status in ('draft','needs_review','approved')),
  source_hash_at_translation text,                -- English hash when value last set
  translator_id  uuid references auth.users(id),
  reviewer_id    uuid references auth.users(id),
  updated_at     timestamptz not null default now(),
  unique (key_id, language_code)
);
create index if not exists tv_lang_wf on public.translation_values (language_code, workflow_status);
create index if not exists tv_key      on public.translation_values (key_id);

-- ── translator_language_access — assignment ─────────────────────────────────
create table if not exists public.translator_language_access (
  user_id       uuid not null references auth.users(id) on delete cascade,
  language_code text not null references public.languages(code) on delete cascade,
  assigned_by   uuid references auth.users(id),
  assigned_at   timestamptz not null default now(),
  primary key (user_id, language_code)
);

-- ── translation_releases — immutable published catalogs ─────────────────────
create table if not exists public.translation_releases (
  id                bigint generated always as identity primary key,
  language_code     text not null references public.languages(code) on delete cascade,
  version           int  not null,
  catalog           jsonb not null,               -- authoritative sparse overlay
  catalog_hash      text not null,
  source_release_id bigint references public.translation_releases(id), -- set on restore
  published_by      uuid references auth.users(id),
  published_at      timestamptz not null default now(),
  is_current        boolean not null default true,
  unique (language_code, version)
);
create unique index if not exists releases_one_current
  on public.translation_releases (language_code) where is_current;

-- ── RLS: enable everywhere, DENY by default (policies added in 02_authz.sql) ─
alter table public.languages                  enable row level security;
alter table public.translation_keys           enable row level security;
alter table public.translation_values         enable row level security;
alter table public.translator_language_access enable row level security;
alter table public.translation_releases       enable row level security;

-- Belt-and-braces: no direct table privileges for anon/authenticated. All reads
-- go through the policies added next; all writes go through SECURITY DEFINER
-- RPCs. (RLS already blocks, but revoking table grants removes the surface.)
revoke all on public.languages,
              public.translation_keys,
              public.translation_values,
              public.translator_language_access,
              public.translation_releases
  from anon, authenticated;

commit;
