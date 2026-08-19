// translations-admin.js — Phase 1 private translation admin logic.
//
// PRIVATE TOOL. No public page imports this; the live site keeps serving static
// /lang/*.json. All reads are RLS-scoped and all mutations go through the
// Phase 0 SECURITY DEFINER RPCs — the client never writes translation tables
// directly and never bypasses RLS.
//
// "Invalid" (placeholder / HTML markup) is derived HERE with the same Phase 0
// logic (tools/i18n/catalog.mjs), so validation has a single source of truth.

import { supabase } from './supabase.js'
import { authLogIn, authForgotPassword, authLogOut } from './auth.js'
import { initAccountOverlay } from './account-overlay.js'
import { keyState, isPublishable, groupBlockers } from './tools/i18n/status.mjs'

// ── State ────────────────────────────────────────────────────────────────────
const S = {
    isAdmin: false,
    myLangs: [],          // languages this user may edit (admin => all active)
    keys: null,           // translation_keys rows, cached
    keyById: new Map(),
    groups: new Map(),    // array_group -> [keyRow] (atomic units)
    lang: null,           // currently open language code
    values: new Map(),    // key_id -> { value, workflow_status, source_hash_at_translation }
    filter: 'all',
    area: 'all',
    search: '',
    orphans: null,        // from the import report (diagnostic only)
}

const el = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// Natural sort so array cells order as 0,1,2,…,10 not lexically.
function naturalCmp(a, b) {
    const pa = a.split('.'), pb = b.split('.')
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i], y = pb[i]
        if (x === undefined) return -1
        if (y === undefined) return 1
        const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y)
        if (nx && ny) { const d = (+x) - (+y); if (d) return d }
        else if (x !== y) return x < y ? -1 : 1
    }
    return 0
}

// Derived per-key state + validation are imported from tools/i18n/status.mjs
// (the single source of truth shared with the Phase 1 tests).

// ── Auth gating ──────────────────────────────────────────────────────────────
export async function initTranslationAdminPage() {
    initAccountOverlay()
    const apply = async (session) => {
        const denied = el('access-denied'), main = el('main-container')
        const deniedAuth = el('denied-auth')
        if (deniedAuth) deniedAuth.style.display = session?.user ? 'none' : ''
        if (!session?.user) { denied.style.display = 'flex'; main.style.display = 'none'; return }
        const [{ data: adminData }, { data: access }] = await Promise.all([
            supabase.rpc('is_translation_admin'),
            supabase.from('translator_language_access').select('language_code'),
        ])
        S.isAdmin = adminData === true
        S.myLangs = (access || []).map(r => r.language_code)
        if (!S.isAdmin && S.myLangs.length === 0) {
            denied.style.display = 'flex'; main.style.display = 'none'
            el('denied-sub').textContent = 'You are signed in, but have no translation access. Ask an admin to assign you a language.'
            return
        }
        denied.style.display = 'none'; main.style.display = ''
        el('signed-in-as').textContent = session.user.email + (S.isAdmin ? '  ·  admin' : '  ·  translator')
        el('admin-only').style.display = S.isAdmin ? '' : 'none'
        await loadDashboard()
    }
    supabase.auth.getSession().then(({ data: { session } }) => apply(session))
    supabase.auth.onAuthStateChange((_e, session) => apply(session))
}

// ── Keys (cached) ────────────────────────────────────────────────────────────
async function ensureKeys() {
    if (S.keys) return
    const { data, error } = await supabase.from('translation_keys').select('*').limit(2000)
    if (error) throw error
    S.keys = data.filter(k => k.is_active && k.is_translatable).sort((a, b) => naturalCmp(a.key_path, b.key_path))
    S.keyById = new Map(S.keys.map(k => [k.id, k]))
    S.groups = new Map()
    for (const k of S.keys) if (k.array_group) {
        if (!S.groups.has(k.array_group)) S.groups.set(k.array_group, [])
        S.groups.get(k.array_group).push(k)
    }
    // load orphan diagnostics (report is a static artifact; display only)
    try {
        const r = await fetch('/supabase/translations-migration/report.json')
        if (r.ok) { const j = await r.json(); S.orphans = j.orphans || {} }
    } catch { S.orphans = {} }
}

// ── Dashboard ────────────────────────────────────────────────────────────────
async function loadDashboard() {
    el('editor').style.display = 'none'
    el('dashboard').style.display = ''
    await ensureKeys()
    const { data, error } = await supabase.from('translation_language_stats').select('*')
    if (error) { el('lang-rows').innerHTML = `<tr><td colspan="8">Error: ${esc(error.message)}</td></tr>`; return }
    const rows = (data || []).sort((a, b) => a.english_name.localeCompare(b.english_name))
    el('lang-rows').innerHTML = rows.map(r => {
        const pct = r.total_keys ? Math.round(100 * r.translated / r.total_keys) : 0
        const appr = r.total_keys ? Math.round(100 * r.approved / r.total_keys) : 0
        const blocked = (r.missing || 0) + (r.outdated || 0) + (r.needs_review || 0)
        return `<tr>
          <td><b>${esc(r.native_name)}</b><div class="sub">${esc(r.english_name)} · ${esc(r.code)} · ${esc(r.direction)}${r.is_active ? '' : ' · inactive'}</div></td>
          <td>${bar(pct)} <span class="pct">${pct}%</span></td>
          <td>${appr}%</td>
          <td class="${r.missing ? 'warn' : ''}">${r.missing}</td>
          <td class="${r.outdated ? 'warn' : ''}">${r.outdated}</td>
          <td class="${r.needs_review ? 'review' : ''}">${r.needs_review}</td>
          <td>${r.published_version ?? '—'}</td>
          <td><button class="btn" onclick="openEditor('${esc(r.code)}')">Open editor ›</button></td>
        </tr>`
    }).join('') || `<tr><td colspan="8">No languages you can edit.</td></tr>`

    // Orphan diagnostic banner (never enters workflow)
    const orphCount = Object.values(S.orphans || {}).reduce((a, v) => a + v.length, 0)
    el('orphan-banner').style.display = orphCount ? '' : 'none'
    el('orphan-count').textContent = orphCount
}
const bar = (p) => `<span class="track"><span class="fill" style="width:${p}%"></span></span>`

// ── Editor ───────────────────────────────────────────────────────────────────
async function openEditor(lang) {
    if (!S.isAdmin && !S.myLangs.includes(lang)) { alert('You are not assigned to this language.'); return }
    S.lang = lang; S.filter = 'all'; S.area = 'all'; S.search = ''
    await ensureKeys()
    await loadValues(lang)
    el('dashboard').style.display = 'none'
    el('editor').style.display = ''
    el('editor-lang').textContent = lang
    el('search').value = ''
    el('approve-controls').style.display = S.isAdmin ? '' : 'none'
    buildAreaFilter()
    renderEditor()
}
async function loadValues(lang) {
    S.values = new Map()
    const { data, error } = await supabase.from('translation_values')
        .select('key_id,value,workflow_status,source_hash_at_translation').eq('language_code', lang).limit(2000)
    if (error) { alert('Load error: ' + error.message); return }
    for (const v of data) S.values.set(v.key_id, v)
}
function buildAreaFilter() {
    const areas = [...new Set(S.keys.map(k => k.area))].sort()
    el('area-filter').innerHTML = `<option value="all">All areas</option>` +
        areas.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('')
}

function counts() {
    const c = { all: S.keys.length, missing: 0, draft: 0, needs_review: 0, approved: 0, outdated: 0, invalid: 0 }
    for (const k of S.keys) {
        const s = keyState(k, S.values.get(k.id))
        if (!s.has) c.missing++; else c[s.state]++
        if (s.outdated) c.outdated++
        if (!s.valid) c.invalid++
    }
    return c
}

function matchFilter(k, s) {
    if (S.area !== 'all' && k.area !== S.area) return false
    if (S.search) {
        const q = S.search.toLowerCase()
        const v = S.values.get(k.id)?.value || ''
        if (!(k.key_path.toLowerCase().includes(q) || String(k.source_value).toLowerCase().includes(q) || v.toLowerCase().includes(q))) return false
    }
    switch (S.filter) {
        case 'missing': return !s.has
        case 'draft': return s.has && s.state === 'draft'
        case 'needs_review': return s.state === 'needs_review'
        case 'approved': return s.state === 'approved'
        case 'outdated': return s.outdated
        case 'invalid': return !s.valid
        default: return true
    }
}

function renderEditor() {
    const c = counts()
    el('filter-bar').innerHTML = ['all', 'missing', 'draft', 'needs_review', 'approved', 'outdated', 'invalid']
        .map(f => `<button class="chip ${S.filter === f ? 'on' : ''}" onclick="setFilter('${f}')">${f.replace('_', ' ')} <b>${c[f]}</b></button>`).join('')
    const pct = c.all ? Math.round(100 * (c.all - c.missing) / c.all) : 0
    const appr = c.all ? Math.round(100 * c.approved / c.all) : 0
    el('editor-progress').innerHTML = `${bar(pct)} <span class="pct">${pct}% translated</span> · <span class="pct">${appr}% approved</span> · ${c.missing} missing · ${c.outdated} outdated · ${c.invalid} invalid`

    // Order keys, but keep atomic groups contiguous with a group header.
    const shown = S.keys.filter(k => matchFilter(k, keyState(k, S.values.get(k.id))))
    const out = []
    const renderedGroups = new Set()
    for (const k of shown) {
        if (k.array_group) {
            if (renderedGroups.has(k.array_group)) continue
            renderedGroups.add(k.array_group)
            out.push(renderGroup(k.array_group))
        } else {
            out.push(renderItem(k))
        }
    }
    el('items').innerHTML = out.join('') || `<div class="empty">Nothing matches this filter.</div>`
}

function badges(k, s) {
    const b = []
    const label = !s.has ? 'missing' : s.state
    const cls = { missing: 'b-missing', draft: 'b-draft', needs_review: 'b-review', approved: 'b-approved' }[label] || 'b-draft'
    b.push(`<span class="badge ${cls}">${label.replace('_', ' ')}</span>`)
    if (s.outdated) b.push(`<span class="badge b-outdated" title="English changed after this was translated">outdated</span>`)
    if (!s.valid) b.push(`<span class="badge b-invalid" title="${esc(s.reason)}">invalid</span>`)
    if (isPublishable(k, S.values.get(k.id))) b.push(`<span class="badge b-pub">will publish</span>`)
    return b.join(' ')
}

function renderItem(k) {
    const v = S.values.get(k.id)
    const s = keyState(k, v)
    const val = v?.value ?? ''
    const canEdit = S.isAdmin || S.myLangs.includes(S.lang)
    return `<div class="item" data-key="${k.id}">
      <div class="item-head">
        <div class="ctx">${esc(k.area)} · <span class="ns">${esc(k.namespace)}</span>${k.value_type === 'html' ? ' · <span class="html-tag">HTML</span>' : ''}</div>
        <div>${badges(k, s)}</div>
      </div>
      <div class="src">${esc(k.source_value)}</div>
      <div class="keypath">${esc(k.key_path)}${k.context ? ' — ' + esc(k.context) : ''}</div>
      <textarea class="tr" ${canEdit ? '' : 'disabled'} oninput="markDirty(${k.id})" id="ta-${k.id}">${esc(val)}</textarea>
      ${s.reason ? `<div class="reason">⚠ ${esc(s.reason)}</div>` : ''}
      <div class="actions">
        <button class="btn" onclick="saveDraft(${k.id})">Save draft</button>
        <button class="btn ghost" onclick="submitReview(${k.id})">Submit for review</button>
        <span id="approve-${k.id}" class="approve-inline" style="${S.isAdmin ? '' : 'display:none'}">
          <button class="btn ok" onclick="approve(${k.id}, true)">Approve</button>
          <button class="btn no" onclick="approve(${k.id}, false)">Reject</button>
        </span>
        <span class="save-note" id="note-${k.id}"></span>
      </div>
    </div>`
}

// Atomic array group — rendered as one visible unit with an all-or-English banner.
function renderGroup(groupPath) {
    const cells = S.groups.get(groupPath).slice().sort((a, b) => naturalCmp(a.key_path, b.key_path))
    const valueOf = (k) => S.values.get(k.id)
    const blockers = groupBlockers(cells, valueOf)
    const banner = blockers.length === 0
        ? `<div class="grp-ok">✓ Atomic group — every cell is approved &amp; valid. This group will publish as a unit.</div>`
        : `<div class="grp-warn">⚠ Atomic group — publishes all-or-nothing. Because some cells are ${esc(blockers.join(', '))}, <b>the entire group falls back to English</b> even though some cells may be translated.</div>`
    return `<div class="group">
      <div class="grp-head">Atomic array · <span class="mono">${esc(groupPath)}</span></div>
      ${banner}
      ${cells.map(renderItem).join('')}
    </div>`
}

// ── Mutations (all via Phase 0 RPCs) ────────────────────────────────────────
function note(id, msg, cls = '') { const n = el('note-' + id); if (n) { n.textContent = msg; n.className = 'save-note ' + cls } }
window.markDirty = (id) => note(id, 'unsaved…', 'dirty')

async function refreshKey(id) {
    const { data } = await supabase.from('translation_values')
        .select('key_id,value,workflow_status,source_hash_at_translation').eq('language_code', S.lang).eq('key_id', id).maybeSingle()
    if (data) S.values.set(id, data)
    // Re-render just this item's badges/reason + its group banner if any.
    renderEditor()
}
window.saveDraft = async (id) => {
    const val = el('ta-' + id).value
    const { error } = await supabase.rpc('save_translation', { p_key_id: id, p_lang: S.lang, p_value: val })
    if (error) return note(id, 'Error: ' + error.message, 'err')
    note(id, 'saved (draft)', 'ok')
    await refreshKey(id)
}
window.submitReview = async (id) => {
    const val = el('ta-' + id).value
    // Persist current text first so review sees the latest.
    const save = await supabase.rpc('save_translation', { p_key_id: id, p_lang: S.lang, p_value: val })
    if (save.error) return note(id, 'Error: ' + save.error.message, 'err')
    const { error } = await supabase.rpc('submit_for_review', { p_key_id: id, p_lang: S.lang })
    if (error) return note(id, 'Error: ' + error.message, 'err')
    note(id, 'submitted for review', 'ok')
    await refreshKey(id)
}
window.approve = async (id, ok) => {
    const { error } = await supabase.rpc('review_decision', { p_key_id: id, p_lang: S.lang, p_approve: ok })
    if (error) return note(id, 'Error: ' + error.message, 'err')
    note(id, ok ? 'approved' : 'rejected → draft', 'ok')
    await refreshKey(id)
}

window.setFilter = (f) => { S.filter = f; renderEditor() }
window.openEditor = openEditor
window.backToDashboard = () => loadDashboard()
window.doSearch = () => { S.search = el('search').value.trim(); renderEditor() }
window.setArea = () => { S.area = el('area-filter').value; renderEditor() }

// ── Admin: assignment panel + orphan diagnostics ────────────────────────────
window.openAssign = async () => {
    if (!S.isAdmin) return
    el('assign-panel').style.display = ''
    await refreshAccess()
}
window.closeAssign = () => { el('assign-panel').style.display = 'none' }
async function refreshAccess() {
    const { data, error } = await supabase.rpc('list_translation_access')
    if (error) { el('access-list').innerHTML = `<div class="reason">${esc(error.message)}</div>`; return }
    el('access-list').innerHTML = (data || []).map(a =>
        `<div class="access-row"><span>${esc(a.email)} → <b>${esc(a.language_code)}</b></span>
         <button class="btn no" onclick="revokeAccess('${esc(a.user_id)}','${esc(a.language_code)}')">Revoke</button></div>`
    ).join('') || '<div class="sub">No assignments yet.</div>'
}
window.assignTranslator = async () => {
    const email = el('assign-email').value.trim(), lang = el('assign-lang').value
    if (!email) return
    const { error } = await supabase.rpc('assign_translator_by_email', { p_email: email, p_lang: lang })
    el('assign-note').textContent = error ? ('Error: ' + error.message) : ('Assigned ' + email + ' → ' + lang)
    if (!error) { el('assign-email').value = ''; await refreshAccess() }
}
window.revokeAccess = async (uid, lang) => {
    const { error } = await supabase.rpc('revoke_translator', { p_user: uid, p_lang: lang })
    if (!error) await refreshAccess()
}
window.openOrphans = () => {
    const box = el('orphan-list')
    const entries = Object.entries(S.orphans || {})
    box.innerHTML = entries.map(([code, keys]) =>
        `<div class="orph-lang"><b>${esc(code)}</b> (${keys.length}) — quarantined, cannot enter the catalog:</div>` +
        keys.map(k => `<div class="mono orph-key">${esc(k)}</div>`).join('')
    ).join('') || '<div class="sub">No orphan keys.</div>'
    el('orphan-panel').style.display = ''
}
window.closeOrphans = () => { el('orphan-panel').style.display = 'none' }

// expose auth helpers used by the denied panel
window.authLogIn = authLogIn
window.authForgotPassword = authForgotPassword
window.authLogOut = authLogOut

initTranslationAdminPage()
