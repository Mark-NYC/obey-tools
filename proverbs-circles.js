import {supabase} from './supabase.js';
const $=id=>document.getElementById(id);
let user=null,circles=[],request=0;
const chapter=()=>window.proverbsBridge?.chapter?.()||new Date().getDate();
const say=(message,error=false)=>{$('proverbs-circle-notice').textContent=message;$('proverbs-circle-notice').style.color=error?'#a33':''};
function renderOptions(){
 const target=$('proverbs-circle-target'),old=target.value;
 target.replaceChildren();
 circles.forEach(c=>{const option=document.createElement('option');option.value=c.circle_id;option.textContent=c.circle_name;target.append(option)});
 if(circles.some(c=>c.circle_id===old))target.value=old;
 $('proverbs-circle-controls').hidden=!user||!circles.length;
 $('proverbs-circle-status').textContent=!user?'Sign in to follow and share Proverbs with your Circles.':!circles.length?'You have no Circles yet. Create or join one to follow Proverbs together.':'Share what you are learning. Your SOS responses remain private.';
 const indicator=$('proverbs-circle-indicator');
 indicator.hidden=!circles.length;indicator.textContent=circles.length?'Following with '+circles.length+' Circle'+(circles.length===1?'':'s'):'';
}
async function refresh(){
 try{
  const {data:{user:account},error:authError}=await supabase.auth.getUser();if(authError)throw authError;
  user=account||null;circles=[];
  if(user){const {data,error}=await supabase.rpc('follow_circle_schedule');if(error)throw error;circles=data||[]}
  renderOptions();await loadPosts();
 }catch(error){$('proverbs-circle-status').textContent='Circles are temporarily unavailable. Your reading and SOS are unaffected.';say(error.message,true)}
}
async function loadPosts(){
 const current=++request,container=$('proverbs-circle-posts');container.replaceChildren();
 if(!user||!circles.length)return;
 const loading=document.createElement('p');loading.className='circle-message';loading.textContent='Loading Circle conversations…';container.append(loading);
 try{
  const ids=circles.map(c=>c.circle_id);
  const {data,error}=await supabase.from('follow_proverbs_posts').select('id,circle_id,author_id,body,chapter,created_at').in('circle_id',ids).eq('chapter',chapter()).order('created_at',{ascending:false}).limit(40);
  if(error)throw error;if(current!==request)return;
  const posts=data||[],authors=[...new Set(posts.map(p=>p.author_id))],names=new Map();
  if(authors.length){const {data:members,error:memberError}=await supabase.from('follow_circle_members').select('circle_id,user_id,display_name').in('circle_id',ids).in('user_id',authors).limit(200);if(!memberError)(members||[]).forEach(m=>names.set(m.circle_id+':'+m.user_id,m.display_name))}
  container.replaceChildren();
  if(!posts.length){const p=document.createElement('p');p.className='circle-message';p.textContent='No one has shared on Proverbs '+chapter()+' yet.';container.append(p)}
  for(const post of posts){const article=document.createElement('article');article.className='circle-post';const title=document.createElement('strong');title.textContent=names.get(post.circle_id+':'+post.author_id)||'Circle member';const detail=document.createElement('small');detail.textContent=(circles.find(c=>c.circle_id===post.circle_id)?.circle_name||'Circle')+' · '+new Date(post.created_at).toLocaleDateString();const body=document.createElement('p');body.textContent=post.body;article.append(title,detail,body);container.append(article)}
 }catch(error){if(current!==request)return;container.replaceChildren();const p=document.createElement('p');p.className='circle-message';p.textContent='Proverbs conversations are not available yet. The database setup may still be needed.';container.append(p);say('Circle conversations could not load.',true)}
}
$('proverbs-circle-target').addEventListener('change',()=>say(''));
$('proverbs-circle-share').addEventListener('click',async()=>{
 const circle_id=$('proverbs-circle-target').value,body=$('proverbs-circle-body').value.trim();
 if(!user||!circles.some(c=>c.circle_id===circle_id))return say('Choose one of your Circles.',true);
 if(!body)return say('Write something to share first.',true);
 const button=$('proverbs-circle-share');button.disabled=true;
 try{
  const {error}=await supabase.from('follow_proverbs_posts').insert({circle_id,author_id:user.id,chapter:chapter(),body});if(error)throw error;
  $('proverbs-circle-body').value='';say('Shared with your Circle.');await loadPosts();
 }catch(error){say('Could not share. '+error.message,true)}finally{button.disabled=false}
});
document.addEventListener('proverbs:chapter',()=>{say('');loadPosts()});
supabase.auth.onAuthStateChange(()=>queueMicrotask(refresh));
refresh();
