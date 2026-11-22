// Run with: node scripts/test-follow-circles.mjs
// Static safeguards. These do not replace database RLS tests or browser E2E.
import {readFileSync} from 'node:fs';
import {strict as assert} from 'node:assert';
import {Script} from 'node:vm';
const html=readFileSync('follow-circles.html','utf8');
const js=readFileSync('follow-circles.js','utf8');
const css=readFileSync('follow-circles.css','utf8');
const sos=readFileSync('daily-sos.html','utf8');
const migration=readFileSync('supabase/migrations/20261122120000_follow_multiplying_circles.sql','utf8');
const identifiers=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(identifiers).size,identifiers.length,'duplicate HTML IDs');
for(const [,id] of js.matchAll(/\$\('([^']+)'\)/g))assert(identifiers.includes(id),'missing '+id);
assert(js.includes("from './supabase.js'"),'reuses existing auth client');
assert(js.includes("follow_circle_join"),'missing instant join');
assert(js.includes("follow_circle_new_invite"),'missing member invitations');
assert(js.includes("renderTargets"),'missing explicit multi-circle selection');
assert(js.includes("follow_circle_progress"),'missing approved progress read');
assert(js.includes("status("),'missing error/status feedback');
assert(!js.includes("sos_daily_progress"),'client must not read private SOS rows for group progress');
assert(!html.includes('SOS journal preview'),'no private journal previews');
assert(sos.includes('/follow-circles.html?day='),'SOS optional Circle entry point missing');
assert((migration.match(/enable row level security/g)||[]).length>=7,'all tables must have RLS');
for(const name of ['follow_circles','follow_circle_members','follow_circle_posts','follow_circle_invites','follow_circle_reactions','follow_circle_reports','follow_circle_blocks'])assert(migration.includes('public.'+name),'missing table '+name);
assert(migration.includes('revoke all on public.follow_circle_invites'),'invitation hashes must not be exposed');
assert(migration.includes('grant update(display_name,progress_visible'),'membership role must not be editable');
assert(migration.includes('if not circles_private.is_member(p_circle,auth.uid())'),'membership validation missing');
assert(migration.includes("field_name='say'"),'progress derived from completion, not journal text');
assert(migration.includes('created_at>now()'),'spam throttle missing');
assert(migration.includes('follow_circle_removed_members'),'removed users must not rejoin with old links');
assert(migration.includes('if exists(select 1 from public.follow_circle_removed_members'),'join must reject removed users');
assert(migration.includes('order by joined_at,user_id limit'),'progress and membership pagination must match');
assert(css.includes('@media(max-width:500px)'),'mobile CSS missing');
// Browser module is syntax checked via Node's --check separately in CI.
new Script(js.replace(/^import[^\n]*\n/,''),{filename:'follow-circles.js'});
console.log('Follow Circles static contracts: PASS');
