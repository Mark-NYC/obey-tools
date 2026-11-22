// End-to-end: one Circle system with different purposes, a daily reading you
// choose on purpose, a reading switcher that never changes it, and optional
// church connections. Real pages, real migrations and RLS (pg-bridge.mjs).
//
//   Needs: psql, an EMPTY throwaway database in PG* env vars, Playwright.
//   node scripts/e2e/circles-unified.e2e.mjs [screenshot-dir]
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
const PORT = 8132, BASE = `http://127.0.0.1:${PORT}`;
const U = {
  alice: {id: '11111111-1111-4111-8111-111111111111', email: 'alice@example.test'},
  bob: {id: '22222222-2222-4222-8222-222222222222', email: 'bob@example.test'},
  dana: {id: '44444444-4444-4444-8444-444444444444', email: 'dana@example.test'},
  evan: {id: '55555555-5555-4555-8555-555555555555', email: 'evan@example.test'},
};
let failures = 0;
const check = (ok, label, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + label + (ok || extra === undefined ? '' : ' ' + JSON.stringify(extra))); if (!ok) failures++; };
const sql = async (s) => { const r = await psql(s); if (r.error) throw new Error(r.error.message); return r.out; };
const primaryOf = (who) => sql(`select coalesce((select coalesce(c.name,'OWN PACE') from public.follow_circle_primary p left join public.follow_circles c on c.id=p.circle_id where p.user_id='${U[who].id}'),'NONE')`);
const circleId = (name) => sql(`select id from public.follow_circles where name='${name}'`);

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
  }, [U[who], local]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(who + ': ' + e.message));
  page.on('dialog', (d) => d.accept());
  return page;
}
const shot = async (page, name, full = true) => { if (SHOTS) await page.screenshot({path: path.join(SHOTS, name + '.png'), fullPage: full}); };
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const openCircles = async (page, q = '') => { await page.goto(BASE + '/follow-circles.html' + q); await page.waitForSelector('#overview:not([hidden]), #circle-view:not([hidden])'); await page.waitForTimeout(300); };
const openReading = async (page, q = '') => { await page.goto(BASE + '/daily-sos.html' + q); await page.waitForTimeout(1500); };
async function createCircle(page, name, {reading = true, conversations = true} = {}) {
  await openCircles(page);
  await page.click('#new-circle');
  await page.fill('#create-name', name);
  await page.setChecked('#create-reading', reading);
  await page.setChecked('#create-conversations', conversations);
  await page.click('#create-form button[type=submit]');
  await page.waitForSelector('#link-dialog:not([hidden])');
  const link = new URL(await page.inputValue('#invite-url'));
  await page.click('#close-link');
  return link.pathname + link.search;
}

try {
  // ── No Circles ─────────────────────────────────────────────────────────
  const evan = await as('evan');
  await openCircles(evan);
  check(await evan.isVisible('#empty-circles') && !(await evan.isVisible('#daily-reading')), 'No Circles: empty state, no daily-reading line');
  await openReading(evan);
  check(!(await evan.isVisible('#reading-switch')), 'No Circles: Follow Daily shows no switcher');

  // ── A Conversations-only Circle never becomes the daily reading ─────────
  const alice = await as('alice', {local: {conversations: {casual: [{name: 'Maria', date: ''}], meaningful: [], spiritual: [], discovery: []}}});
  await openCircles(alice);
  await alice.click('#new-circle');
  await alice.uncheck('#create-reading');
  check(!(await alice.isVisible('#create-reading-fields')), 'Create: reading start and time zone hide when FOLLOW DAILY is off');
  await shot(alice, 'mobile-create-conversations-only', false);
  await alice.click('#cancel-create');
  await createCircle(alice, 'Campus Outreach', {reading: false, conversations: true});
  check(!(await alice.isVisible('#reading-choice')) && !(await alice.isVisible('#circle-today-link')), 'Conversations-only Circle: no reading controls');
  check(await alice.isVisible('#circle-box-link') && await alice.getAttribute('#tabs-conversations', 'aria-current') === 'page', 'Conversations-only Circle opens on Conversations');
  check(await primaryOf('alice') === 'NONE', 'Conversations-only Circle did not become the daily reading');
  await openReading(alice);
  check(!(await alice.isVisible('#reading-switch')), 'Follow Daily ignores Conversations-only Circles');

  // ── First reading Circle becomes the daily reading ─────────────────────
  const tuesdayLink = await createCircle(alice, 'Tuesday Bible Study');
  check(await primaryOf('alice') === 'Tuesday Bible Study', 'First FOLLOW DAILY Circle became the daily reading');

  // Bob's Circles started earlier: Alice joins late and enters their current day.
  const bob = await as('bob');
  const hoodLink = await createCircle(bob, 'Neighborhood Disciples', {reading: true, conversations: false});
  const campusLink = await createCircle(bob, 'Campus Readers', {reading: true, conversations: true});
  await sql(`update public.follow_circles set start_day=50,start_on=current_date-13 where name='Neighborhood Disciples'`);
  for (const link of [hoodLink]) {
    await alice.goto(BASE + link); await alice.waitForSelector('#join-form');
    await alice.fill('#join-name', 'Alice'); await alice.click('#join-form button[type=submit]');
    await alice.waitForSelector('#circle-view:not([hidden])');
  }
  check(await primaryOf('alice') === 'Tuesday Bible Study', 'Joining another Circle kept the daily reading');
  check((await alice.textContent('#circle-subtitle')).includes('Reading Day 63'), 'Late joiner enters the Circle’s current day');

  // ── Your Circles overview ──────────────────────────────────────────────
  await openCircles(alice);
  check((await alice.textContent('#daily-reading')).includes('Tuesday Bible Study'), 'Overview names the daily reading');
  const rows = await alice.$$eval('#circle-list .circle-card', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  check(rows[0].includes('Tuesday Bible Study') && rows[0].includes('Your daily reading') && rows[0].includes('Steward'), 'Daily-reading Circle listed first, marked', rows[0]);
  check(rows.some((r) => r.includes('Campus Outreach') && r.includes('Conversations') && !r.includes('FOLLOW DAILY')), 'Conversations-only Circle shows its purpose', rows);
  check(rows.some((r) => r.includes('Neighborhood Disciples') && r.includes('FOLLOW DAILY · Day 63') && !r.includes('Conversations')), 'Reading-only Circle shows its day', rows);
  for (const w of [375, 390]) { await alice.setViewportSize({width: w, height: 844}); check(await fits(alice), `Overview fits ${w}px`); await shot(alice, `mobile-${w}-your-circles`); }
  await alice.setViewportSize({width: 1280, height: 900}); await shot(alice, 'desktop-your-circles'); await alice.setViewportSize({width: 390, height: 844});

  // Switch between Circles from inside a Circle.
  await alice.click('#circle-list .circle-card >> nth=0');
  await alice.selectOption('#circle-switch', await circleId('Campus Outreach'));
  await alice.waitForTimeout(500);
  check((await alice.textContent('#circle-name')) === 'Campus Outreach', 'Switch Circles without going back to the list');

  // ── Follow Daily: view another Circle without changing the daily reading ─
  await openReading(alice);
  check((await alice.textContent('#reading-switch-btn')).includes('Tuesday Bible Study'), 'Follow Daily shows whose reading this is');
  await alice.click('#reading-switch-btn');
  const items = await alice.$$eval('#reading-switch-menu .rs-item', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  check(items.length === 3 && items[0].includes('Your daily reading') && items.some((i) => i.includes('Neighborhood Disciples') && i.includes('Day 63')) && items.at(-1).includes('My own pace'),
    'Switcher lists reading Circles and own pace, never Conversations-only', items);
  await shot(alice, 'mobile-390-reading-switcher', false);
  await alice.click('#reading-switch-menu .rs-item:has-text("Neighborhood")');
  await alice.waitForTimeout(600);
  check(alice.url().includes('circle=') && (await alice.textContent('#day-label')).includes('Day 63'), 'Opened Neighborhood’s current reading', await alice.textContent('#day-label'));
  check(await alice.isVisible('#reading-context') && (await alice.textContent('#reading-context')).includes('Your daily reading is Tuesday Bible Study'), 'Says this isn’t your daily reading');
  check(await primaryOf('alice') === 'Tuesday Bible Study', 'Viewing another Circle did not change the daily reading');
  for (const w of [375, 390]) { await alice.setViewportSize({width: w, height: 844}); check(await fits(alice), `Follow Daily fits ${w}px while viewing another Circle`); }
  await shot(alice, 'mobile-390-viewing-other-circle', false);
  await alice.click('#reading-back');
  await alice.waitForTimeout(500);
  check(!alice.url().includes('circle=') && (await alice.textContent('#day-label')).includes('Day 1') && !(await alice.isVisible('#reading-context')), 'Back to my daily reading');

  // Intentional change.
  await alice.click('#reading-switch-btn');
  await alice.click('#reading-switch-menu .rs-item:has-text("Neighborhood")');
  await alice.waitForTimeout(400);
  await alice.click('#reading-make-primary');
  await alice.waitForTimeout(700);
  check(await primaryOf('alice') === 'Neighborhood Disciples' && !(await alice.isVisible('#reading-context')), 'Make this my daily reading (on purpose)');
  await alice.reload(); await alice.waitForTimeout(1500);
  check((await alice.textContent('#day-label')).includes('Day 63'), 'Follow Daily now opens on the new daily reading');

  // Own pace survives joining another reading Circle.
  await alice.click('#reading-switch-btn');
  await alice.click('#reading-switch-menu .rs-item:has-text("My own pace")');
  await alice.waitForTimeout(400);
  await alice.click('#reading-make-primary');
  await alice.waitForTimeout(700);
  check(await primaryOf('alice') === 'OWN PACE' && (await alice.textContent('#reading-switch-btn')).includes('your own pace'), 'Own pace chosen without leaving Circles');
  await alice.goto(BASE + campusLink); await alice.waitForSelector('#join-form');
  await alice.fill('#join-name', 'Alice'); await alice.click('#join-form button[type=submit]');
  await alice.waitForSelector('#circle-view:not([hidden])');
  check(await primaryOf('alice') === 'OWN PACE', 'Independent reader joining a Circle keeps own pace');
  await openCircles(alice);
  check((await alice.textContent('#daily-reading')).includes('Your own pace'), 'Overview says own pace');

  // ── Conversation Box only offers Conversations Circles ─────────────────
  const cb = await as('alice', {local: {conversations: {casual: [{name: 'Maria', date: ''}], meaningful: [], spiritual: [], discovery: []}}});
  await cb.goto(BASE + '/conversation-box.html'); await cb.waitForTimeout(1200);
  await cb.click('.conversation-item:has-text("Maria") .conversation-name');
  const target = await cb.textContent('#details-circle-name');
  check(['Tuesday Bible Study', 'Campus Outreach', 'Campus Readers'].includes(target) && target !== 'Neighborhood Disciples', 'Conversation Box never offers a reading-only Circle', target);

  // ── Turning an activity off and on ──────────────────────────────────────
  await openCircles(alice, '?circle=' + await circleId('Tuesday Bible Study'));
  await alice.click('[data-tab="about"]');
  await alice.uncheck('#act-conversations');
  await shot(alice, 'mobile-390-activities-setting', false);
  await alice.click('#activities-save'); await alice.waitForTimeout(800);
  check(!(await alice.isVisible('#tabs-conversations')) && await sql(`select uses_conversations from public.follow_circles where name='Tuesday Bible Study'`) === 'f', 'Steward turned Conversations off: tab hidden');
  await alice.check('#act-conversations'); await alice.click('#activities-save'); await alice.waitForTimeout(800);
  check(await alice.isVisible('#tabs-conversations'), 'Turned back on: Conversations returns');
  await openCircles(alice, '?circle=' + await circleId('Neighborhood Disciples'));
  await alice.click('[data-tab="about"]');
  check(await alice.isDisabled('#act-reading') && !(await alice.isVisible('#activities-save')), 'Members see activities but cannot change them');

  // ── Church: optional, per Circle, never part of the reading ────────────
  const dana = await as('dana', {width: 1280, height: 900});
  await dana.goto(BASE + '/church.html');
  await dana.fill('#church-name', 'Grace Fellowship'); await dana.fill('#church-display', 'Dana');
  await dana.click('#create-church button[type=submit]');
  await dana.waitForSelector('#link-dialog:not([hidden])');
  const churchLink = new URL(await dana.inputValue('#invite-url'));
  await alice.goto(BASE + churchLink.pathname + churchLink.search);
  await alice.waitForSelector('#link-form:not([hidden])');
  await alice.selectOption('#link-circle', await circleId('Campus Outreach'));
  await alice.click('#link-form button[type=submit]');
  await alice.waitForFunction(() => document.getElementById('notice').textContent.startsWith('Linked'), null, {timeout: 5000}).catch(() => {});
  await openCircles(alice);
  const rows2 = await alice.$$eval('#circle-list .circle-card', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  check(rows2.some((r) => r.includes('Campus Outreach') && r.includes('Grace Fellowship')) && rows2.filter((r) => r.includes('Grace Fellowship')).length === 1, 'Only the connected Circle shows its church', rows2);
  await shot(alice, 'mobile-390-your-circles-church');
  await openReading(alice);
  check(!(await alice.textContent('body')).includes('Grace Fellowship'), 'Church never appears in the daily reading');

  // ── Leaving the daily-reading Circle falls back to the next reading Circle ─
  await sql(`update public.follow_circle_primary set circle_id=(select id from public.follow_circles where name='Neighborhood Disciples') where user_id='${U.alice.id}'`);
  await openCircles(alice, '?circle=' + await circleId('Neighborhood Disciples'));
  await alice.click('[data-tab="about"]');
  await alice.click('#leave-circle'); await alice.waitForTimeout(800);
  check(await primaryOf('alice') === 'Tuesday Bible Study', 'Leaving the daily-reading Circle moved it to the next reading Circle', await primaryOf('alice'));

  // ── Day 365 ────────────────────────────────────────────────────────────
  await sql(`update public.follow_circles set start_day=360,start_on=current_date-10 where name='Campus Readers'`);
  await openCircles(alice);
  check((await alice.textContent('#circle-list')).includes('Finished Day 365'), 'Finished Circles stay listed and say so');
  await openReading(alice, '?circle=' + await circleId('Campus Readers'));
  await alice.waitForFunction(() => document.getElementById('day-label').textContent.includes('Day 365'), null, {timeout: 5000}).catch(() => {});
  check((await alice.textContent('#day-label')).includes('Day 365') && await alice.isVisible('#following-finished-actions'), 'Finished Circle opens on Day 365 with next steps', {label: await alice.textContent('#day-label'), finished: await alice.isVisible('#following-finished-actions'), switcher: await alice.textContent('#reading-switch-btn'), url: alice.url()});

  // ── Privacy: Bob never sees Alice’s other Circles ──────────────────────
  await openCircles(bob);
  const bobText = await bob.textContent('#circle-list');
  check(!bobText.includes('Tuesday Bible Study') && !bobText.includes('Campus Outreach'), 'Separate groups stay separate');
} finally {
  const circleErrors = log.filter((x) => x.error && /follow_|conversation_people/.test(x.body.rpc || x.body.table || '')).map((x) => (x.body.rpc || x.body.table) + ': ' + x.error.message);
  check(pageErrors.length === 0, 'No page errors', pageErrors);
  check(circleErrors.length === 0, 'No rejected Circle calls', circleErrors);
  await browser.close(); server.close();
  console.log(failures ? failures + ' FAILED' : 'UNIFIED CIRCLES E2E PASSED');
  process.exitCode = failures ? 1 : 0;
}
