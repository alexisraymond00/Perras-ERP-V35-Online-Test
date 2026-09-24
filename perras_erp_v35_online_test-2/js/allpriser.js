const fs = require('fs');
const path = require('path');

function cleanText(buf){
  if(!buf || !buf.length) return '';
  const end = (()=>{let i=buf.length;while(i>0&&(buf[i-1]===0x20||buf[i-1]===0x00))i--;return i;})();
  return buf.subarray(0,end).toString('utf8').replace(/\uFFFD/g,'').trim();
}

function readDbf(file){
  const data=fs.readFileSync(file);
  if(data.length<33) throw new Error(`DBF invalide: ${path.basename(file)}`);
  const recordCount=data.readUInt32LE(4), headerLen=data.readUInt16LE(8), recordLen=data.readUInt16LE(10);
  const fields=[];
  let pos=32;
  while(pos<data.length && data[pos]!==0x0D){
    const d=data.subarray(pos,pos+32);
    const name=d.subarray(0,11).toString('ascii').split('\0')[0];
    fields.push({name,type:String.fromCharCode(d[11]),length:d[16],decimals:d[17]});
    pos+=32;
  }
  const rows=[];
  let offset=headerLen;
  for(let i=0;i<recordCount && offset+recordLen<=data.length;i++,offset+=recordLen){
    const rec=data.subarray(offset,offset+recordLen);if(rec[0]===0x2A)continue;
    let p=1;const row={};
    for(const f of fields){
      const raw=rec.subarray(p,p+f.length);p+=f.length;const txt=cleanText(raw);
      if(f.type==='N'||f.type==='F') row[f.name]=txt===''?null:Number(txt);
      else if(f.type==='L') row[f.name]=/^[YyTt1]$/.test(txt);
      else if(f.type==='D'&&/^\d{8}$/.test(txt)) row[f.name]=`${txt.slice(0,4)}-${txt.slice(4,6)}-${txt.slice(6,8)}`;
      else row[f.name]=txt;
    }
    rows.push(row);
  }
  return rows;
}

function normCode(v){return String(v??'').trim().toUpperCase();}
function normDesc(v){
  return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function parseCsvLine(line){
  const out=[];let cur='',quoted=false,fieldStart=true;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(quoted){
      if(ch==='"'){
        if(line[i+1]==='"'){cur+='"';i++;}
        else quoted=false;
      }else cur+=ch;
      continue;
    }
    if(ch===',' ){out.push(cur);cur='';fieldStart=true;continue;}
    if(ch==='"'&&fieldStart){quoted=true;fieldStart=false;continue;}
    cur+=ch;fieldStart=false;
  }
  out.push(cur);return out;
}
function parseDatDate(v){
  const s=String(v||'').trim();
  return /^\d{8}$/.test(s)?`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`:s;
}
function readRedbookDat(file){
  const raw=fs.readFileSync(file);
  let text=raw.toString('utf8');
  if((text.match(/\uFFFD/g)||[]).length>20)text=raw.toString('latin1');
  const rows=[];
  for(const line0 of text.split(/\r?\n/)){
    const line=line0.trim();if(!line)continue;
    const c=parseCsvLine(line);if(c.length<20)continue;
    const size=String(c[1]||'').trim(),baseDesc=String(c[2]||'').trim();
    const description=[size,baseDesc].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
    const listPrice=Number(String(c[4]||'').replace(',','.'));
    if(!description||!Number.isFinite(listPrice))continue;
    rows.push({
      nctlg:null,sibca:String(c[0]||'').trim(),oldSibca:'',inventoryItem:'',description,listPrice,
      revisedDate:parseDatDate(c[19]),updateBatch:String(c[18]||'').trim(),unit:String(c[3]||'').trim(),
      page:String(c[6]||'').trim(),typeCode:String(c[12]||'').trim(),typeDescription:String(c[13]||'').trim(),
      groupCode:String(c[14]||'').trim(),groupDescription:String(c[15]||'').trim()
    });
  }
  return rows;
}

function createAllpriserService(opts={}){
  const mappingFile=opts.mappingFile || path.join(__dirname,'allpriser_master_mapping.json');
  let mapping={codeToNctlg:{},nctlgToUniqueCode:{},confidentMappings:0,totalExcelRows:0};
  try{mapping=JSON.parse(fs.readFileSync(mappingFile,'utf8'));}catch(_){/* optional */}
  const masterProductsFile=opts.masterProductsFile || path.join(__dirname,'allpriser_master_products.json');
  let masterProductsData={count:0,products:[]};
  try{masterProductsData=JSON.parse(fs.readFileSync(masterProductsFile,'utf8'));}catch(_){/* optional */}
  const configFile=opts.configFile || path.join(__dirname,'allpriser_config.json');
  let cache=null;

  function readConfig(){
    try{const x=JSON.parse(fs.readFileSync(configFile,'utf8'));return x&&typeof x==='object'?x:{};}catch(_){return {};}
  }
  function writeConfig(value){
    fs.writeFileSync(configFile,JSON.stringify(value,null,2),'utf8');
    return value;
  }
  function validDatFile(file){
    if(!file)return false;
    try{return fs.statSync(file).isFile()&&/\.dat$/i.test(file);}catch(_){return false;}
  }
  function candidateDatFiles(){
    const cfg=readConfig();
    const localBundled=path.resolve(__dirname,'..','Winpriser20','REDBOOK.DAT');
    const cwdBundled=path.resolve(process.cwd(),'Winpriser20','REDBOOK.DAT');
    const items=[process.env.WINPRISER_DAT,cfg.datFile,'C:\\Winpriser20\\REDBOOK.DAT','D:\\Winpriser20\\REDBOOK.DAT',localBundled,cwdBundled];
    const out=[];for(const x of items){const v=String(x||'').trim();if(v&&!out.includes(v))out.push(v);}return out;
  }
  function datFile(){
    const cfg=readConfig(),envPath=String(process.env.WINPRISER_DAT||'').trim(),cfgPath=String(cfg.datFile||'').trim();
    if(envPath&&validDatFile(envPath))return envPath;
    if(cfgPath&&validDatFile(cfgPath))return cfgPath;
    return candidateDatFiles().find(validDatFile)||'';
  }
  function setDatFile(value){
    const v=String(value||'').trim();
    if(!v)throw new Error('Sélectionnez un fichier REDBOOK.DAT.');
    if(!validDatFile(v))throw new Error(`Fichier DAT introuvable ou invalide : ${v}`);
    const cfg=readConfig();writeConfig({...cfg,datFile:v,updatedAt:new Date().toISOString(),sourceType:'DAT'});cache=null;return status();
  }
  function validCatalogFolder(base){
    if(!base)return false;
    try{return ['Red__01.dbf','Red__04.dbf','Red__05.dbf'].every(n=>fs.existsSync(path.join(base,n)));}catch(_){return false;}
  }
  function candidateFolders(){
    const cfg=readConfig();
    const localBundled=path.resolve(__dirname,'..','Winpriser20');
    const cwdBundled=path.resolve(process.cwd(),'Winpriser20');
    const siblingBundled=path.resolve(process.cwd(),'..','Winpriser20');
    const items=[process.env.WINPRISER_PATH,cfg.path,'C:\\Winpriser20','D:\\Winpriser20','C:\\Program Files\\Winpriser20','C:\\Program Files (x86)\\Winpriser20',localBundled,cwdBundled,siblingBundled];
    const out=[];for(const x of items){const v=String(x||'').trim();if(v&&!out.includes(v))out.push(v);}return out;
  }
  function folder(){
    const cfg=readConfig();
    const envPath=String(process.env.WINPRISER_PATH||'').trim();
    const cfgPath=String(cfg.path||'').trim();
    if(envPath&&validCatalogFolder(envPath))return envPath;
    if(cfgPath&&validCatalogFolder(cfgPath))return cfgPath;
    const detected=candidateFolders().find(validCatalogFolder);
    return detected||envPath||cfgPath||'C:\\Winpriser20';
  }
  function setFolder(value){
    const v=String(value||'').trim().replace(/[\\/]+$/,'');
    if(!v)throw new Error('Entrez le dossier Winpriser, par exemple C:\\Winpriser20.');
    if(!validCatalogFolder(v))throw new Error(`Ce dossier ne contient pas Red__01.dbf, Red__04.dbf et Red__05.dbf : ${v}`);
    const cfg=readConfig();writeConfig({...cfg,path:v,datFile:'',updatedAt:new Date().toISOString(),sourceType:'DBF'});cache=null;return status();
  }
  function detectFolder(){
    const candidates=candidateFolders();
    const found=candidates.find(validCatalogFolder);
    if(found){const cfg=readConfig();writeConfig({...cfg,path:found,updatedAt:new Date().toISOString(),detected:true});cache=null;return {ok:true,path:found,candidates};}
    return {ok:false,path:folder(),candidates,error:'Winpriser non détecté automatiquement. Entrez le chemin du dossier contenant Red__01.dbf, Red__04.dbf et Red__05.dbf.'};
  }
  function requiredFiles(){const base=folder();return ['Red__01.dbf','Red__04.dbf','Red__05.dbf'].map(n=>path.join(base,n));}
  function activeSource(){const dat=datFile();return dat?{type:'DAT',path:dat}:{type:'DBF',path:folder()};}
  function signature(){
    const src=activeSource();
    if(src.type==='DAT'){const st=fs.statSync(src.path);return `DAT:${src.path}:${st.size}:${st.mtimeMs}`;}
    return requiredFiles().map(f=>{const st=fs.statSync(f);return `${f}:${st.size}:${st.mtimeMs}`;}).join('|');
  }
  function buildCacheFromRows(rows,sig,sourceType,sourcePath){
    const byN=new Map(),bySibca=new Map(),descBuckets=new Map();let revisedDate='',updateBatch='',seq=1;
    for(const src of rows){
      const row={...src};if(row.nctlg===null||row.nctlg===undefined||row.nctlg==='')row.nctlg=seq++;
      byN.set(Number(row.nctlg),row);if(row.sibca)bySibca.set(normCode(row.sibca),row);
      const nd=normDesc(row.description);if(nd){const arr=descBuckets.get(nd)||[];arr.push(row);descBuckets.set(nd,arr);}
      if(String(row.revisedDate||'')>revisedDate)revisedDate=String(row.revisedDate||'');if(row.updateBatch)updateBatch=String(row.updateBatch);
    }
    const byDescUnique=new Map();for(const [k,arr] of descBuckets)if(arr.length===1)byDescUnique.set(k,arr[0]);
    return {signature:sig,loadedAt:new Date().toISOString(),count:byN.size,byN,bySibca,byDescUnique,descBuckets,rows:[...byN.values()],revisedDate,updateBatch,sourceType,sourcePath};
  }
  function load(){
    const src=activeSource();
    if(src.type==='DAT'){
      if(!validDatFile(src.path))throw new Error(`REDBOOK.DAT introuvable : ${src.path}`);
      const sig=signature();if(cache&&cache.signature===sig)return cache;
      cache=buildCacheFromRows(readRedbookDat(src.path),sig,'DAT',src.path);return cache;
    }
    const files=requiredFiles();const missing=files.filter(f=>!fs.existsSync(f));
    if(missing.length) throw new Error(`Catalogue Winpriser introuvable. Importez REDBOOK.DAT ou fournissez les DBF. Fichier(s) manquant(s): ${missing.map(x=>path.basename(x)).join(', ')}. Dossier attendu: ${folder()}`);
    const sig=signature();if(cache&&cache.signature===sig)return cache;
    const base=folder();
    const products=readDbf(path.join(base,'Red__01.dbf'));
    const codes=readDbf(path.join(base,'Red__04.dbf'));
    const prices=readDbf(path.join(base,'Red__05.dbf'));
    const codeByN=new Map(codes.map(r=>[Number(r.NCTLG),r]));
    const priceByN=new Map(prices.map(r=>[Number(r.NCTLG),r]));
    const rows=[];
    for(const p of products){
      const n=Number(p.NCTLG),c=codeByN.get(n)||{},pr=priceByN.get(n)||{};
      rows.push({nctlg:n,sibca:String(c.SIBCA||''),oldSibca:String(c.SOLDIBCA||''),inventoryItem:String(c.SINVITEM||''),description:String(p.SITEMDESC||''),listPrice:num(pr.NLIST),revisedDate:String(pr.DREVISED||''),updateBatch:String(pr.SUPDATE||''),unit:String(pr.SMEAS||'')});
    }
    cache=buildCacheFromRows(rows,sig,'DBF',base);return cache;
  }

  function status(){
    try{const c=load();return {ok:true,path:c.sourcePath||folder(),sourceType:c.sourceType||'DBF',activeFile:c.sourceType==='DAT'?path.basename(c.sourcePath):'',count:c.count,loadedAt:c.loadedAt,revisedDate:c.revisedDate,updateBatch:c.updateBatch,masterRows:Number(mapping.totalExcelRows||0),masterMappings:Number(mapping.confidentMappings||Object.keys(mapping.codeToNctlg||{}).length)};}
    catch(e){return {ok:false,path:folder(),error:String(e.message||e),candidates:candidateFolders(),serverPlatform:process.platform,masterRows:Number(mapping.totalExcelRows||0),masterMappings:Number(mapping.confidentMappings||Object.keys(mapping.codeToNctlg||{}).length)};}
  }

  function resolveProduct(p,c){
    const existingN=Number(p.allpriserNctlg||0);if(existingN&&c.byN.has(existingN))return {row:c.byN.get(existingN),method:'Lien Allpriser enregistré'};
    const currentCode=String(p.code||'').trim();const mappedN=Number(mapping.codeToNctlg?.[currentCode]||0);if(mappedN&&c.byN.has(mappedN))return {row:c.byN.get(mappedN),method:'Code maître Perras'};
    const byCode=c.bySibca.get(normCode(currentCode));if(byCode)return {row:byCode,method:'Code Winpriser'};
    const byDesc=c.byDescUnique.get(normDesc(p.description));if(byDesc)return {row:byDesc,method:'Description correspondante'};
    return null;
  }

  function compare(products,thresholdPct=30){
    const c=load(),threshold=Math.max(0,Number(thresholdPct)||30),changes=[],unmatched=[];
    let matched=0,unchanged=0,safe=0,review=0;
    for(const p of Array.isArray(products)?products:[]){
      const hit=resolveProduct(p,c);if(!hit){unmatched.push({id:p.id,code:p.code||'',description:p.description||''});continue;}
      matched++;const row=hit.row,oldPrice=num(p.listPrice),newPrice=num(row.listPrice);
      let newCode=String(p.code||'');const mappedCurrent=Number(mapping.codeToNctlg?.[newCode]||0);
      if(mappedCurrent!==row.nctlg){const uniqueMaster=mapping.nctlgToUniqueCode?.[String(row.nctlg)];if(uniqueMaster)newCode=String(uniqueMaster);}
      const codeChanged=String(p.code||'')!==newCode,descriptionChanged=String(p.description||'')!==row.description,priceChanged=Math.abs(oldPrice-newPrice)>=0.005;
      if(!codeChanged&&!descriptionChanged&&!priceChanged){unchanged++;continue;}
      const variationPct=oldPrice>0?((newPrice-oldPrice)/oldPrice)*100:null;
      const needsReview=variationPct!==null&&Math.abs(variationPct)>threshold;
      if(needsReview)review++;else safe++;
      changes.push({
        id:p.id,oldCode:String(p.code||''),newCode,oldDescription:String(p.description||''),newDescription:row.description,
        oldPrice,newPrice,variationPct,needsReview,status:needsReview?'À VÉRIFIER':'OK',matchMethod:hit.method,
        allpriserNctlg:row.nctlg,allpriserSibca:row.sibca,revisedDate:row.revisedDate,updateBatch:row.updateBatch,
        codeChanged,descriptionChanged,priceChanged
      });
    }
    return {ok:true,thresholdPct:threshold,catalog:{path:c.sourcePath||folder(),sourceType:c.sourceType||'DBF',count:c.count,revisedDate:c.revisedDate,updateBatch:c.updateBatch},summary:{erpProducts:Array.isArray(products)?products.length:0,matched,changed:changes.length,safe,review,unchanged,unmatched:unmatched.length},changes,unmatched:unmatched.slice(0,500)};
  }

  function compareByDescription(products,thresholdPct=30){
    const c=load(),threshold=Math.max(0,Number(thresholdPct)||30),changes=[],unmatched=[],ambiguous=[];
    let matched=0,unchanged=0,safe=0,review=0,duplicateSamePrice=0;
    for(const p of Array.isArray(products)?products:[]){
      const key=normDesc(p.description);
      if(!key){unmatched.push({id:p.id,code:p.code||'',description:p.description||'',reason:'Description vide'});continue;}
      const candidates=c.descBuckets.get(key)||[];
      if(!candidates.length){unmatched.push({id:p.id,code:p.code||'',description:p.description||'',reason:'Aucune description identique dans Winpriser'});continue;}
      let row=null,method='Description exacte';
      if(candidates.length===1){row=candidates[0];}
      else{
        const byPrice=new Map();
        for(const r of candidates){const k=num(r.listPrice).toFixed(4);if(!byPrice.has(k))byPrice.set(k,[]);byPrice.get(k).push(r);}
        if(byPrice.size===1){row=candidates[0];method='Description exacte (doublons au même prix)';duplicateSamePrice++;}
        else{
          ambiguous.push({id:p.id,code:p.code||'',description:p.description||'',matches:candidates.slice(0,8).map(r=>({nctlg:r.nctlg,sibca:r.sibca,description:r.description,listPrice:r.listPrice}))});
          continue;
        }
      }
      matched++;
      const oldPrice=num(p.listPrice),newPrice=num(row.listPrice);
      if(Math.abs(oldPrice-newPrice)<0.005){unchanged++;continue;}
      const variationPct=oldPrice>0?((newPrice-oldPrice)/oldPrice)*100:null;
      const needsReview=variationPct!==null&&Math.abs(variationPct)>threshold;
      if(needsReview)review++;else safe++;
      changes.push({
        id:p.id,oldCode:String(p.code||''),newCode:String(p.code||''),oldDescription:String(p.description||''),newDescription:row.description,
        oldPrice,newPrice,variationPct,needsReview,status:needsReview?'À VÉRIFIER':'OK',matchMethod:method,
        allpriserNctlg:row.nctlg,allpriserSibca:row.sibca,revisedDate:row.revisedDate,updateBatch:row.updateBatch,
        codeChanged:false,descriptionChanged:false,priceChanged:true
      });
    }
    return {ok:true,matchMode:'description-exacte',thresholdPct:threshold,catalog:{path:c.sourcePath||folder(),sourceType:c.sourceType||'DBF',count:c.count,revisedDate:c.revisedDate,updateBatch:c.updateBatch},summary:{erpProducts:Array.isArray(products)?products.length:0,matched,changed:changes.length,safe,review,unchanged,unmatched:unmatched.length,ambiguous:ambiguous.length,duplicateSamePrice},changes,unmatched:unmatched.slice(0,500),ambiguous:ambiguous.slice(0,300)};
  }

  function search(q,limit=50){
    const c=load(),term=normDesc(q),code=normCode(q);if(!term&&!code)return [];
    const out=[];for(const r of c.rows){if(normCode(r.sibca).includes(code)||normDesc(r.description).includes(term)){out.push(r);if(out.length>=limit)break;}}return out;
  }

  function masterProducts(){
    const c=load();
    const src=Array.isArray(masterProductsData.products)?masterProductsData.products:[];
    const rows=src.map(p=>{
      const n=Number(p.allpriserNctlg||mapping.codeToNctlg?.[String(p.code||'')]||0);
      const live=n?c.byN.get(n):null;
      return {
        code:String(p.code||''),
        description:live?.description||String(p.description||''),
        listPrice:live?num(live.listPrice):num(p.listPrice),
        allpriserNctlg:live?.nctlg||n||null,
        allpriserSibca:live?.sibca||'',
        revisedDate:live?.revisedDate||'',
        updateBatch:live?.updateBatch||'',
        matched:!!live
      };
    });
    return {ok:true,count:rows.length,matched:rows.filter(x=>x.matched).length,unmatched:rows.filter(x=>!x.matched).length,catalog:{path:c.sourcePath||folder(),sourceType:c.sourceType||'DBF',count:c.count,revisedDate:c.revisedDate,updateBatch:c.updateBatch},products:rows};
  }

  return {status,compare,compareByDescription,search,masterProducts,folder,load,setFolder,detectFolder,candidateFolders,datFile,setDatFile,candidateDatFiles};
}

module.exports={createAllpriserService};
