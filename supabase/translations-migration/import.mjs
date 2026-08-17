// import.mjs — Phase-0 offline importer & validator.
//
// Reads every /lang/*.json, derives the English skeleton (translation_keys) and
// each language's values (translation_values), classifies orphans / mismatches,
// proves an exact round-trip, and emits:
//   * report.json                       — machine-readable audit
//   * report.md                         — human summary (incl. Tibetan orphans)
//   * seed/01_keys.sql                  — INSERT translation_keys (English)
//   * seed/02_values_<lang>.sql         — INSERT translation_values per language
//
// It writes NOTHING to the database and changes NO runtime files. Run:
//   node supabase/translations-migration/import.mjs
//
// English is imported UNCHANGED. Orphan keys (in a translation but not in
// English — the 12 known Tibetan `settings.*` keys) are quarantined: reported,
// never seeded, never promoted into English, never published.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
    flatten, rebuildFull, stringifyCanonical, placeholders, samePlaceholders,
    isHtml, htmlSignature, hasDangerousMarkup, namespaceOf,
} from '../../tools/i18n/catalog.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')
const LANG_DIR = path.join(REPO, 'lang')
const OUT = path.join(HERE, 'seed')
const SOURCE = 'en'

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')

// Editor "area" grouping — binding taxonomy from the architecture plan.
const AREA_BY_NS = {
    // Global UI
    common: 'Global UI', nav: 'Global UI', settings: 'Global UI', pwa: 'Global UI',
    sync: 'Global UI', access: 'Global UI', index: 'Global UI',
    component_keys: 'Global UI', section_keys: 'Global UI', study_ui: 'Global UI',
    // Account and Authentication
    auth: 'Account and Authentication',
    // Conversation Box
    conversation_box: 'Conversation Box',
    // Stories of Hope
    stories_of_hope: 'Stories of Hope', story_study: 'Stories of Hope',
    // 4 Questions
    four_questions: '4 Questions',
    // Commands of Christ
    commands_of_christ: 'Commands of Christ', cmd_study: 'Commands of Christ',
    worship_page: 'Commands of Christ', pray_page: 'Commands of Christ',
    gather: 'Commands of Christ', generosity: 'Commands of Christ',
    lords_supper: 'Commands of Christ', be_baptized: 'Commands of Christ',
    repent_and_believe: 'Commands of Christ', holy_spirit: 'Commands of Christ',
    signs_and_wonders: 'Commands of Christ', go_make_disciples: 'Commands of Christ',
    love_one_another: 'Commands of Christ', the_word_of_god: 'Commands of Christ',
    // Church Circle
    church_assessment: 'Church Circle',
    // Signs of John (its own area — NOT under Church Circle)
    signs_of_john: 'Signs of John',
    // Leader Tools
    leader_tools: 'Leader Tools', invite: 'Leader Tools', mawl: 'Leader Tools',
    view_progress: 'Leader Tools', how_were_doing: 'Leader Tools',
}
const areaFor = (ns) => {
    if (AREA_BY_NS[ns]) return AREA_BY_NS[ns]
    if (ns.startsWith('hope_')) return 'Stories of Hope'
    if (ns.startsWith('john_')) return 'Signs of John'
    return 'Global UI'
}

function loadLangs() {
    const files = fs.readdirSync(LANG_DIR).filter(f => f.endsWith('.json')).sort()
    const langs = {}
    for (const f of files) {
        const code = f.replace(/\.json$/, '')
        langs[code] = { raw: fs.readFileSync(path.join(LANG_DIR, f), 'utf8') }
        langs[code].obj = JSON.parse(langs[code].raw)
    }
    return langs
}

function sqlStr(s) { return s === null || s === undefined ? 'null' : "'" + String(s).replace(/'/g, "''") + "'" }

function main() {
    const langs = loadLangs()
    if (!langs[SOURCE]) throw new Error('Missing English source lang/en.json')

    // ── translation_keys from English skeleton ──
    const enLeaves = flatten(langs[SOURCE].obj)
    const keys = enLeaves.map(l => ({
        key_path: l.path,
        namespace: namespaceOf(l.path),
        area: areaFor(namespaceOf(l.path)),
        value_type: l.valueType,
        array_group: l.arrayGroup,
        source_value: l.value,
        source_hash: sha256(l.value),
        html_signature: l.valueType === 'html' ? htmlSignature(l.value) : null,
    }))
    const enPaths = new Set(keys.map(k => k.key_path))

    const report = {
        generated_at: new Date().toISOString(),
        source: SOURCE,
        totals: { languages: Object.keys(langs).length, english_keys: keys.length },
        value_types: keys.reduce((a, k) => (a[k.value_type] = (a[k.value_type] || 0) + 1, a), {}),
        array_groups: [...new Set(keys.filter(k => k.array_group).map(k => k.array_group))],
        html_keys: keys.filter(k => k.value_type === 'html').map(k => ({ key: k.key_path, signature: k.html_signature })),
        languages: {},
        roundtrip: {},
        orphans: {},
        placeholder_issues: {},
        html_issues: {},
    }

    // ── per-language values + classification ──
    const values = {} // code -> [{key_path,value,...}]
    for (const [code, { obj }] of Object.entries(langs)) {
        if (code === SOURCE) continue
        const leaves = flatten(obj)
        const byPath = new Map(leaves.map(l => [l.path, l.value]))

        const missing = keys.filter(k => !byPath.has(k.key_path)).map(k => k.key_path)
        const orphans = leaves.filter(l => !enPaths.has(l.path)).map(l => l.path)
        const placeholderIssues = []
        const htmlIssues = []
        const rows = []

        for (const k of keys) {
            if (!byPath.has(k.key_path)) continue
            const val = byPath.get(k.key_path)
            let flagged = false
            if (!samePlaceholders(k.source_value, val)) {
                placeholderIssues.push({ key: k.key_path, en: placeholders(k.source_value), tr: placeholders(val) })
                flagged = true
            }
            if (k.value_type === 'html') {
                if (hasDangerousMarkup(val)) { htmlIssues.push({ key: k.key_path, kind: 'dangerous_markup' }); flagged = true }
                else if (htmlSignature(val) !== k.html_signature) { htmlIssues.push({ key: k.key_path, kind: 'markup_drift' }); flagged = true }
            }
            // Existing live translations import as 'approved' (they were shipping).
            // Anything that fails placeholder or markup validation imports as
            // 'needs_review' instead, so an admin sees it rather than it silently
            // falling back to English at publish. Hash is pinned to the current
            // source hash so nothing imports pre-marked outdated.
            rows.push({
                key_path: k.key_path, value: val,
                workflow_status: flagged ? 'needs_review' : 'approved',
                source_hash_at_translation: k.source_hash,
            })
        }
        values[code] = rows

        // Fidelity round-trip: English skeleton + this language's values must
        // reproduce the original file byte-for-byte (minus quarantined orphans).
        const rebuilt = stringifyCanonical(rebuildFull(langs[SOURCE].obj, Object.fromEntries(rows.map(r => [r.key_path, r.value]))))
        // Strip orphans from the original for a fair comparison (orphans are not
        // representable in the skeleton and are intentionally dropped).
        const originalNoOrphans = stringifyCanonical(stripPaths(obj, orphans))
        const identical = rebuilt === originalNoOrphans

        report.languages[code] = {
            leaf_count: leaves.length, matched: rows.length,
            missing: missing.length, orphans: orphans.length,
            placeholder_issues: placeholderIssues.length, html_issues: htmlIssues.length,
        }
        report.roundtrip[code] = identical ? 'IDENTICAL' : 'MISMATCH'
        if (missing.length) report.languages[code].missing_keys = missing
        if (orphans.length) report.orphans[code] = orphans
        if (placeholderIssues.length) report.placeholder_issues[code] = placeholderIssues
        if (htmlIssues.length) report.html_issues[code] = htmlIssues
    }

    // English self round-trip.
    report.roundtrip[SOURCE] =
        stringifyCanonical(rebuildFull(langs[SOURCE].obj, Object.fromEntries(enLeaves.map(l => [l.path, l.value])))) === langs[SOURCE].raw
            ? 'IDENTICAL' : 'MISMATCH'

    writeOutputs(report, keys, values)
    printSummary(report)
    const bad = Object.values(report.roundtrip).some(v => v !== 'IDENTICAL')
    process.exitCode = bad ? 1 : 0
}

// Return a deep copy of obj with the given dotted leaf paths removed (and any
// containers left empty as a result pruned), so orphan keys don't skew the
// round-trip comparison.
function stripPaths(obj, paths) {
    const copy = JSON.parse(JSON.stringify(obj))
    for (const p of paths) {
        const segs = p.split('.')
        let node = copy
        const stack = []
        let ok = true
        for (let i = 0; i < segs.length - 1; i++) { stack.push([node, segs[i]]); node = node?.[segs[i]]; if (node == null) { ok = false; break } }
        if (!ok) continue
        delete node[segs[segs.length - 1]]
        for (let i = stack.length - 1; i >= 0; i--) {
            const [parent, key] = stack[i]
            const child = parent[key]
            if (child && typeof child === 'object' && !Array.isArray(child) && Object.keys(child).length === 0) delete parent[key]
            else break
        }
    }
    return copy
}

function writeOutputs(report, keys, values) {
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(path.join(HERE, 'report.json'), JSON.stringify(report, null, 2))
    fs.writeFileSync(path.join(HERE, 'report.md'), renderMd(report))

    // seed/01_keys.sql
    const kLines = keys.map(k =>
        `insert into public.translation_keys (key_path,namespace,area,value_type,is_translatable,array_group,source_value,source_hash,html_signature) values (` +
        `${sqlStr(k.key_path)},${sqlStr(k.namespace)},${sqlStr(k.area)},${sqlStr(k.value_type)},true,${sqlStr(k.array_group)},${sqlStr(k.source_value)},${sqlStr(k.source_hash)},${sqlStr(k.html_signature)});`)
    fs.writeFileSync(path.join(OUT, '01_keys.sql'),
        `-- Generated by import.mjs — English skeleton (${keys.length} leaves). Do not edit by hand.\nbegin;\n${kLines.join('\n')}\ncommit;\n`)

    // seed/02_values_<lang>.sql
    for (const [code, rows] of Object.entries(values)) {
        const vLines = rows.map(r =>
            `insert into public.translation_values (key_id,language_code,value,workflow_status,source_hash_at_translation) ` +
            `select id,${sqlStr(code)},${sqlStr(r.value)},${sqlStr(r.workflow_status)},${sqlStr(r.source_hash_at_translation)} ` +
            `from public.translation_keys where key_path=${sqlStr(r.key_path)};`)
        fs.writeFileSync(path.join(OUT, `02_values_${code}.sql`),
            `-- Generated by import.mjs — ${code} (${rows.length} values). Do not edit by hand.\nbegin;\n${vLines.join('\n')}\ncommit;\n`)
    }
}

function renderMd(r) {
    const L = []
    L.push('# Translation import report', '', `Generated: ${r.generated_at}`, '')
    L.push(`- Languages: **${r.totals.languages}**`, `- English leaf keys: **${r.totals.english_keys}**`)
    L.push(`- Value types: ${JSON.stringify(r.value_types)}`, `- Atomic array groups: **${r.array_groups.length}**`, '')
    L.push('## Round-trip (skeleton + values reproduces source file)', '')
    L.push('| Lang | Round-trip | Matched | Missing | Orphans | Placeholder | HTML |', '|---|---|---|---|---|---|---|')
    for (const code of Object.keys(r.roundtrip).sort()) {
        const s = r.languages[code] || {}
        L.push(`| ${code} | ${r.roundtrip[code]} | ${s.matched ?? '—'} | ${s.missing ?? 0} | ${s.orphans ?? 0} | ${s.placeholder_issues ?? 0} | ${s.html_issues ?? 0} |`)
    }
    L.push('', '## HTML-bearing keys (markup locked at publish)', '')
    for (const h of r.html_keys) L.push(`- \`${h.key}\``)
    if (Object.keys(r.orphans).length) {
        L.push('', '## Quarantined orphan keys (manual review — not imported, not published)', '')
        for (const [code, ks] of Object.entries(r.orphans)) { L.push(`**${code}** (${ks.length}):`); for (const k of ks) L.push(`- \`${k}\``) }
    }
    if (Object.keys(r.placeholder_issues).length) { L.push('', '## Placeholder mismatches', ''); L.push('```json', JSON.stringify(r.placeholder_issues, null, 2), '```') }
    if (Object.keys(r.html_issues).length) { L.push('', '## HTML markup issues', ''); L.push('```json', JSON.stringify(r.html_issues, null, 2), '```') }
    return L.join('\n') + '\n'
}

function printSummary(r) {
    console.log(`\nImported ${r.totals.english_keys} English keys across ${r.totals.languages} languages.`)
    console.log('Round-trip:', Object.entries(r.roundtrip).map(([k, v]) => `${k}=${v}`).join('  '))
    const orph = Object.entries(r.orphans).map(([k, v]) => `${k}:${v.length}`).join(', ') || 'none'
    console.log('Quarantined orphans:', orph)
    console.log('Placeholder issues:', Object.keys(r.placeholder_issues).length, ' HTML issues:', Object.keys(r.html_issues).length)
    console.log('Outputs: report.json, report.md, seed/01_keys.sql, seed/02_values_*.sql')
}

main()
