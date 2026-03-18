// app.js — shared Supabase init and auth helpers
// Imported as a module by all pages. Exposes auth functions on window so
// existing inline onclick handlers (authSignUp, authLogIn, authLogOut) keep working.

import { supabase } from './supabase.js';
window.supabase = supabase;

// Returns the currently signed-in user. Pages keep window._supabaseUser in sync
// via their own updateAuthUI(user) implementation.
window.getCurrentUser = function getCurrentUser() {
    return window._supabaseUser || null;
};

window.authSignUp = async function authSignUp() {
    const email    = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const { error } = await window.supabase.auth.signUp({ email, password });
    if (error) window.showNotification(error.message);
    else        window.showNotification('Check your email to confirm sign up.');
};

window.authLogIn = async function authLogIn() {
    const email    = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const { error } = await window.supabase.auth.signInWithPassword({ email, password });
    if (error) window.showNotification(error.message);
};

window.authLogOut = async function authLogOut() {
    const { error } = await window.supabase.auth.signOut();
    if (error) window.showNotification(error.message);
};

// Restore session on load and listen for future auth changes.
// Each page must define window.updateAuthUI(user) for page-specific
// data-reload and UI behaviour on sign-in / sign-out.
document.addEventListener('DOMContentLoaded', () => {
    window.supabase.auth.getSession().then(({ data: { session } }) => {
        if (window.updateAuthUI) window.updateAuthUI(session?.user ?? null);
    });

    window.supabase.auth.onAuthStateChange((_event, session) => {
        if (window.updateAuthUI) window.updateAuthUI(session?.user ?? null);
    });
});
