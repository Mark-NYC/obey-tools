// Daily SOS opt-in email reminders, powered by authenticated Obey.Tools accounts.
// Never subscribes someone merely because they open the reading page.
import { supabase } from './supabase.js';
const $=id=>document.getElementById(id);
const zoneDefault=Intl.DateTimeFormat().resolvedOptions().timeZone||'America/New_York';
const emailBox=$('email-reminders');
if(emailBox){
const tz=$('email-timezone'),time=$('email-hour'),status=$('email-reminder-status');
let me=null,subscription=null,ready=false,busy=false;
const setMessage=(text)=>{status.textContent=text};
const busySet=(v)=>{busy=v;for(const id of ['email-start','email-pause','email-stop','email-signin'])if($(id))$(id).disabled=v};
const zones=new Set([zoneDefault,'UTC','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Europe/London','Europe/Paris','Asia/Kolkata','Asia/Tokyo','Australia/Sydney']);
try{for(const name of Intl.supportedValuesOf('timeZone'))zones.add(name)}catch{}
for(const name of [...zones].sort()){
 const option=document.createElement('option');option.value=name;option.textContent=name.replaceAll('_',' ');
 tz.appendChild(option)
}
tz.value=zoneDefault;
async function health(){
 try{
  const res=await fetch('https://mjiswwujcsmayuytoaul.supabase.co/functions/v1/daily-sos-delivery/health',{cache:'no-store'});
  if(res.ok){const json=await res.json();ready=!!json.ready}
 }catch{ready=false}
}
function draw(){
 $('email-signed-out').hidden=!!me||!ready;
 $('email-signed-in').hidden=!me;
 $('email-not-ready').hidden=ready;
 $('email-address').textContent=me?.email||'';
 if(!me){if(!ready)setMessage('Email reminders are not sending yet.');return}
 if(subscription){
  tz.value=subscription.timezone;
  time.value=String(subscription.send_hour);
 }
 const current=subscription?.status||'not subscribed';
 $('email-state').textContent=({active:'Daily emails active',paused:'Reminders paused',stopped:'Reminders stopped',completed:'Journey completed'})[current]||'Not subscribed';
 $('email-start').textContent=subscription?.status==='active'?'Save my preferences':subscription?.status==='paused'||subscription?.status==='stopped'?'Resume daily email':'Start at Day 1';
 $('email-start').disabled=!ready||subscription?.status==='completed';
 $('email-pause').hidden=!subscription||subscription.status!=='active';
 $('email-stop').hidden=!subscription||!['active','paused'].includes(subscription.status);
 $('email-next').textContent=subscription?.status==='active'&&subscription.next_day<=365
  ?'Next email: Day '+subscription.next_day+' · '+new Date(subscription.next_send_at).toLocaleString([], {dateStyle:'medium',timeStyle:'short'})
  :'';
 if(!ready)setMessage('Delivery is not active yet. Your saved preferences remain available.');
}
async function refresh(){
 const {data:{user}}=await supabase.auth.getUser();
 me=user;subscription=null;
 if(me){
  const {data,error}=await supabase.from('sos_email_subscriptions')
   .select('id,status,timezone,send_hour,next_day,next_send_at').eq('user_id',me.id).maybeSingle();
  if(error)setMessage('Could not load your reminder settings. Please retry.');
  else subscription=data;
 }
 draw();
}
$('email-signin').addEventListener('click',async()=>{
 if(busy||!ready)return;
 const email=$('email-input').value.trim();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){setMessage('Enter a valid email address.');return}
 busySet(true);setMessage('Sending a sign-in link…');
 try{
 const {error}=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+'/daily-sos.html#email-reminders',shouldCreateUser:true}});
 setMessage(error?error.message:'Check your inbox for a sign-in link. Return here to turn on Daily SOS emails.');
 }catch{setMessage('Could not send the sign-in link. Please retry.')}
 finally{busySet(false)}
});
$('email-start').addEventListener('click',async()=>{
 if(busy||!me||!ready)return;
 busySet(true);setMessage('Saving your reminder preferences…');
 const values={timezone:tz.value,send_hour:Number(time.value)};
 try{
  let result;
  if(subscription)result=await supabase.from('sos_email_subscriptions').update({...values,status:'active'}).eq('user_id',me.id);
  else result=await supabase.from('sos_email_subscriptions').insert({...values,user_id:me.id,email:me.email.toLowerCase()});
  if(result.error)throw result.error;
  const wasActive=subscription?.status==='active';
  await refresh();setMessage(wasActive?'Preferences saved.':'Daily SOS email enabled. Your next reading is scheduled for tomorrow.');
 }catch(e){setMessage(e?.message||'Could not save. Please try again.')}
 finally{busySet(false)}
});
async function changeStatus(value){
 if(busy||!me||!subscription)return;
 busySet(true);
 try{
  const {error}=await supabase.from('sos_email_subscriptions').update({status:value}).eq('user_id',me.id);
  if(error)throw error;
  await refresh();setMessage(value==='paused'?'Daily emails paused. Your place is saved.':'Daily emails stopped. Your saved reflections are unchanged.');
 }catch(e){setMessage(e?.message||'Unable to change your reminders.')}finally{busySet(false)}
}
$('email-pause').addEventListener('click',()=>changeStatus('paused'));
$('email-stop').addEventListener('click',()=>changeStatus('stopped'));
window.dailySosPauseEmail=(isPaused)=>changeStatus(isPaused?'paused':'active');
supabase.auth.onAuthStateChange(()=>{setTimeout(refresh,0)});
await health();await refresh();
}
