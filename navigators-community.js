import {supabase} from './supabase.js';
const $=id=>document.getElementById(id);
const bridge=window.navigatorsAdapter;
const stateKey='obey-navigators-reading-v1',ownerKey='obey-navigators-owner-v1',bucketKey=owner=>'obey-navigators-bucket:'+owner;
let account=null,circles=[],owner=localStorage.getItem(ownerKey)||'guest',syncBusy=false,pending=false,gen=0,writeTimer=null;
const safeParse=(text,fallback)=>{try{return JSON.parse(text)||fallback}catch{return fallback}};
const copy=value=>JSON.parse(JSON.stringify(value));
const chapter=()=>{const x=bridge.day();return (x.month-1)*25+x.day};
function status(message){$('sync-state').textContent=message}
function notice(message){$('circle-notice').textContent=message}
function bucket(){try{localStorage.setItem(bucketKey(owner),JSON.stringify(bridge.read()))}catch{}}
function switchOwner(target){
 if(target===owner)return;
 bucket();
 let next=safeParse(localStorage.getItem(bucketKey(target)),null);
 // Only import guest data into the first account, never from one signed-in user to another.
 if(!next&&owner==='guest'&&target!=='guest')next=copy(bridge.read());
 owner=target;localStorage.setItem(ownerKey,owner);
 bridge.apply(next||{month:1,day:1,items:{}});
 localStorage.setItem(stateKey,JSON.stringify(bridge.read()));
}
function accountUI(){
 const container=$('sync-account');container.replaceChildren();
 if(account){const p=document.createElement('p');p.textContent='Signed in: '+(account.email||'OBEY.TOOLS account');const signout=document.createElement('button');signout.type='button';signout.className='secondary';signout.textContent='Sign out';signout.addEventListener('click',async()=>{await sync();const {error}=await supabase.auth.signOut();if(error)status('Could not sign out. Try again.');});container.append(p,signout);$('sync-now').hidden=false;return}
 $('sync-now').hidden=true;
 const form=document.createElement('form');form.className='account-form';
 const email=document.createElement('input');email.type='email';email.required=true;email.placeholder='Email';email.autocomplete='email';email.setAttribute('aria-label','Account email');
 const password=document.createElement('input');password.type='password';password.required=true;password.placeholder='Password';password.autocomplete='current-password';password.setAttribute('aria-label','Account password');
 const button=document.createElement('button');button.type='submit';button.textContent='Sign in to sync';
 const hint=document.createElement('p');hint.textContent='Use your OBEY.TOOLS account. You can read without signing in.';const create=document.createElement('a');create.href='/';create.textContent='Create an account';hint.append(document.createTextNode(' · '),create);
 form.append(email,password,button,hint);container.append(form);
 form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;status('Signing in…');try{const {error}=await supabase.auth.signInWithPassword({email:email.value.trim(),password:password.value});if(error)throw error;password.value=''}catch(error){status('Sign in failed. Check your email and password.')}finally{button.disabled=false}});
}
function mergeByRevision(remote){
 const next=copy(bridge.read()),changes=[];
 next.items ||= {};
 for(const row of remote||[]){
  if(row.reading_day===301){if((Number(row.revision_ms)||0)>=(Number(next.cursorUpdatedAt)||0)){next.month=row.payload.month;next.day=row.payload.day;next.cursorUpdatedAt=Number(row.revision_ms)||0}continue}
  const m=Math.floor((row.reading_day-1)/25)+1,d=(row.reading_day-1)%25+1,k=m+'-'+d;
  const local=next.items[k],r=Number(row.revision_ms)||0,l=Number(local?.updatedAt)||0;
  if(!local||r>=l)next.items[k]=copy(row.payload);
 }
 for(const [key,payload] of Object.entries(next.items)){
  const [m,d]=key.split('-').map(Number),reading_day=(m-1)*25+d;
  if(!Number.isInteger(reading_day)||reading_day<1||reading_day>300)continue;
  const row=(remote||[]).find(x=>x.reading_day===reading_day);
  if(!row||(Number(payload?.updatedAt)||0)>(Number(row.revision_ms)||0))changes.push({user_id:account.id,reading_day,payload,revision_ms:Number(payload?.updatedAt)||Date.now()});
 }
 const cursorRow=(remote||[]).find(x=>x.reading_day===301);
 if(!cursorRow||(Number(next.cursorUpdatedAt)||0)>(Number(cursorRow.revision_ms)||0))changes.push({user_id:account.id,reading_day:301,payload:{month:next.month||1,day:next.day||1},revision_ms:Number(next.cursorUpdatedAt)||Date.now()});
 bridge.apply(next);localStorage.setItem(stateKey,JSON.stringify(next));bucket();
 return changes;
}
async function sync(){
 if(!account)return status('Saved on this device · Sign in to sync');
 if(syncBusy){pending=true;return}
 syncBusy=true;const user=account.id,run=gen;status('Checking account progress…');
 try{
  const {data,error}=await supabase.from('navigators_reading_progress').select('reading_day,payload,revision_ms').eq('user_id',user).order('reading_day',{ascending:true}).limit(301);
  if(error)throw error;if(run!==gen)return;
  const changes=mergeByRevision(data);
  if(changes.length){const {error:writeError}=await supabase.from('navigators_reading_progress').upsert(changes,{onConflict:'user_id,reading_day'});if(writeError)throw writeError}
  if(run===gen)status('Saved on this device and in your account');
 }catch(error){if(run===gen)status('Saved on this device. Account sync is unavailable until the database is ready.')}
 finally{syncBusy=false;if(pending){pending=false;if(account)sync()}}
}
let seen=JSON.stringify(bridge.read());
window.addEventListener('navigators:saved',()=>{
 bucket();
 const now=JSON.stringify(bridge.read());if(seen===now)return;seen=now;
 if(account){status('Saved locally · Syncing…');clearTimeout(writeTimer);writeTimer=setTimeout(sync,700)}
});
$('sync-now').addEventListener('click',sync);
window.addEventListener('online',()=>{if(account)sync()});
window.addEventListener('focus',()=>{if(account)sync()});
window.addEventListener('pagehide',bucket);
function circleUI(){
 const select=$('circle-target'),old=select.value;select.replaceChildren();
 for(const c of circles){const option=document.createElement('option');option.value=c.circle_id;option.textContent=c.circle_name;select.append(option)}
 if(circles.some(c=>c.circle_id===old))select.value=old;
 $('circle-controls').hidden=!account||!circles.length;
 $('circle-status').textContent=!account?'Sign in to share with your Circles.':circles.length?'Share what stood out. SOS answers remain private.':'No Circles yet. Create or join one using the Circles link.';
}
let postGeneration=0;
async function fetchPosts(){
 const stamp=++postGeneration,container=$('circle-posts');container.replaceChildren();
 if(!account||!circles.length)return;
 try{
  const ids=circles.map(x=>x.circle_id);
  const {data,error}=await supabase.from('navigators_circle_posts')
    .select('id,circle_id,author_id,body,parent_id,created_at').in('circle_id',ids).eq('reading_day',chapter()).order('created_at',{ascending:true}).limit(200);
  if(error)throw error;if(stamp!==postGeneration)return;
  const posts=data||[],authors=[...new Set(posts.map(p=>p.author_id))],names=new Map();
  if(authors.length){const {data:members}=await supabase.from('follow_circle_members').select('circle_id,user_id,display_name').in('circle_id',ids).in('user_id',authors).limit(300);for(const m of members||[])names.set(m.circle_id+':'+m.user_id,m.display_name)}
  container.replaceChildren();
  const roots=posts.filter(p=>!p.parent_id);
  if(!roots.length){const p=document.createElement('p');p.textContent='No one has shared on this reading yet.';container.append(p)}
  function addPost(post,target,indent=0){
   const article=document.createElement('article');if(indent)article.className='circle-reply';
   const header=document.createElement('strong');header.textContent=names.get(post.circle_id+':'+post.author_id)||'Circle member';
   const meta=document.createElement('small');meta.textContent=' · '+(circles.find(c=>c.circle_id===post.circle_id)?.circle_name||'Circle');
   const body=document.createElement('p');body.textContent=post.body;article.append(header,meta,body);
   if(!indent){const reply=document.createElement('button');reply.type='button';reply.textContent='Reply';reply.className='secondary';article.append(reply);const form=document.createElement('form');form.hidden=true;const message=document.createElement('textarea');message.required=true;message.maxLength=3000;message.rows=2;message.setAttribute('aria-label','Reply to post');const submit=document.createElement('button');submit.type='submit';submit.textContent='Send';form.append(message,submit);article.append(form);reply.addEventListener('click',()=>{form.hidden=!form.hidden;if(!form.hidden)message.focus()});form.addEventListener('submit',async event=>{event.preventDefault();submit.disabled=true;const {error}=await supabase.from('navigators_circle_posts').insert({circle_id:post.circle_id,reading_day:chapter(),author_id:account.id,parent_id:post.id,body:message.value.trim()});if(error)notice('Reply failed. '+error.message);else{notice('Reply shared.');fetchPosts()}submit.disabled=false})}
   target.append(article);
   for(const child of posts.filter(p=>p.parent_id===post.id))addPost(child,article,indent+1);
  }
  for(const post of roots)addPost(post,container);
 }catch(error){if(stamp!==postGeneration)return;container.textContent='Circle conversations are unavailable until the database migration is applied.'}
}
$('circle-share').addEventListener('click',async()=>{
 const circle_id=$('circle-target').value,body=$('circle-message').value.trim();
 if(!account||!circles.some(c=>c.circle_id===circle_id)||!body)return notice('Choose a Circle and write a message first.');
 const button=$('circle-share');button.disabled=true;
 try{const {error}=await supabase.from('navigators_circle_posts').insert({circle_id,author_id:account.id,reading_day:chapter(),body});if(error)throw error;$('circle-message').value='';notice('Shared with your Circle.');await fetchPosts()}catch(error){notice('Could not share. '+error.message)}finally{button.disabled=false}
});
window.addEventListener('navigators:day-changed',fetchPosts);
async function reload(){
 try{
  const {data:{user},error}=await supabase.auth.getUser();if(error)throw error;
  if(account?.id!==(user?.id||undefined)){clearTimeout(writeTimer);gen++;account=user||null;switchOwner(account?.id||'guest');seen=JSON.stringify(bridge.read())}
  account=user||null;accountUI();
  if(account){const {data:members,error:circleError}=await supabase.rpc('follow_circle_schedule');circles=circleError?[]:(members||[]);await sync()}
  else{circles=[];status('Saved on this device · Sign in to sync')}
  circleUI();await fetchPosts();
 }catch(error){status('Saved on this device. Account features are temporarily unavailable.')}
}
supabase.auth.onAuthStateChange(()=>queueMicrotask(reload));
reload();
