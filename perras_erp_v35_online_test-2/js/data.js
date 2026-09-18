(function(){
  function todayISO(){ return new Date().toISOString().slice(0,10); }
  function yearsAgoISO(years,months=0){ const d=new Date(); d.setFullYear(d.getFullYear()-years); d.setMonth(d.getMonth()-months); return d.toISOString().slice(0,10); }
  function clone(v){return JSON.parse(JSON.stringify(v));}

  // Catégories de rabais fournisseurs : indépendantes des catégories d'appels de service.
  // Les valeurs de départ reprennent le modèle Fournisseurs_Rabais fourni par Perras.
  const supplierCategories=[
    {id:'cat_chauffage',name:'Chauffage'},
    {id:'cat_drainage',name:'Drainage'},
    {id:'cat_traitement_eau',name:'Traitement eau'}
  ];

  const DEFAULTS = {
    users: [
      {id:'u_admin',name:'Alexis Raymond',phone:'4505550101',role:'admin',active:true,title:'Administrateur'},
      {id:'u_bureau',name:'Julie Bureau',phone:'4505550102',role:'bureau',active:true,title:'Coordonnatrice'},
      {id:'u_tech1',name:'Marc Gagnon',phone:'4505550103',role:'tech',active:true,title:'Technicien',truckId:'t101'},
      {id:'u_tech2',name:'David Roy',phone:'4505550104',role:'tech',active:true,title:'Technicien',truckId:'t102'}
    ],
    trucks:[
      {id:'t101',number:'101',description:'Ford Transit - Service',assignedUserId:'u_tech1',active:true},
      {id:'t102',number:'102',description:'Ram ProMaster - Service',assignedUserId:'u_tech2',active:true},
      {id:'t103',number:'103',description:'Camion installation',assignedUserId:'',active:true}
    ],
    clients:[
      {id:'c1',name:'Construction ABC',phone:'4505551212',address:'120 rue Principale, Farnham',email:'compta@abc.ca',priceList:'Perras 1',notes:'',suspended:false},
      {id:'c2',name:'Mme Tremblay',phone:'4505552323',address:'48 rue des Érables, Cowansville',email:'',priceList:'Perras 2',notes:'Appeler avant de se déplacer.',suspended:false},
      {id:'c3',name:'Gestion Immo Rive-Sud',phone:'4505553434',address:'775 boul. Industriel, Granby',email:'service@immo.ca',priceList:'Perras 1',notes:'',suspended:false}
    ],
    serviceCalls:[
      {id:'bt-1001',btNumber:'',poNumber:'PO-ABC-241',clientId:'c1',date:todayISO(),time:'08:00',duration:90,address:'120 rue Principale, Farnham',category:'Plomberie générale',description:'Fuite sous évier de cuisine',type:'BT',techId:'u_tech1',status:'Planifié',photos:1},
      {id:'bt-1002',btNumber:'',poNumber:'',clientId:'c2',date:todayISO(),time:'10:30',duration:60,address:'48 rue des Érables, Cowansville',category:'Chauffe-eau',description:'Vérification chauffe-eau vieillissant',type:'BT',techId:'u_tech1',status:'Planifié',photos:1},
      {id:'fac-10482',poNumber:'PO-IMMO-77',clientId:'c3',date:todayISO(),time:'09:00',duration:120,address:'775 boul. Industriel, Granby',category:'Drain',description:'Drain lent au local 204',type:'Facture',invoiceNumber:'',techId:'u_tech2',status:'Planifié',photos:1}
    ],
    minimumCalls:[
      {id:'mc_standard',name:'Standard',durationMinutes:60,price:0,active:true},
      {id:'mc_vaudreuil',name:'Vaudreuil',durationMinutes:120,price:0,active:true}
    ],
    tasks:[
      {id:'task1',userId:'u_admin',clientId:'c1',title:'Valider la soumission plomberie',due:todayISO(),priority:'Normale',status:'À faire',note:''},
      {id:'task2',userId:'u_bureau',clientId:'c2',title:'Rappeler pour le chauffe-eau',due:todayISO(),priority:'Haute',status:'À faire',note:'Proposer une plage de remplacement.'}
    ],
    heaters:[
      {id:'wh1',clientId:'c2',brand:'Giant',model:'152ETE',serial:'GNT-298445',installDate:yearsAgoISO(9,6),capacity:'60 gal',type:'Électrique'}
    ],
    products:[
      {id:'p1',code:'VAL-001',description:'Valve à bille 1/2 po',category:'Robinetterie',supplierCategoryId:'',warehouseQty:42,minQty:10,onOrderQty:0,listPrice:18.95,costPrice:8.05,active:true,image:''},
      {id:'p2',code:'RAC-014',description:'Raccord cuivre 1/2 po',category:'Plomberie générale',supplierCategoryId:'',warehouseQty:7,minQty:12,onOrderQty:60,listPrice:4.85,costPrice:2.20,active:true,image:''},
      {id:'p3',code:'DRA-220',description:'Nettoyant drain professionnel',category:'Drain',supplierCategoryId:'cat_drainage',warehouseQty:0,minQty:6,onOrderQty:24,listPrice:29.90,costPrice:13.40,active:true,image:''},
      {id:'p4',code:'WH-060',description:'Chauffe-eau électrique 60 gal',category:'Chauffe-eau',supplierCategoryId:'cat_chauffage',warehouseQty:5,minQty:2,onOrderQty:0,listPrice:1299.00,costPrice:760.00,active:true,image:''}
    ],
    truckStock:[
      {truckId:'t101',productId:'p1',qty:8},{truckId:'t101',productId:'p2',qty:15},{truckId:'t101',productId:'p3',qty:2},
      {truckId:'t102',productId:'p1',qty:5},{truckId:'t102',productId:'p2',qty:10}
    ],
    pricing:{
      // Ancienne structure gardée pour compatibilité; V3 utilise markupByPriceCategory + calculatedDiscounts.
      discounts:{'Perras 1':5,'Perras 2':10,'Perras 3':15},
      markupByCategory:{default:50},
      markupByPriceCategory:{},
      calculatedDiscounts:{},
      annualReturnPct:12
    },
    supplierCategories: supplierCategories,
    suppliers:[
      {id:'s1',name:'Deschênes',paymentTerms:'2% 10 jours / net 30',paymentDiscountPct:2,discountDays:10,netDays:30,capitalYieldPct:0,selectedPaymentOptionId:'pt_s1_1',paymentOptions:[{id:'pt_s1_1',label:'2% 10 jours / net 30',paymentDiscountPct:2,discountDays:10,netDays:30,capitalYieldPct:0},{id:'pt_s1_2',label:'Net 60',paymentDiscountPct:0,discountDays:0,netDays:60,capitalYieldPct:0}],rebates:{cat_chauffage:32,cat_drainage:28,cat_traitement_eau:25}},
      {id:'s2',name:'Wolseley',paymentTerms:'Net 30',paymentDiscountPct:0,discountDays:0,netDays:30,capitalYieldPct:0,selectedPaymentOptionId:'pt_s2_1',paymentOptions:[{id:'pt_s2_1',label:'Net 30',paymentDiscountPct:0,discountDays:0,netDays:30,capitalYieldPct:0}],rebates:{cat_chauffage:35,cat_drainage:30,cat_traitement_eau:25}},
      {id:'s3',name:'EMCO',paymentTerms:'Net 30',paymentDiscountPct:0,discountDays:0,netDays:30,capitalYieldPct:0,selectedPaymentOptionId:'pt_s3_1',paymentOptions:[{id:'pt_s3_1',label:'Net 30',paymentDiscountPct:0,discountDays:0,netDays:30,capitalYieldPct:0}],rebates:{cat_chauffage:30,cat_drainage:28,cat_traitement_eau:20}}
    ],
    supplierOffers:[
      {id:'o1',productId:'p1',supplierId:'s1',supplier:'Deschênes',supplierList:11.40},
      {id:'o2',productId:'p1',supplierId:'s2',supplier:'Wolseley',supplierList:11.00},
      {id:'o3',productId:'p1',supplierId:'s3',supplier:'EMCO',supplierList:12.25}
    ],
    purchaseOrders:[
      {id:'po1',number:'26-0001',buyerId:'u_admin',date:todayISO(),supplierId:'s1',supplier:'Deschênes',status:'Commandé',total:1280.45,items:[{id:'poi1',productId:'p2',qty:60,receivedQty:0,unitCost:2.20}]},
      {id:'po2',number:'26-0002',buyerId:'u_admin',date:todayISO(),supplierId:'s2',supplier:'Wolseley',status:'À envoyer',total:642.10,items:[{id:'poi2',productId:'p3',qty:24,receivedQty:0,unitCost:13.40}]}
    ],
    googleBusinesses:[
      {id:'gb1',name:'Plomberie Pompe Perras',accountId:'',locationId:''},
      {id:'gb2',name:'Plomberie Saint-Jean',accountId:'',locationId:''},
      {id:'gb3',name:'Plombier Vaudreuil',accountId:'',locationId:''}
    ],
    googleReviews:[],
    googleBonusPayments:[],
    tools:[
      {id:'tool1',name:'Fichoir RIDGID',category:'Fichoir',assetTag:'OUT-001',truckId:'t101',assignedUserId:'u_tech1',notes:'',active:true},
      {id:'tool2',name:'Échelle 24 pi',category:'Échelle',assetTag:'OUT-002',truckId:'t102',assignedUserId:'u_tech2',notes:'',active:true}
    ],
    permissions:{
      admin:{dashboard:true,tasks:true,calendar:true,calls:true,clients:true,bt:true,invoices:true,punches:true,timesheets:true,minimumcalls:true,forms:true,quotes:true,crm:true,inventory:true,products:true,orders:true,suppliers:true,pricing:true,technicians:true,trucks:true,tools:true,personnel:true,roles:true,nexus:true,tax:true,reports:true,settings:true},
      bureau:{dashboard:true,tasks:true,calendar:true,calls:true,clients:true,bt:true,invoices:true,punches:true,timesheets:true,forms:true,quotes:true,crm:true,inventory:true,products:true,tools:true,nexus:true,tax:true},
      tech:{dashboard:true,calendar:true,interventions:true,clients:true,bt:true,timesheets:true,forms:true,quotes:true,inventory:true,products:true,mytruck:true,tools:true,requestproduct:true,fieldpos:true,nexus:true,tax:true}
    },
    reports:[],
    quotes:[],
    fieldPOs:[],
    productRequests:[],
    forms:[],
    audit:[],
    nexus:[],
    settings:{heaterAlertYears:10,company:'Perras Plomberie',taxGST:5,taxQST:9.975,numbering:{activeYear:new Date().getFullYear(),btNextSimple:1003,invoiceNextSimple:1,btNext:1003,poNext:3,quoteNext:1}}
  };

  // V25 performance : chaque collection n'est parsée qu'une fois par chargement de page.
  // Avant cette optimisation, ensure()+migrate() étaient rejoués à CHAQUE PerrasDB.get(),
  // ce qui devenait très coûteux avec un catalogue de 20 000+ produits.
  let ensured=false, ensuring=false;
  const CACHE=new Map();
  let productIndex=null;
  let productMemory=null;
  let productLoadPromise=null;
  let productLoadProgress={done:0,total:0};
  const CORE_SCHEMA_VERSION='v27-core-1';
  const PRODUCT_SCHEMA_VERSION='v27-products-1';
  const PRODUCT_STATS_KEY='perras_product_stats_cache';

  function invalidateCache(key){
    if(key){ CACHE.delete(key); if(key==='products') productIndex=null; }
    else { CACHE.clear(); productIndex=null; }
  }
  function getRaw(key){
    if(CACHE.has(key)) return CACHE.get(key);
    const value=JSON.parse(localStorage.getItem('perras_'+key)||'null');
    CACHE.set(key,value);
    return value;
  }
  function ensure(){
    if(ensured || ensuring) return;
    ensuring=true;
    // V27 : démarrage rapide. Le catalogue Produits n'est jamais lu au chargement initial.
    const alreadyInitialized=localStorage.getItem('perras_initialized')==='1';
    Object.entries(DEFAULTS).forEach(([k,v])=>{
      // Si le logiciel a déjà été initialisé (V25), on ne touche même pas à la grosse clé Produits.
      if(alreadyInitialized && k==='products') return;
      if(localStorage.getItem('perras_'+k)===null) localStorage.setItem('perras_'+k,JSON.stringify(v));
    });
    localStorage.setItem('perras_initialized','1');
    if(localStorage.getItem('perras_core_schema_version')!==CORE_SCHEMA_VERSION){
      migrateCore();
      localStorage.setItem('perras_core_schema_version',CORE_SCHEMA_VERSION);
      invalidateCache();
    }
    ensured=true;
    ensuring=false;
  }
  function migrateCore(){
    let dirty=false;
    const clientRows=getRaw('clients')||[];dirty=false;clientRows.forEach(c=>{if(c.suspended===undefined){c.suspended=false;dirty=true;}});if(dirty)localStorage.setItem('perras_clients',JSON.stringify(clientRows));
    const calls=getRaw('serviceCalls')||[];dirty=false;calls.forEach(c=>{if(c.poNumber===undefined){c.poNumber='';dirty=true;}if(c.manualClientName===undefined){c.manualClientName='';dirty=true;}if(c.contactPhone===undefined){c.contactPhone='';dirty=true;}if(c.minimumCallId===undefined){c.minimumCallId='';dirty=true;}if(c.extraMinutes===undefined){c.extraMinutes=0;dirty=true;}if(c.work===undefined){c.work='';dirty=true;}if(c.parts===undefined){c.parts='';dirty=true;}if(c.notes===undefined){c.notes='';dirty=true;}if(c.signature===undefined){c.signature='';dirty=true;}});if(dirty)localStorage.setItem('perras_serviceCalls',JSON.stringify(calls));

    // V3 : sépare les catégories fournisseurs des catégories d'appels.
    let cats=getRaw('supplierCategories')||[];
    const legacyNames=['Plomberie générale','Robinetterie','Drain','Chauffe-eau','Pompe','Sanitaire'];
    const looksLegacy=cats.length===legacyNames.length&&legacyNames.every(n=>cats.some(c=>c.name===n));
    if(looksLegacy){cats=clone(DEFAULTS.supplierCategories);localStorage.setItem('perras_supplierCategories',JSON.stringify(cats));const suppliers=getRaw('suppliers')||[];const source={Deschênes:{cat_chauffage:32,cat_drainage:28,cat_traitement_eau:25},Wolseley:{cat_chauffage:35,cat_drainage:30,cat_traitement_eau:25},Emco:{cat_chauffage:30,cat_drainage:28,cat_traitement_eau:20},EMCO:{cat_chauffage:30,cat_drainage:28,cat_traitement_eau:20}};suppliers.forEach(s=>{s.rebates=clone(source[s.name]||{});});localStorage.setItem('perras_suppliers',JSON.stringify(suppliers));}

    const supplierRows=getRaw('suppliers')||[];dirty=false;supplierRows.forEach(s=>{if(s.discountDays===undefined){s.discountDays=0;dirty=true;}if(s.netDays===undefined){const m=String(s.paymentTerms||'').match(/net\s*(\d+)/i);s.netDays=m?Number(m[1]):0;dirty=true;}if(s.capitalYieldPct===undefined){s.capitalYieldPct=0;dirty=true;}if(!Array.isArray(s.paymentOptions)||!s.paymentOptions.length){const oid='pt_'+s.id+'_1';s.paymentOptions=[{id:oid,label:s.paymentTerms||((Number(s.netDays)||30)?'Net '+(Number(s.netDays)||30):'Termes'),paymentDiscountPct:Number(s.paymentDiscountPct||0),discountDays:Number(s.discountDays||0),netDays:Number(s.netDays||0),capitalYieldPct:Number(s.capitalYieldPct||0)}];s.selectedPaymentOptionId=oid;dirty=true;}if(!s.selectedPaymentOptionId||!s.paymentOptions.some(o=>o.id===s.selectedPaymentOptionId)){s.selectedPaymentOptionId=s.paymentOptions[0].id;dirty=true;}});if(dirty)localStorage.setItem('perras_suppliers',JSON.stringify(supplierRows));

    const offers=getRaw('supplierOffers')||[];dirty=false;offers.forEach(o=>{if(!o.supplierId){const sup=supplierRows.find(s=>String(s.name).toLowerCase()===String(o.supplier||'').toLowerCase());if(sup){o.supplierId=sup.id;o.supplier=sup.name;dirty=true;}}});if(dirty)localStorage.setItem('perras_supplierOffers',JSON.stringify(offers));

    const calls2=getRaw('serviceCalls')||[];dirty=false;calls2.forEach(c=>{if(c.locked!==true){if(c.btNumber){c.btNumber='';dirty=true;}if(c.invoiceNumber){c.invoiceNumber='';dirty=true;}}});if(dirty)localStorage.setItem('perras_serviceCalls',JSON.stringify(calls2));
    const poRows=getRaw('purchaseOrders')||[];dirty=false;poRows.forEach((po,i)=>{if(!/^\d{2}-\d{4}$/.test(String(po.number||''))){const y=String((po.date||todayISO()).slice(0,4)).slice(-2);const m=String(po.number||'').match(/(\d{1,4})$/);po.number=y+'-'+String(m?Number(m[1]):i+1).padStart(4,'0');dirty=true;}if(!Array.isArray(po.items)){po.items=[];dirty=true;}po.items.forEach((it,j)=>{if(!it.id){it.id='poi_'+po.id+'_'+j;dirty=true;}if(it.receivedQty===undefined){it.receivedQty=0;dirty=true;}if(it.unitCost===undefined){it.unitCost=0;dirty=true;}if(it.backorderResolvedQty===undefined){it.backorderResolvedQty=0;dirty=true;}});});if(dirty)localStorage.setItem('perras_purchaseOrders',JSON.stringify(poRows));
    const quotes=getRaw('quotes')||[];dirty=false;quotes.forEach((q,i)=>{if(!q.quoteNumber){const y=String((q.date||todayISO()).slice(0,4)).slice(-2);q.quoteNumber=y+'-'+String(i+1).padStart(4,'0');dirty=true;}if(!Array.isArray(q.items)){q.items=[];dirty=true;}});if(dirty)localStorage.setItem('perras_quotes',JSON.stringify(quotes));
    const forms=getRaw('forms')||[];dirty=false;forms.forEach(f=>{if(f.manualClientName===undefined){f.manualClientName='';dirty=true;}if(f.manualAddress===undefined){f.manualAddress='';dirty=true;}if(f.manualPhone===undefined){f.manualPhone='';dirty=true;}if(!Array.isArray(f.checks)){f.checks=[];dirty=true;}});if(dirty)localStorage.setItem('perras_forms',JSON.stringify(forms));
    const settings=getRaw('settings')||clone(DEFAULTS.settings);settings.numbering=settings.numbering||{};if(settings.numbering.activeYear===undefined)settings.numbering.activeYear=new Date().getFullYear();if(settings.numbering.btNext===undefined)settings.numbering.btNext=1003;if(settings.numbering.poNext===undefined)settings.numbering.poNext=3;if(settings.numbering.quoteNext===undefined)settings.numbering.quoteNext=1;localStorage.setItem('perras_settings',JSON.stringify(settings));

    const minCalls=getRaw('minimumCalls')||[];dirty=false;if(!minCalls.length){minCalls.push(...clone(DEFAULTS.minimumCalls));dirty=true;}minCalls.forEach(mc=>{if(mc.durationMinutes===undefined){mc.durationMinutes=60;dirty=true;}if(mc.price===undefined){mc.price=0;dirty=true;}if(mc.active===undefined){mc.active=true;dirty=true;}});if(dirty)localStorage.setItem('perras_minimumCalls',JSON.stringify(minCalls));

    const pricing=getRaw('pricing')||clone(DEFAULTS.pricing);pricing.markupByCategory=pricing.markupByCategory||{};if(pricing.markupByCategory.default===undefined)pricing.markupByCategory.default=50;pricing.markupByPriceCategory=pricing.markupByPriceCategory||{};pricing.calculatedDiscounts=pricing.calculatedDiscounts||{};if(pricing.annualReturnPct===undefined)pricing.annualReturnPct=12;localStorage.setItem('perras_pricing',JSON.stringify(pricing));
    const tools=getRaw('tools')||[];dirty=false;tools.forEach(t=>{if(t.active===undefined){t.active=true;dirty=true;}if(t.notes===undefined){t.notes='';dirty=true;}});if(dirty)localStorage.setItem('perras_tools',JSON.stringify(tools));
    const perms=getRaw('permissions')||{};Object.entries(DEFAULTS.permissions).forEach(([role,map])=>{perms[role]=perms[role]||{};Object.entries(map).forEach(([route,val])=>{if(perms[role][route]===undefined)perms[role][route]=val;});});localStorage.setItem('perras_permissions',JSON.stringify(perms));
  }
  function migrateProductsOnce(){
    if(localStorage.getItem('perras_product_schema_version')===PRODUCT_SCHEMA_VERSION) return;
    const products=getRaw('products')||[]; let dirty=false;
    for(const p of products){
      if(p.active===undefined){p.active=true;dirty=true;}
      if(p.onOrderQty===undefined){p.onOrderQty=0;dirty=true;}
      if(p.costPrice===undefined){p.costPrice=Number(p.listPrice||0)*0.6;dirty=true;}
      if(p.image===undefined){p.image='';dirty=true;}
      if(p.supplierCategoryId===undefined){p.supplierCategoryId=p.category==='Drain'?'cat_drainage':p.category==='Chauffe-eau'?'cat_chauffage':'';dirty=true;}
    }
    if(dirty) localStorage.setItem('perras_products',JSON.stringify(products));
    localStorage.setItem('perras_product_schema_version',PRODUCT_SCHEMA_VERSION);
    CACHE.set('products',products);
  }
  function get(key){
    ensure();
    if(key==='products') return productMemory||[];
    return getRaw(key);
  }
  function productsReady(){ return Array.isArray(productMemory); }
  function productsProgress(){ return {...productLoadProgress}; }
  function loadProductsAsync(){
    ensure();
    if(productsReady()) return Promise.resolve(productMemory);
    if(productLoadPromise) return productLoadPromise;
    productLoadPromise=new Promise((resolve,reject)=>{
      try{
        const worker=new Worker('js/catalog-worker.js');
        const raw=localStorage.getItem('perras_products');
        productLoadProgress={done:0,total:0};
        worker.onmessage=(ev)=>{
          const m=ev.data||{};
          if(m.type==='progress'){productLoadProgress={done:Number(m.done||0),total:Number(m.total||0)};window.dispatchEvent(new CustomEvent('perras-products-progress',{detail:productLoadProgress}));return;}
          if(m.type==='error'){worker.terminate();productLoadPromise=null;reject(new Error(m.message||'Erreur catalogue'));return;}
          if(m.type==='ready'){
            productMemory=Array.isArray(m.products)?m.products:[];
            CACHE.set('products',productMemory);
            productIndex=null;
            try{localStorage.setItem(PRODUCT_STATS_KEY,JSON.stringify(m.stats||cacheProductStatsFromArray(productMemory)));}catch(_){ }
            localStorage.setItem('perras_product_schema_version',PRODUCT_SCHEMA_VERSION);
            productLoadProgress={done:productMemory.length,total:productMemory.length};
            worker.terminate();
            window.dispatchEvent(new CustomEvent('perras-products-ready',{detail:{count:productMemory.length}}));
            resolve(productMemory);
          }
        };
        worker.onerror=(err)=>{worker.terminate();productLoadPromise=null;reject(err);};
        worker.postMessage({type:'load',raw,defaults:DEFAULTS.products});
      }catch(err){productLoadPromise=null;reject(err);}
    });
    return productLoadPromise;
  }
  function set(key,val){
    if(key==='products'){
      productMemory=Array.isArray(val)?val:[];
      CACHE.set(key,productMemory);
      productIndex=null;
      localStorage.setItem('perras_product_schema_version',PRODUCT_SCHEMA_VERSION);
      cacheProductStatsFromArray(productMemory);
      const persist=()=>{try{localStorage.setItem('perras_products',JSON.stringify(productMemory));}catch(e){console.warn('Catalogue non persisté dans localStorage:',e);}};
      if('requestIdleCallback' in window) requestIdleCallback(persist,{timeout:2500}); else setTimeout(persist,50);
      return;
    }
    localStorage.setItem('perras_'+key,JSON.stringify(val));
    CACHE.set(key,val);
    // V35 Online : pousse la collection modifiée vers le serveur commun.
    if(window.PerrasCloud?.pushKey) window.PerrasCloud.pushKey(key,val).catch(e=>console.warn('Synchro cloud:',e.message));
  }
  function applyRemote(key,val){
    if(key==='products') return;
    localStorage.setItem('perras_'+key,JSON.stringify(val));
    CACHE.set(key,val);
  }
  function reset(){
    Object.keys(DEFAULTS).forEach(k=>localStorage.removeItem('perras_'+k));
    localStorage.removeItem('perras_initialized');
    localStorage.removeItem('perras_core_schema_version');
    localStorage.removeItem('perras_product_schema_version');
    localStorage.removeItem(PRODUCT_STATS_KEY);
    ensured=false; ensuring=false; productMemory=null; productLoadPromise=null; invalidateCache(); ensure();
  }

  function normalizeSearch(v=''){
    return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  }
  function cacheProductStatsFromArray(products){
    products=Array.isArray(products)?products:[];
    let active=0,warehouseUnits=0,low=0,out=0,onOrder=0,lowIncludingOut=0,costValue=0,saleValue=0;
    const categorySale={};
    for(const p of products){
      if(p.active===false) continue;
      active++;
      const qty=Number(p.warehouseQty||0),min=Number(p.minQty||0),cost=Number(p.costPrice||0),list=Number(p.listPrice||0);
      warehouseUnits+=qty; onOrder+=Number(p.onOrderQty||0); costValue+=qty*cost; saleValue+=qty*list;
      categorySale[p.category||'Autre']=(categorySale[p.category||'Autre']||0)+qty*list;
      if(qty===0) out++; else if(qty<=min) low++;
      if(qty<=min) lowIncludingOut++;
    }
    const stats={total:products.length,active,warehouseUnits,low,out,onOrder,lowIncludingOut,costValue,saleValue,categorySale,updatedAt:new Date().toISOString()};
    try{localStorage.setItem(PRODUCT_STATS_KEY,JSON.stringify(stats));}catch(_){}
    return stats;
  }
  function productStatsCached(){
    try{return JSON.parse(localStorage.getItem(PRODUCT_STATS_KEY)||'null');}catch(_){return null;}
  }

  function buildProductIndex(){
    const products=get('products')||[];
    const byId=new Map(), rows=new Array(products.length);
    let active=0,warehouseUnits=0,low=0,out=0,onOrder=0,costValue=0,saleValue=0;
    const categorySale={};
    for(let i=0;i<products.length;i++){
      const p=products[i]; byId.set(p.id,p);
      rows[i]={p,text:p._search||normalizeSearch([p.code,p.description,p.category,p.supplierCategoryId].join(' '))};
      if(p.active!==false){
        active++; const qty=Number(p.warehouseQty||0),min=Number(p.minQty||0),cost=Number(p.costPrice||0),list=Number(p.listPrice||0); warehouseUnits+=qty; onOrder+=Number(p.onOrderQty||0); costValue+=qty*cost; saleValue+=qty*list; categorySale[p.category||'Autre']=(categorySale[p.category||'Autre']||0)+qty*list;
        if(qty===0) out++; else if(qty<=min) low++;
      }
    }
    const stats={total:products.length,active,warehouseUnits,low,out,onOrder,lowIncludingOut:low+out,costValue,saleValue,categorySale};
    productIndex={source:products,byId,rows,stats};
    try{localStorage.setItem(PRODUCT_STATS_KEY,JSON.stringify({...stats,updatedAt:new Date().toISOString()}));}catch(_){}
    return productIndex;
  }
  function ensureProductIndex(){
    const products=productMemory||[];
    return productIndex&&productIndex.source===products?productIndex:buildProductIndex();
  }
  function productById(id){if(!productsReady())return null;return ensureProductIndex().byId.get(id)||null;}
  function productStats(){if(!productsReady())return productStatsCached()||{total:0,active:0,warehouseUnits:0,low:0,out:0,onOrder:0,lowIncludingOut:0,costValue:0,saleValue:0,categorySale:{}};return {...ensureProductIndex().stats};}
  function queryProducts(query='',opts={}){
    if(!productsReady()) return {total:0,items:[],offset:0,limit:Number(opts.limit||60),loading:true};
    const idx=ensureProductIndex(), q=normalizeSearch(query), activeOnly=opts.activeOnly===true, includeInactive=opts.includeInactive!==false;
    const filter=opts.filter||'all', offset=Math.max(0,Number(opts.offset||0)), limit=Math.max(1,Math.min(500,Number(opts.limit||60)));
    if(!q && filter==='all' && !activeOnly && includeInactive){return {total:idx.rows.length,items:idx.rows.slice(offset,offset+limit).map(r=>r.p),offset,limit};}
    const matches=[];
    for(const row of idx.rows){
      const p=row.p;
      if(activeOnly&&p.active===false) continue;
      if(!includeInactive&&p.active===false) continue;
      const qty=Number(p.warehouseQty||0),min=Number(p.minQty||0);
      if(filter==='low' && !(p.active!==false&&qty>0&&qty<=min)) continue;
      if(filter==='out' && !(p.active!==false&&qty===0)) continue;
      if(filter==='onorder' && !(Number(p.onOrderQty||0)>0)) continue;
      if(q && !row.text.includes(q)) continue;
      matches.push(p);
    }
    return {total:matches.length,items:matches.slice(offset,offset+limit),offset,limit};
  }
  function uid(prefix='id'){return prefix+'_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);}
  function audit(action,entity,details){
    const rows=get('audit')||[]; const user=window.PerrasAuth?.currentUser?.();
    rows.unshift({id:uid('log'),at:new Date().toISOString(),userId:user?.id||'system',userName:user?.name||'Système',action,entity,details});
    set('audit',rows.slice(0,1000));
  }
  function exportAll(){ensure(); const out={version:20,exportedAt:new Date().toISOString(),data:{}};Object.keys(DEFAULTS).forEach(k=>out.data[k]=get(k));return out;}
  function importAll(payload){if(!payload||!payload.data) throw new Error('Sauvegarde invalide');Object.keys(DEFAULTS).forEach(k=>{if(k in payload.data)set(k,payload.data[k]);});migrateCore();localStorage.setItem('perras_core_schema_version',CORE_SCHEMA_VERSION);invalidateCache();audit('Restauration','Système','Sauvegarde importée');}

  window.PerrasDB={DEFAULTS,ensure,get,set,applyRemote,reset,uid,audit,exportAll,importAll,todayISO,queryProducts,productById,productStats,productStatsCached,normalizeSearch,loadProductsAsync,productsReady,productsProgress};
})();
