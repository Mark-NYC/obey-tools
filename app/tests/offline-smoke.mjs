// Offline smoke test for the iOS web bundle (app/www).
//
// Serves www/ with the SAME path rules as the native ObeyRouter.swift
// (extensionless → .html, folder → index.html) and blocks every request that
// leaves the device, i.e. simulates airplane mode. Then, in an iPhone-sized
// WebKit-like viewport, it opens every page and asserts:
//   • no uncaught script errors
//   • no missing bundled files (404s)
//   • the native shell mounted, and the tab bar appears exactly on hub pages
//   • nothing overflows the phone width
//
// Uses Playwright's Chromium (pre-installed in CI / cloud sessions). This is
// NOT a substitute for testing on a real iPhone or the iOS Simulator.
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
const OUT = path.join(APP, 'test-output')
fs.mkdirSync(OUT, { recursive: true })
if (!fs.existsSync(path.join(WWW, 'index.html'))) { console.error('Run `npm run build` first.'); process.exit(1) }

// Mirror of ios/App/App/ObeyRouter.swift — keep in sync.
function route(p) {
  const exists = (f) => fs.existsSync(path.join(WWW, f)) && fs.statSync(path.join(WWW, f)).isFile()
  if (p === '' || p === '/') return '/index.html'
  if (exists(p)) return p
  if (!path.extname(p)) {
    const trimmed = p.replace(/\/$/, '')
    // Like GitHub Pages: "/x/" is the folder index, "/x" prefers x.html.
    if (p.endsWith('/') && exists(trimmed + '/index.html')) return trimmed + '/index.html'
    if (exists(trimmed + '.html')) return trimmed + '.html'
    if (exists(trimmed + '/index.html')) return trimmed + '/index.html'
    return '/index.html'
  }
  return null
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ico': 'image/x-icon' }

const missing = []
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const r = route(p)
  if (!r || !path.join(WWW, r).startsWith(WWW)) { missing.push(p); res.writeHead(404); return res.end() }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(r)] || (path.extname(r) ? 'application/octet-stream' : 'text/html') })
  fs.createReadStream(path.join(WWW, r)).pipe(res)
})
await new Promise((r) => server.listen(8123, '127.0.0.1', r))
const BASE = 'http://127.0.0.1:8123'

const pages = fs.readdirSync(WWW).filter((f) => f.endsWith('.html') && f !== '404.html')
  .concat(['bible-study/', 'stories-of-hope/', 'band/', 'uco', 'commands-of-christ', 'conversation-box'])
const HUBS = new Set(['index.html', 'commands-of-christ.html', 'commands-of-christ', 'stories-of-hope.html', 'stories-of-hope/', 'signs-of-john.html', 'app-settings.html'])
const SHOTS = new Set(['index.html', 'commands-of-christ.html', 'be-baptized.html', 'stories-of-hope.html', 'app-settings.html', '4-questions.html', '3-circles.html', 'conversation-box.html'])

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true })
let external = 0
await context.route('**/*', (r) => {
  if (r.request().url().startsWith(BASE)) return r.continue()
  external++
  return r.abort('internetdisconnected')
})
await context.setOffline(false) // local server must stay reachable; externals are aborted above

// Bugs that also occur on the live website (same code, mobile emulation), not
// introduced by the app build. Reported, not hidden: they print as KNOWN.
const KNOWN_SITE_ISSUES = {
  'conversation-box': /Cannot read properties of undefined \(reading 'length'\)/,
}
const failures = []
const known = []
for (const file of pages) {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const before = missing.length
  try {
    await page.goto(`${BASE}/${file}`, { waitUntil: 'load', timeout: 20000 })
    await page.waitForTimeout(600)
  } catch (e) { errors.push('navigation: ' + e.message) }
  if (await page.evaluate(() => !!document.querySelector('meta[http-equiv="refresh"]')).catch(() => true)) { await page.close(); continue }
  const r = await page.evaluate(() => ({
    shell: document.documentElement.classList.contains('oa-app') && !!document.getElementById('oa-status-scrim'),
    tabbar: !!document.getElementById('oa-tabbar'),
    overflow: document.documentElement.scrollWidth > innerWidth + 2,
  })).catch((e) => ({ evalError: e.message }))
  const problems = []
  if (r.evalError) problems.push(r.evalError)
  if (!r.shell) problems.push('native shell not mounted')
  if (r.tabbar !== HUBS.has(file)) problems.push(`tab bar ${r.tabbar ? 'unexpected' : 'missing'}`)
  if (r.overflow) problems.push('horizontal overflow at 390px')
  const knownRe = KNOWN_SITE_ISSUES[file.replace(/\.html$/, '')]
  const realErrors = errors.filter((m) => !(knownRe && knownRe.test(m)))
  if (realErrors.length < errors.length) known.push(`${file}: ${errors.filter((m) => knownRe.test(m)).join(' | ')}`)
  if (realErrors.length) problems.push('script errors: ' + realErrors.join(' | '))
  if (missing.length > before) problems.push('missing files: ' + missing.slice(before).join(', '))
  if (SHOTS.has(file)) await page.screenshot({ path: path.join(OUT, file.replace(/\W+/g, '_') + '.png') })
  console.log(`${problems.length ? 'FAIL' : 'PASS'}  ${file}${problems.length ? '\n      ' + problems.join('\n      ') : ''}`)
  if (problems.length) failures.push(file)
  await page.close()
}

// Behaviour checks on the shell itself.
const page = await context.newPage()
await page.goto(`${BASE}/index.html`)
await page.click('#oa-tabbar a[data-tab="commands"]')
await page.waitForURL(/commands-of-christ/)
const active = await page.getAttribute('#oa-tabbar a[aria-current="page"]', 'data-tab')
console.log(`${active === 'commands' ? 'PASS' : 'FAIL'}  tab navigation marks Commands active`)
if (active !== 'commands') failures.push('tab navigation')

const rewritten = await page.evaluate(() => ({
  url: window.ObeyApp.toPublicUrl('/be-baptized.html?x=1'),
  root: window.ObeyApp.toPublicUrl('/index.html'),
}))
const okUrls = rewritten.url === 'https://obey.tools/be-baptized?x=1' && rewritten.root === 'https://obey.tools/'
console.log(`${okUrls ? 'PASS' : 'FAIL'}  shared links point at https://obey.tools (${rewritten.url}, ${rewritten.root})`)
if (!okUrls) failures.push('public URL rewrite')

// The shell must never restyle the website: its tokens stay intact.
const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ot-accent').trim())
console.log(`${accent.toUpperCase() === '#00D084' ? 'PASS' : 'FAIL'}  site design tokens untouched (--ot-accent ${accent})`)
if (accent.toUpperCase() !== '#00D084') failures.push('design tokens')

await page.goto(`${BASE}/app-settings.html`)
const hiddenOk = await page.evaluate(() => ['account-signout', 'account-delete'].every((id) => getComputedStyle(document.getElementById(id)).display === 'none'))
console.log(`${hiddenOk ? 'PASS' : 'FAIL'}  signed-out Settings hides Sign out / Delete account`)
if (!hiddenOk) failures.push('settings signed-out state')

await page.goto(`${BASE}/3-circles.html`)
await page.evaluate(() => { const a = document.createElement('a'); a.href = 'https://obey.tools/gather'; a.id = 'x'; a.textContent = 'x'; document.body.prepend(a) })
await page.click('#x')
await page.waitForURL(/\/gather$/)
console.log('PASS  obey.tools links open the bundled page in-app')

await browser.close()
server.close()
console.log(`\n${pages.length} pages checked offline, ${external} external requests blocked. Screenshots: ${path.relative(process.cwd(), OUT)}/`)
if (known.length) console.log(`KNOWN website issues (pre-existing, not app regressions):\n  ${known.join('\n  ')}`)
if (failures.length) { console.error(`${failures.length} FAILED: ${failures.join(', ')}`); process.exit(1) }
console.log('ALL PASS')
