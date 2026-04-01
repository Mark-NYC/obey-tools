import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BAND_PASSWORD = Deno.env.get('BAND_PASSWORD') ?? ''
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by Supabase
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const ALLOWED_ORIGINS = ['https://obey.tools']

function corsHeaders(origin: string) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

function json(body: unknown, status = 200, origin = '') {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })
}

serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? ''

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, origin)
  }

  // --- Parse body ---
  let body: {
    password?: string
    cities?: unknown[]
    last_known_timestamp?: string
    device_id?: string
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400, origin)
  }

  const { password, cities, last_known_timestamp, device_id } = body

  // --- Auth check ---
  if (!BAND_PASSWORD) {
    // Misconfigured — refuse all writes rather than silently accepting
    console.error('BAND_PASSWORD secret is not set')
    return json({ error: 'Server misconfigured' }, 500, origin)
  }
  if (!password || password !== BAND_PASSWORD) {
    return json({ error: 'Unauthorized' }, 401, origin)
  }

  // --- Validate payload ---
  if (!Array.isArray(cities)) {
    return json({ error: 'cities must be an array' }, 400, origin)
  }

  // --- Write using service role key (bypasses RLS) ---
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  })

  // Conflict detection: read current timestamp before writing
  const { data: current, error: readError } = await supabase
    .from('band_data')
    .select('last_modified, cities')
    .eq('id', 'main')
    .maybeSingle()

  if (readError) {
    console.error('Read error:', readError)
    return json({ error: 'Read failed' }, 500, origin)
  }

  if (current && last_known_timestamp && current.last_modified !== last_known_timestamp) {
    return json(
      {
        conflict: true,
        serverData: {
          data: { cities: current.cities },
          lastModified: current.last_modified,
        },
      },
      409,
      origin,
    )
  }

  const newTimestamp = new Date().toISOString()
  const { error: writeError } = await supabase.from('band_data').upsert({
    id: 'main',
    cities,
    last_modified: newTimestamp,
    modified_by: device_id ?? 'unknown',
  })

  if (writeError) {
    console.error('Write error:', writeError)
    return json({ error: 'Write failed' }, 500, origin)
  }

  return json({ ok: true, last_modified: newTimestamp }, 200, origin)
})
