// Daily SOS: authenticated per-subscriber emails, WEBU, no audience-wide broadcast.
// This function intentionally accepts public unsubscribe requests; dispatch is
// protected with a high-entropy secret held only in the database.
import { createClient } from "npm:@supabase/supabase-js@2.110.6";
import { readings } from "./readings.ts";
import { books } from "./scripture.ts";

type Item = [string, string, string, string, string];
type Job = { delivery_id:string; sub_id:string; recipient:string; day_no:number; tz:string; unsubscribe_id:string };
const projectUrl = Deno.env.get("SUPABASE_URL") || "";
const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const secretKey = keys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db = createClient(projectUrl, secretKey, {auth:{persistSession:false,autoRefreshToken:false}});
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, X-SOS-Cron-Secret"};
function escapeHtml(s:string){return String(s).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]||ch))}
function json(data:unknown,status=200){return Response.json(data,{status,headers:{"Cache-Control":"no-store",...cors}})}
function constantEqual(a:string,b:string) {
 const ea=new TextEncoder().encode(a),eb=new TextEncoder().encode(b);
 let out=ea.length^eb.length;
 for(let i=0;i<Math.max(ea.length,eb.length);i++)out|=(ea[i]||0)^(eb[i]||0);
 return out===0&&ea.length>=32;
}
function verseRange(ref:string):Array<[number,string]>{
 const m=ref.replace(/[–—]/g,"-").match(/^(.+?)\s+(\d+):(\d+)(?:-(?:(\d+):)?(\d+))?$/);
 if(!m)throw new Error("Invalid Scripture reference");
 const book=books[m[1] as keyof typeof books];
 if(!book)throw new Error("Book unavailable");
 const c0=Number(m[2]),v0=Number(m[3]),c1=m[4]?Number(m[4]):c0,v1=m[5]?Number(m[5]):v0;
 const output:Array<[number,string]>=[];
 for(let c=c0;c<=c1;c++)for(const [v,text] of (book as Record<string,Array<[number,string]>>)[String(c)]||[])
   if(v>=(c===c0?v0:1)&&v<=(c===c1?v1:Infinity))output.push([v,text]);
 if(!output.length)throw new Error("Reading has no verses");
 return output;
}
function emailFor(day:number, job:Job){
 const item=readings[day-1] as Item;
 if(!item)throw new Error("Day out of range");
 const [title,reference,,phase,question]=item;
 const verses=verseRange(reference);
 const actionUrl="https://obey.tools/daily-sos.html?day="+day;
 const unsubUrl=projectUrl+"/functions/v1/daily-sos-delivery/unsubscribe?token="+encodeURIComponent(job.unsubscribe_id);
 const scripture=verses.map(([v,text])=>'<sup style="font:700 11px Arial,sans-serif;color:#008250;margin-right:2px">'+v+'</sup>'+escapeHtml(text)).join(" ");
 const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'+
 '<body style="margin:0;background:#f3f4f5;font-family:Arial,Helvetica,sans-serif;color:#1c1c1e">'+
 '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:26px 12px">'+
 '<table role="presentation" width="580" cellspacing="0" cellpadding="0" style="width:100%;max-width:580px;background:#fff">'+
 '<tr><td style="text-align:center;padding:26px;border-bottom:2px solid #00a468;font-size:24px;font-weight:900;color:#08301f">OBEY.TOOLS</td></tr>'+
 '<tr><td style="padding:26px 28px 10px"><div style="font-size:12px;letter-spacing:1px;color:#008250;font-weight:700">DAY '+day+' OF 365 · '+escapeHtml(phase)+'</div>'+
 '<div style="background:#00a468;color:#fff;text-align:center;padding:16px;margin:16px 0;font-size:32px;font-weight:900">DAILY SOS</div>'+
 '<h1 style="font:700 31px/1.2 Georgia,serif;color:#08301f;margin:23px 0 5px">'+escapeHtml(title)+'</h1>'+
 '<p style="color:#747a75;font-size:14px;margin:6px 0 23px">'+escapeHtml(reference)+' · World English Bible Updated</p>'+
 '<div style="background:#fbf7f1;padding:23px;border-radius:6px;font:18px/1.8 Georgia,serif;color:#1f2e27">'+scripture+'</div>'+
 '<p style="font-size:11px;color:#747a75">World English Bible Updated (WEBU), public domain.</p>'+
 '<div style="background:#eff6f1;border-left:4px solid #00a468;padding:16px 18px;margin:24px 0"><strong style="color:#007b4e;font:700 12px Arial,sans-serif">TODAY’S DISCOVERY</strong>'+
 '<p style="font:18px/1.5 Georgia,serif;margin:8px 0 0">'+escapeHtml(question)+'</p></div>'+
 '<a href="'+actionUrl+'" style="display:block;background:#00a468;color:#fff;text-align:center;text-decoration:none;border-radius:5px;font-weight:800;padding:17px">OPEN TODAY’S SOS</a>'+
 '<p style="text-align:center;color:#6b756e;font-size:13px">Read · Say · Obey · Share</p></td></tr>'+
 '<tr><td style="text-align:center;border-top:1px solid #e8ece9;padding:22px;color:#67706a;font-size:12px">You chose to receive Daily SOS emails.<br>'+
 '<a href="https://obey.tools/daily-sos.html#email-reminders" style="color:#007b4e">Manage reminders</a> · <a href="'+unsubUrl+'" style="color:#007b4e">Unsubscribe</a></td></tr>'+
 '</table></td></tr></table></body></html>';
 const plain='Daily SOS · Day '+day+' of 365 · '+phase+'\n'+title+'\n'+reference+' (WEB Updated)\n\n'+
 verses.map(([v,t])=>v+' '+t).join('\n')+'\n\nTODAY’S DISCOVERY\n'+question+
 '\n\nOPEN TODAY’S SOS\n'+actionUrl+'\n\nManage: https://obey.tools/daily-sos.html#email-reminders\nUnsubscribe: '+unsubUrl;
 return {subject:'Day '+day+': '+title+' | Daily SOS',html,text:plain,unsubUrl};
}
async function unsubscribe(req:Request,url:URL){
 const token=url.searchParams.get("token")||"";
 if(!/^[a-f0-9-]{36}$/i.test(token))return new Response("Invalid link",{status:400});
 if(req.method==="GET"){
  const body='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Daily SOS emails</title>'+
  '<main style="font:16px/1.5 Arial,sans-serif;max-width:460px;margin:50px auto;padding:25px"><h1>Stop Daily SOS emails?</h1>'+
  '<p>Your saved Scripture reflections will stay intact.</p>'+
  '<form method="post"><button style="border:0;border-radius:8px;padding:14px 22px;background:#00a468;color:white;font-weight:bold">Unsubscribe</button></form>'+
  '<p><a href="https://obey.tools/daily-sos.html">Return to Daily SOS</a></p></main>';
  return new Response(body,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
 }
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const {data,error}=await db.from("sos_email_subscriptions").update({status:"stopped"}).eq("unsubscribe_token",token).select("id");
 if(error){console.error("unsubscribe failed",error.code);return json({error:"Unable to unsubscribe"},500)}
 return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main style="font:17px Arial,sans-serif;padding:45px;max-width:460px;margin:auto"><h1>Unsubscribed</h1><p>Daily SOS emails have stopped. Your saved reflections are unchanged.</p><a href="https://obey.tools/daily-sos.html">Daily SOS</a></main>',{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
}
Deno.serve(async (req)=>{
 try{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  const url=new URL(req.url);
  if(url.pathname.endsWith("/unsubscribe"))return await unsubscribe(req,url);
  if(url.pathname.endsWith("/health")&&req.method==="GET"){
   if(!secretKey)return json({ok:true,ready:false});
   const {data:state}=await db.from("sos_email_runtime").select("enabled").eq("singleton",true).maybeSingle();
   return json({ok:true,ready:!!state?.enabled});
  }
  if(req.method!=="POST"||!url.pathname.endsWith("/daily-sos-delivery"))return json({error:"Not found"},404);
  if(!secretKey)return json({error:"Server configuration unavailable"},503);
  const {data:runtime,error:runtimeError}=await db.from("sos_email_runtime").select("enabled,cron_secret,max_per_run").eq("singleton",true).single();
  if(runtimeError||!runtime)return json({error:"Service unavailable"},503);
  if(!constantEqual(req.headers.get("x-sos-cron-secret")||"",runtime.cron_secret))return json({error:"Forbidden"},403);
  if(!runtime.enabled)return json({ok:true,enabled:false,sent:0});
  const {data:resendToken,error:tokenError}=await db.rpc("sos_resend_token");
  if(tokenError||!resendToken)return json({error:"Sender credentials not configured"},503);
  const {data:due,error:claimError}=await db.rpc("sos_claim_due",{p_limit:runtime.max_per_run});
  if(claimError){console.error("claim failed",claimError.code);return json({error:"Queue unavailable"},503)}
  let sent=0,failed=0;
  for(const job of (due||[]) as Job[]){
   try{
    const message=emailFor(job.day_no,job);
    const res=await fetch("https://api.resend.com/emails",{
     method:"POST",
     headers:{"Authorization":"Bearer "+resendToken,"Content-Type":"application/json",
       "Idempotency-Key":"daily-sos-v1-"+job.sub_id+"-"+job.day_no},
     body:JSON.stringify({
      from:"Daily SOS <daily@obey.tools>",to:[job.recipient],subject:message.subject,
      html:message.html,text:message.text,
      headers:{"List-Unsubscribe":"<"+message.unsubUrl+">","List-Unsubscribe-Post":"List-Unsubscribe=One-Click"}
     })
    });
    const response=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error("Resend HTTP "+res.status+": "+String(response.message||"unknown error").slice(0,120));
    const {error:markError}=await db.rpc("sos_mark_sent",{p_id:job.delivery_id,p_provider_id:String(response.id||"")});
    if(markError)throw new Error("Sent but could not mark delivered: "+markError.code);
    sent++;
   }catch(error){
    failed++;
    const detail=error instanceof Error?error.message:String(error);
    console.error("Delivery failed",job.delivery_id,detail);
    await db.rpc("sos_mark_failed",{p_id:job.delivery_id,p_error:detail});
   }
  }
  return json({ok:true,enabled:true,claimed:(due||[]).length,sent,failed});
 }catch(e){console.error("Daily SOS exception",e instanceof Error?e.message:"unknown");return json({error:"Internal error"},500)}
});
