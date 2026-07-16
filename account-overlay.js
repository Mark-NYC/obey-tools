// account-overlay.js — shared full-screen sign-in overlay.
//
// Turns a page's standard #auth-section (containing #auth-form and #auth-status)
// into a full-screen charcoal sign-in view opened by a person icon top-right.
// One implementation for the whole site: auth.js calls initAccountOverlay() from
// its init* helpers, so most pages need no changes. Idempotent and self-contained
// — it injects its own CSS, syncs the icon's signed-in dot, and auto-closes the
// overlay when the user signs in.
import { supabase } from './supabase.js'
import { t } from './i18n.js'

const CSS = `
/* The overlay logo uses Bebas Neue. The study pages otherwise use system fonts
   and don't load it, so declare it here (self-hosted) for a consistent logo. */
@font-face {
    font-family: 'Bebas Neue';
    font-style: normal;
    font-weight: 400;
    font-display: block;
    src: url(/assets/fonts/bebas-neue-latin.woff2) format('woff2');
    unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

/* Person icon that opens the sign-in overlay. Any legacy .account-btn (from the
   study-page redesign) is hidden so there is exactly one, consistent trigger. */
.account-btn { display: none !important; }
.acct-icon-btn {
    position: fixed;
    top: max(16px, env(safe-area-inset-top, 0px));
    right: 16px;
    z-index: 1500;
    width: 42px;
    height: 42px;
    display: grid;
    place-items: center;
    padding: 0;
    margin: 0;
    border: none;
    border-radius: 12px;
    background: #3a3a3c;
    color: #fff;
    cursor: pointer;
    box-shadow: 0 2px 10px rgba(0,0,0,0.18);
    transition: background 0.15s ease, transform 0.1s ease;
}
.acct-icon-btn:hover { background: #4a4a4d; }
.acct-icon-btn:active { transform: scale(0.94); }
.acct-icon-btn svg { width: 22px; height: 22px; display: block; }
.acct-icon-btn.signed-in::after {
    content: '';
    position: absolute;
    top: 7px;
    right: 7px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #00D084;
    border: 2px solid #3a3a3c;
}

/* Full-screen charcoal overlay. Display-toggled via .open so nothing that sets
   visibility:visible can force it open. */
#auth-section.account-overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    margin: 0;
    padding: calc(max(16px, env(safe-area-inset-top, 0px)) + 8px) 24px 24px;
    box-sizing: border-box;
    background: #1c1c1e;
    visibility: visible;
    display: none;
}
#auth-section.account-overlay.open {
    display: flex !important;
    flex-direction: column;
    animation: acctOverlayIn 0.18s ease;
}
@keyframes acctOverlayIn { from { opacity: 0; } to { opacity: 1; } }
#auth-section.account-overlay #auth-collapsed { display: none !important; }
/* Overlay owns form-vs-status visibility (via .acct-authed) with !important so a
   page's own auth CSS/JS — e.g. conversation-box's collapsed banner, or a
   responsive .auth-section rule — can't hide the form or status inside it. */
#auth-section.account-overlay #auth-form   { display: block !important; }
#auth-section.account-overlay #auth-status { display: none !important; }
#auth-section.account-overlay.acct-authed #auth-form   { display: none !important; }
#auth-section.account-overlay.acct-authed #auth-status { display: flex !important; }
#auth-section.account-overlay .acct-close {
    position: absolute;
    top: calc(max(16px, env(safe-area-inset-top, 0px)) + 6px);
    right: 16px;
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 12px;
    background: rgba(255,255,255,0.08);
    color: #fff;
    font-size: 24px;
    line-height: 1;
    cursor: pointer;
}
#auth-section.account-overlay .acct-close:hover { background: rgba(255,255,255,0.14); }
#auth-section.account-overlay .acct-overlay-inner { margin: auto; width: 100%; max-width: 340px; }
#auth-section.account-overlay .acct-overlay-logo {
    font-family: 'Bebas Neue', cursive;
    font-size: 52px;
    font-weight: 400;
    letter-spacing: 2px;
    color: #00D084;
    -webkit-text-stroke: 2px #000;
    text-align: center;
    margin-bottom: 24px;
}
#auth-section.account-overlay input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 13px 14px;
    margin: 0 0 10px;
    border: 1px solid #48484b;
    border-radius: 11px;
    background: #2a2a2d;
    color: #fff;
    font-size: 16px;
    font-family: inherit;
    outline: none;
}
#auth-section.account-overlay input::placeholder { color: #8e8e93; }
#auth-section.account-overlay input:focus { border-color: #00D084; }
#auth-section.account-overlay .auth-buttons { display: flex; gap: 10px; margin-top: 4px; }
#auth-section.account-overlay .auth-buttons > button {
    flex: 1;
    padding: 13px;
    border: none;
    border-radius: 11px;
    font-size: 16px;
    font-family: inherit;
    cursor: pointer;
}
#auth-section.account-overlay .auth-buttons > button:first-child { background: #00D084; color: #08231a; font-weight: 700; }
#auth-section.account-overlay .auth-buttons > button:last-child { background: transparent; color: #f2f2f7; font-weight: 600; border: 1px solid #5a5a5d; }
#auth-section.account-overlay .auth-forgot-btn {
    display: block;
    width: 100%;
    margin-top: 12px;
    padding: 6px;
    background: none;
    border: none;
    color: #8e8e93;
    font-size: 14px;
    font-family: inherit;
    cursor: pointer;
    text-align: center;
}
#auth-section.account-overlay .auth-status { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
#auth-section.account-overlay .auth-status-text { font-size: 15px; color: #c7c7cc; }
#auth-section.account-overlay .auth-logout-btn {
    padding: 9px 16px;
    border: 1px solid #5a5a5d;
    border-radius: 11px;
    background: transparent;
    color: #f2f2f7;
    font-weight: 600;
    font-size: 14px;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
}
`

const PERSON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12.2a4.4 4.4 0 1 0 0-8.8 4.4 4.4 0 0 0 0 8.8Zm0 2.2c-4.7 0-8.1 2.6-8.1 6.2h16.2c0-3.6-3.4-6.2-8.1-6.2Z" fill="currentColor"/></svg>'

let mounted = false

export function initAccountOverlay() {
    if (mounted) return
    const section = document.getElementById('auth-section')
    const form    = document.getElementById('auth-form')
    const status  = document.getElementById('auth-status')
    // No standard sign-in box on this page (e.g. invite / reset-password) — skip.
    if (!section || !form || !status) return
    mounted = true

    if (!document.getElementById('account-overlay-css')) {
        const style = document.createElement('style')
        style.id = 'account-overlay-css'
        style.textContent = CSS
        document.head.appendChild(style)
    }

    // Drop inline styles that would beat the shared CSS.
    section.querySelectorAll('input, .auth-buttons button, .auth-forgot-btn, .auth-logout-btn')
        .forEach(el => el.removeAttribute('style'))
    section.removeAttribute('style')

    const openOverlay  = () => { section.classList.add('open');    document.body.style.overflow = 'hidden' }
    const closeOverlay = () => { section.classList.remove('open'); document.body.style.overflow = '' }

    // Reparent to <body> so the fixed overlay is never hidden by an ancestor —
    // on gated pages #auth-section sits inside #main-container, which is
    // display:none until access is granted.
    if (section.parentElement !== document.body) document.body.appendChild(section)

    // Build the overlay structure once: logo + form + status wrapped, plus a close button.
    section.classList.add('account-overlay')
    if (!section.querySelector('.acct-overlay-inner')) {
        const close = document.createElement('button')
        close.type = 'button'
        close.className = 'acct-close'
        close.setAttribute('aria-label', 'Close')
        close.innerHTML = '&times;'
        close.addEventListener('click', closeOverlay)

        const logo = document.createElement('div')
        logo.className = 'acct-overlay-logo'
        logo.textContent = 'OBEY.TOOLS'

        const inner = document.createElement('div')
        inner.className = 'acct-overlay-inner'
        inner.appendChild(logo)
        inner.appendChild(form)
        inner.appendChild(status)

        section.appendChild(close)
        section.appendChild(inner)
    }

    // One fixed person-icon trigger for the whole site.
    const trigger = document.createElement('button')
    trigger.type = 'button'
    trigger.className = 'acct-icon-btn'
    trigger.setAttribute('aria-label', 'Open sign in')
    trigger.innerHTML = PERSON_SVG
    trigger.addEventListener('click', openOverlay)
    document.body.appendChild(trigger)

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && section.classList.contains('open')) closeOverlay()
    })

    // Single source of truth for the overlay's state: icon dot, form-vs-status,
    // status text, and auto-close on sign-in. Self-contained so it works the
    // same on plain, user-gated, and leader-gated pages.
    const statusText = document.getElementById('auth-status-text')
    let lastUser = null
    const applyState = (session) => {
        const user = session?.user ?? null
        lastUser = user
        window._supabaseUser = user
        trigger.classList.toggle('signed-in', !!user)
        trigger.setAttribute('aria-label', user ? 'Open signed-in account' : 'Open sign in')
        // Form-vs-status is driven by this class + !important CSS above.
        section.classList.toggle('acct-authed', !!user)
        if (statusText) statusText.textContent = user
            ? t('auth.signed_in_as', { email: user.email })
            : t('auth.not_signed_in')
        if (user && section.classList.contains('open')) closeOverlay()
    }
    supabase.auth.getSession().then(({ data: { session } }) => applyState(session))
    supabase.auth.onAuthStateChange((_event, session) => applyState(session))
    // Re-apply once translations load (status text is set imperatively).
    window.addEventListener('i18n:ready', () => applyState({ user: lastUser }))
}
