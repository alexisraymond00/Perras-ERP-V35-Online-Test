const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {createAllpriserService} = require('./allpriser');
const {createOnlineService} = require('./online');

// Petit chargeur .env sans dépendance externe.
const ENV_FILE = path.join(__dirname,'.env');
if(fs.existsSync(ENV_FILE)){
  for(const raw of fs.readFileSync(ENV_FILE,'utf8').split(/\r?\n/)){
    const line=raw.trim();
    if(!line || line.startsWith('#')) continue;
    const i=line.indexOf('='); if(i<1) continue;
    const key=line.slice(0,i).trim(), value=line.slice(i+1).trim().replace(/^['"]|['"]$/g,'');
    if(process.env[key]===undefined) process.env[key]=value;
  }
}

const PORT = Number(process.env.PORT || 8080);
const ROOT = path.resolve(__dirname, '..');
const online = createOnlineService({serverDir:__dirname});
const otpStore = new Map();
const oauthStateStore = new Map();
const REVIEW_STORE = path.join(__dirname,'google_reviews.json');
const GOOGLE_OAUTH_STORE = path.join(__dirname,'google_oauth.json');
const GOOGLE_CONFIG_STORE = path.join(__dirname,'google_business_config.json');

const PRODUCTS_STORE = path.join(__dirname,'products_store.json');
let productStore=[];
let productByIdMap=new Map();
let productByCodeMap=new Map();
let productStatsCache={total:0,active:0,warehouseUnits:0,low:0,out:0,onOrder:0,lowIncludingOut:0,costValue:0,saleValue:0,categorySale:{}};
let productImportSession=null;
let productPriceUpdateSession=null;
const allpriser = createAllpriserService({configFile:path.join(__dirname,'allpriser_config.json')});
// V35 — catalogues Winpriser importés depuis l'interface ERP.
const ALLPRISER_UPDATE_ROOT = path.join(ROOT,'Winpriser_Updates');
const ALLPRISER_STAGING = path.join(ALLPRISER_UPDATE_ROOT,'_staging');
const ALLPRISER_REQUIRED_DBF = ['Red__01.dbf','Red__04.dbf','Red__05.dbf'];
const ALLPRISER_DAT_STAGING = path.join(ALLPRISER_UPDATE_ROOT,'_staging_dat','REDBOOK.DAT');
function resetAllpriserStaging(){fs.rmSync(ALLPRISER_STAGING,{recursive:true,force:true});fs.mkdirSync(ALLPRISER_STAGING,{recursive:true});}
function receiveRawFile(req,dest,maxBytes=25*1024*1024){
  return new Promise((resolve,reject)=>{
    fs.mkdirSync(path.dirname(dest),{recursive:true});
    const tmp=dest+'.part-'+process.pid+'-'+Date.now();let size=0,done=false;
    const out=fs.createWriteStream(tmp);
    const fail=(err)=>{if(done)return;done=true;try{out.destroy();}catch(_){}try{fs.rmSync(tmp,{force:true});}catch(_){}reject(err);};
    req.on('data',chunk=>{size+=chunk.length;if(size>maxBytes)fail(new Error('Fichier trop volumineux (maximum 25 Mo).'));});
    req.on('error',fail);out.on('error',fail);
    out.on('finish',()=>{if(done)return;done=true;try{fs.renameSync(tmp,dest);resolve(size);}catch(e){reject(e);}});
    req.pipe(out);
  });
}
function finalizeAllpriserUpload(){
  const missing=ALLPRISER_REQUIRED_DBF.filter(n=>!fs.existsSync(path.join(ALLPRISER_STAGING,n)));
  if(missing.length)throw new Error('Fichier(s) manquant(s): '+missing.join(', '));
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const target=path.join(ALLPRISER_UPDATE_ROOT,'catalog_'+stamp);fs.mkdirSync(target,{recursive:true});
  for(const n of ALLPRISER_REQUIRED_DBF)fs.copyFileSync(path.join(ALLPRISER_STAGING,n),path.join(target,n));
  const previous=allpriser.folder();
  try{
    const st=allpriser.setFolder(target);
    if(!st.ok)throw new Error(st.error||'Catalogue DBF invalide.');
    fs.writeFileSync(path.join(target,'catalog_info.json'),JSON.stringify({importedAt:new Date().toISOString(),source:'ERP upload',count:st.count,revisedDate:st.revisedDate,updateBatch:st.updateBatch},null,2),'utf8');
    resetAllpriserStaging();
    return {...st,uploaded:true,catalogFolder:target};
  }catch(e){
    try{fs.rmSync(target,{recursive:true,force:true});}catch(_){}
    try{if(previous&&ALLPRISER_REQUIRED_DBF.every(n=>fs.existsSync(path.join(previous,n))))allpriser.setFolder(previous);}catch(_){}
    throw e;
  }
 }
function finalizeAllpriserDatUpload(){
  if(!fs.existsSync(ALLPRISER_DAT_STAGING))throw new Error('REDBOOK.DAT manquant.');
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const target=path.join(ALLPRISER_UPDATE_ROOT,'catalog_dat_'+stamp);fs.mkdirSync(target,{recursive:true});
  const targetFile=path.join(target,'REDBOOK.DAT');fs.copyFileSync(ALLPRISER_DAT_STAGING,targetFile);
  const previousDat=allpriser.datFile(),previousFolder=allpriser.folder();
  try{
    const st=allpriser.setDatFile(targetFile);
    if(!st.ok)throw new Error(st.error||'Catalogue DAT invalide.');
    fs.writeFileSync(path.join(target,'catalog_info.json'),JSON.stringify({importedAt:new Date().toISOString(),source:'ERP DAT upload',file:'REDBOOK.DAT',count:st.count,revisedDate:st.revisedDate,updateBatch:st.updateBatch},null,2),'utf8');
    try{fs.rmSync(path.dirname(ALLPRISER_DAT_STAGING),{recursive:true,force:true});}catch(_){}
    return {...st,uploaded:true,catalogFolder:target,catalogFile:targetFile};
  }catch(e){
    try{fs.rmSync(target,{recursive:true,force:true});}catch(_){}
    try{if(previousDat&&fs.existsSync(previousDat))allpriser.setDatFile(previousDat);else if(previousFolder)allpriser.setFolder(previousFolder);}catch(_){}
    throw e;
  }
}

function normText(v=''){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();}
function normProductDescription(v=''){return normText(v).replace(/[’'`]/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();}
function num(v,def=0){const raw=String(v??'').trim();if(!raw)return Number(def||0);let s=raw.replace(/\s/g,'').replace(/[$%]/g,'');if(s.includes(',')&&s.includes('.')){if(s.lastIndexOf(',')>s.lastIndexOf('.'))s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}else if(s.includes(','))s=s.replace(',','.');const n=Number(s.replace(/[^0-9.\-]/g,''));return Number.isFinite(n)?n:Number(def||0);}
function normalizeProduct(p={},existing=null){
  const code=String(p.code||p.sku||p.item||'').trim();
  const id=String(p.id||existing?.id||('p_'+crypto.createHash('sha1').update(code||crypto.randomUUID()).digest('hex').slice(0,14)));
  return {
    ...(existing||{}),...p,id,code,
    description:String(p.description??existing?.description??'').trim(),
    // V32: une seule catégorie produit = catégorie fournisseur. `category` reste un alias de compatibilité.
    category:String(p.category??p.supplierCategoryName??existing?.category??existing?.supplierCategoryName??'À classer').trim()||'À classer',
    supplierCategoryId:String(p.supplierCategoryId??existing?.supplierCategoryId??''),
    supplierCategoryName:String(p.supplierCategoryName??p.category??existing?.supplierCategoryName??existing?.category??'').trim(),
    warehouseQty:num(p.warehouseQty,existing?.warehouseQty||0),
    minQty:num(p.minQty,existing?.minQty||0),
    onOrderQty:num(p.onOrderQty,existing?.onOrderQty||0),
    listPrice:num(p.listPrice,existing?.listPrice||0),
    costPrice:num(p.costPrice,existing?.costPrice||0),
    perras1Price:num(p.perras1Price,existing?.perras1Price||0),
    active:p.active===undefined?(existing?.active!==false):p.active!==false,
    image:String(p.image??existing?.image??''),
    source:String(p.source??existing?.source??'manuel'),
    updatedAt:new Date().toISOString()
  };
}
function rebuildProductIndexes(){
  productByIdMap=new Map();productByCodeMap=new Map();
  let active=0,warehouseUnits=0,low=0,out=0,onOrder=0,costValue=0,saleValue=0;const categorySale={};
  for(const p of productStore){
    productByIdMap.set(p.id,p);if(p.code)productByCodeMap.set(String(p.code).toLowerCase(),p);try{Object.defineProperty(p,'__search',{value:normText([p.code,p.description,p.supplierCategoryName,p.category].join(' ')),writable:true,configurable:true,enumerable:false});}catch(_){p.__search=normText([p.code,p.description,p.supplierCategoryName,p.category].join(' '));}
    if(p.active===false)continue;active++;const q=num(p.warehouseQty),m=num(p.minQty),cost=num(p.costPrice),list=num(p.listPrice);
    warehouseUnits+=q;onOrder+=num(p.onOrderQty);costValue+=q*cost;saleValue+=q*list;{const catName=p.supplierCategoryName||p.category||'À classer';categorySale[catName]=(categorySale[catName]||0)+q*list;}
    if(q===0)out++;else if(q<=m)low++;
  }
  productStatsCache={total:productStore.length,active,warehouseUnits,low,out,onOrder,lowIncludingOut:low+out,costValue,saleValue,categorySale,updatedAt:new Date().toISOString()};
}
function migratePreviousProductStoreIfNeeded(){
  // Facilite le passage V31/V32/V33 -> V34 : si ce dossier est vide, récupère automatiquement
  // le catalogue du dossier V31 voisin le plus récent. Aucun catalogue existant n'est écrasé.
  try{
    let current=[];
    try{current=JSON.parse(fs.readFileSync(PRODUCTS_STORE,'utf8'));}catch(_){current=[];}
    if(Array.isArray(current)&&current.length) return;
    const parent=path.dirname(ROOT),candidates=[];
    for(const ent of fs.readdirSync(parent,{withFileTypes:true})){
      if(!ent.isDirectory()||!/v3[123]/i.test(ent.name)||!/perras/i.test(ent.name)) continue;
      const f=path.join(parent,ent.name,'server','products_store.json');
      try{
        const rows=JSON.parse(fs.readFileSync(f,'utf8'));
        if(Array.isArray(rows)&&rows.length)candidates.push({f,rows,mtime:fs.statSync(f).mtimeMs});
      }catch(_){ }
    }
    candidates.sort((a,b)=>b.mtime-a.mtime);
    if(candidates[0]){
      fs.writeFileSync(PRODUCTS_STORE,JSON.stringify(candidates[0].rows),'utf8');
      console.log(`Catalogue précédent récupéré automatiquement : ${candidates[0].rows.length} produits.`);
    }
  }catch(_){/* migration facultative */}
}
function loadProductStore(){
  migratePreviousProductStoreIfNeeded();
  try{const raw=JSON.parse(fs.readFileSync(PRODUCTS_STORE,'utf8'));productStore=Array.isArray(raw)?raw.map(x=>normalizeProduct(x,x)):[];}catch(_){productStore=[];}
  rebuildProductIndexes();
}
function saveProductStore(){const tmp=PRODUCTS_STORE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(productStore),'utf8');fs.renameSync(tmp,PRODUCTS_STORE);rebuildProductIndexes();online.saveProducts(productStore).catch(e=>console.error('Sauvegarde produits online:',e.message));}
function productQuery(params){
  const q=normText(params.get('q')||params.get('query')||''),filter=params.get('filter')||'all';
  const offset=Math.max(0,Number(params.get('offset')||0)),limit=Math.max(1,Math.min(500,Number(params.get('limit')||48)));
  const activeOnly=params.get('activeOnly')==='1';let rows=[];
  for(const p of productStore){if(activeOnly&&p.active===false)continue;const qty=num(p.warehouseQty),min=num(p.minQty);
    if(filter==='low'&&!(p.active!==false&&qty>0&&qty<=min))continue;if(filter==='out'&&!(p.active!==false&&qty===0))continue;if(filter==='onorder'&&!(num(p.onOrderQty)>0))continue;
    if(q&&!String(p.__search||normText([p.code,p.description,p.supplierCategoryName,p.category].join(' '))).includes(q))continue;rows.push(p);
  }
  return {total:rows.length,offset,limit,items:rows.slice(offset,offset+limit),stats:productStatsCache};
}
loadProductStore();

function json(res, status, body){
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(body));
}
function redirect(res,location){res.writeHead(302,{Location:location,'Cache-Control':'no-store'});res.end();}
function parseBody(req){
  return new Promise((resolve,reject)=>{
    let data='';
    req.on('data',c=>{ data+=c; if(data.length>8e6) req.destroy(); });
    req.on('end',()=>{ try{ resolve(data?JSON.parse(data):{}); }catch(e){ reject(e); } });
    req.on('error',reject);
  });
}
function readJson(file,fallback={}){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(_){return fallback;}}
function writeJson(file,value){fs.writeFileSync(file,JSON.stringify(value,null,2),'utf8');return value;}
function normalizePhone(v){ return String(v||'').replace(/\D/g,'').replace(/^1(?=\d{10}$)/,''); }
function e164(v){ const p=normalizePhone(v); return p.length===10?`+1${p}`:`+${p}`; }
function randomCode(){ return String(crypto.randomInt(100000,1000000)); }

async function sendTwilioSms(phone, code){
  const sid=process.env.TWILIO_ACCOUNT_SID;
  const token=process.env.TWILIO_AUTH_TOKEN;
  const from=process.env.TWILIO_FROM_NUMBER;
  if(!sid || !token || !from) return {sent:false,dev:true};
  const params=new URLSearchParams({To:e164(phone),From:from,Body:`PERRAS — Votre code de connexion est ${code}. Il expire dans 10 minutes.`});
  const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,{
    method:'POST',
    headers:{'Authorization':'Basic '+Buffer.from(`${sid}:${token}`).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},
    body:params.toString()
  });
  if(!r.ok){ const txt=await r.text(); throw new Error(`Twilio ${r.status}: ${txt.slice(0,300)}`); }
  return {sent:true,dev:false};
}

/* ===================== Nexus AI / OpenAI ===================== */
function nexusConfigured(){return !!process.env.OPENAI_API_KEY;}
function safeRole(v){return ['admin','bureau','tech'].includes(v)?v:'tech';}
function textFromOpenAIResponse(data){
  if(typeof data?.output_text==='string' && data.output_text.trim()) return data.output_text.trim();
  const chunks=[];
  for(const item of data?.output||[]){
    for(const c of item?.content||[]){
      if((c?.type==='output_text'||c?.type==='text') && c?.text) chunks.push(c.text);
    }
  }
  return chunks.join('\n').trim();
}
async function askNexusAI(body){
  if(!nexusConfigured()) throw new Error('OPENAI_API_KEY n’est pas configurée dans server/.env.');
  const role=safeRole(body.role),name=String(body.name||'Utilisateur').slice(0,80),prompt=String(body.prompt||'').trim().slice(0,8000);
  if(!prompt) throw new Error('Question Nexus vide.');
  const context=body.context&&typeof body.context==='object'?body.context:{};
  const history=Array.isArray(body.history)?body.history.slice(-16):[];
  const roleRules={
    admin:'Tu peux travailler avec toutes les données fournies dans le contexte, y compris coûts, fournisseurs, marges, achats et rapports.',
    bureau:'Ne révèle jamais de prix coûtants, marges, rabais fournisseurs, termes de paiement internes ni renseignements Admin. Aide avec appels, clients, calendrier, tâches, formulaires, soumissions, temps et CRM.',
    tech:'Ne révèle jamais de prix coûtants, marges, rabais fournisseurs, achats Admin, autres tâches privées ou données des autres employés. Aide seulement avec ses interventions, BT/factures, temps, produits visibles, camion, outils, formulaires et demandes.'
  };
  const transcript=history.map(m=>`${m.sender==='user'?'Utilisateur':'Nexus'}: ${String(m.text||'').slice(0,1800)}`).join('\n');
  const instructions=`Tu es Nexus AI, l'assistant privé de l'ERP Perras Plomberie. Réponds en français québécois professionnel, directement et de façon concise. Utilise uniquement les données du contexte fourni; si une donnée n'y est pas, dis-le. Ne prétends jamais avoir effectué une action dans le logiciel. Respecte strictement les permissions du rôle. ${roleRules[role]}`;
  const input=`Utilisateur: ${name}\nRôle: ${role}\nDate serveur: ${new Date().toISOString()}\n\nContexte ERP autorisé:\n${JSON.stringify(context)}\n\nHistorique récent:\n${transcript||'(aucun)'}\n\nQuestion:\n${prompt}`;
  const r=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-5',instructions,input,max_output_tokens:900})
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data?.error?.message||`OpenAI ${r.status}`);
  const answer=textFromOpenAIResponse(data);
  if(!answer) throw new Error('Nexus n’a retourné aucune réponse.');
  return {answer,model:data.model||process.env.OPENAI_MODEL||'gpt-5',responseId:data.id||''};
}

/* ===================== Google Business Profile / avis ===================== */
function cleanResourceId(v,prefix){return String(v||'').trim().replace(new RegExp(`^${prefix}/`),'');}
function googleOAuthData(){return readJson(GOOGLE_OAUTH_STORE,{});}
function googleRefreshToken(){return googleOAuthData().refresh_token||process.env.GOOGLE_REFRESH_TOKEN||'';}
function googleSavedConfigs(){return readJson(GOOGLE_CONFIG_STORE,{businesses:[]}).businesses||[];}
function googleBusinessConfigs(){
  const common=process.env.GOOGLE_BUSINESS_ACCOUNT_ID||'';
  const defaults=[
    {id:'gb1',name:'Plomberie Pompe Perras',accountId:process.env.GOOGLE_POMPE_ACCOUNT_ID||common,locationId:process.env.GOOGLE_POMPE_LOCATION_ID||''},
    {id:'gb2',name:'Plomberie Saint-Jean',accountId:process.env.GOOGLE_SAINT_JEAN_ACCOUNT_ID||common,locationId:process.env.GOOGLE_SAINT_JEAN_LOCATION_ID||''},
    {id:'gb3',name:'Plombier Vaudreuil',accountId:process.env.GOOGLE_VAUDREUIL_ACCOUNT_ID||common,locationId:process.env.GOOGLE_VAUDREUIL_LOCATION_ID||''}
  ];
  const saved=googleSavedConfigs();
  return defaults.map(d=>{
    const s=saved.find(x=>x.id===d.id||x.name===d.name)||{};
    return {...d,...s,accountId:cleanResourceId(s.accountId||d.accountId,'accounts'),locationId:cleanResourceId(s.locationId||d.locationId,'locations')};
  });
}
function googleOAuthReady(){return !!(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET);}
function googleConnected(){return !!googleRefreshToken();}
function googleConfigured(){return !!(googleOAuthReady()&&googleConnected()&&googleBusinessConfigs().some(x=>x.accountId&&x.locationId));}
function readReviewStore(){
  try{const x=JSON.parse(fs.readFileSync(REVIEW_STORE,'utf8'));return {reviews:Array.isArray(x.reviews)?x.reviews:[],lastSync:x.lastSync||null};}
  catch(_){ return {reviews:[],lastSync:null}; }
}
function writeReviewStore(reviews){const data={version:1,lastSync:new Date().toISOString(),reviews};fs.writeFileSync(REVIEW_STORE,JSON.stringify(data,null,2),'utf8');return data;}
function googleRedirectUri(req){
  if(process.env.GOOGLE_REDIRECT_URI)return process.env.GOOGLE_REDIRECT_URI;
  const proto=(req.headers['x-forwarded-proto']||'http').split(',')[0].trim();
  return `${proto}://${req.headers.host||`localhost:${PORT}`}/api/google-oauth/callback`;
}
async function exchangeGoogleCode(code,redirectUri){
  const p=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID||'',client_secret:process.env.GOOGLE_CLIENT_SECRET||'',code,grant_type:'authorization_code',redirect_uri:redirectUri});
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:p.toString()});
  const data=await r.json().catch(()=>({}));
  if(!r.ok||!data.access_token)throw new Error(data.error_description||data.error||`OAuth Google ${r.status}`);
  const old=googleOAuthData();
  writeJson(GOOGLE_OAUTH_STORE,{...old,...data,refresh_token:data.refresh_token||old.refresh_token||'',updatedAt:new Date().toISOString()});
  return data;
}
async function googleAccessToken(){
  const p=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID||'',client_secret:process.env.GOOGLE_CLIENT_SECRET||'',refresh_token:googleRefreshToken(),grant_type:'refresh_token'});
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:p.toString()});
  const data=await r.json().catch(()=>({}));
  if(!r.ok||!data.access_token) throw new Error(`OAuth Google ${r.status}: ${data.error_description||data.error||'jeton indisponible'}`);
  return data.access_token;
}
async function googleFetchJson(url,token){
  const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data?.error?.message||`Google ${r.status}`);return data;
}
async function discoverGoogleLocations(){
  if(!googleConnected())throw new Error('Connectez d’abord le compte Google Business Profile.');
  const token=await googleAccessToken();
  const acc=await googleFetchJson('https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20',token);
  const rows=[];
  for(const a of acc.accounts||[]){
    const accountId=cleanResourceId(a.name,'accounts');
    let pageToken='';
    do{
      const qs=new URLSearchParams({pageSize:'100',readMask:'name,title,storeCode'});if(pageToken)qs.set('pageToken',pageToken);
      const data=await googleFetchJson(`https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${encodeURIComponent(accountId)}/locations?${qs}`,token);
      for(const loc of data.locations||[])rows.push({accountId,accountName:a.accountName||a.name,locationId:cleanResourceId(loc.name,'locations'),locationName:loc.title||loc.locationName||loc.storeCode||loc.name,storeCode:loc.storeCode||''});
      pageToken=data.nextPageToken||'';
    }while(pageToken);
  }
  return rows;
}
async function listGoogleReviewsForBusiness(business,token){
  const out=[]; let pageToken='';
  do{
    const accountId=encodeURIComponent(business.accountId),locationId=encodeURIComponent(business.locationId);
    const qs=new URLSearchParams({pageSize:'50',orderBy:'updateTime desc'});if(pageToken)qs.set('pageToken',pageToken);
    const url=`https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews?${qs}`;
    const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});const data=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(`${business.name}: Google ${r.status} — ${data.error?.message||'lecture des avis impossible'}`);
    for(const review of (data.reviews||[]))out.push({id:`${business.id}_${review.reviewId}`,businessId:business.id,businessName:business.name,accountId:business.accountId,locationId:business.locationId,reviewId:review.reviewId,reviewerName:review.reviewer?.displayName||'Client Google',reviewer:review.reviewer||null,starRating:review.starRating||'',comment:review.comment||'',createTime:review.createTime||review.updateTime||'',updateTime:review.updateTime||review.createTime||'',reviewReply:review.reviewReply||null});
    pageToken=data.nextPageToken||'';
  }while(pageToken);
  return out;
}
function mergeReviews(existing,incoming){const map=new Map();for(const r of existing||[])map.set(`${r.businessId||''}:${r.reviewId||r.id}`,r);for(const r of incoming||[]){const key=`${r.businessId||''}:${r.reviewId||r.id}`;map.set(key,{...(map.get(key)||{}),...r});}return [...map.values()].sort((a,b)=>String(b.createTime||b.updateTime||'').localeCompare(String(a.createTime||a.updateTime||'')));}
let googleSyncPromise=null;
async function syncGoogleReviews(){
  if(googleSyncPromise)return googleSyncPromise;
  googleSyncPromise=(async()=>{
    if(!googleConfigured())throw new Error('Google est connecté, mais aucune fiche n’est encore associée à Perras ERP. Ouvrez Rapports > Avis Google > Configurer mes fiches.');
    const token=await googleAccessToken(),businesses=googleBusinessConfigs(),incoming=[];
    for(const b of businesses){if(!b.accountId||!b.locationId)continue;incoming.push(...await listGoogleReviewsForBusiness(b,token));}
    const stored=readReviewStore(),merged=mergeReviews(stored.reviews,incoming),saved=writeReviewStore(merged);
    return {reviews:merged,businesses,lastSync:saved.lastSync};
  })().finally(()=>{googleSyncPromise=null;});
  return googleSyncPromise;
}

function staticFile(req,res){
  let pathname=decodeURIComponent((req.url||'/').split('?')[0]);if(pathname==='/') pathname='/index.html';
  const file=path.resolve(ROOT,'.'+pathname);if(!file.startsWith(ROOT)) return json(res,403,{error:'Interdit'});
  fs.stat(file,(err,st)=>{if(err||!st.isFile()) return json(res,404,{error:'Introuvable'});const ext=path.extname(file).toLowerCase();const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml'};res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream'});fs.createReadStream(file).pipe(res);});
}

const server=http.createServer(async (req,res)=>{
  const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  if(req.method==='GET' && url.pathname==='/api/health') return json(res,200,{ok:true,online:true,storage:online.mode(),sms:!!(process.env.TWILIO_ACCOUNT_SID&&process.env.TWILIO_AUTH_TOKEN&&process.env.TWILIO_FROM_NUMBER),nexus:nexusConfigured(),googleOAuthReady:googleOAuthReady(),googleConnected:googleConnected(),googleReviews:googleConfigured(),googleLastSync:readReviewStore().lastSync});

  // V35 Online — authentification serveur + données communes.
  if(req.method==='POST' && url.pathname==='/api/auth/login'){
    try{const body=await parseBody(req),user=await online.authenticate(body.username,body.password);if(!user)return json(res,401,{ok:false,error:'Identifiant ou mot de passe invalide.'});const sess=await online.createSession(user);res.setHeader('Set-Cookie',online.cookieFor(sess.token));return json(res,200,{ok:true,user,expiresAt:sess.expiresAt});}catch(e){return json(res,400,{ok:false,error:String(e.message||e)});}
  }
  if(req.method==='POST' && url.pathname==='/api/auth/logout'){await online.deleteSession(req);res.setHeader('Set-Cookie',online.cookieFor('',true));return json(res,200,{ok:true});}
  if(req.method==='GET' && url.pathname==='/api/auth/me'){const user=await online.sessionUser(req);return user?json(res,200,{ok:true,user}):json(res,401,{ok:false,error:'Session expirée'});}


  if(req.method==='POST' && url.pathname==='/api/auth/request'){
    try{const {phone}=await parseBody(req);const p=normalizePhone(phone);if(p.length!==10)return json(res,400,{error:'Numéro invalide'});const code=randomCode();otpStore.set(p,{code,expires:Date.now()+10*60*1000,attempts:0});const result=await sendTwilioSms(p,code);return json(res,200,{ok:true,devCode:result.dev?code:undefined});}
    catch(e){ return json(res,500,{error:'Impossible d’envoyer le SMS',details:String(e.message||e)}); }
  }
  if(req.method==='POST' && url.pathname==='/api/auth/verify'){
    try{const {phone,code}=await parseBody(req);const p=normalizePhone(phone),row=otpStore.get(p);if(!row)return json(res,400,{error:'Aucun code en attente'});if(Date.now()>row.expires){otpStore.delete(p);return json(res,400,{error:'Code expiré'});}row.attempts++;if(row.attempts>6){otpStore.delete(p);return json(res,429,{error:'Trop de tentatives'});}if(String(code)!==row.code)return json(res,400,{error:'Code invalide'});otpStore.delete(p);return json(res,200,{ok:true});}
    catch(e){ return json(res,400,{error:'Requête invalide'}); }
  }


  // Toutes les autres API sont privées en V35 Online.
  const onlineUser=await online.sessionUser(req);
  const isPublicWebhook=(url.pathname==='/api/google-reviews/pubsub');
  if(url.pathname.startsWith('/api/') && !isPublicWebhook && !onlineUser) return json(res,401,{ok:false,error:'Connexion requise'});

  if(req.method==='GET' && url.pathname==='/api/cloud/bootstrap'){
    const rows=await online.getStateAll(),now=new Date().toISOString();return json(res,200,{ok:true,user:onlineUser,rows,serverTime:now,storage:online.mode()});
  }
  if(req.method==='GET' && url.pathname==='/api/cloud/changes'){
    const rows=await online.getStateChanges(url.searchParams.get('since')||'1970-01-01T00:00:00.000Z');return json(res,200,{ok:true,rows,serverTime:new Date().toISOString()});
  }
  if(req.method==='POST' && url.pathname==='/api/cloud/state'){
    try{const body=await parseBody(req);const meta=await online.setState(body.key,body.value,onlineUser);return json(res,200,{ok:true,...meta});}catch(e){return json(res,403,{ok:false,error:String(e.message||e)});}
  }

  const adminOnly = url.pathname.startsWith('/api/allpriser/') ||
    ['/api/products/upsert','/api/products/patch','/api/products/import/start','/api/products/import/chunk','/api/products/import/finish','/api/products/price-analysis/start','/api/products/price-analysis/chunk','/api/products/price-analysis/summary','/api/products/price-analysis/apply'].includes(url.pathname) ||
    url.pathname.startsWith('/api/google-oauth/') || url.pathname.startsWith('/api/google-business/') || url.pathname==='/api/google-reviews/sync';
  if(adminOnly && onlineUser.role!=='admin') return json(res,403,{ok:false,error:'Accès administrateur requis'});


  /* ===================== Catalogue produits persistant ===================== */
  if(req.method==='GET' && url.pathname==='/api/products/stats') return json(res,200,{ok:true,stats:productStatsCache});
  if(req.method==='GET' && url.pathname==='/api/products') return json(res,200,{ok:true,...productQuery(url.searchParams)});
  if(req.method==='POST' && url.pathname==='/api/products/lookup'){
    try{const body=await parseBody(req),ids=Array.isArray(body.ids)?body.ids.slice(0,1000):[];return json(res,200,{ok:true,items:ids.map(id=>productByIdMap.get(String(id))).filter(Boolean)});}catch(e){return json(res,400,{ok:false,error:'Recherche produits invalide'});}
  }
  if(req.method==='POST' && url.pathname==='/api/products/upsert'){
    try{const body=await parseBody(req),incoming=body.product||body;if(!incoming||(!incoming.code&&!incoming.id))return json(res,400,{error:'Code produit requis'});const existing=(incoming.id&&productByIdMap.get(String(incoming.id)))||productByCodeMap.get(String(incoming.code||'').toLowerCase())||null;const p=normalizeProduct({...incoming,source:incoming.source||existing?.source||'manuel'},existing);if(existing){const i=productStore.findIndex(x=>x.id===existing.id);productStore[i]=p;}else productStore.push(p);saveProductStore();return json(res,200,{ok:true,product:p,stats:productStatsCache});}catch(e){return json(res,400,{ok:false,error:String(e.message||e)});}
  }
  if(req.method==='POST' && url.pathname==='/api/products/patch'){
    try{const body=await parseBody(req),id=String(body.id||''),existing=productByIdMap.get(id);if(!existing)return json(res,404,{error:'Produit introuvable'});const p=normalizeProduct({...existing,...(body.patch||{}),id},existing),i=productStore.findIndex(x=>x.id===id);productStore[i]=p;saveProductStore();return json(res,200,{ok:true,product:p,stats:productStatsCache});}catch(e){return json(res,400,{ok:false,error:String(e.message||e)});}
  }
  if(req.method==='POST' && url.pathname==='/api/products/import/start'){
    try{
      const body=await parseBody(req),mode=body.mode==='prices'?'prices':'catalog';
      productImportSession={mode,map:new Map(productStore.map(p=>[String(p.code||'').toLowerCase(),p])),added:0,updated:0,priceUpdated:0,notFound:0,received:0,startedAt:Date.now()};
      return json(res,200,{ok:true,mode,existing:productStore.length});
    }catch(e){return json(res,400,{ok:false,error:String(e.message||e)});}
  }
  if(req.method==='POST' && url.pathname==='/api/products/import/chunk'){
    try{
      if(!productImportSession)productImportSession={mode:'catalog',map:new Map(productStore.map(p=>[String(p.code||'').toLowerCase(),p])),added:0,updated:0,priceUpdated:0,notFound:0,received:0,startedAt:Date.now()};
      const body=await parseBody(req),rows=Array.isArray(body.products)?body.products:[];
      for(const row of rows){
        const code=String(row.code||'').trim();if(!code)continue;
        const key=code.toLowerCase(),existing=productImportSession.map.get(key)||null;
        productImportSession.received++;
        if(productImportSession.mode==='prices'){
          if(!existing){productImportSession.notFound++;continue;}
          const newList=num(row.listPrice,NaN);
          if(!Number.isFinite(newList)){continue;}
          const oldList=num(existing.listPrice,0),ratio=oldList>0?newList/oldList:null;
          const patch={...existing,listPrice:newList,source:existing.source||'winpriser'};
          // Les coûtants/vendants sont des pourcentages du Prix Liste. Une mise à jour Winpriser
          // peut donc être redimensionnée sans recharger les règles fournisseur dans le serveur.
          if(ratio!==null){
            patch.costPrice=num(existing.costPrice,0)*ratio;
            patch.perras1Price=num(existing.perras1Price,0)*ratio;
          }
          const p=normalizeProduct(patch,existing);productImportSession.map.set(key,p);productImportSession.priceUpdated++;continue;
        }
        const incoming={...row,source:'winpriser'};
        if(existing&&row.listPrice!==undefined&&row.costPrice===undefined&&row.perras1Price===undefined){
          const oldList=num(existing.listPrice,0),newList=num(row.listPrice,oldList),ratio=oldList>0?newList/oldList:null;
          if(ratio!==null){incoming.costPrice=num(existing.costPrice,0)*ratio;incoming.perras1Price=num(existing.perras1Price,0)*ratio;}
        }
        const p=normalizeProduct(incoming,existing);productImportSession.map.set(key,p);
        if(existing)productImportSession.updated++;else productImportSession.added++;
      }
      return json(res,200,{ok:true,mode:productImportSession.mode,received:productImportSession.received,added:productImportSession.added,updated:productImportSession.updated,priceUpdated:productImportSession.priceUpdated,notFound:productImportSession.notFound});
    }catch(e){return json(res,400,{ok:false,error:String(e.message||e)});}
  }
  if(req.method==='POST' && url.pathname==='/api/products/import/finish'){
    if(!productImportSession)return json(res,400,{error:'Aucun import en cours'});
    productStore=[...productImportSession.map.values()];
    const result={mode:productImportSession.mode,received:productImportSession.received,added:productImportSession.added,updated:productImportSession.updated,priceUpdated:productImportSession.priceUpdated,notFound:productImportSession.notFound,total:productStore.length};
    productImportSession=null;saveProductStore();return json(res,200,{ok:true,...result,stats:productStatsCache});
  }

  // V36 — téléversement direct de REDBOOK.DAT (méthode recommandée).
  if(req.method==='POST' && url.pathname==='/api/allpriser/upload-dat'){
    try{
      fs.rmSync(path.dirname(ALLPRISER_DAT_STAGING),{recursive:true,force:true});
      const bytes=await receiveRawFile(req,ALLPRISER_DAT_STAGING,30*1024*1024);
      const result=finalizeAllpriserDatUpload();
      try{await online.saveBinary('REDBOOK.DAT',fs.readFileSync(result.catalogFile),{count:result.count,revisedDate:result.revisedDate,updateBatch:result.updateBatch,importedAt:new Date().toISOString()});}catch(e){console.error('Sauvegarde REDBOOK.DAT online:',e.message);}
      return json(res,200,{...result,bytes});
    }catch(e){return json(res,400,{ok:false,error:String(e.message||e)});}
  }

  // V35 — téléversement direct des 3 DBF Winpriser depuis Documents / le dossier Winpriser.
  if(req.method==='POST' && url.pathname==='/api/allpriser/upload-reset'){
    try{resetAllpriserStaging();return json(res,200,{ok:true});}catch(e){return json(res,500,{ok:false,error:String(e.message||e)});}
  }
  if(req.method==='POST' && url.pathname==='/api/allpriser/upload-file'){
    const name=String(url.searchParams.get('name')||'');
    const canonical=ALLPRISER_REQUIRED_DBF.find(n=>n.toLowerCase()===name.toLowerCase());
    if(!canonical)return json(res,400,{ok:false,error:'Fichier DBF non permis. Utilisez Red__01.dbf, Red__04.dbf ou Red__05.dbf.'});
    try{const bytes=await receiveRawFile(req,path.join(ALLPRISER_STAGING,canonical));return json(res,200,{ok:true,name:canonical,bytes});}
    catch(e){return json(res,400,{ok:false,error:String(e.message||e),name:canonical});}
  }
  if(req.method==='POST' && url.pathname==='/api/allpriser/upload-finalize'){
    try{return json(res,200,finalizeAllpriserUpload());}
    catch(e){return json(res,400,{ok:false,error:String(e.message||e)});}
  }

  // V34 Allpriser direct — lit les DBF Winpriser sans export Excel.
  if(req.method==='GET' && url.pathname==='/api/allpriser/status'){
    return json(res,200,allpriser.status());
  }
  if(req.method==='POST' && url.pathname==='/api/allpriser/config'){
    try{const body=await parseBody(req);return json(res,200,allpriser.setFolder(body.path));}
    catch(e){return json(res,400,{ok:false,error:String(e.message||e),path:allpriser.folder(),candidates:allpriser.candidateFolders()});}
  }
  if(req.method==='POST' && url.pathname==='/api/allpriser/detect'){
    try{return json(res,200,allpriser.detectFolder());}
    catch(e){return json(res,500,{ok:false,error:String(e.message||e),path:allpriser.folder()});}
  }
  if(req.method==='POST' && url.pathname==='/api/allpriser/price-analysis'){
    try{
      const body=await parseBody(req),thresholdPct=Math.max(0,Number(body.thresholdPct)||30);
      const result=allpriser.compareByDescription(productStore.filter(p=>p.active!==false),thresholdPct);
      return json(res,200,result);
    }catch(e){return json(res,503,{ok:false,error:String(e.message||e),path:allpriser.folder()});}
  }
  if(req.method==='POST' && url.pathname==='/api/allpriser/price-apply'){
    try{
      const body=await parseBody(req),thresholdPct=Math.max(0,Number(body.thresholdPct)||30),ids=new Set((Array.isArray(body.ids)?body.ids:[]).map(String));
      if(!ids.size)return json(res,400,{ok:false,error:'Aucune mise à jour sélectionnée.'});
      // Refaire l'analyse avec le catalogue Winpriser courant avant d'écrire les prix.
      const fresh=allpriser.compareByDescription(productStore.filter(p=>p.active!==false),thresholdPct),byId=new Map((fresh.changes||[]).map(c=>[String(c.id),c]));
      let updated=0,reviewUpdated=0;
      for(const id of ids){
        const c=byId.get(id),existing=productByIdMap.get(id);if(!c||!existing||existing.active===false)continue;
        const patch={...existing,listPrice:Number(c.newPrice||0),source:existing.source||'winpriser',allpriserNctlg:c.allpriserNctlg,allpriserSibca:c.allpriserSibca||'',allpriserRevisedDate:c.revisedDate||'',allpriserUpdateBatch:c.updateBatch||'',allpriserLastSync:new Date().toISOString(),allpriserMatchMethod:c.matchMethod||'Description'};
        // IMPORTANT : Allpriser ne touche qu'au Prix Liste. Les autres calculs demeurent ceux du ERP.
        const normalized=normalizeProduct(patch,existing),i=productStore.findIndex(x=>x.id===existing.id);
        if(i>=0){productStore[i]=normalized;updated++;if(c.needsReview)reviewUpdated++;}
      }
      saveProductStore();
      return json(res,200,{ok:true,updated,reviewUpdated,total:productStore.length,stats:productStatsCache});
    }catch(e){return json(res,503,{ok:false,error:String(e.message||e)});}
  }

  // V33 — Analyse puis mise à jour des Prix Liste Winpriser par DESCRIPTION.
  // Le code produit n'est volontairement pas utilisé pour ce rapprochement.
  if(req.method==='POST' && url.pathname==='/api/products/price-analysis/start'){
    try{
      const active=productStore.filter(p=>p.active!==false),byDescription=new Map();
      for(const p of active){
        const key=normProductDescription(p.description);if(!key)continue;
        if(!byDescription.has(key))byDescription.set(key,[]);byDescription.get(key).push(p);
      }
      productPriceUpdateSession={
        activeProducts:active,
        byDescription,
        matchedIds:new Set(),
        pending:new Map(),
        winpriserRows:0,
        winpriserRowsMatched:0,
        winpriserRowsUnmatched:0,
        invalidRows:0,
        startedAt:Date.now()
      };
      return json(res,200,{ok:true,activeTotal:active.length});
    }catch(e){return json(res,400,{ok:false,error:String(e.message||e)});}
  }
  if(req.method==='POST' && url.pathname==='/api/products/price-analysis/chunk'){
    try{
      if(!productPriceUpdateSession)return json(res,400,{error:'Aucune analyse Winpriser en cours'});
      const body=await parseBody(req),rows=Array.isArray(body.products)?body.products:[];
      for(const row of rows){
        productPriceUpdateSession.winpriserRows++;
        const description=String(row.description||'').trim(),key=normProductDescription(description),newList=num(row.listPrice,NaN);
        if(!key||!Number.isFinite(newList)){productPriceUpdateSession.invalidRows++;continue;}
        const matches=productPriceUpdateSession.byDescription.get(key)||[];
        if(!matches.length){productPriceUpdateSession.winpriserRowsUnmatched++;continue;}
        productPriceUpdateSession.winpriserRowsMatched++;
        for(const existing of matches){
          productPriceUpdateSession.matchedIds.add(existing.id);
          const oldList=num(existing.listPrice,0);
          if(Math.abs(oldList-newList)>0.004){productPriceUpdateSession.pending.set(existing.id,newList);}
          else productPriceUpdateSession.pending.delete(existing.id);
        }
      }
      const matched=productPriceUpdateSession.matchedIds.size,adjustments=productPriceUpdateSession.pending.size;
      return json(res,200,{ok:true,received:productPriceUpdateSession.winpriserRows,matched,adjustments,notRecognized:Math.max(0,productPriceUpdateSession.activeProducts.length-matched)});
    }catch(e){return json(res,400,{ok:false,error:String(e.message||e)});}
  }
  if(req.method==='POST' && url.pathname==='/api/products/price-analysis/summary'){
    if(!productPriceUpdateSession)return json(res,400,{error:'Aucune analyse Winpriser en cours'});
    const activeTotal=productPriceUpdateSession.activeProducts.length,matched=productPriceUpdateSession.matchedIds.size,adjustments=productPriceUpdateSession.pending.size,unchanged=Math.max(0,matched-adjustments),notRecognized=Math.max(0,activeTotal-matched);
    const unmatchedSample=productPriceUpdateSession.activeProducts.filter(p=>!productPriceUpdateSession.matchedIds.has(p.id)).slice(0,25).map(p=>({code:p.code,description:p.description,listPrice:p.listPrice}));
    return json(res,200,{ok:true,activeTotal,matched,adjustments,unchanged,notRecognized,winpriserRows:productPriceUpdateSession.winpriserRows,winpriserRowsUnmatched:productPriceUpdateSession.winpriserRowsUnmatched,invalidRows:productPriceUpdateSession.invalidRows,unmatchedSample});
  }
  if(req.method==='POST' && url.pathname==='/api/products/price-analysis/apply'){
    try{
      if(!productPriceUpdateSession)return json(res,400,{error:'Aucune analyse Winpriser en cours'});
      let updated=0;
      for(const [id,newList] of productPriceUpdateSession.pending){
        const existing=productByIdMap.get(String(id));if(!existing||existing.active===false)continue;
        const oldList=num(existing.listPrice,0),ratio=oldList>0?newList/oldList:null;
        const patch={...existing,listPrice:newList,source:existing.source||'winpriser'};
        if(ratio!==null){patch.costPrice=num(existing.costPrice,0)*ratio;patch.perras1Price=num(existing.perras1Price,0)*ratio;}
        const p=normalizeProduct(patch,existing),i=productStore.findIndex(x=>x.id===existing.id);if(i>=0){productStore[i]=p;updated++;}
      }
      const activeTotal=productPriceUpdateSession.activeProducts.length,matched=productPriceUpdateSession.matchedIds.size,notRecognized=Math.max(0,activeTotal-matched),unchanged=Math.max(0,matched-updated);
      productPriceUpdateSession=null;saveProductStore();
      return json(res,200,{ok:true,updated,activeTotal,matched,unchanged,notRecognized,total:productStore.length,stats:productStatsCache});
    }catch(e){return json(res,400,{ok:false,error:String(e.message||e)});}
  }

  if(req.method==='POST' && url.pathname==='/api/nexus'){
    try{const body=await parseBody(req);body.role=onlineUser.role;body.name=onlineUser.name;const result=await askNexusAI(body);return json(res,200,{ok:true,...result});}
    catch(e){return json(res,503,{ok:false,error:String(e.message||e),configured:nexusConfigured()});}
  }

  if(req.method==='GET' && url.pathname==='/api/google-status')return json(res,200,{ok:true,oauthReady:googleOAuthReady(),connected:googleConnected(),configured:googleConfigured(),businesses:googleBusinessConfigs(),lastSync:readReviewStore().lastSync});
  if(req.method==='GET' && url.pathname==='/api/google-oauth/start'){
    if(!googleOAuthReady())return json(res,503,{error:'Ajoutez GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET dans server/.env avant de connecter Google.'});
    const state=crypto.randomBytes(24).toString('hex'),redirectUri=googleRedirectUri(req);oauthStateStore.set(state,{created:Date.now(),redirectUri});
    const qs=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:redirectUri,response_type:'code',scope:'https://www.googleapis.com/auth/business.manage',access_type:'offline',prompt:'consent',state});
    return redirect(res,`https://accounts.google.com/o/oauth2/v2/auth?${qs}`);
  }
  if(req.method==='GET' && url.pathname==='/api/google-oauth/callback'){
    const state=url.searchParams.get('state')||'',code=url.searchParams.get('code')||'',err=url.searchParams.get('error')||'',pending=oauthStateStore.get(state);oauthStateStore.delete(state);
    if(err)return redirect(res,`/app.html?google=error&reason=${encodeURIComponent(err)}#reports`);
    if(!pending||Date.now()-pending.created>15*60*1000||!code)return redirect(res,'/app.html?google=error#reports');
    try{await exchangeGoogleCode(code,pending.redirectUri);return redirect(res,'/app.html?google=connected#reports');}
    catch(e){console.error('OAuth Google:',e.message);return redirect(res,`/app.html?google=error&reason=${encodeURIComponent(e.message)}#reports`);}
  }
  if(req.method==='GET' && url.pathname==='/api/google-business/discover'){
    try{return json(res,200,{ok:true,locations:await discoverGoogleLocations(),businesses:googleBusinessConfigs()});}
    catch(e){return json(res,503,{ok:false,error:String(e.message||e)});}
  }
  if(req.method==='POST' && url.pathname==='/api/google-business/config'){
    try{const body=await parseBody(req),allowed=new Set(['gb1','gb2','gb3']),businesses=(body.businesses||[]).filter(x=>allowed.has(x.id)).map(x=>({id:x.id,name:String(x.name||''),accountId:cleanResourceId(x.accountId,'accounts'),locationId:cleanResourceId(x.locationId,'locations'),locationName:String(x.locationName||'')}));writeJson(GOOGLE_CONFIG_STORE,{version:1,updatedAt:new Date().toISOString(),businesses});return json(res,200,{ok:true,businesses:googleBusinessConfigs(),configured:googleConfigured()});}
    catch(e){return json(res,400,{ok:false,error:'Configuration Google invalide.'});}
  }
  if(req.method==='GET' && url.pathname==='/api/google-reviews'){
    const stored=readReviewStore();return json(res,200,{ok:true,configured:googleConfigured(),connected:googleConnected(),reviews:stored.reviews,businesses:googleBusinessConfigs(),lastSync:stored.lastSync});
  }
  if(req.method==='POST' && url.pathname==='/api/google-reviews/sync'){
    try{const data=await syncGoogleReviews();return json(res,200,{ok:true,...data});}
    catch(e){return json(res,503,{error:String(e.message||e),configured:googleConfigured(),connected:googleConnected(),reviews:readReviewStore().reviews,businesses:googleBusinessConfigs()});}
  }
  if(req.method==='POST' && url.pathname==='/api/google-reviews/pubsub'){
    const expected=process.env.GOOGLE_PUBSUB_TOKEN||'';if(expected && url.searchParams.get('token')!==expected)return json(res,403,{error:'Jeton Pub/Sub invalide'});
    res.writeHead(204);res.end();syncGoogleReviews().catch(err=>console.error('Synchronisation Google après notification:',err.message));return;
  }

  staticFile(req,res);
});

async function startV35Online(){
  await online.init();
  const cloudProducts=await online.loadProducts();
  if(Array.isArray(cloudProducts)&&cloudProducts.length){productStore=cloudProducts.map(x=>normalizeProduct(x,x));rebuildProductIndexes();}
  else await online.saveProducts(productStore);

  // Sur Render, le disque web est éphémère. On restaure le dernier REDBOOK.DAT depuis PostgreSQL.
  try{const stored=await online.loadBinary('REDBOOK.DAT');if(stored?.content){const dir=path.join('/tmp','perras-winpriser');fs.mkdirSync(dir,{recursive:true});const f=path.join(dir,'REDBOOK.DAT');fs.writeFileSync(f,stored.content);allpriser.setDatFile(f);}}catch(e){console.error('Restauration REDBOOK.DAT:',e.message);}

  server.listen(PORT,'0.0.0.0',()=>{
    console.log(`Perras ERP V35 Online: http://localhost:${PORT}`);
    console.log(`Stockage central: ${online.mode()}.`);
    console.log(`Catalogue produits serveur: ${productStore.length} produit(s).`);
    console.log(nexusConfigured()?'Nexus AI connecté à OpenAI.':'Nexus AI: ajoutez OPENAI_API_KEY dans les variables d’environnement.');
  });
  if(googleConfigured()){
    setTimeout(()=>syncGoogleReviews().catch(e=>console.error('Sync Google initiale:',e.message)),2500);
    setInterval(()=>syncGoogleReviews().catch(e=>console.error('Sync Google périodique:',e.message)),15*60*1000).unref();
  }
}
startV35Online().catch(e=>{console.error('Démarrage V35 Online impossible:',e);process.exit(1);});
