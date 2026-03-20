import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

const SUPABASE_URL = 'https://mjiswwujcsmayuytoaul.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_aeoSNC04TluHCUKD34W3rg_xJ5QcmKW'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        storage: localStorage,
        storageKey: 'obey-tools-auth',
        autoRefreshToken: true,
        detectSessionInUrl: true,
    }
})
