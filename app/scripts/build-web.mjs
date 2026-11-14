// Builds app/www — the web bundle that ships inside the iOS app.
//
// The website at the repository root stays the single source of truth and is
// never modified by this script. We copy it, then apply app-only transforms to
// the COPY so the bundle works offline inside WKWebView:
//
//   1. Vendor every CDN dependency (supabase-js, html2canvas, qrcode, leaflet)
//      so pages load with no network. Map tiles / Supabase data still need it.
//   2. Strip Google Analytics (keeps the App Store privacy label simple) and
//      the PWA service-worker registration (not supported on custom schemes).
//   3. Add viewport-fit=cover so env(safe-area-inset-*) works.
//   4. Rewrite location.origin to https://obey.tools so auth email redirects
//      and shared links point at the public website, never capacitor://localhost.
//   5. Inject the native shell (tab bar, safe areas, native share, haptics,
//      offline banner, external-link handling) into every page.
//   6. Add app-only pages (Settings).
//
// Fails loudly if any page still references a CDN, so an offline regression
// cannot slip into a release.
import { build } from 'esbuild'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SITE = path.resolve(APP, '..')
const WWW = path.join(APP, 'www')
const NM = path.join(APP, 'node_modules')
const PUBLIC_ORIGIN = 'https://obey.tools'

// Repo content that is not part of the website, or not meant for app users.
const EXCLUDE = new Set([
  'app', '.git', '.github', 'tests', 'supabase', 'scripts', 'docs', 'node_modules',
  'CNAME', 'church-assessment-supabase-prompt.txt', 'google4e6ae98eb033b6e5.html',
  // Unlinked developer test pages for live facilitation.
  'hope-for-the-rejected-live-test.html', 'live-join-test.html',
])

const log = (...a) => console.log('[build-web]', ...a)

// ── 1. Copy the site ──────────────────────────────────────────────────────
fs.rmSync(WWW, { recursive: true, force: true })
fs.mkdirSync(WWW, { recursive: true })
for (const entry of fs.readdirSync(SITE)) {
  if (EXCLUDE.has(entry) || entry.endsWith('.md')) continue
  fs.cpSync(path.join(SITE, entry), path.join(WWW, entry), { recursive: true })
}

// ── 2. Vendor CDN dependencies ────────────────────────────────────────────
const VENDOR = path.join(WWW, 'vendor')
fs.mkdirSync(VENDOR, { recursive: true })
await build({
  stdin: { contents: "export { createClient } from '@supabase/supabase-js'", resolveDir: APP, loader: 'js' },
  bundle: true, format: 'esm', minify: true, target: 'safari15', platform: 'browser',
  outfile: path.join(VENDOR, 'supabase-js.mjs'), logLevel: 'warning',
})
fs.copyFileSync(path.join(NM, 'html2canvas/dist/html2canvas.min.js'), path.join(VENDOR, 'html2canvas.min.js'))
fs.copyFileSync(path.join(NM, 'qrcode-generator/qrcode.js'), path.join(VENDOR, 'qrcode.js'))
fs.cpSync(path.join(NM, 'leaflet/dist'), path.join(VENDOR, 'leaflet'), { recursive: true })

const CDN_MAP = [
  ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.6/+esm', '/vendor/supabase-js.mjs'],
  ['https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js', '/vendor/html2canvas.min.js'],
  ['https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js', '/vendor/qrcode.js'],
  ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', '/vendor/leaflet/leaflet.css'],
  ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', '/vendor/leaflet/leaflet.js'],
]

// ── 3. Build the native shell ─────────────────────────────────────────────
const SHELL_OUT = path.join(WWW, 'app-shell')
fs.mkdirSync(SHELL_OUT, { recursive: true })
await build({
  entryPoints: [path.join(APP, 'native-shell/app-shell.js')],
  bundle: true, format: 'iife', minify: true, target: 'safari15', platform: 'browser',
  outfile: path.join(SHELL_OUT, 'app-shell.js'), logLevel: 'warning',
})
fs.copyFileSync(path.join(APP, 'native-shell/app-shell.css'), path.join(SHELL_OUT, 'app-shell.css'))
for (const page of fs.readdirSync(path.join(APP, 'native-shell/pages'))) {
  fs.copyFileSync(path.join(APP, 'native-shell/pages', page), path.join(WWW, page))
}

// ── 4. Transform pages and scripts ────────────────────────────────────────
const SHELL_TAGS = '<link rel="stylesheet" href="/app-shell/app-shell.css">' +
  '<script src="/app-shell/app-shell.js"></script>'

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!['vendor', 'app-shell', 'assets', 'lang'].includes(e.name)) walk(p, out) }
    else out.push(p)
  }
  return out
}
const isHtml = (p, src) => p.endsWith('.html') || (!path.extname(p) && /^\s*<!DOCTYPE html/i.test(src))

let pages = 0
const problems = []
for (const file of walk(WWW)) {
  const rel = path.relative(WWW, file)
  if (!/\.(html|js|mjs)$/.test(file) && path.extname(file)) continue
  let src = fs.readFileSync(file, 'utf8')
  const orig = src

  for (const [from, to] of CDN_MAP) src = src.split(from).join(to)
  // Public origin for redirects / shared links (see header comment).
  src = src.replace(/\b(?:window\.)?location\.origin\b/g, JSON.stringify(PUBLIC_ORIGIN))
  src = src.replace(/\bwindow\.location\.host\b/g, JSON.stringify(new URL(PUBLIC_ORIGIN).host))

  if (isHtml(file, src)) {
    pages++
    // Google Analytics: the loader tag plus its inline config block.
    src = src.replace(/<!--\s*Google tag \(gtag\.js\)\s*-->\s*/g, '')
    src = src.replace(/<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js[^"]*"><\/script>\s*<script>[\s\S]*?gtag\('config'[^)]*\);?\s*<\/script>/g, '')
    // Safe areas.
    src = src.replace(/<meta([^>]*?)name="viewport"([^>]*)>|<meta([^>]*?)content="([^"]*)"\s+name="viewport"\s*\/?>/g, (m) => {
      if (m.includes('viewport-fit')) return m
      return m.replace(/content="([^"]*)"/, (_, c) => `content="${c}, viewport-fit=cover"`)
    })
    // Inject the shell as early as possible (after <meta charset> when present).
    if (!src.includes('/app-shell/app-shell.js')) {
      if (/<meta charset=[^>]*>/i.test(src)) src = src.replace(/(<meta charset=[^>]*>)/i, `$1${SHELL_TAGS}`)
      else src = src.replace(/<head>/i, `<head>${SHELL_TAGS}`)
      if (!src.includes(SHELL_TAGS)) problems.push(`${rel}: could not inject native shell`)
    }
    if (/googletagmanager\.com/.test(src)) problems.push(`${rel}: Google Analytics not stripped`)
  }
  if (rel === 'pwa.js') src = '// Service worker registration is disabled inside the iOS app (custom URL scheme).\n'

  if (/https:\/\/(cdn\.jsdelivr\.net|unpkg\.com)\//.test(src)) problems.push(`${rel}: still references a CDN`)
  if (src !== orig) fs.writeFileSync(file, src)
}

// ── 5. Build metadata (shown on the Settings screen) ──────────────────────
let commit = 'unknown'
try { commit = execSync('git rev-parse --short HEAD', { cwd: SITE }).toString().trim() } catch {}
const version = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')).version
fs.writeFileSync(path.join(WWW, 'app-build.json'), JSON.stringify({ version, commit, builtAt: new Date().toISOString() }, null, 2))

if (problems.length) {
  console.error('[build-web] FAILED:\n  ' + problems.join('\n  '))
  process.exit(1)
}
log(`OK — ${pages} pages, CDN dependencies vendored, shell injected → ${path.relative(SITE, WWW)}`)
