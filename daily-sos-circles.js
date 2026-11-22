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
const circleLabel=id=>circles.find(c=>c.circle_id===id)?.circle_name||'Circle';
const allowedIds=()=>circles.map(c=>c.circle_id);
function updateShareEmphasis(){
 const b=$('following-share-toggle');
 b.classList.toggle('following-featured',!!bridge()?.completed?.());
}
function setContext(){
 const primary=circles.find(c=>c.is_primary);
 $('following-context').textContent=primary
  ?(primary.finished?'Your primary Circle has finished its study.':primary.circle_name+' · Day '+primary.day_no+' shared reading')
  :(user?'Read independently or start a Circle with friends.':'Your personal SOS answers stay private.');
 $('following-manage').hidden=!user;
 $('following-share-toggle').hidden=!user||!circles.length;
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
 container.replaceChildren(element('p','Loading replies…','following-muted'));
 const {data,error}=await supabase.from('follow_circle_posts')
  .select('id,author_id,circle_id,body,created_at')
  .eq('circle_id',post.circle_id).eq('parent_id',post.id)
  .order('created_at',{ascending:true}).limit(200);
 if(!container.isConnected)return;
 if(error){container.textContent='Could not load replies.';return}
 container.replaceChildren();
 const items=data||[],names=await getNames(items);
 for(const reply of items){
  const item=element('div',undefined,'following-reply');
  item.append(element('strong',labelOf(names,reply)),element('p',reply.body));
  container.append(item);
 }
 if(items.length===200)container.append(element('p','Additional replies are available in the Circle.','following-muted'));
 if(!items.length)container.append(element('p','Be the first to reply.','following-muted'));
}
function postCard(post,names,replyCount=0){
 const card=element('article',undefined,'following-post');
 const meta=element('div',undefined,'following-post-meta');
 meta.append(element('strong',labelOf(names,post)),element('span',circleLabel(post.circle_id)));
 card.append(meta,element('p',post.body));
 const controls=element('div',undefined,'following-actions');
 const replies=element('div',undefined,'following-replies');replies.hidden=true;
 const form=element('form',undefined,'following-reply-form');form.hidden=true;
 const input=element('textarea');input.required=true;input.maxLength=3000;input.rows=2;input.placeholder='Write an encouraging reply…';
 const submit=element('button','Post reply','following-small');submit.type='submit';
 form.append(input,submit);
 let opened=false;
 const replyToggle=button('Reply',async()=>{
  opened=!opened;replies.hidden=!opened;form.hidden=!opened;
  if(opened)await loadReplies(post,replies);
  if(opened)input.focus();
 });
 controls.append(replyToggle);
 if(replyCount)controls.append(element('span',replyCount+' repl'+(replyCount===1?'y':'ies'),'following-muted'));
 controls.append(button('Encourage',async()=>{
  if(!user)return;
  const {error}=await supabase.from('follow_circle_reactions')
   .insert({circle_id:post.circle_id,post_id:post.id,user_id:user.id});
  message(error&&error.code!=='23505'?error.message:'Encouragement sent.',!!error&&error.code!=='23505');
 }));
 card.append(controls,replies,form);
 form.addEventListener('submit',async e=>{
  e.preventDefault();const body=input.value.trim();
  if(!body)return;submit.disabled=true;
  try{
   const {error}=await supabase.from('follow_circle_posts')
    .insert({circle_id:post.circle_id,author_id:user.id,parent_id:post.id,body});
   if(error)throw error;
   input.value='';await loadReplies(post,replies);message('Reply shared with '+circleLabel(post.circle_id)+'.');
  }catch(err){message(err.message,true)}finally{submit.disabled=false}
 });
 return card;
}
async function fetchPosts(reset=true){
 if(loading&&!reset)return;
 const requestedDay=day(),serial=++requestId;
 if(reset){offset=0;$('following-posts').replaceChildren()}
 if(!user||!circles.length){
  $('following-posts').replaceChildren(element('p',
   user?'No Circles yet. Start one to follow Jesus with friends.':'Sign in to see reflections shared within your Circles.','following-muted'));
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
  if(serial!==requestId||requestedDay!==day())return;
  for(const p of posts)$('following-posts').append(postCard(p,names,replyCounts.get(p.id)||0));
  offset+=posts.length;
  $('following-expand').hidden=expanded||offset>=(count||0);
  $('following-more').hidden=!expanded||offset>=(count||0);
  if(reset&&!posts.length)$('following-posts').append(element('p','No reflections for this reading yet. You could share the first.','following-muted'));
 }catch(e){
  if(serial===requestId)message('Conversations are unavailable right now. Your personal reading still works. '+e.message,true);
 }finally{loading=false}
}
function updateTargetOptions(){
 const root=$('following-targets');root.replaceChildren();
 for(const c of circles){
  const label=element('label',undefined,'following-target');
  const checkbox=element('input');checkbox.type='checkbox';checkbox.value=c.circle_id;
  label.append(checkbox,document.createTextNode(' '+c.circle_name));
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
  setContext();updateTargetOptions();await fetchPosts(true);
 }catch(e){
  message('Circle activity could not load. Daily SOS is still available. '+e.message,true);
 }
}
if(root){
 $('following-expand').addEventListener('click',()=>{expanded=true;$('following-expanded-controls').hidden=false;fetchPosts(true)});
 $('following-collapse').addEventListener('click',()=>{expanded=false;$('following-expanded-controls').hidden=true;filter='';$('following-filter').value='';fetchPosts(true)});
 $('following-filter').addEventListener('change',()=>{filter=$('following-filter').value;fetchPosts(true)});
 $('following-more').addEventListener('click',()=>fetchPosts(false));
 $('following-share-toggle').addEventListener('click',()=>{
  const form=$('following-share-form');form.hidden=!form.hidden;
  if(!form.hidden)$('following-body').focus();
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
   $('following-share-form').hidden=true;
   message('Shared separately with '+targets.length+' Circle'+(targets.length===1?'':'s')+'.');
   await fetchPosts(true);
  }catch(err){message(err.message,true)}finally{submit.disabled=false}
 });
 window.addEventListener('sos:day-rendered',()=>{
  expanded=false;filter='';$('following-expanded-controls').hidden=true;
  $('following-filter').value='';updateShareEmphasis();fetchPosts(true);
 });
 window.addEventListener('sos:progress-saved',updateShareEmphasis);
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
