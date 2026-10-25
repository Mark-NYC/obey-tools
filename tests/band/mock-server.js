// Mock Supabase backend for band_data.
// Implements the exact semantics band.html relies on:
//  - single-row table `band_data`
//  - atomic conditional UPDATE (matches PostgREST: UPDATE ... WHERE id=eq.X AND last_modified=eq.Y RETURNING id)
//  - change feed (stands in for supabase realtime postgres_changes)
const http = require('http');

let row = null; // { id, cities, last_modified, modified_by }
let version = 0;

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

  if (url.pathname === '/seed' && req.method === 'POST') {
    const body = await readBody(req);
    row = { id: 'main', modified_by: 'seed', ...body };
    version++;
    return json(res, 200, { ok: true, version });
  }

  if (url.pathname === '/state') {
    return json(res, 200, { row, version });
  }

  if (url.pathname === '/changes') {
    const since = Number(url.searchParams.get('since') || 0);
    if (version > since) return json(res, 200, { version, row });
    return json(res, 200, { version, row: null });
  }

  if (url.pathname === '/rpc' && req.method === 'POST') {
    const { op, filters = {}, values, single, returning } = await readBody(req);
    if (op === 'select') {
      if (!row || Object.entries(filters).some(([k, v]) => String(row[k]) !== String(v))) {
        if (single) return json(res, 200, { data: null, error: { code: 'PGRST116', message: 'no rows' } });
        return json(res, 200, { data: [], error: null });
      }
      return json(res, 200, { data: single ? row : [row], error: null });
    }
    if (op === 'insert') {
      row = { modified_by: null, ...values };
      version++;
      return json(res, 200, { data: null, error: null });
    }
    if (op === 'update') {
      // Atomic conditional update — all filters must match current row
      const matches = row && Object.entries(filters).every(([k, v]) => String(row[k]) === String(v));
      if (!matches) return json(res, 200, { data: [], error: null }); // 0 rows updated, no error (CAS miss)
      row = { ...row, ...values };
      version++;
      return json(res, 200, { data: returning ? [{ id: row.id }] : null, error: null });
    }
    return json(res, 400, { error: { message: 'bad op' } });
  }

  // band_apply(): mirrors supabase/band-rpc/01_band_apply.sql
  if (url.pathname === '/rpc/band_apply' && req.method === 'POST') {
    const { p_op: op, p_args: a = {}, p_device } = await readBody(req);
    try {
      if (!row) throw new Error('band_data row missing');
      const cities = JSON.parse(JSON.stringify(row.cities || []));
      const levels = ['1st Gen', '2nd Gen', '3rd Gen', '4th Gen'];
      const city = op === 'add_city' ? null : cities.find((c) => c.name === a.city);
      if (op !== 'add_city' && !city) throw new Error('Unknown city: ' + a.city);
      if (city && !Array.isArray(city.leaders)) city.leaders = [];
      const leaderName = op === 'set_post' ? a.leader : a.name;
      const li = city ? city.leaders.findIndex((l) => l.name === leaderName) : -1;
      if ((op === 'set_post' || op === 'remove_leader') && li < 0) throw new Error('Unknown leader: ' + leaderName);
      if (op === 'set_post') {
        if (!/^\d{4}-\d{1,2}-[24]$/.test(a.key)) throw new Error('Invalid meeting key');
        const ph = { ...(city.leaders[li].postHistory || {}) };
        if (a.value) ph[a.key] = true; else delete ph[a.key];
        city.leaders[li].postHistory = ph;
      } else if (op === 'adjust_counter') {
        if (!['baptismsYTD', 'churchesYTD'].includes(a.field)) throw new Error('Invalid field');
        city[a.field] = Math.max(0, (city[a.field] || 0) + a.delta);
        if (a.field === 'churchesYTD') city.totalChurches = city[a.field];
      } else if (op === 'step_stream') {
        const i = Math.max(0, levels.indexOf(city.streamDepth || '1st Gen'));
        const n = levels[Math.min(3, Math.max(0, i + Math.sign(a.delta)))];
        city.streamDepth = n; city.totalStreamDepth = n;
      } else if (op === 'add_leader') {
        if (city.leaders.some((l) => l.name === a.name)) throw new Error('Leader already exists');
        city.leaders.push({ name: a.name, postHistory: {} });
      } else if (op === 'remove_leader') {
        city.leaders.splice(li, 1);
      } else if (op === 'add_city') {
        if (cities.some((c) => c.name === a.name)) throw new Error('City already exists');
        const sd = levels.includes(a.streamDepth) ? a.streamDepth : '1st Gen';
        const n = Math.max(0, a.totalChurches || 0);
        cities.push({ name: a.name, leaders: [], baptismsYTD: 0, churchesYTD: n, totalChurches: n, streamDepth: sd, totalStreamDepth: sd, momentumHistory: [] });
      } else if (op === 'delete_city') {
        cities.splice(cities.indexOf(city), 1);
      } else throw new Error('Unknown op');
      row = { ...row, cities, last_modified: new Date().toISOString(), modified_by: p_device };
      version++;
      return json(res, 200, { data: { cities, last_modified: row.last_modified }, error: null });
    } catch (e) {
      return json(res, 200, { data: null, error: { message: e.message } });
    }
  }

  json(res, 404, { error: 'not found' });
});

server.listen(8787, () => console.log('mock supabase on :8787'));
