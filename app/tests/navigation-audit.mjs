// Navigation audit: every screen of the app bundle at three iPhone sizes with
// realistic safe-area insets (Chromium reports env() as 0, so the shell's
// inset variables are overridden). For each screen it checks:
//   • top bar present; Home button on every screen except Home
//   • no tab bar
//   • no in-flow content hidden under the bar on first paint
//   • no other fixed UI colliding with the bar
//   • bar touch targets ≥ 44×44 pt and labelled
//   • no horizontal overflow
// and saves a first-screen screenshot per page/size to test-output/nav/.
//
// Run after `npm run build`:  node tests/navigation-audit.mjs
import { createRequire } from 'node:module'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
let chromium
try { ({ chromium } = require('playwright')) } catch { ({ chromium } = require('playwright-core')) }

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WWW = path.join(APP, 'www')
const OUT = path.join(APP, 'test-output/nav')
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

const exists = (f) => fs.existsSync(path.join(WWW, f)) && fs.statSync(path.join(WWW, f)).isFile()
function route(p) { // mirror of ObeyRouter.swift
  if (p === '' || p === '/') return '/index.html'
  if (exists(p)) return p
  if (!path.extname(p)) {
    const t = p.replace(/\/$/, '')
    if (p.endsWith('/') && exists(t + '/index.html')) return t + '/index.html'
    if (exists(t + '.html')) return t + '.html'
    if (exists(t + '/index.html')) return t + '/index.html'
    return '/index.html'
  }
  return null
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }
const server = http.createServer((req, res) => {
  const r = route(decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (!r) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(r)] || 'text/html' })
  fs.createReadStream(path.join(WWW, r)).pipe(res)
})
await new Promise((r) => server.listen(8126, '127.0.0.1', r))
const BASE = 'http://127.0.0.1:8126'

const SIZES = [
  { name: 'se', width: 375, height: 667, sat: 20, sab: 0 },      // iPhone SE
  { name: 'std', width: 390, height: 844, sat: 47, sab: 34 },    // iPhone 13/14
  { name: 'max', width: 430, height: 932, sat: 59, sab: 34 },    // Pro Max, Dynamic Island
]
const pages = fs.readdirSync(WWW).filter((f) => f.endsWith('.html') && f !== '404.html')
  .concat(['bible-study/', 'uco'])

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const failures = []
for (const size of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
  await ctx.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()))
  await ctx.addInitScript(([sat, sab]) => {
    document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style')
      st.textContent = `:root{--oa-sat:${sat}px!important;--oa-sab:${sab}px!important}`
      document.head.appendChild(st)
    })
  }, [size.sat, size.sab])
  for (const file of pages) {
    const page = await ctx.newPage()
    try { await page.goto(`${BASE}/${file}`, { waitUntil: 'load', timeout: 20000 }) } catch {}
    await page.waitForTimeout(1500) // let auth checks settle (signed-out panels appear late)
    const r = await page.evaluate(() => {
      const bar = document.getElementById('oa-bar')
      const out = { bar: !!bar, issues: [] }
      if (!bar) return out
      const bb = bar.getBoundingClientRect()
      out.barBottom = Math.round(bb.bottom)
      out.isHome = document.documentElement.classList.contains('oa-home')
      out.home = !!document.getElementById('oa-home')
      out.tabbar = !!document.querySelector('#oa-tabbar')
      out.overflow = document.documentElement.scrollWidth > innerWidth + 2
      // The bar must be reachable: nothing may cover the Home / Account buttons.
      for (const id of ['oa-home', 'oa-account']) {
        const el = document.getElementById(id); if (!el) continue
        const r = el.getBoundingClientRect()
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        if (!hit || !hit.closest('#oa-bar')) out.issues.push(`#${id} covered by ${hit ? (hit.id ? '#' + hit.id : hit.className || hit.tagName) : 'nothing'}`)
      }
      // Home must show exactly the five tools, in the website's order, and
      // never reveal role-gated buttons (Leader Tools) to a signed-out user.
      if (out.isHome) {
        const visible = [...document.querySelectorAll('.buttons > a')].filter((a) => a.getClientRects().length).map((a) => a.className.split(' ')[1])
        const want = ['btn-conversation', 'btn-stories', 'btn-questions', 'btn-commands', 'btn-church']
        if (visible.join() !== want.join()) out.issues.push('home tools/order: ' + visible.join(', '))
        if (!document.querySelector('.btn-questions').textContent.includes('4-1-1 ')) out.issues.push('4-1-1 label lost its space')
      }
      // Touch targets + labels in the bar.
      for (const el of bar.querySelectorAll('a, button')) {
        const b = el.getBoundingClientRect()
        if (b.width < 44 || b.height < 44) out.issues.push(`bar target ${el.id} ${Math.round(b.width)}×${Math.round(b.height)}`)
        if (!(el.getAttribute('aria-label') || el.textContent.trim())) out.issues.push(`bar control ${el.id} has no label`)
      }
      // In-flow content under the bar at first paint.
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      let minTop = Infinity, culprit = ''
      while (walker.nextNode()) {
        const n = walker.currentNode, p = n.parentElement
        if (!n.textContent.trim() || !p || p.closest('#oa-bar, script, style, [aria-hidden=true]')) continue
        let fixed = false
        for (let e = p; e; e = e.parentElement) { const pos = getComputedStyle(e).position; if (pos === 'fixed' || pos === 'sticky') { fixed = true; break } }
        if (fixed) continue
        const rng = document.createRange(); rng.selectNodeContents(n)
        const rect = rng.getBoundingClientRect()
        if (!rect.height || rect.bottom < 0 || getComputedStyle(p).visibility === 'hidden') continue
        if (rect.top < minTop) { minTop = rect.top; culprit = n.textContent.trim().slice(0, 30) }
      }
      out.firstText = Math.round(minTop)
      if (minTop < bb.bottom - 1) out.issues.push(`content under bar: "${culprit}" at y=${Math.round(minTop)} (bar ends ${Math.round(bb.bottom)})`)
      // Other visible fixed UI colliding with the bar (full-screen layers excluded).
      for (const el of document.querySelectorAll('body *')) {
        if (el.closest('#oa-bar')) continue
        const cs = getComputedStyle(el)
        if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue
        const b = el.getBoundingClientRect()
        if (!b.width || !b.height) continue
        const fullScreen = b.width >= innerWidth - 1 && b.height >= innerHeight - 1
        if (fullScreen || b.top >= bb.bottom - 1 || b.bottom <= 0) continue
        if (!el.textContent.trim() && !el.querySelector('svg,img')) continue
        if (+cs.zIndex > 1400) continue // overlays above the bar (open modals) are fine
        out.issues.push(`fixed ${el.id ? '#' + el.id : el.className ? '.' + String(el.className).split(' ')[0] : el.tagName} overlaps bar (top ${Math.round(b.top)})`)
      }
      return out
    }).catch((e) => ({ bar: false, issues: ['eval: ' + e.message] }))

    const problems = [...(r.issues || [])]
    if (!r.bar) problems.unshift('no top bar')
    if (r.tabbar) problems.push('tab bar present')
    if (r.bar && !r.isHome && !r.home) problems.push('no Home button')
    if (r.overflow) problems.push('horizontal overflow')
    await page.screenshot({ path: path.join(OUT, `${size.name}-${file.replace(/\W+/g, '_')}.png`) })
    if (problems.length) { failures.push(`${size.name} ${file}`); console.log(`FAIL ${size.name.padEnd(4)} ${file}\n       ${problems.join('\n       ')}`) }
    else console.log(`PASS ${size.name.padEnd(4)} ${file}  (bar ends ${r.barBottom}, content starts ${r.firstText})`)
    await page.close()
  }
  await ctx.close()
}

// ── Home parity with the website: same tools, order, labels, colours ─────
{
  const SITE = path.resolve(APP, '..')
  const site = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html'
    const f = path.join(SITE, p)
    if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/html' }); fs.createReadStream(f).pipe(res)
  })
  await new Promise((r) => site.listen(8127, '127.0.0.1', r))
  const read = async (url) => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 } })
    await c.route('**/*', (r) => { const u = r.request().url(); if (u.includes('supabase-js')) return r.fulfill({ contentType: 'text/javascript', body: 'export function createClient(){return {auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:null})})}}' }); return u.startsWith('http://127.0.0.1') ? r.continue() : r.abort() })
    const pg = await c.newPage(); await pg.goto(url); await pg.waitForTimeout(900)
    const v = await pg.evaluate(() => [...document.querySelectorAll('.buttons > a')].filter((a) => a.getClientRects().length).map((a) => {
      const cs = getComputedStyle(a); return { label: a.textContent.replace(/\s+/g, ' ').trim(), href: a.getAttribute('href'), bg: cs.backgroundColor, ink: cs.color, border: cs.borderTopColor }
    }))
    await c.close(); return v
  }
  const web = await read('http://127.0.0.1:8127/index.html')
  const app = await read(`${BASE}/index.html`)
  const same = JSON.stringify(web) === JSON.stringify(app)
  console.log(`${same ? 'PASS' : 'FAIL'}  Home matches the website: ${app.map((b) => b.label).join(' · ')}`)
  if (!same) { console.log('       web:', JSON.stringify(web), '\n       app:', JSON.stringify(app)); failures.push('home parity') }
  site.close()
}

// ── Interactive navigation checks (390 × 844) ────────────────────────────
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await ctx.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()))
const page = await ctx.newPage()
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures.push(msg) }
const atHome = () => /\/(index(\.html)?)?$/.test(new URL(page.url()).pathname)

// Each of the five tools: open from Home, return with the bar's Home button.
for (const cls of ['btn-conversation', 'btn-stories', 'btn-questions', 'btn-commands', 'btn-church']) {
  await page.goto(`${BASE}/index.html`)
  await page.click(`a.${cls}`)
  await page.waitForLoadState('load')
  await page.waitForTimeout(500)
  const onTool = !atHome()
  await page.click('#oa-home')
  await page.waitForURL(/\/(index(\.html)?)?$/)
  check(onTool && atHome(), `${cls}: opens from Home, Home button returns`)
}

// Nested screen: Commands → Be Baptized → in-tool pill → Commands → Home.
await page.goto(`${BASE}/commands-of-christ.html`)
await page.click('a[href*="be-baptized"]')
await page.waitForURL(/be-baptized/)
await page.click('.top-nav a:not(.oa-dup-home)')
await page.waitForURL(/commands-of-christ/)
await page.click('#oa-home')
await page.waitForURL(/\/(index(\.html)?)?$/)
check(atHome(), 'nested study → in-tool pill → Home works')

// Saved work survives going Home and back (Conversation Box device storage).
await page.goto(`${BASE}/index.html`)
await page.evaluate(() => {
  localStorage.setItem('onboarding-seen', '1'); localStorage.setItem('onboarding-safety-seen', '1')
  localStorage.setItem('user-name', 'Test')
  localStorage.setItem('conversations', JSON.stringify({ casual: [{ name: 'Maria' }], meaningful: [], discovery: [], spiritual: [] }))
})
await page.goto(`${BASE}/conversation-box.html`)
await page.waitForTimeout(800)
await page.click('#oa-home'); await page.waitForURL(/\/(index(\.html)?)?$/)
await page.click('a.btn-conversation'); await page.waitForTimeout(800)
const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('conversations')).casual.some((p) => p.name === 'Maria') && document.body.textContent.includes('Maria'))
check(kept, 'Conversation Box data intact after Home and back')

// Unsaved typing → confirm before leaving; cancelling keeps the text.
await page.fill('#new-person-name', 'Jonah')
let asked = false
page.once('dialog', (d) => { asked = true; d.dismiss() })
await page.click('#oa-home'); await page.waitForTimeout(400)
check(asked && /conversation-box/.test(page.url()) && (await page.inputValue('#new-person-name')) === 'Jonah', 'unsaved text: Home asks first; Cancel keeps the text')
page.once('dialog', (d) => d.accept())
await page.click('#oa-home'); await page.waitForURL(/\/(index(\.html)?)?$/)
check(atHome(), 'unsaved text: confirming leaves')
await page.evaluate(() => localStorage.clear())

// Account and Settings from the bar.
await page.goto(`${BASE}/index.html`); await page.waitForTimeout(500)
await page.click('#oa-account'); await page.waitForTimeout(300)
const overlayOpen = await page.evaluate(() => document.getElementById('auth-section')?.classList.contains('open'))
const overlayAbove = await page.evaluate(() => { const r = document.getElementById('oa-account').getBoundingClientRect(); const el = document.elementFromPoint(r.x + 20, r.y + 20); return !el.closest('#oa-bar') })
check(overlayOpen && overlayAbove, 'Account opens the sign-in overlay above the bar')
await page.goto(`${BASE}/3-circles.html`)
await page.click('#oa-account'); await page.waitForURL(/app-settings/)
check(true, 'Account on a page without sign-in box → Settings account section')
await page.goto(`${BASE}/be-baptized.html`)
await page.click('#oa-settings'); await page.waitForURL(/app-settings/)
check(!(await page.$('#oa-settings')) && !!(await page.$('#oa-home')), 'Settings opens from the bar; Settings screen has Home, no duplicate gear')

// 4-1-1 presenter hides the bar; leaving it restores the bar.
await page.goto(`${BASE}/4-questions.html`); await page.waitForTimeout(500)
await page.evaluate(() => document.getElementById('present-btn').click()); await page.waitForTimeout(400)
const hiddenWhilePresenting = await page.evaluate(() => getComputedStyle(document.getElementById('oa-bar')).display === 'none')
await page.keyboard.press('Escape'); await page.waitForTimeout(400)
const back = await page.evaluate(() => !document.body.classList.contains('presenting') && getComputedStyle(document.getElementById('oa-bar')).display !== 'none')
check(hiddenWhilePresenting && back, '4-1-1 presenter hides the bar; exiting restores it')
await page.screenshot({ path: path.join(OUT, 'flow-411-after-present.png') })

// Progress map toolbar sits below the bar (forced visible: needs a leader sign-in).
await page.goto(`${BASE}/view-progress.html`); await page.waitForTimeout(500)
const mapBar = await page.evaluate(() => {
  const t = document.getElementById('mobile-topbar'); if (!t) return null
  document.body.appendChild(t) // its signed-out container is display:none !important
  t.style.display = 'flex'
  return { top: Math.round(t.getBoundingClientRect().top), bar: Math.round(document.getElementById('oa-bar').getBoundingClientRect().bottom), dupHidden: getComputedStyle(t.querySelector('.mobile-home-btn')).display === 'none' }
})
check(mapBar && mapBar.top >= mapBar.bar - 1 && mapBar.dupHidden, `progress map toolbar below bar (${JSON.stringify(mapBar)})`)
await page.screenshot({ path: path.join(OUT, 'flow-map-toolbar.png') })

// RTL + translated labels.
for (const lang of ['ur', 'es']) {
  await page.goto(`${BASE}/be-baptized.html?lang=${lang}`); await page.waitForTimeout(900)
  const r = await page.evaluate(() => ({ label: document.querySelector('.oa-home-label').textContent, dir: document.documentElement.dir, homeX: document.getElementById('oa-home').getBoundingClientRect().x }))
  const ok = r.label && r.label !== 'Home' && (lang !== 'ur' || (r.dir === 'rtl' && r.homeX > 200))
  check(ok, `${lang}: Home label translated ("${r.label}"), ${r.dir.toUpperCase()} layout`)
  await page.screenshot({ path: path.join(OUT, `flow-${lang}-be-baptized.png`) })
  await page.goto(`${BASE}/index.html?lang=${lang}`); await page.waitForTimeout(700)
  await page.screenshot({ path: path.join(OUT, `flow-${lang}-home.png`) })
}
await page.evaluate(() => localStorage.setItem('obeytools_lang', 'en'))
await ctx.close()

await browser.close()
server.close()
console.log(`\n${pages.length} screens × ${SIZES.length} sizes. Screenshots: test-output/nav/`)
if (failures.length) { console.log(`${failures.length} FAILED`); process.exit(1) }
console.log('ALL PASS')
