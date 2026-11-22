// Run with: node scripts/test-circles-unified.mjs
// Static safeguards for one Circle system with different purposes. Database
// rules: scripts/circles-activities-tests.sql. Browser: scripts/e2e/circles-unified.e2e.mjs.
import {readFileSync} from 'node:fs';
import {strict as assert} from 'node:assert';
const read = (f) => readFileSync(f, 'utf8');
const mig = read('supabase/migrations/20261124090000_follow_circle_activities.sql');
const code = mig.replace(/--[^\n]*/g, '');
const sos = read('daily-sos-circles.js'), sosHtml = read('daily-sos.html');
const circles = read('follow-circles.js'), circlesHtml = read('follow-circles.html'), cb = read('conversation-box.html');

// Additive and safe for existing Circles.
assert(!/\bdrop\s+(table|column)\b|\bdelete\s+from\s+public\.follow_circle_(posts|steps|commitments|members)\b/i.test(code), 'migration must not drop or delete Circle activity');
assert(/uses_reading boolean not null default true/.test(code) && /uses_conversations boolean not null default true/.test(code), 'existing Circles keep both activities');
assert(/check \(uses_reading or uses_conversations\)/.test(code), 'a Circle always does something');
// Daily reading eligibility.
assert(/if exists\(select 1 from public\.follow_circle_primary where user_id=p_user\) then return/.test(code), 'own pace and existing choices are never overridden');
assert(/c\.uses_reading and c\.closed_at is null/.test(code), 'only open FOLLOW DAILY Circles can become the daily reading');
assert(/where m\.user_id=auth\.uid\(\) and c\.closed_at is null and c\.uses_reading/.test(code), 'schedules list FOLLOW DAILY Circles only');
assert(/doesn''t use FOLLOW DAILY/.test(code) && /create or replace function public\.follow_circle_set_primary/.test(code), 'set primary refuses other Circles');
assert(/is_steward\(p_circle,auth\.uid\(\)\)/.test(code), 'only stewards change activities');
assert(/from public,anon;/.test(code), 'new functions are revoked from anon');

// Follow Daily: viewing never changes the daily reading.
const setView = sos.slice(sos.indexOf('function setView'), sos.indexOf('function closeSwitcher'));
assert(!/follow_circle_set_(primary|independent)/.test(setView), 'switching what you view must not change the daily reading');
assert((sos.match(/follow_circle_set_primary/g) || []).length === 1, 'the daily reading changes only from the explicit button');
assert(/searchParams\.set\('circle',viewing\)/.test(sos) && sosHtml.includes('id="reading-switch"') && sosHtml.includes('id="reading-make-primary"'), 'switcher and explicit change present');

// Circles page and Conversation Box respect each Circle's purpose.
assert(/actReady\?await invoke\('follow_circle_create_with'/.test(circles.replace(/\s+/g, ' ').replace(/\? /g, '?')) || circles.includes("?await invoke('follow_circle_create_with'"), 'create with activities when available');
assert(circles.includes('usesReading') && circles.includes('usesConversations') && circlesHtml.includes('id="activities-form"') && circlesHtml.includes('id="create-activities"'), 'purpose-aware Circles page');
assert(/filter\(x => x\.uses_conversations !== false\)/.test(cb), 'Conversation Box offers only Conversations Circles');
console.log('Unified Circles static contracts: PASS');
