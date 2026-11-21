// Follow Daily email-only opt-in. No password, account, or magic-link login.
const endpoint='https://mjiswwujcsmayuytoaul.supabase.co/functions/v1/daily-sos-delivery';
const $=id=>document.getElementById(id);
const card=$('email-reminders');
if(card){
 const status=$('email-reminder-status'),button=$('email-start');
 const tz=$('email-timezone'),hour=$('email-hour');
 const zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'America/New_York';
 const zones=new Set([zone,'UTC','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Europe/London','Europe/Paris','Asia/Kolkata','Asia/Tokyo','Australia/Sydney']);
 try{for(const z of Intl.supportedValuesOf('timeZone'))zones.add(z)}catch{}
 for(const z of [...zones].sort()){const o=document.createElement('option');o.value=z;o.textContent=z.replaceAll('_',' ');tz.append(o)}
 tz.value=zone;
 const feedback=message=>{status.textContent=message};
 let ready=false,busy=false;
 try{const r=await fetch(endpoint+'/health',{cache:'no-store'});ready=r.ok&&!!(await r.json()).ready}catch{}
 $('email-not-ready').hidden=ready;
 $('email-public-signup').hidden=!ready;
 if(!ready)feedback('Email delivery is temporarily unavailable. Please check back.');
 card.querySelector('form').addEventListener('submit',async event=>{
  event.preventDefault();
  if(!ready||busy)return;
  const email=$('email-input').value.trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){feedback('Enter a valid email address.');return}
  busy=true;button.disabled=true;feedback('Sending your confirmation email…');
  try{
   const res=await fetch(endpoint+'/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,timezone:tz.value,sendHour:Number(hour.value)})});
   if(res.status===429){feedback('Too many requests. Please try again later.');return}
   if(!res.ok)throw Error('request failed');
   feedback('Check your inbox. Tap Confirm Daily Emails to start your journey. No account needed.');
   button.textContent='Confirmation email requested';
  }catch{feedback('Could not send your confirmation. Please try again.')}
  finally{busy=false;button.disabled=false}
 });
}
