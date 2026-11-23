import {supabase} from './supabase.js';
const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
let user=null,memberships=[],selected=null,activeTab='feed',offset=0,memberOffset=0,cbReady=false,actReady=false,churchNames=new Map();
const PAGE=20,mentions=new Map();
let searchTimer=null;
const val=id=>$(id).value.trim();
function status(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error)}
function el(tag,txt,cls){const e=document.createElement(tag);if(txt!==undefined)e.textContent=txt;if(cls)e.className=cls;return e}
function button(txt,fn,cls='mini'){const b=el('button',txt,cls);b.type='button';b.addEventListener('click',fn);return b}
function avatar(name,cls='avatar'){const a=el('span',(String(name||'?').trim()[0]||'?').toUpperCase(),cls);a.setAttribute('aria-hidden','true');return a}
function when(iso){const t=new Date(iso);if(Number.isNaN(t.getTime()))return '';const m=Math.round((Date.now()-t)/60000);if(m<1)return 'Just now';if(m<60)return m+'m';const h=Math.round(m/60);if(h<24)return h+'h';if(h<48)return 'Yesterday';return t.toLocaleDateString('en-US',{month:'short',day:'numeric'})}
async function invoke(name,args){const {data,error}=await supabase.rpc(name,args);if(error)throw error;return data}
async function loadAuth(){
 $('loading').hidden=false;
 try{const result=await supabase.auth.getUser();user=result.data?.user||null;
 $('loading').hidden=true;$('auth-needed').hidden=!!user;$('app').hidden=!user;
 if(!user){if(params.get('invite')){const preview=await invoke('follow_circle_invite_preview',{p_token:params.get('invite')});if(preview){$('auth-needed').querySelector('h2').textContent='Join '+preview.circle_name;$('auth-needed').querySelector('p').textContent='Sign in with OBEY.TOOLS to join this Circle. Return to your invitation link afterward.'}}return;}
 await detectConversations();
 await loadCircles();
 if(params.get('invite'))await previewInvitation(params.get('invite'));
 if(params.get('circle')&&memberships.some(m=>m.circle_id===params.get('circle')))await showCircle(params.get('circle'),params.get('tab'));
 else if(!params.get('invite'))showOverview();
 // Arriving from a milestone or "Your journey": open Start a Circle directly.
 if(params.get('new')==='1'&&!params.get('invite')){showOverview();$('new-circle').click()}
 }catch(e){$('loading').hidden=true;status(e.message||'Unable to load your account',true)}
}
// Conversation Box sharing needs the 20261123 migration. Until it is applied
// the page keeps working exactly as before and the new parts stay hidden.
async function detectConversations(){
 const r=await supabase.from('follow_circle_members').select('share_conversations').eq('user_id',user.id).limit(1);
 cbReady=!r.error;
 // Circle activities (FOLLOW DAILY / Conversations) need the 20261124 migration.
 const a=await supabase.from('follow_circles').select('uses_reading').limit(1);
 actReady=cbReady&&!a.error;
 document.querySelectorAll('[data-tab="conversations"]').forEach(b=>b.hidden=!cbReady);
}
// What a Circle does together. Before the activities migration every Circle does both.
const usesReading=m=>m?.circle?.uses_reading!==false;
const usesConversations=m=>cbReady&&m?.circle?.uses_conversations!==false;
const CHEV='<svg class="ico chev" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
function purposeText(m){
 const parts=[];
 if(usesReading(m))parts.push('FOLLOW DAILY · '+(m.schedule?.finished?'Finished Day 365':'Day '+(m.schedule?.day_no||1)));
 if(usesConversations(m))parts.push('Conversations');
 return parts.join('  ·  ');
}
async function loadCircles(){
 const memberCols='circle_id,user_id,display_name,role,progress_visible,email_replies,email_mentions,email_digest'+(cbReady?',share_conversations':'');
 const {data,error}=await supabase.from('follow_circle_members').select(memberCols).eq('user_id',user.id);
 if(error)throw error;
 const ids=(data||[]).map(x=>x.circle_id);let circles=[];
 if(ids.length){const r=await supabase.from('follow_circles').select('id,name,owner_id,created_at'+(cbReady?',church_id':'')+(actReady?',uses_reading,uses_conversations':'')).in('id',ids);if(r.error)throw r.error;circles=r.data||[]}
 churchNames=new Map();
 const churchIds=[...new Set(circles.map(c=>c.church_id).filter(Boolean))];
 if(churchIds.length){const r=await supabase.from('follow_churches').select('id,name').in('id',churchIds);if(!r.error)churchNames=new Map((r.data||[]).map(c=>[c.id,c.name]))}
 const schedules=await invoke('follow_circle_schedule',{});
 const byId=new Map((schedules||[]).map(x=>[x.circle_id,x]));
 memberships=(data||[]).map(m=>({...m,circle:circles.find(c=>c.id===m.circle_id),schedule:byId.get(m.circle_id)})).filter(m=>m.circle);
 // Your daily-reading Circle first, then the rest in the order you joined.
 memberships.sort((a,b)=>(b.schedule?.is_primary?1:0)-(a.schedule?.is_primary?1:0));
 renderCircleList();
}
// "My daily reading": one line answering whose reading Follow Daily opens on.
function renderDailyReading(){
 const box=$('daily-reading'),readers=memberships.filter(usesReading);
 box.hidden=!readers.length;if(box.hidden)return;
 const primary=readers.find(m=>m.schedule?.is_primary);
 $('daily-reading-name').textContent=primary?primary.circle.name:'Your own pace';
 $('daily-reading-meta').textContent=primary
  ?(primary.schedule?.finished?'Finished Day 365':'Day '+primary.schedule.day_no+' today')
  :'Change it from the reading page';
 box.href='/daily-sos.html';
}
function renderCircleList(){
 const root=$('circle-list');root.replaceChildren();
 $('empty-circles').hidden=memberships.length>0;
 renderDailyReading();
 for(const m of memberships){
  const card=el('button',undefined,'circle-card');card.type='button';
  const text=el('span',undefined,'circle-text');
  const head=el('span',undefined,'circle-head');head.append(el('strong',m.circle.name));
  if(m.role==='steward')head.append(el('span','Steward','role-tag'));
  text.append(head,el('small',purposeText(m)));
  const extras=el('span',undefined,'circle-extras');
  if(m.schedule?.is_primary)extras.append(el('span','Your daily reading','badge'));
  const church=churchNames.get(m.circle.church_id);
  if(church)extras.append(el('span',church,'church-tag'));
  if(extras.childElementCount)text.append(extras);
  card.append(avatar(m.circle.name,'avatar circle-mark'),text);
  card.insertAdjacentHTML('beforeend',CHEV);
  card.setAttribute('aria-label',[m.circle.name,purposeText(m),m.schedule?.is_primary?'your daily reading':'',church?'connected to '+church:'',m.role==='steward'?'you are the steward':''].filter(Boolean).join(', '));
  card.addEventListener('click',()=>showCircle(m.circle_id));root.append(card)
 }
}
function showOverview(){
 selected=null;$('overview').hidden=false;$('circle-view').hidden=true;
 history.replaceState(null,'','/follow-circles.html');renderCircleList();renderChurchLinks()
}
async function renderChurchLinks(){
 const root=$('church-links');root.replaceChildren();if(!cbReady)return;
 try{
  const churches=await invoke('follow_church_list',{});
  for(const c of churches||[]){
   const a=el('a',undefined,'circle-card');a.href='/church.html?church='+encodeURIComponent(c.church_id);
   const text=el('span',undefined,'circle-text');text.append(el('strong',c.name),el('small','Church view · '+c.circles+' Circle'+(c.circles===1?'':'s')));
   a.append(avatar(c.name,'avatar circle-mark church-mark'),text);
   a.insertAdjacentHTML('beforeend','<svg class="ico chev" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>');
   root.append(a);
  }
 }catch{}
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
async function showCircle(id,tab){
 const m=memberships.find(x=>x.circle_id===id);if(!m)return status('Not a member of that Circle',true);
 selected=m;mentions.clear();renderMentions();$('overview').hidden=true;$('invite-preview').hidden=true;$('circle-view').hidden=false;
 const reading=usesReading(m),conv=usesConversations(m);
 $('circle-name').textContent=m.circle.name;
 $('circle-subtitle').textContent=reading
  ?(m.schedule?.finished?'Finished the 365-day reading together. Earlier readings stay open.':'Reading Day '+(m.schedule?.day_no||1)+' of 365 together · New day at midnight, '+String(m.schedule?.time_zone||'UTC').replaceAll('_',' '))
  :'Helping each other reach friends with the Conversation Box';
 // Purpose and church, small and quiet: the Circle's identity, not a dashboard.
 const tags=$('circle-tags');tags.replaceChildren();
 if(reading)tags.append(el('span','FOLLOW DAILY','purpose-tag'));
 if(conv)tags.append(el('span','Conversations','purpose-tag'));
 const church=churchNames.get(m.circle.church_id);if(church)tags.append(el('span',church,'church-tag'));
 // Move between Circles without going back to the list.
 const sw=$('circle-switch');sw.replaceChildren(el('option','Switch Circle'));sw.firstChild.value='';
 for(const x of memberships)if(x.circle_id!==id){const o=el('option',x.circle.name);o.value=x.circle_id;sw.append(o)}
 sw.value='';$('circle-switch-wrap').hidden=memberships.length<2;
 $('reading-choice').hidden=!reading;$('circle-today-link').hidden=!reading;$('circle-box-link').hidden=reading||!conv;
 $('composer').open=false;document.querySelectorAll('.avatar.me').forEach(a=>a.textContent=(String(m.display_name||'').trim()[0]||'').toUpperCase());
 $('circle-today-link').href=m.schedule?.is_primary?'/daily-sos.html':'/daily-sos.html?circle='+encodeURIComponent(id);
 const primary=memberships.find(x=>x.schedule?.is_primary);
 $('primary-context').textContent=m.schedule?.is_primary?'Your daily reading follows this Circle. Follow Daily opens on its current day.':primary?'Your daily reading follows '+primary.circle.name+'. You can still talk with this Circle about any passage.':'You’re reading at your own pace. You can still talk with this Circle about any passage.';
 $('primary-context').parentElement.classList.toggle('is-primary',!!m.schedule?.is_primary);
 $('make-primary').hidden=!!m.schedule?.is_primary;
 $('read-independent').hidden=!m.schedule?.is_primary;
 $('display-name').value=m.display_name;$('show-progress').checked=m.progress_visible;
 $('share-conversations').checked=!!m.share_conversations;$('share-conversations').closest('label').hidden=!cbReady;
 $('email-replies').checked=m.email_replies;$('email-mentions').checked=m.email_mentions;$('email-digest').checked=m.email_digest;
 history.replaceState(null,'','/follow-circles.html?circle='+encodeURIComponent(id));
 $('tabs-conversations').hidden=!conv;
 renderTargets();await setTab(conv&&(tab==='conversations'||!reading)?'conversations':'feed');
}
async function setTab(tab){
 activeTab=tab;
 document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-current',b.dataset.tab===tab?'page':'false'));
 for(const name of ['feed','conversations','members','about'])$('tab-'+name).hidden=name!==tab;
 const url=new URL(location.href);if(tab==='conversations')url.searchParams.set('tab','conversations');else url.searchParams.delete('tab');history.replaceState(null,'',url.pathname+url.search);
 if(tab==='feed')await loadFeed(true);
 if(tab==='conversations')await loadConversations();
 if(tab==='members'){await loadMembers(true);if(selected.role==='steward')await loadReports();}
 if(tab==='about'){renderAbout();renderChurchSetting();renderActivities();$('steward-controls').hidden=selected.role!=='steward';if(selected.role==='steward')await renderTransferMembers();}
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
  const label=el('label',undefined,'chip-check');
  const cb=document.createElement('input');cb.type='checkbox';cb.value=m.circle_id;cb.checked=false;
  label.append(cb,el('span',m.circle.name));root.append(label)
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
 root.append(button('Create a new link',async()=>{
  try{const token=await invoke('follow_circle_new_invite',{p_circle:selected.circle_id});showInvitation(token)}
  catch(e){status(e.message,true)}
 },'secondary'));
 if(selected.role==='steward')root.append(button('Turn off all links',async()=>{
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
 const filter=val('feed-filter');let query=supabase.from('follow_circle_posts').select('id,circle_id,author_id,reading_day,body,parent_id,created_at'+(cbReady?',kind,prayer_initials,prayer_stage':''), {count:'exact'}).eq('circle_id',selected.circle_id).is('parent_id',null).order('created_at',{ascending:false}).range(offset,offset+PAGE-1);
 if(filter==='general')query=query.is('reading_day',null);
 if(filter==='passage'){const day=Number(val('passage-day'));if(!Number.isInteger(day)||day<1||day>365)return status('Choose a day between 1 and 365',true);query=query.eq('reading_day',day)}
 const {data,error,count}=await query;if(error)return status(error.message,true);
 const posts=data||[],names=await fetchNames(posts.map(p=>p.author_id));
 let replies=[];if(posts.length){const r=await supabase.from('follow_circle_posts').select('id,author_id,body,parent_id,created_at,circle_id').eq('circle_id',selected.circle_id).in('parent_id',posts.map(p=>p.id)).order('created_at',{ascending:true}).limit(300);if(!r.error)replies=r.data||[]}
 const replyNames=await fetchNames(replies.map(p=>p.author_id));
 for(const post of posts)$('feed-items').append(renderPost(post,names.get(post.author_id)||'Member',replies.filter(r=>r.parent_id===post.id),replyNames));
 offset+=posts.length;$('more-posts').hidden=offset>=(count||0);
 if(reset&&!posts.length)$('feed-items').append(el('p','Nothing here yet. Share a prayer request or plan with your Circle.','empty'));
}
function renderPost(post,name,replies,names){
 const article=el('article',undefined,'post');
 const meta=el('div',undefined,'meta');
 const who=el('div');who.append(el('strong',name),el('span',post.kind==='prayer'?'Pray for '+post.prayer_initials+' · '+STAGE_LABEL[post.prayer_stage]:post.reading_day?'Day '+post.reading_day:'Prayer & plans','tag'),el('span',when(post.created_at),'time'));
 meta.append(avatar(name),who);
 const body=el('div',undefined,'post-body');body.append(el('p',post.body));
 const thread=el('div',undefined,'replies');
 for(const r of replies){const box=el('div',undefined,'reply'),t=el('div');t.append(el('strong',names.get(r.author_id)||'Member'),el('p',r.body));box.append(avatar(names.get(r.author_id)||'Member','avatar sm'),t);thread.append(box)}
 const form=el('form',undefined,'reply-form');form.hidden=true;
 const input=el('textarea');input.rows=1;input.maxLength=3000;input.required=true;input.placeholder='Reply to '+name+'…';input.setAttribute('aria-label','Reply to '+name);
 const send=el('button','Send','send');send.type='submit';form.append(input,send);
 form.addEventListener('submit',async e=>{e.preventDefault();await replyTo(post.id,input.value,send)});
 const actions=el('div',undefined,'actions');
 actions.append(button(replies.length?'Reply · '+replies.length:'Reply',()=>{form.hidden=!form.hidden;if(!form.hidden)input.focus()},'act'));
 actions.append(button('Encourage',()=>reactTo(post),'act'));
 const more=el('details',undefined,'more');const sum=el('summary');sum.setAttribute('aria-label','More actions');sum.textContent='•••';more.append(sum);
 const menu=el('div',undefined,'more-menu');
 if(post.author_id===user.id||selected.role==='steward')menu.append(button('Delete',()=>deletePost(post),'menu-item danger-text'));
 menu.append(button('Report',()=>reportPost(post),'menu-item'));
 if(post.author_id!==user.id)menu.append(button('Hide this person',()=>blockMember(post),'menu-item'));
 more.append(menu);actions.append(more);
 body.append(actions,thread,form);
 article.append(meta,body);return article
}
async function replyTo(id,text,btn){
 const body=String(text||'').trim();
 if(!body)return;if(body.length>3000)return status('Reply is too long.',true);
 if(btn)btn.disabled=true;
 try{const r=await supabase.from('follow_circle_posts').insert({circle_id:selected.circle_id,author_id:user.id,parent_id:id,body});if(r.error)throw r.error;await loadFeed(true)}
 catch(e){status(e.message,true)}finally{if(btn)btn.disabled=false}
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
  const box=el('div',undefined,'member'),details=el('div',undefined,'member-text');
  details.append(el('strong',p.display_name+(p.user_id===user.id?' (you)':'')));
  if(p.role==='steward')details.append(el('span','Steward','tag'));
  const stats=progress.get(p.user_id);
  details.append(el('small',stats?'Day '+stats.current_day+' · '+(stats.current_day_done?'Done today':'Reading')+' · '+stats.completed_days+' days completed':'Progress private'));
  box.append(avatar(p.display_name),details);
  if(selected.role==='steward'&&p.user_id!==user.id)box.append(button('Remove',()=>removeMember(p),'textbtn danger-text'));
  $('members-list').append(box)
 }
 memberOffset+=people.length;$('more-members').hidden=memberOffset>=(r.count||0);
}
async function removeMember(p){
 if(!confirm('Remove '+p.display_name+' from the Circle?'))return;
 try{await invoke('follow_circle_remove',{p_circle:selected.circle_id,p_user:p.user_id});await loadMembers(true)}
 catch(e){status(e.message,true)}
}
// ── Conversations tab: Conversation Box × Circles ─────────────────────────
// The Circle sees counts, shared steps and initials-only prayer requests.
// Names come only from this device's Conversation Box and never leave it here.
const STAGES=['casual','meaningful','spiritual','discovery'];
const STAGE_LABEL={casual:'Casual',meaningful:'Meaningful',spiritual:'Spiritual',discovery:'Discovery'};
const localJSON=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}};
function isoDay(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function mondayOf(date=new Date()){const d=new Date(date.getFullYear(),date.getMonth(),date.getDate());d.setDate(d.getDate()-((d.getDay()+6)%7));return d}
async function loadConversations(){
 const circle=selected.circle_id;
 $('cb-optin').hidden=!!selected.share_conversations;
 await Promise.all([loadCbSummary(circle),loadPrayers(circle),loadActivity(circle)]);
 if(selected?.circle_id===circle)await renderHuddle(circle);
}
async function loadCbSummary(circle){
 let s;try{s=await invoke('follow_circle_cb_summary',{p_circle:circle})}catch(e){return status(e.message,true)}
 if(selected?.circle_id!==circle)return;
 for(const stage of STAGES){
  const cell=$('cb-quad').querySelector(`[data-stage="${stage}"]`);
  cell.querySelector('.cb-total').textContent=s.totals?.[stage]??0;
  const week=s.week?.[stage]||0;
  cell.querySelector('.cb-week').textContent=stage==='discovery'&&s.week?.trusted?s.week.trusted+' trusted Christ':week?'+'+week+' this week':'';
 }
 $('cb-sharing').textContent=s.sharing_members+' of '+s.members+' sharing';
 $('huddle-group').textContent=s.committed_members?s.committed_members+' member'+(s.committed_members===1?'':'s')+' committed to '+s.goals+' '+(s.goals===1?'person':'people')+' this week.':'No one has committed this week yet. Be the first.';
}
async function loadActivity(circle){
 const root=$('cb-activity');root.replaceChildren();
 let rows=[];try{rows=await invoke('follow_circle_cb_activity',{p_circle:circle,p_days:7})||[]}catch(e){return status(e.message,true)}
 if(selected?.circle_id!==circle)return;
 if(!rows.length){root.append(el('p','No shared steps yet this week. When you move someone forward in your Conversation Box, you can share the step here.','empty'));return}
 const byUser=new Map();
 for(const r of rows){if(!byUser.has(r.user_id))byUser.set(r.user_id,{name:r.display_name,rows:[]});byUser.get(r.user_id).rows.push(r)}
 for(const {name,rows:list} of byUser.values()){
  const added=list.filter(r=>!r.from_stage),moved=list.filter(r=>r.from_stage),trusted=list.filter(r=>r.response==='trusted').length;
  const parts=[];
  if(moved.length)parts.push('moved '+moved.length+' '+(moved.length===1?'person':'people')+' forward');
  if(added.length)parts.push('added '+added.length);
  const item=el('div',undefined,'activity');
  const text=el('div');const line=el('p');line.append(el('strong',name),' '+parts.join(' and '));
  const counts=new Map();for(const r of moved){const k=STAGE_LABEL[r.from_stage]+' → '+STAGE_LABEL[r.to_stage];counts.set(k,(counts.get(k)||0)+1)}
  for(const r of added){const k='New in '+STAGE_LABEL[r.to_stage];counts.set(k,(counts.get(k)||0)+1)}
  const detail=[...counts].map(([k,n])=>n>1?k+' ×'+n:k);if(trusted)detail.push(trusted===1?'Someone trusted Christ':trusted+' trusted Christ');
  text.append(line,el('small',detail.join(' · ')+' · '+when(list[0].created_at)));
  item.append(avatar(name),text);root.append(item);
 }
}
async function loadPrayers(circle){
 const root=$('prayer-list');root.replaceChildren();
 const since=new Date(Date.now()-30*864e5).toISOString();
 const {data,error}=await supabase.from('follow_circle_posts').select('id,author_id,body,created_at,prayer_initials,prayer_stage').eq('circle_id',circle).eq('kind','prayer').gte('created_at',since).order('created_at',{ascending:false}).limit(30);
 if(error)return status(error.message,true);
 if(selected?.circle_id!==circle)return;
 const posts=data||[];
 if(!posts.length){root.append(el('p','No prayer requests yet. Ask your Circle to pray for someone you’re talking with, using their initials.','empty'));return}
 const names=await fetchNames(posts.map(p=>p.author_id));
 const r=await supabase.from('follow_circle_reactions').select('post_id,user_id').eq('circle_id',circle).in('post_id',posts.map(p=>p.id));
 const reactions=r.error?[]:r.data||[];
 const list=el('div',undefined,'prayer-list');
 for(const post of posts)list.append(renderPrayer(post,names.get(post.author_id)||'Member',reactions.filter(x=>x.post_id===post.id)));
 root.append(list);
}
function renderPrayer(post,name,reactions){
 const row=el('div',undefined,'prayer');
 const text=el('div',undefined,'prayer-text');
 const head=el('p',undefined,'prayer-head');head.append(el('strong',post.prayer_initials),el('span',' · '+(STAGES.indexOf(post.prayer_stage)+1)+' '+STAGE_LABEL[post.prayer_stage],'tag'));
 text.append(head,el('p',post.body,'prayer-body'),el('small','Shared by '+name+' · '+when(post.created_at)));
 let mine=reactions.some(x=>x.user_id===user.id),count=reactions.length;
 const btn=el('button',undefined,'pray-btn');btn.type='button';
 const paint=()=>{btn.textContent=mine?'Praying · '+count:count?'Pray · '+count:'Pray';btn.setAttribute('aria-pressed',String(mine));btn.classList.toggle('on',mine)};
 btn.addEventListener('click',async()=>{
  btn.disabled=true;
  try{
   if(mine){const r=await supabase.from('follow_circle_reactions').delete().eq('post_id',post.id).eq('user_id',user.id);if(r.error)throw r.error;mine=false;count--}
   else{const r=await supabase.from('follow_circle_reactions').insert({circle_id:selected.circle_id,post_id:post.id,user_id:user.id});if(r.error&&r.error.code!=='23505')throw r.error;mine=true;count++}
   paint();
  }catch(e){status(e.message,true)}finally{btn.disabled=false}
 });
 paint();
 const more=el('details',undefined,'more');const sum=el('summary');sum.setAttribute('aria-label','More actions');sum.textContent='•••';more.append(sum);
 const menu=el('div',undefined,'more-menu');
 if(post.author_id===user.id||selected.role==='steward')menu.append(button('Delete',async()=>{
  if(!confirm('Delete this prayer request?'))return;
  const r=await supabase.from('follow_circle_posts').delete().eq('id',post.id).eq('circle_id',selected.circle_id);
  if(r.error)status(r.error.message,true);else loadPrayers(selected.circle_id);
 },'menu-item danger-text'));
 menu.append(button('Report',()=>reportPost(post),'menu-item'));
 more.append(menu);
 const actions=el('div',undefined,'prayer-actions');actions.append(btn,more);
 row.append(text,actions);return row;
}
function localSteps(){return localJSON('cb-steps',[]).filter(s=>s&&s.at&&STAGES.includes(s.to))}
async function renderHuddle(circle){
 const thisWeek=mondayOf(),lastWeek=new Date(thisWeek);lastWeek.setDate(lastWeek.getDate()-7);
 const steps=localSteps();
 const inRange=(s,from,to)=>{const t=new Date(s.at);return t>=from&&t<to};
 const next=new Date(thisWeek);next.setDate(next.getDate()+7);
 const forwardThis=steps.filter(s=>s.from&&inRange(s,thisWeek,next));
 const forwardLast=steps.filter(s=>s.from&&inRange(s,lastWeek,thisWeek));
 const addedThis=steps.filter(s=>!s.from&&inRange(s,thisWeek,next));
 const {data}=await supabase.from('follow_circle_commitments').select('week_start,goal').eq('circle_id',circle).eq('user_id',user.id).in('week_start',[isoDay(lastWeek),isoDay(thisWeek)]);
 if(selected?.circle_id!==circle)return;
 const goalFor=d=>(data||[]).find(r=>r.week_start===isoDay(d))?.goal;
 const back=$('huddle-back');back.replaceChildren();
 const last=goalFor(lastWeek);
 if(last!=null)back.append(el('p','Last week you planned to move '+last+' forward. You moved '+forwardLast.length+'.'));
 const grid=el('div',undefined,'huddle-grid');
 for(const stage of STAGES){const n=steps.filter(s=>s.to===stage&&inRange(s,thisWeek,next)).length;const c=el('div',undefined,'huddle-stat'+(n?' on':''));c.append(el('strong',(n?'+':'')+n),el('span',STAGE_LABEL[stage]));grid.append(c)}
 back.append(grid,el('p',forwardThis.length||addedThis.length?'This week so far, on this device.':'Nothing moved yet this week on this device.','hint'));
 // Look forward: names from this device's box only.
 const picksAll=localJSON('cb-huddle-picks',{}),saved=picksAll[circle]?.week===isoDay(thisWeek)?picksAll[circle].names:[];
 const conv=localJSON('conversations',{});const people=['casual','meaningful','spiritual'].flatMap(stage=>(conv[stage]||[]).map(p=>({name:p.name,stage})));
 const root=$('huddle-picks');root.replaceChildren();
 if(!people.length){root.append(el('p','Your Conversation Box on this device is empty. Add the people you’re talking with first.','empty'));$('huddle-commit').hidden=true;return}
 $('huddle-commit').hidden=false;
 for(const p of people){
  const label=el('label',undefined,'pick');const cb=document.createElement('input');cb.type='checkbox';cb.value=p.name;cb.checked=saved.includes(p.name);
  const to=STAGES[STAGES.indexOf(p.stage)+1];
  label.append(cb,el('span',p.name,'pick-name'),el('span',(STAGES.indexOf(p.stage)+1)+' → '+(STAGES.indexOf(to)+1),'pick-step'));
  label.title=STAGE_LABEL[p.stage]+' to '+STAGE_LABEL[to];root.append(label);
 }
 const goal=goalFor(thisWeek);
 const paint=()=>{const n=root.querySelectorAll('input:checked').length;$('huddle-commit').textContent=goal!=null&&n===goal&&saved.length===n?'Committed to '+n:'Commit to '+n+' this week'};
 root.onchange=paint;paint();
}
async function commitHuddle(){
 const circle=selected.circle_id,week=isoDay(mondayOf());
 const names=[...$('huddle-picks').querySelectorAll('input:checked')].map(x=>x.value);
 $('huddle-commit').disabled=true;
 try{
  await invoke('follow_circle_commit',{p_circle:circle,p_week:week,p_goal:names.length});
  const all=localJSON('cb-huddle-picks',{});all[circle]={week,names};localStorage.setItem('cb-huddle-picks',JSON.stringify(all));
  status(names.length?'Committed to '+names.length+' this week. The Circle sees the number only.':'Saved.');
  await loadCbSummary(circle);await renderHuddle(circle);
 }catch(e){status(e.message,true)}finally{$('huddle-commit').disabled=false}
}
function renderChurchSetting(){
 const box=$('church-setting');box.hidden=!cbReady;if(!cbReady)return;
 const churchId=selected.circle.church_id,name=churchNames.get(churchId);
 $('church-status').textContent=churchId?'Linked to '+(name||'a church')+'. Its leaders see this Circle’s counts, never names or posts.':'Not linked to a church.';
 $('church-unlink').hidden=!(churchId&&selected.role==='steward');
 $('church-hint').hidden=!!churchId||selected.role!=='steward';
}
function personalReadingDay(){
 try{
  const saved=JSON.parse(localStorage.getItem('obeytools:daily-sos:v2')||'{}');
  return Math.max(1,Math.min(365,(Number(saved.day)||0)+1));
 }catch{return 1}
}
const timeZones=typeof Intl.supportedValuesOf==='function'
 ?Intl.supportedValuesOf('timeZone'):['UTC','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Europe/London','Asia/Kolkata'];
const zoneSelect=$('create-timezone');
const preferred=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
for(const zone of [...new Set(['UTC',preferred,...timeZones])]){
 const opt=el('option',zone.replaceAll('_',' '));opt.value=zone;zoneSelect.append(opt);
}
zoneSelect.value=preferred;
$('read-independent').addEventListener('click',async()=>{
 if(!selected||!confirm('Read at your own pace? You’ll stay in all your Circles.'))return;
 try{
  await invoke('follow_circle_set_independent',{});
  const id=selected.circle_id;await loadCircles();await showCircle(id);
  status('You’re now reading at your own pace. You’re still in your Circles.');
 }catch(e){status(e.message,true)}
});
$('make-primary').addEventListener('click',async()=>{
 if(!selected)return;
 try{
  await invoke('follow_circle_set_primary',{p_circle:selected.circle_id});
  const id=selected.circle_id;await loadCircles();await showCircle(id);
  status('Follow Daily now opens on this Circle’s day.');
 }catch(e){status(e.message,true)}
});
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
$('new-circle').addEventListener('click',()=>{
 $('create-display').value=displayName();
 const current=memberships.find(x=>x.schedule?.is_primary)?.schedule?.day_no||personalReadingDay();
 $('create-start-current').value=String(current);
 $('create-start-current').textContent='My current day (Day '+current+')';
 $('create-activities').hidden=!actReady;$('create-reading').checked=true;$('create-conversations').checked=cbReady;
 $('create-conversations').closest('label').hidden=!cbReady;syncCreateFields();
 $('create-dialog').hidden=false;$('create-name').focus();
});
$('cancel-create').addEventListener('click',()=>{$('create-dialog').hidden=true});
function renderActivities(){
 const box=$('activities-setting');box.hidden=!actReady;if(!actReady)return;
 const steward=selected.role==='steward';
 $('act-reading').checked=usesReading(selected);$('act-conversations').checked=usesConversations(selected);
 for(const id of ['act-reading','act-conversations'])$(id).disabled=!steward;
 $('activities-save').hidden=!steward;
 $('activities-hint').textContent=steward?'Turning something off hides it. Nothing already shared is deleted.':'Only the steward can change what this Circle does.';
}
$('activities-form').addEventListener('submit',async e=>{
 e.preventDefault();
 const reading=$('act-reading').checked,conv=$('act-conversations').checked;
 if(!reading&&!conv)return status('Choose at least one thing to do together.',true);
 if(usesReading(selected)&&!reading&&!confirm('Turn off FOLLOW DAILY for this Circle? Anyone reading with it moves to their next reading Circle or their own pace. Earlier reflections stay.'))return;
 const b=$('activities-save');b.disabled=true;
 try{
  await invoke('follow_circle_set_activities',{p_circle:selected.circle_id,p_reading:reading,p_conversations:conv});
  const id=selected.circle_id;await loadCircles();await showCircle(id);await setTab('about');status('Saved. This Circle now does '+(reading&&conv?'FOLLOW DAILY and Conversations':reading?'FOLLOW DAILY':'Conversations')+'.');
 }catch(err){status(err.message,true)}finally{b.disabled=false}
});
function syncCreateFields(){$('create-reading-fields').hidden=!$('create-reading').checked}
$('create-reading').addEventListener('change',syncCreateFields);
$('circle-switch').addEventListener('change',()=>{const id=$('circle-switch').value;if(id)showCircle(id,activeTab==='conversations'?'conversations':undefined)});
$('create-form').addEventListener('submit',async e=>{
 e.preventDefault();const b=e.submitter;b.disabled=true;
 const reading=$('create-reading').checked,conv=$('create-conversations').checked;
 if(actReady&&!reading&&!conv){b.disabled=false;return status('Choose at least one thing to do together.',true)}
 try{const result=actReady
  ?await invoke('follow_circle_create_with',{p_name:val('create-name'),p_display_name:val('create-display'),p_reading:reading,p_conversations:conv,p_start_day:Number(val('create-start')),p_time_zone:val('create-timezone')})
  :await invoke('follow_circle_create_scheduled',{p_name:val('create-name'),p_display_name:val('create-display'),p_start_day:Number(val('create-start')),p_time_zone:val('create-timezone')});$('create-dialog').hidden=true;await loadCircles();await showCircle(result.circle_id);showInvitation(result.token)}
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
$('invite-top').addEventListener('click',async()=>{
 if(!selected)return;
 try{const token=await invoke('follow_circle_new_invite',{p_circle:selected.circle_id});showInvitation(token)}
 catch(e){status(e.message,true)}
});
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
  $('post-body').value='';$('composer').open=false;$('post-target-list').querySelectorAll('input').forEach(x=>x.checked=false);mentions.clear();renderMentions();$('mention-options').replaceChildren();status('Shared with '+targets.length+' Circle'+(targets.length===1?'':'s'));await loadFeed(true);
 }catch(err){status(err.message,true)}finally{b.disabled=false}
});
$('member-settings').addEventListener('submit',async e=>{
 e.preventDefault();const r=await supabase.from('follow_circle_members').update({display_name:val('display-name'),progress_visible:$('show-progress').checked,email_replies:$('email-replies').checked,email_mentions:$('email-mentions').checked,email_digest:$('email-digest').checked,...(cbReady?{share_conversations:$('share-conversations').checked}:{})}).eq('circle_id',selected.circle_id).eq('user_id',user.id);
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
$('cb-optin-btn').addEventListener('click',async()=>{
 const r=await supabase.from('follow_circle_members').update({share_conversations:true}).eq('circle_id',selected.circle_id).eq('user_id',user.id);
 if(r.error)return status(r.error.message,true);
 selected.share_conversations=true;status('Your counts are now included. Names stay on your phone.');await loadConversations();
});
$('prayer-toggle').addEventListener('click',()=>{const open=$('prayer-form').hidden;$('prayer-form').hidden=!open;$('prayer-toggle').setAttribute('aria-expanded',String(open));if(open)$('prayer-initials').focus()});
$('prayer-form').addEventListener('submit',async e=>{
 e.preventDefault();const b=e.submitter;
 const initials=val('prayer-initials').replace(/\s+/g,' ');
 if(!/^[^\s\d.]{1,2}\.?( [^\s\d.]{1,2}\.?){0,2}$/u.test(initials))return status('Use initials only, like J. K.',true);
 b.disabled=true;
 try{
  const r=await supabase.from('follow_circle_posts').insert({circle_id:selected.circle_id,author_id:user.id,kind:'prayer',prayer_initials:initials,prayer_stage:val('prayer-stage'),body:val('prayer-body')});
  if(r.error)throw r.error;
  $('prayer-form').reset();$('prayer-form').hidden=true;$('prayer-toggle').setAttribute('aria-expanded','false');status('Your Circle can pray now.');await loadPrayers(selected.circle_id);
 }catch(err){status(err.message,true)}finally{b.disabled=false}
});
$('huddle-commit').addEventListener('click',commitHuddle);
$('church-unlink').addEventListener('click',async()=>{
 if(!confirm('Unlink this Circle from its church? Church leaders will stop seeing its counts.'))return;
 try{await invoke('follow_church_unlink',{p_circle:selected.circle_id});const id=selected.circle_id;await loadCircles();selected=memberships.find(x=>x.circle_id===id);renderChurchSetting();status('Unlinked')}
 catch(e){status(e.message,true)}
});
for(let day=1;day<=365;day++){const option=el('option','Day '+day);option.value=String(day);$('post-day').append(option)}
const preselected=Number(params.get('day'));if(Number.isInteger(preselected)&&preselected>=1&&preselected<=365)$('post-day').value=String(preselected);
supabase.auth.onAuthStateChange((_event,session)=>{if(user?.id!==session?.user?.id){queueMicrotask(()=>loadAuth())}});
loadAuth();
