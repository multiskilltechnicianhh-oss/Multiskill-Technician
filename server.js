const express = require('express');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({limit:'2mb'}));

const DATA_DIR = path.join(__dirname, 'Website Info');
const DATA_FILE = path.join(DATA_DIR, 'Website Information.json');
const TXT_FILE = path.join(DATA_DIR, 'Website Information.txt');
fs.mkdirSync(DATA_DIR, {recursive:true});

function load(){
  try{return JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));}
  catch(e){return {};}
}
function save(x){
  fs.writeFileSync(DATA_FILE, JSON.stringify(x,null,2));
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
    blocks.push('');
    blocks.push('Website Information Snapshot:');
    blocks.push(JSON.stringify(state.websiteInformation||{},null,2));
    blocks.push('');
  }
  fs.writeFileSync(TXT_FILE, blocks.join('\n'),'utf8');
}
function mergeState(oldState, incoming, event){
  const old=oldState||{};
  const next={...old,siteId:incoming.siteId,updatedAt:new Date().toISOString()};
  const ev=String(event||'update');
  if(ev==='owner_details_updated' || ev==='owner_changed' || ev==='owner_password_changed'){
    if(incoming.owner) next.owner=incoming.owner;
    if(incoming.ownerPassword) next.ownerPassword=incoming.ownerPassword;
    if(Array.isArray(incoming.skills)) next.skills=incoming.skills;
    if(incoming.websiteInformation) next.websiteInformation=incoming.websiteInformation;
  } else if(ev==='skill_updated'){
    if(Array.isArray(incoming.skills)) next.skills=incoming.skills;
  } else if(ev==='customer_signup' || ev==='customer_login'){
    if(Array.isArray(incoming.customers)) next.customers=incoming.customers;
    if(Array.isArray(incoming.orders)) next.orders=incoming.orders;
    if(incoming.websiteInformation) next.websiteInformation=incoming.websiteInformation;
  } else if(ev==='new_skill_order'){
    if(Array.isArray(incoming.orders)) next.orders=incoming.orders;
    if(Array.isArray(incoming.customers)) next.customers=incoming.customers;
    if(incoming.websiteInformation) next.websiteInformation=incoming.websiteInformation;
  } else if(ev==='local_update' || ev==='update'){
    // Backward-compatible fallback for older V8 clients.
    if(incoming.owner) next.owner=incoming.owner;
    if(incoming.ownerPassword) next.ownerPassword=incoming.ownerPassword;
    if(Array.isArray(incoming.skills)) next.skills=incoming.skills;
    if(Array.isArray(incoming.orders)) next.orders=incoming.orders;
    if(Array.isArray(incoming.customers)) next.customers=incoming.customers;
  }
  return next;
}

function transporter(){
  const user=process.env.OWNER_GMAIL_USER;
  const pass=process.env.OWNER_GMAIL_APP_PASSWORD;
  if(!user||!pass)return null;
  return nodemailer.createTransport({service:'gmail',auth:{user,pass}});
}

app.post('/api/send-owner-email', async (req,res)=>{
  try{
    const {to,subject,body,htmlBody,siteId,state,event,order}=req.body||{};
    if(!to||!subject||!body)return res.status(400).json({ok:false,error:'Missing email fields'});
    const mailer=transporter();
    if(!mailer)return res.status(503).json({ok:false,error:'Gmail SMTP is not configured on the server'});
    await mailer.sendMail({from:process.env.OWNER_GMAIL_USER,to,subject,text:body,html:htmlBody||undefined});

    /*
      IMPORTANT: Gmail success is the point at which the new order is committed
      to the shared server state. This makes the owner's Order/New Customers
      tabs and Website Information.txt recoverable from the same server state.
    */
    if(siteId && state){
      const all=load();
      all[siteId]=mergeState(all[siteId],state,String(event||'new_skill_order'));
      if(order){
        const existing=Array.isArray(all[siteId].orders)?all[siteId].orders:[];
        const id=String(order.id||'');
        if(id && !existing.some(x=>String(x&&x.id||'')===id)) existing.push(order);
        all[siteId].orders=existing;
      }
      save(all);
    }
    res.json({ok:true,saved:!!(siteId&&state)});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}
});

app.post('/api/site-sync', (req,res)=>{
  try{
    const {siteId,event,state}=req.body||{};
    if(!siteId||!state)return res.status(400).json({ok:false,error:'Missing siteId/state'});
    const all=load();
    all[siteId]=mergeState(all[siteId],state,String(event||'update'));
    save(all);
    res.json({ok:true,updatedAt:all[siteId].updatedAt});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}
});

app.get('/api/site-sync', (req,res)=>{
  res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
  const siteId=String(req.query.siteId||'');
  if(!siteId)return res.status(400).json({ok:false,error:'Missing siteId'});
  const all=load();
  res.json({ok:true,siteId,state:all[siteId]||{siteId}});
});

app.use(express.static(__dirname));
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Multiskill website server running on port ${PORT}`);
});
