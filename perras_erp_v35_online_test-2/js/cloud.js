(function(){
  const USER_KEY='perras_online_user';
  let serverTime='1970-01-01T00:00:00.000Z';
  let pollTimer=null;
  const pending=new Map();

  async function api(url,opts={}){
    const res=await fetch(url,{credentials:'same-origin',...opts,headers:{...(opts.body&&!(opts.body instanceof FormData)?{'Content-Type':'application/json'}:{}),...(opts.headers||{})}});
    const body=await res.json().catch(()=>({}));
    if(!res.ok){const e=new Error(body.error||`Erreur ${res.status}`);e.status=res.status;throw e;}
    return body;
  }
  function currentUser(){try{return JSON.parse(localStorage.getItem(USER_KEY)||'null');}catch(_){return null;}}
  function setUser(u){if(u)localStorage.setItem(USER_KEY,JSON.stringify(u));else localStorage.removeItem(USER_KEY);}

  async function prepareApp(){
    let me;
    try{me=await api('/api/auth/me');}catch(e){setUser(null);location.replace('index.html?expired=1');throw e;}
    setUser(me.user);
    const boot=await api('/api/cloud/bootstrap');
    for(const row of boot.rows||[]){localStorage.setItem('perras_'+row.key,JSON.stringify(row.value));}
    localStorage.setItem('perras_initialized','1');
    serverTime=boot.serverTime||new Date().toISOString();
    return {user:me.user,storage:boot.storage};
  }

  function pushKey(key,value){
    if(key==='products')return Promise.resolve();
    if(pending.has(key)){pending.get(key).value=value;return pending.get(key).promise;}
    let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});const row={value,promise,resolve,reject,timer:null};pending.set(key,row);
    row.timer=setTimeout(async()=>{pending.delete(key);try{const out=await api('/api/cloud/state',{method:'POST',body:JSON.stringify({key,value:row.value})});resolve(out);}catch(e){reject(e);}},120);
    return promise;
  }

  async function poll(){
    try{
      const out=await api('/api/cloud/changes?since='+encodeURIComponent(serverTime));
      serverTime=out.serverTime||new Date().toISOString();
      let changed=false;
      for(const row of out.rows||[]){
        // Do not overwrite a local edit that is still on its way to the server.
        if(pending.has(row.key))continue;
        if(window.PerrasDB?.applyRemote)window.PerrasDB.applyRemote(row.key,row.value);else localStorage.setItem('perras_'+row.key,JSON.stringify(row.value));
        changed=true;
      }
      if(changed)window.dispatchEvent(new CustomEvent('perras-cloud-update'));
    }catch(e){if(e.status===401){setUser(null);location.replace('index.html?expired=1');return;}console.warn('Synchronisation Perras:',e.message);}
  }
  function startPolling(){if(pollTimer)return;pollTimer=setInterval(poll,5000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});}
  async function login(username,password){const out=await api('/api/auth/login',{method:'POST',body:JSON.stringify({username,password})});setUser(out.user);return out.user;}
  async function logout(){try{await api('/api/auth/logout',{method:'POST',body:'{}'});}catch(_){}setUser(null);location.replace('index.html');}

  window.PerrasCloud={api,currentUser,setUser,prepareApp,pushKey,startPolling,login,logout};
})();
