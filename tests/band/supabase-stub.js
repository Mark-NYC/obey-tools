// Stub of @supabase/supabase-js served in place of the CDN module.
// Implements exactly the API surface band.html + auth.js use, backed by the
// local mock server. Auth is faked as an already-signed-in leader session so
// the tests exercise the page's data layer; real RLS enforcement is proven
// separately against local PostgreSQL (supabase/band-migration/91_security_tests.sql).
const BASE = 'http://127.0.0.1:8787';

const FAKE_SESSION = {
  user: { id: '11111111-1111-1111-1111-111111111111', email: 'leader@test.example' },
  access_token: 'fake-token',
};

class Query {
  constructor(table) {
    this.table = table;
    this.op = null;
    this.filters = {};
    this.values = null;
    this.isSingle = false;
    this.isMaybeSingle = false;
    this.returning = false;
  }
  select() {
    if (this.op === null) this.op = 'select';
    else this.returning = true; // .insert(...).select() / .update(...).select()
    return this;
  }
  insert(values) { this.op = 'insert'; this.values = values; return this; }
  update(values) { this.op = 'update'; this.values = values; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(k, v) { this.filters[k] = v; return this; }
  order() { return this; } // mock keeps insertion order (== created_at order)
  single() { this.isSingle = true; return this; }
  maybeSingle() { this.isMaybeSingle = true; return this; }
  then(resolve, reject) {
    fetch(BASE + '/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: this.table, op: this.op, filters: this.filters, values: this.values,
        single: this.isSingle, maybeSingle: this.isMaybeSingle, returning: this.returning,
      }),
    })
      .then((r) => r.json())
      .then((j) => resolve({ data: j.data, error: j.error || null }))
      .catch((e) => reject(e)); // network failure rejects, same as supabase-js
  }
}

class RpcCall {
  constructor(name, params) { this.name = name; this.params = params; }
  then(resolve, reject) {
    fetch(BASE + '/rpcfn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: this.name, params: this.params }),
    })
      .then((r) => r.json())
      .then((j) => resolve({ data: j.data, error: j.error || null }))
      .catch((e) => reject(e));
  }
}

class Channel {
  constructor() { this.cbs = []; this.timer = null; this.lastVersion = null; this.statusCb = null; }
  on(type, opts, cb) { this.cbs.push(cb); return this; }
  subscribe(statusCb) {
    this.statusCb = statusCb;
    this.timer = setInterval(async () => {
      try {
        const j = await (await fetch(BASE + '/changes?since=' + (this.lastVersion ?? 999999999))).json();
        if (this.lastVersion === null) {
          this.lastVersion = j.version; // baseline on first poll
          return;
        }
        if (j.changed) {
          this.lastVersion = j.version;
          this.cbs.forEach((cb) => cb({ eventType: 'UPDATE' }));
        }
      } catch (e) { /* connection loss — no events, like a dropped socket */ }
    }, 150);
    if (statusCb) setTimeout(() => statusCb('SUBSCRIBED'), 0);
    return this;
  }
  stop() { if (this.timer) clearInterval(this.timer); }
}

export function createClient(url, key, opts) {
  return {
    from(table) { return new Query(table); },
    rpc(name, params) { return new RpcCall(name, params); },
    channel() { return new Channel(); },
    removeChannel(ch) { ch.stop(); },
    realtime: { setAuth() {} },
    auth: {
      async getSession() { return { data: { session: FAKE_SESSION } }; },
      onAuthStateChange(cb) {
        setTimeout(() => cb('INITIAL_SESSION', FAKE_SESSION), 0);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      async signOut() { return { error: null }; },
      async signUp() { return { data: {}, error: null }; },
      async signInWithPassword() { return { data: {}, error: null }; },
      async resetPasswordForEmail() { return { error: null }; },
      async resend() { return { error: null }; },
    },
  };
}
