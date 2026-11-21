import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8')
const script=read('daily-sos-sync.js').replace(/^import\s+.*\n/m,'')
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor
const runSync=new AsyncFunction('supabase','window','document','localStorage','location','Event','setTimeout','clearTimeout',script)
function fixture({initial={day:0,entries:{}},remote=[],user=null,owner=null,revisions={}}={}){
 let state=structuredClone(initial)
 const saved=new Map([['obeytools:daily-sos:v2',JSON.stringify(initial)],
  ['obeytools:daily-sos:revisions:v1',JSON.stringify(revisions)]])
 if(owner)saved.set('obeytools:daily-sos:sync-owner:v1',owner)
 const storage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,String(value))}
 const nodes=new Map()
 function element(id){
  if(!nodes.has(id))nodes.set(id,{
   id,hidden:false,value:'',textContent:'',disabled:false,handlers:{},
   addEventListener(event,fn){this.handlers[event]=fn}
  })
  return nodes.get(id)
 }
 const listeners={}
 const adapter={
  read:()=>structuredClone(state),
  apply:snapshot=>{state=structuredClone(snapshot)},
  flush:()=>{}
 }
 const window={sosSyncAdapter:adapter,addEventListener:(name,callback)=>{listeners[name]=callback}}
 const document={getElementById:element}
 const changes=[]
 const q={select(){return this},eq(){return this},order(){return this},async range(from,to){return {data:remote.slice(from,to+1),error:null}}}
 const supabase={auth:{
  async getUser(){return {data:{user}}},
  onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},
  async signOut(){return {error:null}},
  async signInWithPassword(){return {data:{user},error:null}}
 },from(){return q},async rpc(name,args){changes.push({name,args});return {data:args.p_changes.length,error:null}}}
 const location={search:''}
 return {run:()=>runSync(supabase,window,document,storage,location,Event,setTimeout,clearTimeout),getState:()=>state,
  saved,changes,nodes,listeners,adapter}
}
const person={id:'11111111-1111-4111-8111-111111111111',email:'person@example.org'}
test('Daily SOS cloud sync JS is syntactically valid as an async module',()=>{
 assert.doesNotThrow(()=>new AsyncFunction('supabase','window','document','localStorage','location','Event','setTimeout','clearTimeout',script))
})
test('Guest saves stay local and never request private cloud data',async()=>{
 const f=fixture({initial:{day:1,entries:{1:{say:'Jesus calls ordinary people'}}}})
 await f.run()
 assert.equal(f.getState().entries[1].say,'Jesus calls ordinary people')
 assert.equal(f.changes.length,0)
 assert.match(f.nodes.get('sos-sync-state').textContent,/Saved on this device/)
})
test('First sign-in uploads existing guest Say and partial Obey without requiring Share',async()=>{
 const f=fixture({user:person,initial:{day:4,entries:{4:{read:true,say:'Trust Jesus',obey:'Pray tomorrow'}}}})
 await f.run()
 const fields=f.changes.flatMap(x=>x.args.p_changes)
 assert.ok(fields.some(x=>x.day===5&&x.field==='say'&&x.value==='Trust Jesus'))
 assert.ok(fields.some(x=>x.day===5&&x.field==='obey'&&x.value==='Pray tomorrow'))
 assert.ok(fields.some(x=>x.day===5&&x.field==='read'&&x.value==='true'))
 assert.ok(fields.some(x=>x.field==='cursor'&&x.value==='5'))
 assert.ok(!fields.some(x=>x.field==='share'))
 assert.equal(f.getState().entries[4].say,'Trust Jesus')
})
test('Cross-device login restores saved fields and last visited day',async()=>{
 const f=fixture({user:person,remote:[
  {day_no:7,field_name:'say',value:'The Kingdom is near',revision_ms:12345},
  {day_no:7,field_name:'share',value:'Tell my neighbor',revision_ms:12346},
  {day_no:1,field_name:'cursor',value:'7',revision_ms:12347}
 ]})
 await f.run()
 assert.equal(f.getState().entries[6].say,'The Kingdom is near')
 assert.equal(f.getState().entries[6].share,'Tell my neighbor')
 assert.equal(f.getState().day,6)
 assert.ok(!f.changes.flatMap(x=>x.args.p_changes).some(x=>x.field==='say'))
})
test('Merging same-day drafts preserves later cloud Say and local Obey',async()=>{
 const f=fixture({user:person,initial:{day:2,entries:{2:{say:'Old local draft',obey:'Start prayer'}}},
  remote:[{day_no:3,field_name:'say',value:'Newer cloud note',revision_ms:20000}]})
 await f.run()
 assert.equal(f.getState().entries[2].say,'Newer cloud note')
 assert.equal(f.getState().entries[2].obey,'Start prayer')
 const uploaded=f.changes.flatMap(x=>x.args.p_changes)
 assert.ok(uploaded.some(x=>x.field==='obey'&&x.value==='Start prayer'))
 assert.ok(!uploaded.some(x=>x.field==='say'&&x.value==='Old local draft'))
})
test('Switching accounts does not import another signed-in user’s answers',async()=>{
 const another={id:'22222222-2222-4222-8222-222222222222',email:'other@example.org'}
 const f=fixture({owner:person.id,user:another,initial:{day:8,entries:{8:{say:'Personal account A note'}}}})
 await f.run()
 assert.equal(f.getState().entries[8],undefined)
 assert.ok(!f.changes.flatMap(x=>x.args.p_changes).some(x=>x.value==='Personal account A note'))
 assert.ok(f.saved.get('obeytools:daily-sos:bucket:v1:'+person.id)?.includes('Personal account A note'))
})
test('Database migration restricts guest access and prevents stale revisions',()=>{
 const sql=read('supabase/daily-sos-email/04_account_progress_sync.sql')
 assert.match(sql,/enable row level security/)
 assert.match(sql,/auth\.uid\(\)\)=user_id/)
 assert.match(sql,/revoke all on public\.sos_daily_progress from public,anon,authenticated/)
 assert.match(sql,/security invoker/)
 assert.match(sql,/excluded\.revision_ms > d\.revision_ms/)
 assert.match(sql,/field_name in \('read','say','obey','share','cursor'\)/)
})
