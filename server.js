const express = require('express');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
// JSON is used for small site-state updates and work-sample uploads.
// Work samples support MP4/video demos and are limited to 100 MB per file in this version.
app.use(express.json({limit:'120mb'}));

const DATA_DIR = path.join(__dirname, 'Website Info');
const DATA_FILE = path.join(DATA_DIR, 'Website Information.json');
const OWNER_TXT_FILE = path.join(DATA_DIR, 'Owner Information.txt');
const CUSTOMER_TXT_FILE = path.join(DATA_DIR, 'Customer Information.txt');
const SAMPLE_DIR = path.join(DATA_DIR, 'Work Samples');
const SAMPLE_META_FILE = path.join(DATA_DIR, 'Work Samples.json');
fs.mkdirSync(DATA_DIR, {recursive:true});
fs.mkdirSync(SAMPLE_DIR, {recursive:true});

function load(){
  try{return JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));}
  catch(e){return {};}
}
function loadSamples(){
  try{return JSON.parse(fs.readFileSync(SAMPLE_META_FILE,'utf8'));}
  catch(e){return {};}
}
function saveSamples(x){fs.writeFileSync(SAMPLE_META_FILE,JSON.stringify(x,null,2),'utf8');}
function uniqBy(a,keyFn){
  const map=new Map();
  for(const item of Array.isArray(a)?a:[]){
    const k=String(keyFn(item)||'');
    if(!k) continue;
    map.set(k,item);
  }
  return [...map.values()];
}
function mergeCustomers(oldList,newList){
  return uniqBy([...(Array.isArray(oldList)?oldList:[]),...(Array.isArray(newList)?newList:[])],x=>x.id||String(x.email||'').trim().toLowerCase()+'|'+String(x.phone||'').trim());
}
function mergeOrders(oldList,newList){
  return uniqBy([...(Array.isArray(oldList)?oldList:[]),...(Array.isArray(newList)?newList:[])],x=>x.id||x.createdAt||crypto.randomUUID());
}
function mergeSkills(oldList,newList){
  return uniqBy([...(Array.isArray(oldList)?oldList:[]),...(Array.isArray(newList)?newList:[])],x=>x.id||String(x.name||'').trim().toLowerCase());
}
function mergeWorkSamples(oldList,newList){
  return uniqBy([...(Array.isArray(oldList)?oldList:[]),...(Array.isArray(newList)?newList:[])],x=>x.id||String(x.name||'').trim().toLowerCase()+'|'+String(x.created||'') );
}
function save(x){
  fs.writeFileSync(DATA_FILE, JSON.stringify(x,null,2),'utf8');
  writeSeparateTextFiles(x);
}
function cleanTextValue(v){
  if(v===null||v===undefined)return '';
  if(typeof v==='string' && /^data:image\//i.test(v.trim()))return '[image omitted]';
  if(Array.isArray(v))return v.map(cleanTextValue).join(' & ');
  if(typeof v==='object')return JSON.stringify(v,(k,val)=>{
    if(['logo','card','image','imageData','base64','data'].includes(String(k)))return undefined;
    if(typeof val==='string'&&/^data:image\//i.test(val.trim()))return undefined;
    return val;
  });
  return String(v);
}
function textBlock(arr){
  if(!Array.isArray(arr)||!arr.length)return 'No records.';
  return arr.map((r,i)=>{
    if(r&&typeof r==='object')return 'Record '+(i+1)+'\n'+Object.entries(r)
      .filter(([k])=>!['logo','card','image','imageData','base64','data'].includes(k))
      .map(([k,v])=>k+': '+cleanTextValue(v)).join('\n');
    return 'Record '+(i+1)+': '+cleanTextValue(r);
  }).join('\n\n');
}
function dateParts(state){
  const d=new Date(state?.updatedAt||Date.now());
  return {date:d.toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'}),year:d.getFullYear(),month:d.toLocaleDateString('en-IN',{month:'long'})};
}
function ownerText(siteId,state){
  const p=dateParts(state),o=state.owner||{},wi=state.websiteInformation||{},om=wi.ownerMode||{};
  const names=Array.isArray(o.names)?o.names.filter(Boolean).join(' & '):(o.names||'');
  const skills=Array.isArray(state.skills)?state.skills:[];
  const samples=Array.isArray(state.workSamples)?state.workSamples:[];
  const history=Array.isArray(om.passwordHistory)?om.passwordHistory:[];
  return [
    'HEMANT HARDIK MULTISKILL TECHNICIAN','OWNER INFORMATION','Website ID: '+siteId,
    'Last Updated: '+p.date,'Year: '+p.year,'Month: '+p.month,'',
    '============================================================',
    'Owner Mode Details( '+p.date+' )','============================================================',
    'Company: '+cleanTextValue(o.company||''),'Owner Name: '+cleanTextValue(names),
    'Owner Phone Number: '+cleanTextValue(o.phone||''),'Owner Gmail ID: '+cleanTextValue(o.email||''),'',
    '--- SKILL FRAMES ---',textBlock(skills),'',
    '--- OWNER DETAILS HISTORY ---',textBlock(om.ownerDetailsHistory||[]),'',
    '--- CHANGE OWNER HISTORY ---',textBlock(om.changeOwnerHistory||[]),'',
    '--- OWNER SEARCH PASSWORD HISTORY ---',textBlock(history),'',
    '--- SHARED WORK SAMPLE LIST ---',textBlock(samples),'',
    'NOTE: Image/logo/card binary data is intentionally not stored in this text file.',
    '============================================================'
  ].join('\n');
}
function customerText(siteId,state){
  const p=dateParts(state),cm=(state.websiteInformation||{}).customerMode||{};
  const customers=Array.isArray(state.customers)?state.customers:[];
  const orders=Array.isArray(state.orders)?state.orders:[];
  const samples=Array.isArray(state.workSamples)?state.workSamples:[];
  return [
    'HEMANT HARDIK MULTISKILL TECHNICIAN','CUSTOMER INFORMATION','Website ID: '+siteId,
    'Last Updated: '+p.date,'Year: '+p.year,'Month: '+p.month,'',
    '============================================================',
    'Customer Mode Details( '+p.date+' )','============================================================',
    '--- CUSTOMER ACCOUNTS ---',textBlock(customers),'',
    '--- SIGN UP DETAILS ---',textBlock(cm.signupHistory||[]),'',
    '--- LOGIN DETAILS ---',textBlock(cm.loginHistory||[]),'',
    '--- ORDERS / ORDER STATUS / CUSTOMER MESSAGES ---',textBlock(orders),'',
    '--- WORK SAMPLES AVAILABLE TO CUSTOMERS ---',textBlock(samples),'',
    'NOTE: Image/logo/card binary data is intentionally not stored in this text file.',
    '============================================================'
  ].join('\n');
}
function writeSeparateTextFiles(all){
  const ownerBlocks=[],customerBlocks=[];
  for(const [siteId,state] of Object.entries(all||{})){
    ownerBlocks.push(ownerText(siteId,state));
    customerBlocks.push(customerText(siteId,state));
  }
  fs.writeFileSync(OWNER_TXT_FILE,ownerBlocks.join('\n\n'),'utf8');
  fs.writeFileSync(CUSTOMER_TXT_FILE,customerBlocks.join('\n\n'),'utf8');
}

function mergeState(oldState, incoming, event){
  const old=oldState||{};
  const ev=String(event||'update');
  const next={...old,siteId:incoming.siteId,updatedAt:new Date().toISOString()};
  const legacySkillsPresent=Array.isArray(old.skills)&&old.skills.length>0;
  next.skillsInitialized=old.skillsInitialized===true||legacySkillsPresent;

  if(['owner_details_updated','owner_changed','owner_password_changed'].includes(ev)){
    if(incoming.owner)next.owner=incoming.owner;
    if(incoming.ownerPassword)next.ownerPassword=incoming.ownerPassword;
  }
  if(Array.isArray(incoming.skills)&&(ev==='skill_updated'||ev==='skill_bootstrap')){
    next.skills=uniqBy(incoming.skills,x=>x.id||String(x.name||'').trim().toLowerCase());
    next.skillsInitialized=true;
  }else if(Array.isArray(incoming.skills)&&['owner_details_updated','owner_changed','local_update','update'].includes(ev)&&!Array.isArray(old.skills)){
    next.skills=mergeSkills([],incoming.skills);next.skillsInitialized=next.skills.length>0;
  }

  if(ev==='order_status_updated' && incoming.order && incoming.order.id){
    const list=mergeOrders(old.orders,[]);
    const idx=list.findIndex(x=>String(x.id)===String(incoming.order.id));
    if(idx>=0)list[idx]={...list[idx],...incoming.order};else list.push(incoming.order);
    next.orders=list;
  }else if(Array.isArray(incoming.orders)){
    next.orders=mergeOrders(old.orders,incoming.orders);
  }
  if(Array.isArray(incoming.customers))next.customers=mergeCustomers(old.customers,incoming.customers);
  if(Array.isArray(incoming.workSamples))next.workSamples=mergeWorkSamples(old.workSamples,incoming.workSamples);

  if(incoming.websiteInformation){
    const oi=old.websiteInformation||{},ni=incoming.websiteInformation||{};
    next.websiteInformation={...oi,...ni,updatedAt:new Date().toISOString()};
    next.websiteInformation.ownerMode={...(oi.ownerMode||{}),...(ni.ownerMode||{})};
    next.websiteInformation.customerMode={...(oi.customerMode||{}),...(ni.customerMode||{})};
    next.websiteInformation.customerMode.customers=mergeCustomers(oi.customerMode?.customers,ni.customerMode?.customers||next.customers);
    next.websiteInformation.customerMode.orders=mergeOrders(oi.customerMode?.orders,ni.customerMode?.orders||next.orders);
    next.websiteInformation.customerMode.workSamples=mergeWorkSamples(oi.customerMode?.workSamples,ni.customerMode?.workSamples||next.workSamples);
    for(const k of ['signupHistory','loginHistory']){
      const a=[...(Array.isArray(oi.customerMode?.[k])?oi.customerMode[k]:[]),...(Array.isArray(ni.customerMode?.[k])?ni.customerMode[k]:[])];
      next.websiteInformation.customerMode[k]=uniqBy(a,x=>x.timestamp+'|'+(x.email||x.phone||x.name||''));
    }
  }
  return next;
}

function transporter(){
  const user=process.env.OWNER_GMAIL_USER;
  const pass=process.env.OWNER_GMAIL_APP_PASSWORD;
  if(!user||!pass)return null;
  return nodemailer.createTransport({service:'gmail',auth:{user,pass}});
}

function persistOrderAndCustomer(siteId,order,customer,state){
  if(!siteId)return;
  const all=load();
  const incoming={siteId,state:state||{},customers:[],orders:[]};
  if(customer) incoming.customers=[customer];
  if(order) incoming.orders=[order];
  const merged=mergeState(all[siteId],incoming,'new_skill_order');
  all[siteId]=merged;
  save(all);
}

app.get('/api/health',(req,res)=>res.json({ok:true,service:'multiskill-technician-backend'}));

app.post('/api/customer-signup',(req,res)=>{
  try{
    const {siteId,customer,state}=req.body||{};
    if(!siteId||!customer)return res.status(400).json({ok:false,error:'Missing siteId/customer'});
    const all=load();
    const old=all[siteId]||{siteId,customers:[],orders:[],skills:[],workSamples:[]};
    const incomingState=state||{};
    const merged=mergeState(old,{...incomingState,siteId,customers:[customer]},'customer_signup');
    merged.customers=mergeCustomers(old.customers,[customer]);
    merged.websiteInformation=merged.websiteInformation||{};
    merged.websiteInformation.customerMode=merged.websiteInformation.customerMode||{};
    merged.websiteInformation.customerMode.customers=merged.customers;
    const hist=Array.isArray(merged.websiteInformation.customerMode.signupHistory)?merged.websiteInformation.customerMode.signupHistory:[];
    merged.websiteInformation.customerMode.signupHistory=uniqBy([...hist,{...customer,event:'signup',timestamp:new Date().toISOString()}],x=>x.timestamp+'|'+(x.email||x.phone||x.name||''));
    all[siteId]=merged;save(all);
    res.json({ok:true,state:merged});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}
});

app.post('/api/order-status',(req,res)=>{
  try{
    const {siteId,orderId,status}=req.body||{};
    const allowed=['pending','working','completed','cancelled'];
    if(!siteId||!orderId||!allowed.includes(String(status)))return res.status(400).json({ok:false,error:'Invalid siteId/orderId/status'});
    const all=load(),st=all[siteId];
    if(!st)return res.status(404).json({ok:false,error:'Website state not found'});
    const list=Array.isArray(st.orders)?st.orders:[];
    const idx=list.findIndex(o=>String(o.id)===String(orderId));
    if(idx<0)return res.status(404).json({ok:false,error:'Order not found'});
    const now=new Date().toISOString();
    const msg=String(status)==='cancelled'?'Skill canceled by owner':String(status)==='completed'?'Order completed':String(status)==='working'?'Order is in work':'Order is pending';
    list[idx]={...list[idx],status:String(status),statusChangedAt:now,statusMessage:msg};
    st.orders=list;st.updatedAt=now;
    st.websiteInformation=st.websiteInformation||{};st.websiteInformation.customerMode=st.websiteInformation.customerMode||{};st.websiteInformation.customerMode.orders=list;
    all[siteId]=st;save(all);
    res.json({ok:true,state:st,order:list[idx]});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}
});

app.post('/api/owner-password/verify',(req,res)=>{
  try{
    const {siteId,password}=req.body||{};
    if(!siteId||!password)return res.status(400).json({ok:false,error:'Missing siteId/password'});
    const all=load();
    const st=all[siteId]||{};
    const configured=process.env.OWNER_MODE_PASSWORD||st.ownerPassword||'multiskilltechnicianHH';
    if(String(password)!==String(configured))return res.status(401).json({ok:false,error:'Incorrect owner password'});
    res.json({ok:true});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}
});

app.post('/api/owner-password',(req,res)=>{
  try{
    const {siteId,currentPassword,newPassword}=req.body||{};
    if(!siteId||!currentPassword||!newPassword||String(newPassword).length<6)return res.status(400).json({ok:false,error:'Invalid password fields'});
    const all=load();const st=all[siteId]||{siteId,customers:[],orders:[],skills:[],workSamples:[]};
    const configured=process.env.OWNER_MODE_PASSWORD||st.ownerPassword||'multiskilltechnicianHH';
    if(String(currentPassword)!==String(configured))return res.status(401).json({ok:false,error:'Current password is incorrect'});
    const now=new Date().toISOString();
    st.ownerPassword=String(newPassword);
    st.updatedAt=now;
    st.websiteInformation=st.websiteInformation||{};st.websiteInformation.ownerMode=st.websiteInformation.ownerMode||{};
    const hist=Array.isArray(st.websiteInformation.ownerMode.passwordHistory)?st.websiteInformation.ownerMode.passwordHistory:[];
    hist.push({changedAt:now,action:'Owner Search Password Changed',oldPassword:String(currentPassword),newPassword:String(newPassword)});
    st.websiteInformation.ownerMode.passwordHistory=hist;
    all[siteId]=st;save(all);
    res.json({ok:true,updatedAt:now,password:String(newPassword),state:st});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}
});

app.post('/api/send-owner-email', async (req,res)=>{
  try{
    const {to,subject,body,htmlBody,siteId,order,customer,state}=req.body||{};
    if(!to||!subject||!body)return res.status(400).json({ok:false,error:'Missing email fields'});

    // Save the order/customer on the backend before attempting email delivery.
    if(siteId && (order||customer)) persistOrderAndCustomer(siteId,order,customer,state);

    const mailer=transporter();
    if(!mailer)return res.status(503).json({ok:false,saved:true,error:'Gmail SMTP is not configured on the server'});

    // Gmail SMTP authenticates as OWNER_GMAIL_USER. The customer's Gmail is
    // placed in Reply-To so replying from the owner's inbox goes to the customer.
    // Gmail may rewrite an arbitrary From address, so the authenticated sender
    // is intentionally kept as the business Gmail.
    const customerEmail=String(customer?.email||order?.customerEmail||'').trim();
    await mailer.sendMail({
      from:process.env.OWNER_GMAIL_USER,
      to,
      replyTo:customerEmail||undefined,
      subject,
      text:body,
      html:htmlBody||undefined,
      headers:customerEmail?{'X-Customer-Gmail':customerEmail}:undefined
    });
    res.json({ok:true,saved:true,replyTo:customerEmail||null});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}
});

app.post('/api/site-sync',(req,res)=>{
  try{
    const {siteId,event,state,order}=req.body||{};
    if(!siteId||!state)return res.status(400).json({ok:false,error:'Missing siteId/state'});
    const all=load();
    all[siteId]=mergeState(all[siteId],{...state,siteId,order},String(event||'update'));
    save(all);
    res.json({ok:true,updatedAt:all[siteId].updatedAt,state:all[siteId]});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}
});

app.get('/api/site-sync',(req,res)=>{
  res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
  const siteId=String(req.query.siteId||'');
  if(!siteId)return res.status(400).json({ok:false,error:'Missing siteId'});
  const all=load();
  const stored=all[siteId];
  const state=stored||{siteId,customers:[],orders:[],workSamples:[],skillsInitialized:false};
  // Do not return an empty skills array until the owner has explicitly
  // initialized the shared skill list; older frontend builds otherwise treat
  // the empty array as an instruction to erase their built-in skill frames.
  if(state.skillsInitialized!==true && (!Array.isArray(state.skills)||state.skills.length===0)) delete state.skills;
  const samples=loadSamples()[siteId]||[];
  state.workSamples=mergeWorkSamples(state.workSamples,samples);
  res.json({ok:true,siteId,state});
});

app.get('/api/work-samples',(req,res)=>{
  res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
  const siteId=String(req.query.siteId||'');
  if(!siteId)return res.status(400).json({ok:false,error:'Missing siteId'});
  const all=loadSamples();
  res.json({ok:true,siteId,workSamples:all[siteId]||[]});
});

app.post('/api/work-samples',async(req,res)=>{
  try{
    const {siteId,id,name,type,size,created,data}=req.body||{};
    if(!siteId||!name||!data)return res.status(400).json({ok:false,error:'Missing work-sample fields'});
    const raw=String(data).replace(/^data:[^;]+;base64,/,'');
    const approx=Math.floor(raw.length*0.75);
    if(approx>100*1024*1024)return res.status(413).json({ok:false,error:'Work sample is larger than 100 MB'});
    const safeId=String(id||crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g,'_');
    const safeName=String(name).replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,160);
    const fileName=safeId+'-'+safeName;
    const filePath=path.join(SAMPLE_DIR,fileName);
    fs.writeFileSync(filePath,Buffer.from(raw,'base64'));
    const normalizedType=(String(type||'').toLowerCase()==='video/mp4'||/\.mp4$/i.test(safeName))?'video/mp4':String(type||'application/octet-stream');
    const item={id:safeId,name:safeName,type:normalizedType,size:Number(size||approx),created:Number(created||Date.now()),fileName};
    const bySite=loadSamples();
    bySite[siteId]=mergeWorkSamples(bySite[siteId], [item]);
    saveSamples(bySite);

    const all=load();
    const st=all[siteId]||{siteId,customers:[],orders:[],skills:[],workSamples:[]};
    st.workSamples=mergeWorkSamples(st.workSamples,[item]);
    st.updatedAt=new Date().toISOString();
    all[siteId]=st;
    save(all);
    res.json({ok:true,item});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}
});

app.get('/api/work-samples/file/:id',(req,res)=>{
  const id=String(req.params.id||'').replace(/[^a-zA-Z0-9_-]/g,'_');
  const bySite=loadSamples();
  let item=null;
  for(const arr of Object.values(bySite)){
    item=(arr||[]).find(x=>String(x.id)===id);
    if(item)break;
  }
  if(!item)return res.status(404).send('Work sample not found');
  const filePath=path.join(SAMPLE_DIR,item.fileName);
  if(!fs.existsSync(filePath))return res.status(404).send('Work sample file not found');
  res.set('Content-Type',item.type||'application/octet-stream');
  res.set('Content-Disposition',`inline; filename="${String(item.name).replace(/"/g,'') }"`);
  res.sendFile(filePath);
});

app.delete('/api/work-samples/:id', (req,res)=>{
  try{
    const id=String(req.params.id||'');
    const bySite=loadSamples();
    let removed=null;
    for(const siteId of Object.keys(bySite)){
      const arr=bySite[siteId]||[];
      const item=arr.find(x=>String(x.id)===id);
      if(item){
        removed={siteId,item};
        bySite[siteId]=arr.filter(x=>String(x.id)!==id);
        break;
      }
    }
    if(!removed)return res.status(404).json({ok:false,error:'Work sample not found'});
    saveSamples(bySite);
    const fp=path.join(SAMPLE_DIR,removed.item.fileName||'');
    if(fs.existsSync(fp))fs.unlinkSync(fp);
    const all=load();
    if(all[removed.siteId]){
      all[removed.siteId].workSamples=(all[removed.siteId].workSamples||[]).filter(x=>String(x.id)!==id);
      all[removed.siteId].updatedAt=new Date().toISOString();
      save(all);
    }
    res.json({ok:true});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}
});

app.get('/api/owner-information.txt',(req,res)=>{
  try{
    const siteId=String(req.query.siteId||'');
    const all=load();
    const state=siteId?(all[siteId]||{}):Object.values(all)[0]||{};
    const text=ownerText(siteId||state.siteId||'HH-MULTISKILL-TECHNICIAN-SHARED',state);
    res.set('Content-Type','text/plain; charset=utf-8');
    res.set('Content-Disposition','attachment; filename=\"Owner Information.txt\"');
    res.send(text);
  }catch(e){res.status(500).type('text/plain').send(String(e.message||e));}
});

app.use(express.static(__dirname));
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
