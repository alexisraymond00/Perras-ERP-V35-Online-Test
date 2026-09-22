const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

function createOnlineService({serverDir}){
  const localFile=path.join(serverDir,'online_store.json');
  const seedFile=path.join(serverDir,'seed_state.json');
  let mode='local';
  let pool=null;
  let local={state:{},users:{},sessions:{},products:null,files:{}};
  let initialized=false;

  const TEST_USERS=[
    {id:'u_admin',username:'admin1',name:'Admin 1',role:'admin',password:process.env.PERRAS_ADMIN1_PASSWORD||'Perras!Adm01'},
    {id:'u_admin2',username:'admin2',name:'Admin 2',role:'admin',password:process.env.PERRAS_ADMIN2_PASSWORD||'Perras!Adm02'},
    {id:'u_bureau',username:'bureau1',name:'Bureau 1',role:'bureau',password:process.env.PERRAS_BUREAU1_PASSWORD||'Perras!Bur01'},
    {id:'u_bureau2',username:'bureau2',name:'Bureau 2',role:'bureau',password:process.env.PERRAS_BUREAU2_PASSWORD||'Perras!Bur02'},
    {id:'u_tech1',username:'tech1',name:'Tech 1',role:'tech',password:process.env.PERRAS_TECH1_PASSWORD||'Perras!Tech01'}
  ];

  function readLocal(){try{local=JSON.parse(fs.readFileSync(localFile,'utf8'));}catch(_){local={state:{},users:{},sessions:{},products:null,files:{}};}local.state||={};local.users||={};local.sessions||={};local.files||={};}
  function writeLocal(){const tmp=localFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify(local,null,2),'utf8');fs.renameSync(tmp,localFile);}
  function pbkdf2(password,salt){return crypto.pbkdf2Sync(String(password),salt,120000,32,'sha256').toString('hex');}
  function hashToken(token){return crypto.createHash('sha256').update(String(token)).digest('hex');}
  function makePassword(password){const salt=crypto.randomBytes(18).toString('hex');return {salt,hash:pbkdf2(password,salt)};}
  function safeUser(u){if(!u)return null;return {id:u.id,username:u.username,name:u.name||u.display_name,role:u.role,active:u.active!==false};}
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
    `);
    mode='postgres';
  }

  async function seedUsers(){
    if(mode==='postgres'){
      for(const u of TEST_USERS){
        const exists=await pool.query('SELECT id FROM perras_users WHERE username=$1',[u.username]);
        if(exists.rowCount)continue;
        const p=makePassword(u.password);
        await pool.query('INSERT INTO perras_users(id,username,display_name,role,salt,password_hash,active) VALUES($1,$2,$3,$4,$5,$6,TRUE)',[u.id,u.username,u.name,u.role,p.salt,p.hash]);
      }
    }else{
      for(const u of TEST_USERS){
        if(local.users[u.username])continue;
        const p=makePassword(u.password);local.users[u.username]={id:u.id,username:u.username,name:u.name,role:u.role,salt:p.salt,password_hash:p.hash,active:true};
      }
      writeLocal();
    }
  }

  async function seedState(){
    const seed=JSON.parse(fs.readFileSync(seedFile,'utf8'));
    if(mode==='postgres'){
      const count=Number((await pool.query('SELECT COUNT(*)::int n FROM perras_state')).rows[0].n||0);
      if(!count){for(const [key,value] of Object.entries(seed))await pool.query('INSERT INTO perras_state(key,value,updated_by) VALUES($1,$2::jsonb,$3)',[key,JSON.stringify(value),'seed']);}
    }else{
      if(!Object.keys(local.state).length){const now=new Date().toISOString();for(const [key,value] of Object.entries(seed))local.state[key]={value,version:1,updated_at:now,updated_by:'seed'};writeLocal();}
    }
    // Keep app personnel aligned with the online accounts.
    const personnel=TEST_USERS.map(u=>({id:u.id,name:u.name,username:u.username,phone:'',role:u.role,active:true,title:u.role==='admin'?'Administrateur':u.role==='bureau'?'Bureau':'Technicien',...(u.role==='tech'?{truckId:'t101'}:{})}));
    await setState('users',personnel,{id:'system',role:'admin'});
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
  async function getState(key){
    key=String(key||'').trim();if(!key)return null;
    if(mode==='postgres'){const r=await pool.query('SELECT value,version,updated_at,updated_by FROM perras_state WHERE key=$1',[key]);if(!r.rowCount)return null;return {...r.rows[0],updated_at:new Date(r.rows[0].updated_at).toISOString()};}
    return local.state[key]||null;
  }
  function canWriteState(user,key){if(!user)return false;if(user.role==='admin')return true;const bureau=new Set(['clients','serviceCalls','tasks','heaters','truckStock','reports','quotes','fieldPOs','productRequests','forms','audit','nexus','stockTransfers']);const tech=new Set(['serviceCalls','tasks','truckStock','fieldPOs','productRequests','forms','audit','nexus','stockTransfers']);return (user.role==='bureau'?bureau:tech).has(String(key));}
  async function setState(key,value,user){key=String(key||'').trim();if(!key)throw new Error('Clé manquante');if(user?.id!=='system'&&!canWriteState(user,key))throw new Error('Permission refusée');if(mode==='postgres'){const r=await pool.query(`INSERT INTO perras_state(key,value,version,updated_at,updated_by) VALUES($1,$2::jsonb,1,NOW(),$3) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,version=perras_state.version+1,updated_at=NOW(),updated_by=EXCLUDED.updated_by RETURNING key,version,updated_at`,[key,JSON.stringify(value),user?.id||'system']);return {...r.rows[0],updated_at:new Date(r.rows[0].updated_at).toISOString()};}const prev=local.state[key]||{version:0};local.state[key]={value,version:Number(prev.version||0)+1,updated_at:new Date().toISOString(),updated_by:user?.id||'system'};writeLocal();return {key,version:local.state[key].version,updated_at:local.state[key].updated_at};}

  let productSaveTimer=null,pendingProducts=null;
  async function saveProductsNow(products){if(mode==='postgres')await pool.query(`INSERT INTO perras_products_snapshot(id,value,version,updated_at) VALUES(1,$1::jsonb,1,NOW()) ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value,version=perras_products_snapshot.version+1,updated_at=NOW()`,[JSON.stringify(products)]);else{local.products=products;writeLocal();}}
  function saveProducts(products){pendingProducts=products;clearTimeout(productSaveTimer);return new Promise(resolve=>{productSaveTimer=setTimeout(async()=>{const p=pendingProducts;pendingProducts=null;try{await saveProductsNow(p);}catch(e){console.error('Sauvegarde produits online:',e.message);}resolve();},350);});}
  async function loadProducts(){if(mode==='postgres'){const r=await pool.query('SELECT value FROM perras_products_snapshot WHERE id=1');return r.rows[0]?.value||null;}return local.products||null;}

  async function saveBinary(name,buffer,metadata={}){
    if(mode==='postgres')await pool.query(`INSERT INTO perras_files(name,content,metadata,updated_at) VALUES($1,$2,$3::jsonb,NOW()) ON CONFLICT(name) DO UPDATE SET content=EXCLUDED.content,metadata=EXCLUDED.metadata,updated_at=NOW()`,[name,buffer,JSON.stringify(metadata)]);
    else{local.files[name]={content:Buffer.from(buffer).toString('base64'),metadata,updated_at:new Date().toISOString()};writeLocal();}
  }
  async function loadBinary(name){
    if(mode==='postgres'){const r=await pool.query('SELECT content,metadata,updated_at FROM perras_files WHERE name=$1',[name]);if(!r.rowCount)return null;return {content:r.rows[0].content,metadata:r.rows[0].metadata,updatedAt:new Date(r.rows[0].updated_at).toISOString()};}
    const row=local.files[name];if(!row||!row.content)return null;return {content:Buffer.from(row.content,'base64'),metadata:row.metadata||{},updatedAt:row.updated_at||null};
  }
  async function deleteBinary(name){if(mode==='postgres')await pool.query('DELETE FROM perras_files WHERE name=$1',[name]);else{delete local.files[name];writeLocal();}}

  return {init,mode:()=>mode,authenticate,createSession,deleteSession,sessionUser,cookieFor,getStateAll,getStateChanges,getState,setState,canWriteState,loadProducts,saveProducts,saveBinary,loadBinary,deleteBinary,testUsers:()=>TEST_USERS.map(({password,...u})=>u)};
}

module.exports={createOnlineService};
