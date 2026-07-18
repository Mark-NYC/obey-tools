// Mock Supabase backend for the per-city band schema.
// Implements the semantics the page depends on:
//  - band_cities / band_leaders / band_posts tables with FK cascade deletes
//  - atomic RPCs band_adjust_counter / band_step_stream_depth / band_set_post
//    (Node's single-threaded event loop makes each op atomic, mirroring
//    Postgres row-level locking)
//  - a change feed standing in for supabase realtime postgres_changes
//  - a profiles table for the leader-role check in auth.js
// /seed accepts the legacy-shaped cities array and /state returns the same
// assembled shape, so test assertions stay schema-agnostic.
const http = require('http');
const crypto = require('crypto');

const STREAM_LEVELS = ['1st Gen', '2nd Gen', '3rd Gen', '4th Gen'];
const LEADER_UID = '11111111-1111-1111-1111-111111111111';

let db = { band_cities: [], band_leaders: [], band_posts: [], profiles: [{ id: LEADER_UID, role: 'leader' }] };
let version = 1;
let seq = 0;
const uuid = () => crypto.randomUUID();
const nowIso = () => new Date(Date.now() + (seq++)).toISOString(); // strictly increasing created_at

function bump() { version++; }

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
}
function json(res, code, body) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b ? JSON.parse(b) : {}));
  });
}

function cascadeDeleteLeader(leaderId) {
  db.band_posts = db.band_posts.filter((p) => p.leader_id !== leaderId);
}
function cascadeDeleteCity(cityId) {
  db.band_leaders.filter((l) => l.city_id === cityId).forEach((l) => cascadeDeleteLeader(l.id));
  db.band_leaders = db.band_leaders.filter((l) => l.city_id !== cityId);
  db.band_posts = db.band_posts.filter((p) => p.city_id !== cityId);
}

function assembleState() {
  return {
    cities: db.band_cities.map((c) => ({
      id: c.id,
      name: c.name,
      baptismsYTD: c.baptisms_ytd,
      churchesYTD: c.churches_ytd,
      totalChurches: c.total_churches,
      streamDepth: c.stream_depth,
      totalStreamDepth: c.total_stream_depth,
      leaders: db.band_leaders
        .filter((l) => l.city_id === c.id)
        .map((l) => ({
          id: l.id,
          name: l.name,
          postHistory: Object.fromEntries(
            db.band_posts.filter((p) => p.leader_id === l.id).map((p) => [p.meeting_key, p.posted])
          ),
        })),
    })),
  };
}

const rpcs = {
  band_adjust_counter({ p_city_id, p_field, p_delta }) {
    const c = db.band_cities.find((x) => x.id === p_city_id);
    if (!c) throw new Error('band_adjust_counter: city not found');
    if (p_field === 'baptisms_ytd') {
      c.baptisms_ytd = Math.max(0, c.baptisms_ytd + p_delta);
      bump();
      return c.baptisms_ytd;
    }
    if (p_field === 'churches_ytd') {
      c.churches_ytd = Math.max(0, c.churches_ytd + p_delta);
      c.total_churches = c.churches_ytd;
      bump();
      return c.churches_ytd;
    }
    throw new Error('band_adjust_counter: invalid field ' + p_field);
  },
  band_step_stream_depth({ p_city_id, p_delta }) {
    const c = db.band_cities.find((x) => x.id === p_city_id);
    if (!c) throw new Error('band_step_stream_depth: city not found');
    const i = Math.max(0, Math.min(3, STREAM_LEVELS.indexOf(c.stream_depth) + p_delta));
    c.stream_depth = STREAM_LEVELS[i];
    c.total_stream_depth = STREAM_LEVELS[i];
    bump();
    return c.stream_depth;
  },
  band_set_post({ p_leader_id, p_meeting_key, p_posted }) {
    const l = db.band_leaders.find((x) => x.id === p_leader_id);
    if (!l) throw new Error('band_set_post: leader not found');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p_meeting_key)) {
      throw new Error('band_posts_meeting_key_iso check constraint violation'); // mirrors 02_schema.sql
    }
    const existing = db.band_posts.find((p) => p.leader_id === p_leader_id && p.meeting_key === p_meeting_key);
    if (existing) existing.posted = p_posted;
    else db.band_posts.push({ leader_id: p_leader_id, city_id: l.city_id, meeting_key: p_meeting_key, posted: p_posted });
    bump();
    return null;
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

  if (url.pathname === '/seed' && req.method === 'POST') {
    const { cities = [] } = await readBody(req);
    db = { band_cities: [], band_leaders: [], band_posts: [], profiles: [{ id: LEADER_UID, role: 'leader' }] };
    cities.forEach((c) => {
      const cityId = uuid();
      db.band_cities.push({
        id: cityId, name: c.name,
        baptisms_ytd: c.baptismsYTD || 0, churches_ytd: c.churchesYTD || 0,
        total_churches: c.totalChurches || 0,
        stream_depth: c.streamDepth || '1st Gen', total_stream_depth: c.totalStreamDepth || c.streamDepth || '1st Gen',
        momentum_history: c.momentumHistory || [], created_at: nowIso(),
      });
      (c.leaders || []).forEach((l) => {
        const leaderId = uuid();
        db.band_leaders.push({ id: leaderId, city_id: cityId, name: l.name, created_at: nowIso() });
        Object.entries(l.postHistory || {}).forEach(([k, v]) => {
          db.band_posts.push({ leader_id: leaderId, city_id: cityId, meeting_key: k, posted: !!v });
        });
      });
    });
    bump();
    return json(res, 200, { ok: true, version });
  }

  if (url.pathname === '/state') {
    return json(res, 200, { version, row: assembleState() });
  }

  if (url.pathname === '/changes') {
    const since = Number(url.searchParams.get('since') || 0);
    return json(res, 200, { version, changed: version > since });
  }

  if (url.pathname === '/rpc' && req.method === 'POST') {
    const { table, op, filters = {}, values, single, maybeSingle, returning } = await readBody(req);
    const rows = db[table];
    if (!rows) return json(res, 200, { data: null, error: { message: 'relation does not exist: ' + table } });

    if (op === 'select') {
      const out = rows.filter((r) => Object.entries(filters).every(([k, v]) => String(r[k]) === String(v)));
      if (single || maybeSingle) {
        if (out.length === 0) {
          return json(res, 200, maybeSingle
            ? { data: null, error: null }
            : { data: null, error: { code: 'PGRST116', message: 'no rows' } });
        }
        return json(res, 200, { data: out[0], error: null });
      }
      return json(res, 200, { data: out, error: null });
    }

    if (op === 'insert') {
      const row = { id: uuid(), created_at: nowIso(), ...values };
      if (table === 'band_cities') {
        row.baptisms_ytd = row.baptisms_ytd ?? 0;
        row.churches_ytd = row.churches_ytd ?? 0;
        row.total_churches = row.total_churches ?? 0;
        row.stream_depth = row.stream_depth ?? '1st Gen';
        row.total_stream_depth = row.total_stream_depth ?? '1st Gen';
        row.momentum_history = row.momentum_history ?? [];
      }
      rows.push(row);
      bump();
      return json(res, 200, { data: single ? row : [row], error: null });
    }

    if (op === 'delete') {
      const victims = rows.filter((r) => Object.entries(filters).every(([k, v]) => String(r[k]) === String(v)));
      victims.forEach((v) => {
        if (table === 'band_cities') cascadeDeleteCity(v.id);
        if (table === 'band_leaders') cascadeDeleteLeader(v.id);
      });
      db[table] = rows.filter((r) => !victims.includes(r));
      bump();
      return json(res, 200, { data: null, error: null });
    }

    if (op === 'update') {
      const targets = rows.filter((r) => Object.entries(filters).every(([k, v]) => String(r[k]) === String(v)));
      targets.forEach((r) => Object.assign(r, values));
      bump();
      return json(res, 200, { data: returning ? targets : null, error: null });
    }

    return json(res, 400, { error: { message: 'bad op' } });
  }

  if (url.pathname === '/rpcfn' && req.method === 'POST') {
    const { name, params } = await readBody(req);
    const fn = rpcs[name];
    if (!fn) return json(res, 200, { data: null, error: { message: 'function not found: ' + name } });
    try {
      const data = fn(params || {});
      return json(res, 200, { data, error: null });
    } catch (e) {
      return json(res, 200, { data: null, error: { message: e.message } });
    }
  }

  json(res, 404, { error: 'not found' });
});

server.listen(8787, () => console.log('mock supabase (per-city schema) on :8787'));
