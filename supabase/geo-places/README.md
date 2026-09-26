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

## Order matters

1. **Apply the SQL.** Supabase → SQL editor → paste [`01_schema.sql`](./01_schema.sql) → Run.
   Additive and idempotent.
2. **Backfill old rows.** Locally, with the service role key (Settings → API):

   ```sh
   export SUPABASE_URL=https://mjiswwujcsmayuytoaul.supabase.co
   export SUPABASE_SERVICE_ROLE_KEY=...   # never commit this
   export GEOCODE_CONTACT=you@example.com
   node scripts/backfill-places.mjs          # dry run
   node scripts/backfill-places.mjs --apply  # write
   ```

   1 lookup/second (Nominatim policy), cached by ~100 m. Re-runnable: only
   touches rows where `place_key` is null. It also rewrites `city` and
   `location_text` to the English names so old and new rows match.
3. **Ship the front end** (merge the branch).

The pages tolerate any order: if the columns don't exist yet, the map reads
without them and the conversation box retries the insert without them. But
until step 2 runs, old rows group under bare city names and new rows under
`place_key`, so a city can show twice.

## Verify

```sql
select place_label, count(*) from conversation_events
group by place_label order by 2 desc limit 20;

select count(*) filter (where place_key is null and latitude is not null) as pending
from conversation_events;
```

## Rollback

```sql
alter table public.conversation_events
  drop column if exists country_code, drop column if exists region,
  drop column if exists place_key,    drop column if exists place_label;
alter table public.church_assessments
  drop column if exists country_code, drop column if exists region,
  drop column if exists place_key,    drop column if exists place_label;
```
