// auth.js — shared auth utilities
// Import supabase directly so all pages use the same client instance.
import { supabase } from './supabase.js'
import { t } from './i18n.js'
import { initAccountOverlay } from './account-overlay.js'

// Where email confirmation links land after Supabase verifies them.
const EMAIL_REDIRECT = window.location.origin + '/index.html'

export function showNotification(message) {
    const el = document.createElement('div')
    el.className = 'notification'
    el.textContent = message
    document.body.appendChild(el)
    setTimeout(() => el.remove(), 3000)
}

// Persistent, dismissible banner for auth feedback the user must not miss
// (confirmation instructions, login errors). Styled inline so it works on
// every page without per-page CSS. type: 'info' | 'success' | 'error'.
export function showAuthMessage(message, { type = 'info', actionLabel, onAction } = {}) {
    document.querySelectorAll('.auth-banner').forEach(el => el.remove())
    const colors = { info: '#3a3a3c', success: '#00B884', error: '#ff3b30' }
    const el = document.createElement('div')
    el.className = 'auth-banner'
    el.style.cssText =
        'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10000;' +
        'max-width:360px;width:calc(100% - 32px);background:#1c1c1e;color:#fff;' +
        'padding:14px 40px 14px 16px;border-radius:14px;font-size:14px;line-height:1.45;' +
        'box-shadow:0 6px 24px rgba(0,0,0,0.35);' +
        'font-family:-apple-system,BlinkMacSystemFont,sans-serif;' +
        'border-left:4px solid ' + (colors[type] || colors.info) + ';'

    const text = document.createElement('div')
    text.textContent = message
    el.appendChild(text)

    if (actionLabel && onAction) {
        const act = document.createElement('button')
        act.type = 'button'
        act.textContent = actionLabel
        act.style.cssText =
            'margin-top:10px;padding:8px 14px;border:none;border-radius:8px;' +
            'background:#00B884;color:#fff;font-weight:600;font-size:13px;' +
            'cursor:pointer;font-family:inherit;'
        act.addEventListener('click', () => { act.disabled = true; act.style.opacity = '0.6'; onAction() })
        el.appendChild(act)
    }

    const close = document.createElement('button')
    close.type = 'button'
    close.setAttribute('aria-label', 'Dismiss')
    close.textContent = '×'
    close.style.cssText =
        'position:absolute;top:6px;right:10px;background:none;border:none;' +
        'color:#8e8e93;font-size:20px;cursor:pointer;line-height:1;font-family:inherit;'
    close.addEventListener('click', () => el.remove())
    el.appendChild(close)

    document.body.appendChild(el)
}

// Returns 'leader' | 'user' | null. null means the lookup itself failed
// (network / RLS error) — callers must not treat that as "not a leader".
export async function fetchRole(userId) {
    const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle()
    if (error) return null
    if (!data) {
        // Profile row missing — create with default role
        await supabase.from('profiles').insert({ id: userId, role: 'user' })
        return 'user'
    }
    return data.role ?? 'user'
}

async function resolveRole(userId) {
    let role = await fetchRole(userId)
    if (role === null) {
        // Transient failure — retry once before giving up
        await new Promise(r => setTimeout(r, 1500))
        role = await fetchRole(userId)
    }
    return role
}

// The status line is set imperatively (it needs email interpolation), so it is
// NOT re-translated by i18n's applyTranslations() the way [data-i18n] nodes are.
// A signed-in session restores from localStorage before the async i18n fetch
// finishes, so t() would return the raw key ("auth.signed_in_as"). Split this
// out so we can re-run it once i18n is ready.
function refreshAuthStatusText() {
    const text = document.getElementById('auth-status-text')
    if (!text) return
    const user = window._supabaseUser
    text.textContent = user
        ? t('auth.signed_in_as', { email: user.email })
        : t('auth.not_signed_in')
}

// Re-apply the status text once translations have loaded. Covers the case where
// auth state resolved before i18n:ready; harmless (idempotent) otherwise. Every
// auth page imports this module — including conversation-box.html, whose custom
// updateAuthUI also writes #auth-status-text — so this single listener fixes all.
window.addEventListener('i18n:ready', refreshAuthStatusText)

export function updateAuthUI(user) {
    window._supabaseUser = user
    const section = document.getElementById('auth-section')
    if (section) section.style.visibility = 'visible'
    const form   = document.getElementById('auth-form')
    const status = document.getElementById('auth-status')
    if (!form || !status) return
    if (user) {
        form.style.display   = 'none'
        status.style.display = 'flex'
    } else {
        form.style.display   = 'block'
        status.style.display = 'none'
    }
    refreshAuthStatusText()
}

// Element-id arguments let a second form (e.g. inside an access-denied panel)
// reuse these handlers. Non-string / missing values fall back to the default
// form ids, so plain onclick="authLogIn()" keeps working.
function fieldValue(id, fallback) {
    if (typeof id !== 'string' || !id) id = fallback
    return document.getElementById(id)?.value ?? ''
}

export async function authSignUp(emailId, passwordId) {
    const email    = fieldValue(emailId, 'auth-email').trim()
    const password = fieldValue(passwordId, 'auth-password')
    if (!email || !password) {
        showAuthMessage(t('auth.enter_email_password'), { type: 'error' })
        return
    }
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: EMAIL_REDIRECT }
    })
    if (error) {
        const msg = error.message.toLowerCase()
        if (msg.includes('already registered') || msg.includes('already been registered')) {
            showAuthMessage(t('auth.already_registered'), { type: 'error' })
        } else {
            showAuthMessage(error.message, { type: 'error' })
        }
        return
    }
    // With email confirmation enabled, Supabase anti-enumeration makes signUp
    // "succeed" for an already-registered address, returning a user with no
    // identities. Detect it so the user isn't told to wait for an email that
    // will never arrive.
    if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        showAuthMessage(t('auth.already_registered'), { type: 'error' })
        return
    }
    if (data?.session) {
        // Email confirmation disabled — signed in immediately.
        showAuthMessage(t('auth.signup_complete'), { type: 'success' })
        return
    }
    showAuthMessage(t('auth.confirm_email_sent', { email }), { type: 'success' })
}

export async function authLogIn(emailId, passwordId) {
    const email    = fieldValue(emailId, 'auth-email').trim()
    const password = fieldValue(passwordId, 'auth-password')
    if (!email || !password) {
        showAuthMessage(t('auth.enter_email_password'), { type: 'error' })
        return
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (!error) {
        document.querySelectorAll('.auth-banner').forEach(el => el.remove())
        return
    }
    const msg = error.message.toLowerCase()
    if (msg.includes('not confirmed')) {
        showAuthMessage(t('auth.email_not_confirmed'), {
            type: 'error',
            actionLabel: t('auth.resend_confirmation'),
            onAction: () => resendConfirmation(email)
        })
    } else if (msg.includes('invalid login credentials')) {
        showAuthMessage(t('auth.invalid_credentials'), { type: 'error' })
    } else {
        showAuthMessage(error.message, { type: 'error' })
    }
}

export async function resendConfirmation(email) {
    const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: EMAIL_REDIRECT }
    })
    if (error) showAuthMessage(error.message, { type: 'error' })
    else       showAuthMessage(t('auth.confirm_email_sent', { email }), { type: 'success' })
}

export async function authLogOut() {
    const { error } = await supabase.auth.signOut()
    if (error) showNotification(error.message)
}

export async function authForgotPassword(emailId) {
    const email = fieldValue(emailId, 'auth-email').trim()
    if (!email) {
        showAuthMessage(t('auth.enter_email_first'), { type: 'error' })
        return
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/reset-password.html'
    })
    if (error) showAuthMessage(error.message, { type: 'error' })
    else       showAuthMessage(t('auth.reset_email_sent', { email }), { type: 'success' })
}

// Called once per page that shows the shared auth-section box (no gating).
// Wires session restore + all subsequent auth state changes to the UI.
export function initAuthSection(onChange) {
    initAccountOverlay()
    const apply = (session) => {
        updateAuthUI(session?.user ?? null)
        if (onChange) onChange(session)
    }
    supabase.auth.getSession().then(({ data: { session } }) => apply(session))
    supabase.auth.onAuthStateChange((_event, session) => apply(session))
}

// Called once per leader-gated page. Checks session + role on load and on
// every subsequent auth state change (sign-in, sign-out, token refresh).
// Bidirectional: can both grant and revoke access as auth state changes.
async function checkLeaderAccess(session) {
    const denied = document.getElementById('access-denied')
    const main   = document.getElementById('main-container')
    if (!denied || !main) return
    // The login form inside the denied panel only makes sense when signed out
    const deniedAuth = document.getElementById('denied-auth')
    if (deniedAuth) deniedAuth.style.display = session?.user ? 'none' : ''
    if (!session?.user) {
        denied.style.display = 'flex'
        main.style.display   = 'none'
        return
    }
    const role = await resolveRole(session.user.id)
    if (role !== 'leader') {
        denied.style.display = 'flex'
        main.style.display   = 'none'
        return
    }
    denied.style.display = 'none'
    main.style.display   = ''
    updateAuthUI(session.user)
}

export function initLeaderPage() {
    initAccountOverlay()
    // Initial check — reads session from localStorage immediately
    supabase.auth.getSession().then(({ data: { session } }) => {
        checkLeaderAccess(session)
    })
    // React to sign-in, sign-out, and token refresh
    supabase.auth.onAuthStateChange((_event, session) => {
        checkLeaderAccess(session)
    })
}

// Called once per user-gated page. Requires sign-in only (not leader role).
// If not signed in, shows the access-denied panel with a login prompt.
// If signed in, shows main content.
async function checkUserAccess(session) {
    const denied = document.getElementById('access-denied')
    const main   = document.getElementById('main-container')
    if (!denied || !main) return
    if (!session?.user) {
        denied.style.display = 'flex'
        main.style.display   = 'none'
        return
    }
    denied.style.display = 'none'
    main.style.display   = ''
    updateAuthUI(session.user)
}

export function initUserPage() {
    initAccountOverlay()
    supabase.auth.getSession().then(({ data: { session } }) => {
        checkUserAccess(session)
    })
    supabase.auth.onAuthStateChange((_event, session) => {
        checkUserAccess(session)
    })
}
