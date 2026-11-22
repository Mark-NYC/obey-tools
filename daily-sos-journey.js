// Follow Daily journey helpers. Pure functions over data the page already
// saves (entries + per-field revision timestamps from daily-sos-sync.js).
// Nothing here creates new tasks, scores, or streaks. Milestones count
// completed readings, so missing a day can never take one away.
(function(root){
 'use strict';
 const DAY=86400000;
 const MILESTONES=[7,30,90,180,365];
 const MILESTONE_LINES={
  7:'A week of reading, reflecting, and responding to Jesus.',
  30:'A month of meeting Jesus in Scripture.',
  90:'Ninety passages read and responded to.',
  180:'About halfway through the readings of the Gospels and Acts.',
  365:'Every reading through the Gospels and Acts.'
 };
 const text=v=>String(v||'').trim();
 const isComplete=e=>!!(e&&e.read&&e.insight&&text(e.say)&&text(e.obey)&&text(e.share));
 function completedDays(entries){
  return Object.entries(entries||{}).filter(([,e])=>isComplete(e)).map(([k])=>Number(k)).filter(Number.isInteger).sort((a,b)=>a-b);
 }
 // Milestones earned are kept: the union of what was stored and what is reached now.
 function earnedMilestones(count,stored=[]){
  const set=new Set((Array.isArray(stored)?stored:[]).map(Number).filter(n=>MILESTONES.includes(n)));
  for(const m of MILESTONES)if(count>=m)set.add(m);
  return MILESTONES.filter(m=>set.has(m));
 }
 const nextMilestone=count=>MILESTONES.find(m=>m>count)||null;
 // Revisions are keyed "<day number>:<field>" (1-based) in Date.now() ms.
 function fieldStamp(revisions,index,field){const v=Number((revisions||{})[(index+1)+':'+field]);return Number.isFinite(v)&&v>0?v:0}
 function completionStamp(revisions,index){
  let latest=0;
  for(const f of ['read','insight','say','obey','share'])latest=Math.max(latest,fieldStamp(revisions,index,f));
  return latest;
 }
 function lastActivity(revisions,before=Infinity){
  let latest=0;
  for(const [k,v] of Object.entries(revisions||{})){
   if(k.endsWith(':cursor'))continue;
   const n=Number(v);if(Number.isFinite(n)&&n<before)latest=Math.max(latest,n);
  }
  return latest;
 }
 // "Your week": the last seven days of real saved activity. Only readings with
 // a known completion time are counted; nothing is estimated or invented.
 // A single save touches one day. When one second's worth of writes spans
 // several days, it was a bulk import (first sign-in upload, device restore),
 // so those times say nothing about when someone actually read or wrote.
 function bulkSeconds(revisions){
  const days=new Map();
  for(const [k,v] of Object.entries(revisions||{})){
   if(k.endsWith(':cursor'))continue;
   const sec=Math.floor(Number(v)/1000),day=k.split(':')[0];
   if(!days.has(sec))days.set(sec,new Set());
   days.get(sec).add(day);
  }
  return new Set([...days].filter(([,set])=>set.size>1).map(([sec])=>sec));
 }
 function weekRecap({entries={},revisions={},readings=[],now=Date.now()}={}){
  const since=now-7*DAY,bulk=bulkSeconds(revisions);
  const real=t=>t&&!bulk.has(Math.floor(t/1000));
  const completed=[],commitments=[];
  for(const [key,e] of Object.entries(entries)){
   const index=Number(key);if(!Number.isInteger(index)||!e)continue;
   const r=readings[index]||[];
   if(isComplete(e)){
    const at=completionStamp(revisions,index);
    if(real(at)&&at>=since&&at<=now+DAY)completed.push({index,day:index+1,title:r[0]||'',ref:r[1]||'',at});
   }
   const obeyAt=fieldStamp(revisions,index,'obey');
   if(text(e.obey)&&real(obeyAt)&&obeyAt>=since&&obeyAt<=now+DAY)commitments.push({index,day:index+1,ref:r[1]||'',obey:text(e.obey),check:e.check||null,at:obeyAt});
  }
  completed.sort((a,b)=>a.index-b.index);commitments.sort((a,b)=>a.index-b.index);
  return {since,completed,commitments};
 }
 // The most recent earlier commitment, looking back a few readings so a missed
 // day doesn't hide what someone planned to do.
 function previousCommitment(entries,day,lookback=7){
  for(let i=day-1;i>=Math.max(0,day-lookback);i--){
   const e=(entries||{})[i];
   if(e&&text(e.obey))return {index:i,day:i+1,text:text(e.obey),check:e.check||null,gap:day-i};
  }
  return null;
 }
 // Gentle context after time away. Returns null unless someone has actually
 // been away for a few days. No counts of "missed" days, ever.
 function welcomeBack({last=0,now=Date.now(),minDays=3}={}){
  if(!last)return null;
  const away=Math.floor((now-last)/DAY);
  return away>=minDays?{away}:null;
 }
 function listNames(names,max=2){
  const unique=[...new Set((names||[]).map(text).filter(Boolean))];
  if(!unique.length)return '';
  if(unique.length===1)return unique[0];
  if(unique.length<=max)return unique.slice(0,-1).join(', ')+' and '+unique[unique.length-1];
  const extra=unique.length-max;
  return unique.slice(0,max).join(', ')+' and '+extra+' other'+(extra===1?'':'s');
 }
 function friendsSentence(names){
  const unique=[...new Set((names||[]).map(text).filter(Boolean))];
  if(!unique.length)return '';
  return listNames(unique)+' reflected on this passage';
 }
 function celebration({day,count,newMilestone=null}){
  return {
   title:newMilestone?newMilestone+' readings completed':'Day '+day+' complete',
   line:newMilestone?MILESTONE_LINES[newMilestone]:(count===1?'Your first reading is complete.':'That’s '+count+' readings so far.'),
   milestone:newMilestone
  };
 }
 const api={DAY,MILESTONES,MILESTONE_LINES,isComplete,completedDays,earnedMilestones,nextMilestone,completionStamp,lastActivity,weekRecap,previousCommitment,welcomeBack,listNames,friendsSentence,celebration};
 root.OBEY_SOS_JOURNEY=api;
 if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
