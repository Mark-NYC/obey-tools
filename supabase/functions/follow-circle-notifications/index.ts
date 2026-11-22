// Cron-only worker for opt-in Circle notifications. Not invoked from the browser.
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEYS),
// SOS_RESEND_API_KEY (or RESEND_API_KEY), CIRCLE_NOTIFY_CRON_SECRET.
// Schedule: every 5 minutes (?mode=immediate), Mondays 07:00 America/New_York (?mode=weekly).
import {createClient} from "npm:@supabase/supabase-js@2.110.6";
const env=(key:string)=>Deno.env.get(key)||"";
const keys=JSON.parse(env("SUPABASE_SECRET_KEYS")||"{}");
const url=env("SUPABASE_URL"),service=keys.default||env("SUPABASE_SERVICE_ROLE_KEY");
const resend=env("SOS_RESEND_API_KEY")||env("RESEND_API_KEY");
const cronSecret=env("CIRCLE_NOTIFY_CRON_SECRET");
const db=createClient(url,service,{auth:{persistSession:false}});
const from="Follow Daily <daily@obey.tools>";
const appUrl="https://obey.tools/follow-circles.html?circle=";
const safe=(v:string)=>v.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));
async function send(email:string,subject:string,message:string,link:string,idempotency:string){
 const html='<div style="font:16px/1.6 system-ui;color:#1b2720;max-width:520px;margin:auto"><h2>Follow Daily</h2><p>'+safe(message)+'</p><p><a style="background:#00774b;color:white;padding:12px 20px;border-radius:9px;text-decoration:none;display:inline-block" href="'+safe(link)+'">Open your Circle</a></p><p style="font-size:12px;color:#667267">You can change Circle email preferences in your Circle settings.</p></div>';
 const response=await fetch("https://api.resend.com/emails",{
  method:"POST",headers:{"Authorization":"Bearer "+resend,"Content-Type":"application/json","Idempotency-Key":idempotency},
  body:JSON.stringify({from,to:[email],subject,html,text:message+"\n"+link+"\nManage Circle emails in your Circle settings."})
 });
 if(!response.ok)throw Error("Resend delivery failed ("+response.status+")");
}
async function recipient(userId:string,circleId:string,kind:"reply"|"mention"|"digest"){
 const {data:member,error}=await db.from("follow_circle_members").select("email_replies,email_mentions,email_digest").eq("circle_id",circleId).eq("user_id",userId).maybeSingle();
 const pref=kind==="reply"?"email_replies":kind==="mention"?"email_mentions":"email_digest";
 if(error||!member||!member[pref])return null;
 const {data:circle}=await db.from("follow_circles").select("id,name,closed_at").eq("id",circleId).maybeSingle();
 if(!circle||circle.closed_at)return null;
 const {data:{user}}=await db.auth.admin.getUserById(userId);
 if(!user?.email)return null;
 return {email:user.email,circleName:circle.name};
}
async function immediate(){
 let sent=0,failed=0,skipped=0;
 const {data:queue,error}=await db.from("follow_circle_email_outbox").select("id,user_id,circle_id,post_id,kind,attempts").eq("status","pending").lte("retry_at",new Date().toISOString()).order("created_at").limit(60);
 if(error)throw error;
 for(const item of queue||[]){
  const {data:claimed}=await db.from("follow_circle_email_outbox").update({status:"sending"}).eq("id",item.id).eq("status","pending").select("id").maybeSingle();
  if(!claimed)continue;
  try{
   const r=await recipient(item.user_id,item.circle_id,item.kind);
   if(!r){skipped++;await db.from("follow_circle_email_outbox").update({status:"sent",sent_at:new Date().toISOString()}).eq("id",item.id);continue}
   const message=item.kind==="reply"?"Someone replied to your reflection in "+r.circleName+".":"Someone mentioned you in "+r.circleName+".";
   await send(r.email,item.kind==="reply"?"A reply in your Follow Daily Circle":"You were mentioned in Follow Daily",message,appUrl+encodeURIComponent(item.circle_id),"circle-"+item.id);
   const done=await db.from("follow_circle_email_outbox").update({status:"sent",sent_at:new Date().toISOString(),last_error:null}).eq("id",item.id);
   if(done.error)throw done.error;
   sent++;
  }catch(error){
   failed++;await db.from("follow_circle_email_outbox").update({status:"pending",attempts:item.attempts+1,retry_at:new Date(Date.now()+Math.min(60,item.attempts*5+5)*60000).toISOString(),last_error:String(error).slice(0,300)}).eq("id",item.id);
  }
 }
 return {sent,failed,skipped};
}
function priorMonday(){
 const d=new Date();d.setUTCHours(0,0,0,0);
 const offset=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-offset-7);return d.toISOString().slice(0,10);
}
async function weekly(){
 const week=priorMonday(),end=new Date(week+"T00:00:00Z");end.setUTCDate(end.getUTCDate()+7);
 let sent=0,failed=0,skipped=0,page=0;
 while(page<50){
  const {data:members,error}=await db.from("follow_circle_members").select("user_id,circle_id").eq("email_digest",true).order("joined_at").range(page*100,page*100+99);
  if(error)throw error;if(!members?.length)break;
  for(const m of members){
   const {count,error:countError}=await db.from("follow_circle_posts").select("id",{count:"exact",head:true}).eq("circle_id",m.circle_id).gte("created_at",week+"T00:00:00Z").lt("created_at",end.toISOString());
   if(countError){failed++;continue}if(!count){skipped++;continue}
   const {data:prior}=await db.from("follow_circle_digest_deliveries").select("status").eq("user_id",m.user_id).eq("circle_id",m.circle_id).eq("week_start",week).maybeSingle();
   if(prior?.status==="sent"){skipped++;continue}
   if(!prior){const x=await db.from("follow_circle_digest_deliveries").insert({user_id:m.user_id,circle_id:m.circle_id,week_start:week});if(x.error){failed++;continue}}
   try{
    const r=await recipient(m.user_id,m.circle_id,"digest");
    if(!r){skipped++;continue}
    await send(r.email,"Your Follow Daily Circle this week",count+" new Circle messages in "+r.circleName+" last week.",appUrl+encodeURIComponent(m.circle_id),"circle-digest-"+m.user_id+"-"+m.circle_id+"-"+week);
    await db.from("follow_circle_digest_deliveries").update({status:"sent",sent_at:new Date().toISOString()}).eq("user_id",m.user_id).eq("circle_id",m.circle_id).eq("week_start",week);sent++;
   }catch(_e){failed++}
  }
  if(members.length<100)break;page++;
 }
 return {sent,failed,skipped};
}
Deno.serve(async(req)=>{
 if(req.method!=="POST")return new Response("Method not allowed",{status:405});
 if(!cronSecret||!resend||!url||!service)return new Response("Notifications not configured",{status:503});
 if(req.headers.get("x-circle-cron-secret")!==cronSecret)return new Response("Unauthorized",{status:401});
 try{
  const mode=new URL(req.url).searchParams.get("mode");
  if(mode!=="immediate"&&mode!=="weekly")return new Response("Unknown mode",{status:400});
  const result=mode==="weekly"?await weekly():await immediate();
  return Response.json({ok:true,...result});
 }catch(e){return Response.json({error:String(e).slice(0,160)},{status:500})}
});
