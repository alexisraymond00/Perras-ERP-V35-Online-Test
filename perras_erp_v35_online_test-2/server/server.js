const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

function normText(v=''){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();}
function normProductDescription(v=''){return normText(v).replace(/[’'`]/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();}
function smartProductTokens(v=''){
  let s=normText(v).replace(/[½]/g,' 1/2 ').replace(/[¼]/g,' 1/4 ').replace(/[¾]/g,' 3/4 ');
  s=s.replace(/(\d),(\d)/g,'$1.$2').replace(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/g,' $1 $2 ');
  s=s.replace(/(\d+)\s*[- ]\s*(\d+)\s*\/\s*(\d+)/g,(_,a,b,c)=>` dim${(Number(a)+Number(b)/Number(c)).toFixed(3).replace(/0+$/,'').replace(/\.$/,'')} `);
  s=s.replace(/\b(\d+)\s*\/\s*(\d+)\b/g,(_,a,b)=>` dim${(Number(a)/Number(b)).toFixed(3).replace(/0+$/,'').replace(/\.$/,'')} `);
  s=s.replace(/\bp\s*[- ]?\s*trap\b/g,' ptrap ').replace(/\bball\s+valve\b/g,' ballvalve ').replace(/\bcheck\s+valve\b/g,' checkvalve ').replace(/\bwater\s+heater\b/g,' waterheater ').replace(/\bsump\s+pump\b/g,' sumppump ').replace(/\bchauffe\s*[- ]?eau\b/g,' waterheater ').replace(/\bpompe\s+(?:de\s+)?puisard\b/g,' sumppump ').replace(/\bvalve\s+a\s+bille\b/g,' ballvalve ').replace(/\bpressure\s+(?:reducing\s+)?valve\b/g,' prv ').replace(/\bpressure\s+regulator\b/g,' prv ').replace(/\bwater\s+closet\b/g,' toilette ').replace(/\bclapet\s+(?:de\s+)?non\s*[- ]?retour\b/g,' checkvalve ').replace(/[^a-z0-9.]+/g,' ');
  const syn={elbow:'coude',coude:'coude',ell:'coude',ells:'coude',tee:'tee',te:'tee',trap:'ptrap',siphon:'ptrap',ptrap:'ptrap',coupling:'coupling',couplage:'coupling',manchon:'coupling',reducer:'reducer',reducteur:'reducer',reduction:'reducer',bushing:'bushing',bague:'bushing',ballvalve:'ballvalve',checkvalve:'checkvalve',clapet:'checkvalve',waterheater:'waterheater',sumppump:'sumppump',faucet:'robinet',robinet:'robinet',copper:'cuivre',cuivre:'cuivre',pipe:'tuyau',tuyau:'tuyau',adapter:'adaptateur',adaptor:'adaptateur',adaptateur:'adaptateur',union:'union',nipple:'mamelon',mamelon:'mamelon',wh:'waterheater',bv:'ballvalve',cv:'checkvalve',prv:'prv',lav:'lavabo',lavatory:'lavabo',lavabo:'lavabo',wc:'toilette',toilet:'toilette',toilette:'toilette',dwv:'dwv',abs:'abs',pvc:'pvc',pex:'pex',pexalpex:'pexalpex',cpvc:'cpvc',fip:'fip',mip:'mip',npt:'npt',hub:'hub',nohub:'nohub',cleanout:'cleanout',co:'cleanout',closet:'toilette'};
  const stop=new Set(['in','inch','inches','po','pouce','pouces','deg','degree','degrees','degre','degres','the','a','de','du','des','et','avec','pour','of']);const out=[];
  for(const t0 of s.split(/\s+/).filter(Boolean)){if(stop.has(t0))continue;let t=syn[t0]||t0;if(/^\d+(?:\.\d+)?$/.test(t)){const n=Number(t);if(n===90||n===45){out.push(`angle${n}`,'coude');continue;}if(n>0&&n<=24){out.push('dim'+String(n));continue;}}out.push(t);}return [...new Set(out)];
}
function oneEditApart(a,b){if(a===b)return true;if(!a||!b||Math.abs(a.length-b.length)>1)return false;let i=0,j=0,e=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++e>1)return false;if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++;}}return e+(i<a.length||j<b.length?1:0)<=1;}
function smartTokenPresent(t,set){if(set.has(t))return true;if(t.startsWith('dim')||t.startsWith('angle')||t.length<5)return false;for(const p of set)if(p.length>=4&&oneEditApart(t,p))return true;return false;}
function smartProductScore(product,query){const q=smartProductTokens(query);if(!q.length)return 1;const text=[product.code,product.description,product.supplierCategoryName,product.category,product.brand,product.manufacturer].join(' '),set=new Set(smartProductTokens(text));if(!q.every(t=>smartTokenPresent(t,set)))return -1;const nq=normText(query),nt=normText(text),nc=normText(product.code);let score=0;if(nc&&nq===nc)score+=250;else if(nc&&nc.startsWith(nq))score+=120;if(nq&&nt.includes(nq))score+=60;const type=new Set(['coude','ptrap','tee','coupling','reducer','bushing','ballvalve','checkvalve','waterheater','sumppump','robinet','adaptateur','union','mamelon','lavabo','toilette','prv']);for(const t of q){if(type.has(t))score+=35;else if(['abs','pvc','pex','cpvc','cuivre','pexalpex'].includes(t))score+=24;else if(t.startsWith('dim'))score+=20;else if(t.startsWith('angle'))score+=18;else score+=8;}return score;}
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
  let active=0,warehouseUnits=0,low=0,out=0,onOrder=0,costValue=0,saleValue=0;const categorySale={},categoryCount={};
  for(const p of productStore){
    productByIdMap.set(p.id,p);if(p.code)productByCodeMap.set(String(p.code).toLowerCase(),p);try{Object.defineProperty(p,'__search',{value:normText([p.code,p.description,p.supplierCategoryName,p.category].join(' ')),writable:true,configurable:true,enumerable:false});}catch(_){p.__search=normText([p.code,p.description,p.supplierCategoryName,p.category].join(' '));}
    if(p.active===false)continue;active++;categoryCount[String(p.supplierCategoryId||'')]=(categoryCount[String(p.supplierCategoryId||'')]||0)+1;const q=num(p.warehouseQty),m=num(p.minQty),cost=num(p.costPrice),list=num(p.listPrice);
    warehouseUnits+=q;onOrder+=num(p.onOrderQty);costValue+=q*cost;saleValue+=q*list;{const catName=p.supplierCategoryName||p.category||'À classer';categorySale[catName]=(categorySale[catName]||0)+q*list;}
    if(q===0)out++;else if(q<=m)low++;
  }
  productStatsCache={total:productStore.length,active,warehouseUnits,low,out,onOrder,lowIncludingOut:low+out,costValue,saleValue,categorySale,categoryCount,updatedAt:new Date().toISOString()};
}
function migratePreviousProductStoreIfNeeded(){
  // Facilite le passage V31/V32/V33/V34/V35/V36/V37 -> V38 : si ce dossier est vide, récupère automatiquement
  // le catalogue du dossier V31 voisin le plus récent. Aucun catalogue existant n'est écrasé.
  try{
    let current=[];
    try{current=JSON.parse(fs.readFileSync(PRODUCTS_STORE,'utf8'));}catch(_){current=[];}
    if(Array.isArray(current)&&current.length) return;
    const parent=path.dirname(ROOT),candidates=[];
    for(const ent of fs.readdirSync(parent,{withFileTypes:true})){
      if(!ent.isDirectory()||!/v3[1234567]/i.test(ent.name)||!/perras/i.test(ent.name)) continue;
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
  const activeOnly=params.get('activeOnly')==='1',supplierCategoryId=String(params.get('supplierCategoryId')||'');let rows=[];
  for(const p of productStore){if(activeOnly&&p.active===false)continue;if(supplierCategoryId&&String(p.supplierCategoryId||'')!==supplierCategoryId)continue;const qty=num(p.warehouseQty),min=num(p.minQty);
    if(filter==='low'&&!(p.active!==false&&qty>0&&qty<=min))continue;if(filter==='out'&&!(p.active!==false&&qty===0))continue;if(filter==='onorder'&&!(num(p.onOrderQty)>0))continue;
    const score=q?smartProductScore(p,q):0;if(q&&score<0)continue;rows.push({p,score});
  }
  if(q)rows.sort((a,b)=>b.score-a.score||String(a.p.description||'').localeCompare(String(b.p.description||''),'fr'));
  return {total:rows.length,offset,limit,items:rows.slice(offset,offset+limit).map(x=>x.p),stats:productStatsCache};
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


async function sendPurchaseOrderEmail(body={}){
  const to=String(body.to||'').trim(),subject=String(body.subject||'Bon de commande Perras').trim();
  if(!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('Courriel fournisseur invalide.');
  const html=String(body.html||''),text=String(body.text||'');
  const key=process.env.RESEND_API_KEY||'',from=process.env.PO_EMAIL_FROM||process.env.EMAIL_FROM||'';
  if(!key || !from) throw new Error('Envoi direct non configuré. Ajoutez RESEND_API_KEY et PO_EMAIL_FROM dans server/.env.');
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({from,to:[to],subject,html,text})});
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data?.message||data?.error?.message||`Service courriel ${r.status}`);
  return data;
}

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
  if(req.method==='GET' && url.pathname==='/api/health') return json(res,200,{ok:true,online:true,storage:online.mode(),nexus:nexusConfigured(),googleOAuthReady:googleOAuthReady(),googleConnected:googleConnected(),googleReviews:googleConfigured(),googleLastSync:readReviewStore().lastSync});

  // Connexion centrale V38 — identifiant + mot de passe, session serveur 6 mois.
  if(req.method==='POST' && url.pathname==='/api/auth/login'){
    try{const body=await parseBody(req),user=await online.authenticate(body.username,body.password);if(!user)return json(res,401,{ok:false,error:'Identifiant ou mot de passe invalide.'});const sess=await online.createSession(user);res.setHeader('Set-Cookie',online.cookieFor(sess.token));return json(res,200,{ok:true,user,expiresAt:sess.expiresAt});}
    catch(e){return json(res,400,{ok:false,error:String(e.message||e)});}
  }
  if(req.method==='POST' && url.pathname==='/api/auth/logout'){await online.deleteSession(req);res.setHeader('Set-Cookie',online.cookieFor('',true));return json(res,200,{ok:true});}
  if(req.method==='GET' && url.pathname==='/api/auth/me'){const user=await online.sessionUser(req);return user?json(res,200,{ok:true,user}):json(res,401,{ok:false,error:'Session expirée'});}

  const isPublicWebhook=url.pathname==='/api/google-reviews/pubsub';
  const onlineUser=await online.sessionUser(req);
  if(url.pathname.startsWith('/api/') && !isPublicWebhook && !onlineUser) return json(res,401,{ok:false,error:'Connexion requise'});

  if(req.method==='GET' && url.pathname==='/api/cloud/bootstrap'){
    const rows=await online.getStateAll(),now=new Date().toISOString();return json(res,200,{ok:true,user:onlineUser,rows,serverTime:now,storage:online.mode()});
  }
  if(req.method==='GET' && url.pathname==='/api/cloud/changes'){
    const rows=await online.getStateChanges(url.searchParams.get('since')||'1970-01-01T00:00:00.000Z');return json(res,200,{ok:true,rows,serverTime:new Date().toISOString()});
  }
  if(req.method==='POST' && url.pathname==='/api/cloud/state'){
    try{const body=await parseBody(req);const meta=await online.setState(body.key,body.value,onlineUser);return json(res,200,{ok:true,...meta});}
    catch(e){return json(res,403,{ok:false,error:String(e.message||e)});}
  }

  /* ===================== Numérotation PO centrale ===================== */
  if(req.method==='POST' && url.pathname==='/api/po-number/reserve'){
    try{const body=await parseBody(req),number=await online.reservePoNumber(body.prefix,onlineUser,body.source||'po');return json(res,200,{ok:true,number});}
    catch(e){return json(res,400,{ok:false,error:String(e.message||e)});}
  }
  if(req.method==='POST' && url.pathname==='/api/po-number/commit'){
    try{const body=await parseBody(req),number=await online.commitPoNumber(body.number,onlineUser,body.documentId||'',body.source||'po');return json(res,200,{ok:true,number});}
    catch(e){return json(res,400,{ok:false,error:String(e.message||e)});}
  }
  if(req.method==='POST' && url.pathname==='/api/po-number/release'){
    try{const body=await parseBody(req);await online.releasePoNumber(body.number);return json(res,200,{ok:true});}
    catch(e){return json(res,400,{ok:false,error:String(e.message||e)});}
  }

  /* ===================== Transfert inventaire Shop <-> camion ===================== */
  if(req.method==='POST' && url.pathname==='/api/inventory/transfer'){
    try{
      const body=await parseBody(req),productId=String(body.productId||''),direction=String(body.direction||''),qty=num(body.qty,0);
      if(!productId||!['shop-to-truck','truck-to-shop'].includes(direction)||!(qty>0))return json(res,400,{ok:false,error:'Transfert invalide'});
      const truckId=onlineUser.role==='tech'?String(onlineUser.truckId||''):String(body.truckId||'');
      if(!truckId)return json(res,400,{ok:false,error:'Aucun camion assigné'});
      const p=productByIdMap.get(productId);if(!p)return json(res,404,{ok:false,error:'Produit introuvable'});
      const rows=await online.getStateAll(),stateRow=rows.find(x=>x.key==='truckStock'),stock=Array.isArray(stateRow?.value)?JSON.parse(JSON.stringify(stateRow.value)):[];
      let tr=stock.find(x=>String(x.truckId)===truckId&&String(x.productId)===productId);if(!tr){tr={truckId,productId,qty:0};stock.push(tr);}
      if(direction==='shop-to-truck'){
        if(num(p.warehouseQty)<qty)return json(res,409,{ok:false,error:`Stock Shop insuffisant (${num(p.warehouseQty)} disponible)`});
        p.warehouseQty=num(p.warehouseQty)-qty;tr.qty=num(tr.qty)+qty;
      }else{
        if(num(tr.qty)<qty)return json(res,409,{ok:false,error:`Stock camion insuffisant (${num(tr.qty)} disponible)`});
        tr.qty=num(tr.qty)-qty;p.warehouseQty=num(p.warehouseQty)+qty;
      }
      const idx=productStore.findIndex(x=>x.id===p.id);productStore[idx]=normalizeProduct(p,p);saveProductStore();
      const clean=stock.filter(x=>num(x.qty)>0);await online.setState('truckStock',clean,onlineUser);
      return json(res,200,{ok:true,product:productByIdMap.get(productId),truckQty:num(tr.qty),truckStock:clean,stats:productStatsCache});
    }catch(e){return json(res,400,{ok:false,error:String(e.message||e)});}
  }

  /* ===================== Catalogue produits persistant ===================== */
  if(req.method==='GET' && url.pathname==='/api/products/stats') return json(res,200,{ok:true,stats:productStatsCache});
  if(req.method==='GET' && url.pathname==='/api/products') return json(res,200,{ok:true,...productQuery(url.searchParams)});
  if(req.method==='POST' && url.pathname==='/api/products/category-sync'){
    try{const {categoryId,name}=await parseBody(req);const cid=String(categoryId||''),label=String(name||'').trim();if(!cid||!label)return json(res,400,{error:'Catégorie invalide'});let changed=0;for(const p of productStore){if(String(p.supplierCategoryId||'')===cid){p.category=label;p.supplierCategoryName=label;p.updatedAt=new Date().toISOString();changed++;}}if(changed)saveProductStore();return json(res,200,{ok:true,changed,stats:productStatsCache});}catch(e){return json(res,400,{error:String(e.message||e)});}
  }
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

  if(req.method==='POST' && url.pathname==='/api/purchase-orders/email'){
    try{
      const body=await parseBody(req),result=await sendPurchaseOrderEmail(body);
      return json(res,200,{ok:true,id:result?.id||'',sentAt:new Date().toISOString()});
    }catch(e){return json(res,503,{ok:false,error:String(e.message||e)});}
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

async function startV38Online(){
  await online.init();
  const cloudProducts=await online.loadProducts();
  if(Array.isArray(cloudProducts)&&cloudProducts.length){productStore=cloudProducts.map(x=>normalizeProduct(x,x));rebuildProductIndexes();}
  else await online.saveProducts(productStore);

  server.listen(PORT,'0.0.0.0',()=>{
    console.log(`Perras ERP V38 Online: http://localhost:${PORT}`);
    console.log(`Stockage central: ${online.mode()}.`);
    console.log(`Catalogue produits serveur: ${productStore.length} produit(s).`);
    console.log(nexusConfigured()?'Nexus AI connecté à OpenAI.':'Nexus AI: ajoutez OPENAI_API_KEY dans les variables d’environnement.');
    console.log(googleConfigured()?'Avis Google Business Profile activés.':googleConnected()?'Google connecté; associez les fiches dans Rapports > Avis Google.':'Avis Google: configurez les identifiants OAuth pour l’activer.');
  });
  if(googleConfigured()){
    setTimeout(()=>syncGoogleReviews().catch(e=>console.error('Sync Google initiale:',e.message)),2500);
    setInterval(()=>syncGoogleReviews().catch(e=>console.error('Sync Google périodique:',e.message)),15*60*1000).unref();
  }
}
startV38Online().catch(e=>{console.error('Démarrage V38 Online impossible:',e);process.exit(1);});
