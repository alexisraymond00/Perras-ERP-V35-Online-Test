(function(){
  function normalizePhone(v){return String(v||'').replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'');}
  function formatPhone(v){const p=normalizePhone(v);return p.length===10?`(${p.slice(0,3)}) ${p.slice(3,6)}-${p.slice(6)}`:(v||'—');}
  function currentUser(){return window.PerrasCloud?.currentUser?.()||null;}
  function requireAuth(){if(!currentUser()){location.href='index.html?expired=1';return false;}return true;}
  function logout(){window.PerrasCloud?.logout?.();}
  function startSessionGuard(){window.PerrasCloud?.startPolling?.();}
  function sessionInfo(){const u=currentUser();return u?{userId:u.id,online:true}:null;}
  function roleHome(){return 'dashboard';}
  window.PerrasAuth={normalizePhone,formatPhone,currentUser,requireAuth,logout,startSessionGuard,sessionInfo,roleHome};
})();
