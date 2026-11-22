import {supabase} from './supabase.js';

// Community is optional: Daily SOS must remain fully usable if this module fails.
const root=document.getElementById('following-together');
const $=id=>document.getElementById(id);
const bridge=()=>window.sosCircleBridge;
const PAGE=20;
let user=null,circles=[],expanded=false,filter='',offset=0,requestId=0,loading=false;
let initialScheduleApplied=false;
const element=(tag,text,cls)=>{
 const el=document.createElement(tag);
 if(text!==undefined)el.textContent=text;
 if(cls)el.className=cls;
 return el;
};
const button=(label,handler,cls='following-small')=>{
 const b=element('button',label,cls);b.type='button';b.addEventListener('click',handler);return b;
};
const message=(text,error=false)=>{
 $('following-notice').textContent=text||'';
 $('following-notice').classList.toggle('following-error',error);
};
const day=()=>bridge()?.day?.()||1;
const ICON={
 heart:'<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
 reply:'<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
 send:'<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>'
};
const icon=name=>{const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('aria-hidden','true');s.setAttribute('class','following-ico');s.setAttribute('fill','none');s.setAttribute('stroke','currentColor');s.setAttribute('stroke-width','2');s.setAttribute('stroke-linecap','round');s.setAttribute('stroke-linejoin','round');s.innerHTML=ICON[name];return s};
const avatar=(name,cls='following-avatar')=>{const a=element('span',(String(name||'?').trim()[0]||'?').toUpperCase(),cls);a.setAttribute('aria-hidden','true');return a};
function when(iso){
 const t=new Date(iso);if(Number.isNaN(t.getTime()))return '';
 const mins=Math.round((Date.now()-t.getTime())/60000);
 if(mins<1)return 'Just now';if(mins<60)return mins+'m';
 const hours=Math.round(mins/60);if(hours<24)return hours+'h';
 if(hours<48)return 'Yesterday';
 return t.toLocaleDateString('en-US',{month:'short',day:'numeric'});
}
const J=()=>window.OBEY_SOS_JOURNEY;
const names2=list=>J()?.listNames?J().listNames(list):list.join(', ');
// Reflections seen on this device, so a friend's new reflection is noticeable.
// Stored locally only; nothing is sent anywhere.
const SEEN_KEY='obeytools:following:seen:v1';
const seen=(()=>{try{return new Set(JSON.parse(localStorage.getItem(SEEN_KEY))||[])}catch{return new Set()}})();
function markSeen(ids){
 let changed=false;for(const id of ids)if(!seen.has(id)){seen.add(id);changed=true}
 if(!changed)return;
 try{localStorage.setItem(SEEN_KEY,JSON.stringify([...seen].slice(-600)))}catch{}
}
const firstVisit=!localStorage.getItem(SEEN_KEY);
const myName=()=>circles.find(c=>c.is_primary)?.display_name||user?.user_metadata?.full_name||user?.email||'';
const circleLabel=id=>circles.find(c=>c.circle_id===id)?.circle_name||'Circle';
const allowedIds=()=>circles.map(c=>c.circle_id);
// Sharing is always available, but becomes the natural next step once the
// day's SOS is complete. Completion never depends on sharing.
function updateShareEmphasis(){
 const b=$('following-share-toggle'),done=!!bridge()?.completed?.();
 b.classList.toggle('following-featured',done);
 $('following-share-label').textContent=done?'Today is complete. Share what stood out with your Circle?':'Share a reflection on this passage';
}
function setContext(){
 const primary=circles.find(c=>c.is_primary);
 const names=circles.map(c=>c.circle_name);
 $('following-context').textContent=names.length
  ?'Reflections on this passage from '+(names.length<=2?names.join(' and '):names.slice(0,2).join(', ')+' and '+(names.length-2)+' more')
  :'';
 $('following-context').hidden=!names.length;
 // Top of the page answers "which day am I reading, and with whom?"
 const top=$('reading-context');
 if(top){
  top.hidden=!user||!circles.length;
  top.textContent=primary
   ?(primary.finished?primary.circle_name+' finished the 365-day reading':'Reading with '+primary.circle_name+' · their Day '+primary.day_no)
   :'Reading at your own pace';
 }
 $('following-manage').hidden=!user;
 const me=root.querySelector('.following-avatar-me');if(me)me.textContent=(String(myName()).trim()[0]||'').toUpperCase();
 $('following-finished-actions').hidden=!primary?.finished;
 $('following-share-toggle').hidden=!user||!circles.length||!$('following-share-form').hidden;
 if(!user||!circles.length)$('following-share-form').hidden=true;
 updateShareEmphasis();
}
async function getNames(posts){
 const keys=new Map(),authorIds=[...new Set(posts.map(p=>p.author_id))];
 if(!authorIds.length)return keys;
 const ids=[...new Set(posts.map(p=>p.circle_id))];
 const {data,error}=await supabase.from('follow_circle_members')
  .select('circle_id,user_id,display_name').in('circle_id',ids).in('user_id',authorIds).limit(200);
 if(error)throw error;
 for(const m of data||[])keys.set(m.circle_id+':'+m.user_id,m.display_name);
 return keys;
}
function labelOf(names,post){return names.get(post.circle_id+':'+post.author_id)||'Member'}
async function loadReplies(post,container){
 container.replaceChildren(element('p','Loading replies…','following-muted following-loading'));
 const {data,error}=await supabase.from('follow_circle_posts')
  .select('id,author_id,circle_id,body,created_at')
  .eq('circle_id',post.circle_id).eq('parent_id',post.id)
  .order('created_at',{ascending:true}).limit(200);
 if(!container.isConnected)return;
 if(error){container.textContent='Could not load replies.';return}
 container.replaceChildren();
 const items=data||[],names=await getNames(items);
 for(const reply of items){
  const item=element('div',undefined,'following-reply'),text=element('div');
  const who=element('div',undefined,'following-reply-meta');
  who.append(element('strong',labelOf(names,reply)),element('span',when(reply.created_at),'following-time'));
  text.append(who,element('p',reply.body));
  item.append(avatar(labelOf(names,reply),'following-avatar following-avatar-sm'),text);
  container.append(item);
 }
 if(items.length===200)container.append(element('p','More replies are in the Circle.','following-muted'));
 return items.length;
}
function postCard(post,names,replyCount=0,reactions={mine:false,names:[]}){
 const card=element('article',undefined,'following-post');
 const name=labelOf(names,post);
 const head=element('div',undefined,'following-post-meta');
 const who=element('div');
 who.append(element('strong',name));
 const sub=element('span',circleLabel(post.circle_id),'following-circle');
 const time=when(post.created_at);
 who.append(sub);if(time)who.append(element('span',time,'following-time'));
 if(!firstVisit&&!seen.has(post.id)&&post.author_id!==user?.id){const n=element('span','New','following-new');who.append(n)}
 head.append(avatar(name),who);
 const body=element('div',undefined,'following-post-body');
 body.append(element('p',post.body));
 const controls=element('div',undefined,'following-actions');
 const replies=element('div',undefined,'following-replies');replies.hidden=true;
 const form=element('form',undefined,'following-reply-form');form.hidden=true;
 const input=element('textarea');input.required=true;input.maxLength=3000;input.rows=1;input.placeholder='Reply to '+name+'…';
 input.setAttribute('aria-label','Reply to '+name);
 const submit=element('button',undefined,'following-send');submit.type='submit';submit.setAttribute('aria-label','Send reply');submit.append(icon('send'));
 form.append(input,submit);
 input.addEventListener('input',()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight+2,200)+'px'});
 let opened=false,count=replyCount;
 const replyLabel=()=>opened?'Hide replies':count?count+' repl'+(count===1?'y':'ies'):'Reply';
 const replyToggle=element('button',undefined,'following-act');replyToggle.type='button';
 const replyText=element('span',replyLabel());replyToggle.append(icon('reply'),replyText);
 replyToggle.setAttribute('aria-expanded','false');
 replyToggle.addEventListener('click',async()=>{
  opened=!opened;replies.hidden=!opened;form.hidden=!opened;replyText.textContent=replyLabel();
  replyToggle.setAttribute('aria-expanded',String(opened));
  if(opened){input.focus();const n=await loadReplies(post,replies);if(typeof n==='number'){count=n;replyText.textContent=replyLabel()}}
 });
 // Encouragement is personal, not a score: show who, never a tally to compete on.
 let mine=!!reactions.mine,busy=false;
 const others=(reactions.names||[]).filter(Boolean);
 const own=post.author_id===user?.id;
 const encourage=element('button',undefined,'following-act following-encourage');encourage.type='button';
 const encText=element('span');encourage.append(icon('heart'),encText);
 const encouraged=element('p','','following-encouraged');encouraged.setAttribute('aria-live','polite');
 const paint=(pulse=false)=>{
  encourage.setAttribute('aria-pressed',String(mine));
  encText.textContent=mine?'Encouraged':'Encourage';
  encourage.setAttribute('aria-label',mine?'Encouraged '+name+'. Select to undo':'Encourage '+name);
  const who=(mine&&!own?['you']:[]).concat(others);
  encouraged.textContent=own
   ?(others.length?names2(others)+' encouraged your reflection':'')
   :(others.length?'Encouraged by '+names2(who):'');
  encouraged.hidden=!encouraged.textContent;
  if(pulse){encourage.classList.remove('following-pulse');void encourage.offsetWidth;encourage.classList.add('following-pulse')}
 };
 paint();
 if(own)encourage.hidden=true;
 encourage.addEventListener('click',async()=>{
  if(!user||busy)return;busy=true;
  const was=mine;mine=!mine;paint(mine);
  try{
   const {error}=was
    ?await supabase.from('follow_circle_reactions').delete().eq('post_id',post.id).eq('user_id',user.id)
    :await supabase.from('follow_circle_reactions').insert({circle_id:post.circle_id,post_id:post.id,user_id:user.id});
   if(error&&error.code!=='23505')throw error;
  }catch(err){mine=was;paint();message(err.message,true)}
  finally{busy=false}
 });
 controls.append(replyToggle,encourage);
 const sent=element('p','','following-sent');sent.setAttribute('role','status');
 body.append(controls,encouraged,replies,form,sent);
 card.append(head,body);
 form.addEventListener('submit',async e=>{
  e.preventDefault();const text=input.value.trim();
  if(!text)return;submit.disabled=true;
  try{
   const {error}=await supabase.from('follow_circle_posts')
    .insert({circle_id:post.circle_id,author_id:user.id,parent_id:post.id,body:text});
   if(error)throw error;
   input.value='';input.style.height='';
   const n=await loadReplies(post,replies);if(typeof n==='number'){count=n;replyText.textContent=replyLabel()}
   // Confirm right where the reply was written.
   const mineNow=replies.querySelectorAll('.following-reply');const last=mineNow[mineNow.length-1];
   if(last){last.classList.add('following-just-posted');setTimeout(()=>last.classList.remove('following-just-posted'),2600)}
   sent.textContent='Reply sent to '+name+' in '+circleLabel(post.circle_id)+'.';
   setTimeout(()=>{if(sent.isConnected)sent.textContent=''},6000);
  }catch(err){message(err.message,true)}finally{submit.disabled=false}
 });
 return card;
}
async function reactionsFor(posts){
 const map=new Map();
 if(!posts.length||!user)return map;
 const {data,error}=await supabase.from('follow_circle_reactions')
  .select('post_id,user_id,circle_id').in('post_id',posts.map(p=>p.id)).limit(2000);
 if(error)return map; // Encouragement is a nicety; never block reflections.
 const rows=data||[];
 let who=new Map();
 try{who=await getNames(rows.filter(r=>r.user_id!==user.id).map(r=>({circle_id:r.circle_id,author_id:r.user_id})))}catch{}
 for(const row of rows){
  const r=map.get(row.post_id)||{mine:false,names:[]};
  if(row.user_id===user.id)r.mine=true;
  else{const n=who.get(row.circle_id+':'+row.user_id);if(n)r.names.push(n)}
  map.set(row.post_id,r);
 }
 return map;
}
function emptyState(title,text,link){
 const box=element('div',undefined,'following-empty');
 box.append(element('p',title,'following-empty-title'));
 if(text)box.append(element('p',text,'following-muted'));
 if(link){const a=element('a',link[0],'following-link');a.href=link[1];box.append(a)}
 return box;
}
async function fetchPosts(reset=true){
 if(loading&&!reset)return;
 const requestedDay=day(),serial=++requestId;
 if(reset){offset=0;$('following-posts').replaceChildren()}
 if(!user||!circles.length){
  $('following-posts').replaceChildren(user
   ?emptyState('Read with friends','Start a Circle and you’ll read the same passage each day and encourage one another here.',['Start a Circle','/follow-circles.html?day='+day()])
   :emptyState('Read with friends','Circles let a few friends read the same passage each day and encourage one another.',['Sign in or learn about Circles','/follow-circles.html']));
  $('following-expand').hidden=true;$('following-more').hidden=true;return;
 }
 loading=true;
 try{
  let query=supabase.from('follow_circle_posts')
   .select('id,circle_id,author_id,body,created_at,parent_id,reading_day',{count:'exact'})
   .eq('reading_day',requestedDay).is('parent_id',null)
   .order('created_at',{ascending:false}).order('id',{ascending:false});
  if(filter)query=query.eq('circle_id',filter);
  else query=query.in('circle_id',allowedIds());
  const size=expanded?PAGE:3;
  const {data,error,count}=await query.range(offset,offset+size-1);
  if(error)throw error;
  if(serial!==requestId||requestedDay!==day())return;
  const posts=data||[],names=await getNames(posts);
  if(serial!==requestId||requestedDay!==day())return;
  const replyCounts=new Map();
  if(posts.length){
   const replyResult=await supabase.from('follow_circle_posts')
    .select('parent_id').in('parent_id',posts.map(p=>p.id)).limit(1000);
   if(replyResult.error)throw replyResult.error;
   for(const row of replyResult.data||[])replyCounts.set(row.parent_id,(replyCounts.get(row.parent_id)||0)+1);
  }
  const reactions=await reactionsFor(posts);
  if(serial!==requestId||requestedDay!==day())return;
  for(const p of posts)$('following-posts').append(postCard(p,names,replyCounts.get(p.id)||0,reactions.get(p.id)));
  markSeen(posts.map(p=>p.id));
  offset+=posts.length;
  $('following-expand').hidden=expanded||offset>=(count||0);
  $('following-more').hidden=!expanded||offset>=(count||0);
  if(reset&&!posts.length)$('following-posts').append(emptyState('No reflections on this passage yet',bridge()?.completed?.()?'You finished today. A sentence about what stood out could encourage someone.':'When someone in your Circles shares about this passage, it will appear here.'));
 }catch(e){
  if(serial===requestId)message('Conversations are unavailable right now. Your personal reading still works. '+e.message,true);
 }finally{loading=false}
}
// "Friends are here": real reflections on this passage by other members of
// the reader's Circles. Membership-scoped by RLS; no presence is implied.
let friendsSerial=0;
async function updateFriends(){
 const line=$('friends-line');if(!line)return;
 const serial=++friendsSerial,requestedDay=day();
 if(!user||!circles.length){line.hidden=true;return}
 try{
  const {data,error}=await supabase.from('follow_circle_posts')
   .select('author_id,circle_id,created_at').eq('reading_day',requestedDay).is('parent_id',null)
   .in('circle_id',allowedIds()).neq('author_id',user.id)
   .order('created_at',{ascending:false}).limit(100);
  if(error)throw error;
  const rows=data||[],names=await getNames(rows);
  if(serial!==friendsSerial||requestedDay!==day())return;
  const byAuthor=new Map();
  for(const r of rows)if(!byAuthor.has(r.author_id))byAuthor.set(r.author_id,names.get(r.circle_id+':'+r.author_id)||'');
  const list=[...byAuthor.values()].filter(Boolean);
  const sentence=J()?.friendsSentence?.(list)||'';
  line.hidden=!sentence;if(!sentence)return;
  const stack=element('span',undefined,'stack');stack.setAttribute('aria-hidden','true');
  for(const n of list.slice(0,3))stack.append(element('span',n.trim()[0].toUpperCase()));
  const chev=document.createElementNS('http://www.w3.org/2000/svg','svg');chev.setAttribute('viewBox','0 0 24 24');chev.setAttribute('class','ui-icon');chev.setAttribute('aria-hidden','true');chev.setAttribute('fill','none');chev.setAttribute('stroke','currentColor');chev.setAttribute('stroke-width','2');chev.innerHTML='<path d="m6 9 6 6 6-6"/>';
  line.replaceChildren(stack,element('span',sentence),chev);
 }catch{if(serial===friendsSerial)line.hidden=true}
}
function updateTargetOptions(){
 const root=$('following-targets');root.replaceChildren();
 for(const c of circles){
  const label=element('label',undefined,'following-target');
  const checkbox=element('input');checkbox.type='checkbox';checkbox.value=c.circle_id;
  label.append(checkbox,element('span',c.circle_name));
  root.append(label);
 }
 const select=$('following-filter');select.replaceChildren();
 const all=element('option','All my Circles');all.value='';select.append(all);
 for(const c of circles){const opt=element('option',c.circle_name);opt.value=c.circle_id;select.append(opt)}
 filter='';select.value='';
}
function applyPrimarySchedule(){
 const primary=circles.find(c=>c.is_primary);
 if(!primary||new URLSearchParams(location.search).has('day'))return;
 const current=Number(primary.day_no);
 if(Number.isInteger(current)&&current>=1&&current<=365&&bridge()?.day?.()!==current){
  bridge().goToDay(current);
 }
 initialScheduleApplied=true;
}
async function reloadAccount(){
 try{
  const {data:{user:next},error:authError}=await supabase.auth.getUser();
  if(authError)throw authError;
  user=next||null;circles=[];
  if(!user)bridge()?.setSchedule?.(null);
  if(user){
   const {data,error}=await supabase.rpc('follow_circle_schedule');
   if(error)throw error;
   circles=data||[];
   bridge()?.setSchedule?.(circles.find(c=>c.is_primary)||null);
   if(!initialScheduleApplied)applyPrimarySchedule();
  }
  setContext();updateTargetOptions();updateFriends();await fetchPosts(true);
 }catch(e){
  message('Circle activity could not load. Daily SOS is still available. '+e.message,true);
 }
}
if(root){
 $('following-independent').addEventListener('click',async()=>{
  if(!user)return;
  const b=$('following-independent');b.disabled=true;
  try{
   const {error}=await supabase.rpc('follow_circle_set_independent');
   if(error)throw error;
   initialScheduleApplied=true;
   await reloadAccount();
   const target=bridge()?.soloDay?.();
   if(target)bridge()?.goToDay?.(target);
   message('Your daily reading now follows your own progress. You still belong to your Circles.');
  }catch(e){message(e.message,true)}finally{b.disabled=false}
 });
 $('following-expand').addEventListener('click',()=>{expanded=true;$('following-expanded-controls').hidden=false;fetchPosts(true)});
 $('following-collapse').addEventListener('click',()=>{expanded=false;$('following-expanded-controls').hidden=true;filter='';$('following-filter').value='';fetchPosts(true)});
 $('following-filter').addEventListener('change',()=>{filter=$('following-filter').value;fetchPosts(true)});
 $('following-more').addEventListener('click',()=>fetchPosts(false));
 $('following-share-toggle').addEventListener('click',()=>{
  const form=$('following-share-form');form.hidden=!form.hidden;
  $('following-share-toggle').hidden=!form.hidden;
  if(!form.hidden)$('following-body').focus();
 });
 $('following-cancel').addEventListener('click',()=>{
  $('following-share-form').hidden=true;$('following-share-toggle').hidden=!user||!circles.length;
  $('following-share-toggle').focus();
 });
 $('following-share-form').addEventListener('submit',async e=>{
  e.preventDefault();if(!user)return;
  const targets=[...$('following-targets').querySelectorAll('input:checked')].map(x=>x.value);
  if(!targets.length)return message('Choose at least one Circle.',true);
  const body=$('following-body').value.trim();
  if(!body)return;
  const submit=$('following-submit');submit.disabled=true;
  try{
   const rows=targets.map(circle_id=>({circle_id,author_id:user.id,body,reading_day:day()}));
   const {error}=await supabase.from('follow_circle_posts').insert(rows);
   if(error)throw error;
   $('following-body').value='';
   $('following-targets').querySelectorAll('input:checked').forEach(cb=>cb.checked=false);
   $('following-share-form').hidden=true;$('following-share-toggle').hidden=false;
   message('Shared with '+targets.map(circleLabel).join(', ')+'. Your friends will see it under this passage.');
   await fetchPosts(true);
  }catch(err){message(err.message,true)}finally{submit.disabled=false}
 });
 window.addEventListener('sos:day-rendered',()=>{
  expanded=false;filter='';message('');$('following-expanded-controls').hidden=true;
  $('following-filter').value='';updateShareEmphasis();fetchPosts(true);updateFriends();
 });
 window.addEventListener('sos:progress-saved',updateShareEmphasis);
 window.addEventListener('sos:day-completed',updateShareEmphasis);
 window.addEventListener('sos:sync-applied',()=>{
  // Sync may restore a personal cursor; the shared primary schedule wins only
  // when loading the daily view, never when someone manually explores history.
  if(!new URLSearchParams(location.search).has('day')){
   applyPrimarySchedule();
  }
  updateShareEmphasis();
 });
 supabase.auth.onAuthStateChange(()=>queueMicrotask(reloadAccount));
 reloadAccount();
}
