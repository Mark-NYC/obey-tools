// Public deployment smoke only. Does not sign in or access private Circle data.
import assert from 'node:assert/strict';
const host='https://obey.tools';
async function load(path){
 let last;
 for(let retry=0;retry<5;retry++){
  try{
   const resp=await fetch(host+path,{redirect:'follow',signal:AbortSignal.timeout(15000),headers:{'user-agent':'FollowCirclesReleaseCheck/1.0'}});
   if(!resp.ok)throw Error(path+' HTTP '+resp.status);
   return await resp.text();
  }catch(e){last=e;await new Promise(resolve=>setTimeout(resolve,3000))}
 }
 throw last;
}
const html=await load('/follow-circles.html');
assert.match(html,/MULTIPLYING CIRCLES/);
assert.match(html,/id="join-form"/);
assert.match(html,/id="circle-view"/);
const js=await load('/follow-circles.js');
assert.match(js,/follow_circle_join/);
assert.match(js,/follow_circle_progress/);
const sos=await load('/daily-sos.html');
assert.match(sos,/follow-circles.html/);
assert.match(sos,/id="following-together"/);
assert.match(sos,/daily-sos-circles.js/);
const inline=await load('/daily-sos-circles.js');
assert.match(inline,/follow_circle_schedule/);
assert.match(inline,/following-share-form/);
const styles=await load('/daily-sos-circles.css');
assert.match(styles,/#following-together/);
console.log('Production FOLLOW DAILY shared Circle integration + assets: OK');
