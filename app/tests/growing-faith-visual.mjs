import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync, mkdirSync } from 'node:fs'
import { resolve, join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url)
let chromium
try{({chromium}=require('playwright'))}catch{({chromium}=require('playwright-core'))}
const app=resolve(dirname(fileURLToPath(import.meta.url)),'..'),root=join(app,'www')
assert.ok(existsSync(join(root,'grow/index.html')),'Growing Faith missing from web bundle')
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.woff2':'font/woff2','.ico':'image/x-icon'}
const server=createServer((req,res)=>{
 const raw=decodeURIComponent(new URL(req.url,'http://localhost').pathname)
 const p=raw==='/'?'index.html':raw.replace(/^\//,'')
 const candidates=[p,p.replace(/\/$/,'')+'/index.html',p+'.html']
 const found=candidates.find(v=>{const full=resolve(root,v);return full.startsWith(root+'/')&&existsSync(full)&&statSync(full).isFile()})
 if(!found){res.writeHead(404);res.end();return}
 res.writeHead(200,{'content-type':mime[extname(found)]||'application/octet-stream'});createReadStream(join(root,found)).pipe(res)
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const base='http://127.0.0.1:'+server.address().port
const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})
const out=join(app,'test-output');mkdirSync(out,{recursive:true})
try{
 for(const [width,height] of [[375,812],[768,1024],[1440,900]]){
  const context=await browser.newContext({viewport:{width,height}})
  await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort())
  const page=await context.newPage()
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  for(const [route,label] of [['/grow/','grow'],['/questions/','questions'],['/daily-sos.html','sos']]){
   const response=await page.goto(base+route,{waitUntil:'load'})
   assert.equal(response.status(),200,label+' is not served')
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true,label+' overflows at '+width+'px')
   assert.deepEqual(errors,[],label+' JS error at '+width+'px')
   if(label==='questions'){
    assert.equal(await page.locator('[data-question]').count(),15,'Questions must have 15 video cards')
    assert.equal(await page.locator('[data-group]').count(),5,'Questions must have five categories')
    if(width<=768){
     const gutter=await page.locator('.hero .wrap').evaluate(el=>({
       left:el.getBoundingClientRect().left,
       right:innerWidth-el.getBoundingClientRect().right,
       padLeft:parseFloat(getComputedStyle(el).paddingLeft),
       padRight:parseFloat(getComputedStyle(el).paddingRight)
     }))
     if(width<=375)assert.ok(gutter.padLeft>=20&&gutter.padRight>=20,'mobile hero gutter should be at least 20px')
     const heroText=await page.locator('.hero h1').boundingBox()
     assert.ok(heroText.x>=0&&heroText.x+heroText.width<=width+1,'hero headline is clipped at '+width)
     const feature=await page.locator('.hero-feature').boundingBox()
     if(width<=680)assert.ok(feature.x>=19&&feature.x+feature.width<=width-19,'featured video touches mobile edge at '+width+'; x='+feature.x+' width='+feature.width)
    }
    await page.locator('#question-search').fill('rise from the dead')
    assert.equal(await page.locator('[data-question]:visible').count(),1,'search should filter 15 cards')
    await page.locator('#question-search').fill('')
    await page.locator('[data-filter="Jesus & the Gospel"]').click()
    assert.equal(await page.locator('[data-question]:visible').count(),3,'Jesus category should have three topics')
   }
   if(label==='grow'){
    assert.equal(await page.locator('a[href="/questions/"]').count(),1)
    assert.equal(await page.locator('a[href="/daily-sos.html"]').count(),1)
   }
   if(label==='sos'){
    const layout=await page.locator('.shell').evaluate(el=>({
      width:el.getBoundingClientRect().width,
      radius:getComputedStyle(el).borderTopLeftRadius,
      border:getComputedStyle(el).borderTopWidth,
      left:el.getBoundingClientRect().left
    }))
    assert.ok(Math.abs(layout.width-width)<=2,'SOS should use full viewport width at '+width+'px: '+layout.width)
    assert.equal(layout.radius,'0px','SOS should not have an outer phone/card frame')
    assert.equal(layout.border,'0px','SOS outer shell border should be removed')
    assert.ok(Math.abs(layout.left)<=2,'SOS should not float as centered phone frame')
    assert.equal(await page.locator('#reading-panel').count(),1)
    assert.equal(await page.locator('#sos-panel').count(),1)
   }
   if(width===375||width===1440)await page.screenshot({path:join(out,'growing-faith-'+label+'-'+width+'.png'),fullPage:true})
  }
  if(width===375||width===1440){
   const detail=await page.goto(base+'/why-does-god-remain-so-hidden/',{waitUntil:'domcontentloaded'})
   assert.equal(detail.status(),200,'video question URL not served')
   assert.equal(await page.locator('iframe[src*="youtube-nocookie.com/embed/"]').count(),1,'video embed missing')
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true,'video page horizontal overflow at '+width)
   assert.equal(await page.locator('.q-questions li').count(),3,'question discussions missing')
   await page.screenshot({path:join(out,'growing-faith-video-question-'+width+'.png'),fullPage:true})
  }
  await context.close()
 }
 console.log('PASS Growing Faith responsive navigation and no-overflow audit (375, 768, 1440px)')
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
