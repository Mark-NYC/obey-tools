// command-progress.js — optional cloud sync for command progress.
//
// localStorage stays the immediate, offline-first source of truth. When the
// user is signed in, progress also syncs to their Supabase account so it
// follows them across devices — letting a disciple continue, and later
// reproduce, on their own phone. Silent (no UI). Every call is best-effort
// and never throws into the page: signed out or offline, it simply no-ops.
import { supabase } from './supabase.js'

async function uid() {
    try {
        const { data: { session } } = await supabase.auth.getSession()
        return session && session.user ? session.user.id : null
    } catch (e) {
        return null
    }
}

// Pull this command's saved progress from the account.
// Returns { completedCards, stepProgress } or null (signed out / offline / none saved).
export async function load(command) {
    const id = await uid()
    if (!id) return null
    try {
        const { data, error } = await supabase
            .from('command_progress')
            .select('completed_cards, step_progress')
            .eq('user_id', id)
            .eq('command', command)
            .maybeSingle()
        if (error || !data) return null
        return {
            completedCards: Array.isArray(data.completed_cards) ? data.completed_cards : [],
            stepProgress: (data.step_progress && typeof data.step_progress === 'object') ? data.step_progress : {}
        }
    } catch (e) {
        return null
    }
}

// Best-effort upsert. Silent on failure (e.g. offline) — localStorage already holds it.
export async function save(command, completedCards, stepProgress) {
    const id = await uid()
    if (!id) return
    try {
        await supabase.from('command_progress').upsert(
            {
                user_id: id,
                command: command,
                completed_cards: completedCards,
                step_progress: stepProgress,
                updated_at: new Date().toISOString()
            },
            { onConflict: 'user_id,command' }
        )
    } catch (e) { /* offline — local cache is authoritative until next sync */ }
}

// Remove this command's account row (used on Reset).
export async function clear(command) {
    const id = await uid()
    if (!id) return
    try {
        await supabase.from('command_progress').delete().eq('user_id', id).eq('command', command)
    } catch (e) { /* best-effort */ }
}
