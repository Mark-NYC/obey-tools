/* Navigators audio: human-recorded WEB chapters only, never synthesized speech. An assigned verse range plays its full containing chapter because chapter recordings have no verified verse timestamps. */
(() => {
 'use strict';
 const $ = id => document.getElementById(id);
 const root = $('passages'),playAll=$('audio-all'),pauseButton=$('audio-pause'),stopButton=$('audio-stop');
 const speedControl=$('audio-speed'),status=$('audio-status');
 if (!root || !playAll || !window.NAVIGATORS_READING_RAW) return;
 const audio = new Audio();
 audio.preload='none';
 audio.setAttribute('playsinline','');
 let generation=0,items=[],index=0,activeGroup=-1,paused=false,busy=false;
 const sayStatus=message=>{status.textContent=message};
 const nt=[
  ['Matthew','Matthew'],['Mark','Mark'],['Luke','Luke'],['John','John'],['Acts','Acts'],
  ['Romans','Romans'],['1 Corinthians','1Corinthians'],['2 Corinthians','2Corinthians'],
  ['Galatians','Galatians'],['Ephesians','Ephesians'],['Philippians','Philippians'],
  ['Colossians','Colossians'],['1 Thessalonians','1Thess'],['2 Thessalonians','2Thess'],
  ['1 Timothy','1Timothy'],['2 Timothy','2Timothy'],['Titus','Titus'],
  ['Philemon','Philemon'],['Hebrews','Hebrews'],['James','James'],
  ['1 Peter','1Peter'],['2 Peter','2Peter'],['1 John','1John'],
  ['2 John','2John'],['3 John','3John'],['Jude','Jude'],['Revelation','Revelation']
 ];
 const numbers=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
 const tens=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
 function numberWords(n){
  if(n<20)return numbers[n];
  if(n<100)return tens[Math.floor(n/10)]+(n%10?' '+numbers[n%10]:'');
  return 'One Hundred'+(n%100?' '+numberWords(n%100):'');
 }
 function filename(book,chapter){
  const verified=window.NAVIGATORS_AUDIO_MANIFEST?.[book]?.[chapter-1];
  if(typeof verified==='string'&&verified.startsWith('https://ebible.org/eng-web/audio/'))return verified;
  const found=nt.find(x=>x[0]===book);
  if(found){
   const number=String(nt.indexOf(found)+1).padStart(2,'0');
   return 'https://ebible.org/eng-web/mp3/'+number+'_'+String(chapter).padStart(2,'0')+'_'+found[1]+'.mp3';
  }
  if(book==='Genesis'&&chapter>=1&&chapter<=50)
   return 'https://ebible.org/eng-web/audio/01_Genesis/01_'+String(chapter).padStart(2,'0')+'_Genesis_Chapter_'+numberWords(chapter).replaceAll(' ','_')+'.mp3';
  if(book==='Psalms'&&chapter>=1&&chapter<=150)
   return 'https://ebible.org/eng-web/audio/19_Psalms/'+String(478+chapter).padStart(4,'0')+' Psalms-'+numberWords(chapter)+'.mp3';
  if(book==='Proverbs'&&chapter>=1&&chapter<=31)
   return 'https://ebible.org/eng-web/audio/20_Proverbs/'+String(628+chapter).padStart(4,'0')+' Proverbs-Chapter '+String(chapter).padStart(3,'0')+'.mp3';
  return null;
 }
 function splitReference(reference){
  const m=reference.trim().match(/^(.*?)\s+(\d+)(?::(\d+)(?:-(\d+))?)?(?:-(\d+))?$/);
  if(!m)return null;
  const book=m[1],first=Number(m[2]),startVerse=m[3]?Number(m[3]):null,endVerse=m[4]?Number(m[4]):null,last=m[5]?Number(m[5]):first;
  if(first<1||last<first||last>150||startVerse!==null&&startVerse<1||endVerse!==null&&endVerse<startVerse)return null;
  return {book,first,last,partial:startVerse!==null};
 }
 function tasksFor(ref,group){
  const parsed=splitReference(ref);
  if(!parsed)return [];
  const tasks=[];
  for(let chapter=parsed.first;chapter<=parsed.last;chapter++){
   const mp3=filename(parsed.book,chapter);
   if(!mp3)return [];
   tasks.push({kind:'mp3',reference:parsed.book+' '+chapter,assigned:ref,partial:parsed.partial,source:mp3,group});
  }
  return tasks;
 }
 function references(){
  return [...root.querySelectorAll('.passage-group .passage-heading h3')].map(x=>x.textContent.trim()).slice(0,4);
 }
 function draw(){
  const active=busy||paused;
  playAll.querySelector('span').textContent=active?'Start all four again':'Listen to all four';
  pauseButton.hidden=!active;
  stopButton.hidden=!active;
  pauseButton.textContent=paused?'Resume':'Pause';
  for(const btn of root.querySelectorAll('[data-audio-index]')){
   const selected=active&&Number(btn.dataset.audioIndex)===activeGroup;
   btn.setAttribute('aria-pressed',String(selected));
   btn.textContent=selected?(paused?'Resume listening':'Playing…'):'Listen';
  }
 }
 function stop(message){
  ++generation;busy=false;paused=false;items=[];index=0;activeGroup=-1;
  audio.pause();audio.removeAttribute('src');audio.load();
  draw();if(message)sayStatus(message);
 }
 function next(session){
  if(session!==generation)return;
  index++;
  playItem(session);
 }
 function playItem(session){
  if(session!==generation)return;
  if(index>=items.length){stop('Finished listening to the selected readings.');return}
  const item=items[index];
  activeGroup=item.group;paused=false;busy=true;draw();
  audio.pause();
  audio.src=item.source;
  audio.playbackRate=Number(speedControl.value)||1;
  sayStatus('Human-narrated WEB · '+item.reference+(item.partial?' (full chapter; assigned: '+item.assigned+')':'')+(items.length>1?' · continues automatically':''));
  audio.onended=()=>next(session);
  audio.onerror=()=>{if(session===generation)stop('The recording could not load. Try again when connected. No synthetic voice will play.');};
  audio.play().catch(()=>{
   if(session===generation)stop('Playback was blocked by your browser. Tap Listen to try again.');
  });
 }
 function begin(refs){
  stop();
  items=refs.flatMap(({reference,group})=>tasksFor(reference,group));
  if(!items.length){sayStatus('Human-recorded audio is unavailable for this selection. The Scripture text remains available above.');return}
  busy=true;const session=generation;index=0;playItem(session);
 }
 playAll.addEventListener('click',()=>{
  const refs=references();
  begin(refs.map((reference,group)=>({reference,group})));
 });
 root.addEventListener('click',event=>{
  const button=event.target.closest('[data-audio-index]');
  if(!button)return;
  const group=Number(button.dataset.audioIndex),refs=references();
  if(group>=refs.length)return;
  if((busy||paused)&&activeGroup===group){
   if(paused)resume();else pause();
  }else begin([{reference:refs[group],group}]);
 });
 function pause(){
  if(!busy||paused)return;
  paused=true;
  audio.pause();
  draw();sayStatus('Paused · '+(items[index]?.reference||'Scripture'));
 }
 function resume(){
  if(!paused)return;
  paused=false;
  audio.play().catch(()=>stop('Tap Listen to resume audio.'));
  draw();sayStatus('Playing · '+(items[index]?.reference||'Scripture'));
 }
 pauseButton.addEventListener('click',()=>{if(paused)resume();else pause()});
 stopButton.addEventListener('click',()=>stop('Audio stopped.'));
 speedControl.addEventListener('change',()=>{
  audio.playbackRate=Number(speedControl.value)||1;
  sayStatus((busy||paused?'Playback speed: '+speedControl.selectedOptions[0].textContent:'Ready to listen · speed '+speedControl.selectedOptions[0].textContent));
 });
 window.addEventListener('navigators:day-changed',()=>stop('Ready to listen to this day’s four readings.'));
 window.addEventListener('navigators:rendered',()=>{if(busy||paused)stop('Reading changed. Tap Listen to play.');else draw()});
 window.addEventListener('pagehide',()=>stop());
 draw();
})();
