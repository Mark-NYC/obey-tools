// Two-browser live-facilitation flow test. Drives the real, unmodified test
// pages (hope-for-the-rejected-live-test.html + live-join-test.html) in
// separate Chromium contexts — one facilitator, one participant — against the
// local live mock (mock-server.js on :8788).
//
// Run:  node mock-server.js &   then   node run.js
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const STUB = fs.readFileSync(path.join(__dirname, 'supabase-stub.js'), 'utf8');
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.css': 'text/css', '.ico': 'image/x-icon', '.jpg': 'image/jpeg' };

const staticServer = http.createServer((req, res) => {
  let p = new URL(req.url, 'http://x').pathname;
  if (p === '/') p = '/index.html';
  const file = path.join(REPO, p);
  if (!file.startsWith(REPO) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}\n    ${detail}\n`);
}
async function reset() { await fetch('http://127.0.0.1:8788/reset'); }
async function mockState() { return (await (await fetch('http://127.0.0.1:8788/state')).json()); }

async function newContext(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 820 } });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('console', (m) => fs.appendFileSync(path.join(SHOTS, `console-${label}.log`), m.text() + '\n'));
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('https://cdn.jsdelivr.net/npm/@supabase/supabase-js')) return route.fulfill({ contentType: 'text/javascript', body: STUB });
    if (u.startsWith('https://cdn.jsdelivr.net/npm/qrcode-generator')) return route.abort(); // exercise graceful QR fallback
    if (u.startsWith('http://127.0.0.1:8081') || u.startsWith('http://127.0.0.1:8788')) return route.continue();
    if (u.startsWith('https://') || u.startsWith('http://')) return route.abort();
    return route.continue();
  });
  return { ctx, page };
}
const STORY = 'http://127.0.0.1:8081/hope-for-the-rejected-live-test.html';
const JOIN = 'http://127.0.0.1:8081/live-join-test.html';

async function currentStep(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.accordion-step.current');
    return el ? Number(el.dataset.step) : null;
  });
}
async function openStep(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.accordion-step.open');
    return el ? Number(el.dataset.step) : null;
  });
}
async function visible(page, id) {
  return page.evaluate((i) => { const e = document.getElementById(i); return !!(e && e.offsetParent !== null && getComputedStyle(e).display !== 'none'); }, id);
}
async function waitCurrent(page, n, timeout = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if ((await currentStep(page)) === n) return true; await page.waitForTimeout(120); }
  return false;
}

(async () => {
  staticServer.listen(8081);
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

  // --- Facilitator starts a session ---
  await reset();
  const F = await newContext(browser, 'facilitator');
  await F.page.goto(STORY, { waitUntil: 'domcontentloaded' });
  await F.page.waitForTimeout(700);

  const allVisible = await F.page.evaluate(() => document.querySelectorAll('.accordion-step').length);
  record('Entire 3/3 process visible as one list (8 parts)', allVisible === 8, `rendered ${allVisible} process rows`);

  const noProgressUI = await F.page.evaluate(() =>
    !document.querySelector('.progress-bar') && !document.querySelector('.complete-step-btn') && !document.querySelector('.reset-section'));
  record('No per-item completion / progress / reset UI', noProgressUI, `progress bar/complete/reset absent = ${noProgressUI}`);

  await F.page.click('#facilitateBtn');
  await F.page.waitForTimeout(700);
  const shareOpen = await F.page.evaluate(() => document.getElementById('sharePopup').classList.contains('active'));
  const code = (await F.page.textContent('#shareCode')).trim();
  const validCode = /^[ABCDEFGHJKMNPQRSTUVWXYZ2346789]{4}$/.test(code);
  record('Start opens the share overlay once, with a valid 4-char code (safe alphabet)', shareOpen && validCode, `overlayOpen=${shareOpen}, code="${code}"`);
  const st = await mockState();
  const sid = st.sessions[0] && st.sessions[0].id;
  await F.page.screenshot({ path: path.join(SHOTS, 'facilitator-share-overlay.png') });

  // QR is hidden until asked for.
  const qrHiddenFirst = !(await F.page.evaluate(() => { const b = document.getElementById('shareQr'); return b && !b.hidden; }));
  await F.page.click('#qrToggleBtn');
  await F.page.waitForTimeout(500);
  const qrShownNow = await F.page.evaluate(() => { const b = document.getElementById('shareQr'); return !!(b && !b.hidden && (b.querySelector('img') || b.querySelector('.share-qr-fallback'))); });
  record('QR is behind a tap: hidden by default, revealed by Show QR (image or offline fallback)', qrHiddenFirst && qrShownNow, `hiddenByDefault=${qrHiddenFirst}, shownAfterTap=${qrShownNow}`);

  // Dismiss the overlay -> bare facilitating screen.
  await F.page.click('.share-done');
  await F.page.waitForTimeout(300);
  const overlayClosed = !(await F.page.evaluate(() => document.getElementById('sharePopup').classList.contains('active')));
  const facUiClean = !(await visible(F.page, 'facilitateBtn')) && !(await visible(F.page, 'followingLabel'))
    && (await visible(F.page, 'facilitatorBar')) && (await visible(F.page, 'inviteChip')) && overlayClosed;
  record('Bare facilitating screen: no start btn/label; controls + invite chip; overlay dismissed', facUiClean,
    `overlayClosed=${overlayClosed}, barShown=${await visible(F.page, 'facilitatorBar')}, chipShown=${await visible(F.page, 'inviteChip')}`);
  const chipCode = (await F.page.textContent('#inviteCode')).trim();
  record('Invite chip carries the live join code', chipCode === code, `chip="${chipCode}" code="${code}"`);
  await F.page.screenshot({ path: path.join(SHOTS, 'facilitator-bare.png') });

  // --- Participant joins via direct link (?s=) ---
  const P = await newContext(browser, 'participant');
  await P.page.goto(STORY + '?s=' + sid, { waitUntil: 'domcontentloaded' });
  await P.page.waitForTimeout(700);
  const followerLabel = await visible(P.page, 'followingLabel');
  const noFacBtnP = !(await visible(P.page, 'facilitateBtn')) && !(await visible(P.page, 'facilitatorBar')) && !(await visible(P.page, 'shareToggle'));
  record('Participant joins via direct link: sees "following" label, no facilitator controls',
    followerLabel && noFacBtnP && (await currentStep(P.page)) === 1, `following=${followerLabel}, noFacControls=${noFacBtnP}, current=${await currentStep(P.page)}`);

  // --- Facilitator Next -> participant updates live ---
  await F.page.click('#facNext');
  const gotNext = await waitCurrent(P.page, 2);
  record('Facilitator Next updates participant device live', gotNext, `participant current=${await currentStep(P.page)} (expected 2)`);
  const pOpen = await openStep(P.page);
  record('Current part expands inline for participant', pOpen === 2, `participant open step=${pOpen}`);

  // --- Facilitator taps an arbitrary row (step 5) -> participant follows ---
  await F.page.click('.accordion-step[data-step="5"] .accordion-trigger');
  const gotTap = await waitCurrent(P.page, 5);
  record('Facilitator tapping a process row sets it current for everyone', gotTap, `participant current=${await currentStep(P.page)} (expected 5)`);

  // --- Participant cannot change the shared highlight ---
  await P.page.click('.accordion-step[data-step="1"] .accordion-trigger');
  await P.page.waitForTimeout(400);
  const stillFive = (await currentStep(P.page)) === 5 && (await currentStep(F.page)) === 5 && (await mockState()).sessions[0].current_step === 5;
  record('Participant cannot change the shared highlight', stillFive, `after participant tap: current still 5 = ${stillFive}`);

  // --- Participant refresh reconnects to the active session ---
  await P.page.reload({ waitUntil: 'domcontentloaded' });
  await P.page.waitForTimeout(700);
  record('Refresh reconnects participant to the active session', (await currentStep(P.page)) === 5, `after reload current=${await currentStep(P.page)}`);

  // --- Second participant joins via the short-code join page ---
  const P2 = await newContext(browser, 'participant2');
  await P2.page.goto(JOIN, { waitUntil: 'domcontentloaded' });
  await P2.page.waitForTimeout(500);
  await P2.page.fill('#codeInput', code);
  await P2.page.click('#joinBtn');
  await P2.page.waitForURL('**/hope-for-the-rejected-live-test.html?s=*', { timeout: 5000 });
  await P2.page.waitForTimeout(700);
  record('Participant joins via 4-char code page and lands on the story',
    (await currentStep(P2.page)) === 5, `code-join current=${await currentStep(P2.page)} (expected 5)`);

  // --- Facilitator refresh reconnects (real code re-shown) ---
  await F.page.reload({ waitUntil: 'domcontentloaded' });
  await F.page.waitForTimeout(700);
  const facReconnect = (await visible(F.page, 'facilitatorBar')) && (await visible(F.page, 'inviteChip')) && (await currentStep(F.page)) === 5;
  const noAutoOverlay = !(await F.page.evaluate(() => document.getElementById('sharePopup').classList.contains('active')));
  const reCode = (await F.page.textContent('#inviteCode')).trim();
  record('Facilitator refresh reconnects: controls + invite chip with real code, no auto-overlay', facReconnect && reCode === code && noAutoOverlay,
    `barShown=${facReconnect}, chipCode="${reCode}" (expected "${code}"), overlayClosed=${noAutoOverlay}`);

  // --- Previous works ---
  await F.page.click('#facPrev');
  record('Facilitator Previous works', await waitCurrent(P.page, 4), `participant current=${await currentStep(P.page)} (expected 4)`);

  // --- Done -> report popup with validation ---
  await F.page.click('#facDone');
  await F.page.waitForTimeout(300);
  const popupOpen = await F.page.evaluate(() => document.getElementById('reportPopup').classList.contains('active'));
  record('Done opens the two-number reporting popup', popupOpen, `popup active=${popupOpen}`);

  // goal > present must be blocked
  await F.page.fill('#reportPresent', '5');
  await F.page.fill('#reportGoal', '7');
  await F.page.dispatchEvent('#reportGoal', 'change');
  await F.page.waitForTimeout(200);
  const blocked = await F.page.evaluate(() => document.getElementById('reportSave').disabled && !document.getElementById('reportError').hidden);
  record('Goal count cannot exceed attendance (save blocked + error shown)', blocked, `save disabled + error = ${blocked}`);

  // valid numbers -> save ends session
  await F.page.fill('#reportGoal', '3');
  await F.page.dispatchEvent('#reportGoal', 'change');
  await F.page.waitForTimeout(150);
  await F.page.click('#reportSave');
  await F.page.waitForTimeout(600);
  const state2 = await mockState();
  const rep = state2.reports[0];
  const reportOk = rep && rep.people_present === 5 && rep.people_set_goal === 3 && state2.sessions[0].status === 'ended';
  record('Saving records the report and ends the session', reportOk, `report=${JSON.stringify(rep)}, status=${state2.sessions[0].status}`);
  await F.page.screenshot({ path: path.join(SHOTS, 'facilitator-ended.png') });

  // participants see a closing state
  await P.page.waitForTimeout(800);
  const closed = await P.page.evaluate(() => { const b = document.getElementById('liveStatusBanner'); return b && !b.hidden && b.textContent.length > 0; });
  record('Participants shown a closing state after the session ends', closed, `participant banner shown=${closed}`);
  await P.page.screenshot({ path: path.join(SHOTS, 'participant-closed.png') });

  // code expired: join page rejects it now
  await P2.page.goto(JOIN, { waitUntil: 'domcontentloaded' });
  await P2.page.waitForTimeout(400);
  await P2.page.fill('#codeInput', code);
  await P2.page.click('#joinBtn');
  await P2.page.waitForTimeout(500);
  const rejected = await P2.page.evaluate(() => document.getElementById('msg').classList.contains('error'));
  record('Ended session code no longer joins', rejected, `join rejected=${rejected}`);

  fs.writeFileSync(path.join(SHOTS, 'results.json'), JSON.stringify(results, null, 2));
  const fails = results.filter((r) => !r.pass);
  console.log(`${results.length - fails.length}/${results.length} checks passed.`);
  await browser.close();
  staticServer.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
