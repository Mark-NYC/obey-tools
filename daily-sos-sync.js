// Follow Daily cloud sync. Optional, account-based, and independent of email
// subscriptions. Guest readings still save to localStorage.
import { supabase } from './supabase.js';

const adapter=window.sosSyncAdapter;
const $=id=>document.getElementById(id);
if(adapter&&$('sos-sync')){
 const OWNER_KEY='obeytools:daily-sos:sync-owner:v1';
 const META_KEY='obeytools:daily-sos:revisions:v1';
 const BUCKET_PREFIX='obeytools:daily-sos:bucket:v1:';
 const fields=['read','insight','say','obey','share','check'];
 const stateEl=$('sos-sync-state'),loginForm=$('sos-sync-login'),loggedIn=$('sos-sync-logged-in');
 const setStatus=text=>{stateEl.textContent=text};
 const parse=(value,fallback)=>{try{return value?JSON.parse(value):fallback}catch{return fallback}};
 const copy=value=>JSON.parse(JSON.stringify(value));
 const loadMeta=()=>parse(localStorage.getItem(META_KEY),{});
 let revisions=loadMeta();
 let last=adapter.read();
 let owner=localStorage.getItem(OWNER_KEY)||'guest';
 let activeUser=null,authGeneration=0,syncInProgress=false,writeTimer=null,needsSync=false;
 let pendingWrites=new Map();
 let loginBusy=false, switchingOwner=false;
 const key=(day,field)=>day+':'+field;
 const normalizedEntries=s=>{
  const map=new Map();
  for(const [index,e] of Object.entries(s.entries||{})){
   const day=Number(index)+1;
   if(!Number.isInteger(day)||day<1||day>365||!e||typeof e!=='object')continue;
   if(e.read)map.set(key(day,'read'),'true');
   for(const field of fields.slice(1))
    if(Object.prototype.hasOwnProperty.call(e,field))map.set(key(day,field),String(e[field]??''));
  }
  map.set(key(1,'cursor'),String(Math.max(1,Math.min(365,Number(s.day||0)+1))));
  return map;
 };
 const getLocal=()=>({state:adapter.read(),revisions:copy(revisions)});
 function saveBucket(){
  try{localStorage.setItem(BUCKET_PREFIX+owner,JSON.stringify(getLocal()))}catch{}
 }
 function switchOwner(nextOwner){
  if(owner===nextOwner)return;
  switchingOwner=true;
  adapter.flush();
  const previous=getLocal();
  saveBucket();
  if(writeTimer)clearTimeout(writeTimer);
  pendingWrites.clear();needsSync=false;
  const existing=parse(localStorage.getItem(BUCKET_PREFIX+nextOwner),null);
  // Guest answers are brought into their first account, but data belonging
  // to a different signed-in user is never imported into another account.
  const found=existing||(owner==='guest'&&nextOwner!=='guest'?previous:null);
  // Bring NEW guest fields into an existing account without replacing that
  // account's notes. The original guest copy remains in its own local bucket.
  if(existing&&owner==='guest'&&nextOwner!=='guest'){
   found.state=copy(existing.state||{day:0,entries:{}});
   found.state.entries ||= {};
   for(const [day,guestEntry] of Object.entries(previous.state?.entries||{})){
    if(!guestEntry||typeof guestEntry!=='object')continue;
    const stored=found.state.entries[day]||{};
    for(const field of fields){
     if(Object.prototype.hasOwnProperty.call(guestEntry,field)&&!Object.prototype.hasOwnProperty.call(stored,field))
      stored[field]=guestEntry[field];
    }
    found.state.entries[day]=stored;
   }
  }
  revisions=found?.revisions&&typeof found.revisions==='object'?found.revisions:{};
  owner=nextOwner;
  try{localStorage.setItem(OWNER_KEY,owner);localStorage.setItem(META_KEY,JSON.stringify(revisions))}catch{}
  adapter.apply(found?.state||{day:0,entries:{}});
  last=adapter.read();
  switchingOwner=false;
 }
 const saveRevisions=()=>{try{localStorage.setItem(META_KEY,JSON.stringify(revisions))}catch{}};
 const nextRevision=(k)=>Math.max(Date.now(),Number(revisions[k]||0)+1);
 function onLocalSave(){
  const current=adapter.read(),now=normalizedEntries(current),before=normalizedEntries(last);
  const changes=[];
  for(const [k,value] of now){
   if(value===before.get(k))continue;
   if(k==='1:cursor' && current.day===last.day)continue;
   const revision=nextRevision(k);
   revisions[k]=revision;
   const [day,field]=k.split(':');
   changes.push({day:Number(day),field,value,revision});
  }
  last=current;
  if(changes.length){
   saveRevisions();saveBucket();
   if(activeUser&&!switchingOwner){
    for(const change of changes)pendingWrites.set(key(change.day,change.field),change);
    setStatus('Saved on this device · Syncing…');
    scheduleWrite();
   }else setStatus('Saved on this device');
  }
 }
 window.addEventListener('sos:progress-saved',onLocalSave);
 function scheduleWrite(){
  if(writeTimer)clearTimeout(writeTimer);
  writeTimer=setTimeout(()=>{writeTimer=null;flushWrites()},650);
 }
 async function sendBatches(changes,who,generation){
  for(let i=0;i<changes.length;i+=100){
   if(!activeUser||activeUser.id!==who||authGeneration!==generation)throw Error('Account changed');
   const {error}=await supabase.rpc('sos_merge_progress',{p_changes:changes.slice(i,i+100)});
   if(error)throw error;
  }
 }
 async function flushWrites(){
  if(!activeUser||syncInProgress)return;
  const who=activeUser.id,generation=authGeneration;
  const batch=[...pendingWrites.values()];
  if(!batch.length)return;
  pendingWrites.clear();
  try{
   await sendBatches(batch,who,generation);
   if(authGeneration===generation){
    setStatus(pendingWrites.size?'Syncing recent changes…':'Saved on this device and in your account');
    if(pendingWrites.size)scheduleWrite();
   }
  }catch(e){
   if(authGeneration!==generation)return;
   for(const change of batch){
    const k=key(change.day,change.field);
    if(!pendingWrites.has(k)||pendingWrites.get(k).revision<change.revision)pendingWrites.set(k,change);
   }
   setStatus('Saved on this device. Cloud sync unavailable; retry when connected.');
  }
 }
 async function readCloud(who,generation){
  const result=[];
  for(let from=0;from<3000;from+=400){
   const {data,error}=await supabase.from('sos_daily_progress')
    .select('day_no,field_name,value,revision_ms')
    .eq('user_id',who).order('day_no',{ascending:true}).order('field_name',{ascending:true})
    .range(from,from+399);
   if(error)throw error;
   if(authGeneration!==generation)return null;
   result.push(...(data||[]));
   if(!data||data.length<400)break;
  }
  return result;
 }
 function cloudMerge(rows){
  // Refresh the local snapshot after the network request. Unsaved typing gets
  // flushed first so remote reads cannot erase a recent edit.
  adapter.flush();
  const snapshot=adapter.read(),local=normalizedEntries(snapshot);
  const cloud=new Map(rows.map(r=>[key(r.day_no,r.field_name),r]));
  const updates=[];
  const merged=copy(snapshot);
  if(!merged.entries||typeof merged.entries!=='object')merged.entries={};
  for(const [k,remote] of cloud){
   const [dayStr,field]=k.split(':'),day=Number(dayStr);
   const localHas=local.has(k);
   const localTime=Number(revisions[k]||0),remoteTime=Number(remote.revision_ms)||0;
   // Cloud wins ties and legacy local records that have no edit timestamp.
   if(!localHas||remoteTime>=localTime){
    if(field==='cursor'){
     if(!new URLSearchParams(location.search).has('day'))merged.day=Math.max(0,Math.min(364,Number(remote.value)-1));
    }else{
     const entry=merged.entries[day-1]||{};
     if(field==='read')entry.read=true;else entry[field]=remote.value;
     merged.entries[day-1]=entry;
    }
    revisions[k]=remoteTime;
   }
  }
  // Each field is independent; never push the whole day and wipe a draft
  // saved on another device. The remote revision guards stale writes.
  for(const [k,value] of local){
   const remote=cloud.get(k);
   const localTime=Number(revisions[k]||0);
   if(remote&&Number(remote.revision_ms)>=localTime)continue;
   const [day,field]=k.split(':');
   const revision=localTime||Date.now();
   revisions[k]=revision;
   updates.push({day:Number(day),field,value,revision});
  }
  // A deep link from the reading email takes precedence over last-viewed day.
  const linkedDay=Number(new URLSearchParams(location.search).get('day'));
  if(Number.isInteger(linkedDay)&&linkedDay>=1&&linkedDay<=365){
   merged.day=linkedDay-1;
   const k='1:cursor',revision=nextRevision(k);revisions[k]=revision;
   updates.push({day:1,field:'cursor',value:String(linkedDay),revision});
  }
  adapter.apply(merged);last=adapter.read();saveRevisions();saveBucket();
  return updates;
 }
 async function sync(){
  if(!activeUser){setStatus('Saved on this device');return}
  if(syncInProgress){needsSync=true;return}
  syncInProgress=true;
  const who=activeUser.id,generation=authGeneration;
  setStatus('Checking cloud progress…');
  try{
   const rows=await readCloud(who,generation);
   if(!rows||authGeneration!==generation)return;
   const updates=cloudMerge(rows);
   if(updates.length)await sendBatches(updates,who,generation);
   if(authGeneration!==generation)return;
   setStatus('Saved on this device and in your account');
   if(pendingWrites.size)scheduleWrite();
  }catch(e){
   if(authGeneration===generation){
    console.warn('Follow Daily sync error:',e?.message||e);
    setStatus('Saved on this device. Cloud sync unavailable; try Sync now.');
   }
  }finally{
   syncInProgress=false;
   if(needsSync){needsSync=false;if(activeUser)sync()}
  }
 }
 function showAuth(){
  loginForm.hidden=!!activeUser;
  loggedIn.hidden=!activeUser;
  if(!activeUser)setStatus('Saved on this device · Sign in to sync across devices');
 }
 async function applyUser(user){
  const id=user?.id||null;
  if(activeUser?.id===id){showAuth();return}
  authGeneration++;
  switchOwner(id||'guest');
  activeUser=user||null;
  showAuth();
  if(activeUser)await sync();
 }
 loginForm.addEventListener('submit',async event=>{
  event.preventDefault();
  if(loginBusy)return;
  const email=$('sos-sync-email').value.trim(),password=$('sos-sync-password').value;
  if(!email||!password)return;
  loginBusy=true;$('sos-sync-login-button').disabled=true;
  setStatus('Signing in…');
  try{
   const {data,error}=await supabase.auth.signInWithPassword({email,password});
   if(error)throw error;
   $('sos-sync-password').value='';
   if(data?.user)await applyUser(data.user);
  }catch(e){setStatus('Sign-in failed. Check your account email and password.')}
  finally{loginBusy=false;$('sos-sync-login-button').disabled=false}
 });
 $('sos-sync-signout').addEventListener('click',async()=>{
  await flushWrites();
  const {error}=await supabase.auth.signOut();
  if(error){setStatus('Could not sign out. Please try again.');return}
  await applyUser(null);
 });
 $('sos-sync-now').addEventListener('click',()=>sync());
 window.addEventListener('online',()=>{if(activeUser)sync()});
 window.addEventListener('focus',()=>{if(activeUser)sync()});
 window.addEventListener('pagehide',()=>{saveBucket()});
 // Defer the callback to avoid calling the auth client inside its own lock.
 supabase.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>applyUser(session?.user||null),0)});
 const {data:{user}}=await supabase.auth.getUser();
 await applyUser(user);
}
