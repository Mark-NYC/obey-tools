// Pinned version: an unpinned @2 import silently upgrades on every CDN refresh,
// which can change auth behavior (e.g. default flow type) under our users.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.6/+esm'

const SUPABASE_URL = 'https://mjiswwujcsmayuytoaul.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_aeoSNC04TluHCUKD34W3rg_xJ5QcmKW'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        storage: localStorage,
        storageKey: 'obey-tools-auth',
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Implicit flow keeps email links (confirm / recovery) working even when
        // opened in a different browser than the one that requested them —
        // PKCE would require the original browser's stored code verifier.
        flowType: 'implicit',
    }
})
