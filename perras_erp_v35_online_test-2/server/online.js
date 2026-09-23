const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

function createOnlineService({serverDir}){
  const localFile=path.join(serverDir,'online_store.json');
  const seedFile=path.join(serverDir,'seed_state.json');
  let mode='local';
  let pool=null;
  let local={state:{},users:{},sessions:{},products:null,files:{},poNumbers:{}};
  let initialized=false;

  function passwordEnv(name,fallback){
    const value=process.env[name];
    if(value)return value;
    if(process.env.NODE_ENV==='production')throw new Error(`Variable obligatoire manquante: ${name}`);
    return fallback;
  }

  const TEST_USERS=[
    {id:'u_admin',username:'admin1',name:'Admin 1',role:'admin',password:passwordEnv('PERRAS_ADMIN1_PASSWORD','Perras!Adm01')},
    {id:'u_admin2',username:'admin2',name:'Admin 2',role:'admin',password:passwordEnv('PERRAS_ADMIN2_PASSWORD','Perras!Adm02')},
    {id:'u_bureau',username:'bureau1',name:'Bureau 1',role:'bureau',password:passwordEnv('PERRAS_BUREAU1_PASSWORD','Perras!Bur01')},
    {id:'u_bureau2',username:'bureau2',name:'Bureau 2',role:'bureau',password:passwordEnv('PERRAS_BUREAU2_PASSWORD','Perras!Bur02')},
    {id:'u_tech1',username:'tech1',name:'Tech 1',role:'tech',password:passwordEnv('PERRAS_TECH1_PASSWORD','Perras!Tech01')}
  ];

  function readLocal(){try{local=JSON.parse(fs.readFileSync(localFile,'utf8'));}catch(_){local={state:{},users:{},sessions:{},products:null,files:{},poNumbers:{}};}local.state||={};local.users||={};local.sessions||={};local.files||={};local.poNumbers||={};}
  function writeLocal(){const tmp=localFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify(local,null,2),'utf8');fs.renameSync(tmp,localFile);}
  function pbkdf2(password,salt){return crypto.pbkdf2Sync(String(password),salt,120000,32,'sha256').toString('hex');}
  function hashToken(token){return crypto.createHash('sha256').update(String(token)).digest('hex');}
  function makePassword(password){const salt=crypto.randomBytes(18).toString('hex');return {salt,hash:pbkdf2(password,salt)};}
  function safeUser(u){if(!u)return null;const base=TEST_USERS.find(x=>x.id===u.id||x.username===u.username)||{};return {id:u.id,username:u.username,name:u.name||u.display_name||base.name,role:u.role,active:u.active!==false,title:u.role==='admin'?'Administrateur':u.role==='bureau'?'Bureau':'Technicien',phone:'',...(u.role==='tech'?{truckId:'t101'}:{})};}
  function parseCookies(req){const out={};for(const part of String(req.headers.cookie||'').split(';')){const i=part.indexOf('=');if(i>0)out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());}return out;}
  function cookieFor(token,clear=false){const secure=process.env.NODE_ENV==='production'||process.env.RENDER==='true';const attrs=[`perras_sid=${clear?'':encodeURIComponent(token||'')}`,'Path=/','HttpOnly','SameSite=Lax',secure?'Secure':'',clear?'Max-Age=0':`Max-Age=${60*60*24*180}`].filter(Boolean);return attrs.join('; ');}

  async function initPostgres(){
    const {Pool}=require('pg');
    pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL&&process.env.DATABASE_URL.includes('localhost')?false:{rejectUnauthorized:false}});
    await pool.query(`
      CREATE TABLE IF NOT EXISTS perras_users(
        id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL,
        salt TEXT NOT NULL, password_hash TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS perras_sessions(
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES perras_users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS perras_state(
        key TEXT PRIMARY KEY, value JSONB NOT NULL, version BIGINT NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_by TEXT
      );
      CREATE TABLE IF NOT EXISTS perras_products_snapshot(
        id SMALLINT PRIMARY KEY DEFAULT 1, value JSONB NOT NULL, version BIGINT NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS perras_files(
        name TEXT PRIMARY KEY, content BYTEA NOT NULL, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS perras_po_numbers(
        number TEXT PRIMARY KEY, owner_id TEXT, source TEXT NOT NULL DEFAULT 'po', status TEXT NOT NULL DEFAULT 'reserved',
        document_id TEXT, reserved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    mode='postgres';
  }

  async function seedUsers(){
    // Les variables Render sont la source de vérité des mots de passe.
    // À chaque redéploiement, les cinq comptes sont resynchronisés sans toucher aux données ERP.
    if(mode==='postgres'){
      for(const u of TEST_USERS){
        const p=makePassword(u.password);
        await pool.query(`INSERT INTO perras_users(id,username,display_name,role,salt,password_hash,active)
          VALUES($1,$2,$3,$4,$5,$6,TRUE)
          ON CONFLICT(username) DO UPDATE SET display_name=EXCLUDED.display_name,role=EXCLUDED.role,salt=EXCLUDED.salt,password_hash=EXCLUDED.password_hash,active=TRUE,updated_at=NOW()`,
          [u.id,u.username,u.name,u.role,p.salt,p.hash]);
      }
    }else{
      for(const u of TEST_USERS){
        const p=makePassword(u.password);local.users[u.username]={id:u.id,username:u.username,name:u.name,role:u.role,salt:p.salt,password_hash:p.hash,active:true};
      }
      writeLocal();
    }
  }

  async function seedState(){
    const seed=JSON.parse(fs.readFileSync(seedFile,'utf8'));
    if(mode==='postgres'){
      // Ajoute seulement les collections V38 manquantes. Ne remplace jamais les données déjà en ligne.
      for(const [key,value] of Object.entries(seed)){
        await pool.query('INSERT INTO perras_state(key,value,updated_by) VALUES($1,$2::jsonb,$3) ON CONFLICT(key) DO NOTHING',[key,JSON.stringify(value),'seed']);
      }
    }else{
      const now=new Date().toISOString();let changed=false;
      for(const [key,value] of Object.entries(seed))if(!local.state[key]){local.state[key]={value,version:1,updated_at:now,updated_by:'seed'};changed=true;}
      if(changed)writeLocal();
    }
  }

  async function init(){
    if(initialized)return;
    readLocal();
    if(process.env.DATABASE_URL){try{await initPostgres();}catch(e){console.error('PostgreSQL indisponible, mode local:',e.message);mode='local';pool=null;}}
    await seedUsers();
    await seedState();
    if(mode==='postgres')await pool.query('DELETE FROM perras_sessions WHERE expires_at < NOW()');
    initialized=true;
  }

  async function findUser(username){
    username=String(username||'').trim().toLowerCase();
    if(mode==='postgres')return (await pool.query('SELECT id,username,display_name AS name,role,salt,password_hash,active FROM perras_users WHERE lower(username)=lower($1)',[username])).rows[0]||null;
    return local.users[username]||null;
  }
  async function authenticate(username,password){const u=await findUser(username);if(!u||u.active===false)return null;const h=pbkdf2(password,u.salt);const ok=crypto.timingSafeEqual(Buffer.from(h,'hex'),Buffer.from(u.password_hash,'hex'));return ok?safeUser(u):null;}
  async function createSession(user){const token=crypto.randomBytes(32).toString('hex'),tokenHash=hashToken(token),expires=new Date(Date.now()+180*24*60*60*1000);if(mode==='postgres')await pool.query('INSERT INTO perras_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)',[tokenHash,user.id,expires]);else{local.sessions[tokenHash]={user_id:user.id,expires_at:expires.toISOString()};writeLocal();}return {token,expiresAt:expires.toISOString()};}
  async function deleteSession(req){const token=parseCookies(req).perras_sid;if(!token)return;if(mode==='postgres')await pool.query('DELETE FROM perras_sessions WHERE token_hash=$1',[hashToken(token)]);else{delete local.sessions[hashToken(token)];writeLocal();}}
  async function sessionUser(req){
    const token=parseCookies(req).perras_sid;if(!token)return null;const h=hashToken(token);
    if(mode==='postgres'){
      const r=await pool.query(`SELECT u.id,u.username,u.display_name AS name,u.role,u.active,s.expires_at FROM perras_sessions s JOIN perras_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.active=TRUE`,[h]);return safeUser(r.rows[0]);
    }
    const s=local.sessions[h];if(!s||new Date(s.expires_at).getTime()<=Date.now())return null;const u=Object.values(local.users).find(x=>x.id===s.user_id);return safeUser(u);
  }

  async function getStateAll(){
    if(mode==='postgres'){const r=await pool.query('SELECT key,value,version,updated_at,updated_by FROM perras_state ORDER BY key');return r.rows.map(x=>({...x,updated_at:new Date(x.updated_at).toISOString()}));}
    return Object.entries(local.state).map(([key,x])=>({key,...x}));
  }
  async function getStateChanges(since){
    const d=new Date(since||0);if(Number.isNaN(d.getTime()))return getStateAll();
    if(mode==='postgres'){const r=await pool.query('SELECT key,value,version,updated_at,updated_by FROM perras_state WHERE updated_at>$1 ORDER BY updated_at',[d]);return r.rows.map(x=>({...x,updated_at:new Date(x.updated_at).toISOString()}));}
    return Object.entries(local.state).filter(([,x])=>new Date(x.updated_at)>d).map(([key,x])=>({key,...x}));
  }
  function canWriteState(user,key){if(!user)return false;if(user.role==='admin')return true;const bureau=new Set(['clients','serviceCalls','tasks','heaters','truckStock','reports','quotes','fieldPOs','productRequests','forms','audit','nexus']);const tech=new Set(['serviceCalls','tasks','truckStock','fieldPOs','productRequests','forms','audit','nexus']);return (user.role==='bureau'?bureau:tech).has(String(key));}
  async function setState(key,value,user){key=String(key||'').trim();if(!key)throw new Error('Clé manquante');if(user?.id!=='system'&&!canWriteState(user,key))throw new Error('Permission refusée');if(mode==='postgres'){const r=await pool.query(`INSERT INTO perras_state(key,value,version,updated_at,updated_by) VALUES($1,$2::jsonb,1,NOW(),$3) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,version=perras_state.version+1,updated_at=NOW(),updated_by=EXCLUDED.updated_by RETURNING key,version,updated_at`,[key,JSON.stringify(value),user?.id||'system']);return {...r.rows[0],updated_at:new Date(r.rows[0].updated_at).toISOString()};}const prev=local.state[key]||{version:0};local.state[key]={value,version:Number(prev.version||0)+1,updated_at:new Date().toISOString(),updated_by:user?.id||'system'};writeLocal();return {key,version:local.state[key].version,updated_at:local.state[key].updated_at};}

  let productSaveTimer=null,pendingProducts=null;
  async function saveProductsNow(products){if(mode==='postgres')await pool.query(`INSERT INTO perras_products_snapshot(id,value,version,updated_at) VALUES(1,$1::jsonb,1,NOW()) ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value,version=perras_products_snapshot.version+1,updated_at=NOW()`,[JSON.stringify(products)]);else{local.products=products;writeLocal();}}
  function saveProducts(products){pendingProducts=products;clearTimeout(productSaveTimer);return new Promise(resolve=>{productSaveTimer=setTimeout(async()=>{const p=pendingProducts;pendingProducts=null;try{await saveProductsNow(p);}catch(e){console.error('Sauvegarde produits online:',e.message);}resolve();},350);});}
  async function loadProducts(){if(mode==='postgres'){const r=await pool.query('SELECT value FROM perras_products_snapshot WHERE id=1');return r.rows[0]?.value||null;}return local.products||null;}

  function poNumbersFromStateRows(rows,prefix){
    const used=new Set();
    const re=new RegExp('^'+String(prefix).replace(/[^0-9]/g,'')+'-(\\d{4})$');
    for(const row of rows||[]){
      if(!['purchaseOrders','fieldPOs'].includes(String(row.key||'')))continue;
      const arr=Array.isArray(row.value)?row.value:[];
      for(const x of arr){const m=String(x?.number||'').match(re);if(m)used.add(Number(m[1]));}
    }
    return used;
  }
  async function reservePoNumber(prefix,user,source='po'){
    prefix=String(prefix||String(new Date().getFullYear()).slice(-2)).replace(/\D/g,'').slice(-2);
    if(!/^\d{2}$/.test(prefix))throw new Error('Préfixe PO invalide');
    const owner=String(user?.id||'system'),src=String(source||'po');
    if(mode==='postgres'){
      const c=await pool.connect();
      try{
        await c.query('BEGIN');
        await c.query('SELECT pg_advisory_xact_lock($1)',[9283501]);
        const existing=await c.query("SELECT number FROM perras_po_numbers WHERE owner_id=$1 AND source=$2 AND status='reserved' ORDER BY reserved_at LIMIT 1",[owner,src]);
        if(existing.rowCount){await c.query('COMMIT');return existing.rows[0].number;}
        const sr=await c.query("SELECT key,value FROM perras_state WHERE key IN ('purchaseOrders','fieldPOs')");
        const used=poNumbersFromStateRows(sr.rows,prefix);
        const rr=await c.query("SELECT number FROM perras_po_numbers WHERE number LIKE $1 AND status IN ('reserved','committed')",[prefix+'-%']);
        for(const x of rr.rows){const m=String(x.number||'').match(/-(\d{4})$/);if(m)used.add(Number(m[1]));}
        let n=1;while(used.has(n))n++;
        const number=`${prefix}-${String(n).padStart(4,'0')}`;
        await c.query("INSERT INTO perras_po_numbers(number,owner_id,source,status,reserved_at,updated_at) VALUES($1,$2,$3,'reserved',NOW(),NOW()) ON CONFLICT(number) DO NOTHING",[number,owner,src]);
        await c.query('COMMIT');return number;
      }catch(e){try{await c.query('ROLLBACK');}catch(_){ }throw e;}finally{c.release();}
    }
    const existing=Object.values(local.poNumbers||{}).find(x=>x.owner_id===owner&&x.source===src&&x.status==='reserved');
    if(existing)return existing.number;
    const rows=Object.entries(local.state||{}).map(([key,x])=>({key,value:x?.value})),used=poNumbersFromStateRows(rows,prefix);
    Object.values(local.poNumbers||{}).filter(x=>['reserved','committed'].includes(x.status)&&String(x.number||'').startsWith(prefix+'-')).forEach(x=>{const m=String(x.number).match(/-(\d{4})$/);if(m)used.add(Number(m[1]));});
    let n=1;while(used.has(n))n++;const number=`${prefix}-${String(n).padStart(4,'0')}`;
    local.poNumbers[number]={number,owner_id:owner,source:src,status:'reserved',reserved_at:new Date().toISOString()};writeLocal();return number;
  }
  async function commitPoNumber(number,user,documentId='',source='po'){
    number=String(number||'').trim();if(!/^\d{2}-\d{4}$/.test(number))throw new Error('Numéro PO invalide');
    if(mode==='postgres')await pool.query("INSERT INTO perras_po_numbers(number,owner_id,source,status,document_id,reserved_at,updated_at) VALUES($1,$2,$3,'committed',$4,NOW(),NOW()) ON CONFLICT(number) DO UPDATE SET status='committed',document_id=EXCLUDED.document_id,owner_id=EXCLUDED.owner_id,source=EXCLUDED.source,updated_at=NOW()",[number,String(user?.id||'system'),String(source||'po'),String(documentId||'')]);
    else{local.poNumbers[number]={number,owner_id:String(user?.id||'system'),source:String(source||'po'),status:'committed',document_id:String(documentId||''),updated_at:new Date().toISOString()};writeLocal();}
    return number;
  }
  async function releasePoNumber(number){
    number=String(number||'').trim();if(!number)return;
    if(mode==='postgres')await pool.query('DELETE FROM perras_po_numbers WHERE number=$1',[number]);else{delete local.poNumbers[number];writeLocal();}
  }

  async function saveBinary(name,buffer,metadata={}){if(mode==='postgres')await pool.query(`INSERT INTO perras_files(name,content,metadata,updated_at) VALUES($1,$2,$3::jsonb,NOW()) ON CONFLICT(name) DO UPDATE SET content=EXCLUDED.content,metadata=EXCLUDED.metadata,updated_at=NOW()`,[name,buffer,JSON.stringify(metadata)]);else{local.files[name]={metadata,updated_at:new Date().toISOString()};writeLocal();}}
  async function loadBinary(name){if(mode!=='postgres')return null;const r=await pool.query('SELECT content,metadata,updated_at FROM perras_files WHERE name=$1',[name]);if(!r.rowCount)return null;return {content:r.rows[0].content,metadata:r.rows[0].metadata,updatedAt:new Date(r.rows[0].updated_at).toISOString()};}

  return {init,mode:()=>mode,authenticate,createSession,deleteSession,sessionUser,cookieFor,getStateAll,getStateChanges,setState,canWriteState,loadProducts,saveProducts,reservePoNumber,commitPoNumber,releasePoNumber,saveBinary,loadBinary,testUsers:()=>TEST_USERS.map(({password,...u})=>u)};
}

module.exports={createOnlineService};
