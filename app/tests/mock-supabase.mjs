// Stand-in for @supabase/supabase-js used by app/tests/offline-first.mjs.
// Served in place of /vendor/supabase-js.mjs. Implements the client surface the
// site uses; every query goes to the test server (/__mock/q), which keeps an
// in-memory "cloud" database and can be taken offline or made to fail writes.
// When the cloud is unreachable, calls resolve like supabase-js does:
// { data: null, error: { message: 'TypeError: Failed to fetch' } }.
const SESSION_KEY = '__mock_session'
const listeners = new Set()
const session = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY)) } catch { return null } }

async function call(body) {
  try {
    const r = await fetch('/__mock/q', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, uid: session()?.user?.id || null }) })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    return await r.json()
  } catch (e) {
    return { data: null, error: { message: 'TypeError: Failed to fetch' } }
  }
}

class Query {
  constructor(table) { this.q = { table, op: 'select', filters: [], payload: null, single: null, opts: null } }
  select() { return this }
  eq(c, v) { this.q.filters.push([c, v]); return this }
  in() { return this } order() { return this } limit() { return this } gte() { return this } lte() { return this }
  neq() { return this } is() { return this } not() { return this } range() { return this } match() { return this }
  maybeSingle() { this.q.single = 'maybe'; return this }
  single() { this.q.single = 'one'; return this }
  insert(p) { this.q.op = 'insert'; this.q.payload = p; return this }
  upsert(p, o) { this.q.op = 'upsert'; this.q.payload = p; this.q.opts = o || null; return this }
  update(p) { this.q.op = 'update'; this.q.payload = p; return this }
  delete() { this.q.op = 'delete'; return this }
  then(res, rej) { return call(this.q).then(res, rej) }
}

export function createClient() {
  const notify = (event, s) => listeners.forEach((cb) => { try { cb(event, s) } catch {} })
  return {
    auth: {
      async getSession() { return { data: { session: session() }, error: null } },
      async getUser() { return { data: { user: session()?.user || null }, error: null } },
      onAuthStateChange(cb) {
        listeners.add(cb)
        setTimeout(() => cb('INITIAL_SESSION', session()), 0)
        return { data: { subscription: { unsubscribe() { listeners.delete(cb) } } } }
      },
      async signInWithPassword({ email }) {
        const s = { user: { id: 'user-' + email.split('@')[0], email }, access_token: 'test' }
        localStorage.setItem(SESSION_KEY, JSON.stringify(s)); notify('SIGNED_IN', s)
        return { data: s, error: null }
      },
      async signOut() { localStorage.removeItem(SESSION_KEY); notify('SIGNED_OUT', null); return { error: null } },
      async signUp() { return { data: { user: null }, error: null } },
      async resetPasswordForEmail() { return { error: null } },
      async resend() { return { error: null } },
    },
    from: (t) => new Query(t),
    rpc: (name, args) => call({ rpc: name, args }),
    channel() { const c = { on() { return c }, subscribe() { return c } }; return c },
    removeChannel() {},
  }
}
