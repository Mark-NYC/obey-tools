// catalog.mjs — pure, dependency-free translation-catalog logic.
//
// This is Phase-0 tooling (importer + tests). It performs NO runtime changes:
// no HTML page imports it. It exists so that the database representation can be
// proven, byte-for-byte, to reproduce today's /lang/*.json files, and so the
// atomic-array publishing rules can be tested before any schema is applied.
//
// Design invariants (see the architecture plan):
//   * English is the structural skeleton. Structure is NEVER inferred from key
//     paths — it is taken from the English object — so object-vs-array
//     containers (e.g. `steps` keyed "1".."8" vs the `flow` array) can never be
//     corrupted.
//   * The app's i18n.js deep-merges an overlay over English and REPLACES arrays
//     wholesale. A partial translated array would therefore destroy the
//     untranslated English cells, so arrays publish atomically (all-or-nothing).

// ── Canonical serialization ─────────────────────────────────────────────────
// Matches the on-disk format exactly: 2-space indent, raw UTF-8 (JSON.stringify
// does not escape non-ASCII), trailing newline. Verified byte-identical against
// all 10 lang files via JSON.parse -> this function.
export function stringifyCanonical(obj) {
    return JSON.stringify(obj, null, 2) + '\n'
}

// ── Placeholders ────────────────────────────────────────────────────────────
// Mirrors i18n.js t(): interpolation tokens are /\{(\w+)\}/g.
export function placeholders(str) {
    if (typeof str !== 'string') return []
    const set = new Set()
    for (const m of str.matchAll(/\{(\w+)\}/g)) set.add(m[1])
    return [...set].sort()
}

export function samePlaceholders(a, b) {
    const pa = placeholders(a), pb = placeholders(b)
    return pa.length === pb.length && pa.every((x, i) => x === pb[i])
}

// ── HTML detection & signature ──────────────────────────────────────────────
// A leaf is "html" when its English source contains markup, OR when the app
// renders it through an innerHTML sink (callers pass that in via forceHtml).
export function isHtml(str) {
    return typeof str === 'string' && /<[a-zA-Z/][^>]*>/.test(str)
}

// Structural fingerprint of an HTML string: the ordered sequence of tags with
// their (sorted) attribute name/value pairs, plus the placeholder set — with
// all text nodes removed. Two strings share a signature iff they have identical
// markup structure and identical placeholders, differing only in text nodes.
// This is what publish-time validation compares to block markup drift and
// script injection. It is deliberately conservative: any tag/attr/class change,
// any on* handler, or any placeholder change alters the signature.
export function htmlSignature(str) {
    if (typeof str !== 'string') return ''
    const tokens = []
    const re = /<\s*(\/?)\s*([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g
    let m
    while ((m = re.exec(str)) !== null) {
        const closing = m[1] === '/'
        const tag = m[2].toLowerCase()
        if (closing) { tokens.push('</' + tag + '>'); continue }
        const attrs = []
        const attrRe = /([a-zA-Z_:][\w:.-]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g
        let a
        while ((a = attrRe.exec(m[3])) !== null) {
            const name = a[1].toLowerCase()
            let val = a[2] || ''
            if (val && (val[0] === '"' || val[0] === "'")) val = val.slice(1, -1)
            attrs.push(name + '=' + val)
        }
        attrs.sort()
        tokens.push('<' + tag + (attrs.length ? ' ' + attrs.join(' ') : '') + '>')
    }
    return tokens.join('') + '␞' + placeholders(str).join(',')
}

// Any markup at all that looks like an active-content vector. Belt-and-braces on
// top of signature comparison: a translation containing these can never publish.
export function hasDangerousMarkup(str) {
    if (typeof str !== 'string') return false
    return /<\s*script/i.test(str) || /\son\w+\s*=/i.test(str) || /javascript:/i.test(str)
}

// ── Flatten ─────────────────────────────────────────────────────────────────
// Walk a catalog object and emit one record per LEAF (string). Structure is
// captured on the way down:
//   path        dotted, includes numeric array indices (e.g. a.b.0.1)
//   value       the leaf string
//   valueType   'html' | 'string'
//   arrayGroup  path of the OUTERMOST ancestor array (the atomic publish unit),
//               or null when the leaf is not inside any array
//   container   'array' | 'object' — type of the leaf's immediate parent
// NOTE: every string leaf is translatable. There are no structural constant
// cells — flow [0] cells hold real words ("Follow","Fish") as well as numbers,
// so they are content, not scaffolding.
export function flatten(obj) {
    const out = []
    const walk = (node, path, arrayGroup) => {
        if (Array.isArray(node)) {
            const group = arrayGroup || path // first array on the path wins
            node.forEach((v, i) => walk(v, path ? path + '.' + i : String(i), group))
        } else if (node && typeof node === 'object') {
            for (const k of Object.keys(node)) {
                walk(node[k], path ? path + '.' + k : k, arrayGroup)
            }
        } else {
            out.push({
                path,
                value: node,
                valueType: isHtml(node) ? 'html' : 'string',
                arrayGroup: arrayGroup || null,
                container: null, // filled by caller if needed
            })
        }
    }
    walk(obj, '', null)
    return out
}

export function namespaceOf(path) { return path.split('.')[0] }

// Distinct outermost-array paths in a skeleton (the atomic publish units).
export function arrayGroups(skeleton) {
    const groups = new Set()
    for (const leaf of flatten(skeleton)) if (leaf.arrayGroup) groups.add(leaf.arrayGroup)
    return [...groups]
}

// ── Deep clone / path set ───────────────────────────────────────────────────
function clone(x) {
    if (Array.isArray(x)) return x.map(clone)
    if (x && typeof x === 'object') { const o = {}; for (const k of Object.keys(x)) o[k] = clone(x[k]); return o }
    return x
}

// Set a value at a dotted path inside a structure that ALREADY has the right
// containers (because it was cloned from the English skeleton). We never create
// containers here, guaranteeing array-vs-object fidelity.
function setAtPath(root, path, value) {
    const segs = path.split('.')
    let node = root
    for (let i = 0; i < segs.length - 1; i++) node = node[segs[i]]
    node[segs[segs.length - 1]] = value
}

function getAtPath(root, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), root)
}

// ── rebuildFull ─────────────────────────────────────────────────────────────
// Reconstruct a COMPLETE catalog (like a full /lang/xx.json) from the English
// skeleton's structure plus a { path -> value } map. Used for the fidelity
// round-trip proof. Any leaf absent from valueMap keeps the skeleton's value.
export function rebuildFull(skeleton, valueMap) {
    const root = clone(skeleton)
    for (const leaf of flatten(skeleton)) {
        if (Object.prototype.hasOwnProperty.call(valueMap, leaf.path)) {
            setAtPath(root, leaf.path, valueMap[leaf.path])
        }
    }
    return root
}

// ── buildOverlay ────────────────────────────────────────────────────────────
// The publishing algorithm. Produces a SPARSE overlay (like /lang/es.json)
// containing ONLY publishable content, honoring atomic arrays.
//
//   skeleton      parsed English object (structure + source values)
//   isPublishable (path, value) => boolean  — the derived Publishable predicate
//                 (value present & approved & hash-current & placeholders valid
//                 & structure valid). Supplied by the caller/DB.
//   valueOf       (path) => translated value (string) or undefined
//
// Rules:
//   * Scalar leaf (arrayGroup == null): if publishable, copy the TRANSLATED
//     value into the overlay; else omit. English is NEVER copied for scalars.
//   * Array group: emit the WHOLE array only when EVERY leaf in the group is
//     publishable; otherwise omit the entire array. When emitted, every cell is
//     the translated value (all cells are translatable content).
// The overlay therefore can only ever contain complete arrays, so the app's
// wholesale-array _merge can never replace an English array with a partial one.
export function buildOverlay({ skeleton, isPublishable, valueOf }) {
    const overlay = {}
    const leaves = flatten(skeleton)

    // Partition leaves into scalar leaves and array groups.
    const groups = new Map() // arrayGroup -> leaf[]
    const scalars = []
    for (const leaf of leaves) {
        if (leaf.arrayGroup) {
            if (!groups.has(leaf.arrayGroup)) groups.set(leaf.arrayGroup, [])
            groups.get(leaf.arrayGroup).push(leaf)
        } else {
            scalars.push(leaf)
        }
    }

    const emit = (path, value) => setOverlayLeaf(overlay, skeleton, path, value)

    // Scalars.
    for (const leaf of scalars) {
        const v = valueOf(leaf.path)
        if (v != null && isPublishable(leaf.path, v)) emit(leaf.path, v)
    }

    // Array groups — atomic.
    for (const [groupPath, groupLeaves] of groups) {
        const allOk = groupLeaves.every(l => {
            const v = valueOf(l.path)
            return v != null && isPublishable(l.path, v)
        })
        if (!allOk) continue // omit entire array -> English fallback via _merge
        // Emit the whole array, rebuilt from the skeleton's shape.
        const rebuilt = clone(getAtPath(skeleton, groupPath))
        for (const l of groupLeaves) {
            const rel = l.path.slice(groupPath.length + 1) // path within the array
            setAtPath(rebuilt, rel, valueOf(l.path))
        }
        setOverlayContainer(overlay, skeleton, groupPath, rebuilt)
    }
    return overlay
}

// Create only the object containers needed to place a leaf in the sparse
// overlay, mirroring the skeleton's container types along the path. (Arrays are
// only ever placed whole via setOverlayContainer, so intermediate arrays never
// appear here.)
function setOverlayLeaf(overlay, skeleton, path, value) {
    const segs = path.split('.')
    let node = overlay
    let skel = skeleton
    for (let i = 0; i < segs.length - 1; i++) {
        skel = skel[segs[i]]
        if (node[segs[i]] == null) node[segs[i]] = {}
        node = node[segs[i]]
    }
    node[segs[segs.length - 1]] = value
}

function setOverlayContainer(overlay, skeleton, path, container) {
    const segs = path.split('.')
    let node = overlay
    for (let i = 0; i < segs.length - 1; i++) {
        if (node[segs[i]] == null) node[segs[i]] = {}
        node = node[segs[i]]
    }
    node[segs[segs.length - 1]] = container
}

// ── merge ───────────────────────────────────────────────────────────────────
// Exact replica of i18n.js _merge(): overlay src onto dst, recursing into plain
// objects, REPLACING arrays and scalars wholesale. Used by parity tests to
// reproduce runtime behavior.
export function merge(dst, src) {
    for (const k in src) {
        if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) {
            if (!dst[k] || typeof dst[k] !== 'object') dst[k] = {}
            merge(dst[k], src[k])
        } else {
            dst[k] = src[k]
        }
    }
    return dst
}
