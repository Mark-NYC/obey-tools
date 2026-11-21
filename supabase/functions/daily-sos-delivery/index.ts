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
 const manageUrl=projectUrl+"/functions/v1/daily-sos-delivery/manage?token="+encodeURIComponent(job.unsubscribe_id);
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
 '<a href="'+manageUrl+'" style="color:#007b4e;text-decoration:underline">Manage reminders</a> &nbsp;·&nbsp; '+
 '<a href="'+unsubUrl+'" style="color:#007b4e;text-decoration:underline">Unsubscribe</a></p>'+
 '</td></tr></table></td></tr></table></body></html>';
 const plain='Follow Daily · Day '+day+' of 365 · '+phase+'\n'+title+'\n'+reference+' (WEB Updated)\n\n'+
 verses.map(([v,t])=>v+' '+t).join('\n')+'\n\nTODAY’S DISCOVERY\n'+question+
 '\n\nOPEN TODAY’S SOS\n'+actionUrl+'\n\nManage: '+manageUrl+'\nUnsubscribe: '+unsubUrl;
 return {subject:'Day '+day+': '+title+' | Follow Daily',html,text:plain,unsubUrl};
}


const signupFrom="Follow Daily <daily@obey.tools>";
const emailCheck=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const htmlPage=(title:string,body:string)=>new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>'+escapeHtml(title)+'</title><main style="font:16px/1.6 Arial,sans-serif;max-width:490px;padding:30px 22px;margin:36px auto;color:#183626"><p style="font-weight:800;color:#007a4c">OBEY.TOOLS · FOLLOW DAILY</p><h1>'+escapeHtml(title)+'</h1>'+body+'</main></html>',{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"}});
function button(label:string){return '<button type="submit" style="display:block;border:0;border-radius:5px;background:#00a468;color:white;padding:14px 23px;font-weight:750;cursor:pointer">'+escapeHtml(label)+'</button>'}
function validToken(t:string){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(t)}
async function sendResend(to:string,subject:string,html:string,text:string,identity:string){
 const key=await resolvedResendToken();
 if(!key)throw Error("Sender not ready");
 const res=await fetch("https://api.resend.com/emails",{
  method:"POST",
  headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json","Idempotency-Key":identity},
  body:JSON.stringify({from:signupFrom,to:[to],subject,html,text})
 });
 if(!res.ok)throw Error("Resend rejected confirmation: "+res.status);
}
async function subscribe(req:Request){
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const length=Number(req.headers.get("content-length")||"0");
 if(length>4096)return json({error:"Request too large"},413);
 let body:Record<string,unknown>;
 try{body=await req.json()}catch{return json({error:"Invalid request"},400)}
 const email=String(body.email||"").trim().toLowerCase(),tz=String(body.timezone||"");
 const hour=Number(body.sendHour);
 if(email.length>254||!emailCheck.test(email)||tz.length>80||!Number.isInteger(hour)||hour<0||hour>23)return json({error:"Invalid preferences"},400);
 const {data:validZone}=await db.rpc("sos_valid_timezone",{p_timezone:tz});
 if(!validZone)return json({error:"Choose a valid time zone"},400);
 const ip=(req.headers.get("cf-connecting-ip")||req.headers.get("x-real-ip")||req.headers.get("x-forwarded-for")?.split(",")[0]||"unknown").trim().slice(0,100);
 const salt=Deno.env.get("SUPABASE_URL")||"daily-sos";
 async function fingerprint(input:string){
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(salt+":"+input));
  return Array.from(new Uint8Array(bytes)).map(b=>b.toString(16).padStart(2,"0")).join("");
 }
 const [ipKey,emailKey]=await Promise.all([fingerprint("ip:"+ip),fingerprint("email:"+email)]);
 const {data:allowIp,error:ipError}=await db.rpc("sos_signup_throttle",{p_fingerprint:"ip:"+ipKey,p_limit:12,p_interval:"1 hour"});
 const {data:allowEmail,error:emailError}=await db.rpc("sos_signup_throttle",{p_fingerprint:"email:"+emailKey,p_limit:3,p_interval:"24 hours"});
 if(ipError||emailError)return json({error:"Signup temporarily unavailable"},503);
 if(!allowIp||!allowEmail)return json({error:"Too many requests. Try again later."},429);
 const {data:pending,error:pendingError}=await db.from("sos_email_pending").upsert({
  email,timezone:tz,send_hour:hour,confirmation_token:crypto.randomUUID(),
  expires_at:new Date(Date.now()+24*3600*1000).toISOString(),
  requested_at:new Date().toISOString(),attempts:1
 },{onConflict:"email"}).select("confirmation_token").single();
 if(pendingError||!pending)return json({error:"Could not prepare confirmation"},503);
 const link=projectUrl+"/functions/v1/daily-sos-delivery/confirm?token="+encodeURIComponent(pending.confirmation_token);
 const copy='Confirm your Follow Daily emails by clicking below. Your first reading arrives tomorrow at your chosen time. If you did not request this, ignore the message.';
 const emailHtml='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div style="max-width:540px;margin:auto;padding:28px;color:#19372a;font-family:Arial,sans-serif"><strong>OBEY.TOOLS</strong><h1 style="font:700 29px Georgia,serif">One step to Follow Daily</h1><p>'+copy+'</p><p style="margin:28px 0"><a href="'+link+'" style="background:#00a468;color:#fff;padding:15px 22px;text-decoration:none;border-radius:4px">Confirm Daily Emails</a></p><p style="font-size:12px;color:#667268">This link expires in 24 hours. No account or password required.</p></div>';
 try{await sendResend(email,"Confirm your Follow Daily emails",emailHtml,copy+"\n\n"+link,"follow-daily-confirm-"+pending.confirmation_token)}
 catch(err){console.error("Follow Daily confirmation delivery failed",err instanceof Error?err.message:"error");return json({error:"Could not send confirmation right now"},503)}
 return json({ok:true,message:"Check your email to confirm."});
}
async function confirm(req:Request,url:URL){
 const token=url.searchParams.get("token")||"";
 if(!validToken(token))return htmlPage("Invalid confirmation link","<p>Request a new confirmation email from Follow Daily.");
 if(req.method==="GET")return htmlPage("Confirm daily emails",
  '<p>One click away from your first reading. No account or password needed.</p><form method="POST">'+button("Confirm Daily Emails")+'</form>');
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const {data:p,error}=await db.from("sos_email_pending").select("*").eq("confirmation_token",token).gt("expires_at",new Date().toISOString()).maybeSingle();
 if(error||!p)return htmlPage("Link expired","<p>That confirmation link is invalid or has expired. Please sign up again.</p>");
 const {data:existing,error:existingError}=await db.from("sos_email_subscriptions").select("id,status,next_day").eq("email",p.email).maybeSingle();
 if(existingError)return htmlPage("Try again","<p>Could not confirm right now. Please try again.</p>");
 let saveError;
 if(existing){
  // Proven control of this address. Preserve progress and linked user accounts.
  const r=await db.from("sos_email_subscriptions").update({timezone:p.timezone,send_hour:p.send_hour,status:existing.status==="completed"?"completed":"active"}).eq("id",existing.id);
  saveError=r.error;
 }else{
  const r=await db.from("sos_email_subscriptions").insert({email:p.email,timezone:p.timezone,send_hour:p.send_hour,status:"active",next_day:1});
  saveError=r.error;
 }
 if(saveError)return htmlPage("Try again","<p>We couldn't complete your signup. Please try the same confirmation link again.</p>");
 await db.from("sos_email_pending").delete().eq("confirmation_token",token);
 return htmlPage("You're subscribed!",'<p>Your Follow Daily journey is confirmed. '+(existing?.status==="completed"?"Your 365-day journey is already complete.":"Your next reading is scheduled for tomorrow morning at your chosen time.")+'</p><p><a href="https://obey.tools/daily-sos.html">Start reading now</a></p>');
}
async function manage(req:Request,url:URL){
 const token=url.searchParams.get("token")||"";
 if(!validToken(token))return htmlPage("Invalid link","<p>Use the Manage reminders link in a recent Follow Daily email.</p>");
 const {data:sub,error}=await db.from("sos_email_subscriptions").select("id,status,send_hour,timezone,next_day").eq("unsubscribe_token",token).maybeSingle();
 if(error||!sub)return htmlPage("Link not found","<p>This management link is no longer available.</p>");
 if(req.method==="GET"){
  const phase=sub.status==="active"?"Pause emails":"Resume emails";
  const desired=sub.status==="active"?"paused":"active";
  return htmlPage("Manage Follow Daily",
   '<p>Status: <strong>'+escapeHtml(sub.status)+'</strong>. Your place is saved at Day '+sub.next_day+'.</p>'+
   '<form method="POST"><input type="hidden" name="status" value="'+desired+'">'+button(phase)+'</form>'+
   '<form method="POST" style="margin-top:16px"><input type="hidden" name="status" value="stopped">'+button("Unsubscribe")+'</form>'+
   '<p><a href="https://obey.tools/daily-sos.html">Return to Follow Daily</a></p>');
 }
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const form=await req.formData();
 const next=String(form.get("status")||"");
 if(!["active","paused","stopped"].includes(next))return htmlPage("Invalid choice","<p>Use the controls in your email link.</p>");
 if(sub.status==="completed"&&next==="active")return htmlPage("Journey completed","<p>You've already completed this 365-day journey.</p>");
 const {error:saveError}=await db.from("sos_email_subscriptions").update({status:next}).eq("id",sub.id);
 if(saveError)return htmlPage("Try again","<p>Could not save your preference.</p>");
 return htmlPage(next==="active"?"Emails resumed":next==="paused"?"Emails paused":"Unsubscribed",
  '<p>Your preference was saved. Your Scripture responses are unchanged.</p><p><a href="https://obey.tools/daily-sos.html">Return to Follow Daily</a></p>');
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
  if(url.pathname.endsWith("/subscribe"))return await subscribe(req);
  if(url.pathname.endsWith("/confirm"))return await confirm(req,url);
  if(url.pathname.endsWith("/manage"))return await manage(req,url);
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
