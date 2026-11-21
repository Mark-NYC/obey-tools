// Email link takes the reader to our site, which completes confirmation automatically.
// Previews and email scanners that only fetch the link do not activate subscriptions.
(() => {
 'use strict';
 const api='https://mjiswwujcsmayuytoaul.supabase.co/functions/v1/daily-sos-delivery';
 const $=id=>document.getElementById(id);
 const params=new URLSearchParams(location.search);
 const token=params.get('token')||'';
 const isConfirm=location.pathname.includes('follow-daily-confirm');
 const unsubscribeRequested=params.get('unsubscribe')==='1';
 // Keep private tokens out of copied links, browser history and subsequent referrers.
 history.replaceState(null,'',location.pathname);
 const message=$('message'),description=$('description');
 const valid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token);
 const showError=text=>{message.textContent=text||'Something went wrong. Please try again.';message.style.color='#94442b'};
 async function request(path,options){
  const response=await fetch(api+path+'?token='+encodeURIComponent(token)+(options?'':'&format=json'),{
   ...options,headers:{'Content-Type':'application/json',...(options?.headers||{})},cache:'no-store'
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(body.error||'Could not complete request');
  return body;
 }
 if(!valid){showError('This link is invalid. Please request a fresh email.');if(isConfirm)$('confirm').hidden=true;return}
 if(isConfirm){
  const button=$('confirm');
  let inFlight=false;
  const confirm=async()=>{
   if(inFlight)return;
   inFlight=true;
   button.disabled=true;
   message.textContent='Confirming your subscription…';
   try{
    const result=await request('/confirm',{method:'POST',body:'{}'});
    $('heading').textContent='You’re subscribed!';
    description.textContent=result.completed?'Your 365-day journey is already complete.':'Your first or next reading is scheduled for tomorrow at your chosen time.';
    button.hidden=true;
    message.textContent='No account needed. You can start reading right now.';
    $('back').textContent='Open Follow Daily';
   }catch(e){
    showError(e.message);
    button.hidden=false;
    button.disabled=false;
    button.textContent='Try confirmation again';
   }finally{inFlight=false}
  };
  button.addEventListener('click',confirm);
  // The email click is the user's confirmation: open the page and auto-submit.
  // Keep a retry button only if the request fails (e.g. temporary network loss).
  confirm();
  return;
 }
 let current;
 const actions=$('actions'),toggle=$('toggle'),stop=$('unsubscribe');
 function render(s){
  current=s;description.textContent=
   'Status: '+({active:'Active',paused:'Paused',stopped:'Stopped',completed:'Completed'}[s.status]||s.status)+
   '. Your next reading is Day '+s.nextDay+' of 365.';
  if(s.status==='completed'){actions.hidden=true;return}
  actions.hidden=false;
  toggle.textContent=s.status==='active'?'Pause daily emails':'Resume daily emails';
  stop.hidden=s.status==='stopped';
  if(unsubscribeRequested&&s.status!=='stopped')message.textContent='To stop emails, choose Unsubscribe below.';
 }
 async function change(status){
  toggle.disabled=stop.disabled=true;message.textContent='Saving your preferences…';
  try{
   const data=await request('/manage',{method:'POST',body:JSON.stringify({status})});
   const s=await request('/manage');
   render(s);message.textContent= data.message||'Your preference was saved.';
  }catch(e){showError(e.message)}
  finally{toggle.disabled=stop.disabled=false}
 }
 toggle.addEventListener('click',()=>change(current.status==='active'?'paused':'active'));
 stop.addEventListener('click',()=>change('stopped'));
 request('/manage').then(s=>{render(s);message.textContent=''}).catch(e=>showError(e.message));
})();
