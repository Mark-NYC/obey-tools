import {supabase} from './supabase.js';
const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
let user=null,memberships=[],selected=null,activeTab='feed',offset=0,memberOffset=0;
const PAGE=20,mentions=new Map();
let searchTimer=null;
const val=id=>$(id).value.trim();
function status(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error)}
function el(tag,txt,cls){const e=document.createElement(tag);if(txt!==undefined)e.textContent=txt;if(cls)e.className=cls;return e}
function button(txt,fn,cls='mini'){const b=el('button',txt,cls);b.type='button';b.addEventListener('click',fn);return b}
async function invoke(name,args){const {data,error}=await supabase.rpc(name,args);if(error)throw error;return data}
async function loadAuth(){
 $('loading').hidden=false;
 try{const result=await supabase.auth.getUser();user=result.data?.user||null;
 $('loading').hidden=true;$('auth-needed').hidden=!!user;$('app').hidden=!user;
 if(!user){if(params.get('invite')){const preview=await invoke('follow_circle_invite_preview',{p_token:params.get('invite')});if(preview){$('auth-needed').querySelector('h2').textContent='Join '+preview.circle_name;$('auth-needed').querySelector('p').textContent='Sign in with OBEY.TOOLS to join this Circle. Return to your invitation link afterward.'}}return;}
 await loadCircles();
 if(params.get('invite'))await previewInvitation(params.get('invite'));
 if(params.get('circle')&&memberships.some(m=>m.circle_id===params.get('circle')))await showCircle(params.get('circle'));
 else if(!params.get('invite'))showOverview();
 }catch(e){$('loading').hidden=true;status(e.message||'Unable to load your account',true)}
}
async function loadCircles(){
 const {data,error}=await supabase.from('follow_circle_members').select('circle_id,user_id,display_name,role,progress_visible,email_replies,email_mentions,email_digest').eq('user_id',user.id);
 if(error)throw error;
 const ids=(data||[]).map(x=>x.circle_id);let circles=[];
 if(ids.length){const r=await supabase.from('follow_circles').select('id,name,owner_id,created_at').in('id',ids);if(r.error)throw r.error;circles=r.data||[]}
 memberships=(data||[]).map(m=>({...m,circle:circles.find(c=>c.id===m.circle_id)})).filter(m=>m.circle);
 renderCircleList();
}
function renderCircleList(){
 const root=$('circle-list');root.replaceChildren();
 $('empty-circles').hidden=memberships.length>0;
 for(const m of memberships){
  const card=el('button',undefined,'circle-card');
  card.append(el('strong',m.circle.name),el('small',m.role==='steward'?'You steward this Circle':'Private Circle · Your own pace'));
  card.addEventListener('click',()=>showCircle(m.circle_id));root.append(card)
 }
}
function showOverview(){
 selected=null;$('overview').hidden=false;$('circle-view').hidden=true;
 history.replaceState(null,'','/follow-circles.html');renderCircleList()
}
async function previewInvitation(token){
 const preview=await invoke('follow_circle_invite_preview',{p_token:token});
 $('overview').hidden=false;$('invite-preview').hidden=!preview;
 if(!preview){status('This invitation has expired or been revoked.',true);return}
 $('invite-circle-name').textContent=preview.circle_name;
 if(memberships.some(m=>m.circle_id===preview.circle_id)){status('You already belong to this Circle.');$('invite-preview').hidden=true;await showCircle(preview.circle_id)}
}
function displayName(){return memberships[0]?.display_name||user?.user_metadata?.full_name||user?.email?.split('@')[0]||''}
function showInvitation(token){
 $('invite-url').value=new URL('/follow-circles.html?invite='+encodeURIComponent(token),location.origin).href;
 $('link-dialog').hidden=false;
}
async function showCircle(id){
 const m=memberships.find(x=>x.circle_id===id);if(!m)return status('Not a member of that Circle',true);
 selected=m;mentions.clear();renderMentions();$('overview').hidden=true;$('invite-preview').hidden=true;$('circle-view').hidden=false;
 $('circle-name').textContent=m.circle.name;$('circle-subtitle').textContent='Follow at your own pace · Private Circle';
 $('display-name').value=m.display_name;$('show-progress').checked=m.progress_visible;
 $('email-replies').checked=m.email_replies;$('email-mentions').checked=m.email_mentions;$('email-digest').checked=m.email_digest;
 $('circle-settings').hidden=m.role!=='steward';
 history.replaceState(null,'','/follow-circles.html?circle='+encodeURIComponent(id));
 renderTargets();await setTab('feed');
}
async function setTab(tab){
 activeTab=tab;
 document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-current',b.dataset.tab===tab?'page':'false'));
 for(const name of ['feed','members','about'])$('tab-'+name).hidden=name!==tab;
 if(tab==='feed')await loadFeed(true);
 if(tab==='members'){await loadMembers(true);if(selected.role==='steward')await loadReports();}
 if(tab==='about'){renderAbout();$('steward-controls').hidden=selected.role!=='steward';if(selected.role==='steward')await renderTransferMembers();}
}
function renderMentions(){
 const root=$('mention-selected');root.replaceChildren();
 for(const [id,name] of mentions){root.append(button('× '+name,()=>{mentions.delete(id);renderMentions()}))}
}
async function findMentions(){
 const root=$('mention-options');root.replaceChildren();const term=val('mention-search');
 if(term.length<2||!selected)return;
 const {data,error}=await supabase.from('follow_circle_members').select('user_id,display_name')
  .eq('circle_id',selected.circle_id).ilike('display_name','%'+term+'%').limit(10);
 if(error)return status(error.message,true);
 for(const m of data||[]){if(m.user_id===user.id||mentions.has(m.user_id))continue;
  root.append(button('+ '+m.display_name,()=>{
   if(mentions.size>=10)return status('Maximum 10 mentions per post.',true);
   mentions.set(m.user_id,m.display_name);renderMentions();root.replaceChildren();$('mention-search').value='';
  }));
 }
}
function renderTargets(){
 const root=$('post-target-list');root.replaceChildren();
 for(const m of memberships){
  const label=el('label');
  const cb=document.createElement('input');cb.type='checkbox';cb.value=m.circle_id;cb.checked=m.circle_id===selected.circle_id;
  label.append(cb,document.createTextNode(' '+m.circle.name));root.append(label)
 }
}
async function renderTransferMembers(){
 const root=$('steward-transfer');root.replaceChildren(el('option','Choose a member'));
 root.firstChild.value='';
 const {data,error}=await supabase.from('follow_circle_members').select('user_id,display_name').eq('circle_id',selected.circle_id).neq('user_id',user.id).order('display_name').limit(1000);
 if(error)return status(error.message,true);
 for(const m of data||[]){const opt=el('option',m.display_name);opt.value=m.user_id;root.append(opt)}
}
async function loadReports(){
 $('moderation-reports').hidden=false;
 const root=$('reports-list');root.replaceChildren();
 const {data,error}=await supabase.from('follow_circle_reports').select('id,reason,post_id,created_at').eq('circle_id',selected.circle_id).order('created_at',{ascending:false}).limit(30);
 if(error)return status(error.message,true);
 if(!(data||[]).length){root.append(el('p','No reports','muted'));return}
 for(const report of data){const box=el('div',undefined,'reply');box.append(el('p',report.reason),el('small',new Date(report.created_at).toLocaleString()));
 if(report.post_id)box.append(button('Remove reported post',async()=>{
  if(!confirm('Remove the reported post?'))return;
  const r=await supabase.from('follow_circle_posts').delete().eq('circle_id',selected.circle_id).eq('id',report.post_id);
  if(r.error)status(r.error.message,true);else{status('Post removed');loadReports()}
 }));root.append(box)}
}
function renderAbout(){
 const root=$('invite-actions');root.replaceChildren();
 root.append(button('Create invitation link',async()=>{
  try{const token=await invoke('follow_circle_new_invite',{p_circle:selected.circle_id});showInvitation(token)}
  catch(e){status(e.message,true)}
 },'secondary'));
 if(selected.role==='steward')root.append(button('Revoke all invitation links',async()=>{
  if(!confirm('Revoke all existing invitation links for this Circle?'))return;
  try{await invoke('follow_circle_revoke_invites',{p_circle:selected.circle_id});status('Invitation links revoked. Members can create fresh links.')}
  catch(e){status(e.message,true)}
 },'danger'));
}
async function fetchNames(ids){
 const unique=[...new Set(ids.filter(Boolean))];if(!unique.length)return new Map();
 const {data,error}=await supabase.from('follow_circle_members').select('user_id,display_name').eq('circle_id',selected.circle_id).in('user_id',unique);
 if(error)throw error;return new Map((data||[]).map(m=>[m.user_id,m.display_name]));
}
async function loadFeed(reset){
 if(reset){offset=0;$('feed-items').replaceChildren()}
 const filter=val('feed-filter');let query=supabase.from('follow_circle_posts').select('id,circle_id,author_id,reading_day,body,parent_id,created_at', {count:'exact'}).eq('circle_id',selected.circle_id).is('parent_id',null).order('created_at',{ascending:false}).range(offset,offset+PAGE-1);
 if(filter==='general')query=query.is('reading_day',null);
 if(filter==='passage'){const day=Number(val('passage-day'));if(!Number.isInteger(day)||day<1||day>365)return status('Choose a day between 1 and 365',true);query=query.eq('reading_day',day)}
 const {data,error,count}=await query;if(error)return status(error.message,true);
 const posts=data||[],names=await fetchNames(posts.map(p=>p.author_id));
 let replies=[];if(posts.length){const r=await supabase.from('follow_circle_posts').select('id,author_id,body,parent_id,created_at,circle_id').eq('circle_id',selected.circle_id).in('parent_id',posts.map(p=>p.id)).order('created_at',{ascending:true}).limit(300);if(!r.error)replies=r.data||[]}
 const replyNames=await fetchNames(replies.map(p=>p.author_id));
 for(const post of posts)$('feed-items').append(renderPost(post,names.get(post.author_id)||'Member',replies.filter(r=>r.parent_id===post.id),replyNames));
 offset+=posts.length;$('more-posts').hidden=offset>=(count||0);
 if(reset&&!posts.length)$('feed-items').append(el('p','No posts here yet. Share the first reflection.','muted'));
}
function renderPost(post,name,replies,names){
 const article=el('article',undefined,'post');
 const meta=el('div',undefined,'meta');meta.append(el('strong',name),el('span',post.reading_day?'Day '+post.reading_day:'General conversation'));article.append(meta,el('p',post.body));
 for(const r of replies){const box=el('div',undefined,'reply');box.append(el('strong',names.get(r.author_id)||'Member'),el('p',r.body));article.append(box)}
 const actions=el('div',undefined,'actions');
 actions.append(button('Reply',()=>replyTo(post.id)));
 actions.append(button('Encourage ♥',()=>reactTo(post)));
 if(post.author_id===user.id||selected.role==='steward')actions.append(button('Delete',()=>deletePost(post),'mini'));
 actions.append(button('Report',()=>reportPost(post)));
 if(post.author_id!==user.id)actions.append(button('Block author',()=>blockMember(post)));
 article.append(actions);return article
}
async function replyTo(id){
 const body=prompt('Write a reply (visible to this Circle only):');
 if(!body?.trim())return;if(body.length>3000)return status('Reply is too long.',true);
 try{const r=await supabase.from('follow_circle_posts').insert({circle_id:selected.circle_id,author_id:user.id,parent_id:id,body:body.trim()});if(r.error)throw r.error;await loadFeed(true)}
 catch(e){status(e.message,true)}
}
async function reactTo(post){
 try{const r=await supabase.from('follow_circle_reactions').insert({circle_id:selected.circle_id,post_id:post.id,user_id:user.id});if(r.error&&r.error.code!=='23505')throw r.error;status('Encouragement sent')}
 catch(e){status(e.message,true)}
}
async function reportPost(post){
 const reason=prompt('Briefly describe the concern (4–500 characters):');
 if(!reason)return;if(reason.trim().length<4||reason.length>500)return status('Please describe the concern in 4–500 characters.',true);
 const r=await supabase.from('follow_circle_reports').insert({circle_id:selected.circle_id,post_id:post.id,reporter_id:user.id,reason:reason.trim()});
 status(r.error?r.error.message:'Report submitted.',!!r.error)
}
async function blockMember(post){
 if(!confirm('Hide this person’s posts from your feed?'))return;
 const r=await supabase.from('follow_circle_blocks').insert({user_id:user.id,blocked_user_id:post.author_id});
 if(r.error&&r.error.code!=='23505')status(r.error.message,true);else{status('Member blocked');loadFeed(true)}
}
async function deletePost(post){
 if(!confirm('Delete this post and its replies?'))return;
 const r=await supabase.from('follow_circle_posts').delete().eq('id',post.id).eq('circle_id',selected.circle_id);
 if(r.error)status(r.error.message,true);else loadFeed(true)
}
async function loadMembers(reset){
 if(reset){memberOffset=0;$('members-list').replaceChildren()}
 const r=await supabase.from('follow_circle_members').select('user_id,display_name,role,joined_at,progress_visible',{count:'exact'}).eq('circle_id',selected.circle_id).order('joined_at',{ascending:true}).range(memberOffset,memberOffset+PAGE-1);
 if(r.error)return status(r.error.message,true);
 const people=r.data||[];let progress=new Map();
 try{const data=await invoke('follow_circle_progress',{p_circle:selected.circle_id,p_limit:PAGE,p_offset:memberOffset});progress=new Map((data||[]).map(p=>[p.user_id,p]))}catch(e){status('Progress unavailable: '+e.message,true)}
 for(const p of people){
  const box=el('div',undefined,'member'),details=el('div');
  details.append(el('strong',p.display_name),el('small',p.role==='steward'?' · Steward':' · Member'));
  const stats=progress.get(p.user_id);
  details.append(el('div',stats?'Day '+stats.current_day+' · '+stats.completed_days+' completed':'Progress private','muted'));
  box.append(details);
  if(selected.role==='steward'&&p.user_id!==user.id)box.append(button('Remove',()=>removeMember(p)));
  $('members-list').append(box)
 }
 memberOffset+=people.length;$('more-members').hidden=memberOffset>=(r.count||0);
}
async function removeMember(p){
 if(!confirm('Remove '+p.display_name+' from the Circle?'))return;
 try{await invoke('follow_circle_remove',{p_circle:selected.circle_id,p_user:p.user_id});await loadMembers(true)}
 catch(e){status(e.message,true)}
}
$('retry-auth').addEventListener('click',loadAuth);
$('sign-in-form').addEventListener('submit',async e=>{
 e.preventDefault();const btn=e.submitter;btn.disabled=true;
 const {error}=await supabase.auth.signInWithPassword({email:val('auth-email'),password:val('auth-password')});
 if(error)status(error.message,true);else await loadAuth();btn.disabled=false;
});
$('magic-sign-in').addEventListener('click',async()=>{
 const email=val('auth-email');if(!email)return status('Enter your email first.',true);
 const {error}=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:location.href}});
 status(error?error.message:'Check your email for the sign-in link.',!!error)
});
$('new-circle').addEventListener('click',()=>{$('create-display').value=displayName();$('create-dialog').hidden=false});
$('cancel-create').addEventListener('click',()=>{$('create-dialog').hidden=true});
$('create-form').addEventListener('submit',async e=>{
 e.preventDefault();const b=e.submitter;b.disabled=true;
 try{const result=await invoke('follow_circle_create',{p_name:val('create-name'),p_display_name:val('create-display')});$('create-dialog').hidden=true;await loadCircles();await showCircle(result.circle_id);showInvitation(result.token)}
 catch(err){status(err.message,true)}finally{b.disabled=false}
});
$('join-form').addEventListener('submit',async e=>{
 e.preventDefault();const b=e.submitter;b.disabled=true;
 try{const id=await invoke('follow_circle_join',{p_token:params.get('invite'),p_display_name:val('join-name')});await loadCircles();await showCircle(id);status('Welcome to your Circle')}
 catch(err){status(err.message,true)}finally{b.disabled=false}
});
$('copy-link').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('invite-url').value);status('Invitation link copied')}catch{ $('invite-url').select();status('Select and copy the invitation link')}});
$('close-link').addEventListener('click',()=>{$('link-dialog').hidden=true});
$('back-circles').addEventListener('click',showOverview);
$('circle-settings').addEventListener('click',()=>setTab('about'));
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
$('feed-filter').addEventListener('change',()=>{$('passage-filter').hidden=val('feed-filter')!=='passage';if(val('feed-filter')!=='passage')loadFeed(true)});
$('passage-go').addEventListener('click',()=>loadFeed(true));
$('more-posts').addEventListener('click',()=>loadFeed(false));
$('more-members').addEventListener('click',()=>loadMembers(false));
$('mention-search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(findMentions,250)});
$('post-form').addEventListener('submit',async e=>{
 e.preventDefault();const b=e.submitter;const targets=[...$('post-target-list').querySelectorAll('input:checked')].map(x=>x.value);
 if(!targets.length)return status('Select at least one Circle.',true);
 if(mentions.size&&targets.length!==1)return status('Choose one Circle when mentioning members.',true);
 const day=val('post-day')?Number(val('post-day')):null,body=val('post-body');b.disabled=true;
 try{
  const records=targets.map(circle_id=>({circle_id,author_id:user.id,body,reading_day:day,mentioned_user_ids:[...mentions.keys()]}));
  const r=await supabase.from('follow_circle_posts').insert(records);
  if(r.error)throw r.error;
  $('post-body').value='';mentions.clear();renderMentions();$('mention-options').replaceChildren();status('Shared with '+targets.length+' Circle'+(targets.length===1?'':'s'));await loadFeed(true);
 }catch(err){status(err.message,true)}finally{b.disabled=false}
});
$('member-settings').addEventListener('submit',async e=>{
 e.preventDefault();const r=await supabase.from('follow_circle_members').update({display_name:val('display-name'),progress_visible:$('show-progress').checked,email_replies:$('email-replies').checked,email_mentions:$('email-mentions').checked,email_digest:$('email-digest').checked}).eq('circle_id',selected.circle_id).eq('user_id',user.id);
 if(r.error)return status(r.error.message,true);await loadCircles();selected=memberships.find(x=>x.circle_id===selected.circle_id);status('Settings saved')
});
$('transfer-circle').addEventListener('click',async()=>{
 const target=val('steward-transfer');if(!target)return status('Select a member.',true);
 if(!confirm('Transfer stewardship? You will become a regular member.'))return;
 try{await invoke('follow_circle_transfer',{p_circle:selected.circle_id,p_user:target});
 await loadCircles();await showCircle(selected.circle_id);status('Stewardship transferred')}
 catch(e){status(e.message,true)}
});
$('leave-circle').addEventListener('click',async()=>{
 if(!confirm('Leave this Circle? Your private reading progress will stay intact.'))return;
 try{await invoke('follow_circle_leave',{p_circle:selected.circle_id});await loadCircles();showOverview();status('You left the Circle')}
 catch(e){status(e.message,true)}
});
for(let day=1;day<=365;day++){const option=el('option','Day '+day);option.value=String(day);$('post-day').append(option)}
const preselected=Number(params.get('day'));if(Number.isInteger(preselected)&&preselected>=1&&preselected<=365)$('post-day').value=String(preselected);
supabase.auth.onAuthStateChange((_event,session)=>{if(user?.id!==session?.user?.id){queueMicrotask(()=>loadAuth())}});
loadAuth();
