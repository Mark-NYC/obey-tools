// Stub of @supabase/supabase-js served in place of the CDN module for the
// live-facilitation tests. Implements exactly the surface the test pages use:
//   supabase.rpc(name, args)
//   supabase.from('live_sessions').select(cols).eq('id', v).maybeSingle()
//   supabase.channel(name).on('postgres_changes', {filter}, cb).subscribe()
//   supabase.removeChannel(ch)
// backed by the local live mock server (mock-server.js on :8788).
const BASE = 'http://127.0.0.1:8788';

class Query {
  constructor() { this.filters = {}; }
  select() { return this; }
  eq(k, v) { this.filters[k] = v; return this; }
  maybeSingle() { this._single = true; return this; }
  single() { this._single = true; return this; }
  then(resolve, reject) {
    fetch(BASE + '/session?id=' + encodeURIComponent(this.filters.id))
      .then((r) => r.json())
      .then((j) => resolve({ data: j.row, error: null }))
      .catch((e) => reject(e));
  }
}

class Channel {
  constructor(name) { this.name = name; this.cb = null; this.filterId = null; this.timer = null; this.last = 0; }
  on(type, opts, cb) {
    this.cb = cb;
    if (opts && opts.filter) { const m = /id=eq\.(.+)$/.exec(opts.filter); if (m) this.filterId = m[1]; }
    return this;
  }
  subscribe(statusCb) {
    fetch(BASE + '/state').then((r) => r.json()).then((j) => { this.last = j.version; }).catch(() => {});
    this.timer = setInterval(async () => {
      try {
        const j = await (await fetch(BASE + '/changes?id=' + encodeURIComponent(this.filterId) + '&since=' + this.last)).json();
        this.last = j.version;
        if (j.row && this.cb) this.cb({ eventType: 'UPDATE', new: j.row });
      } catch (e) {}
    }, 150);
    if (statusCb) statusCb('SUBSCRIBED');
    return this;
  }
  stop() { if (this.timer) clearInterval(this.timer); }
}

export function createClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    rpc(name, args) {
      return fetch(BASE + '/rpc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, args }),
      }).then((r) => r.json());
    },
    from() { return new Query(); },
    channel(name) { return new Channel(name); },
    removeChannel(ch) { if (ch) ch.stop(); },
  };
}
