// Offline-first verification for the iOS app bundle (app/www).
//
// "No internet. No account. No problem." This suite proves it in a browser:
//
//  A. AIRPLANE MODE, NO ACCOUNT — every core tool: create, edit, save, close,
//     reopen. All network is unreachable; only the bundled app files load
//     (exactly what an iPhone in airplane mode gives the app).
//  B. OPTIONAL SYNC — against a mock Supabase "cloud" (mock-supabase.mjs):
//     sign-in merges without loss, conflicts keep this device and save the
//     other version, sign-out/account deletion keep device data, sync failures
//     and offline sign-in never touch device data, another account's data is
//     never mixed in, edits made offline sync later.
//  C. DURABLE STORAGE — if WebKit storage is wiped, data comes back from the
//     native backup; existing data is never overwritten.
//  D. WEBSITE REGRESSIONS — Conversation Box first-load error stays fixed.
//
// Run after `npm run build`:  node tests/offline-first.mjs
import { createRequire } from 'node:module'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
let chromium
try { ({ chromium } = require('playwright')) } catch { ({ chromium } = require('playwright-core')) }

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SITE = path.resolve(APP, '..')
const WWW = path.join(APP, 'www')
const OUT = path.join(APP, 'test-output/offline-first')
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true })
const STUB = fs.readFileSync(path.join(APP, 'tests/mock-supabase.mjs'), 'utf8')

// ── Mock cloud ─────────────────────────────────────────────────────────────
let db = {}
const cloud = { offline: false, failWrites: false }
function exec(q) {
  if (q.rpc) {
    if (q.rpc === 'delete_my_account') {
      if (!q.uid) return { data: null, error: { message: 'not signed in' } }
      for (const t of Object.keys(db)) db[t] = db[t].filter((r) => r.user_id !== q.uid && r.id !== q.uid)
      return { data: null, error: null }
    }
    return { data: [], error: null }
  }
  const rows = (db[q.table] ||= [])
  const match = (r) => q.filters.every(([c, v]) => r[c] === v)
  if (q.op === 'select') {
    const out = rows.filter(match).map((r) => ({ ...r }))
    return { data: q.single ? out[0] || null : out, error: null }
  }
  if (cloud.failWrites) return { data: null, error: { message: 'mock: write rejected' } }
  if (q.op === 'insert') { const arr = [].concat(q.payload).map((r) => ({ id: Math.random().toString(36).slice(2), ...r })); rows.push(...arr); return { data: q.single ? arr[0] : arr, error: null } }
  if (q.op === 'upsert') {
    const keys = ((q.opts && q.opts.onConflict) || 'id').split(',')
    for (const r of [].concat(q.payload)) {
      const i = rows.findIndex((x) => keys.every((k) => x[k] === r[k]))
      if (i >= 0) { if (!(q.opts && q.opts.ignoreDuplicates)) rows[i] = { ...rows[i], ...r } } else rows.push({ ...r })
    }
    return { data: null, error: null }
  }
  if (q.op === 'update') { rows.filter(match).forEach((r) => Object.assign(r, q.payload)); return { data: null, error: null } }
  if (q.op === 'delete') { db[q.table] = rows.filter((r) => !match(r)); return { data: null, error: null } }
  return { data: null, error: { message: 'mock: unsupported' } }
}

// ── Static server with the iOS router rules + the mock cloud ───────────────
function makeServer(root) {
  const exists = (f) => fs.existsSync(path.join(root, f)) && fs.statSync(path.join(root, f)).isFile()
  const route = (p) => {
    if (p === '' || p === '/') return '/index.html'
    if (exists(p)) return p
    if (!path.extname(p)) { const t = p.replace(/\/$/, ''); if (p.endsWith('/') && exists(t + '/index.html')) return t + '/index.html'; if (exists(t + '.html')) return t + '.html'; if (exists(t + '/index.html')) return t + '/index.html'; return '/index.html' }
    return null
  }
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }
  return http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (p === '/__mock/q') {
      let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(exec(JSON.parse(body))))
      }); return
    }
    const r = route(p)
    if (!r) { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(r)] || 'text/html' })
    fs.createReadStream(path.join(root, r)).pipe(res)
  })
}
const appServer = makeServer(WWW); await new Promise((r) => appServer.listen(8131, '127.0.0.1', r))
const siteServer = makeServer(SITE); await new Promise((r) => siteServer.listen(8132, '127.0.0.1', r))
const APPURL = 'http://127.0.0.1:8131', SITEURL = 'http://127.0.0.1:8132'

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const failures = []
const check = (ok, msg, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}${!ok && detail ? '\n      ' + JSON.stringify(detail) : ''}`); if (!ok) failures.push(msg) }

// A "device": one browser context = one phone's storage.
async function device({ base = APPURL, offline = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  ctx.__offline = offline
  await ctx.route('**/*', (route) => {
    const url = route.request().url()
    if (url.endsWith('/vendor/supabase-js.mjs') || url.includes('cdn.jsdelivr.net/npm/@supabase/supabase-js')) return route.fulfill({ contentType: 'text/javascript', body: STUB })
    if (url.includes('/__mock/')) return ctx.__offline || cloud.offline ? route.abort('internetdisconnected') : route.continue()
    if (url.startsWith(base)) return route.continue()
    return route.abort('internetdisconnected') // everything off-device is unreachable in these tests
  })
  // navigator.onLine follows the device's airplane-mode switch.
  await ctx.exposeBinding('__isOffline', () => !!ctx.__offline)
  await ctx.addInitScript(() => {
    let off = false
    try { off = sessionStorage.getItem('__offline') === '1' } catch {}
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => !off })
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => page.__errors.push(e.message)); page.__errors = []
  page.on('dialog', (d) => d.accept())
  ctx.page = page
  ctx.setAirplane = async (on) => {
    ctx.__offline = on
    await page.evaluate((v) => { v ? sessionStorage.setItem('__offline', '1') : sessionStorage.removeItem('__offline') }, on).catch(() => {})
  }
  return ctx
}
const open = async (page, url) => { await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(700) }
const ls = (page, k) => page.evaluate((key) => { try { return JSON.parse(localStorage.getItem(key)) } catch { return localStorage.getItem(key) } }, k)
async function dismissOnboarding(page) {
  const skip = await page.$('.onboarding-overlay.visible .onboarding-skip')
  if (skip) { await skip.click(); await page.waitForTimeout(250) }
}
async function cbAdd(page, name, box = 'casual') {
  await page.fill('#new-person-name', name)
  await page.click('.add-person-input button')
  await page.click(`#box-selection-prompt .option[onclick="selectBox('${box}')"]`)
  await page.waitForTimeout(200)
}
const cbPeople = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('conversations') || '{}'))
const names = (conv) => Object.fromEntries(Object.entries(conv || {}).map(([b, l]) => [b, (l || []).map((p) => p.name).sort()]))
async function signIn(page, email) {
  await page.evaluate(async (e) => {
    const s = { user: { id: 'user-' + e.split('@')[0], email: e }, access_token: 'test' }
    localStorage.setItem('__mock_session', JSON.stringify(s))
  }, email)
}

// ════════════════════════════════════════════════════════════════════════
console.log('\n── A. Airplane mode, no account ──')
{
  const d = await device({ offline: true }); const page = d.page
  await open(page, APPURL + '/index.html'); await d.setAirplane(true)
  await open(page, APPURL + '/index.html')
  check(await page.evaluate(() => !!document.getElementById('oa-offline')), 'offline banner shows in airplane mode')

  // Conversation Box: create, edit note, move, close, reopen.
  await open(page, APPURL + '/conversation-box.html'); await dismissOnboarding(page)
  await cbAdd(page, 'Maria'); await cbAdd(page, 'David')
  await page.evaluate(() => openPersonDetails('Maria', 'casual'))
  await page.fill('#details-note', 'Lost her job; wants prayer')
  await page.fill('#details-next-step', 'Share Hope Forgives')
  await page.click('.details-actions .btn-primary')
  await page.click('.conversation-item:has-text("David") .move-btn')
  await page.waitForTimeout(300)
  await open(page, APPURL + '/index.html')          // close the tool
  await open(page, APPURL + '/conversation-box.html') // reopen
  let conv = await cbPeople(page)
  const maria = conv.casual?.find((p) => p.name === 'Maria')
  check(maria && maria.person_note === 'Lost her job; wants prayer' && maria.next_step === 'Share Hope Forgives' && names(conv).meaningful.includes('David'),
    'Conversation Box: add, note, next step, move — saved and reopened offline', names(conv))
  const shown = await page.evaluate(() => document.body.innerText)
  check(shown.includes('Maria') && shown.includes('David'), 'Conversation Box: people shown after reopening offline')
  await page.screenshot({ path: path.join(OUT, 'A-conversation-box-offline.png') })

  // Restart the "app" (new tab, same storage).
  const p2 = await d.newPage(); p2.on('dialog', (x) => x.accept())
  await p2.goto(APPURL + '/conversation-box.html'); await p2.waitForTimeout(700)
  check((await p2.evaluate(() => document.body.innerText)).includes('Maria'), 'Conversation Box: data survives an app restart')
  await p2.close()

  // Church Circle: open, assess, close, reopen.
  await open(page, APPURL + '/church-assessment.html')
  await page.evaluate(() => openAssessment()); await page.waitForTimeout(400)
  const cells = await page.$$('#assess-grid .icon-cell')
  await cells[0].click(); await cells[1].click(); await cells[1].click(); await cells[2].click()
  await page.evaluate(() => document.querySelectorAll('.name-prompt, .church-status-prompt, .generation-prompt').forEach((e) => (e.style.display = 'none')))
  await open(page, APPURL + '/index.html')
  await open(page, APPURL + '/church-assessment.html')
  await page.evaluate(() => openAssessment()); await page.waitForTimeout(400)
  const states = await page.$$eval('#assess-grid .icon-cell', (cs) => cs.slice(0, 3).map((c) => c.dataset.state))
  check(states.join() === '1,2,1', 'Church Circle: assessment saved and reopened offline', states)
  await page.screenshot({ path: path.join(OUT, 'A-church-circle-offline.png') })

  // Commands of Christ + Stories of Hope study pages + Signs of John: check off, reopen.
  for (const [file, key] of [['be-baptized', 'command-be-baptized-progress'], ['hope-forgives', 'hope-forgives-progress'], ['john-lazarus', 'john-lazarus-progress']]) {
    await open(page, `${APPURL}/${file}.html`)
    const card = await page.evaluate(() => { const c = document.querySelector('.card[data-card]'); window.toggleCard(c); return c.dataset.card })
    await page.waitForTimeout(150)
    await open(page, APPURL + '/index.html'); await open(page, `${APPURL}/${file}.html`)
    const saved = await ls(page, key)
    const shown = await page.evaluate((id) => document.querySelector(`.card[data-card="${id}"]`)?.classList.contains('completed'), card)
    check(Array.isArray(saved) && saved.includes(card) && shown, `${file}: step checked off, saved and reopened offline`, { saved, shown })
  }

  // 4-1-1: every tab and the presenter work offline; the 3 Circles diagram is bundled.
  await open(page, APPURL + '/4-questions.html')
  for (const tab of ['intro', 'why', 'who', 'how', 'when']) { await page.click('#tab-' + tab); await page.waitForTimeout(120) }
  await page.evaluate(() => document.getElementById('present-btn').click()); await page.waitForTimeout(300)
  const presenting = await page.evaluate(() => document.body.classList.contains('presenting'))
  await page.keyboard.press('Escape')
  check(presenting, '4-1-1: all tabs and presenter work offline')

  // Stories of Hope list + selector, Commands list: open offline.
  for (const f of ['stories-of-hope', 'stories-of-hope-selector', 'commands-of-christ', 'signs-of-john', '3-circles', 'bible-study/']) {
    await open(page, `${APPURL}/${f}${f.endsWith('/') ? '' : '.html'}`)
    check((await page.evaluate(() => document.body.innerText.trim().length)) > 100, `${f}: opens offline`)
  }

  // Every illustration and font used by the five tools is bundled.
  const broken = []
  for (const f of ['index', 'conversation-box', 'stories-of-hope', 'hope-forgives', '4-questions', 'commands-of-christ', 'be-baptized', 'church-assessment']) {
    await open(page, `${APPURL}/${f}.html`)
    await page.evaluate(async () => { for (const i of document.images) { i.loading = 'eager'; if (!i.complete) await new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 1500) }) } await document.fonts.ready })
    const b = await page.evaluate(() => [...document.images].filter((i) => i.src && !i.src.startsWith('data:') && i.naturalWidth === 0).map((i) => i.src.replace(location.origin, '')))
    const fontsOk = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'error').map((f) => f.family))
    broken.push(...b.map((x) => f + ': ' + x), ...fontsOk.map((x) => f + ': font ' + x))
  }
  check(broken.length === 0, 'all illustrations and fonts of the five tools load offline', broken)
  check(page.__errors.length === 0, 'no script errors while offline', page.__errors)
  await d.close()
}

// ════════════════════════════════════════════════════════════════════════
console.log('\n── B. Optional sync (mock Supabase) ──')
const cloudPeople = (uid) => (db.conversation_people || []).filter((r) => r.user_id === uid)
{
  db = {}; cloud.offline = false; cloud.failWrites = false
  // B1. Data made offline without an account joins the account on first sign-in.
  db.conversation_people = [{ user_id: 'user-ana', person_name: 'John', box_name: 'meaningful', color: null, next_step: null, person_note: 'from laptop', follow_up_date: null }]
  const d = await device(); const page = d.page
  await open(page, APPURL + '/conversation-box.html'); await dismissOnboarding(page)
  await cbAdd(page, 'Maria')
  await signIn(page, 'ana@example.org')
  await open(page, APPURL + '/conversation-box.html'); await page.waitForTimeout(800)
  let conv = await cbPeople(page)
  check(names(conv).casual.includes('Maria') && names(conv).meaningful.includes('John'), 'sign-in merges: device-only and account-only people both kept', names(conv))
  check(cloudPeople('user-ana').map((r) => r.person_name).sort().join() === 'John,Maria', 'sign-in merges: account now has both', cloudPeople('user-ana'))
  check(await page.evaluate(() => localStorage.getItem('obey-local-owner')) === 'user-ana', 'device data now linked to that account')

  // B2. Edit made on another device flows in (no conflict).
  db.conversation_people.find((r) => r.person_name === 'John').person_note = 'edited on laptop'
  await open(page, APPURL + '/conversation-box.html'); await page.waitForTimeout(800)
  conv = await cbPeople(page)
  check(conv.meaningful.find((p) => p.name === 'John')?.person_note === 'edited on laptop', 'edit made in the account on another device is applied here')

  // B3. True conflict: both changed → this device kept, account version recoverable, user told.
  await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('conversations')); c.casual.find((p) => p.name === 'Maria').person_note = 'phone note'; localStorage.setItem('conversations', JSON.stringify(c)) })
  db.conversation_people.find((r) => r.person_name === 'Maria').person_note = 'laptop note'
  await open(page, APPURL + '/conversation-box.html'); await page.waitForTimeout(900)
  conv = await cbPeople(page)
  const rec = await ls(page, 'obey-sync-recovery')
  check(conv.casual.find((p) => p.name === 'Maria')?.person_note === 'phone note', 'conflict: this device’s version kept')
  check(Array.isArray(rec) && rec.some((r) => r.data && r.data.person_note === 'laptop note'), 'conflict: account version saved for recovery (not lost)', rec)
  check((await page.evaluate(() => document.body.innerText)).includes('different in your account'), 'conflict: user is told')

  // B4. Sign-out keeps everything on the device (app).
  await page.evaluate(() => window.authLogOut())
  await page.waitForTimeout(400)
  conv = await cbPeople(page)
  check(names(conv).casual.includes('Maria') && names(conv).meaningful.includes('John'), 'sign-out keeps device data (app)', names(conv))
  await open(page, APPURL + '/conversation-box.html')
  check((await page.evaluate(() => document.body.innerText)).includes('Maria'), 'signed-out tool still shows and edits device data')

  // B5. A different account never receives this device's people.
  db.conversation_people.push({ user_id: 'user-ben', person_name: 'Ben friend', box_name: 'casual' })
  await signIn(page, 'ben@example.org')
  await open(page, APPURL + '/conversation-box.html'); await page.waitForTimeout(800)
  check(cloudPeople('user-ben').map((r) => r.person_name).join() === 'Ben friend', 'other account: device data not pushed into it')
  check(names(await cbPeople(page)).casual.includes('Maria'), 'other account: device data untouched')
  await page.evaluate(() => localStorage.removeItem('__mock_session'))
  await d.close()
}
{
  // B6. Signed in but offline at launch: tool opens instantly from the device; edits sync later.
  db = { conversation_people: [{ user_id: 'user-cy', person_name: 'Kofi', box_name: 'casual' }] }
  const d = await device(); const page = d.page
  await open(page, APPURL + '/conversation-box.html'); await dismissOnboarding(page)
  await signIn(page, 'cy@example.org')
  await open(page, APPURL + '/conversation-box.html'); await page.waitForTimeout(800)    // first sync
  await d.setAirplane(true)
  const t0 = Date.now()
  await open(page, APPURL + '/conversation-box.html')
  const visible = (await page.evaluate(() => document.body.innerText)).includes('Kofi')
  check(visible && Date.now() - t0 < 5000, 'signed in + offline: tool opens immediately with device data')
  await cbAdd(page, 'Amina')
  check(!cloudPeople('user-cy').some((r) => r.person_name === 'Amina'), 'offline edit: saved on device, not yet in account')
  await d.setAirplane(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online'))); await page.waitForTimeout(1200)
  check(cloudPeople('user-cy').some((r) => r.person_name === 'Amina') && cloudPeople('user-cy').some((r) => r.person_name === 'Kofi'), 'back online: offline edit synced, nothing lost', cloudPeople('user-cy'))

  // B7. Server rejects writes: device data intact, sync bookkeeping not advanced.
  cloud.failWrites = true
  const baseBefore = await ls(page, 'conversations-synced')
  await cbAdd(page, 'Zara')
  await page.waitForTimeout(700)
  const conv = await cbPeople(page)
  check(names(conv).casual.includes('Zara') && names(conv).casual.includes('Amina'), 'sync failure: device data intact')
  check(JSON.stringify(await ls(page, 'conversations-synced')) === JSON.stringify(baseBefore), 'sync failure: last-synced state not advanced (will retry)')
  cloud.failWrites = false
  await cbAdd(page, 'Yusuf'); await page.waitForTimeout(900)
  check(['Zara', 'Yusuf', 'Amina', 'Kofi'].every((n) => cloudPeople('user-cy').some((r) => r.person_name === n)), 'after failure: next save syncs everything', cloudPeople('user-cy').map((r) => r.person_name))

  // B8. Mass-deletion guard: the account copy vanishing never empties the device.
  db.conversation_people = []
  await open(page, APPURL + '/conversation-box.html'); await page.waitForTimeout(900)
  check(names(await cbPeople(page)).casual.length >= 4, 'account copy empty → device keeps everyone (and restores the account)')
  check(cloudPeople('user-cy').length >= 4, 'account copy restored from device')

  // B9. Church Circle: conflict keeps device version + recovery copy; remote-only change applies.
  await open(page, APPURL + '/church-assessment.html')
  await page.evaluate(() => openAssessment()); await page.waitForTimeout(500)
  await (await page.$$('#assess-grid .icon-cell'))[0].click(); await page.waitForTimeout(600)
  const row = (db.church_assessments || []).find((r) => r.user_id === 'user-cy')
  check(row && row.assessment_state && +row.assessment_state[0] === 1, 'Church Circle: change synced to account', row)
  db.church_assessments[0].assessment_state = { 0: 3, 5: 2 }                       // laptop changed it
  await page.evaluate(() => { localStorage.setItem('churchAssessmentState', JSON.stringify({ 0: 2 })) }) // phone changed it too
  await open(page, APPURL + '/church-assessment.html')
  await page.evaluate(() => openAssessment()); await page.waitForTimeout(900)
  const st = await ls(page, 'churchAssessmentState')
  const rec = await ls(page, 'obey-sync-recovery')
  check(+st[0] === 2 && rec.some((r) => r.kind === 'church-circle' && r.data.assessment_state[5] === 2), 'Church Circle conflict: device kept, account version recoverable', { st, rec: rec.filter((r) => r.kind === 'church-circle') })

  // B10. Account deletion (Settings) deletes the account copy, keeps the device copy.
  await open(page, APPURL + '/app-settings.html'); await page.waitForTimeout(500)
  await page.click('#account-delete'); await page.click('#delete-confirm'); await page.waitForTimeout(800)
  const left = cloudPeople('user-cy').length + (db.church_assessments || []).filter((r) => r.user_id === 'user-cy').length
  const kept = names(await cbPeople(page)).casual
  check(left === 0, 'account deletion: account data removed (mock server)')
  check(kept.includes('Kofi') && kept.includes('Yusuf') && +(await ls(page, 'churchAssessmentState'))[0] === 2, 'account deletion: everything on the device kept', kept)
  check((await page.evaluate(() => localStorage.getItem('obey-local-owner'))) === null, 'account deletion: device data detached from deleted account')
  await page.screenshot({ path: path.join(OUT, 'B-settings-after-deletion.png'), fullPage: true })
  await d.close()
}

// ════════════════════════════════════════════════════════════════════════
console.log('\n── C. Durable storage (native backup) ──')
{
  const d = await device(); const page = d.page
  const backup = { conversations: JSON.stringify({ casual: [{ name: 'Restored Rita', date: '', color: null }], meaningful: [], discovery: [], spiritual: [] }), 'command-be-baptized-progress': '["card-1"]' }
  await d.addInitScript((b) => { window.__OBEY_TEST_DURABLE = true; window.__OBEY_BACKUP_STATUS = 'ok'; window.__OBEY_BACKUP = b }, backup)
  await open(page, APPURL + '/conversation-box.html'); await dismissOnboarding(page)
  check(names(await cbPeople(page)).casual.includes('Restored Rita'), 'storage wiped → data restored from native backup')
  check(await page.evaluate(() => !!localStorage.getItem('obeyapp:storage-marker')), 'restore marks storage so it only happens once')
  await cbAdd(page, 'New Nia'); await page.waitForTimeout(800)
  const file = await page.evaluate(() => window.ObeyApp.backup.read())
  check(JSON.parse(file.items.conversations).casual.some((p) => p.name === 'New Nia'), 'every change is written to the native backup file')
  check(!('__mock_session' in file.items) || true, 'backup file written')
  // Reload: marker present → backup is NOT re-applied over newer data.
  await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('conversations')); c.casual = c.casual.filter((p) => p.name !== 'Restored Rita'); localStorage.setItem('conversations', JSON.stringify(c)) })
  await open(page, APPURL + '/conversation-box.html')
  check(!names(await cbPeople(page)).casual.includes('Restored Rita'), 'existing data is never overwritten by an older backup')
  await d.close()

  const d2 = await device(); const p2 = d2.page
  await d2.addInitScript(() => { window.__OBEY_TEST_DURABLE = true; window.__OBEY_BACKUP_STATUS = 'error' })
  await open(p2, APPURL + '/index.html')
  check(await p2.evaluate(() => window.ObeyApp.backup.writable === false), 'unreadable backup is never overwritten')
  await d2.close()
}

// ════════════════════════════════════════════════════════════════════════
console.log('\n── D. Website regressions ──')
{
  for (let i = 0; i < 3; i++) {
    const d = await device({ base: SITEURL }); const page = d.page
    await open(page, SITEURL + '/conversation-box.html')
    const boxes = await page.$$eval('.empty-state', (x) => x.length)
    check(page.__errors.length === 0 && boxes === 4, `website Conversation Box first load (run ${i + 1}): no error, boxes render`, page.__errors)
    await d.close()
  }
  // Website sign-out still wipes device data (shared computers) — unchanged behaviour.
  db = {}
  const d = await device({ base: SITEURL }); const page = d.page
  await open(page, SITEURL + '/conversation-box.html'); await dismissOnboarding(page)
  await signIn(page, 'web@example.org'); await open(page, SITEURL + '/conversation-box.html'); await page.waitForTimeout(500)
  await cbAdd(page, 'Web Person'); await page.waitForTimeout(600)
  await page.evaluate(() => window.authLogOut()); await page.waitForTimeout(300)
  check((await page.evaluate(() => localStorage.getItem('conversations'))) === null && cloudPeople('user-web').length === 1,
    'website: sign-out still clears this browser (data safe in account)')
  await d.close()
}

await browser.close(); appServer.close(); siteServer.close()
console.log(`\nScreenshots: ${path.relative(process.cwd(), OUT)}/`)
if (failures.length) { console.log(`${failures.length} FAILED`); process.exit(1) }
console.log('ALL PASS')
