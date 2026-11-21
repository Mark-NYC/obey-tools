import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync, existsSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const read=path=>readFileSync(resolve(root,path),'utf8')
const index=read('index.html')
const hub=read('grow/index.html')
const questions=read('questions/index.html')
const sos=read('daily-sos.html')
const slugs=[
 'what-key-arguments-are-there-for-and-against-gods-existence',
 'why-does-god-remain-so-hidden',
 'why-would-a-good-god-allow-evil-to-exist',
 'why-would-a-good-god-allow-suffering-to-exist',
 'how-can-a-loving-god-send-people-to-hell',
 'why-does-the-old-testament-god-seem-different-than-the-new-testament-god',
 'why-would-god-command-the-death-of-so-many-people-in-the-bible-e-g-the-canaanites',
 'why-would-god-need-people-to-worship-him-isnt-that-egotistical-and-arrogant',
 'what-are-the-practical-implications-of-an-atheistic-worldview'
]
test('Growing Faith stays available by direct URL without a homepage button',()=>{
 assert.doesNotMatch(index,/href="\/grow\/"/)
 assert.match(hub,/href="\/questions\/"/)
 assert.match(hub,/href="\/daily-sos\.html"/)
 assert.match(hub,/Explore honest questions\. Follow Jesus daily\./)
 assert.match(hub,/CHOOSE YOUR PATH/)
})
test('section navigation and original permalinks work together',()=>{
 assert.match(questions,/href="\/grow\/"/)
 assert.match(sos,/href="\/grow\/"/)
 for(const slug of slugs){
  const path=slug+'/index.html'
  assert.ok(existsSync(resolve(root,path)), 'missing '+path)
  const page=read(path)
  assert.match(page,/href="\/grow\/"/)
  assert.match(page,/href="\/questions\/"/)
  assert.ok(questions.includes('href="/'+slug+'/"'), 'missing card link '+slug)
  assert.ok(page.includes('youtube-nocookie.com/embed/'), 'missing curated video embed '+slug)
  assert.match(page,/Curated video/,'missing attribution '+slug)
  assert.match(page,/Three questions worth discussing/,'missing discussion '+slug)
  assert.match(page,/Read it for yourself/,'missing Scripture followup '+slug)
  assert.ok(!page.includes('https://web.archive.org/'),'public page should not link to archive '+slug)
 }
})
test('shared brand assets and responsive layouts',()=>{
 assert.match(hub,/href="\/fonts\.css"/)
 assert.match(hub,/href="\/buttons\.css"/)
 assert.match(hub,/href="\/grow\/grow\.css"/)
 assert.match(questions,/href="\/grow\/grow\.css"/)
 assert.match(sos,/href="\/buttons\.css"/)
 assert.match(hub,/var\(--ot-nav-green-deep/)
 assert.match(hub,/@media\(max-width:760px\)/)
 assert.match(hub,/@media\(max-width:450px\)/)
 assert.match(questions,/data-filter=/)
})

test('Follow Daily public name is consistent without changing SOS URLs or data keys',()=>{
 const client=read('daily-sos-email.js')
 const sender=read('supabase/functions/daily-sos-delivery/index.ts')
 assert.match(hub,/<h3>FOLLOW DAILY<\/h3>/)
 assert.match(hub,/SOS · Say, Obey, Share/)
 assert.match(sos,/<h1>FOLLOW DAILY<\/h1>/)
 assert.match(sos,/ABIDE IN JESUS · SAY, OBEY, SHARE/)
 assert.match(sos,/<h2>Follow Daily in your inbox<\/h2>/)
 assert.match(sos,/obeytools:daily-sos:v2/)
 assert.match(sender,/from:"Follow Daily <daily@obey.tools>"/)
 assert.match(sender,/\| Follow Daily/)
 assert.match(sender,/https:\/\/obey.tools\/daily-sos.html/)
 assert.match(client,/Confirm Daily Emails/)
 assert.match(client,/No account needed/)
})

test('Questions index promotes nine playable topics without redirecting to archive',()=>{
 assert.equal((questions.match(/class="card-media"/g)||[]).length,15)
 assert.equal((questions.match(/data-question/g)||[]).length>=9,true)
 assert.match(questions,/DID JESUS REALLY RISE FROM THE DEAD\?/)
 assert.equal((questions.match(/data-group>/g)||[]).length,5)
 assert.ok(!questions.includes('https://web.archive.org/'))
 assert.ok(existsSync(resolve(root,'questions/video.css')))
})

test('All nine college-facing videos fit in an eight-minute viewing window',()=>{
 const curated={
  'what-key-arguments-are-there-for-and-against-gods-existence':{id:'_4ePHzADMVA',duration:'2:53'},
  'why-does-god-remain-so-hidden':{id:'IBIsLTQ-GKQ',duration:'2:51'},
  'why-would-a-good-god-allow-evil-to-exist':{id:'GrbhVO_yifE',duration:'2:55'},
  'why-would-a-good-god-allow-suffering-to-exist':{id:'DBWw94ZyJio',duration:'Under 3 min'},
  'how-can-a-loving-god-send-people-to-hell':{id:'7qUqgOZdUoQ',duration:'4:52'},
  'why-does-the-old-testament-god-seem-different-than-the-new-testament-god':{id:'r8RZarGC8B4',duration:'7:30',start:4350,end:4800},
  'why-would-god-command-the-death-of-so-many-people-in-the-bible-e-g-the-canaanites':{id:'r8RZarGC8B4',duration:'6:53',start:6084,end:6497},
  'why-would-god-need-people-to-worship-him-isnt-that-egotistical-and-arrogant':{id:'3Q-h60j2OS4',duration:'Under 3 min'},
  'what-are-the-practical-implications-of-an-atheistic-worldview':{id:'OxiAikEk2vU',duration:'5:01'}
 }
 for(const [slug,v] of Object.entries(curated)){
  const page=read(slug+'/index.html')
  const thumb='https://i.ytimg.com/vi/'+v.id+'/hqdefault.jpg'
  assert.ok(page.includes('https://www.youtube-nocookie.com/embed/'+v.id),'embed mismatch '+slug)
  assert.ok(page.includes(thumb),'OpenGraph image mismatch '+slug)
  assert.ok(questions.includes(thumb),'landing thumbnail mismatch '+slug)
  assert.ok(page.includes('English · '+v.duration+'</strong>'),'language and runtime not visible on detail '+slug)
  assert.ok(page.includes('lang="en" src="https://www.youtube-nocookie.com/embed/'),'English iframe metadata missing '+slug)
  assert.ok(page.includes('hl=en&amp;cc_lang_pref=en'),'English caption preference missing '+slug)
  assert.ok(questions.includes('Watch · '),'missing index watch label')
  if(v.start!==undefined){
   assert.ok(page.includes('start='+v.start+'&amp;end='+v.end)||page.includes('start='+v.start+'&end='+v.end),'chapter boundaries mismatch '+slug)
   assert.ok(v.end-v.start<=480,'clip longer than eight minutes '+slug)
  }else{
   assert.ok(!page.includes('start='),'unexpected unverified clipping '+slug)
  }
 }
 assert.equal(Object.keys(curated).length,9)
 assert.equal(new Set(Object.values(curated).map(v=>v.id)).size,8)
})

test('Six new foundational questions have on-page videos, conversation prompts and related content',()=>{
 const newSlugs=[
 'did-jesus-really-rise-from-the-dead',
 'how-do-we-know-the-bible-is-reliable',
 'is-jesus-really-god-or-just-a-good-teacher',
 'why-is-christianity-true-instead-of-another-religion',
 'does-science-contradict-christianity',
 'why-are-christians-so-hypocritical-and-judgmental'
 ]
 for(const slug of newSlugs){
  const path=slug+'/index.html'
  assert.ok(existsSync(resolve(root,path)),'new question page missing '+slug)
  const html=read(path)
  assert.ok(questions.includes('href="/'+slug+'/"'),'index link missing '+slug)
  assert.match(html,/youtube-nocookie\.com\/embed\//)
  assert.match(html,/lang="en"/)
  assert.match(html,/Three questions worth discussing/)
  assert.equal((html.match(/<li>/g)||[]).length,3)
  assert.equal((html.match(/class="q-scripture"/g)||[]).length,1)
  assert.match(html,/href="\/daily-sos\.html"/)
  assert.ok(!html.includes('web.archive.org'))
 }
 assert.match(questions,/data-filter="Jesus &amp; the Gospel"/)
 assert.match(questions,/data-filter="Christianity &amp; Culture"/)
 assert.match(questions,/id="count">15 questions/)
})
test('Longer videos are bounded to under eight minutes',()=>{
 for(const slug of ['did-jesus-really-rise-from-the-dead','why-is-christianity-true-instead-of-another-religion','does-science-contradict-christianity','why-are-christians-so-hypocritical-and-judgmental']){
  const html=read(slug+'/index.html')
  const match=html.match(/start=(\d+)&amp;end=(\d+)/)
  assert.ok(match,'missing bounded excerpt '+slug)
  assert.ok(Number(match[2])-Number(match[1])<=480,'excerpt exceeds eight minutes '+slug)
 }
})

test('Growing Faith landing has only one hero headline and two concise choices',()=>{
 assert.equal((hub.match(/class="eyebrow/g)||[]).length,0)
 assert.equal((hub.match(/class="card-top"/g)||[]).length,2)
 assert.equal((hub.match(/class="card-body"/g)||[]).length,2)
 assert.ok(!hub.includes('class="features"'))
 assert.ok(!hub.includes('class="section-bridge"'))
 assert.ok(!hub.includes('class="purpose"'))
 assert.match(hub,/Explore the tough questions about God, Jesus, and the Bible\./)
 assert.match(hub,/Read Scripture\. Listen to Jesus\. Put it into practice\./)
})
