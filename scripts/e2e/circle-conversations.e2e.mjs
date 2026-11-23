// End-to-end: Conversation Box → Circle → church, in a real browser against a
// real PostgreSQL with the actual migrations and RLS (through pg-bridge.mjs).
//
//   Needs: psql, an EMPTY throwaway database in PGHOST/PGPORT/PGUSER/PGDATABASE,
//   and Playwright with Chromium. Never point it at production.
//   node scripts/e2e/circle-conversations.e2e.mjs [screenshot-dir]
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {psql, serve, CLIENT} from './pg-bridge.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS = process.argv[2] || null;
if (SHOTS) fs.mkdirSync(SHOTS, {recursive: true});
const PORT = 8131, BASE = `http://127.0.0.1:${PORT}`;
const USERS = {
  alice: {id: '11111111-1111-4111-8111-111111111111', email: 'alice@example.test'},
  bob: {id: '22222222-2222-4222-8222-222222222222', email: 'bob@example.test'},
  dana: {id: '44444444-4444-4444-8444-444444444444', email: 'dana@example.test'},
};
const PRIVATE_NAMES = ['Maria', 'James', 'Lena', 'Jonah'];
let failures = 0;
const check = (ok, label, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + label + (ok || extra === undefined ? '' : ' ' + JSON.stringify(extra))); if (!ok) failures++; };
const sql = async (s) => { const r = await psql(s); if (r.error) throw new Error(r.error.message); return r.out; };

for (const f of ['scripts/circles-test-bootstrap.sql', 'supabase/migrations/20261122120000_follow_multiplying_circles.sql',
  'supabase/migrations/20261122190000_follow_circle_shared_schedules.sql', 'supabase/migrations/20261123090000_follow_circle_conversations.sql',
  'supabase/migrations/20261124090000_follow_circle_activities.sql', 'scripts/e2e/fixtures.sql']) await sql(fs.readFileSync(path.join(ROOT, f), 'utf8'));

const log = [];
const server = await serve(ROOT, PORT, log);
const browser = await chromium.launch();
const pageErrors = [];
async function as(who, {width = 390, height = 844, local = {}} = {}) {
  const ctx = await browser.newContext({viewport: {width, height}, deviceScaleFactor: SHOTS ? 2 : 1});
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (url.includes('cdn.jsdelivr.net/npm/@supabase/supabase-js')) return route.fulfill({contentType: 'text/javascript', body: CLIENT});
    if (url.startsWith(BASE)) return route.continue();
    return route.abort();
  });
  await ctx.addInitScript(([user, local]) => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    localStorage.setItem('__e2e_session', JSON.stringify({user, access_token: 'e2e'}));
    localStorage.setItem('onboarding-seen', '1'); localStorage.setItem('onboarding-safety-seen', '1');
    for (const [k, v] of Object.entries(local)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  }, [USERS[who], local]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(who + ': ' + e.message));
  page.on('dialog', (d) => d.accept());
  return page;
}
const shot = async (page, name, full = true) => { if (SHOTS) await page.screenshot({path: path.join(SHOTS, name + '.png'), fullPage: full}); };
const visibleText = (page) => page.evaluate(() => document.body.innerText);

try {
  // ── Alice starts a Circle; Bob joins with the link ──────────────────────
  const alice = await as('alice');
  await alice.goto(BASE + '/follow-circles.html');
  await alice.click('#new-circle');
  await alice.fill('#create-name', 'Tuesday Night Group');
  await alice.fill('#create-display', 'Alice');
  await alice.click('#create-form button[type=submit]');
  await alice.waitForSelector('#link-dialog:not([hidden])');
  const invite = new URL(await alice.inputValue('#invite-url'));
  await alice.click('#close-link');
  const circleId = await sql(`select id from public.follow_circles where name='Tuesday Night Group'`);
  check(!!circleId, 'Circle created through the page');

  const bob = await as('bob', {local: {conversations: {casual: [{name: 'Sam', date: ''}], meaningful: [{name: 'Ravi', date: ''}], spiritual: [], discovery: []}}});
  await bob.goto(BASE + invite.pathname + invite.search);
  await bob.waitForSelector('#join-form');
  await bob.fill('#join-name', 'Bob');
  await bob.click('#join-form button[type=submit]');
  await bob.waitForSelector('#circle-view:not([hidden])');
  check(await bob.isVisible('[data-tab="conversations"]'), 'Conversations tab appears once the migration is live');

  // ── Alice works her Conversation Box and shares steps ───────────────────
  const cb = await as('alice', {local: {conversations: {casual: [{name: 'Maria', date: ''}, {name: 'James', date: ''}], meaningful: [{name: 'Lena', date: ''}], spiritual: [{name: 'Jonah Kim', date: ''}], discovery: []}}});
  await cb.goto(BASE + '/conversation-box.html');
  await cb.waitForTimeout(1200);
  check(await cb.isVisible('#cb-circles-link'), 'Conversation Box links to your Circles when you have one');
  check(Number(await sql(`select count(*) from public.conversation_people where user_id='${USERS.alice.id}'`)) === 4, 'Conversation Box synced to the account first');

  await cb.click('.conversation-item:has-text("Maria") .move-btn');
  await cb.waitForSelector('#share-bar', {state: 'visible'});
  check((await cb.textContent('#share-bar-title')).includes('Maria moved to Meaningful'), 'Bottom bar names the step on this device, no pop-up');
  check((await cb.textContent('#share-bar-sub')).includes('Share with Tuesday Night Group?'), 'Bar names the Circle; one tap shares');
  await shot(cb, 'mobile-share-bar', false);
  await cb.click('#share-bar-btn');
  await cb.waitForTimeout(500);
  check(Number(await sql(`select count(*) from public.follow_circle_steps where to_stage='meaningful' and from_stage='casual'`)) === 1, 'Step shared to the Circle (stages only)');

  await cb.click('.conversation-item:has-text("Jonah") .move-btn');
  await cb.click(`#move-prompt .option[onclick="selectOption('trusted')"]`);
  await cb.waitForSelector('#share-bar', {state: 'visible'});
  await cb.click('#share-bar-btn');
  await cb.waitForTimeout(500);
  check(await sql(`select response from public.follow_circle_steps where to_stage='discovery'`) === 'trusted', 'Discovery response shared');

  // Ask the Circle to pray from the person sheet.
  await cb.click('.conversation-item:has-text("Jonah") .conversation-name');
  await cb.waitForSelector('#details-circle', {state: 'visible'});
  check(await cb.inputValue('#pray-initials') === 'J. K.', 'Prayer request prefilled with initials, not the name');
  check(!(await cb.isVisible('#focus-row')), 'No weekly focus for someone already in Discovery');
  await cb.fill('#pray-line', 'Asked to read John 3 together on Friday');
  await shot(cb, 'mobile-person-pray', false);
  await cb.click('#pray-send');
  await cb.waitForSelector('#pray-asked', {state: 'visible'});
  check(await sql(`select prayer_initials||'|'||prayer_stage from public.follow_circle_posts where kind='prayer'`) === 'J. K.|discovery', 'Prayer request stored with initials and stage');
  check(!(await sql(`select string_agg(body,' ') from public.follow_circle_posts`)).includes('Jonah'), 'No name in any Circle post');
  await cb.click('.details-actions .btn-secondary');

  // A backward move is private and asks nothing.
  await cb.click('.conversation-item:has-text("Lena") .conversation-name');
  await cb.click('#details-move-back');
  await cb.waitForTimeout(300);
  check(!(await cb.isVisible('#share-bar')), 'Moving someone back does not offer to share');

  // Focus on James this week, then move him: flag, progress, commitment.
  await cb.click('.conversation-item:has-text("James") .conversation-name');
  await cb.check('#details-focus');
  await cb.waitForTimeout(400);
  await cb.click('.details-actions .btn-secondary');
  check((await cb.textContent('#week-title')).includes('0 of 1 moved forward'), 'Week card shows this week’s focus');
  check((await cb.textContent('.conversation-item:has-text("James") .flag')).includes('This week'), 'Focused person carries a flag');
  check(await sql(`select goal from public.follow_circle_commitments where user_id='${USERS.alice.id}'`) === '1', 'Focus commits a number to the Circle');
  await shot(cb, 'mobile-box-week', true);
  await cb.click('.conversation-item:has-text("James") .move-btn');
  await cb.waitForSelector('#share-bar', {state: 'visible'});
  await cb.click('#share-bar-close');
  check((await cb.textContent('#week-title')).includes('1 of 1 moved forward'), 'Moving a focused person completes the week');
  check((await cb.textContent('.conversation-item:has-text("James") .flag')).includes('Moved this week'), 'Flag turns into a check');
  check(Number(await sql(`select count(*) from public.follow_circle_steps`)) === 2, 'Only steps you chose to share were sent');
  const steps = await cb.evaluate(() => JSON.parse(localStorage.getItem('cb-steps')));
  check(steps.length === 3 && steps.every((s) => !('name' in s)), 'Device step log keeps stages only', steps);
  await cb.waitForTimeout(800);

  // ── Alice opts in to include her counts ────────────────────────────────
  await alice.goto(BASE + `/follow-circles.html?circle=${circleId}&tab=conversations`);
  await alice.waitForSelector('#tab-conversations:not([hidden])');
  check(await alice.isVisible('#cb-optin'), 'Counts are off until you opt in');
  await alice.click('#cb-optin-btn');
  await alice.waitForTimeout(600);
  const total = (p, s) => p.textContent(`#cb-quad [data-stage="${s}"] .cb-total`);
  check(await total(alice, 'casual') === '1' && await total(alice, 'meaningful') === '2' && await total(alice, 'discovery') === '1', 'Group totals reflect the synced box',
    [await total(alice, 'casual'), await total(alice, 'meaningful'), await total(alice, 'spiritual'), await total(alice, 'discovery')]);

  // ── Bob sees counts, steps and the prayer request, never names ─────────
  await bob.goto(BASE + `/follow-circles.html?circle=${circleId}&tab=conversations`);
  await bob.waitForSelector('.prayer');
  check(await total(bob, 'discovery') === '1' && (await bob.textContent('#cb-quad [data-stage="discovery"] .cb-week')).includes('1 trusted Christ'), 'Bob sees the group box with this week');
  check((await bob.textContent('#cb-activity')).includes('Alice moved 2 people forward'), 'Bob sees Alice’s shared steps');
  check((await bob.textContent('#prayer-list')).includes('J. K.'), 'Bob sees the prayer request by initials');
  await bob.click('.pray-btn');
  await bob.waitForTimeout(400);
  check((await bob.textContent('.pray-btn')).includes('Praying · 1'), 'Praying toggles on');
  await bob.check('#huddle-picks input[value="Sam"]');
  await bob.check('#huddle-picks input[value="Ravi"]');
  await bob.click('#huddle-commit');
  await bob.waitForTimeout(700);
  check((await bob.textContent('#huddle-group')).includes('2 members committed to 3 people'), 'Huddle commitment counted for the group');
  check(await sql(`select goal from public.follow_circle_commitments where user_id='${USERS.bob.id}'`) === '2', 'Commitment stored as a number');
  // The praying count comes back to Alice's row, on her device only.
  await cb.reload();
  await cb.waitForSelector('.conversation-item:has-text("Jonah") .name-praying', {timeout: 5000}).catch(() => {});
  check((await cb.textContent('.conversation-item:has-text("Jonah")')).includes('1 praying'), 'Praying count shows on the person’s row');
  const bobText = await visibleText(bob);
  check(PRIVATE_NAMES.every((n) => !bobText.includes(n)), 'No names from Alice’s box appear for Bob');
  await shot(bob, 'mobile-circle-conversations');

  // Prayer request from the Circle page validates initials.
  await bob.click('#prayer-toggle');
  await bob.fill('#prayer-initials', 'Sam Lee');
  await bob.fill('#prayer-body', 'Job interview');
  await bob.click('#prayer-form button[type=submit]');
  check((await bob.textContent('#notice')).includes('initials only'), 'Full names are refused before sending');
  await bob.fill('#prayer-initials', 'S. L.');
  await bob.click('#prayer-form button[type=submit]');
  await bob.waitForTimeout(500);
  check((await bob.textContent('#prayer-list')).includes('S. L.'), 'Prayer request added from the Circle page');

  // ── Dana sets up a church; Alice links the Circle ──────────────────────
  const dana = await as('dana', {width: 1280, height: 900});
  await dana.goto(BASE + '/church.html');
  await dana.fill('#church-name', 'Grace Fellowship');
  await dana.fill('#church-display', 'Dana');
  await dana.click('#create-church button[type=submit]');
  await dana.waitForSelector('#link-dialog:not([hidden])');
  const churchLink = new URL(await dana.inputValue('#invite-url'));
  await dana.click('#close-link');
  check((await dana.textContent('#nudges')).includes('Send the Circle link'), 'Empty church explains the next step');

  await alice.goto(BASE + churchLink.pathname + churchLink.search);
  await alice.waitForSelector('#link-form:not([hidden])');
  await alice.click('#link-form button[type=submit]');
  await alice.waitForFunction(() => document.getElementById('notice').textContent.length > 0, null, {timeout: 5000}).catch(() => {});
  const linkNotice = await alice.textContent('#notice');
  check(linkNotice.startsWith('Linked'), 'Steward linked the Circle', {notice: linkNotice, url: alice.url(), form: await alice.isVisible('#link-form'), calls: log.slice(-6).map((x) => x.body.rpc || x.body.table)});

  await dana.reload();
  await dana.waitForSelector('#circles-body tr');
  check((await dana.textContent('#circles-body')).includes('Tuesday Night Group'), 'Church view lists the Circle');
  check(await dana.textContent('.stage[data-stage="discovery"] .stage-total') === '1', 'Church totals by stage');
  check((await dana.textContent('#stage-note')).includes('2 steps shared, 1 trusted Christ'), 'Church 30-day activity');
  const danaText = await visibleText(dana);
  check(PRIVATE_NAMES.concat(['J. K.', 'Sam', 'Ravi', 'John 3']).every((n) => !danaText.includes(n)), 'Church view shows no names, initials or posts');
  await shot(dana, 'desktop-church-view');
  await dana.setViewportSize({width: 390, height: 844});
  await shot(dana, 'mobile-church-view');
  const wide = await dana.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.table-box')).slice(0, 5).map((e) => e.tagName + '.' + e.className + '#' + e.id));
  check(wide.length === 0, 'Church view fits a phone', wide);

  await alice.goto(BASE + `/follow-circles.html?circle=${circleId}`);
  await alice.click('[data-tab="about"]');
  check((await alice.textContent('#church-status')).includes('Grace Fellowship'), 'Circle settings show the church link');
  await alice.setViewportSize({width: 1280, height: 900});
  await alice.click('[data-tab="conversations"]');
  await alice.waitForSelector('.prayer');
  await shot(alice, 'desktop-circle-conversations');
  for (const [p, who] of [[bob, 'Bob'], [alice, 'Alice']]) check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), who + '’s Circle page fits');
} finally {
  const dbErrors = log.filter((x) => x.error).map((x) => (x.body.rpc || x.body.table) + ': ' + x.error.message);
  check(pageErrors.length === 0, 'No page errors', pageErrors);
  check(dbErrors.length === 0, 'No rejected database calls', dbErrors);
  await browser.close(); server.close();
  console.log(failures ? failures + ' FAILED' : 'CIRCLE CONVERSATIONS E2E PASSED');
  process.exitCode = failures ? 1 : 0;
}
