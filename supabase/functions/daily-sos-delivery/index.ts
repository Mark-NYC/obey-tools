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
// Accept a sender credential from Supabase Edge Function Secrets, where a
// project owner may have installed it, before falling back to Database Vault.
// Never send or log the credential except as the HTTPS Resend bearer token.
function environmentResendToken():string {
 return Deno.env.get("SOS_RESEND_API_KEY") ||
        Deno.env.get("RESEND_API_KEY") ||
        Deno.env.get("sos_resend_api_key") || "";
}
async function resolvedResendToken():Promise<string> {
 const token=environmentResendToken();
 if(token)return token;
 const {data,error}=await db.rpc("sos_resend_token");
 return error?"":String(data||"");
}
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
 // Editorial reading layout: Scripture sits directly on the page, never in a
 // separate colored panel. Short paragraphs make long passages easy to read.
 const verseHtml=verses.map(([v,content])=>
  '<sup style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1;color:#008850;font-weight:700;vertical-align:super;margin-right:3px">'+v+'</sup>'+
  escapeHtml(content)
 );
 const paragraphs:string[]=[];
 for(let i=0;i<verseHtml.length;i+=5){
  paragraphs.push('<p style="font-family:Georgia,Times New Roman,serif;font-size:18px;line-height:1.85;margin:0 0 20px;color:#252b28">'+
   verseHtml.slice(i,i+5).join(" ")+'</p>');
 }
 const html='<!doctype html><html lang="en"><head><meta charset="utf-8">'+
 '<meta name="viewport" content="width=device-width,initial-scale=1">'+
 '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">'+
 '<style>:root{color-scheme:light}body{margin:0;padding:0}'+
 '@media screen and (max-width:600px){.reading-pad{padding-left:23px!important;padding-right:23px!important}.reading-title{font-size:30px!important}}'+
 '</style></head>'+
 '<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#252b28">'+
 '<div style="display:none;font-size:1px;color:#fff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">'+
 escapeHtml(reference)+' · A reading and a simple question for today.</div>'+
 '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff">'+
 '<tr><td align="center" style="padding:0">'+
 '<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff">'+
 '<tr><td class="reading-pad" style="padding:34px 38px 20px;border-bottom:1px solid #d8e6dc">'+
 '<span style="font:800 22px/1 Arial,Helvetica,sans-serif;letter-spacing:-1px;color:#08301f">OBEY<span style="color:#00a468">.</span>TOOLS</span>'+
 '</td></tr>'+
 '<tr><td class="reading-pad" style="padding:29px 38px 0">'+
 '<p style="margin:0 0 13px;font:700 12px/1.5 Arial,Helvetica,sans-serif;letter-spacing:1.3px;color:#007c4a">FOLLOW DAILY &nbsp;·&nbsp; DAY '+day+' OF 365 &nbsp;·&nbsp; '+escapeHtml(phase)+'</p>'+
 '<h1 class="reading-title" style="font:700 35px/1.2 Georgia,Times New Roman,serif;color:#08301f;letter-spacing:-.6px;margin:0 0 10px">'+escapeHtml(title)+'</h1>'+
 '<p style="margin:0 0 28px;font:14px/1.5 Arial,Helvetica,sans-serif;color:#68746c">'+escapeHtml(reference)+' &nbsp;·&nbsp; WEB Updated</p>'+
 paragraphs.join("")+
 '<p style="margin:0 0 28px;font:11px/1.5 Arial,Helvetica,sans-serif;color:#748078">World English Bible Updated (WEBU), public domain.</p>'+
 '<div style="border-left:3px solid #00a468;padding:2px 0 2px 17px;margin:16px 0 29px">'+
 '<p style="font:700 12px/1.4 Arial,Helvetica,sans-serif;color:#007c4a;letter-spacing:1px;margin:0 0 8px">TODAY’S DISCOVERY</p>'+
 '<p style="font:18px/1.55 Georgia,Times New Roman,serif;color:#243b2d;margin:0">'+escapeHtml(question)+'</p></div>'+
 '<a href="'+actionUrl+'" style="display:block;text-align:center;text-decoration:none;background:#00a468;color:#ffffff;border-radius:4px;font:700 15px/1.4 Arial,Helvetica,sans-serif;padding:15px 18px">OPEN TODAY’S SOS</a>'+
 '<p style="font:13px/1.6 Arial,Helvetica,sans-serif;text-align:center;color:#6d7971;margin:11px 0 34px">Read · Say · Obey · Share</p>'+
 '</td></tr>'+
 '<tr><td class="reading-pad" style="padding:21px 38px 30px;border-top:1px solid #e4eae6">'+
 '<p style="font:12px/1.7 Arial,Helvetica,sans-serif;text-align:center;color:#748078;margin:0">You chose to receive Follow Daily emails.<br>'+
 '<a href="https://obey.tools/daily-sos.html#email-reminders" style="color:#007b4e;text-decoration:underline">Manage reminders</a> &nbsp;·&nbsp; '+
 '<a href="'+unsubUrl+'" style="color:#007b4e;text-decoration:underline">Unsubscribe</a></p>'+
 '</td></tr></table></td></tr></table></body></html>';
 const plain='Follow Daily · Day '+day+' of 365 · '+phase+'\n'+title+'\n'+reference+' (WEB Updated)\n\n'+
 verses.map(([v,t])=>v+' '+t).join('\n')+'\n\nTODAY’S DISCOVERY\n'+question+
 '\n\nOPEN TODAY’S SOS\n'+actionUrl+'\n\nManage: https://obey.tools/daily-sos.html#email-reminders\nUnsubscribe: '+unsubUrl;
 return {subject:'Day '+day+': '+title+' | Follow Daily',html,text:plain,unsubUrl};
}

async function unsubscribe(req:Request,url:URL){
 const token=url.searchParams.get("token")||"";
 if(!/^[a-f0-9-]{36}$/i.test(token))return new Response("Invalid link",{status:400});
 if(req.method==="GET"){
  const body='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Follow Daily emails</title>'+
  '<main style="font:16px/1.5 Arial,sans-serif;max-width:460px;margin:50px auto;padding:25px"><h1>Stop Follow Daily emails?</h1>'+
  '<p>Your saved Scripture reflections will stay intact.</p>'+
  '<form method="post"><button style="border:0;border-radius:8px;padding:14px 22px;background:#00a468;color:white;font-weight:bold">Unsubscribe</button></form>'+
  '<p><a href="https://obey.tools/daily-sos.html">Return to Follow Daily</a></p></main>';
  return new Response(body,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
 }
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const {data,error}=await db.from("sos_email_subscriptions").update({status:"stopped"}).eq("unsubscribe_token",token).select("id");
 if(error){console.error("unsubscribe failed",error.code);return json({error:"Unable to unsubscribe"},500)}
 return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main style="font:17px Arial,sans-serif;padding:45px;max-width:460px;margin:auto"><h1>Unsubscribed</h1><p>Follow Daily emails have stopped. Your saved reflections are unchanged.</p><a href="https://obey.tools/daily-sos.html">Follow Daily</a></main>',{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
}
Deno.serve(async (req)=>{
 try{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  const url=new URL(req.url);
  if(url.pathname.endsWith("/unsubscribe"))return await unsubscribe(req,url);
  if(url.pathname.endsWith("/health")&&req.method==="GET"){
   if(!secretKey)return json({ok:true,ready:false});
   const {data:state}=await db.from("sos_email_runtime").select("enabled").eq("singleton",true).maybeSingle();
   if(!state?.enabled)return json({ok:true,ready:false});
   const token=await resolvedResendToken();
   return json({ok:true,ready:!!token});
  }
  if(url.pathname.endsWith("/diagnostic")&&req.method==="GET"){
   // Diagnostic only for the authenticated scheduler. Never output key material.
   const {data:runtime}=await db.from("sos_email_runtime")
     .select("cron_secret,enabled").eq("singleton",true).maybeSingle();
   if(!runtime||!constantEqual(req.headers.get("x-sos-cron-secret")||"",runtime.cron_secret))
     return json({error:"Forbidden"},403);
   return json({ok:true,enabled:runtime.enabled,edgeSecretPresent:!!environmentResendToken(),
     senderConfigured:!!(await resolvedResendToken())});
  }
  if(req.method!=="POST"||!url.pathname.endsWith("/daily-sos-delivery"))return json({error:"Not found"},404);
  if(!secretKey)return json({error:"Server configuration unavailable"},503);
  const {data:runtime,error:runtimeError}=await db.from("sos_email_runtime").select("enabled,cron_secret,max_per_run").eq("singleton",true).single();
  if(runtimeError||!runtime)return json({error:"Service unavailable"},503);
  if(!constantEqual(req.headers.get("x-sos-cron-secret")||"",runtime.cron_secret))return json({error:"Forbidden"},403);
  if(!runtime.enabled)return json({ok:true,enabled:false,sent:0});
  const resendToken=await resolvedResendToken();
  if(!resendToken)return json({error:"Sender credentials not configured"},503);
  const {data:due,error:claimError}=await db.rpc("sos_claim_due",{p_limit:runtime.max_per_run});
  if(claimError){console.error("claim failed",claimError.code);return json({error:"Queue unavailable"},503)}
  let sent=0,failed=0;
  for(const job of (due||[]) as Job[]){
   try{
    const {data:subscription,error:subscriptionError}=await db.from("sos_email_subscriptions")
      .select("status,next_day").eq("id",job.sub_id).single();
    if(subscriptionError||subscription?.status!=="active"||subscription?.next_day!==job.day_no){
      await db.rpc("sos_mark_failed",{p_id:job.delivery_id,p_error:"Subscription was paused, stopped, or advanced before dispatch"});
      continue;
    }
    const message=emailFor(job.day_no,job);
    const res=await fetch("https://api.resend.com/emails",{
     method:"POST",
     headers:{"Authorization":"Bearer "+resendToken,"Content-Type":"application/json",
       "Idempotency-Key":"daily-sos-v1-"+job.sub_id+"-"+job.day_no},
     body:JSON.stringify({
      from:"Follow Daily <daily@obey.tools>",to:[job.recipient],subject:message.subject,
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
