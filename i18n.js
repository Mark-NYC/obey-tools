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

// ── Core translate function ─────────────────────────────────────────────────
export function t(key, vars) {
    const raw = key.split('.').reduce((o, k) => (o != null ? o[k] : undefined), _strings)
    const str = (raw != null && raw !== key) ? String(raw) : key
    if (!vars) return str
    return str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : `{${k}}`))
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
    try {
        const res = await fetch(`/lang/${_lang}.json`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        _strings = await res.json()
    } catch {
        if (_lang !== DEFAULT) {
            try { _strings = await (await fetch('/lang/en.json')).json() } catch {}
        }
    }
    // Re-expose with loaded strings
    window.t = t
    applyTranslations()
    window.dispatchEvent(new CustomEvent('i18n:ready'))
}

// Expose immediately so inline scripts calling window.t() before load don't crash
window.t = t
window.i18n = { setLang, getLang, applyTranslations }

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init)
} else {
    _init()
}
