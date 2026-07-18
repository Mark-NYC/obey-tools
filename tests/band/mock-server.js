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

  json(res, 404, { error: 'not found' });
});

server.listen(8787, () => console.log('mock supabase on :8787'));
