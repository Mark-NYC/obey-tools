// OBEY.TOOLS native shell — injected into every page of the iOS app bundle by
// scripts/build-web.mjs. Never shipped to the public website.
//
// Responsibilities:
//   • Native tab bar on hub pages, safe-area handling, status-bar styling
//   • Native share sheet for links AND images (navigator.share, <a download>)
//   • Reliable clipboard, haptics, offline banner
//   • External links in an in-app Safari sheet; obey.tools links stay in-app
//   • Daily reminder notifications (scheduled from the Settings screen)
//   • Splash-screen hand-off for a smooth start
//
// Runs as a classic, synchronous script at the top of <head> so API overrides
// exist before page scripts use them. DOM work waits for DOMContentLoaded.
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Clipboard } from '@capacitor/clipboard'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { LocalNotifications } from '@capacitor/local-notifications'
import { Network } from '@capacitor/network'
import { Share } from '@capacitor/share'
import { SplashScreen } from '@capacitor/splash-screen'
import { StatusBar, Style } from '@capacitor/status-bar'

const PUBLIC_ORIGIN = 'https://obey.tools'
const PUBLIC_HOSTS = new Set(['obey.tools', 'www.obey.tools'])
const NATIVE = Capacitor.isNativePlatform()
const root = document.documentElement
root.classList.add('oa-app')
if (NATIVE) root.classList.add('oa-native')

// Analytics are stripped from the app build; keep any stray gtag() calls harmless.
window.dataLayer = window.dataLayer || []
window.gtag = window.gtag || function () {}

// Splash: hide as soon as the first page paints. The timeout is a safety net so
// a script error can never leave the user staring at the splash screen.
const hideSplash = () => { if (NATIVE) SplashScreen.hide({ fadeOutDuration: 180 }).catch(() => {}) }
setTimeout(hideSplash, 2500)

// ── Strings (app-only UI). Falls back to English. ──────────────────────────
const STRINGS = {
  en: {
    home: 'Home', commands: 'Commands', stories: 'Stories', settings: 'Settings',
    tabs: 'App sections',
    offline: 'Offline. Saved tools still work. Sign-in and syncing resume when you reconnect.',
    back_online: 'Back online',
    share_failed: 'Sharing is not available right now.',
    copied: 'Copied',
  },
}
const lang = (() => { try { return localStorage.getItem('obeytools_lang') || 'en' } catch { return 'en' } })()
export const s = (k) => (STRINGS[lang] && STRINGS[lang][k]) || STRINGS.en[k] || k

// ── URL helpers ────────────────────────────────────────────────────────────
// Links produced inside the app must point at the public site, never at
// capacitor://localhost, or they are useless to the person receiving them.
export function toPublicUrl(u) {
  if (!u) return u
  try {
    const url = new URL(u, location.href)
    if (url.origin === location.origin) return PUBLIC_ORIGIN + url.pathname.replace(/\.html$/, '').replace(/\/index$/, '/') + url.search + url.hash
    return url.href
  } catch { return u }
}
const rewriteText = (t) => typeof t === 'string'
  ? t.replace(new RegExp(location.origin.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '(/[^\\s"\'<>]*)?', 'g'), (m) => toPublicUrl(m))
  : t

// A public obey.tools URL → the bundled page, so it works offline and in-app.
function toLocalPath(url) {
  let p = url.pathname || '/'
  if (p === '/') p = '/index.html'
  return p + url.search + url.hash
}

function normalizedPath() {
  let p = location.pathname.replace(/\/index(\.html)?$/, '/').replace(/\.html$/, '')
  if (p.length > 1) p = p.replace(/\/$/, '')
  return p || '/'
}

// ── Haptics ────────────────────────────────────────────────────────────────
let lastTap = 0
export function tap(style = ImpactStyle.Light) {
  if (!NATIVE) return
  const now = Date.now()
  if (now - lastTap < 60) return
  lastTap = now
  Haptics.impact({ style }).catch(() => {})
}

// ── Native share (links and files) ────────────────────────────────────────
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}
const safeName = (n, fallback) => (String(n || fallback).replace(/[^\w.\- ]+/g, '').trim() || fallback)

async function writeShareFile(blob, name) {
  const { uri } = await Filesystem.writeFile({
    path: `share/${Date.now()}-${safeName(name, 'obey-tools')}`,
    data: await blobToBase64(blob),
    directory: Directory.Cache,
    recursive: true,
  })
  return uri
}

const asAbort = (err) => {
  const msg = String(err && (err.message || err)).toLowerCase()
  if (msg.includes('cancel')) return new DOMException('Share canceled', 'AbortError')
  return err
}

export async function nativeShare(data = {}) {
  tap()
  const files = Array.from(data.files || [])
  const opts = {
    title: data.title || document.title,
    text: rewriteText(data.text),
    url: data.url ? toPublicUrl(data.url) : undefined,
    dialogTitle: data.title || document.title,
  }
  try {
    if (files.length) opts.files = await Promise.all(files.map((f, i) => writeShareFile(f, f.name || `obey-tools-${i + 1}.png`)))
    await Share.share(opts)
  } catch (err) {
    throw asAbort(err)
  }
}

if (NATIVE) {
  Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: nativeShare })
  Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: () => true })

  // Clipboard: the WebView API needs focus + user activation and can throw;
  // the native plugin always works. Also rewrites app-internal URLs.
  const clip = navigator.clipboard || {}
  const nativeWriteText = async (text) => { await Clipboard.write({ string: rewriteText(String(text)) }); tap() }
  try {
    Object.defineProperty(clip, 'writeText', { configurable: true, writable: true, value: nativeWriteText })
    if (!navigator.clipboard) Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clip })
  } catch {}

  // window.open → in-app Safari for external URLs, in-app navigation for ours.
  const origOpen = window.open.bind(window)
  window.open = function (u, target, features) {
    if (!u) return origOpen(u, target, features)
    const url = new URL(u, location.href)
    if (PUBLIC_HOSTS.has(url.hostname)) { location.href = toLocalPath(url); return null }
    if (url.origin !== location.origin && /^https?:$/.test(url.protocol)) { Browser.open({ url: url.href }); return null }
    return origOpen(u, target, features)
  }
}

// ── Link handling ──────────────────────────────────────────────────────────
// Bubble phase: page handlers run first and can preventDefault.
document.addEventListener('click', async (e) => {
  if (e.defaultPrevented || e.button !== 0) return
  const a = e.target && e.target.closest && e.target.closest('a[href]')
  if (!a) return
  const href = a.getAttribute('href') || ''
  if (href.startsWith('#') || href.startsWith('javascript:')) return
  let url
  try { url = new URL(a.href, location.href) } catch { return }

  // <a download> does nothing in WKWebView. Offer the share sheet instead,
  // which includes "Save Image" / "Save to Files".
  if (a.hasAttribute('download') && NATIVE) {
    e.preventDefault()
    try {
      const blob = await (await fetch(url.href)).blob()
      const name = a.getAttribute('download') || decodeURIComponent(url.pathname.split('/').pop() || 'obey-tools')
      await nativeShare({ files: [new File([blob], name, { type: blob.type })], title: name })
    } catch (err) {
      if (!(err && err.name === 'AbortError')) toast(s('share_failed'))
    }
    return
  }

  if (!/^https?:$/.test(url.protocol)) return
  if (PUBLIC_HOSTS.has(url.hostname) && !a.hasAttribute('data-oa-external')) {
    e.preventDefault()
    location.href = toLocalPath(url)
    return
  }
  if ((url.origin !== location.origin || a.hasAttribute('data-oa-external')) && NATIVE) {
    e.preventDefault()
    tap()
    Browser.open({ url: url.href, presentationStyle: 'popover' }).catch(() => {})
  }
}, false)

// ── Tab bar ────────────────────────────────────────────────────────────────
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5.5v-6h-5v6H4a1 1 0 0 1-1-1z"/>',
  commands: '<path d="M5 3.5h10.5L19 7v13.5H5z"/><path d="M8.5 9.5h7M8.5 13h7M8.5 16.5h4.5"/>',
  stories: '<path d="M4 5.5C6.5 4 9.5 4 12 5.5 14.5 4 17.5 4 20 5.5V19c-2.5-1.5-5.5-1.5-8 0-2.5-1.5-5.5-1.5-8 0z"/><path d="M12 5.5V19"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"/>',
}

function storiesHref() {
  // Mirrors the website: Ukraine time zones get Signs of John instead.
  let tz = ''
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch {}
  return ['Europe/Kyiv', 'Europe/Kiev', 'Europe/Uzhgorod', 'Europe/Zaporozhye', 'Europe/Simferopol'].includes(tz)
    ? '/signs-of-john.html' : '/stories-of-hope.html'
}

const HUBS = {
  '/': 'home',
  '/commands-of-christ': 'commands',
  '/stories-of-hope': 'stories',
  '/signs-of-john': 'stories',
  '/app-settings': 'settings',
}

function mountTabBar() {
  const active = HUBS[normalizedPath()]
  if (!active) return
  root.classList.add('oa-has-tabbar')
  const tabs = [
    ['home', '/index.html'],
    ['commands', '/commands-of-christ.html'],
    ['stories', storiesHref()],
    ['settings', '/app-settings.html'],
  ]
  const nav = document.createElement('nav')
  nav.id = 'oa-tabbar'
  nav.setAttribute('aria-label', s('tabs'))
  nav.innerHTML = tabs.map(([key, href]) => `
    <a href="${href}" class="oa-tab${key === active ? ' is-active' : ''}" ${key === active ? 'aria-current="page"' : ''} data-tab="${key}">
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[key]}</svg>
      <span>${s(key)}</span>
    </a>`).join('')
  nav.addEventListener('click', (e) => {
    const a = e.target.closest('a')
    if (!a) return
    tap(ImpactStyle.Light)
    if (a.classList.contains('is-active')) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  })
  document.body.appendChild(nav)
}

// ── Toast / offline banner ────────────────────────────────────────────────
export function toast(msg) {
  const el = document.createElement('div')
  el.className = 'oa-toast'
  el.setAttribute('role', 'status')
  el.textContent = msg
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 2600)
}

function setOffline(offline, announce) {
  let bar = document.getElementById('oa-offline')
  root.classList.toggle('oa-offline', offline)
  if (offline) {
    if (!bar) {
      bar = document.createElement('div')
      bar.id = 'oa-offline'
      bar.setAttribute('role', 'status')
      bar.textContent = s('offline')
      document.body.appendChild(bar)
    }
  } else {
    if (bar) bar.remove()
    if (announce) toast(s('back_online'))
  }
}

async function watchNetwork() {
  try {
    const st = await Network.getStatus()
    setOffline(!st.connected, false)
    Network.addListener('networkStatusChange', (n) => setOffline(!n.connected, true))
  } catch {
    setOffline(!navigator.onLine, false)
    addEventListener('online', () => setOffline(false, true))
    addEventListener('offline', () => setOffline(true, false))
  }
}

// ── Status bar + scrim ────────────────────────────────────────────────────
function parseRgb(c) {
  const m = /rgba?\(([^)]+)\)/.exec(c || '')
  if (!m) return null
  const [r, g, b, a = 1] = m[1].split(',').map(Number)
  return a === 0 ? null : [r, g, b]
}
function pageBackground() {
  return parseRgb(getComputedStyle(document.body).backgroundColor) ||
         parseRgb(getComputedStyle(root).backgroundColor) || [255, 255, 255]
}
function applyStatusBar(rgb) {
  const [r, g, b] = rgb
  const dark = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5
  root.style.setProperty('--oa-page-bg', `rgb(${r},${g},${b})`)
  root.classList.toggle('oa-dark-page', dark)
  if (NATIVE) StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {})
}
function watchOverlays() {
  // The shared sign-in overlay is dark; flip the status bar while it is open.
  const section = document.getElementById('auth-section')
  if (!section) return
  new MutationObserver(() => {
    applyStatusBar(section.classList.contains('open') ? [28, 28, 30] : pageBackground())
  }).observe(section, { attributes: true, attributeFilter: ['class'] })
}

// ── Native events ──────────────────────────────────────────────────────────
if (NATIVE) {
  // Future universal links / notification taps → in-app pages.
  App.addListener('appUrlOpen', ({ url }) => {
    try {
      const u = new URL(url)
      location.href = PUBLIC_HOSTS.has(u.hostname) ? toLocalPath(u) : toLocalPath(new URL(u.pathname || '/', location.origin))
    } catch {}
  })
  LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
    const path = notification && notification.extra && notification.extra.path
    if (path && path !== location.pathname) location.href = path
  })
}

// ── Boot ───────────────────────────────────────────────────────────────────
function boot() {
  const skip = document.querySelector('meta[http-equiv="refresh"]')
  if (!skip) {
    const scrim = document.createElement('div')
    scrim.id = 'oa-status-scrim'
    scrim.setAttribute('aria-hidden', 'true')
    document.body.appendChild(scrim)
    mountTabBar()
    applyStatusBar(pageBackground())
    watchOverlays()
    watchNetwork()
    // Light haptic on primary buttons.
    document.addEventListener('pointerdown', (e) => {
      if (e.target.closest && e.target.closest('.btn, .ot-btn, button')) tap()
    }, { passive: true })
  }
  requestAnimationFrame(hideSplash)
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true })
else boot()

// Shared helpers for app-only pages (Settings).
window.ObeyApp = { native: NATIVE, share: nativeShare, toPublicUrl, toast, tap, s,
  plugins: { App, Browser, LocalNotifications, Network, Share, Haptics } }
