import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync('daily-sos.html','utf8');
const circle=readFileSync('follow-circles.html','utf8');
const module=readFileSync('daily-sos-circles.js','utf8');
const manage=readFileSync('follow-circles.js','utf8');
const sql=readFileSync('supabase/migrations/20261122190000_follow_circle_shared_schedules.sql','utf8');
for(const id of ['following-together','following-posts','following-expand','following-more','following-share-toggle','following-share-form','following-body','following-targets','following-submit','following-filter','following-expanded-controls','following-collapse','following-context','following-notice','following-manage']){
 assert(html.includes('id="'+id+'"'),id+' is absent from daily page');
}
for(const id of ['create-start','create-start-current','create-timezone','make-primary','primary-context','circle-today-link']){
 assert(circle.includes('id="'+id+'"'),id+' absent from management page');
}
assert(html.includes('daily-sos-circles.js'),'module must load');
assert(html.includes('sos:day-rendered'),'day change must refresh passage');
assert(html.includes('sos:sync-applied'),'cloud sync must trigger schedule');
assert(module.includes('.eq(\'reading_day\',requestedDay)'),'combined reflection preview must match passage');
assert(module.includes('.in(\'circle_id\',allowedIds())'),'combined feed must filter memberships');
assert(module.includes('const size=expanded?PAGE:3'),'limit preview to 3');
assert(module.includes('checkbox.type=\'checkbox\''),'targets must be explicit checkboxes');
assert(!module.includes("state.entries"),'community must not read private SOS entries');
assert(manage.includes('follow_circle_create_scheduled'),'new Circle must use shared schedule RPC');
assert(manage.includes('follow_circle_set_primary'),'primary setting required');
assert(sql.includes("pg_catalog.pg_timezone_names"),'IANA timezone validation required');
assert(sql.includes('follow_circle_default_primary'),'automatic first primary required');
assert(sql.includes('follow_circle_schedule()'),'schedule RPC required');
console.log('Following Together integrated static contract checks: passed');
