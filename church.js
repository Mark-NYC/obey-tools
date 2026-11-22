// Church view: counts across Circles that their stewards chose to link.
// Only the follow_church_* functions are used. They return counts, never
// names, posts, prayer requests or reading progress.
import {supabase} from './supabase.js';
const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const STAGES=['casual','meaningful','spiritual','discovery'];
let user=null,church=null,loaded=false;
const val=id=>$(id).value.trim();
function status(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error)}
function el(tag,txt,cls){const e=document.createElement(tag);if(txt!==undefined)e.textContent=txt;if(cls)e.className=cls;return e}
function avatar(name,cls='avatar'){const a=el('span',(String(name||'?').trim()[0]||'?').toUpperCase(),cls);a.setAttribute('aria-hidden','true');return a}
async function invoke(name,args){const {data,error}=await supabase.rpc(name,args);if(error)throw error;return data}
const show=id=>{for(const v of ['auth-needed','invite-view','list-view','church-view'])$(v).hidden=v!==id};
function ago(iso){
 if(!iso)return null;const days=Math.floor((Date.now()-new Date(iso))/864e5);
 if(days<1)return 'Today';if(days<2)return 'Yesterday';if(days<14)return days+' days ago';return Math.floor(days/7)+' weeks ago';
}

async function start(){
 $('loading').hidden=false;
 try{
  const r=await supabase.auth.getUser();user=r.data?.user||null;loaded=true;
  $('loading').hidden=true;
  if(!user){show('auth-needed');return}
  if(params.get('invite'))return showInvite(params.get('invite'));
  if(params.get('church'))return showChurch(params.get('church'));
  return showList();
 }catch(e){$('loading').hidden=true;status(e.message||'Unable to load your account',true)}
}

// ── Invitation links ───────────────────────────────────────────────────
async function showInvite(token){
 let preview;try{preview=await invoke('follow_church_invite_preview',{p_token:token})}catch(e){return status(e.message,true)}
 if(!preview){show('list-view');await showList();return status('This link has expired or been turned off.',true)}
 show('invite-view');
 $('invite-church').textContent=preview.church_name;
 $('invite-kicker').textContent=preview.kind==='admin'?'Church leader invitation':'Link your Circle';
 $('invite-admin').hidden=preview.kind!=='admin';$('invite-circle').hidden=preview.kind!=='circle';
 if(preview.kind==='admin'){$('admin-name').value=user.user_metadata?.full_name||'';return}
 $('link-form').hidden=true;$('no-steward').hidden=true; // shown once your Circles have loaded
 const {data,error}=await supabase.from('follow_circle_members').select('circle_id,role').eq('user_id',user.id).eq('role','steward');
 if(error)return status(error.message,true);
 const ids=(data||[]).map(x=>x.circle_id);let circles=[];
 if(ids.length){const r=await supabase.from('follow_circles').select('id,name,church_id').in('id',ids);if(!r.error)circles=r.data||[]}
 const select=$('link-circle');select.replaceChildren();
 for(const c of circles){const o=el('option',c.name+(c.church_id===preview.church_id?' (already linked)':c.church_id?' (linked to another church)':''));o.value=c.id;select.append(o)}
 $('link-form').hidden=!circles.length;$('no-steward').hidden=!!circles.length;
}
$('admin-form').addEventListener('submit',async e=>{
 e.preventDefault();const b=e.submitter;b.disabled=true;
 try{const id=await invoke('follow_church_accept',{p_token:params.get('invite'),p_circle:null,p_display_name:val('admin-name')});location.replace('/church.html?church='+encodeURIComponent(id))}
 catch(err){status(err.message,true)}finally{b.disabled=false}
});
$('link-form').addEventListener('submit',async e=>{
 e.preventDefault();const b=e.submitter;b.disabled=true;
 try{
  await invoke('follow_church_accept',{p_token:params.get('invite'),p_circle:val('link-circle'),p_display_name:null});
  status('Linked. Your church’s leaders now see this Circle’s counts, never names or posts.');
  $('link-form').hidden=true;
  const done=el('a','Back to your Circle','primary linkbtn');done.href='/follow-circles.html?circle='+encodeURIComponent(val('link-circle'))+'&tab=conversations';$('invite-circle').append(done);
 }catch(err){status(err.message,true)}finally{b.disabled=false}
});

// ── List and create ────────────────────────────────────────────────────
async function showList(){
 show('list-view');history.replaceState(null,'','/church.html');
 const root=$('church-list');root.replaceChildren();
 let churches=[];try{churches=await invoke('follow_church_list',{})||[]}catch(e){return status(e.message,true)}
 for(const c of churches){
  const a=el('a',undefined,'circle-card');a.href='/church.html?church='+encodeURIComponent(c.church_id);
  const text=el('span',undefined,'circle-text');text.append(el('strong',c.name),el('small',c.circles+' Circle'+(c.circles===1?'':'s')+' linked'));
  a.append(avatar(c.name,'avatar circle-mark church-mark'),text);root.append(a);
 }
 $('church-display').value=$('church-display').value||user.user_metadata?.full_name||'';
}
$('create-church').addEventListener('submit',async e=>{
 e.preventDefault();const b=e.submitter;b.disabled=true;
 try{const id=await invoke('follow_church_create',{p_name:val('church-name'),p_display_name:val('church-display')});await showChurch(id);await shareLink('circle')}
 catch(err){status(err.message,true)}finally{b.disabled=false}
});

// ── Church overview ────────────────────────────────────────────────────
async function showChurch(id){
 const r=await supabase.from('follow_churches').select('id,name').eq('id',id).maybeSingle();
 if(r.error||!r.data){status('That church view isn’t available to you.',true);return showList()}
 let rows;try{rows=await invoke('follow_church_overview',{p_church:id})||[]}catch(e){status(e.message,true);return showList()}
 church=r.data;show('church-view');history.replaceState(null,'','/church.html?church='+encodeURIComponent(id));
 $('church-title').textContent=church.name;
 const members=rows.reduce((n,c)=>n+c.members,0),sharing=rows.reduce((n,c)=>n+c.sharing_members,0);
 $('church-kicker').textContent=rows.length+' Circle'+(rows.length===1?'':'s')+' · '+sharing+' of '+members+' people sharing their numbers';
 const totals=Object.fromEntries(STAGES.map(s=>[s,rows.reduce((n,c)=>n+(c[s]||0),0)]));
 for(const s of STAGES)document.querySelector(`.stage[data-stage="${s}"] .stage-total`).textContent=totals[s];
 const steps=rows.reduce((n,c)=>n+c.steps_30d,0),trusted=rows.reduce((n,c)=>n+c.trusted_30d,0);
 $('stage-note').textContent='Last 30 days: '+steps+' step'+(steps===1?'':'s')+' shared'+(trusted?', '+trusted+' trusted Christ':'')+'.';
 renderTable(rows);renderNudges(rows,totals);await renderAdmins(id);
}
function renderTable(rows){
 const body=$('circles-body');body.replaceChildren();
 $('no-circles').hidden=!!rows.length;$('circles-table').parentElement.hidden=!rows.length;
 for(const c of rows){
  const tr=el('tr');
  const name=el('td',undefined,'circle-cell');name.append(el('strong',c.circle_name),el('small',c.sharing_members+' of '+c.members+' sharing'));
  tr.append(name);
  for(const s of STAGES)tr.append(el('td',String(c[s]||0),'num'+(s==='discovery'?' end':'')));
  tr.append(el('td',String(c.steps_30d),'num'));
  const huddle=el('td');const when=ago(c.last_huddle);
  const stale=!c.last_huddle||Date.now()-new Date(c.last_huddle)>14*864e5;
  huddle.append(el('span',when||'Not yet','pill '+(stale?'warn':'ok')));tr.append(huddle);
  const act=el('td');const unlink=el('button','Unlink','textbtn danger-text');unlink.type='button';
  unlink.setAttribute('aria-label','Unlink '+c.circle_name);
  unlink.addEventListener('click',async()=>{
   if(!confirm('Unlink '+c.circle_name+'? You’ll stop seeing its counts. Its steward can link it again.'))return;
   try{await invoke('follow_church_unlink',{p_circle:c.circle_id});await showChurch(church.id);status('Unlinked')}catch(e){status(e.message,true)}
  });
  act.append(unlink);tr.append(act);body.append(tr);
 }
}
function renderNudges(rows,totals){
 const root=$('nudges');root.replaceChildren();
 const add=(...parts)=>{const p=el('p',undefined,'nudge');p.append(...parts);root.append(p)};
 if(!rows.length)add('Send the Circle link to each group’s steward. Their counts appear here once they link.');
 for(const c of rows){
  if(!c.last_huddle)add(el('strong',c.circle_name),' hasn’t held a weekly huddle yet.');
  else if(Date.now()-new Date(c.last_huddle)>14*864e5)add(el('strong',c.circle_name),' hasn’t huddled in '+ago(c.last_huddle).replace(' ago','')+'. Check in with '+'the Circle steward'+'.');
  if(c.members>1&&c.sharing_members<c.members/2)add(el('strong',c.circle_name),': only '+c.sharing_members+' of '+c.members+' include their numbers. Encourage the rest to turn it on in Settings.');
 }
 if(totals.spiritual>=3&&totals.spiritual>=3*Math.max(totals.discovery,1)){
  const a=el('a','Discovery Bible Study');a.href='/bible-study/';
  add(el('strong',totals.spiritual+' people'),' are in Spiritual, but only '+totals.discovery+' reached Discovery. Train your groups to start a ',a,'.');
 }
 if(!root.childElementCount)add('Nothing needs attention right now. Keep praying for the people behind these numbers.');
}
async function renderAdmins(id){
 const root=$('admins');root.replaceChildren();
 const {data}=await supabase.from('follow_church_admins').select('user_id,display_name').eq('church_id',id).order('added_at');
 for(const a of data||[]){const row=el('div',undefined,'admin-row');row.append(avatar(a.display_name,'avatar sm'),el('span',a.display_name+(a.user_id===user.id?' (you)':'')));root.append(row)}
}
async function shareLink(kind){
 try{
  const token=await invoke('follow_church_new_invite',{p_church:church.id,p_kind:kind});
  $('link-title').textContent=kind==='admin'?'Add a church leader':'Invite a Circle';
  $('link-help').textContent=kind==='admin'
   ?'Anyone with this link can see this church’s counts after signing in. Send it only to people who help lead.'
   :'Send this to a group’s steward. They choose which of their Circles to link. Members’ names and posts stay private.';
  $('invite-url').value=new URL('/church.html?invite='+encodeURIComponent(token),location.origin).href;
  $('link-dialog').hidden=false;$('copy-link').focus();
 }catch(e){status(e.message,true)}
}
$('invite-circle-btn').addEventListener('click',()=>shareLink('circle'));
$('invite-admin-btn').addEventListener('click',()=>shareLink('admin'));
$('revoke-links').addEventListener('click',async()=>{
 if(!confirm('Turn off every Circle and leader link for this church? Linked Circles and leaders stay.'))return;
 try{await invoke('follow_church_revoke_invites',{p_church:church.id});status('All links turned off.')}catch(e){status(e.message,true)}
});
$('leave-church').addEventListener('click',async()=>{
 if(!confirm('Leave this church view? If you are the last leader, the church view closes and Circles are unlinked.'))return;
 try{await invoke('follow_church_leave',{p_church:church.id});church=null;await showList();status('You left the church view.')}catch(e){status(e.message,true)}
});
$('copy-link').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('invite-url').value);status('Link copied')}catch{$('invite-url').select();status('Select and copy the link')}});
$('close-link').addEventListener('click',()=>{$('link-dialog').hidden=true});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('link-dialog').hidden)$('link-dialog').hidden=true});

// ── Sign in ────────────────────────────────────────────────────────────
$('sign-in-form').addEventListener('submit',async e=>{
 e.preventDefault();const b=e.submitter;b.disabled=true;
 const {error}=await supabase.auth.signInWithPassword({email:val('auth-email'),password:val('auth-password')});
 if(error)status(error.message,true);else{status('');await start()}b.disabled=false;
});
$('magic-sign-in').addEventListener('click',async()=>{
 const email=val('auth-email');if(!email)return status('Enter your email first.',true);
 const {error}=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:location.href}});
 status(error?error.message:'Check your email for the sign-in link.',!!error);
});
// Only react to a real sign-in or sign-out after the first load, so the page never builds twice.
supabase.auth.onAuthStateChange((_e,session)=>{if(loaded&&user?.id!==session?.user?.id)queueMicrotask(start)});
start();
