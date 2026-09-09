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
fs.mkdirSync(DATA_DIR, {recursive:true});

function load(){
  try{return JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));}
  catch(e){return {};}
}
function save(x){fs.writeFileSync(DATA_FILE, JSON.stringify(x,null,2));}
function mergeState(oldState, incoming, event){
  const old=oldState||{};
  const next={...old, siteId:incoming.siteId, updatedAt:new Date().toISOString()};
  if(event.startsWith('owner_') || event==='local_update'){
    if(incoming.owner) next.owner=incoming.owner;
    if(incoming.ownerPassword) next.ownerPassword=incoming.ownerPassword;
    if(Array.isArray(incoming.skills)) next.skills=incoming.skills;
  }
  if(event.startsWith('new_skill_order') || event==='local_update'){
    if(Array.isArray(incoming.orders)) next.orders=incoming.orders;
  }
  if(event.includes('customer') || event==='local_update'){
    if(Array.isArray(incoming.customers)) next.customers=incoming.customers;
  }
  if(incoming.websiteInformation) next.websiteInformation=incoming.websiteInformation;
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
    const {to,subject,body,htmlBody}=req.body||{};
    if(!to||!subject||!body)return res.status(400).json({ok:false,error:'Missing email fields'});
    const mailer=transporter();
    if(!mailer)return res.status(503).json({ok:false,error:'Gmail SMTP is not configured on the server'});
    await mailer.sendMail({from:process.env.OWNER_GMAIL_USER,to,subject,text:body,html:htmlBody||undefined});
    res.json({ok:true});
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
  const siteId=String(req.query.siteId||'');
  if(!siteId)return res.status(400).json({ok:false,error:'Missing siteId'});
  const all=load();
  res.json({ok:true,siteId,state:all[siteId]||{siteId}});
});

app.use(express.static(__dirname));
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`Multiskill website server running on port ${PORT}`));
