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

let _lang    = localStorage.getItem(LANG_KEY) || DEFAULT
let _strings = {}

// ── Raw lookup ──────────────────────────────────────────────────────────────
// Returns the resolved value for a dotted key (string, array, or object), or
// undefined if the key is absent. Use for structured data such as flow arrays.
export function raw(key) {
    return key.split('.').reduce((o, k) => (o != null ? o[k] : undefined), _strings)
}

// ── Core translate function ─────────────────────────────────────────────────
export function t(key, vars) {
    const val = raw(key)
    const str = (val != null && typeof val !== 'object') ? String(val) : key
    if (!vars) return str
    return str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : `{${k}}`))
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
    localStorage.setItem(LANG_KEY, code)
    location.reload()
}

export function getLang() { return _lang }

// ── DOM updater ─────────────────────────────────────────────────────────────
export function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const val = t(el.dataset.i18n)
        if (val !== el.dataset.i18n) el.textContent = val
    })
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
        const val = t(el.dataset.i18nHtml)
        if (val !== el.dataset.i18nHtml) el.innerHTML = val
    })
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const val = t(el.dataset.i18nPlaceholder)
        if (val !== el.dataset.i18nPlaceholder) el.placeholder = val
    })
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const val = t(el.dataset.i18nTitle)
        if (val !== el.dataset.i18nTitle) el.title = val
    })
    document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
        const val = t(el.dataset.i18nAriaLabel)
        if (val !== el.dataset.i18nAriaLabel) el.setAttribute('aria-label', val)
    })
    document.documentElement.lang = _lang
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
    // Re-expose with loaded strings
    window.t = t
    window.i18n.raw = raw
    applyTranslations()
    window.dispatchEvent(new CustomEvent('i18n:ready'))
}

// Expose immediately so inline scripts calling window.t() before load don't crash
window.t = t
window.i18n = { setLang, getLang, applyTranslations, raw }

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init)
} else {
    _init()
}
