// local-sync.js — offline-first rules for optional account sync.
//
// "No internet. No account. No problem." Data on this device is always the
// working copy. Signing in adds an optional cloud copy; it must never cost
// the user anything they saved here. Rules enforced here:
//
//   • Three-way merge: compare this device (local), the account (cloud) and the
//     last state both agreed on (base). Whichever side changed wins.
//   • True conflicts (both changed differently): keep this device's version,
//     save the account's version to a recovery list, and tell the user.
//     Nothing is silently overwritten.
//   • Mass-deletion guard: an empty side never deletes the other side
//     (e.g. a wiped device or an account whose rows failed to save).
//   • Ownership: data synced with account A is never merged into account B.
//   • The base snapshot is only advanced after the cloud write succeeds.
//
// Classic script (no imports) so it works on every page and in unit tests.
;(function () {
    const OWNER_KEY = 'obey-local-owner'
    const RECOVERY_KEY = 'obey-sync-recovery'
    const MAX_RECOVERY = 50

    const json = (v) => JSON.stringify(v === undefined ? null : v)
    const same = (a, b) => json(a) === json(b)
    function read(key, fallback) {
        try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v) } catch { return fallback }
    }
    function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)) } catch {} }

    // ── Ownership ────────────────────────────────────────────────────────
    function owner() { try { return localStorage.getItem(OWNER_KEY) } catch { return null } }
    function setOwner(userId) { try { userId ? localStorage.setItem(OWNER_KEY, userId) : localStorage.removeItem(OWNER_KEY) } catch {} }
    // Local data with no owner (made offline, never synced) may join any account.
    function mayMerge(userId) { const o = owner(); return !o || o === userId }

    // ── Recovery list (conflict losers and remote deletions) ─────────────
    function keep(kind, label, data, reason) {
        const list = read(RECOVERY_KEY, [])
        list.unshift({ kind, label, data, reason, at: new Date().toISOString() })
        write(RECOVERY_KEY, list.slice(0, MAX_RECOVERY))
    }
    function recovery() { return read(RECOVERY_KEY, []) }

    // ── Keyed merge (lists of records) ───────────────────────────────────
    // local/cloud/base: { key: record }. base may be null (never synced).
    // Returns { merged, conflicts: [{key, kept, other}], removed: [{key, record}] }.
    function mergeKeyed(local, cloud, base, eq) {
        eq = eq || same
        local = local || {}; cloud = cloud || {}
        const localEmpty = !Object.keys(local).length
        const cloudEmpty = !Object.keys(cloud).length
        // Mass-deletion guard: an empty side is "unknown", not "deleted everything".
        if (localEmpty || cloudEmpty) base = null
        const merged = {}, conflicts = [], removed = []
        const keys = new Set([...Object.keys(local), ...Object.keys(cloud)])
        for (const k of keys) {
            const L = local[k], C = cloud[k], B = base ? base[k] : undefined
            if (L !== undefined && C !== undefined) {
                if (eq(L, C)) merged[k] = L
                else if (B !== undefined && eq(L, B)) merged[k] = C          // changed only in the account
                else if (B !== undefined && eq(C, B)) merged[k] = L          // changed only on this device
                else { merged[k] = L; conflicts.push({ key: k, kept: L, other: C }) }
            } else if (L !== undefined) {
                if (B !== undefined && eq(L, B)) removed.push({ key: k, record: L })   // deleted in the account
                else merged[k] = L                                                     // new or edited here
            } else {
                if (B !== undefined && eq(C, B)) { /* deleted on this device: honour it */ }
                else merged[k] = C                                                     // new or edited in the account
            }
        }
        return { merged, conflicts, removed }
    }

    // ── Single-record merge ──────────────────────────────────────────────
    // isEmpty(record) → true for a never-used default state.
    function mergeRecord(local, cloud, base, isEmpty) {
        const empty = (v) => v == null || (isEmpty && isEmpty(v))
        if (empty(cloud)) return { value: local, conflict: null }
        if (empty(local)) return { value: cloud, conflict: null }
        if (same(local, cloud)) return { value: local, conflict: null }
        if (base != null && same(local, base)) return { value: cloud, conflict: null }
        if (base != null && same(cloud, base)) return { value: local, conflict: null }
        return { value: local, conflict: { kept: local, other: cloud } }
    }

    // Base snapshots are per account so switching accounts can't misuse one.
    function base(name, userId) {
        const b = read(name + '-synced', null)
        return b && b.userId === userId ? b.data : null
    }
    function setBase(name, userId, data) { write(name + '-synced', { userId, data, at: new Date().toISOString() }) }

    function isNetworkError(err) {
        const m = String((err && (err.message || err.details)) || err || '').toLowerCase()
        return !navigator.onLine || /failed to fetch|networkerror|load failed|network request failed|the internet connection appears to be offline|timed? ?out/.test(m)
    }

    // The iOS app keeps device data on sign-out and account deletion (it is
    // the user's own phone). The website keeps its shared-computer behaviour.
    function keepDeviceDataOnSignOut() { return !!(window.ObeyApp && window.ObeyApp.keepDeviceData) }

    window.ObeySync = { owner, setOwner, mayMerge, keep, recovery, mergeKeyed, mergeRecord, base, setBase, isNetworkError, keepDeviceDataOnSignOut, same }
})()
