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
  const {data,error}=await supabase.from('follow_proverbs_posts').select('id,circle_id,author_id,body,chapter,created_at,parent_id').in('circle_id',ids).eq('chapter',chapter()).order('created_at',{ascending:false}).limit(40);
  if(error)throw error;if(current!==request)return;
  const posts=(data||[]).filter(p=>!p.parent_id),authors=[...new Set(posts.map(p=>p.author_id))],names=new Map();
  if(authors.length){const {data:members,error:memberError}=await supabase.from('follow_circle_members').select('circle_id,user_id,display_name').in('circle_id',ids).in('user_id',authors).limit(200);if(!memberError)(members||[]).forEach(m=>names.set(m.circle_id+':'+m.user_id,m.display_name))}
  container.replaceChildren();
  if(!posts.length){const p=document.createElement('p');p.className='circle-message';p.textContent='No one has shared on Proverbs '+chapter()+' yet.';container.append(p)}
  let liked=new Set(),counts=new Map();
  if(posts.length){
   const ids=posts.map(post=>post.id),{data:reactions}=await supabase.from('follow_proverbs_reactions').select('post_id,user_id').in('post_id',ids).limit(1000);
   for(const reaction of reactions||[]){counts.set(reaction.post_id,(counts.get(reaction.post_id)||0)+1);if(reaction.user_id===user.id)liked.add(reaction.post_id)}
  }
  if(current!==request)return;
  for(const post of posts){
   const article=document.createElement('article');article.className='circle-post';
   const title=document.createElement('strong');title.textContent=names.get(post.circle_id+':'+post.author_id)||'Circle member';
   const detail=document.createElement('small');detail.textContent=(circles.find(c=>c.circle_id===post.circle_id)?.circle_name||'Circle')+' · '+new Date(post.created_at).toLocaleDateString();
   const body=document.createElement('p');body.textContent=post.body;article.append(title,detail,body);
   const actions=document.createElement('div');actions.className='circle-actions';
   const like=document.createElement('button');like.type='button';like.textContent=(liked.has(post.id)?'♥':'♡')+' '+(counts.get(post.id)||0);like.setAttribute('aria-label',liked.has(post.id)?'Remove your reaction':'React to this post');
   like.addEventListener('click',async()=>{like.disabled=true;try{const query=supabase.from('follow_proverbs_reactions');const {error}=liked.has(post.id)?await query.delete().eq('post_id',post.id).eq('user_id',user.id):await query.insert({post_id:post.id,user_id:user.id});if(error)throw error;await loadPosts()}catch(error){say('Could not update reaction. '+error.message,true)}finally{like.disabled=false}});
   const replyButton=document.createElement('button');replyButton.type='button';replyButton.textContent='Reply';actions.append(like,replyButton);article.append(actions);
   const replies=document.createElement('div');replies.className='circle-replies';replies.hidden=true;article.append(replies);
   replyButton.addEventListener('click',async()=>{
    replies.hidden=!replies.hidden;if(replies.hidden)return;
    replies.textContent='Loading replies…';
    const {data:items,error}=await supabase.from('follow_proverbs_posts').select('id,body,author_id,created_at').eq('parent_id',post.id).eq('circle_id',post.circle_id).order('created_at',{ascending:true}).limit(100);
    replies.replaceChildren();
    if(error){replies.textContent='Could not load replies.';return}
    const authorIds=[...new Set((items||[]).map(item=>item.author_id))],replyNames=new Map();
    if(authorIds.length){const {data:members}=await supabase.from('follow_circle_members').select('user_id,display_name').eq('circle_id',post.circle_id).in('user_id',authorIds);for(const member of members||[])replyNames.set(member.user_id,member.display_name)}
    for(const item of items||[]){const row=document.createElement('div');row.className='circle-reply';const name=document.createElement('strong');name.textContent=replyNames.get(item.author_id)||'Circle member';const text=document.createElement('p');text.textContent=item.body;row.append(name,text);replies.append(row)}
    const form=document.createElement('form'),input=document.createElement('textarea'),send=document.createElement('button');input.required=true;input.maxLength=3000;input.rows=2;input.placeholder='Write a reply…';input.setAttribute('aria-label','Write a reply');send.type='submit';send.textContent='Send reply';form.append(input,send);
    form.addEventListener('submit',async event=>{event.preventDefault();send.disabled=true;const {error}=await supabase.from('follow_proverbs_posts').insert({parent_id:post.id,circle_id:post.circle_id,author_id:user.id,chapter:post.chapter,body:input.value.trim()});if(error){say('Could not reply. '+error.message,true);send.disabled=false;return}say('Reply shared.');replyButton.click();replyButton.click();send.disabled=false});
    replies.append(form)
   });
   container.append(article)
  }
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
