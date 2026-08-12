// In-memory mock backend for the live-facilitation test pages. Mirrors the
// semantics of supabase/live-facilitation/01_schema.sql (the SECURITY DEFINER
// RPCs + the public live_sessions select + realtime) closely enough to drive
// the real pages in a browser. NOT used in production.
const http = require('http');
const crypto = require('crypto');

let sessions = {};   // id -> { id, join_code, story_id, current_step, status, created_at, expires_at, ended_at }
let hosts = {};      // id -> { host_token_hash }
let reports = [];
let version = 0;     // bumps on every mutation, for realtime polling

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ2346789'; // no O 0 I 1 L 5
const sha256 = (s) => crypto.createHash('sha256').update(String(s == null ? '' : s)).digest('hex');

function genCode() {
  for (let tries = 0; tries < 100; tries++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    const clash = Object.values(sessions).some((s) => s.status === 'active' && s.join_code === code);
    if (!clash) return code;
  }
  throw new Error('code exhaustion');
}

function rpc(name, a) {
  if (name === 'live_create_session') {
    if (!a.p_story_id) throw new Error('story_id required');
    if (!a.p_host_token || String(a.p_host_token).length < 16) throw new Error('host token required');
    const id = crypto.randomUUID();
    const now = Date.now();
    const s = {
      id, join_code: genCode(), story_id: String(a.p_story_id).slice(0, 128),
      current_step: 1, status: 'active',
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + 6 * 3600 * 1000).toISOString(),
      ended_at: null,
    };
    sessions[id] = s;
    hosts[id] = { host_token_hash: sha256(a.p_host_token) };
    version++;
    return [{ session_id: id, join_code: s.join_code, expires_at: s.expires_at }];
  }
  if (name === 'live_set_step') {
    const h = hosts[a.p_session_id];
    if (!h || h.host_token_hash !== sha256(a.p_host_token)) throw new Error('not authorized');
    const s = sessions[a.p_session_id];
    if (!s || s.status !== 'active' || new Date(s.expires_at).getTime() <= Date.now()) throw new Error('session not active');
    s.current_step = Math.max(1, Math.min(64, parseInt(a.p_step, 10) || 1));
    version++;
    return s.current_step;
  }
  if (name === 'live_end_session') {
    const h = hosts[a.p_session_id];
    if (!h || h.host_token_hash !== sha256(a.p_host_token)) throw new Error('not authorized');
    const present = a.p_people_present, goal = a.p_people_set_goal;
    if (present == null || present < 0 || goal == null || goal < 0) throw new Error('counts must be zero or greater');
    if (goal > present) throw new Error('goals cannot exceed people present');
    const s = sessions[a.p_session_id];
    reports.push({ session_id: a.p_session_id, story_id: s.story_id, people_present: present, people_set_goal: goal });
    s.status = 'ended'; s.ended_at = new Date().toISOString(); s.expires_at = new Date().toISOString();
    version++;
    return null;
  }
  if (name === 'live_get_by_code') {
    const code = String(a.p_code || '').toUpperCase().trim();
    const s = Object.values(sessions).find(
      (x) => x.join_code === code && x.status === 'active' && new Date(x.expires_at).getTime() > Date.now()
    );
    return s ? [{ session_id: s.id, story_id: s.story_id, current_step: s.current_step, status: s.status, expires_at: s.expires_at }] : [];
  }
  throw new Error('unknown rpc ' + name);
}

function publicRow(s) {
  if (!s) return null;
  // join_code is non-secret (meant to be shared); the real schema exposes it
  // on the public row too.
  return { id: s.id, story_id: s.story_id, current_step: s.current_step, status: s.status, expires_at: s.expires_at, join_code: s.join_code };
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = new URL(req.url, 'http://x');
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

  if (url.pathname === '/reset') { sessions = {}; hosts = {}; reports = []; version = 0; return send(200, { ok: true }); }
  if (url.pathname === '/state') { return send(200, { sessions: Object.values(sessions).map(publicRow), reports, version }); }
  if (url.pathname === '/session') { return send(200, { row: publicRow(sessions[url.searchParams.get('id')]) || null }); }
  if (url.pathname === '/changes') {
    const id = url.searchParams.get('id');
    const since = parseInt(url.searchParams.get('since') || '0', 10);
    const row = version > since ? publicRow(sessions[id]) : null;
    return send(200, { row, version });
  }
  if (url.pathname === '/rpc' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const { name, args } = JSON.parse(body || '{}');
        send(200, { data: rpc(name, args || {}), error: null });
      } catch (e) { send(200, { data: null, error: { message: e.message } }); }
    });
    return;
  }
  send(404, { error: 'nf' });
});

server.listen(8788, () => console.log('live mock on 8788'));
