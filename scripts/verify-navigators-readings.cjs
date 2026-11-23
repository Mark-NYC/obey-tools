/* Run: node scripts/verify-navigators-readings.cjs */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const raw=fs.readFileSync('navigators-readings.js','utf8');
const context={window:{}};
vm.runInNewContext(raw,context,{filename:'navigators-readings.js'});
const months=context.window.NAVIGATORS_READING_RAW;
assert.equal(months.length,12,'must have 12 months');
let count=0;
const get=(m,d)=>{
 const lines=months[m-1].trim().split('\n');
 const headers=lines.shift().split('|');
 assert.equal(headers.length,4,'4 tracks at month '+m);
 assert.equal(lines.length,25,'25 days in month '+m);
 const values=lines[d-1].split('|');
 assert.equal(values.length,4,'4 readings on '+m+'/'+d);
 return values.map((v,i)=>{
  assert.ok(v.trim(),'no empty passages');
  return /^\d+\s+[A-Za-z]|^[A-Za-z]/.test(v)?v:headers[i]+' '+v;
 });
};
for(let m=1;m<=12;m++)for(let d=1;d<=25;d++){
 const refs=get(m,d);
 assert.equal(refs.length,4);
 refs.forEach(ref=>assert.match(ref,/[0-9]/,'Scripture reference must contain a chapter'));
 count+=refs.length;
}
assert.equal(count,1200,'1,200 passages');
assert.equal(get(1,1).join('; '),'Matthew 1:1-17; Acts 1:1-11; Psalms 1; Genesis 1-2');
assert.equal(get(4,22)[1],'1 Corinthians 14:26-40');
assert.equal(get(6,25)[1],'Philippians 4:14-23');
assert.equal(get(7,1)[1],'Colossians 1:1-14');
assert.equal(get(8,19)[1],'Titus 1:1-9');
assert.equal(get(9,1)[0],'Luke 20:27-40');
assert.equal(get(10,13)[1],'1 Peter 1:1-9');
assert.equal(get(10,22)[3],'Lamentations 1');
assert.equal(get(11,8)[1],'1 John 1:1-4');
assert.equal(get(12,25).join('; '),'John 21:15-25; Revelation 22; Job 42; Malachi 1-4');
const html=fs.readFileSync('navigators-bible-plan.html','utf8');
assert.ok(html.includes('/navigators-readings.js'),'page loads reading data');
assert.ok(html.includes("reading(month,day).forEach"),'cards use original data');
assert.ok(html.includes('loadPassage(scripture,ref,requestId)'),'Scripture is shown inline without click');
assert.ok(!html.includes('id="month"'),'no month dropdown');
assert.ok(!html.includes('id="day-select"'),'no day dropdown');
assert.ok(html.includes('id="journey-dialog"'),'journey view exists');
assert.ok(html.includes('navigators-community.js'),'account and Circle module exists');
assert.ok(!html.includes("Reading '+(i+1)+' in official chart"),'no placeholders');

// The UI has one continuous dated rail, with 25 readings plus catch-up days in each plan month.
assert.ok(html.includes('class="day-rail days" id="days"'),'continuous reading rail exists');
assert.ok(!html.includes('id="prev-month"')&&!html.includes('id="next-month"'),'no separate month navigation');
assert.ok(html.includes('id="start-date-input"'),'start date can be changed');
assert.ok(html.includes('id="go-today"'),'date-aware Go to today control exists');
const pageScript=html.split('<script>')[1].split('</script>')[0];
new vm.Script(pageScript,{filename:'navigators-page.js'});
const dateStart=pageScript.indexOf('const localToday='),dateEnd=pageScript.indexOf('const tracks=',dateStart);
assert.ok(dateStart>=0&&dateEnd>dateStart,'testable date algorithm exists');
const dateLogic=pageScript.slice(dateStart,dateEnd);
for(const start of ['2026-11-22','2026-01-31','2028-02-29']){
 const sandbox={state:{startedOn:start,items:{}},KEY:'test',month:1,day:1,localStorage:{setItem(){}},navigate(){}};
 const slots=vm.runInNewContext(dateLogic+'\nplanSlots()',sandbox);
 assert.equal(slots.filter(x=>x.reading).length,300);
 assert.equal(slots.length,365,'a one-year plan');
 assert.equal(slots[0].date,start,'plan starts on chosen date');
 assert.equal(slots.at(-1).number,null,'last day is catch-up');
 for(let m=1;m<=12;m++){
  const subset=slots.filter(x=>x.month===m);
  assert.equal(subset.filter(x=>x.reading).length,25,'25 readings for month '+m);
  assert.ok(subset.length>=28&&subset.length<=31,'calendar month length');
  assert.equal(subset[0].number,1+(m-1)*25,'global day numbering');
  assert.ok(subset.slice(25).every(x=>!x.reading),'end-of-month catch-up days');
 }
 assert.ok(slots.every((x,i)=>i===0||x.date>slots[i-1].date),'dates never repeat or reverse');
}
console.log('OK: 12 months, 300 days, 1,200 references, key transitions, and in-page reader.');
