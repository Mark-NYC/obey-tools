import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const read=file=>fs.readFileSync(path.join(root,file),'utf8')
function load(file){
 const ctx={window:{}}
 vm.runInNewContext(read(file),ctx,{filename:file})
 return ctx.window
}
const websiteReadings=load('daily-sos-readings.js').OBEY_SOS_READINGS
const websiteBible=load('daily-sos-scripture.js').OBEY_WEBU
const fnRead=read('supabase/functions/daily-sos-delivery/readings.ts')
const fnBible=read('supabase/functions/daily-sos-delivery/scripture.ts')
const fn=read('supabase/functions/daily-sos-delivery/index.ts')
const sql=read('supabase/daily-sos-email/01_schema.sql')
const homepage=read('daily-sos.html')
const emailClient=read('daily-sos-email.js')

const jsonFromTypeScript=(text,name,type)=>{
 const prefix='export const '+name+' = '
 assert.ok(text.startsWith(prefix), 'Missing '+name+' data export')
 const suffix=' as '+type+';'
 assert.ok(text.trim().endsWith(suffix), 'Missing '+name+' type assertion')
 return JSON.parse(text.slice(prefix.length,text.lastIndexOf(suffix)))
}

test('Email sender shares all 365 days with website',()=>{
 const emailReadings=jsonFromTypeScript(fnRead,'readings','[string,string,string,string,string][]')
 assert.equal(emailReadings.length,365)
 assert.equal(JSON.stringify(emailReadings),JSON.stringify(websiteReadings))
})
test('Email sender shares canonical WEB Updated verses with website',()=>{
 const emailBible=jsonFromTypeScript(fnBible,'books','Record<string, Record<string, Array<[number,string]>>>')
 assert.deepEqual(Object.keys(emailBible),Object.keys(websiteBible))
 assert.equal(JSON.stringify(emailBible),JSON.stringify(websiteBible))
 assert.equal(emailBible.John['1'].length,51)
})
test('Email service requires an authorized scheduler and durable opt-out',()=>{
 assert.match(fn,/x-sos-cron-secret/)
 assert.match(fn,/constantEqual/)
 assert.match(fn,/unsubscribe_token/)
 assert.match(fn,/\/unsubscribe/)
 assert.match(fn,/Idempotency-Key/)
 assert.match(fn,/List-Unsubscribe/)
 assert.match(fn,/sos_claim_due/)
 assert.match(fn,/sos_mark_sent/)
 assert.match(fn,/sos_mark_failed/)
 assert.match(sql,/default false/)
 assert.match(sql,/enable row level security/)
 assert.match(sql,/revoke all on public.sos_email_runtime/)
 assert.match(sql,/revoke all on public.sos_email_deliveries/)
})
test('Frontend signs up without Supabase Auth or a magic link',()=>{
 assert.match(homepage,/id="email-reminders"/)
 assert.match(homepage,/id="follow-daily-form"/)
 assert.match(homepage,/id="email-start"/)
 assert.match(homepage,/daily-sos-email\.js/)
 assert.doesNotMatch(homepage,/id="email-signin"/)
 assert.doesNotMatch(emailClient,/signInWithOtp|signInWithPassword|supabase\.auth/)
 assert.match(emailClient,/\/subscribe/)
 assert.match(emailClient,/Confirmation email/)
})
test('Public signups are confirmation-only with secure management',()=>{
 const migration=read('supabase/daily-sos-email/03_email_only_confirmation.sql')
 assert.match(fn,/async function subscribe\(/)
 assert.match(fn,/async function confirm\(/)
 assert.match(fn,/async function manage\(/)
 assert.match(fn,/sos_signup_throttle/)
 assert.match(fn,/validToken/)
 assert.match(fn,/confirmation_token/)
 assert.match(fn,/expires_at/)
 assert.match(fn,/Confirm Daily Emails/)
 assert.match(fn,/sos_email_pending/)
 assert.match(fn,/unsubscribe_token/)
 assert.match(migration,/alter column user_id drop not null/)
 assert.match(migration,/enable row level security/)
 assert.match(migration,/revoke all on public\.sos_email_pending/)
})
test('Inline HTML reading still supports email day links',()=>{
 assert.match(homepage,/get\('day'\)/)
 assert.match(homepage,/linkedDay-1/)
})
test('Browser module parses without a build step',()=>{
 const transformed=emailClient.replace(/^import\s+\{[^}]+\}\s+from\s+['"][^'"]+['"];\s*/m,'')
 new Function('async function emailModule(){\n'+transformed+'\n}')
})

test('Follow Daily email uses one clear reading surface without nested panels',()=>{
 assert.match(fn,/FOLLOW DAILY/)
 assert.match(fn,/background:#ffffff/)
 assert.match(fn,/TODAY’S DISCOVERY/)
 assert.match(fn,/border-left:3px solid #00a468/)
 assert.match(fn,/paragraphs\.join/)
 assert.doesNotMatch(fn,/background:#fbf7f1/)
 assert.doesNotMatch(fn,/background:#eff6f1/)
 assert.doesNotMatch(fn,/font-size:32px;font-weight:900/)
 assert.match(fn,/OPEN TODAY’S SOS/)
 assert.match(fn,/unsubUrl/)
})
