const express = require('express');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
// JSON is used for small site-state updates and work-sample uploads.
// Work samples are limited to 20 MB per file in this version.
app.use(express.json({limit:'30mb'}));

const DATA_DIR = path.join(__dirname, 'Website Info');
const DATA_FILE = path.join(DATA_DIR, 'Website Information.json');
const TXT_FILE = path.join(DATA_DIR, 'Website Information.txt');
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
  writeText(x);
}
function writeText(all){
  const blocks=[];
  for(const [siteId,state] of Object.entries(all||{})){
    const d=new Date(state.updatedAt||Date.now());
    const date=d.toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'});
    blocks.push('============================================================');
    blocks.push(`WEBSITE: ${siteId}`);
    blocks.push('============================================================');
    blocks.push(`Owner Mode Details( ${date} )`);
    blocks.push('------------------------------------------------------------');
    blocks.push('Current Owner:');
    blocks.push(JSON.stringify(state.owner||{},null,2));
    blocks.push('Owner Password: [stored securely on server]');
    blocks.push('');
    blocks.push(`Customer Mode Details( ${date} )`);
    blocks.push('------------------------------------------------------------');
    blocks.push('Customers:');
    blocks.push(JSON.stringify(state.customers||[],null,2));
    blocks.push('Orders:');
    blocks.push(JSON.stringify(state.orders||[],null,2));
    blocks.push('Skills:');
    blocks.push(JSON.stringify(state.skills||[],null,2));
    blocks.push('Work Samples:');
    blocks.push(JSON.stringify(state.workSamples||[],null,2));
    blocks.push('');
  }
  fs.writeFileSync(TXT_FILE, blocks.join('\n'),'utf8');
}
function mergeState(oldState, incoming, event){
  const old=oldState||{};
  const next={...old,siteId:incoming.siteId,updatedAt:new Date().toISOString()};
  const ev=String(event||'update');

  // Owner information is authoritative when it is explicitly changed.
  if(['owner_details_updated','owner_changed','owner_password_changed'].includes(ev)){
    if(incoming.owner) next.owner=incoming.owner;
    if(incoming.ownerPassword) next.ownerPassword=incoming.ownerPassword;
  }
  if(Array.isArray(incoming.skills) && ['skill_updated','owner_details_updated','owner_changed','local_update','update'].includes(ev)){
    next.skills=mergeSkills(old.skills,incoming.skills);
  }
  if(Array.isArray(incoming.customers)) next.customers=mergeCustomers(old.customers,incoming.customers);
  if(Array.isArray(incoming.orders)) next.orders=mergeOrders(old.orders,incoming.orders);
  if(Array.isArray(incoming.workSamples)) next.workSamples=mergeWorkSamples(old.workSamples,incoming.workSamples);
  if(incoming.websiteInformation){
    const oi=old.websiteInformation||{};
    const ni=incoming.websiteInformation||{};
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

  // Keep explicit order status updates from replacing the whole order list.
  if(ev==='order_status_updated' && incoming.order && incoming.order.id){
    const list=mergeOrders(old.orders,incoming.orders||[]);
    const idx=list.findIndex(x=>String(x.id)===String(incoming.order.id));
    if(idx>=0) list[idx]={...list[idx],...incoming.order}; else list.push(incoming.order);
    next.orders=list;
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
  const state=all[siteId]||{siteId,customers:[],orders:[],skills:[],workSamples:[]};
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
    if(approx>20*1024*1024)return res.status(413).json({ok:false,error:'Work sample is larger than 20 MB'});
    const safeId=String(id||crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g,'_');
    const safeName=String(name).replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,160);
    const fileName=safeId+'-'+safeName;
    const filePath=path.join(SAMPLE_DIR,fileName);
    fs.writeFileSync(filePath,Buffer.from(raw,'base64'));
    const item={id:safeId,name:safeName,type:String(type||'application/octet-stream'),size:Number(size||approx),created:Number(created||Date.now()),fileName};
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

app.use(express.static(__dirname));
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Multiskill website server running on port ${PORT}`);
});
