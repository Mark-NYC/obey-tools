#!/usr/bin/env node
// Backfill country-aware place fields on rows written before /geo.js existed.
//
//   SUPABASE_URL=https://<project>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service role key> \
//   GEOCODE_CONTACT=you@example.com \
//   node scripts/backfill-places.mjs            # dry run: prints what would change
//   node scripts/backfill-places.mjs --apply    # writes
//
// Needs the service role key (bypasses RLS) — run it locally, never commit it.
// Re-geocodes each row that has coordinates but no place_key, at 1 request per
// second per Nominatim's usage policy, caching by ~100 m so nearby rows share
// one lookup. Rows with no coordinates (IP-only) are skipped and counted.
// Safe to re-run: it only touches rows where place_key is still null.

import { createRequire } from 'node:module'
const { reverseGeocode } = createRequire(import.meta.url)('../geo.js')

const URL_BASE = process.env.SUPABASE_URL
const KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY
const CONTACT  = process.env.GEOCODE_CONTACT
const APPLY    = process.argv.includes('--apply')

if (!URL_BASE || !KEY || !CONTACT) {
    console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and GEOCODE_CONTACT (an email Nominatim can reach).')
    process.exit(1)
}

const REST = URL_BASE.replace(/\/$/, '') + '/rest/v1/'
const DB_HEADERS = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }
const GEO_HEADERS = { 'User-Agent': 'obey.tools place backfill (' + CONTACT + ')' }

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function fetchPending(table) {
    const rows = []
    for (let from = 0; ; from += 1000) {
        const res = await fetch(
            REST + table + '?select=id,latitude,longitude&place_key=is.null&order=id',
            { headers: { ...DB_HEADERS, Range: from + '-' + (from + 999) } }
        )
        if (!res.ok) throw new Error(table + ' select: HTTP ' + res.status + ' ' + await res.text())
        const page = await res.json()
        rows.push(...page)
        if (page.length < 1000) return rows
    }
}

const cache = new Map()
let lastCall = 0
async function placeFor(lat, lon) {
    const key = (+lat).toFixed(3) + ',' + (+lon).toFixed(3)
    if (cache.has(key)) return cache.get(key)
    const wait = 1100 - (Date.now() - lastCall)
    if (wait > 0) await sleep(wait)
    lastCall = Date.now()
    const place = await reverseGeocode(lat, lon, GEO_HEADERS)
    if (place) cache.set(key, place)   // don't cache failures — retry next run
    return place
}

async function backfill(table) {
    const rows = await fetchPending(table)
    const located = rows.filter(r => r.latitude != null && r.longitude != null)
    console.log(`\n${table}: ${rows.length} rows without place_key, ${located.length} with coordinates, ` +
                `${rows.length - located.length} skipped (no coordinates)`)

    let done = 0, failed = 0
    for (const r of located) {
        const place = await placeFor(r.latitude, r.longitude)
        if (!place || !place.place_key) { failed++; console.warn(`  ${r.id}: no place found`); continue }
        if (APPLY) {
            const res = await fetch(REST + table + '?id=eq.' + encodeURIComponent(r.id), {
                method: 'PATCH',
                headers: { ...DB_HEADERS, Prefer: 'return=minimal' },
                body: JSON.stringify(place)
            })
            if (!res.ok) { failed++; console.warn(`  ${r.id}: update HTTP ${res.status} ${await res.text()}`); continue }
        }
        done++
        console.log(`  ${r.id} → ${place.place_label}`)
    }
    console.log(`${table}: ${done} ${APPLY ? 'updated' : 'would update'}, ${failed} failed`)
}

await backfill('conversation_events')
await backfill('church_assessments')
if (!APPLY) console.log('\nDry run — nothing written. Re-run with --apply.')
