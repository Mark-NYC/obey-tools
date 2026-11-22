import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import {fileURLToPath} from 'node:url'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const read=file=>fs.readFileSync(path.join(root,file),'utf8')
const context={window:{}}
vm.runInNewContext(read('daily-sos-journey.js'),context,{filename:'daily-sos-journey.js'})
const J=context.window.OBEY_SOS_JOURNEY
const DAY=86400000
const done=(extra={})=>({read:true,insight:true,say:'s',obey:'o',share:'h',...extra})
const readings=Array.from({length:365},(_,i)=>['Title '+(i+1),'Ref '+(i+1)])

test('completion requires all five parts, matching the page definition',()=>{
 assert.equal(J.isComplete(done()),true)
 assert.equal(J.isComplete(done({share:'  '})),false)
 assert.equal(J.isComplete(done({insight:false})),false)
 assert.deepEqual([...J.completedDays({3:done(),1:done(),2:{read:true}})],[1,3])
})

test('milestones count completed readings and are never taken away',()=>{
 assert.deepEqual([...J.earnedMilestones(6)],[])
 assert.deepEqual([...J.earnedMilestones(7)],[7])
 assert.deepEqual([...J.earnedMilestones(31)],[7,30])
 // Someone who cleared answers (count fell) keeps what was earned.
 assert.deepEqual([...J.earnedMilestones(2,[7,30])],[7,30])
 assert.deepEqual([...J.earnedMilestones(0,['bogus',12])],[])
 assert.equal(J.nextMilestone(7),30)
 assert.equal(J.nextMilestone(365),null)
 assert.deepEqual([...J.MILESTONES],[7,30,90,180,365])
})

test('weekly recap uses only real completion times and private commitments',()=>{
 const now=Date.UTC(2026,10,22,12)
 const entries={0:done({obey:'Call my brother',check:'done'}),1:done(),2:done(),3:{read:true,obey:'Pray for Sam'}}
 const revisions={
  '1:share':now-2*DAY,'1:obey':now-2*DAY,     // completed this week
  '2:read':now-10*DAY,'2:share':now-9*DAY,     // completed last week
  // day 3 complete locally but no timestamp: never guessed into the week
  '4:obey':now-DAY                              // commitment written, reading unfinished
 }
 const week=J.weekRecap({entries,revisions,readings,now})
 assert.deepEqual([...week.completed].map(c=>c.day),[1])
 assert.equal(week.completed[0].title,'Title 1')
 assert.deepEqual([...week.commitments].map(c=>[c.day,c.obey,c.check]),[[1,'Call my brother','done'],[4,'Pray for Sam',null]])
})

test('bulk imports (first sign-in upload) never count as this week’s activity',()=>{
 const now=Date.UTC(2026,10,22,12),t=now-1000
 const entries={0:done(),1:done(),2:done({obey:'Serve'})}
 const revisions={'1:share':t,'1:obey':t+1,'2:share':t+2,'3:obey':t+3,'3:share':t+3}
 const week=J.weekRecap({entries,revisions,readings,now})
 assert.equal(week.completed.length,0)
 assert.equal(week.commitments.length,0)
 // A genuine single-day save in the same window still counts.
 const ok=J.weekRecap({entries,revisions:{...revisions,'3:share':now-5*DAY,'3:obey':now-5*DAY},readings,now})
 assert.deepEqual([...ok.completed].map(c=>c.day),[3])
})

test('weekly recap is empty rather than invented when there is no history',()=>{
 const week=J.weekRecap({entries:{0:done()},revisions:{},readings,now:Date.now()})
 assert.equal(week.completed.length,0)
 assert.equal(week.commitments.length,0)
})

test('previous commitment survives missed days and keeps its saved response',()=>{
 const entries={4:{obey:'Text Maya',check:'pending'},5:{read:true}}
 const prev=J.previousCommitment(entries,8)
 assert.equal(prev.index,4);assert.equal(prev.day,5);assert.equal(prev.gap,4)
 assert.equal(prev.text,'Text Maya');assert.equal(prev.check,'pending')
 assert.equal(J.previousCommitment(entries,20),null,'only looks back a week of readings')
 assert.equal(J.previousCommitment({},0),null)
 assert.equal(J.previousCommitment({7:{obey:'  '}},8),null,'blank answers are not commitments')
})

test('welcome back appears only after real time away and never counts missed days',()=>{
 const now=Date.UTC(2026,10,22)
 assert.equal(J.welcomeBack({last:0,now}),null)
 assert.equal(J.welcomeBack({last:now-DAY,now}),null)
 assert.deepEqual({...J.welcomeBack({last:now-5*DAY,now})},{away:5})
 assert.equal(J.lastActivity({'1:cursor':now,'2:say':now-3*DAY}),now-3*DAY,'navigation alone is not activity')
 assert.equal(J.lastActivity({'2:say':now+5},now),0,'writes after opening the page are ignored')
})

test('friend sentences use real names, deduplicate, and stay compact',()=>{
 assert.equal(J.friendsSentence([]),'')
 assert.equal(J.friendsSentence(['Anna']),'Anna reflected on this passage')
 assert.equal(J.friendsSentence(['Anna','David','Anna']),'Anna and David reflected on this passage')
 assert.equal(J.friendsSentence(['Anna','David','Maya','Sam']),'Anna, David and 2 others reflected on this passage')
 assert.equal(J.listNames(['you','Maya']),'you and Maya')
})

test('celebrations describe what actually happened',()=>{
 assert.deepEqual({...J.celebration({day:12,count:1})},{title:'Day 12 complete',line:'Your first reading is complete.',milestone:null})
 assert.equal(J.celebration({day:12,count:13}).line,'That’s 13 readings so far.')
 const m=J.celebration({day:40,count:30,newMilestone:30})
 assert.equal(m.title,'30 readings completed');assert.equal(m.milestone,30)
})

test('engagement stays inside existing elements and avoids competitive mechanics',()=>{
 const html=read('daily-sos.html'),circles=read('daily-sos-circles.js')
 for(const banned of [/\bXP\b/,/leaderboard/i,/streak/i,/points?\b.*earned/i,/Today’s Mission/i,/confetti/i])
  assert.doesNotMatch(html+circles,banned)
 assert.match(html,/<script src="\/daily-sos-journey\.js"><\/script>/)
 assert.match(html,/prefers-reduced-motion:no-preference/)
 assert.match(html,/openedComplete\|\|celebratedDay===i/,'no repeat celebrations when reopening a completed day')
 // Commitment response is saved on the day it was made, preserving history.
 assert.match(html,/const e=entry\(day\);e\.check=b\.dataset\.check;state\.entries\[day\]=e/)
 // Encouragement shows who, not a tally.
 assert.doesNotMatch(circles,/total\?' · '\+total/)
 assert.match(circles,/'Encouraged by '\+names2\(who\)/)
 assert.doesNotMatch(circles,/state\.entries/,'community code never reads private SOS answers')
})
