// i18n.js — self-initialising translation module
// Usage:
//   Static HTML:  <span data-i18n="key">Fallback</span>
//                 <input data-i18n-placeholder="key">
//   Dynamic JS:   window.t('key') or window.t('key', { var: value })
//   Language:     window.i18n.setLang('es')
//
// Import in ES-module pages:
//   import '/i18n.js'          (side-effect only — exposes window.t, window.i18n)

const LANG_KEY = 'obeytools_lang'
const DEFAULT  = 'en'
const RTL_LANGS = new Set(['ar', 'ur'])
const LANGS = new Set(['en','ar','bn','bo','de','es','ne','ru','si','ta','uk','ur'])

// A shareable language link also sets the preference for subsequent pages.
const requested = new URLSearchParams(location.search).get('lang')
let saved
try { saved = localStorage.getItem(LANG_KEY) } catch {}
let _lang = LANGS.has(requested) ? requested : LANGS.has(saved) ? saved : DEFAULT
if (LANGS.has(requested)) { try { localStorage.setItem(LANG_KEY, _lang) } catch {} }
let _strings = {}
let _textKeys = {}
document.documentElement.lang = _lang
document.documentElement.dir = RTL_LANGS.has(_lang) ? 'rtl' : 'ltr'
if (_lang === 'ur') {
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = '/urdu.css'
    document.head.appendChild(css)
}

// Explicitly translate legacy UI literals without touching user-entered names,
// stored database values, URLs, or application identifiers.
export function text(source) { return _lang === 'ur' && _textKeys[source] ? t(_textKeys[source]) : source }
export function reference(source) {
    if (_lang !== 'ur' || typeof source !== 'string') return source
    const books = { Matthew:'متی', 'Matt.':'متی', Matt:'متی', Mark:'مرقس', Luke:'لوقا', John:'یوحنا', Acts:'اعمال', Hebrews:'عبرانیوں', Heb:'عبرانیوں' }
    for (const [name, translated] of Object.entries(books)) source = source.replaceAll(name, translated)
    // Isolate references as LTR units within RTL sentences, including SVG text.
    return source.replace(/(?<![\u2066\d])(\d+:\d+(?:[-–]\d+)?)(?![\d\u2069])/g, '\u2066$1\u2069')
}
let resolveReady
export const ready = new Promise(resolve => { resolveReady = resolve })

// ── Raw lookup ──────────────────────────────────────────────────────────────
// Returns the resolved value for a dotted key (string, array, or object), or
// undefined if the key is absent. Use for structured data such as flow arrays.
export function raw(key) {
    return key.split('.').reduce((o, k) => (o != null ? o[k] : undefined), _strings)
}

// ── Core translate function ─────────────────────────────────────────────────
export function t(key, vars) {
    const val = raw(key)
    const str = reference((val != null && typeof val !== 'object') ? String(val) : key)
    if (!vars) return str
    return str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? (['cmd','story'].includes(k) ? reference(vars[k]) : vars[k]) : `{${k}}`))
}

// ── Deep merge (overlay src onto dst, mutating dst) ─────────────────────────
function _merge(dst, src) {
    for (const k in src) {
        if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) {
            if (!dst[k] || typeof dst[k] !== 'object') dst[k] = {}
            _merge(dst[k], src[k])
        } else {
            dst[k] = src[k]
        }
    }
    return dst
}

// ── Language control ────────────────────────────────────────────────────────
export function setLang(code) {
    if (!LANGS.has(code)) return
    try { localStorage.setItem(LANG_KEY, code) } catch {}
    const url = new URL(location.href)
    url.searchParams.set('lang', code)
    location.assign(url.href)
}

export function getLang() { return _lang }

// ── DOM updater ─────────────────────────────────────────────────────────────
export function applyTranslations(root = document) {
    const all = selector => [ ...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector) ]
    all('[data-i18n]').forEach(el => {
        const val = t(el.dataset.i18n)
        if (val !== el.dataset.i18n && el.textContent !== val) el.textContent = val
    })
    all('[data-i18n-html]').forEach(el => {
        const val = t(el.dataset.i18nHtml)
        if (val !== el.dataset.i18nHtml && el.innerHTML !== val) el.innerHTML = val
    })
    all('[data-i18n-placeholder]').forEach(el => {
        const val = t(el.dataset.i18nPlaceholder)
        if (val !== el.dataset.i18nPlaceholder) el.placeholder = val
    })
    all('[data-i18n-title]').forEach(el => {
        const val = t(el.dataset.i18nTitle)
        if (val !== el.dataset.i18nTitle) el.title = val
    })
    all('[data-i18n-aria-label]').forEach(el => {
        const val = t(el.dataset.i18nAriaLabel)
        if (val !== el.dataset.i18nAriaLabel) el.setAttribute('aria-label', val)
    })
    for (const attr of ['alt', 'content']) all(`[data-i18n-${attr}]`).forEach(el => {
        const key = el.getAttribute(`data-i18n-${attr}`)
        const val = t(key)
        if (val !== key) el.setAttribute(attr, val)
    })
    document.documentElement.lang = _lang
    document.documentElement.dir = RTL_LANGS.has(_lang) ? 'rtl' : 'ltr'
}

// ── Initialisation ──────────────────────────────────────────────────────────
async function _init() {
    // Always load English as a base so any key missing from the active language
    // degrades to English rather than showing a raw key.
    try { _strings = await (await fetch('/lang/en.json')).json() } catch { _strings = {} }
    if (_lang !== DEFAULT) {
        try {
            const res = await fetch(`/lang/${_lang}.json`)
            if (res.ok) _merge(_strings, await res.json())
        } catch {}
    }
    if (_lang === 'ur') {
        try { _textKeys = await (await fetch('/lang/ur-text-index.json')).json() } catch {}
    }
    // Re-expose with loaded strings
    window.t = t
    window.i18n.raw = raw
    applyTranslations()
    document.querySelectorAll('select[onchange*="i18n.setLang"]').forEach(select => { select.value = _lang })
    if (_lang === 'ur') {
        const { localizeUrduPage } = await import('/urdu.js')
        await localizeUrduPage()
    }
    // Only explicit translation markers in newly inserted UI are processed.
    // Text changes and user-entered data are deliberately not observed.
    if (_lang === 'ur') new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
            if (node.nodeType === 1) applyTranslations(node)
        }
    }).observe(document.body, { childList: true, subtree: true })
    window.i18n.isReady = true
    resolveReady()
    window.dispatchEvent(new CustomEvent('i18n:ready'))
}

// Expose immediately so inline scripts calling window.t() before load don't crash
window.t = t
window.i18n = { setLang, getLang, applyTranslations, raw, text, reference, ready, isReady: false }

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init)
} else {
    _init()
}
