// Run with: node scripts/test-circle-conversations.mjs
// Static safeguards for Conversation Box × Circles and the church view.
// Database rules are proven in scripts/circles-conversations-tests.sql and the
// browser flow in scripts/e2e/circle-conversations.e2e.mjs.
import {readFileSync} from 'node:fs';
import {strict as assert} from 'node:assert';
const read = (f) => readFileSync(f, 'utf8');
const migration = read('supabase/migrations/20261123090000_follow_circle_conversations.sql');
const circlesJs = read('follow-circles.js'), circlesHtml = read('follow-circles.html');
const churchJs = read('church.js'), churchHtml = read('church.html');
const cb = read('conversation-box.html');

const ids = (html) => [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
for (const [html, js, name] of [[circlesHtml, circlesJs, 'follow-circles'], [churchHtml, churchJs, 'church']]) {
  const known = ids(html);
  assert.equal(new Set(known).size, known.length, name + ': duplicate HTML IDs');
  for (const [, id] of js.matchAll(/\$\('([^']+)'\)/g)) assert(known.includes(id), name + ': missing #' + id);
}

// Names never leave the device through these features.
assert(!/person_name/.test(migration.replace(/--[^\n]*/g, '')), 'migration must never read person names');
assert(/prayer_initials ~ '/.test(migration), 'database must enforce initials for prayer requests');
assert(/revoke all on public\.follow_circle_steps from anon,authenticated/.test(migration), 'steps must not be directly readable');
assert(/from public,anon;/.test(migration), 'new functions must be revoked from anon');
const share = cb.slice(cb.indexOf('function shareStep'), cb.indexOf('// ── Onboarding'));
assert(share.includes("from('follow_circle_steps')") && !/name:\s*step\.name|person_name/.test(share), 'shared steps must not include the name');
assert(/log\.push\(\{ from: from \|\| null, to, response: response \|\| null, at:/.test(cb), 'device step log keeps stages only');
assert(cb.includes("const mode = SAFETY_MODE ? 'private' : 'step';"), 'safety mode defaults to private');
assert(/INITIALS_RE\.test\(initials\)/.test(cb) && /prayer-initials/.test(circlesHtml), 'initials validated before sending');

// The church view reads counts only.
assert(!/follow_circle_posts|follow_circle_members'\)\.select\('[^']*display_name|conversation_people/.test(churchJs.replace(/from\('follow_circle_members'\)\.select\('circle_id,role'\)/, '')), 'church view must not read posts or people');
for (const fn of ['follow_church_overview', 'follow_church_accept', 'follow_church_new_invite', 'follow_church_list']) assert(churchJs.includes(fn), 'church view uses ' + fn);

// The Circles page keeps working before the migration is applied.
assert(circlesJs.includes('cbReady') && /share_conversations'\)\.eq\('user_id',user\.id\)\.limit\(1\)/.test(circlesJs), 'feature detection missing');
assert(/\(cbReady\?',share_conversations':''\)/.test(circlesJs), 'new member column must be optional');
assert(circlesHtml.includes('data-tab="conversations"') && circlesJs.includes("'conversations'"), 'Conversations tab missing');
console.log('Circle conversations static contracts: PASS');
