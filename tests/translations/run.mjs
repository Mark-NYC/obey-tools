// tests/translations/run.mjs — Phase-0 proof suite (pure logic, no DB, no deps).
//
//   node tests/translations/run.mjs
//
// Proves the guarantees that must hold before Phase 0 is approved:
//   1. Exact round-trip for all 10 lang files.
//   2. Atomic arrays: a partial `flow` array NEVER replaces the English array.
//   3. Overlay purity: scalars never leak English into the translated overlay.
//   4. Derived-state rules (missing/translated/outdated/approved, incl. overlap).
//   5. Placeholder validation blocks drift.
//   6. HTML markup drift & script injection are blocked for the 4 HTML keys.
//   7. Tibetan orphan quarantine (12 keys) is reported, not imported.
// Authorization / RLS / immutability proofs are SQL and live in
// 04_authorization_tests.sql (they require a live Postgres).

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
    flatten, rebuildFull, buildOverlay, merge, stringifyCanonical,
    placeholders, samePlaceholders, htmlSignature, hasDangerousMarkup,
} from '../../tools/i18n/catalog.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')
const LANG = path.join(REPO, 'lang')
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')
const load = (c) => JSON.parse(fs.readFileSync(path.join(LANG, c + '.json'), 'utf8'))

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name) } else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')) } }
const section = (s) => console.log('\n' + s)

const en = load('en')
const enLeaves = flatten(en)
const enByPath = new Map(enLeaves.map(l => [l.path, l]))
const codes = fs.readdirSync(LANG).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')).sort()

// A DB-like model of translation_values for one language, so tests can flip
// individual leaves' status/value/hash and re-run the publish algorithm.
function modelFor(code) {
    const obj = load(code)
    const byPath = new Map(flatten(obj).map(l => [l.path, l.value]))
    const rows = new Map()
    for (const l of enLeaves) {
        if (!byPath.has(l.path)) { rows.set(l.path, { value: null, workflow: 'draft', hash: null }); continue }
        rows.set(l.path, { value: byPath.get(l.path), workflow: 'approved', hash: sha256(l.value) })
    }
    return rows
}

// Derived predicates (mirror the SQL derived-state rules).
const sourceHash = (p) => sha256(enByPath.get(p).value)
const isMissing = (r) => !r || r.value == null || String(r.value).trim() === ''
const isOutdated = (p, r) => !isMissing(r) && r.hash !== sourceHash(p)
const isApproved = (r) => r && r.workflow === 'approved'
function isPublishablePath(p, r) {
    if (isMissing(r)) return false
    if (!isApproved(r)) return false
    if (isOutdated(p, r)) return false
    if (!samePlaceholders(enByPath.get(p).value, r.value)) return false
    const k = enByPath.get(p)
    if (k.valueType === 'html') {
        if (hasDangerousMarkup(r.value)) return false
        if (htmlSignature(r.value) !== htmlSignature(k.value)) return false
    }
    return true
}
const overlayFromModel = (rows) => buildOverlay({
    skeleton: en,
    valueOf: (p) => rows.get(p)?.value ?? null,
    isPublishable: (p, v) => isPublishablePath(p, rows.get(p)),
})

// ── 1. Round-trip ────────────────────────────────────────────────────────────
section('1. Exact round-trip (skeleton + values reproduces source)')
for (const code of codes) {
    const obj = load(code)
    const raw = fs.readFileSync(path.join(LANG, code + '.json'), 'utf8')
    const orphans = flatten(obj).filter(l => !enByPath.has(l.path)).map(l => l.path)
    const vm = Object.fromEntries(flatten(obj).filter(l => enByPath.has(l.path)).map(l => [l.path, l.value]))
    const rebuilt = stringifyCanonical(rebuildFull(en, vm))
    const expected = orphans.length
        ? stringifyCanonical(stripPaths(obj, orphans))
        : raw
    ok(`${code} round-trips byte-identical${orphans.length ? ' (minus ' + orphans.length + ' orphans)' : ''}`, rebuilt === expected)
}

// ── 2. Atomic arrays ──────────────────────────────────────────────────────────
section('2. Atomic arrays — a partial flow never replaces English')
{
    const group = 'cmd_study.steps.1.flow'
    const groupLeaves = enLeaves.filter(l => l.arrayGroup === group)
    ok('flow group has all cells classified under one array_group', groupLeaves.length === 6, `found ${groupLeaves.length}`)

    const enArray = group.split('.').reduce((o, k) => o[k], en)

    const breakOne = (mutate, label) => {
        const rows = modelFor('es')
        const victim = groupLeaves[groupLeaves.length - 1].path
        mutate(rows, victim)
        const overlay = overlayFromModel(rows)
        // The array must be ABSENT from the overlay (not partially present).
        const present = group.split('.').reduce((o, k) => (o == null ? undefined : o[k]), overlay)
        ok(`omit whole array when one cell is ${label}`, present === undefined)
        // After the real _merge, the rendered array is the COMPLETE English one.
        const merged = merge(JSON.parse(JSON.stringify(en)), overlay)
        const renderedArray = group.split('.').reduce((o, k) => o[k], merged)
        ok(`_merge keeps full English array when one cell is ${label}`,
            JSON.stringify(renderedArray) === JSON.stringify(enArray))
    }
    breakOne((rows, p) => rows.set(p, { value: null, workflow: 'draft', hash: null }), 'missing')
    breakOne((rows, p) => { const r = rows.get(p); r.workflow = 'needs_review' }, 'unapproved')
    breakOne((rows, p) => { const r = rows.get(p); r.hash = 'stale' }, 'outdated')
    breakOne((rows, p) => { const r = rows.get(p); r.value = r.value + ' {oops}' }, 'placeholder-invalid')

    // When every cell IS publishable, the whole array publishes with translated
    // content and _merge yields the translated array (no English text leaks).
    const rows = modelFor('es')
    const overlay = overlayFromModel(rows)
    const present = group.split('.').reduce((o, k) => (o == null ? undefined : o[k]), overlay)
    ok('fully-approved array is published whole', Array.isArray(present))
    const esArray = group.split('.').reduce((o, k) => o[k], load('es'))
    ok('published array equals the translated array (no English leakage)',
        JSON.stringify(present) === JSON.stringify(esArray))
}

// ── 3. Overlay purity (scalars) ────────────────────────────────────────────────
section('3. Overlay purity — scalars never leak English')
{
    const rows = modelFor('es')
    // Un-approve two scalar keys; their English must NOT appear in the overlay.
    const scalars = enLeaves.filter(l => !l.arrayGroup).slice(0, 2).map(l => l.path)
    for (const p of scalars) rows.get(p).workflow = 'draft'
    const overlay = overlayFromModel(rows)
    let leaked = 0
    const flatOverlay = new Map(flatten(overlay).map(l => [l.path, l.value]))
    for (const p of scalars) if (flatOverlay.get(p) === enByPath.get(p).value) leaked++
    ok('unapproved scalar keys are absent from overlay', scalars.every(p => !flatOverlay.has(p)))
    ok('no English scalar value leaked into overlay', leaked === 0)
    // Every scalar that IS present must equal the translated value, never English.
    const esFlat = new Map(flatten(load('es')).map(l => [l.path, l.value]))
    let mismatch = 0
    for (const [p, v] of flatOverlay) if (!enByPath.get(p)?.arrayGroup && v !== esFlat.get(p)) mismatch++
    ok('present scalars equal translated values', mismatch === 0)
}

// ── 4. Derived state ───────────────────────────────────────────────────────────
section('4. Derived state — missing / translated / outdated / approved')
{
    const rows = modelFor('de')
    const p = enLeaves.find(l => !l.arrayGroup).path
    // approved + outdated must both be true simultaneously.
    rows.set(p, { value: 'x', workflow: 'approved', hash: 'old-hash' })
    const r = rows.get(p)
    ok('a leaf can be approved AND outdated at once', isApproved(r) && isOutdated(p, r))
    ok('outdated leaf is not publishable', isPublishablePath(p, r) === false)
    // completion % = translated / active-translatable-keys
    const total = enLeaves.length
    const model = modelFor('de')
    const translated = [...model.entries()].filter(([, v]) => !isMissing(v)).length
    ok('completion% denominator = active translatable keys', total === 766)
    ok('de completion is 100% (fully translated corpus)', translated === total, `${translated}/${total}`)
    // approved% is tracked separately: unapprove one -> approved% < 100 but completion stays 100.
    const one = [...model.keys()][0]; model.get(one).workflow = 'draft'
    const approved = [...model.entries()].filter(([, v]) => isApproved(v) && !isMissing(v)).length
    const stillTranslated = [...model.entries()].filter(([, v]) => !isMissing(v)).length
    ok('approved% and completion% are independent', approved === total - 1 && stillTranslated === total)
}

// ── 5. Placeholder validation ──────────────────────────────────────────────────
section('5. Placeholder validation blocks drift')
{
    const p = enLeaves.find(l => l.value.includes('{email}'))?.path
    ok('found a placeholder-bearing key', !!p)
    ok('dropping {email} is rejected', !samePlaceholders(enByPath.get(p).value, enByPath.get(p).value.replace('{email}', '')))
    ok('renaming {email}->{mail} is rejected', !samePlaceholders(enByPath.get(p).value, enByPath.get(p).value.replace('{email}', '{mail}')))
    ok('identical placeholders pass', samePlaceholders(enByPath.get(p).value, enByPath.get(p).value))
}

// ── 6. HTML markup drift & injection ───────────────────────────────────────────
section('6. HTML markup drift & script injection blocked')
{
    const htmlKeys = enLeaves.filter(l => l.valueType === 'html').map(l => l.path)
    ok('exactly the 4 known HTML keys are detected', htmlKeys.length === 4, htmlKeys.join(', '))
    const subtitle = en.four_questions.subtitle
    const sig = htmlSignature(subtitle)
    ok('text-only change keeps signature (allowed)',
        htmlSignature(subtitle.replace('Start here', 'Comienza aquí')) === sig)
    ok('adding a <span> is rejected',
        htmlSignature(subtitle + ' <span class="green">x</span>') !== sig)
    ok('removing the required <span> is rejected',
        htmlSignature(subtitle.replace(/<\/?span[^>]*>/g, '')) !== sig)
    ok('changing the class is rejected',
        htmlSignature(subtitle.replace('class="green"', 'class="red"')) !== sig)
    ok('adding an onclick handler is rejected (dangerous)',
        hasDangerousMarkup(subtitle.replace('<span', '<span onclick="x()"')))
    ok('injecting <script> is rejected (dangerous)',
        hasDangerousMarkup(subtitle + '<script>alert(1)</script>'))
    // The anchor key: changing href is drift.
    const anchor = en.cmd_study.steps['3'].flow[1][1]
    ok('changing an anchor href is rejected',
        htmlSignature(anchor.replace('conversation-box.html', 'evil.com')) !== htmlSignature(anchor))
}

// ── 7. Orphan quarantine ────────────────────────────────────────────────────────
section('7. Tibetan orphan quarantine')
{
    const bo = load('bo')
    const orphans = flatten(bo).filter(l => !enByPath.has(l.path)).map(l => l.path)
    ok('bo has exactly 12 orphan keys', orphans.length === 12, orphans.length + '')
    ok('orphans are not in the English skeleton', orphans.every(p => !enByPath.has(p)))
    const nsCount = orphans.reduce((a, p) => (a[p.split('.')[0]] = (a[p.split('.')[0]] || 0) + 1, a), {})
    ok('orphans span settings/section_keys/mawl only',
        JSON.stringify(nsCount) === JSON.stringify({ settings: 8, section_keys: 3, mawl: 1 }), JSON.stringify(nsCount))
}

// helper mirrored from importer
function stripPaths(obj, paths) {
    const copy = JSON.parse(JSON.stringify(obj))
    for (const p of paths) {
        const segs = p.split('.'); let node = copy; const stack = []; let okp = true
        for (let i = 0; i < segs.length - 1; i++) { stack.push([node, segs[i]]); node = node?.[segs[i]]; if (node == null) { okp = false; break } }
        if (!okp) continue
        delete node[segs[segs.length - 1]]
        for (let i = stack.length - 1; i >= 0; i--) { const [par, key] = stack[i]; const ch = par[key]; if (ch && typeof ch === 'object' && !Array.isArray(ch) && Object.keys(ch).length === 0) delete par[key]; else break }
    }
    return copy
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} passed, ${fail} failed`)
process.exitCode = fail === 0 ? 0 : 1
