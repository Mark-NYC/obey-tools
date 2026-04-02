// auth.js — shared auth utilities
// Import supabase directly so all pages use the same client instance.
import { supabase } from './supabase.js'
import { t } from './i18n.js'

export function showNotification(message) {
    const el = document.createElement('div')
    el.className = 'notification'
    el.textContent = message
    document.body.appendChild(el)
    setTimeout(() => el.remove(), 3000)
}

export async function fetchRole(userId) {
    const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single()
    if (error && error.code === 'PGRST116') {
        // Profile row missing — create with default role
        await supabase.from('profiles').insert({ id: userId, role: 'user' })
        return 'user'
    }
    return data?.role ?? 'user'
}

export function updateAuthUI(user) {
    window._supabaseUser = user
    const section = document.getElementById('auth-section')
    if (section) section.style.visibility = 'visible'
    const form   = document.getElementById('auth-form')
    const status = document.getElementById('auth-status')
    const text   = document.getElementById('auth-status-text')
    if (user) {
        form.style.display   = 'none'
        status.style.display = 'flex'
        text.textContent     = t('auth.signed_in_as', { email: user.email })
    } else {
        form.style.display   = 'block'
        status.style.display = 'none'
        text.textContent     = t('auth.not_signed_in')
    }
}

export async function authSignUp() {
    const email    = document.getElementById('auth-email').value.trim()
    const password = document.getElementById('auth-password').value
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) showNotification(error.message)
    else        showNotification(t('auth.check_email'))
}

export async function authLogIn() {
    const email    = document.getElementById('auth-email').value.trim()
    const password = document.getElementById('auth-password').value
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) showNotification(error.message)
}

export async function authLogOut() {
    const { error } = await supabase.auth.signOut()
    if (error) showNotification(error.message)
}

// Called once per leader-gated page. Checks session + role on load and on
// every subsequent auth state change (sign-in, sign-out, token refresh).
// Bidirectional: can both grant and revoke access as auth state changes.
async function checkLeaderAccess(session) {
    const denied = document.getElementById('access-denied')
    const main   = document.getElementById('main-container')
    if (!session?.user) {
        denied.style.display = 'flex'
        main.style.display   = 'none'
        return
    }
    const role = await fetchRole(session.user.id)
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
    supabase.auth.getSession().then(({ data: { session } }) => {
        checkUserAccess(session)
    })
    supabase.auth.onAuthStateChange((_event, session) => {
        checkUserAccess(session)
    })
}
