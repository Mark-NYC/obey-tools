// tests/translations/phase1.mjs — Phase 1 derived-state / workflow / atomic-group
// proofs. Pure logic over tools/i18n/status.mjs (the same module the editor uses).
// Authorization proofs are SQL: see 04_authorization_tests.sql and
// 06_phase1_authz_tests.sql.
//
//   node tests/translations/phase1.mjs

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { flatten, htmlSignature, isHtml } from '../../tools/i18n/catalog.mjs'
import { keyState, isPublishable, isOutdated, validity, groupBlockers, hasValue } from '../../tools/i18n/status.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')
const LANG = path.join(REPO, 'lang')
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')
const load = (c) => JSON.parse(fs.readFileSync(path.join(LANG, c + '.json'), 'utf8'))

let pass = 0, fail = 0
const ok = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')) } }
const section = (s) => console.log('\n' + s)

// Build key rows (like translation_keys) from the English skeleton.
const en = load('en')
const keys = flatten(en).map(l => ({
    id: l.path, key_path: l.path, array_group: l.arrayGroup,
    value_type: isHtml(l.value) ? 'html' : 'string',
    source_value: l.value, source_hash: sha256(l.value),
    html_signature: isHtml(l.value) ? htmlSignature(l.value) : null,
}))
const keyByPath = new Map(keys.map(k => [k.key_path, k]))
// A "value row" as approved & current (an imported translation).
const approvedRow = (k, value) => ({ value, workflow_status: 'approved', source_hash_at_translation: k.source_hash })
// A plain scalar key with no placeholders / HTML, so an arbitrary translation
// string is structurally valid on its own.
const plain = keys.find(x => x.array_group == null && x.value_type === 'string' && !/\{/.test(x.source_value) && x.source_value.trim())

section('1. Derived states (missing / draft / needs_review / approved)')
{
    const k = plain
    ok('no row => missing', keyState(k, undefined).state === 'missing' && !keyState(k, undefined).has)
    ok('empty value => missing', keyState(k, approvedRow(k, '   ')).state === 'missing')
    ok('draft row => draft', keyState(k, { value: 'x', workflow_status: 'draft', source_hash_at_translation: k.source_hash }).state === 'draft')
    ok('needs_review row => needs_review', keyState(k, { value: 'x', workflow_status: 'needs_review', source_hash_at_translation: k.source_hash }).state === 'needs_review')
    ok('approved row => approved', keyState(k, approvedRow(k, 'x')).state === 'approved')
}

section('2. Publishable predicate (present + approved + current + valid)')
{
    const k = plain
    ok('approved+current+valid is publishable', isPublishable(k, approvedRow(k, 'hola')))
    ok('draft is NOT publishable', !isPublishable(k, { value: 'hola', workflow_status: 'draft', source_hash_at_translation: k.source_hash }))
    ok('needs_review is NOT publishable', !isPublishable(k, { value: 'hola', workflow_status: 'needs_review', source_hash_at_translation: k.source_hash }))
    ok('missing is NOT publishable', !isPublishable(k, undefined))
}

section('3. Outdated is separate from approved (English changed)')
{
    const k = plain
    const stale = { value: 'hola', workflow_status: 'approved', source_hash_at_translation: 'old-hash' }
    ok('approved AND outdated simultaneously', keyState(k, stale).state === 'approved' && isOutdated(k, stale))
    ok('outdated approved value is NOT publishable', !isPublishable(k, stale))
}

section('4. Invalid: placeholder drift and HTML drift')
{
    const kp = keys.find(x => x.source_value.includes('{email}'))
    const badPh = approvedRow(kp, kp.source_value.replace('{email}', ''))
    ok('placeholder drop => invalid', !validity(kp, badPh).valid && !isPublishable(kp, badPh))
    ok('identical placeholders => valid', validity(kp, approvedRow(kp, kp.source_value)).valid)

    const kh = keyByPath.get('four_questions.subtitle')
    ok('four_questions.subtitle is an HTML key', kh.value_type === 'html')
    // The real Tibetan value (four green spans vs one) must be invalid.
    const boVal = load('bo').four_questions.subtitle
    ok('bo subtitle markup drift => invalid (needs review, not publishable)',
        !validity(kh, approvedRow(kh, boVal)).valid && !isPublishable(kh, approvedRow(kh, boVal)))
    ok('text-only HTML change stays valid',
        validity(kh, approvedRow(kh, kh.source_value.replace('Start here', 'Empieza aquí'))).valid)
    const inject = approvedRow(kh, kh.source_value + '<script>alert(1)</script>')
    ok('script injection => invalid', !validity(kh, inject).valid)
}

section('5. Atomic groups — all-or-English is visible')
{
    const group = 'cmd_study.steps.1.flow'
    const cells = keys.filter(k => k.array_group === group)
    ok('flow group resolves to its cells', cells.length === 6, String(cells.length))
    const es = load('es')
    const valAt = (kp) => kp.split('.').reduce((o, s) => o?.[s], es)
    // All approved & current => group publishes (no blockers).
    const full = new Map(cells.map(k => [k.id, approvedRow(k, valAt(k.key_path))]))
    ok('fully approved group => no blockers (publishes as a unit)', groupBlockers(cells, k => full.get(k.id)).length === 0)
    // Break one cell each way => group blocked.
    for (const [mut, label] of [
        [(m, id) => m.set(id, undefined), 'missing'],
        [(m, id) => { m.get(id).workflow_status = 'needs_review' }, 'unapproved'],
        [(m, id) => { m.get(id).source_hash_at_translation = 'stale' }, 'outdated'],
        [(m, id) => { m.get(id).value += ' {oops}' }, 'invalid-placeholder'],
    ]) {
        const m = new Map(cells.map(k => [k.id, approvedRow(k, valAt(k.key_path))]))
        mut(m, cells[cells.length - 1].id)
        ok(`one ${label} cell blocks the whole group`, groupBlockers(cells, k => m.get(k.id)).length > 0)
    }
}

section('6. Orphan keys can never enter the workflow')
{
    const report = JSON.parse(fs.readFileSync(path.join(REPO, 'supabase/translations-migration/report.json'), 'utf8'))
    const orphans = Object.values(report.orphans || {}).flat()
    ok('report lists the 12 Tibetan orphans', orphans.length === 12, String(orphans.length))
    // No orphan corresponds to a translation_keys row => no editable key => cannot be saved/reviewed/approved.
    ok('no orphan has a key row (unreachable by the editor)', orphans.every(p => !keyByPath.has(p)))
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} passed, ${fail} failed`)
process.exitCode = fail === 0 ? 0 : 1
