-- ============================================================================
-- STEP 3a — Seed the 10 existing languages (Phase 0).
--
-- Native names/order copied verbatim from the current hard-coded selector in
-- index.html. English is the source; all 10 are currently live, so all start
-- active. None of the current languages is RTL. Run BEFORE the value seeds
-- (02_values_*.sql) because translation_values.language_code references this.
-- ============================================================================

begin;

insert into public.languages (code, english_name, native_name, direction, is_active, is_source, sort_order) values
  ('en', 'English',    'English',                'ltr', true, true,   10),
  ('bn', 'Bangla',     'বাংলা (Bangla)',          'ltr', true, false,  20),
  ('bo', 'Tibetan',    'བོད་སྐད་ (Tibetan)',       'ltr', true, false,  30),
  ('de', 'German',     'Deutsch (German)',       'ltr', true, false,  40),
  ('es', 'Spanish',    'Español (Spanish)',      'ltr', true, false,  50),
  ('ne', 'Nepali',     'नेपाली (Nepali)',          'ltr', true, false,  60),
  ('ru', 'Russian',    'Русский (Russian)',      'ltr', true, false,  70),
  ('si', 'Sinhala',    'සිංහල (Sinhala)',         'ltr', true, false,  80),
  ('ta', 'Tamil',      'தமிழ் (Tamil)',           'ltr', true, false,  90),
  ('uk', 'Ukrainian',  'Українська (Ukrainian)', 'ltr', true, false, 100)
on conflict (code) do nothing;

commit;
