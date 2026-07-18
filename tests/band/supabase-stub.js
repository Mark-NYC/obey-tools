// Stub of @supabase/supabase-js served in place of the CDN module.
// Implements exactly the API surface band.html uses, backed by the local mock server.
const BASE = 'http://127.0.0.1:8787';

class Query {
  constructor() {
    this.op = null;
    this.filters = {};
    this.values = null;
    this.isSingle = false;
    this.returning = false;
  }
  select(cols) {
    if (this.op === null) this.op = 'select';
    else this.returning = true; // .update(...).select('id')
    return this;
  }
  insert(values) { this.op = 'insert'; this.values = values; return this; }
  update(values) { this.op = 'update'; this.values = values; return this; }
  eq(k, v) { this.filters[k] = v; return this; }
  single() { this.isSingle = true; return this; }
  then(resolve, reject) {
    fetch(BASE + '/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        op: this.op, filters: this.filters, values: this.values,
        single: this.isSingle, returning: this.returning,
      }),
    })
      .then((r) => r.json())
      .then((j) => resolve({ data: j.data, error: j.error || null }))
      .catch((e) => reject(e)); // network failure rejects, same as supabase-js fetch failure
  }
}

class Channel {
  constructor() { this.cb = null; this.timer = null; this.lastVersion = 0; }
  on(type, opts, cb) { this.cb = cb; return this; }
  subscribe(statusCb) {
    fetch(BASE + '/state').then((r) => r.json()).then((j) => { this.lastVersion = j.version; });
    this.timer = setInterval(async () => {
      try {
        const j = await (await fetch(BASE + '/changes?since=' + this.lastVersion)).json();
        if (j.row) {
          this.lastVersion = j.version;
          if (this.cb) this.cb({ eventType: 'UPDATE', new: j.row });
        } else {
          this.lastVersion = j.version;
        }
      } catch (e) { /* silent, like an unwatched channel */ }
    }, 150);
    if (statusCb) statusCb('SUBSCRIBED');
    return this;
  }
  stop() { if (this.timer) clearInterval(this.timer); }
}

export function createClient(url, key, opts) {
  return {
    from(table) { return new Query(); },
    channel(name) { return new Channel(); },
    removeChannel(ch) { ch.stop(); },
  };
}
