// Test-only bridge: serves the site and answers a stand-in supabase-js client
// by running the equivalent SQL through psql as the signed-in user, with
// role "authenticated" and RLS on. Never point it at production.
// Requires PGHOST/PGPORT/PGUSER/PGDATABASE for an ephemeral test database.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';

const q = (id) => '"' + String(id).replace(/"/g, '""') + '"';
const lit = (v) => v === null || v === undefined ? 'null'
  : typeof v === 'object' ? "'" + JSON.stringify(v).replace(/'/g, "''") + "'"
  : "'" + String(v).replace(/'/g, "''") + "'";

export function psql(sql) {
  return new Promise((resolve) => {
    execFile('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], {maxBuffer: 1 << 24}, (err, stdout, stderr) => {
      if (err) {
        const m = /ERROR:\s+(.*)/.exec(stderr || '') || [null, String(stderr || err.message)];
        const code = /duplicate key/.test(m[1]) ? '23505' : /permission denied/.test(m[1]) ? '42501' : 'P0001';
        resolve({error: {message: m[1].trim(), code}});
      } else resolve({out: stdout.trim()});
    });
  });
}
const asUser = (uid, sql) => (uid ? `set role authenticated; set request.jwt.claim.sub = ${lit(uid)}; ` : 'set role anon; ') + sql;

function where(filters) {
  const parts = filters.map(([op, col, v]) => {
    const c = q(col);
    switch (op) {
      case 'eq': return `${c} = ${lit(v)}`;
      case 'neq': return `${c} <> ${lit(v)}`;
      case 'gte': return `${c} >= ${lit(v)}`;
      case 'lte': return `${c} <= ${lit(v)}`;
      case 'ilike': return `${c} ilike ${lit(v)}`;
      case 'is': return v === null ? `${c} is null` : `${c} is ${v ? 'true' : 'false'}`;
      case 'in': return v.length ? `${c} in (${v.map(lit).join(',')})` : 'false';
      default: throw new Error('filter ' + op);
    }
  });
  return parts.length ? ' where ' + parts.join(' and ') : '';
}
const cols = (s) => !s || s.trim() === '*' ? '*' : s.split(',').map((x) => q(x.trim())).join(',');

// Like PostgREST: rows come back (and need SELECT rights) only when the
// client chained .select(); otherwise the write is "return=minimal".
const writeSql = (stmt, returning) => returning
  ? `with w as (${stmt} returning ${cols(returning)}) select json_build_object('rows',(select coalesce(json_agg(w),'[]') from w),'count',null)`
  : `${stmt}; select json_build_object('rows','[]'::json,'count',null)`;
const procCache = new Map();
async function procInfo(name) {
  if (procCache.has(name)) return procCache.get(name);
  const r = await psql(`select json_build_object('names',proargnames,'types',proargtypes::regtype[]::text[],'set',proretset,'ret',prorettype::regtype::text) from pg_proc where proname=${lit(name)} and pronamespace='public'::regnamespace limit 1`);
  const info = r.out ? JSON.parse(r.out) : null;
  procCache.set(name, info);
  return info;
}

async function handle(body) {
  const uid = body.uid || null;
  if (body.rpc) {
    const info = await procInfo(body.rpc);
    if (!info) return {data: null, error: {message: 'function not found: ' + body.rpc}};
    const args = Object.entries(body.args || {}).map(([k, v]) => {
      const i = (info.names || []).indexOf(k);
      if (i < 0) throw new Error('unknown argument ' + k);
      return `${q(k)} => ${lit(v)}::${info.types[i]}`;
    }).join(',');
    const call = `public.${q(body.rpc)}(${args})`;
    const sql = info.set ? `select coalesce(json_agg(r),'[]') from ${call} r`
      : info.ret === 'void' ? `select count(*) from (select ${call}) v` : `select to_json(${call})`;
    const r = await psql(asUser(uid, sql));
    if (r.error) return {data: null, error: r.error};
    return {data: info.ret === 'void' ? null : JSON.parse(r.out || 'null'), error: null};
  }
  const t = 'public.' + q(body.table), f = where(body.filters || []);
  let sql;
  if (body.op === 'select') {
    const order = (body.order || []).map(([c, asc]) => `${q(c)} ${asc ? 'asc' : 'desc'}`).join(',');
    const lim = body.range ? ` limit ${body.range[1] - body.range[0] + 1} offset ${body.range[0]}` : body.limit ? ` limit ${body.limit}` : '';
    sql = `select json_build_object('rows',(select coalesce(json_agg(x),'[]') from (select ${cols(body.columns)} from ${t}${f}${order ? ' order by ' + order : ''}${lim}) x),'count',(select count(*) from ${t}${f}))`;
  } else if (body.op === 'insert' || body.op === 'upsert') {
    const rows = Array.isArray(body.payload) ? body.payload : [body.payload];
    const names = [...new Set(rows.flatMap(Object.keys))];
    let conflict = '';
    if (body.op === 'upsert') {
      const on = (body.opts?.onConflict || 'id').split(',').map((x) => q(x.trim())).join(',');
      conflict = body.opts?.ignoreDuplicates ? ` on conflict (${on}) do nothing`
        : ` on conflict (${on}) do update set ${names.map((n) => `${q(n)}=excluded.${q(n)}`).join(',')}`;
    }
    const ins = `insert into ${t} (${names.map(q).join(',')}) select ${names.map(q).join(',')} from json_populate_recordset(null::${t}, ${lit(rows)}::json)${conflict}`;
    sql = writeSql(ins, body.returning);
  } else if (body.op === 'update') {
    const names = Object.keys(body.payload);
    sql = writeSql(`update ${t} set (${names.map(q).join(',')}) = (select ${names.map(q).join(',')} from json_populate_record(null::${t}, ${lit(body.payload)}::json))${f}`, body.returning);
  } else if (body.op === 'delete') {
    sql = writeSql(`delete from ${t}${f}`, body.returning);
  } else throw new Error('op ' + body.op);
  const r = await psql(asUser(uid, sql));
  if (r.error) return {data: null, error: r.error, count: null};
  const res = JSON.parse(r.out);
  let data = res.rows;
  if (body.single) data = data[0] ?? null;
  return {data, error: null, count: res.count};
}

const MIME = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'};
export function serve(root, port, log = []) {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/__db' && req.method === 'POST') {
      let raw = ''; for await (const c of req) raw += c;
      const body = JSON.parse(raw);
      let out; try { out = await handle(body); } catch (e) { out = {data: null, error: {message: e.message}}; }
      log.push({body, error: out.error});
      res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify(out)); return;
    }
    let file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
    if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'content-type': MIME[path.extname(file)] || 'application/octet-stream'});
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}

// Browser module served in place of supabase-js. Same surface the site uses.
export const CLIENT = `
const KEY='__e2e_session',listeners=new Set();
const session=()=>{try{return JSON.parse(localStorage.getItem(KEY))}catch{return null}};
async function call(body){const r=await fetch('/__db',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,uid:session()?.user?.id||null})});return r.json()}
class Q{constructor(t){this.b={table:t,op:'select',filters:[],order:[]}}
 select(c,o){if(this.b.op==='select')this.b.columns=c||'*';else this.b.returning=c||'*';return this}
 eq(c,v){this.b.filters.push(['eq',c,v]);return this}neq(c,v){this.b.filters.push(['neq',c,v]);return this}
 gte(c,v){this.b.filters.push(['gte',c,v]);return this}lte(c,v){this.b.filters.push(['lte',c,v]);return this}
 ilike(c,v){this.b.filters.push(['ilike',c,v]);return this}is(c,v){this.b.filters.push(['is',c,v]);return this}
 in(c,v){this.b.filters.push(['in',c,v]);return this}
 order(c,o){this.b.order.push([c,o?.ascending!==false]);return this}
 limit(n){this.b.limit=n;return this}range(a,z){this.b.range=[a,z];return this}
 single(){this.b.single=true;return this}maybeSingle(){this.b.single=true;return this}
 insert(p){this.b.op='insert';this.b.payload=p;return this}
 upsert(p,o){this.b.op='upsert';this.b.payload=p;this.b.opts=o||null;return this}
 update(p){this.b.op='update';this.b.payload=p;return this}
 delete(){this.b.op='delete';return this}
 then(a,b){return call(this.b).then(a,b)}}
export function createClient(){
 const notify=(e,s)=>listeners.forEach(cb=>{try{cb(e,s)}catch{}});
 return{auth:{
  async getSession(){return{data:{session:session()},error:null}},
  async getUser(){return{data:{user:session()?.user||null},error:null}},
  onAuthStateChange(cb){listeners.add(cb);setTimeout(()=>cb('INITIAL_SESSION',session()),0);return{data:{subscription:{unsubscribe(){listeners.delete(cb)}}}}},
  async signInWithPassword(){return{data:null,error:{message:'Use the test session'}}},
  async signInWithOtp(){return{error:null}},
  async signOut(){localStorage.removeItem(KEY);notify('SIGNED_OUT',null);return{error:null}},
  async signUp(){return{data:{user:null},error:null}},async resetPasswordForEmail(){return{error:null}}},
 from:t=>new Q(t),rpc:(rpc,args)=>call({rpc,args}),
 channel(){const c={on(){return c},subscribe(){return c}};return c},removeChannel(){}}}
`;
