// status.mjs — pure derived-state + validation logic for the translation admin.
//
// Single source of truth shared by the Phase 1 editor (translations-admin.js)
// and the Phase 1 tests. Depends only on catalog.mjs, so it runs unchanged in
// the browser and in Node. Workflow state is kept SEPARATE from derived
// conditions, exactly as the schema stores it:
//   workflow_status ∈ {draft, needs_review, approved}   (stored)
//   missing / outdated / invalid / publishable          (derived here)
//
// A "value row" v is { value, workflow_status, source_hash_at_translation }
// (or null/undefined when no row exists). A "key row" k carries
// { source_value, source_hash, value_type, html_signature, array_group }.

import { placeholders, samePlaceholders, htmlSignature, hasDangerousMarkup } from './catalog.mjs'

export function hasValue(v) {
    return !!(v && v.value != null && String(v.value).trim() !== '')
}

// outdated: value present AND English changed since it was translated.
export function isOutdated(k, v) {
    return hasValue(v) && v.source_hash_at_translation !== k.source_hash
}

// invalid: placeholder drift, dangerous markup, or HTML structural drift.
// Missing values are not "invalid" (nothing to validate yet).
export function validity(k, v) {
    if (!hasValue(v)) return { valid: true, reason: null }
    const val = v.value
    if (!samePlaceholders(k.source_value, val)) {
        return { valid: false, reason: 'Placeholders differ from English: expected ' + JSON.stringify(placeholders(k.source_value)) + ', got ' + JSON.stringify(placeholders(val)) }
    }
    if (k.value_type === 'html') {
        if (hasDangerousMarkup(val)) return { valid: false, reason: 'Contains a script/handler/href vector — blocked.' }
        if (htmlSignature(val) !== k.html_signature) return { valid: false, reason: 'HTML structure differs from English (tags/attributes/classes must match exactly; only text may change).' }
    }
    return { valid: true, reason: null }
}

// Combined per-key state. `state` collapses to the workflow label, plus the
// independent outdated / valid flags.
export function keyState(k, v) {
    const has = hasValue(v)
    return {
        has,
        state: !has ? 'missing' : (v.workflow_status || 'draft'),
        outdated: isOutdated(k, v),
        ...(() => { const iv = validity(k, v); return { valid: iv.valid, reason: iv.reason } })(),
    }
}

// Publishable ⇔ present AND approved AND current AND valid. This is the SAME
// predicate the Phase 2 publisher will enforce server-side; here it drives the
// editor's "will publish" / atomic-group indicators only.
export function isPublishable(k, v) {
    const s = keyState(k, v)
    return s.has && s.state === 'approved' && !s.outdated && s.valid
}

// Atomic array group: publishes only when EVERY cell is publishable.
export function groupPublishable(cells, valueOf) {
    return cells.every(k => isPublishable(k, valueOf(k)))
}

// Human-readable reasons the group will fall back to English (empty ⇒ publishes).
export function groupBlockers(cells, valueOf) {
    const out = []
    for (const k of cells) {
        const v = valueOf(k)
        if (isPublishable(k, v)) continue
        const s = keyState(k, v)
        out.push(!s.has ? 'missing' : (s.state !== 'approved' ? s.state : (s.outdated ? 'outdated' : 'invalid')))
    }
    return [...new Set(out)]
}
