// Regression tests for the /band dashboard's non-negotiable reliability behavior.
//
// Each requirement (R1–R10) asserts the REQUIRED behavior. Against the legacy
// single-JSON-row implementation R1–R7 failed; the per-city rework must keep
// all of them green. The tests drive the real, unmodified band.html in
// multiple simultaneous Chromium sessions against mock-server.js (per-city
// schema, atomic RPCs, change feed); supabase-stub.js replaces the CDN
// supabase-js module and fakes an already-signed-in leader session. Real RLS
// enforcement is proven separately in supabase/band-migration/91_security_tests.sql.
// After every scenario the assertions check DATABASE state, not the display.
//
// Run:  node mock-server.js &   then   node run.js     (or: npm test)
// Exit code is non-zero if any requirement fails.
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const STUB = fs.readFileSync(path.join(__dirname, 'supabase-stub.js'), 'utf8');
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.css': 'text/css', '.woff2': 'font/woff2' };

const staticServer = http.createServer((req, res) => {
  let p = new URL(req.url, 'http://x').pathname;
  if (p === '/') p = '/band.html';
  const file = path.join(REPO, p);
  if (!file.startsWith(REPO) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('nf');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}\n    ${detail}\n`);
}

async function mock(pathname) {
  return (await fetch('http://127.0.0.1:8787' + pathname)).json();
}
async function seed(cities) {
  await fetch('http://127.0.0.1:8787/seed', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cities }),
  });
}
async function dbCity(name) {
  const { row } = await mock('/state');
  return (row.cities || []).find((c) => c.name === name);
}
async function currentVersion() { return (await mock('/state')).version; }
async function waitForVersion(min, timeoutMs = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if ((await currentVersion()) >= min) return;
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error('timed out waiting for db version ' + min);
}

function seedCities() {
  return [
    { name: 'Austin', leaders: [{ name: 'Jamie', postHistory: {} }], baptismsYTD: 5, churchesYTD: 3, streamDepth: '2nd Gen', totalChurches: 3, totalStreamDepth: '2nd Gen' },
    { name: 'Boston', leaders: [{ name: 'Riley', postHistory: {} }], baptismsYTD: 5, churchesYTD: 2, streamDepth: '1st Gen', totalChurches: 2, totalStreamDepth: '1st Gen' },
  ];
}

async function newSession(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 820 } });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('console', (m) => fs.appendFileSync(path.join(SHOTS, `console-${label}.log`), m.text() + '\n'));
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('https://cdn.jsdelivr.net/npm/@supabase/supabase-js')) {
      return route.fulfill({ contentType: 'text/javascript', body: STUB });
    }
    if (u.startsWith('http://127.0.0.1:8080') || u.startsWith('http://127.0.0.1:8787')) return route.continue();
    return route.abort();
  });
  return { ctx, page };
}

// The realtime stub polls every 150ms, so 'networkidle' never settles — wait
// for the leader gate to open and the city table to render instead.
async function waitReady(page) {
  await page.waitForSelector('#main-container', { state: 'visible', timeout: 8000 });
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('#cityTableBody tr');
    return rows.length > 0 && !/Loading/.test(rows[0].textContent);
  }, { timeout: 8000 });
  await page.waitForTimeout(300);
}
async function load(page) {
  await page.goto('http://127.0.0.1:8080/band.html', { waitUntil: 'domcontentloaded' });
  await waitReady(page);
}
async function reloadPage(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitReady(page);
}
async function openCity(page, city) {
  await page.click(`tr:has(td.city-name:text-is("${city}")) button.update-btn`);
  await page.waitForTimeout(150);
}
async function back(page) { await page.click('.back-btn-inline'); await page.waitForTimeout(200); }
const PLUS = `button[onclick="updateCityCounter('baptismsYTD',1)"]`;
const MINUS = `button[onclick="updateCityCounter('baptismsYTD',-1)"]`;
const STREAM_PLUS = `button[onclick="updateCityStreamDepth(1)"]`;
const overviewBaptisms = (city) => `tr:has(td.city-name:text-is("${city}")) td.metric-number`;

// A visible, human-readable failure indication anywhere on the page.
async function visibleFailureShown(page) {
  return page.evaluate(() => {
    const el = document.getElementById('saveIndicator');
    return el ? getComputedStyle(el).opacity !== '0' && /fail|error|revert|couldn/i.test(el.textContent) : false;
  });
}

(async () => {
  staticServer.listen(8080);
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

  // R1: the header status must reflect REAL connection state — with a working
  // backend and a fresh load it must show live/connected, never "Offline",
  // and without any manual toggle.
  await seed(seedCities());
  const { page: a } = await newSession(browser, 'R1a');
  await load(a);
  await a.waitForFunction(() => /Live/.test(document.getElementById('connStatus')?.textContent || ''), { timeout: 5000 }).catch(() => {});
  const label = await a.textContent('#connStatus');
  await a.screenshot({ path: path.join(SHOTS, 'R1-connection-label.png') });
  record('R1: connected page shows live status automatically (no "Offline", no toggle)',
    /live/i.test(label) && !/offline/i.test(label), `header status reads "${label.trim()}" on a fresh, connected load`);

  // R2: another user's saved update must appear automatically within 5s.
  await seed(seedCities());
  const A = await newSession(browser, 'R2A');
  const B = await newSession(browser, 'R2B');
  await load(A.page); await load(B.page);
  let v = await currentVersion();
  await openCity(A.page, 'Austin');
  await A.page.click(PLUS); // 5 -> 6
  await waitForVersion(v + 1);
  let propagated = false;
  for (let i = 0; i < 25 && !propagated; i++) {
    await B.page.waitForTimeout(200);
    propagated = (await B.page.textContent(overviewBaptisms('Austin'))).trim() === '6';
  }
  await B.page.screenshot({ path: path.join(SHOTS, 'R2-auto-propagation.png') });
  record('R2: other sessions see a saved update automatically within 5s',
    propagated, `session B ${propagated ? 'auto-updated to 6' : 'still shows ' + (await B.page.textContent(overviewBaptisms('Austin'))).trim()} after A's save, with no manual action`);

  // R3: two users incrementing the same metric near-simultaneously -> BOTH
  // increments persist (5 + 1 + 1 = 7).
  await seed(seedCities());
  const C = await newSession(browser, 'R3C');
  const D = await newSession(browser, 'R3D');
  await load(C.page); await load(D.page);
  v = await currentVersion();
  await openCity(C.page, 'Austin');
  await openCity(D.page, 'Austin');
  await Promise.all([C.page.click(PLUS), D.page.click(PLUS)]);
  await waitForVersion(v + 2);
  await C.page.waitForTimeout(800);
  const r3 = (await dbCity('Austin')).baptismsYTD;
  record('R3: simultaneous +1 from two users are both preserved',
    r3 === 7, `Austin baptisms started at 5, two users each added 1; database holds ${r3} (must be 7)`);

  // R4: a persisted decrement (a correction) must survive other users' edits
  // to OTHER cities.
  await seed(seedCities());
  const E = await newSession(browser, 'R4E');
  const F = await newSession(browser, 'R4F');
  await load(E.page); await load(F.page);
  v = await currentVersion();
  await openCity(F.page, 'Boston');
  await F.page.click(MINUS); // 5 -> 4
  await waitForVersion(v + 1);
  const bostonAfterFix = (await dbCity('Boston')).baptismsYTD;
  v = await currentVersion();
  await openCity(E.page, 'Austin');
  await E.page.click(PLUS);
  await waitForVersion(v + 1);
  await E.page.waitForTimeout(800);
  const bostonFinal = (await dbCity('Boston')).baptismsYTD;
  record('R4: a saved decrement is never reverted by an edit to a different city',
    bostonAfterFix === 4 && bostonFinal === 4,
    `Boston corrected 5->4 (db=${bostonAfterFix}); after another user +1'd Austin, Boston db=${bostonFinal} (must stay 4)`);

  // R5: un-marking a leader as posted must survive other users' unrelated edits.
  await seed(seedCities());
  const G = await newSession(browser, 'R5G');
  const H = await newSession(browser, 'R5H');
  await load(G.page); await load(H.page);
  v = await currentVersion();
  await openCity(G.page, 'Austin');
  await G.page.click('#leader-btn-0'); // mark
  await waitForVersion(v + 1);
  await reloadPage(H.page);
  v = await currentVersion();
  await openCity(H.page, 'Austin');
  await H.page.click('#leader-btn-0'); // unmark (confirm auto-accepted)
  await waitForVersion(v + 1);
  v = await currentVersion();
  await back(G.page);
  await openCity(G.page, 'Boston');
  await G.page.click(PLUS);
  await waitForVersion(v + 1);
  await G.page.waitForTimeout(800);
  const jamieVals = Object.values((await dbCity('Austin')).leaders[0].postHistory || {});
  record('R5: un-marking "posted" is never reverted by an unrelated edit',
    jamieVals.every((x) => x !== true),
    `after unmark + another user's unrelated edit, Jamie postHistory values in db: ${JSON.stringify(jamieVals)} (no true allowed)`);

  // R6: a deleted leader must stay deleted through other users' unrelated edits.
  await seed(seedCities());
  const I = await newSession(browser, 'R6I');
  const J = await newSession(browser, 'R6J');
  await load(I.page); await load(J.page);
  v = await currentVersion();
  await openCity(I.page, 'Austin');
  await I.page.click('.delete-leader-btn'); // deletes Jamie (dialog auto-accepted)
  await waitForVersion(v + 1);
  v = await currentVersion();
  await openCity(J.page, 'Boston');
  await J.page.click(PLUS);
  await waitForVersion(v + 1);
  await J.page.waitForTimeout(800);
  const austinLeaders = ((await dbCity('Austin')).leaders || []).map((l) => l.name);
  record('R6: a deleted leader is never resurrected by an unrelated edit',
    !austinLeaders.includes('Jamie'),
    `Austin leaders in db after delete + another user's unrelated edit: ${JSON.stringify(austinLeaders)}`);

  // R7: internet loss during an edit -> the failure must be clearly visible,
  // the database unchanged, and the UI reverted (not presented as saved).
  await seed(seedCities());
  const K = await newSession(browser, 'R7K');
  await load(K.page);
  await openCity(K.page, 'Austin');
  await K.page.route('http://127.0.0.1:8787/**', (r) => r.abort()); // internet drops
  v = await currentVersion();
  await K.page.click(PLUS);
  await K.page.waitForTimeout(1500);
  const failureShown = await visibleFailureShown(K.page);
  const uiValue = (await K.page.textContent('#baptismsCounter')).trim();
  const dbUnchanged = (await dbCity('Austin')).baptismsYTD === 5 && (await currentVersion()) === v;
  await K.page.screenshot({ path: path.join(SHOTS, 'R7-offline-failure-visible.png') });
  record('R7: a failed save is clearly shown and the change reverts; nothing fails silently',
    failureShown && dbUnchanged && uiValue === '5',
    `backend unreachable during +1: visible failure=${failureShown}, db unchanged=${dbUnchanged}, UI reverted to ${uiValue}`);

  // R8: persistence sanity — after an online save, a full page reload shows the
  // saved value (proves it is in the database, not just in the browser).
  await seed(seedCities());
  const L = await newSession(browser, 'R8L');
  await load(L.page);
  v = await currentVersion();
  await openCity(L.page, 'Austin');
  await L.page.click(PLUS);
  await waitForVersion(v + 1);
  await reloadPage(L.page);
  const afterReload = (await L.page.textContent(overviewBaptisms('Austin'))).trim();
  record('R8: a confirmed save survives a full page reload',
    afterReload === '6' && (await dbCity('Austin')).baptismsYTD === 6,
    `after save + reload the page shows ${afterReload} and the database holds ${(await dbCity('Austin')).baptismsYTD}`);

  // R9: reconnection resyncs automatically — a session that was offline while
  // another user saved must show the new data shortly after coming back online.
  await seed(seedCities());
  const M = await newSession(browser, 'R9M');
  const N = await newSession(browser, 'R9N');
  await load(M.page); await load(N.page);
  await M.page.route('http://127.0.0.1:8787/**', (r) => r.abort()); // M loses internet
  v = await currentVersion();
  await openCity(N.page, 'Austin');
  await N.page.click(PLUS); // N saves while M is offline
  await waitForVersion(v + 1);
  await M.page.waitForTimeout(1000);
  const mWhileOffline = (await M.page.textContent(overviewBaptisms('Austin'))).trim();
  await M.page.unroute('http://127.0.0.1:8787/**'); // M's internet returns
  let resynced = false;
  for (let i = 0; i < 25 && !resynced; i++) {
    await M.page.waitForTimeout(200);
    resynced = (await M.page.textContent(overviewBaptisms('Austin'))).trim() === '6';
  }
  record('R9: after reconnecting, a session automatically resyncs missed updates',
    mWhileOffline === '5' && resynced,
    `while offline M showed ${mWhileOffline} (stale, correct); within 5s of reconnect M shows ${resynced ? '6 — resynced' : 'stale data still'}`);

  // R10: every operation type is actually persisted — proven by full reload.
  await seed(seedCities());
  const O = await newSession(browser, 'R10O');
  await load(O.page);
  await openCity(O.page, 'Austin');
  // add leader
  await O.page.click('.add-leader-inline');
  await O.page.fill('#leaderNameInput', 'Nadia');
  v = await currentVersion();
  await O.page.click('.add-leader-form .form-btn.primary');
  await waitForVersion(v + 1);
  // mark new leader posted (Nadia renders second, index 1)
  v = await currentVersion();
  await O.page.click('#leader-btn-1');
  await waitForVersion(v + 1);
  // stream depth up
  v = await currentVersion();
  await O.page.click(STREAM_PLUS);
  await waitForVersion(v + 1);
  // reload and verify everything came back from the database
  await reloadPage(O.page);
  await openCity(O.page, 'Austin');
  const austin = await dbCity('Austin');
  const nadia = (austin.leaders || []).find((l) => l.name === 'Nadia');
  const nadiaPosted = nadia && Object.values(nadia.postHistory || {}).some((x) => x === true);
  const streamShown = (await O.page.textContent('#streamCounter')).trim();
  const leaderCards = await O.page.$$eval('.leader-card', (els) => els.length);
  // unmark, delete leader, verify again
  const nadiaIdx = (austin.leaders || []).findIndex((l) => l.name === 'Nadia');
  v = await currentVersion();
  await O.page.click(`#leader-btn-${nadiaIdx}`); // unmark (confirm auto-accepted)
  await waitForVersion(v + 1);
  v = await currentVersion();
  await O.page.$$eval('.manage-leader-item', (els) => {
    const target = els.find((el) => el.textContent.includes('Nadia'));
    target.querySelector('.delete-leader-btn').click();
  });
  await waitForVersion(v + 1);
  await reloadPage(O.page);
  const austin2 = await dbCity('Austin');
  const nadiaGone = !(austin2.leaders || []).some((l) => l.name === 'Nadia');
  const okR10 = !!nadia && nadiaPosted && streamShown === '3rd Gen' && leaderCards === 2 && nadiaGone
    && austin2.streamDepth === '3rd Gen';
  record('R10: add/mark/stream/unmark/delete each persist through full reloads',
    okR10,
    `after reloads — added leader in db: ${!!nadia}, marked posted: ${!!nadiaPosted}, stream depth shown: ${streamShown}, leader cards: ${leaderCards}, deleted leader gone: ${nadiaGone}, db stream: ${austin2.streamDepth}`);

  fs.writeFileSync(path.join(SHOTS, 'results.json'), JSON.stringify(results, null, 2));
  const fails = results.filter((r) => !r.pass);
  console.log(`${results.length - fails.length}/${results.length} requirements met.`);
  await browser.close();
  staticServer.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
