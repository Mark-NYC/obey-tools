#!/usr/bin/env node
/* Builds a verified chapter-audio manifest from the official eBible.org
 * directory indexes. Each MP3 is listed in chapter order, one per chapter.
 * If a book's index is incomplete or ambiguous, omit it so the player uses
 * its verified direct sources or exact WEB text-to-speech fallback.
 *
 * Run: node scripts/generate-navigators-audio-manifest.cjs
 */
const fs=require('node:fs');
const assert=require('node:assert/strict');
const base='https://ebible.org/eng-web/audio/';
const names=['Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth','1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra','Nehemiah','Esther','Job','Psalms','Proverbs','Ecclesiastes','Song of Songs','Isaiah','Jeremiah','Lamentations','Ezekiel','Daniel','Hosea','Joel','Amos','Obadiah','Jonah','Micah','Nahum','Habakkuk','Zephaniah','Haggai','Zechariah','Malachi','Matthew','Mark','Luke','John','Acts','Romans','1 Corinthians','2 Corinthians','Galatians','Ephesians','Philippians','Colossians','1 Thessalonians','2 Thessalonians','1 Timothy','2 Timothy','Titus','Philemon','Hebrews','James','1 Peter','2 Peter','1 John','2 John','3 John','Jude','Revelation'];
const chapterCounts=[50,40,27,36,34,24,21,4,31,24,22,25,29,36,10,13,10,42,150,31,12,8,66,52,5,48,12,14,3,9,1,4,7,3,3,3,2,14,4,28,16,24,21,28,16,16,13,6,6,4,4,5,3,6,4,3,1,13,5,5,3,5,1,1,1,22];
assert.equal(names.length,66);assert.equal(chapterCounts.length,66);
const attrs=html=>[...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(x=>x[1]);
async function get(url){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{
  const response=await fetch(url,{signal:controller.signal,headers:{'User-Agent':'OBEY-TOOLS-web-audio-index/1.0'}});
  if(!response.ok)throw Error(response.status+' '+url);
  return await response.text();
 }finally{clearTimeout(timer)}
}
const origin='https://ebible.org';
function safeURL(raw,parent){
 try{
  const url=new URL(raw,parent);
  if(url.origin!==origin||!url.pathname.startsWith('/eng-web/audio/'))return null;
  url.search='';url.hash='';
  return url;
 }catch{return null}
}
(async()=>{
 const root=await get(base);
 const folders=new Map();
 for(const href of attrs(root)){
  const url=safeURL(href,base);if(!url)continue;
  const name=decodeURIComponent(url.pathname).split('/').filter(Boolean).at(-1)||'';
  const match=name.match(/^(\d{2})_[^/]+$/);
  if(match&&url.pathname.endsWith('/'))folders.set(Number(match[1]),url.href);
 }
 console.log('Found',folders.size,'book folders');
 const results={},errors=[];
 let next=0;
 async function worker(){
  while(next<66){
   const i=next++,url=folders.get(i+1),book=names[i],expected=chapterCounts[i];
   if(!url){errors.push(book+' missing directory');continue}
   try{
    const html=await get(url);
    const links=[];
    for(const href of attrs(html)){
     const full=safeURL(href,url);
     if(!full||!full.pathname.startsWith(new URL(url).pathname))continue;
     const filename=decodeURIComponent(full.pathname.split('/').at(-1)||'');
     if(!filename.toLowerCase().endsWith('.mp3')||/\s\(\d+\)\.mp3$/i.test(filename))continue;
     links.push(full.href);
    }
    const unique=[...new Set(links)];
    const chapterSequence=url=>{const file=decodeURIComponent(url.split('/').at(-1));const prefix=file.match(/^[\\d_\\s]+/)?.[0]||'';return Number(prefix.match(/\\d+/g)?.at(-1)||0)};
    unique.sort((a,b)=>chapterSequence(a)-chapterSequence(b)||a.localeCompare(b));
    // eBible gave Isaiah 16 and 17 the same source sequence number (0695).
    // Put those two files in the correct Scripture chapter order.
    if(book==='Isaiah'){
     const sixteen=unique.findIndex(url=>decodeURIComponent(url).includes('Isaiah-Chapter Sixteen.mp3'));
     const seventeen=unique.findIndex(url=>decodeURIComponent(url).includes('Isaiah-Chapter Seventeen.mp3'));
     if(sixteen>=0&&seventeen>=0&&sixteen>seventeen){const entry=unique.splice(sixteen,1)[0];unique.splice(seventeen,0,entry)}
    }
    if(unique.length!==expected){errors.push(book+' '+unique.length+'/'+expected+' MP3s');continue}
    results[book]=unique;
    console.log(book+': '+unique.length+' chapters');
   }catch(error){errors.push(book+': '+error.message)}
  }
 }
 await Promise.all(Array.from({length:6},worker));
 const recorded=Object.values(results).reduce((a,b)=>a+b.length,0);
 console.log('Verified',Object.keys(results).length,'books,',recorded,'audio chapters');
 for(const error of errors)console.warn('Skipped:',error);
 // Reject a manifest that is likely an outage or changed directory structure.
 if(Object.keys(results).length<45)throw Error('Too few books verified, refusing to replace audio manifest');
 const ordered=Object.fromEntries(names.filter(n=>results[n]).map(n=>[n,results[n]]));
 const output='/* Verified chapter MP3 links from https://ebible.org/eng-web/audio/. Generated; do not hand-edit. */\nwindow.NAVIGATORS_AUDIO_MANIFEST = '+JSON.stringify(ordered,null,2)+';\n';
 fs.writeFileSync('navigators-audio-manifest.js',output);
})();
