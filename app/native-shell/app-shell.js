// OBEY.TOOLS native shell — injected into every page of the iOS app bundle by
// scripts/build-web.mjs. Never shipped to the public website.
//
// Responsibilities:
//   • Minimal top bar on every screen: Home (left), Account + Settings (right).
//     Home is the tool-selection screen; there is deliberately NO tab bar —
//     the tools are a coordinated set, not interchangeable app sections.
//   • Safe-area handling, status-bar styling
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
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
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

// ── Durable local data ─────────────────────────────────────────────────────
// Everything people save (Conversation Box people, notes, progress, Church
// Circle) lives in this WebView's localStorage. iOS keeps that across restarts
// and updates, but WebKit storage can in rare cases be cleared (e.g. storage
// pressure). So every change is also copied to a native file
// (Library/obey-local-data-backup.json, included in iCloud/device backups),
// and ObeyBridgeViewController.swift hands that copy to each page before any
// page script runs (window.__OBEY_BACKUP).
//
// Restore rules: only when this WebView's storage has been wiped (our marker
// key is gone), and only keys that don't exist now. Nothing is overwritten.
// Sign-in tokens are not copied; after a wipe, people simply sign in again.
const STORAGE_MARKER = 'obeyapp:storage-marker'
const BACKUP_FILE = 'obey-local-data-backup.json'
const NOT_BACKED_UP = /^(obey-tools-auth|sb-.*-auth-token|obeyapp:storage-marker)$/
const backupStatus = window.__OBEY_BACKUP_STATUS   // 'ok' | 'none' | 'error' | undefined (web)
let restoredKeys = 0
let backupWritable = false
// Tests run this logic in Chromium (Filesystem falls back to IndexedDB there).
const DURABLE = NATIVE || window.__OBEY_TEST_DURABLE === true
;(function restoreLocalData() {
  if (!DURABLE) return
  let marker = null
  try { marker = localStorage.getItem(STORAGE_MARKER) } catch { return }
  if (marker === null && backupStatus === 'ok' && window.__OBEY_BACKUP && typeof window.__OBEY_BACKUP === 'object') {
    for (const [k, v] of Object.entries(window.__OBEY_BACKUP)) {
      try { if (typeof v === 'string' && localStorage.getItem(k) === null) { localStorage.setItem(k, v); restoredKeys++ } } catch {}
    }
  }
  // An unreadable backup ('error') or a missing native hand-off is never overwritten.
  if (backupStatus === 'ok' || backupStatus === 'none') {
    try { if (marker === null) localStorage.setItem(STORAGE_MARKER, new Date().toISOString()) } catch {}
    backupWritable = true
  }
})()

function snapshotLocalData() {
  const items = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k != null && !NOT_BACKED_UP.test(k)) items[k] = localStorage.getItem(k)
  }
  return items
}
let backupTimer = null, backupWriting = false, backupAgain = false
async function writeBackupNow() {
  clearTimeout(backupTimer); backupTimer = null
  if (!backupWritable) return
  if (backupWriting) { backupAgain = true; return }
  backupWriting = true
  try {
    await Filesystem.writeFile({
      path: BACKUP_FILE, directory: Directory.Library, encoding: Encoding.UTF8,
      data: JSON.stringify({ version: 1, savedAt: new Date().toISOString(), items: snapshotLocalData() }),
    })
  } catch (e) { console.warn('[obey] local backup failed', e) }
  finally { backupWriting = false; if (backupAgain) { backupAgain = false; writeBackupNow() } }
}
function scheduleBackup() { if (backupWritable) { clearTimeout(backupTimer); backupTimer = setTimeout(writeBackupNow, 350) } }
async function readBackup() {
  const r = await Filesystem.readFile({ path: BACKUP_FILE, directory: Directory.Library, encoding: Encoding.UTF8 })
  return JSON.parse(typeof r.data === 'string' ? r.data : await r.data.text())
}
if (DURABLE) {
  const proto = Storage.prototype
  for (const m of ['setItem', 'removeItem', 'clear']) {
    const orig = proto[m]
    proto[m] = function () { const r = orig.apply(this, arguments); if (this === window.localStorage) scheduleBackup(); return r }
  }
  // Leaving a page (navigation, app switch): flush any pending write now.
  addEventListener('pagehide', () => { if (backupTimer) writeBackupNow() })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && backupTimer) writeBackupNow() })
  // First run of this version: make sure a backup exists.
  if (backupWritable && backupStatus === 'none') scheduleBackup()
}

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
    home: 'Home', settings: 'Settings', account: 'Open account', sign_in: 'Open sign in',
    bar: 'App navigation',
    unsaved: 'You have changes that are not saved yet. Leave this screen anyway?',
    offline: 'Offline. Saved tools still work. Sign-in and syncing resume when you reconnect.',
    offline_short: 'Offline',
    back_online: 'Back online',
    share_failed: 'Sharing is not available right now.',
    copied: 'Copied',
  },
}
const lang = (() => { try { return localStorage.getItem('obeytools_lang') || 'en' } catch { return 'en' } })()
export const s = (k) => (STRINGS[lang] && STRINGS[lang][k]) || STRINGS.en[k] || k
// Prefer the site's own translations (all 12 languages) when a key exists.
const SITE_KEYS = { home: 'nav.home', settings: 'site_text.s_c7f73bb54d92', account: 'site_text.s_db17a329d4f5', sign_in: 'study_ui.open_sign_in' }
const tr = (k) => {
  const key = SITE_KEYS[k]
  if (key && typeof window.t === 'function') { const v = window.t(key); if (v && v !== key) return v }
  return s(k)
}

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

// ── Top bar ────────────────────────────────────────────────────────────────
// One consistent bar on every screen. Left: Home (hidden on Home itself).
// Right: Account (opens the site's own sign-in overlay) and Settings.
const ICONS = {
  back: '<path d="M15 4.5 7.5 12l7.5 7.5"/>',
  account: '<circle cx="12" cy="8.2" r="4"/><path d="M4.5 20.5c.6-3.9 3.7-6.3 7.5-6.3s6.9 2.4 7.5 6.3"/>',
  settings: '<circle cx="12" cy="12" r="3.1"/><path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.6-2-3.4-2.4.9a7.6 7.6 0 0 0-2.6-1.5L14 2.4h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.4l-2.4-.9-2 3.4 2 1.6a7.7 7.7 0 0 0 0 3l-2 1.6 2 3.4 2.4-.9a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4.9 2-3.4z"/>',
}
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`

const isHome = () => normalizedPath() === '/'
const isSettings = () => normalizedPath() === '/app-settings'

// Unsaved-work guard. Pages autosave progress, but some sheets (e.g. a
// person's note in Conversation Box) only save on their Save button. Track
// text the user typed that no button press has followed, and confirm before
// leaving with it. Sign-in fields are not "work".
const dirty = new Set()
document.addEventListener('input', (e) => {
  const el = e.target
  if (!el || !el.matches || !el.matches('textarea, input:not([type=email]):not([type=password]):not([type=checkbox]):not([type=radio]):not([type=range]), [contenteditable=""], [contenteditable=true]')) return
  if (el.closest('#auth-section, #oa-bar')) return
  dirty.add(el)
}, true)
document.addEventListener('click', (e) => {
  if (e.target.closest && e.target.closest('button, [role=button], input[type=submit]') && !e.target.closest('#oa-bar')) dirty.clear()
}, true)
function hasUnsavedWork() {
  for (const el of dirty) {
    if (!el.isConnected || !el.getClientRects().length) { dirty.delete(el); continue }
    if (String(el.value ?? el.textContent).trim()) return true
  }
  return false
}
export function goHome() {
  if (hasUnsavedWork() && !window.confirm(s('unsaved'))) return
  tap()
  // Coming straight from Home: go back so Home keeps its scroll position.
  let fromHome = false
  try { const r = new URL(document.referrer); fromHome = r.origin === location.origin && /^\/(index(\.html)?)?$/.test(r.pathname) } catch {}
  if (fromHome && history.length > 1) history.back()
  else location.assign('/index.html')
}

function openAccount() {
  tap()
  const trigger = document.querySelector('.acct-icon-btn')
  if (trigger) { trigger.click(); return }
  // Pages without the shared sign-in box: account lives in Settings.
  if (!isSettings()) location.assign('/app-settings.html#account')
  else document.getElementById('account-signin')?.scrollIntoView({ block: 'center' })
}

function mountTopBar() {
  root.classList.add('oa-has-bar')
  if (isHome()) root.classList.add('oa-home')
  const bar = document.createElement('nav')
  bar.id = 'oa-bar'
  bar.setAttribute('aria-label', s('bar'))
  bar.innerHTML = `
    <div class="oa-bar-row">
      <div class="oa-bar-start">${isHome() ? '' : `<a href="/index.html" class="oa-bar-home" id="oa-home">${svg('back')}<span class="oa-home-label">${tr('home')}</span></a>`}</div>
      <div class="oa-bar-end">
        <button type="button" class="oa-bar-icon" id="oa-account" aria-label="${tr('sign_in')}">${svg('account')}<span class="oa-dot" hidden></span></button>
        ${isSettings() ? '' : `<a href="/app-settings.html" class="oa-bar-icon" id="oa-settings" aria-label="${tr('settings')}">${svg('settings')}</a>`}
      </div>
    </div>`
  document.body.prepend(bar)
  bar.querySelector('#oa-home')?.addEventListener('click', (e) => { e.preventDefault(); goHome() })
  bar.querySelector('#oa-account').addEventListener('click', openAccount)
  bar.querySelector('#oa-settings')?.addEventListener('click', (e) => {
    if (hasUnsavedWork() && !window.confirm(s('unsaved'))) e.preventDefault()
    else tap()
  })

  // Labels follow the page language once the site's translations load.
  window.addEventListener('i18n:ready', () => {
    const l = bar.querySelector('.oa-home-label'); if (l) l.textContent = tr('home')
    const st = bar.querySelector('#oa-settings'); if (st) st.setAttribute('aria-label', tr('settings'))
    syncAccount()
  })

  // Mirror the site's account icon state (signed-in dot, label).
  const acct = bar.querySelector('#oa-account')
  const dot = acct.querySelector('.oa-dot')
  function syncAccount() {
    const src = document.querySelector('.acct-icon-btn')
    const signedIn = src ? src.classList.contains('signed-in') : !!window._supabaseUser
    dot.hidden = !signedIn
    acct.setAttribute('aria-label', signedIn ? tr('account') : tr('sign_in'))
  }
  syncAccount()
  new MutationObserver(syncAccount).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true })
}

// The app bar is the one way home. Hide each page's own Home pill / wordmark
// link at the top of the page (in-tool links such as "← Commands of Christ"
// stay), and collapse a header row that held nothing else.
function hideDuplicateHomeLinks() {
  const links = document.querySelectorAll('a[href="/"], a[href="/index.html"], a[href="index.html"], a.mobile-home-btn')
  for (const a of links) {
    if (a.closest('#oa-bar, footer')) continue
    const top = a.getBoundingClientRect().top + scrollY - (parseFloat(getComputedStyle(root).paddingTop) || 0)
    if (top > 140) continue
    a.classList.add('oa-dup-home')
    a.setAttribute('aria-hidden', 'true')
    a.tabIndex = -1
    const parent = a.parentElement
    // Collapse the row only if the Home link is literally its only content.
    // (Not "the only visible content": e.g. the progress map toolbar's Log Out
    // button is invisible while signed out and must reappear after sign-in.)
    if (parent && parent !== document.body && parent.tagName !== 'MAIN' &&
        [...parent.childNodes].every((n) => n === a || n.nodeType === 8 || (n.nodeType === 3 && !n.textContent.trim()))) {
      parent.classList.add('oa-dup-home-row')
    }
  }
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
      bar.innerHTML = `<span class="oa-offline-full"></span><span class="oa-offline-short">${s('offline_short')}</span>`
      bar.querySelector('.oa-offline-full').textContent = s('offline')
      bar.setAttribute('aria-label', s('offline'))
      document.body.appendChild(bar)
      // Explain once, then get out of the way: shrink to a small pill.
      setTimeout(() => bar.classList.add('oa-compact'), 4000)
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
    mountTopBar()
    hideDuplicateHomeLinks()
    // Bar is transparent at the top of a page, translucent once content scrolls under it.
    const onScroll = () => root.classList.toggle('oa-scrolled', scrollY > 4)
    addEventListener('scroll', onScroll, { passive: true }); onScroll()
    applyStatusBar(pageBackground())
    watchOverlays()
    watchNetwork()
    // Light haptic on primary buttons.
    document.addEventListener('pointerdown', (e) => {
      if (e.target.closest && e.target.closest('.btn, .ot-btn, button')) tap()
    }, { passive: true })
  }
  if (restoredKeys) toast('Your saved tools were restored from this iPhone’s backup.')
  requestAnimationFrame(hideSplash)
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true })
else boot()

// Shared helpers for app-only pages (Settings).
window.ObeyApp = { native: NATIVE, share: nativeShare, toPublicUrl, toast, tap, s, goHome,
  // Signing out / deleting the account never deletes data saved on this phone (auth.js).
  keepDeviceData: true,
  backup: { status: backupStatus, restoredKeys, writable: backupWritable, writeNow: writeBackupNow, read: readBackup, snapshot: snapshotLocalData },
  plugins: { App, Browser, LocalNotifications, Network, Share, Haptics } }
