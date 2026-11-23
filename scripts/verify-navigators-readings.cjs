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
console.log('OK: 12 months, 300 days, 1,200 references, key transitions, and in-page reader.');
