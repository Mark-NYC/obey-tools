import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL = 'https://mjiswwujcsmayuytoaul.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_aeoSNC04TluHCUKD34W3rg_xJ5QcmKW'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
