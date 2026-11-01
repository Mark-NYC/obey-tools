// Run with NODE_PATH pointing to playwright-core if it is not installed locally.
// CHROMIUM_PATH may point at any compatible installed Chromium executable.
const {chromium}=require('playwright-core');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'../..');
const SHOTS=process.env.I18N_SHOTS || '/tmp/obey-urdu-shots';fs.mkdirSync(SHOTS,{recursive:true});
const en=JSON.parse(fs.readFileSync(path.join(ROOT,'lang/en.json'))),ur=JSON.parse(fs.readFileSync(path.join(ROOT,'lang/ur.json')));
function leaves(o,p='',out={}){for(const [k,v] of Object.entries(o)){const key=p?p+'.'+k:k;if(v&&typeof v==='object')leaves(v,key,out);else out[key]=v;}return out;}
const e=leaves(en),u=leaves(ur);
assert.deepEqual(Object.keys(u).sort(),Object.keys(e).sort(),'All source keys and array positions must exist in Urdu');
for(const [key,value] of Object.entries(e)){
 assert.deepEqual((String(u[key]).match(/\{\w+\}/g)||[]).sort(),(String(value).match(/\{\w+\}/g)||[]).sort(),key+' placeholders');
 if(key.startsWith('selector.')&&key.endsWith('.url'))continue;
 if(key.startsWith('church_assessment.present.'))continue;
 if(/[a-z]{3}/i.test(value)&&value===u[key]&&!['WhatsApp','Signal'].includes(value))throw Error('Untranslated: '+key);
}
const data=JSON.parse(fs.readFileSync(path.join(ROOT,'assets/bible/ur-oucv.json')));
const P=ur.church_assessment.present;
P.verses.forEach((v,i)=>assert.ok(P.highlights[i]&&v.includes(P.highlights[i]),'Presentation highlight '+i));
let refs=[];
for(const file of fs.readdirSync(ROOT).filter(x=>x.endsWith('.html'))){const html=fs.readFileSync(path.join(ROOT,file),'utf8');for(const key of html.matchAll(/data-i18n(?:-html|-placeholder|-title|-aria-label|-alt|-content)?="([^"]+)"/g))assert.ok(key[1] in e,'Missing translation key '+file+':'+key[1]);for(const m of html.matchAll(/data-bible-ref="([^"]+)"/g))refs.push({file,ref:m[1]});}
for(const {ref} of refs){const [,book,ch,first,last]=/^([A-Z]{3}) (\d+):(\d+)-(\d+)$/.exec(ref);for(let n=+first;n<=+last;n++)assert.ok(data.books[book.toLowerCase()].chapters[ch][n],ref+' verse '+n);}
console.log(`PASS dictionary: ${Object.keys(e).length} values, placeholders, ${refs.length} embedded passages, exact presentation highlights`);
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.ttf':'font/ttf','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg'};
const server=http.createServer((req,res)=>{let file=path.join(ROOT,decodeURIComponent(new URL(req.url,'http://local').pathname));if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!fs.existsSync(file)&&fs.existsSync(file+'.html'))file+='.html';if(!file.startsWith(ROOT)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':(path.basename(file)==='uco'?'text/html':MIME[path.extname(file)])||'application/octet-stream'});fs.createReadStream(file).pipe(res);});
const stub=`export function createClient(){const query=new Proxy(function(){},{get(t,k){if(k==='then')return resolve=>Promise.resolve(resolve({data:[],error:null}));if(k==='single'||k==='maybeSingle')return ()=>Promise.resolve({data:{data:{cities:[]}},error:null});return ()=>query;}});return {auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:()=>query,rpc:async()=>({data:[],error:null}),channel:()=>({on(){return this},subscribe(){return this}}),removeChannel(){}}}`;
(async()=>{
 await new Promise(r=>server.listen(8098,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route('**/*',route=>{const url=route.request().url();if(url.includes('cdn.jsdelivr.net/npm/@supabase/supabase-js'))return route.fulfill({contentType:'text/javascript',body:stub});if(url.startsWith('http://127.0.0.1:8098'))return route.continue();return route.abort();});
  const page=await context.newPage();let errors=[];page.on('pageerror',err=>errors.push(err.message));
  const pages=[...fs.readdirSync(ROOT).filter(x=>x.endsWith('.html')&&!x.startsWith('google')), 'bible-study/index.html', 'uco'].filter(file=>!fs.readFileSync(path.join(ROOT,file),'utf8').includes('http-equiv="refresh"'));
  const failures=[];
  for(const file of pages){errors=[];await page.goto('http://127.0.0.1:8098/'+file+'?lang=ur',{waitUntil:'domcontentloaded'});try{await page.waitForFunction(()=>window.i18n?.isReady,{timeout:8000});}catch{failures.push({file,error:'i18n not ready',errors});continue;}
   const check=await page.evaluate(()=>({lang:document.documentElement.lang,dir:document.documentElement.dir,overflow:document.documentElement.scrollWidth>innerWidth+2,englishBible:document.querySelector('.bible-text')?.textContent.includes('Christian Standard Bible'),font:document.fonts.check('16px "Obey Urdu"')}));
   await page.evaluate(()=>document.fonts.ready);
   if(check.lang!=='ur'||check.dir!=='rtl'||check.englishBible||errors.length)failures.push({file,...check,errors});
   assert.equal(check.overflow,false,file+' must fit mobile width');
   if(process.env.I18N_AUDIT){const ascii=await page.evaluate(()=>{const found=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const n=walker.currentNode,p=n.parentElement;if(!p||p.closest('script,style,option,select,.bible-attribution,[data-no-translate]')||!p.getClientRects().length)continue;const value=n.textContent.trim();if(/[A-Za-z]{3}/.test(value))found.push(value);}return [...new Set(found)];});if(ascii.length)console.log('TEXT REVIEW',file,JSON.stringify(ascii));}

   if(['index.html','4-questions.html','be-baptized.html','conversation-box-guide.html','church-assessment.html','bible-study/index.html','stories-of-hope-selector.html','band.html'].includes(file))await page.screenshot({path:path.join(SHOTS,file.replaceAll('/','-')+'.png'),fullPage:true});
  }
  assert.deepEqual(failures,[],'Every page loads Urdu without runtime errors');
  console.log('PASS Urdu browser initialization:',pages.length,'pages');
  for(const width of [390,1280]){
   await page.setViewportSize({width,height:900});
   await page.goto('http://127.0.0.1:8098/4-questions.html?lang=ur');await page.waitForFunction(()=>window.i18n?.isReady);await page.evaluate(()=>document.fonts.ready);
   for(const tab of ['intro','why','who','how','when']){
    await page.click('#tab-'+tab);
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'4-1-1 '+tab+' fits '+width);
    await page.screenshot({path:path.join(SHOTS,`411-${tab}-${width}.png`),fullPage:true});
   }
   await page.goto('http://127.0.0.1:8098/church-assessment.html?lang=ur');await page.waitForFunction(()=>window.i18n?.isReady);await page.evaluate(()=>startPresentation());
   for(let i=0;i<12;i++){
    assert.ok((await page.locator('#verse-text mark').textContent()).length>0,'Church Circle highlight '+i);
    if(i<11)await page.click('#btn-next');
   }
   await page.screenshot({path:path.join(SHOTS,`church-presentation-${width}.png`),fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>window.i18n.reference(window.i18n.reference('Matthew 28:19'))===window.i18n.reference('Matthew 28:19')),true,'Bidi isolation is idempotent');
  console.log('PASS 4-1-1 tabs and all 12 Church Circle steps on mobile and desktop');

  await page.goto('http://127.0.0.1:8098/be-baptized.html?lang=ur');await page.waitForFunction(()=>window.i18n?.isReady);
  assert.equal(await page.locator('.accordion-step').count(),8);
  await page.locator('.accordion-step').nth(4).click();
  assert.ok(await page.locator('.bible-text').textContent().then(x=>x.includes('Biblica®')));
  assert.ok(!(await page.locator('.guide-reference').allTextContents()).some(x=>/Matthew|Acts/.test(x)),'Study references are Urdu');
  await page.locator('.bible-btn').last().click();
  await page.screenshot({path:path.join(SHOTS,'baptism-expanded.png'),fullPage:true});
  console.log('PASS Urdu study accordion, published passage and notes');
  await page.goto('http://127.0.0.1:8098/scripture.html?lang=ur&ref=MRK%2016:9-20');await page.waitForFunction(()=>document.querySelectorAll('#passage .bible-verse').length===12);console.log('PASS daily-reading local Scripture page');
  await page.goto('http://127.0.0.1:8098/stories-of-hope-selector.html?lang=ur');await page.waitForFunction(()=>window.i18n?.isReady);assert.ok((await page.locator('.category-name').first().textContent()).includes('خوف'));await page.locator('.category-card').nth(1).click();assert.ok((await page.locator('.btn-open').getAttribute('href')).includes('lang=ur'));console.log('PASS selector translates and shares local Urdu studies');
  await page.goto('http://127.0.0.1:8098/index.html?lang=en');await page.waitForFunction(()=>window.i18n?.isReady);assert.equal(await page.locator('html').getAttribute('dir'),'ltr');assert.equal(await page.locator('select').inputValue(),'en');
  await page.selectOption('select','ur');await page.waitForFunction(()=>window.i18n?.isReady&&window.i18n.getLang()==='ur');assert.equal(await page.evaluate(()=>localStorage.getItem('obeytools_lang')),'ur');
  await page.goto('http://127.0.0.1:8098/commands-of-christ.html');await page.waitForFunction(()=>window.i18n?.isReady);assert.equal(await page.locator('html').getAttribute('lang'),'ur');
  await page.goto('http://127.0.0.1:8098/be-baptized.html?lang=en');await page.waitForFunction(()=>window.i18n?.isReady);assert.ok((await page.locator('.bible-text').textContent()).includes('Christian Standard Bible'));console.log('PASS language switch, persistence and English Bible regression');
  await page.goto('http://127.0.0.1:8098/index.html?lang=ar');await page.waitForFunction(()=>window.i18n?.isReady);assert.equal(await page.locator('html').getAttribute('dir'),'rtl');assert.ok((await page.locator('[data-i18n=\"index.conversation_box\"]').textContent()).length>0);console.log('PASS existing Arabic RTL language');

 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
