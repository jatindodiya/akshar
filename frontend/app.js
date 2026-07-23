/* ============================================================
   AKSHAR INTERNATIONAL — EXPORT DASHBOARD (Frontend)
   Talks to the Node.js/Express backend in /backend over REST.
   ============================================================ */

/* ⬇⬇⬇  BACKEND API URL  ⬇⬇⬇
   Local dev (backend running via `npm start` in /backend): keep as is.
   After you deploy the backend somewhere (Render, Railway, a VPS...),
   change this to that server's URL, or use a relative path like '/api' for a reverse proxy. */
const API_BASE = '/api';
/* ⬆⬆⬆ ------------------------------------------------------ ⬆⬆⬆ */

const LS_TOKEN = 'axr_token';
const uid = (p)=> p+'_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);

/* ---- tiny fetch wrapper: adds the login token, throws readable errors ---- */
async function api(path, opts={}){
  const token = localStorage.getItem(LS_TOKEN);
  const headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
  if(token) headers.Authorization = 'Bearer '+token;
  let res;
  try{
    res = await fetch(API_BASE+path, Object.assign({}, opts, {headers}));
  }catch(e){
    throw new Error('Backend se connect nahi ho paaya — server chal raha hai check karo.');
  }
  let data=null; try{ data = await res.json(); }catch(e){}
  if(!res.ok) throw new Error((data&&data.error)||'Kuch galat ho gaya.');
  return data;
}

let PRODUCTS = [];
let CLIENTS  = [];
let DEALS    = [];
let SETTINGS = {};

const STAGES = [
  {key:'inquiry',   label:'Inquiry',        pending:'Awaiting quotation', owner:'Senior', color:'amber'},
  {key:'quotation', label:'Quotation Ready',pending:'Ready to send',      owner:'Sales',  color:'blue'},
  {key:'sent',      label:'Quote Sent',     pending:'Awaiting response',  owner:'Client', color:'blue'},
  {key:'followup',  label:'Follow-up',      pending:'Needs follow-up',    owner:'Sales',  color:'amber'},
  {key:'converted', label:'Order Won',      pending:'Arrange shipping',   owner:'Ops',    color:'green'},
  {key:'shipping',  label:'In Shipping',    pending:'Track ETA',          owner:'Ops',    color:'blue'},
  {key:'payment',   label:'Payment',        pending:'Collect payment',    owner:'Accts',  color:'amber'},
  {key:'closed',    label:'Closed',         pending:'Completed',          owner:'—',      color:'green'},
];
const stageIdx = k => STAGES.findIndex(s=>s.key===k);
const stageOf  = k => STAGES.find(s=>s.key===k) || STAGES[0];
const CUR = {INR:'₹', USD:'$', EUR:'€', GBP:'£', AED:'AED '};

/* Sample data ab pehli baar backend boot hone par seed hota hai (dekho backend/db.js) */

/* ---------- helpers ---------- */
const fmt = (n)=> (Number(n)||0).toLocaleString('en-IN',{maximumFractionDigits:2});
const money = (n,cur='USD')=> (CUR[cur]||'') + fmt(n);
const esc = (s)=> String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = ()=> new Date().toISOString().slice(0,10);
const dfmt = (s)=> s ? new Date(s+'T00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—';
const daysBetween = (a,b)=> Math.round((new Date(b)-new Date(a))/864e5);
const daysAgo = (s)=> s ? daysBetween(s,today()) : 0;
const productById = id => PRODUCTS.find(p=>p.id===id);
const clientById = id => CLIENTS.find(c=>c.id===id);
const dealTotal = d => (d.items||[]).reduce((s,it)=> s + (Number(it.qty)||0)*(Number(it.rate)||0), 0);
const hasRates = d => (d.items||[]).length>0 && (d.items||[]).every(it=> Number(it.rate)>0);
const valueLabel = d => hasRates(d) ? money(dealTotal(d), d.currency) : '<span class="t-sub" style="font-weight:600">Rate pending</span>';

function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('on'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('on'),2200); }
/* debounced push to the backend — mirrors how the old Firestore sync worked */
let _syncTimer=null;
function persist(){
  clearTimeout(_syncTimer);
  _syncTimer=setTimeout(async ()=>{
    try{ await api('/sync', {method:'POST', body:JSON.stringify({products:PRODUCTS, clients:CLIENTS, deals:DEALS, settings:SETTINGS})}); }
    catch(e){ toast(e.message||'Save error — connection check karo'); }
  },400);
}
async function cloudDelete(coll,id){ try{ await api('/'+coll+'/'+id, {method:'DELETE'}); }catch(e){ toast(e.message||'Delete error'); } }

/* is this deal "pending / needs attention"? returns {flag,label,overdue} */
function pendingInfo(d){
  if(d.lost) return {flag:false};
  const st = d.stage;
  const age = daysAgo(d.date);
  if(st==='inquiry')   return {flag:true, label:'Awaiting quotation from senior', overdue: age>=2, chip:'amber'};
  if(st==='quotation') return {flag:true, label:'Quotation ready — send to client', overdue:false, chip:'blue'};
  if(st==='sent' || st==='followup'){
    const lastFu = (d.followups&&d.followups.length)? d.followups[d.followups.length-1].date : d.quoteDate||d.date;
    const gap = daysAgo(lastFu);
    return {flag:true, label: gap>=3? 'Follow-up overdue ('+gap+'d)':'Awaiting client response', overdue: gap>=3, chip: gap>=3?'red':'blue'};
  }
  if(st==='converted') return {flag:true, label:'Arrange shipping / booking', overdue:false, chip:'green'};
  if(st==='shipping'){
    const eta = d.shipping&&d.shipping.eta;
    if(eta){ const dd=daysBetween(today(),eta); return {flag:true, label: dd<0? 'ETA passed — confirm delivery':'ETA in '+dd+'d', overdue: dd<0, chip: dd<0?'red':'blue'}; }
    return {flag:true, label:'Shipping in progress', overdue:false, chip:'blue'};
  }
  if(st==='payment'){
    const p=d.payment||{}; const bal=(Number(p.amount)||0)-(Number(p.received)||0);
    const overdue = p.dueDate && daysBetween(today(),p.dueDate)<0 && bal>0;
    return {flag: bal>0, label: overdue? 'Payment OVERDUE':'Payment pending', overdue, chip: overdue?'red':'amber'};
  }
  return {flag:false};
}

/* ============================================================
   ROUTER
   ============================================================ */
let VIEW='dashboard';
let DEALPRESET=null; // when set from a KPI card, filters the All-Inquiries list
const DEAL_PRESETS = {
  awaitingQuote: {label:'Awaiting quotation', test:d=>d.stage==='inquiry'&&!d.lost},
  toSend:        {label:'Quotation ready to send', test:d=>d.stage==='quotation'&&!d.lost},
  awaitingReply: {label:'Awaiting client reply', test:d=>(d.stage==='sent'||d.stage==='followup')&&!d.lost},
  inShipping:    {label:'In shipping', test:d=>d.stage==='shipping'},
  paymentPending:{label:'Payment pending', test:d=>{const p=d.payment||{};return d.stage==='payment' && ((Number(p.amount)||0)-(Number(p.received)||0))>0;}},
  won:           {label:'Orders won', test:d=>['converted','shipping','payment','closed'].includes(d.stage)},
  followup:      {label:'Follow-ups pending', test:d=>(d.stage==='sent'||d.stage==='followup')&&!d.lost},
};
document.getElementById('nav').addEventListener('click',e=>{
  const b=e.target.closest('button[data-view]'); if(!b) return;
  DEALPRESET = b.dataset.preset || null;
  VIEW=b.dataset.view; render();
});
document.getElementById('newInquiryBtn').addEventListener('click',()=> openDealForm());

function setActive(){
  document.querySelectorAll('#nav button[data-view]').forEach(b=>{
    let on = b.dataset.view===VIEW;
    if(VIEW==='deals'){ const bp=b.dataset.preset||''; on = (bp==='followup') ? (DEALPRESET==='followup') : (DEALPRESET!=='followup'); }
    b.classList.toggle('active', on);
  });
  const titles={dashboard:['Dashboard','Export operations overview'],pipeline:['Pipeline','Drag your deals across stages'],deals:['All Inquiries','Every inquiry, quote & order'],products:['Product Master','Chemicals, HSN, CAS & documents'],clients:['Client Master','Buyers & importers'],settings:['Settings','Company profile, backup & reset']};
  const [t,c]=titles[VIEW]||['',''];
  document.getElementById('pageTitle').textContent=t;
  document.getElementById('pageCrumb').textContent = (VIEW==='deals' && DEALPRESET && DEAL_PRESETS[DEALPRESET]) ? ('Filtered · '+DEAL_PRESETS[DEALPRESET].label) : c;
  document.getElementById('newInquiryBtn').style.display = (VIEW==='products'||VIEW==='clients'||VIEW==='settings')?'none':'inline-flex';
  // pending badge
  const pend = DEALS.filter(d=> pendingInfo(d).overdue).length;
  const bd=document.getElementById('badgeDeals');
  if(pend){ bd.style.display='flex'; bd.textContent=pend; } else bd.style.display='none';
  const fc = DEALS.filter(DEAL_PRESETS.followup.test).length;
  const bf=document.getElementById('badgeFollow');
  if(fc){ bf.style.display='flex'; bf.textContent=fc; } else bf.style.display='none';
}

function render(){
  setActive();
  const el=document.getElementById('content');
  if(VIEW==='dashboard') el.innerHTML=viewDashboard();
  else if(VIEW==='pipeline') el.innerHTML=viewPipeline();
  else if(VIEW==='deals') el.innerHTML=viewDeals();
  else if(VIEW==='products') el.innerHTML=viewProducts();
  else if(VIEW==='clients') el.innerHTML=viewClients();
  else if(VIEW==='settings') el.innerHTML=viewSettings();
  bindContent();
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function viewDashboard(){
  const active = DEALS.filter(d=>!d.lost && d.stage!=='closed');
  const awaitingQuote = DEALS.filter(d=>d.stage==='inquiry'&&!d.lost).length;
  const toSend = DEALS.filter(d=>d.stage==='quotation'&&!d.lost).length;
  const awaitingResp = DEALS.filter(d=>(d.stage==='sent'||d.stage==='followup')&&!d.lost).length;
  const followCount = DEALS.filter(DEAL_PRESETS.followup.test).length;
  const inShip = DEALS.filter(d=>d.stage==='shipping').length;
  const won = DEALS.filter(d=>['converted','shipping','payment','closed'].includes(d.stage)).length;
  const lost = DEALS.filter(d=>d.lost).length;
  const winRate = (won+lost)? Math.round(won/(won+lost)*100):0;
  const payPending = DEALS.filter(d=>{const p=d.payment||{};return d.stage==='payment' && ((Number(p.amount)||0)-(Number(p.received)||0))>0;});
  const payAmt = payPending.reduce((s,d)=> s+((Number(d.payment.amount)||0)-(Number(d.payment.received)||0)),0);
  const overdue = DEALS.filter(d=>pendingInfo(d).overdue);

  const kpi = (label,val,sub,cls='',color='var(--brand)',preset='')=>`
    <div class="kpi ${cls}" ${preset?`data-preset="${preset}" role="button" tabindex="0"`:''}><div class="k-top"><div class="k-label">${label}</div><span class="k-dot" style="background:${color}"></span></div>
    <div class="k-val">${val}</div><div class="k-sub">${sub}${preset?` <span class="k-more">View →</span>`:''}</div></div>`;

  let html = `<div class="kpis">
    ${kpi('Awaiting Quote', awaitingQuote, 'From seniors', awaitingQuote?'alert':'', 'var(--amber)', 'awaitingQuote')}
    ${kpi('To Send', toSend, 'Quote ready', '', 'var(--blue)', 'toSend')}
    ${kpi('Awaiting Reply', awaitingResp, 'Sent + follow-up', '', 'var(--blue)', 'awaitingReply')}
    ${kpi('Follow-up', followCount, 'Needs follow-up', followCount?'alert':'', 'var(--amber)', 'followup')}
    ${kpi('In Shipping', inShip, 'Track ETA', '', 'var(--blue)', 'inShipping')}
    ${kpi('Payment Pending', money(payAmt,'USD'), payPending.length+' order(s)', payPending.length?'alert':'', 'var(--amber)', 'paymentPending')}
    ${kpi('Win Rate', winRate+'%', won+' won / '+lost+' lost', '', 'var(--green)', 'won')}
  </div>`;

  // Needs attention list
  html += `<div class="panel"><div class="p-head"><h2>⚠ Needs Attention</h2><span class="mini">${overdue.length} item(s) overdue</span><div class="spacer"></div></div><div class="p-body">`;
  if(!overdue.length){ html += `<div class="empty" style="padding:26px"><div class="big">✓</div><h3>All clear</h3><div>No overdue items right now.</div></div>`; }
  else{
    html += `<table><thead><tr><th>Inquiry</th><th>Client</th><th>Stage</th><th>Issue</th><th>Age</th><th></th></tr></thead><tbody>`;
    overdue.sort((a,b)=>daysAgo(b.date)-daysAgo(a.date)).forEach(d=>{
      const c=clientById(d.clientId), pi=pendingInfo(d), s=stageOf(d.stage);
      html+=`<tr class="row-click" data-open="${d.id}"><td class="t-mono">${esc(d.no)}</td>
        <td class="t-strong">${esc(c?c.company:'—')}<div class="t-sub">${esc(c?c.country:'')}</div></td>
        <td><span class="chip c-${s.color}"><span class="d" style="background:currentColor"></span>${s.label}</span></td>
        <td><span class="chip c-${pi.chip}">${esc(pi.label)}</span></td>
        <td class="t-sub">${daysAgo(d.date)}d old</td>
        <td class="num" style="white-space:nowrap"><button class="btn sm icon-btn" data-followup="${d.id}" title="Log follow-up">✎</button>
          <button class="btn sm" data-open="${d.id}">Open →</button></td></tr>`;
    });
    html += `</tbody></table>`;
  }
  html += `</div></div>`;

  // Pipeline mini + recent
  html += `<div class="split">`;
  html += `<div class="panel"><div class="p-head"><h2>Pipeline Snapshot</h2></div><div class="p-pad">`;
  STAGES.filter(s=>s.key!=='closed').forEach(s=>{
    const items=DEALS.filter(d=>d.stage===s.key&&!d.lost);
    const val=items.reduce((x,d)=>x+dealTotal(d),0);
    const pct = active.length? Math.round(items.length/active.length*100):0;
    html+=`<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
      <span><span class="chip c-${s.color}" style="margin-right:6px">${items.length}</span><b>${s.label}</b></span>
      <span class="t-sub">${money(val,'USD')}</span></div>
      <div style="height:6px;background:#eef1f5;border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--brand)"></div></div></div>`;
  });
  html += `</div></div>`;

  html += `<div class="panel"><div class="p-head"><h2>Recent Activity</h2></div><div class="p-pad">`;
  const acts=[]; DEALS.forEach(d=>{(d.followups||[]).forEach(f=>acts.push({...f,deal:d}));});
  acts.sort((a,b)=>new Date(b.date)-new Date(a.date));
  if(!acts.length) html+=`<div class="t-sub">No activity logged yet.</div>`;
  else{ html+=`<ul class="timeline">`; acts.slice(0,7).forEach(a=>{const c=clientById(a.deal.clientId);
    html+=`<li><div class="tl-date">${dfmt(a.date)} · ${esc(c?c.company:'')}</div><div class="tl-note">${esc(a.note)}</div></li>`;}); html+=`</ul>`; }
  html += `</div></div></div>`;
  return html;
}

/* ============================================================
   PIPELINE (Kanban)
   ============================================================ */
function viewPipeline(){
  let html=`<div class="filters" style="margin-bottom:16px">
    <div class="searchbar"><span>🔍</span><input id="kSearch" placeholder="Search client or inquiry no…"></div>
    <span class="mini">Drag cards between columns, or open a card to edit.</span></div>`;
  html+=`<div class="kanban" id="kanban">`;
  STAGES.forEach(s=>{
    const items=DEALS.filter(d=>d.stage===s.key && !d.lost);
    html+=`<div class="kcol" data-stage="${s.key}"><div class="kc-head"><span class="chip c-${s.color}" style="padding:2px 8px">${s.label}</span><span class="cnt">${items.length}</span></div>`;
    html+=`<div class="kc-drop" data-stage="${s.key}" style="flex:1;min-height:30px">`;
    if(!items.length) html+=`<div class="kc-empty">—</div>`;
    items.sort((a,b)=>new Date(b.date)-new Date(a.date)).forEach(d=>{
      const c=clientById(d.clientId),pi=pendingInfo(d);
      const prod=(d.items&&d.items[0])?productById(d.items[0].productId):null;
      html+=`<div class="kcard ${pi.overdue?'overdue':''}" draggable="true" data-id="${d.id}" data-open="${d.id}">
        <div class="kc-no">${esc(d.no)} · ${dfmt(d.date)}</div>
        <div class="kc-client">${esc(c?c.company:'—')}</div>
        <div class="t-sub" style="font-size:11.5px">${esc(prod?prod.name.split('(')[0]:'')}${d.items&&d.items.length>1?' +'+(d.items.length-1):''}</div>
        <div class="kc-meta"><span>${esc(d.port||(c?c.country:''))}</span><span class="kc-val">${valueLabel(d)}</span></div>
        ${pi.overdue?`<div style="margin-top:6px"><span class="chip c-red" style="font-size:10.5px">${esc(pi.label)}</span></div>`:''}
      </div>`;
    });
    html+=`</div></div>`;
  });
  html+=`</div>`;
  return html;
}

/* ============================================================
   ALL INQUIRIES (table)
   ============================================================ */
function viewDeals(){
  let controls;
  if(DEALPRESET && DEAL_PRESETS[DEALPRESET]){
    const cnt=DEALS.filter(DEAL_PRESETS[DEALPRESET].test).length;
    controls = `<span class="chip c-blue" style="padding:7px 13px;font-size:13px">▸ ${esc(DEAL_PRESETS[DEALPRESET].label)} · ${cnt}</span>
      <button class="btn sm" id="clearPreset">✕ Clear filter</button>`;
  } else {
    controls = `<select id="fStage"><option value="">All stages</option>${STAGES.map(s=>`<option value="${s.key}">${s.label}</option>`).join('')}<option value="lost">Lost</option><option value="pending">⚠ Pending only</option></select>
    <select id="fClient"><option value="">All clients</option>${CLIENTS.map(c=>`<option value="${c.id}">${esc(c.company)}</option>`).join('')}</select>`;
  }
  let html=`<div class="filters" style="margin-bottom:16px">
    <div class="searchbar"><span>🔍</span><input id="dSearch" placeholder="Search…"></div>
    ${controls}
    <div class="spacer" style="flex:1"></div><span class="mini">${DEALS.length} total</span></div>`;
  html+=`<div class="panel"><div class="p-body"><table id="dealTable"><thead><tr>
    <th>Inquiry</th><th>Client</th><th>Products</th><th>Stage</th><th>Status</th><th class="num">Value</th><th></th></tr></thead><tbody id="dealBody"></tbody></table>
    <div id="dealEmpty"></div></div></div>`;
  return html;
}
function renderDealRows(){
  const q=(document.getElementById('dSearch')?.value||'').toLowerCase();
  const fs=document.getElementById('fStage')?.value||'';
  const fc=document.getElementById('fClient')?.value||'';
  const preset = (DEALPRESET && DEAL_PRESETS[DEALPRESET]) ? DEAL_PRESETS[DEALPRESET].test : null;
  let rows=DEALS.slice().sort((a,b)=>new Date(b.date)-new Date(a.date));
  rows=rows.filter(d=>{
    const c=clientById(d.clientId);
    if(q && !(d.no.toLowerCase().includes(q)||(c&&c.company.toLowerCase().includes(q)))) return false;
    if(preset){ if(!preset(d)) return false; return true; }
    if(fc && d.clientId!==fc) return false;
    if(fs==='lost'){ if(!d.lost) return false; }
    else if(fs==='pending'){ if(!pendingInfo(d).flag||d.lost) return false; }
    else if(fs){ if(d.stage!==fs||d.lost) return false; }
    return true;
  });
  const body=document.getElementById('dealBody'), empty=document.getElementById('dealEmpty');
  if(!rows.length){ body.innerHTML=''; empty.innerHTML=`<div class="empty"><div class="big">🗂</div><h3>No matching inquiries</h3><div>Try a different filter or add a new inquiry.</div></div>`; return; }
  empty.innerHTML='';
  body.innerHTML=rows.map(d=>{
    const c=clientById(d.clientId), s=stageOf(d.stage), pi=pendingInfo(d);
    const prods=(d.items||[]).map(it=>{const p=productById(it.productId);return p?p.name.split('(')[0].trim():'?';});
    const stageCell = d.lost? `<span class="chip c-red">Lost</span>` : `<span class="chip c-${s.color}">${s.label}</span>`;
    const statusCell = d.lost? `<span class="t-sub">${esc(d.lostReason||'—')}</span>` : (pi.flag? `<span class="chip c-${pi.chip}">${esc(pi.label)}</span>`:'<span class="t-sub">—</span>');
    return `<tr class="row-click" data-open="${d.id}">
      <td class="t-mono">${esc(d.no)}<div class="t-sub">${dfmt(d.date)}</div></td>
      <td class="t-strong">${esc(c?c.company:'—')}<div class="t-sub">${esc(c?c.country:'')}</div></td>
      <td class="t-sub">${prods.slice(0,2).map(esc).join(', ')}${prods.length>2?' +'+(prods.length-2):''}</td>
      <td>${stageCell}</td><td>${statusCell}</td>
      <td class="num t-strong">${valueLabel(d)}</td>
      <td class="num"><button class="btn sm" data-open="${d.id}">Open</button></td></tr>`;
  }).join('');
}

/* ============================================================
   PRODUCT MASTER
   ============================================================ */
function viewProducts(){
  let html=`<div class="filters" style="margin-bottom:16px"><div class="searchbar"><span>🔍</span><input id="pSearch" placeholder="Search product / CAS / HSN…"></div><div class="spacer" style="flex:1"></div><button class="btn primary" id="addProduct">＋ Add Product</button></div>`;
  html+=`<div class="panel"><div class="p-body"><table><thead><tr><th>Product</th><th>CAS</th><th>HSN</th><th>Classification</th><th>Unit / Rate</th><th>Docs</th><th></th></tr></thead><tbody id="prodBody"></tbody></table><div id="prodEmpty"></div></div></div>`;
  return html;
}
function renderProdRows(){
  const q=(document.getElementById('pSearch')?.value||'').toLowerCase();
  let rows=PRODUCTS.filter(p=> !q || (p.name+p.cas+p.hsn).toLowerCase().includes(q));
  const body=document.getElementById('prodBody'), empty=document.getElementById('prodEmpty');
  if(!rows.length){ body.innerHTML=''; empty.innerHTML=`<div class="empty"><div class="big">⬡</div><h3>No products</h3><div>Add your chemicals to the master list.</div></div>`; return; }
  empty.innerHTML='';
  body.innerHTML=rows.map(p=>`<tr>
    <td class="t-strong">${esc(p.name)}<div class="t-sub">${esc(p.packing||'')}</div></td>
    <td class="t-mono">${esc(p.cas||'—')}</td><td class="t-mono">${esc(p.hsn||'—')}</td>
    <td><span class="tag ${p.haz?'haz':'ok'}">${esc(p.classification||'—')}</span></td>
    <td>${esc(p.unit||'')} · ${money(p.rate,p.currency)}</td>
    <td>${p.msds?'<span class="tag ok">MSDS</span>':'<span class="tag">no MSDS</span>'}${p.coa?'<span class="tag ok">COA</span>':'<span class="tag">no COA</span>'}</td>
    <td class="num"><button class="btn sm" data-editprod="${p.id}">Edit</button></td></tr>`).join('');
}

/* ============================================================
   CLIENT MASTER
   ============================================================ */
function viewClients(){
  let html=`<div class="filters" style="margin-bottom:16px"><div class="searchbar"><span>🔍</span><input id="cSearch" placeholder="Search client / country…"></div><div class="spacer" style="flex:1"></div><button class="btn primary" id="addClient">＋ Add Client</button></div>`;
  html+=`<div class="panel"><div class="p-body"><table><thead><tr><th>Company</th><th>Contact</th><th>Country</th><th>Email / Phone</th><th class="num">Inquiries</th><th></th></tr></thead><tbody id="cliBody"></tbody></table><div id="cliEmpty"></div></div></div>`;
  return html;
}
function renderCliRows(){
  const q=(document.getElementById('cSearch')?.value||'').toLowerCase();
  let rows=CLIENTS.filter(c=> !q || (c.company+c.country+c.contact).toLowerCase().includes(q));
  const body=document.getElementById('cliBody'), empty=document.getElementById('cliEmpty');
  if(!rows.length){ body.innerHTML=''; empty.innerHTML=`<div class="empty"><div class="big">◈</div><h3>No clients</h3><div>Add your buyers and importers.</div></div>`; return; }
  empty.innerHTML='';
  body.innerHTML=rows.map(c=>{
    const cnt=DEALS.filter(d=>d.clientId===c.id).length;
    return `<tr><td class="t-strong">${esc(c.company)}<div class="t-sub">${esc(c.notes||'')}</div></td>
    <td>${esc(c.contact||'—')}</td><td>${esc(c.country||'—')}</td>
    <td class="t-sub">${esc(c.email||'')}<br>${esc(c.phone||'')}</td>
    <td class="num">${cnt}</td><td class="num"><button class="btn sm" data-editcli="${c.id}">Edit</button></td></tr>`;
  }).join('');
}

/* ============================================================
   SETTINGS
   ============================================================ */
function viewSettings(){
  const s=SETTINGS;
  return `<div class="split">
  <div class="panel"><div class="p-head"><h2>Company Profile</h2><span class="mini">Shown on every quotation</span></div><div class="p-pad">
    <div class="field"><label class="lbl">Legal name</label><input id="s_company" value="${esc(s.company)}"></div>
    <div class="field"><label class="lbl">Brand / trade name</label><input id="s_brand" value="${esc(s.brand)}"></div>
    <div class="field"><label class="lbl">Address</label><textarea id="s_address">${esc(s.address)}</textarea></div>
    <div class="grid2">
      <div class="field"><label class="lbl">GSTIN</label><input id="s_gstin" value="${esc(s.gstin)}"></div>
      <div class="field"><label class="lbl">IEC code</label><input id="s_iec" value="${esc(s.iec)}"></div>
      <div class="field"><label class="lbl">Email</label><input id="s_email" value="${esc(s.email)}"></div>
      <div class="field"><label class="lbl">Phone</label><input id="s_phone" value="${esc(s.phone)}"></div>
    </div>
    <div class="field"><label class="lbl">Website</label><input id="s_web" value="${esc(s.website)}"></div>
    <div class="field"><label class="lbl">Bank details (for quotation footer)</label><textarea id="s_bank">${esc(s.bank)}</textarea></div>
    <button class="btn primary" id="saveSettings">Save profile</button>
  </div></div>
  <div>
    <div class="panel"><div class="p-head"><h2>Users & Access</h2><span class="mini">${USERS.length} user(s)</span><div class="spacer"></div><button class="btn sm primary" id="addUserBtn">＋ Add user</button></div>
      <div class="p-body"><table><thead><tr><th>Name</th><th>Login ID</th><th>Role</th><th></th></tr></thead><tbody>
      ${USERS.map(u=>`<tr><td class="t-strong">${esc(u.name)}${u.uid===CURRENT.uid?' <span class="tag ok">you</span>':''}</td>
        <td class="t-mono">${esc(u.loginId)}</td><td><span class="tag">${esc(u.role)}</span></td>
        <td class="num" style="white-space:nowrap"><button class="btn sm" data-resetpw="${u.uid}">Reset PW</button> <button class="btn sm danger" data-rmuser="${u.uid}">Remove</button></td></tr>`).join('')}
      </tbody></table></div></div>
    <div class="panel"><div class="p-head"><h2>Quotation Defaults</h2></div><div class="p-pad">
      <div class="field"><label class="lbl">Default terms & conditions</label><textarea id="s_terms" style="min-height:120px">${esc(s.quoteTerms)}</textarea></div>
      <div class="field"><label class="lbl">Senior approvers (comma separated)</label><input id="s_seniors" value="${esc((s.seniors||[]).join(', '))}"></div>
      <div class="field"><label class="lbl">Incoterms (comma separated)</label><input id="s_incoterms" value="${esc((s.incoterms||[]).join(', '))}"></div>
      <button class="btn primary" id="saveQuoteDefaults">Save defaults</button>
    </div></div>
    <div class="panel"><div class="p-head"><h2>Excel Import / Export</h2></div><div class="p-pad">
      <p class="mini" style="margin-top:0">Clients aur Products ko Excel mein export karo, edit karo, aur wapas import karo. Bulk data entry ke liye best.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <button class="btn" id="xlExportAll">⬇ Export all to Excel</button>
        <button class="btn" id="xlTemplate">⬇ Blank template</button>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button class="btn" id="xlImport">⬆ Import from Excel</button>
        <span class="mini">Clients / Products sheets ko add karega</span>
        <input type="file" id="xlFile" accept=".xlsx,.xls,.csv" style="display:none">
      </div>
      <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
      <button class="btn danger" id="clearClients">🗑 Clear all Clients</button>
      <p class="mini">Saare clients hata deta hai (naye add karne se pehle). Inquiries/products safe rehte hain.</p>
    </div></div>
    <div class="panel"><div class="p-head"><h2>Data & Backup (JSON)</h2></div><div class="p-pad">
      <p class="mini" style="margin-top:0">Data aapke apne server par store hota hai (sab staff ke liye shared). Export ek JSON snapshot deta hai offline safekeeping ke liye; Import wapas server par push karta hai.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" id="exportData">⬇ Export backup (JSON)</button>
        <button class="btn" id="importData">⬆ Import backup</button>
        <input type="file" id="importFile" accept="application/json" style="display:none">
      </div>
      <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
      <button class="btn danger" id="resetData">Refresh from server</button>
      <p class="mini">Server se data dobara load karta hai. Kuch bhi delete nahi hota.</p>
    </div></div>
  </div></div>`;
}

/* ============================================================
   BINDINGS
   ============================================================ */
function bindContent(){
  // universal open-deal
  document.getElementById('content').addEventListener('click',contentClick);
  if(VIEW==='dashboard'){}
  if(VIEW==='pipeline'){ bindKanban(); document.getElementById('kSearch').addEventListener('input',filterKanban); }
  if(VIEW==='deals'){ renderDealRows(); ['dSearch','fStage','fClient'].forEach(id=>{const e=document.getElementById(id);e.addEventListener('input',renderDealRows);e.addEventListener('change',renderDealRows);}); }
  if(VIEW==='products'){ renderProdRows(); document.getElementById('pSearch').addEventListener('input',renderProdRows); document.getElementById('addProduct').addEventListener('click',()=>openProductForm()); }
  if(VIEW==='clients'){ renderCliRows(); document.getElementById('cSearch').addEventListener('input',renderCliRows); document.getElementById('addClient').addEventListener('click',()=>openClientForm()); }
  if(VIEW==='settings') bindSettings();
}
// avoid duplicate listeners: re-bind cleanly each render
function contentClick(e){
  const kp=e.target.closest('[data-preset]'); if(kp){ DEALPRESET=kp.dataset.preset; VIEW='deals'; render(); return; }
  const fu=e.target.closest('[data-followup]'); if(fu){ e.stopPropagation(); openFollowupQuick(fu.dataset.followup); return; }
  const open=e.target.closest('[data-open]'); if(open){ openDealDetail(open.dataset.open); return; }
  const ep=e.target.closest('[data-editprod]'); if(ep){ openProductForm(ep.dataset.editprod); return; }
  const ec=e.target.closest('[data-editcli]'); if(ec){ openClientForm(ec.dataset.editcli); return; }
  const rp=e.target.closest('[data-resetpw]'); if(rp){ openChangePw(rp.dataset.resetpw,false); return; }
  const ru=e.target.closest('[data-rmuser]'); if(ru){ const u=USERS.find(x=>x.uid===ru.dataset.rmuser); if(u) removeUser(u); return; }
}
function openFollowupQuick(id){
  const d=DEALS.find(x=>x.id===id); if(!d) return; const c=clientById(d.clientId);
  openModal(`<div class="m-head"><h3>Log follow-up — ${esc(d.no)}</h3><button class="x" onclick="closeModal()">×</button></div>
   <div class="m-body">
     <p class="hint" style="margin-top:0">Buyer: <b>${esc(c?c.company:'')}</b> · Stage: <b>${esc(stageOf(d.stage).label)}</b></p>
     <div class="field full"><label class="lbl">Follow-up note / call log <span class="req">*</span></label>
       <textarea id="fq_note" style="min-height:90px" placeholder="e.g. Called buyer, asked to confirm order by Friday"></textarea></div>
     <div class="field full"><label class="lbl">Next follow-up date (optional)</label><input type="date" id="fq_next"></div>
     ${(d.followups&&d.followups.length)?`<div class="section-title">Earlier notes</div>
       <ul class="timeline">${d.followups.slice(-3).reverse().map(f=>`<li><div class="tl-date">${dfmt(f.date)}</div><div class="tl-note">${esc(f.note)}</div></li>`).join('')}</ul>`:''}
   </div>
   <div class="m-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="fqSave">Save follow-up</button></div>`);
  document.getElementById('fqSave').onclick=()=>{
    const note=document.getElementById('fq_note').value.trim(); if(!note){ toast('Note likho'); return; }
    const next=document.getElementById('fq_next').value;
    d.followups=d.followups||[]; d.followups.push({date:today(),note: note + (next?(' · next follow-up: '+dfmt(next)):'')});
    if(d.stage==='sent') d.stage='followup';
    persist(); closeModal(); render(); toast('Follow-up logged');
  };
}
// contentClick attaches each render; strip old by replacing node content already clears listeners on children,
// but the parent #content persists. Use a flag.
(function(){ const c=document.getElementById('content'); let bound=false;
  const orig=bindContent;
  window.bindContent=function(){ if(!bound){ c.addEventListener('click',contentClick); bound=true; }
    // per-view bindings (without re-adding contentClick)
    if(VIEW==='pipeline'){ bindKanban(); document.getElementById('kSearch').addEventListener('input',filterKanban); }
    if(VIEW==='deals'){ renderDealRows();
      const ds=document.getElementById('dSearch'); if(ds) ds.oninput=renderDealRows;
      const cp=document.getElementById('clearPreset'); if(cp) cp.onclick=()=>{ DEALPRESET=null; render(); };
      ['fStage','fClient'].forEach(id=>{const el=document.getElementById(id); if(el){ el.oninput=renderDealRows; el.onchange=renderDealRows; }});
    }
    if(VIEW==='products'){ renderProdRows(); document.getElementById('pSearch').oninput=renderProdRows; document.getElementById('addProduct').onclick=()=>openProductForm(); }
    if(VIEW==='clients'){ renderCliRows(); document.getElementById('cSearch').oninput=renderCliRows; document.getElementById('addClient').onclick=()=>openClientForm(); }
    if(VIEW==='settings') bindSettings();
  };
})();

/* ---------- Kanban drag ---------- */
let dragId=null;
function bindKanban(){
  document.querySelectorAll('.kcard').forEach(card=>{
    card.addEventListener('dragstart',e=>{ dragId=card.dataset.id; card.style.opacity='.4'; });
    card.addEventListener('dragend',e=>{ card.style.opacity='1'; });
  });
  document.querySelectorAll('.kc-drop').forEach(col=>{
    col.addEventListener('dragover',e=>{ e.preventDefault(); col.parentElement.style.background='#e3f0f1'; });
    col.addEventListener('dragleave',e=>{ col.parentElement.style.background=''; });
    col.addEventListener('drop',e=>{ e.preventDefault(); col.parentElement.style.background='';
      const d=DEALS.find(x=>x.id===dragId); if(d && d.stage!==col.dataset.stage){ d.stage=col.dataset.stage; d.lost=false; persist(); toast('Moved to '+stageOf(d.stage).label); render(); } });
  });
}
function filterKanban(){
  const q=document.getElementById('kSearch').value.toLowerCase();
  document.querySelectorAll('.kcard').forEach(c=>{ c.style.display = c.textContent.toLowerCase().includes(q)?'':'none'; });
}

/* ============================================================
   MODAL system
   ============================================================ */
const overlay=document.getElementById('overlay'), modalEl=document.getElementById('modal');
function openModal(html,wide){ modalEl.className='modal'+(wide?' wide':''); modalEl.innerHTML=html; overlay.classList.add('on'); }
function closeModal(){ overlay.classList.remove('on'); modalEl.innerHTML=''; }
overlay.addEventListener('click',e=>{ if(e.target===overlay) closeModal(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeModal(); });

/* ---------- DEAL: create / edit basic ---------- */
function openDealForm(id){
  const d = id? DEALS.find(x=>x.id===id) : null;
  const clientOpts = CLIENTS.map(c=>`<option value="${c.id}" ${d&&d.clientId===c.id?'selected':''}>${esc(c.company)} — ${esc(c.country)}</option>`).join('');
  openModal(`
   <div class="m-head"><h3>${id?'Edit Inquiry':'New Inquiry'}</h3><button class="x" onclick="closeModal()">×</button></div>
   <div class="m-body">
     <p class="hint" style="margin-top:0">Inquiry stage mein sirf enquiry details bharo — <b>rate senior add karega</b> quotation step mein.</p>
     <div class="grid2">
       <div class="field"><label class="lbl">Inquiry date <span class="req">*</span></label><input type="date" id="d_date" value="${d?d.date:today()}"></div>
       <div class="field"><label class="lbl">Destination port</label><input id="d_port" value="${esc(d?d.port:'')}" placeholder="e.g. Jebel Ali, UAE"></div>
     </div>
     <div class="field full"><label class="lbl">Client <span class="req">*</span></label>
       <select id="d_client"><option value="">— Select client —</option>${clientOpts}</select>
       <div class="hint">Missing a buyer? Add them in Client Master first.</div></div>
     <div class="section-title">Products enquired</div>
     <table class="li-table"><thead><tr><th style="width:58%">Product</th><th>Quantity</th><th>Unit</th><th></th></tr></thead>
       <tbody id="liBody"></tbody></table>
     <button class="btn sm" id="addLine">＋ Add product line</button>
   </div>
   <div class="m-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="saveDeal">${id?'Save changes':'Create inquiry'}</button></div>
  `,true);

  const items = d? JSON.parse(JSON.stringify(d.items||[])) : [{productId:'',qty:'',unit:'',rate:''}];
  function drawLines(){
    const tb=document.getElementById('liBody');
    tb.innerHTML=items.map((it,i)=>{
      const opts=PRODUCTS.map(p=>`<option value="${p.id}" ${it.productId===p.id?'selected':''}>${esc(p.name)}</option>`).join('');
      return `<tr>
        <td><select data-li="${i}" data-f="productId" style="width:100%"><option value="">— select —</option>${opts}</select></td>
        <td><input data-li="${i}" data-f="qty" value="${it.qty}" style="width:80px" inputmode="decimal"></td>
        <td><input data-li="${i}" data-f="unit" value="${esc(it.unit||'')}" style="width:64px"></td>
        <td><button class="liDel" data-del="${i}">×</button></td></tr>`;
    }).join('');
  }
  drawLines();
  document.getElementById('liBody').addEventListener('input',e=>{
    const el=e.target; if(el.dataset.li===undefined) return;
    const i=+el.dataset.li, f=el.dataset.f; items[i][f]=el.value;
    if(f==='productId'){ const p=productById(el.value); if(p && !items[i].unit){ items[i].unit=p.unit; drawLines(); } }
  });
  document.getElementById('liBody').addEventListener('click',e=>{ const b=e.target.closest('[data-del]'); if(b){ items.splice(+b.dataset.del,1); if(!items.length)items.push({productId:'',qty:'',unit:'',rate:''}); drawLines(); } });
  document.getElementById('addLine').onclick=()=>{ items.push({productId:'',qty:'',unit:'',rate:''}); drawLines(); };

  document.getElementById('saveDeal').onclick=()=>{
    const clientId=document.getElementById('d_client').value;
    const date=document.getElementById('d_date').value;
    const port=document.getElementById('d_port').value.trim();
    if(!clientId){ toast('Select a client'); return; }
    const cleanItems=items.filter(it=>it.productId&&it.qty).map(it=>({productId:it.productId,qty:it.qty,unit:it.unit||'',rate:(it.rate||'')}));
    if(!cleanItems.length){ toast('Add at least one product with quantity'); return; }
    if(id){ Object.assign(d,{clientId,date,port,items:cleanItems}); toast('Inquiry updated'); }
    else{
      SETTINGS.inqCounter=(SETTINGS.inqCounter||0)+1;
      const no='AXR-INQ-'+String(SETTINGS.inqCounter).padStart(4,'0');
      DEALS.push({id:uid('d'),no,clientId,date,port,currency:'USD',incoterm:'',items:cleanItems,stage:'inquiry',quoteNo:'',quoteDate:'',validity:15,quotedBy:'',terms:'',shipping:{},payment:{},followups:[],lost:false,lostReason:''});
      toast('Inquiry '+no+' created');
    }
    persist(); closeModal(); render();
  };
}

/* ---------- DEAL DETAIL (the big one) ---------- */
function openDealDetail(id){
  const d=DEALS.find(x=>x.id===id); if(!d) return;
  const c=clientById(d.clientId);
  const idx=stageIdx(d.stage);
  const stepper=STAGES.map((s,i)=>`<div class="step ${d.lost?'':(i<idx?'done':i===idx?'current':'')}">${s.label}</div>`).join('');
  const pi=pendingInfo(d);

  // items table
  const itemRows=(d.items||[]).map(it=>{const p=productById(it.productId);const r=Number(it.rate)>0;
    return `<tr><td>${esc(p?p.name:'?')}<div class="t-sub">${p?('CAS '+p.cas+' · HSN '+p.hsn):''}</div></td>
      <td>${it.qty} ${esc(it.unit||'')}</td><td class="num">${r?money(it.rate,d.currency):'—'}</td>
      <td class="num t-strong">${r?money((Number(it.qty)||0)*(Number(it.rate)||0),d.currency):'—'}</td></tr>`;}).join('');

  // docs checklist from products
  const docLines=(d.items||[]).map(it=>{const p=productById(it.productId); if(!p) return '';
    return `<div class="doc-line"><b style="flex:1">${esc(p.name.split('(')[0])}</b>
      ${p.msds?`<span class="tag ok">MSDS ✓</span>`:`<span class="tag">MSDS missing</span>`}
      ${p.coa?`<span class="tag ok">COA ✓</span>`:`<span class="tag">COA missing</span>`}
      <span class="tag ${p.haz?'haz':''}">${esc(p.classification)}</span></div>`;}).join('');

  const sh=d.shipping||{}, pay=d.payment||{};
  const bal=(Number(pay.amount)||0)-(Number(pay.received)||0);

  // stage action button
  let nextBtn='';
  const nextMap={inquiry:['Add rate / quotation','quote'],quotation:['Mark as sent','sent'],sent:['Log follow-up','followup'],followup:['Convert to order','converted'],converted:['Start shipping','shipping'],shipping:['Move to payment','payment'],payment:['Close deal','closed']};
  if(nextMap[d.stage] && !d.lost){ nextBtn=`<button class="btn primary" data-action="${nextMap[d.stage][1]}">${nextMap[d.stage][0]} →</button>`; }

  openModal(`
   <div class="m-head"><h3>${esc(d.no)} · ${esc(c?c.company:'')}</h3>
     <span class="chip c-${d.lost?'red':stageOf(d.stage).color}" style="margin-left:6px">${d.lost?'Lost':stageOf(d.stage).label}</span>
     <button class="x" onclick="closeModal()">×</button></div>
   <div class="m-body">
     <div class="stepper">${stepper}</div>
     ${pi.flag&&!d.lost?`<div style="margin-bottom:14px"><span class="chip c-${pi.chip}">⚠ ${esc(pi.label)}</span></div>`:''}
     <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:14px;font-size:13px">
       <span class="t-sub">Inquiry date:</span> <b>${dfmt(d.date)}</b>
       <span class="t-sub">Destination port:</span> <b>${esc(d.port||'—')}</b>
       <span class="t-sub">Buyer country:</span> <b>${esc(c?c.country:'—')}</b>
     </div>
     <div class="detail-grid">
       <div>
         <div class="dg-block"><h4>Products & Value</h4>
           <table><thead><tr><th>Item</th><th>Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
           <tbody>${itemRows}</tbody>
           <tfoot><tr><td colspan="3" class="num t-strong">Total (${esc(d.currency)} · ${esc(d.incoterm||'')})</td><td class="num t-strong">${hasRates(d)?money(dealTotal(d),d.currency):"<span class='t-sub'>Rate pending</span>"}</td></tr></tfoot></table>
         </div>
         <div class="dg-block"><h4>Documents (from product master)</h4>${docLines||'<div class="t-sub">No products.</div>'}
           <div class="hint">Upload MSDS/COA per product in the Product Master so they’re ready for every shipment.</div></div>
         <div class="dg-block"><h4>Follow-up log</h4>
           <div style="display:flex;gap:8px;margin-bottom:12px"><input id="fuNote" placeholder="Add a note / call log…" style="flex:1;padding:8px 11px;border:1px solid var(--line-2);border-radius:8px"><button class="btn" id="addFu">Add</button></div>
           <ul class="timeline" id="fuList">${(d.followups||[]).slice().reverse().map(f=>`<li><div class="tl-date">${dfmt(f.date)}</div><div class="tl-note">${esc(f.note)}</div></li>`).join('')||'<li class="t-sub" style="border:0">No notes yet.</li>'}</ul>
         </div>
       </div>
       <div>
         <div class="dg-block"><h4>Quotation</h4>
           ${d.quoteNo?`<div class="kv"><span class="k">Quote no</span><span class="v t-mono">${esc(d.quoteNo)}</span></div>
           <div class="kv"><span class="k">Date</span><span class="v">${dfmt(d.quoteDate)}</span></div>
           <div class="kv"><span class="k">Validity</span><span class="v">${d.validity||15} days</span></div>
           <div class="kv"><span class="k">Approved by</span><span class="v">${esc(d.quotedBy||'—')}</span></div>`
           :`<div class="t-sub" style="padding:6px 0">No quotation yet. Senior approval pending.</div>`}
           <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
             <button class="btn sm" data-action="quote">${d.quoteNo?'Edit quote':'Add quote'}</button>
             ${d.quoteNo?`<button class="btn sm primary" data-print="${d.id}">🖨 Print / PDF</button>`:''}
           </div>
         </div>
         <div class="dg-block"><h4>Shipping</h4>
           <div class="kv"><span class="k">Line / Forwarder</span><span class="v">${esc(sh.company||'—')}</span></div>
           <div class="kv"><span class="k">BL / Booking</span><span class="v t-mono">${esc(sh.blNo||'—')}</span></div>
           <div class="kv"><span class="k">POL → POD</span><span class="v">${esc(sh.pol||'—')} → ${esc(sh.pod||'—')}</span></div>
           <div class="kv"><span class="k">ETD</span><span class="v">${dfmt(sh.etd)}</span></div>
           <div class="kv"><span class="k">ETA</span><span class="v">${dfmt(sh.eta)}</span></div>
           <div class="kv"><span class="k">Status</span><span class="v">${esc(sh.status||'—')}</span></div>
           <button class="btn sm" data-action="ship" style="margin-top:8px">Update shipping</button>
         </div>
         <div class="dg-block"><h4>Payment</h4>
           <div class="kv"><span class="k">Invoice no</span><span class="v t-mono">${esc(pay.invoiceNo||'—')}</span></div>
           <div class="kv"><span class="k">Terms</span><span class="v">${esc(pay.terms||'—')}</span></div>
           <div class="kv"><span class="k">Invoice amt</span><span class="v">${money(pay.amount||0,d.currency)}</span></div>
           <div class="kv"><span class="k">Received</span><span class="v">${money(pay.received||0,d.currency)}</span></div>
           <div class="kv"><span class="k">Balance</span><span class="v" style="color:${bal>0?'var(--red)':'var(--green)'}">${money(bal,d.currency)}</span></div>
           <div class="kv"><span class="k">Due date</span><span class="v">${dfmt(pay.dueDate)}</span></div>
           <button class="btn sm" data-action="pay" style="margin-top:8px">Update payment</button>
         </div>
       </div>
     </div>
   </div>
   <div class="m-foot">
     <button class="btn danger" id="delDeal" style="margin-right:auto">Delete</button>
     <select id="moveStage" title="Manually move to any stage" style="padding:8px 10px;border:1px solid var(--line-2);border-radius:8px">
       <option value="">Move to…</option>
       ${STAGES.map(s=>`<option value="${s.key}" ${d.stage===s.key&&!d.lost?'selected':''}>${s.label}</option>`).join('')}
     </select>
     ${d.lost?`<button class="btn" data-action="reopen">Re-open</button>`:`<button class="btn" data-action="lost">Mark lost</button>`}
     <button class="btn" data-action="edit">Edit items</button>
     ${nextBtn}
   </div>
  `,true);

  // manual stage move
  document.getElementById('moveStage').onchange=e=>{ const st=e.target.value; if(!st)return;
    if(st!=='inquiry' && !d.quoteNo && ['quotation','sent','followup','converted','shipping','payment','closed'].includes(st)){ toast('Pehle rate/quotation add karo'); e.target.value=d.stage; return; }
    d.stage=st; d.lost=false; d.followups=d.followups||[]; d.followups.push({date:today(),note:'Manually moved to '+stageOf(st).label}); persist(); toast('Moved to '+stageOf(st).label); openDealDetail(id); render(); };

  // follow-up add
  document.getElementById('addFu').onclick=()=>{ const v=document.getElementById('fuNote').value.trim(); if(!v)return; d.followups=d.followups||[]; d.followups.push({date:today(),note:v}); if(d.stage==='sent')d.stage='followup'; persist(); openDealDetail(id); };
  document.getElementById('delDeal').onclick=()=>{ if(confirm('Delete this inquiry permanently?')){ DEALS=DEALS.filter(x=>x.id!==id); cloudDelete('deals',id); persist(); closeModal(); render(); toast('Deleted'); } };

  modalEl.querySelectorAll('[data-action]').forEach(b=> b.onclick=()=>dealAction(id,b.dataset.action));
  const pb=modalEl.querySelector('[data-print]'); if(pb) pb.onclick=()=>printQuotation(id);
}

function dealAction(id,act){
  const d=DEALS.find(x=>x.id===id);
  if(act==='edit'){ openDealForm(id); return; }
  if(act==='lost'){ const r=prompt('Reason for losing this deal?','Price too high'); if(r!==null){ d.lost=true; d.lostReason=r; persist(); openDealDetail(id); render(); } return; }
  if(act==='reopen'){ d.lost=false; d.lostReason=''; persist(); openDealDetail(id); return; }
  if(act==='quote'){ openQuoteForm(id); return; }
  if(act==='ship'){ openShipForm(id); return; }
  if(act==='pay'){ openPayForm(id); return; }
  // simple stage advances
  if(act==='sent'){ if(!d.quoteNo){ toast('Add a quotation first'); openQuoteForm(id); return; } d.stage='sent'; d.followups=d.followups||[]; d.followups.push({date:today(),note:'Quotation '+d.quoteNo+' sent to client'}); }
  else if(act==='followup'){ openDealDetail(id); return; }
  else if(act==='converted'){ d.stage='converted'; d.followups=d.followups||[]; d.followups.push({date:today(),note:'Order confirmed — converted to order'}); if(!d.payment.amount)d.payment.amount=dealTotal(d); }
  else if(act==='shipping'){ d.stage='shipping'; openShipForm(id); return; }
  else if(act==='payment'){ d.stage='payment'; openPayForm(id); return; }
  else if(act==='closed'){ d.stage='closed'; d.followups=d.followups||[]; d.followups.push({date:today(),note:'Deal closed'}); }
  persist(); render(); openDealDetail(id);
}

/* ---------- Quote form (senior approval + numbering) ---------- */
function openQuoteForm(id){
  const d=DEALS.find(x=>x.id===id); const c=clientById(d.clientId);
  const seniorOpts=(SETTINGS.seniors||[]).map(s=>`<option ${d.quotedBy===s?'selected':''}>${esc(s)}</option>`).join('');
  const curOpts=Object.keys(CUR).map(k=>`<option value="${k}" ${((d.currency||'USD')===k)?'selected':''}>${k}</option>`).join('');
  const incoOpts=['— select —',...(SETTINGS.incoterms||['FOB','CIF'])].map(t=>`<option value="${t==='— select —'?'':esc(t)}" ${d.incoterm===t?'selected':''}>${esc(t)}</option>`).join('');
  const rateItems = JSON.parse(JSON.stringify(d.items||[]));
  openModal(`<div class="m-head"><h3>Rate / Quotation — ${esc(d.no)}</h3><span class="chip c-amber" style="margin-left:6px">Senior pricing</span><button class="x" onclick="closeModal()">×</button></div>
   <div class="m-body">
     <p class="hint" style="margin-top:0">Buyer: <b>${esc(c?c.company:'')}</b> · Port: <b>${esc(d.port||'—')}</b>. Rate daalte hi inquiry <b>Quotation</b> stage mein move ho jaayegi.</p>
     <div class="grid3">
       <div class="field"><label class="lbl">Currency</label><select id="q_cur">${curOpts}</select></div>
       <div class="field"><label class="lbl">Incoterm</label><select id="q_inco">${incoOpts}</select></div>
       <div class="field"><label class="lbl">Validity (days)</label><input id="q_valid" value="${d.validity||15}" inputmode="numeric"></div>
     </div>
     <div class="section-title">Enter rate per product <span class="req">*</span></div>
     <table class="li-table"><thead><tr><th style="width:50%">Product</th><th>Qty</th><th>Rate</th><th class="num">Amount</th></tr></thead>
       <tbody id="qBody"></tbody></table>
     <div style="text-align:right;margin-top:8px;font-weight:800;font-size:15px" id="qTotal"></div>
     <div class="section-title">Approval & terms</div>
     <div class="grid2">
       <div class="field"><label class="lbl">Quotation no</label><input id="q_no" value="${esc(d.quoteNo|| 'AXR-QTN-'+String((SETTINGS.quoteCounter||0)+1).padStart(4,'0'))}"></div>
       <div class="field"><label class="lbl">Quotation date</label><input type="date" id="q_date" value="${d.quoteDate||today()}"></div>
       <div class="field full"><label class="lbl">Approved by (senior) <span class="req">*</span></label><select id="q_by"><option value="">— select —</option>${seniorOpts}</select></div>
     </div>
     <div class="field full"><label class="lbl">Terms & conditions</label><textarea id="q_terms" style="min-height:80px">${esc(d.terms||SETTINGS.quoteTerms)}</textarea></div>
   </div>
   <div class="m-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="saveQuote">Save & move to Quotation</button></div>`,true);

  // Build the input rows ONCE so typing doesn't lose focus.
  document.getElementById('qBody').innerHTML=rateItems.map((it,i)=>{const p=productById(it.productId);
    return `<tr><td><b>${esc(p?p.name:'?')}</b></td><td>${it.qty} ${esc(it.unit||'')}</td>
      <td><input data-q="${i}" value="${it.rate||''}" style="width:110px" inputmode="decimal" placeholder="rate"></td>
      <td class="num t-strong" id="qAmt${i}">—</td></tr>`;}).join('');
  function recalc(){
    const cur=document.getElementById('q_cur').value;
    rateItems.forEach((it,i)=>{ const amt=(Number(it.qty)||0)*(Number(it.rate)||0); const cell=document.getElementById('qAmt'+i); if(cell) cell.textContent=amt?money(amt,cur):'—'; });
    document.getElementById('qTotal').textContent='Total: '+money(rateItems.reduce((s,it)=>s+(Number(it.qty)||0)*(Number(it.rate)||0),0),cur);
  }
  recalc();
  document.getElementById('qBody').addEventListener('input',e=>{ const el=e.target; if(el.dataset.q===undefined)return; rateItems[+el.dataset.q].rate=el.value; recalc(); });
  document.getElementById('q_cur').onchange=recalc;

  document.getElementById('saveQuote').onclick=()=>{
    if(rateItems.some(it=>!(Number(it.rate)>0))){ toast('Har product ka rate daalo'); return; }
    if(!document.getElementById('q_by').value){ toast('Senior approver select karo'); return; }
    const wasUnquoted = d.stage==='inquiry';
    const wasNew=!d.quoteNo;
    d.items=rateItems;
    d.currency=document.getElementById('q_cur').value;
    d.incoterm=document.getElementById('q_inco').value;
    d.quoteNo=document.getElementById('q_no').value.trim();
    d.quoteDate=document.getElementById('q_date').value;
    d.validity=+document.getElementById('q_valid').value||15;
    d.quotedBy=document.getElementById('q_by').value;
    d.terms=document.getElementById('q_terms').value;
    if(wasNew) SETTINGS.quoteCounter=(SETTINGS.quoteCounter||0)+1;
    if(wasUnquoted){ d.stage='quotation'; d.followups=d.followups||[]; d.followups.push({date:today(),note:'Rate approved by '+d.quotedBy+' — quotation '+d.quoteNo+' ready'}); }
    persist(); toast(wasUnquoted?'Moved to Quotation':'Quotation updated'); openDealDetail(id); render();
  };
}

/* ---------- Shipping form ---------- */
function openShipForm(id){
  const d=DEALS.find(x=>x.id===id); const s=d.shipping||{};
  openModal(`<div class="m-head"><h3>Shipping — ${esc(d.no)}</h3><button class="x" onclick="closeModal()">×</button></div>
   <div class="m-body"><div class="grid2">
     <div class="field"><label class="lbl">Shipping line / forwarder</label><input id="sh_c" value="${esc(s.company||'')}"></div>
     <div class="field"><label class="lbl">BL / Booking no</label><input id="sh_bl" value="${esc(s.blNo||'')}"></div>
     <div class="field"><label class="lbl">Port of loading</label><input id="sh_pol" value="${esc(s.pol||'')}"></div>
     <div class="field"><label class="lbl">Port of discharge</label><input id="sh_pod" value="${esc(s.pod||'')}"></div>
     <div class="field"><label class="lbl">ETD</label><input type="date" id="sh_etd" value="${s.etd||''}"></div>
     <div class="field"><label class="lbl">ETA</label><input type="date" id="sh_eta" value="${s.eta||''}"></div>
     <div class="field full"><label class="lbl">Status</label><input id="sh_st" value="${esc(s.status||'')}" placeholder="e.g. Booking done / Gated in / Sailed / Arrived"></div>
   </div></div>
   <div class="m-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="saveShip">Save</button></div>`);
  document.getElementById('saveShip').onclick=()=>{
    d.shipping={company:val('sh_c'),blNo:val('sh_bl'),pol:val('sh_pol'),pod:val('sh_pod'),etd:val('sh_etd'),eta:val('sh_eta'),status:val('sh_st')};
    if(d.stage==='converted')d.stage='shipping';
    persist(); toast('Shipping updated'); openDealDetail(id); render();
  };
}
/* ---------- Payment form ---------- */
function openPayForm(id){
  const d=DEALS.find(x=>x.id===id); const p=d.payment||{};
  openModal(`<div class="m-head"><h3>Payment — ${esc(d.no)}</h3><button class="x" onclick="closeModal()">×</button></div>
   <div class="m-body"><div class="grid2">
     <div class="field"><label class="lbl">Invoice no</label><input id="py_inv" value="${esc(p.invoiceNo||'')}"></div>
     <div class="field"><label class="lbl">Payment terms</label><input id="py_terms" value="${esc(p.terms||'30% adv / 70% BL')}"></div>
     <div class="field"><label class="lbl">Invoice amount (${d.currency})</label><input id="py_amt" value="${p.amount||dealTotal(d)}" inputmode="decimal"></div>
     <div class="field"><label class="lbl">Received amount</label><input id="py_rec" value="${p.received||0}" inputmode="decimal"></div>
     <div class="field"><label class="lbl">Due date</label><input type="date" id="py_due" value="${p.dueDate||''}"></div>
     <div class="field"><label class="lbl">Status</label><input id="py_st" value="${esc(p.status||'')}" placeholder="Advance received / Balance pending / Paid"></div>
   </div></div>
   <div class="m-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="savePay">Save</button></div>`);
  document.getElementById('savePay').onclick=()=>{
    d.payment={invoiceNo:val('py_inv'),terms:val('py_terms'),amount:+val('py_amt')||0,received:+val('py_rec')||0,dueDate:val('py_due'),status:val('py_st')};
    if(d.stage==='shipping')d.stage='payment';
    if((d.payment.received)>=(d.payment.amount) && d.payment.amount>0){ d.payment.status=d.payment.status||'Paid'; }
    persist(); toast('Payment updated'); openDealDetail(id); render();
  };
}
const val=id=>document.getElementById(id).value.trim();

/* ---------- PRODUCT form (with MSDS/COA upload) ---------- */
function openProductForm(id){
  const p = id? PRODUCTS.find(x=>x.id===id):null;
  const curOpts=Object.keys(CUR).map(k=>`<option ${((p?p.currency:'USD')===k)?'selected':''}>${k}</option>`).join('');
  openModal(`<div class="m-head"><h3>${id?'Edit Product':'Add Product'}</h3><button class="x" onclick="closeModal()">×</button></div>
   <div class="m-body">
     <div class="field full"><label class="lbl">Product name <span class="req">*</span></label><input id="p_name" value="${esc(p?p.name:'')}" placeholder="e.g. LABSA 90%"></div>
     <div class="grid3">
       <div class="field"><label class="lbl">CAS no</label><input id="p_cas" value="${esc(p?p.cas:'')}"></div>
       <div class="field"><label class="lbl">HSN code</label><input id="p_hsn" value="${esc(p?p.hsn:'')}"></div>
       <div class="field"><label class="lbl">Unit</label><input id="p_unit" value="${esc(p?p.unit:'MT')}" placeholder="MT / KG / Drum"></div>
     </div>
     <div class="grid3">
       <div class="field"><label class="lbl">Rate</label><input id="p_rate" value="${p?p.rate:''}" inputmode="decimal"></div>
       <div class="field"><label class="lbl">Currency</label><select id="p_cur">${curOpts}</select></div>
       <div class="field"><label class="lbl">Hazard?</label><select id="p_haz"><option value="true" ${p&&p.haz?'selected':''}>Hazardous</option><option value="false" ${p&&!p.haz?'selected':''}>Non-hazardous</option></select></div>
     </div>
     <div class="field full"><label class="lbl">Classification / hazard note</label><input id="p_class" value="${esc(p?p.classification:'')}" placeholder="e.g. Corrosive (Class 8)"></div>
     <div class="field full"><label class="lbl">Packing</label><input id="p_pack" value="${esc(p?p.packing:'')}" placeholder="e.g. 220 kg HDPE drums"></div>
     <div class="section-title">Documents</div>
     <div class="grid2">
       <div class="field"><label class="lbl">MSDS (PDF)</label>
         <input type="file" id="p_msds" accept="application/pdf">
         <div class="hint" id="msdsHint">${p&&p.msds?'✓ '+esc(p.msds.name)+' saved':'No file — small PDFs only (&lt;1.5 MB).'}</div></div>
       <div class="field"><label class="lbl">COA (PDF)</label>
         <input type="file" id="p_coa" accept="application/pdf">
         <div class="hint" id="coaHint">${p&&p.coa?'✓ '+esc(p.coa.name)+' saved':'No file — small PDFs only (&lt;1.5 MB).'}</div></div>
     </div>
     ${p&&(p.msds||p.coa)?`<div style="display:flex;gap:8px">${p.msds?`<button class="btn sm" id="viewMsds">View MSDS</button>`:''}${p.coa?`<button class="btn sm" id="viewCoa">View COA</button>`:''}</div>`:''}
   </div>
   <div class="m-foot">${id?'<button class="btn danger" id="delProduct" style="margin-right:auto">Delete</button>':''}<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="saveProduct">${id?'Save':'Add product'}</button></div>`,false);

  let msdsData=p?p.msds:null, coaData=p?p.coa:null;
  function readFile(input,hintId,set){ input.onchange=()=>{ const f=input.files[0]; if(!f)return;
    if(f.size>0.6*1024*1024){ document.getElementById(hintId).innerHTML='<span style="color:var(--red)">Too large ('+(f.size/1048576).toFixed(1)+' MB). Cloud limit: keep under 0.6 MB per PDF.</span>'; input.value=''; return; }
    const r=new FileReader(); r.onload=()=>{ set({name:f.name,data:r.result}); document.getElementById(hintId).innerHTML='✓ '+esc(f.name)+' ready'; }; r.readAsDataURL(f); }; }
  readFile(document.getElementById('p_msds'),'msdsHint',v=>msdsData=v);
  readFile(document.getElementById('p_coa'),'coaHint',v=>coaData=v);
  if(p&&p.msds){const b=document.getElementById('viewMsds'); if(b)b.onclick=()=>openDataFile(p.msds);}
  if(p&&p.coa){const b=document.getElementById('viewCoa'); if(b)b.onclick=()=>openDataFile(p.coa);}
  const dp=document.getElementById('delProduct'); if(dp) dp.onclick=()=>{ if(confirm('Delete product?')){ PRODUCTS=PRODUCTS.filter(x=>x.id!==id); cloudDelete('products',id); persist(); closeModal(); render(); } };
  document.getElementById('saveProduct').onclick=()=>{
    const name=val('p_name'); if(!name){ toast('Product name required'); return; }
    const payload={name,cas:val('p_cas'),hsn:val('p_hsn'),unit:val('p_unit'),rate:+val('p_rate')||0,currency:document.getElementById('p_cur').value,haz:document.getElementById('p_haz').value==='true',classification:val('p_class'),packing:val('p_pack'),msds:msdsData,coa:coaData};
    if(id) Object.assign(p,payload); else PRODUCTS.push({id:uid('p'),...payload});
    persist(); closeModal(); render(); toast('Product saved');
  };
}
function openDataFile(doc){ const w=window.open(); w.document.write('<iframe src="'+doc.data+'" style="border:0;width:100%;height:100vh"></iframe><title>'+doc.name+'</title>'); }

/* ---------- CLIENT form ---------- */
function openClientForm(id){
  const c=id?CLIENTS.find(x=>x.id===id):null;
  openModal(`<div class="m-head"><h3>${id?'Edit Client':'Add Client'}</h3><button class="x" onclick="closeModal()">×</button></div>
   <div class="m-body">
     <div class="field full"><label class="lbl">Company <span class="req">*</span></label><input id="c_co" value="${esc(c?c.company:'')}"></div>
     <div class="grid2">
       <div class="field"><label class="lbl">Contact person</label><input id="c_con" value="${esc(c?c.contact:'')}"></div>
       <div class="field"><label class="lbl">Country</label><input id="c_country" value="${esc(c?c.country:'')}"></div>
       <div class="field"><label class="lbl">Email</label><input id="c_email" value="${esc(c?c.email:'')}"></div>
       <div class="field"><label class="lbl">Phone</label><input id="c_phone" value="${esc(c?c.phone:'')}"></div>
     </div>
     <div class="field full"><label class="lbl">Address</label><textarea id="c_addr">${esc(c?c.address:'')}</textarea></div>
     <div class="field full"><label class="lbl">Notes</label><input id="c_notes" value="${esc(c?c.notes:'')}" placeholder="e.g. Needs COA every batch"></div>
   </div>
   <div class="m-foot">${id?'<button class="btn danger" id="delClient" style="margin-right:auto">Delete</button>':''}<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="saveClient">${id?'Save':'Add client'}</button></div>`);
  const dc=document.getElementById('delClient'); if(dc)dc.onclick=()=>{ if(DEALS.some(d=>d.clientId===id)){ if(!confirm('This client has inquiries. Delete anyway?'))return; } CLIENTS=CLIENTS.filter(x=>x.id!==id); cloudDelete('clients',id); persist(); closeModal(); render(); };
  document.getElementById('saveClient').onclick=()=>{
    const co=val('c_co'); if(!co){ toast('Company required'); return; }
    const payload={company:co,contact:val('c_con'),country:val('c_country'),email:val('c_email'),phone:val('c_phone'),address:val('c_addr'),notes:val('c_notes')};
    if(id)Object.assign(c,payload); else CLIENTS.push({id:uid('c'),...payload});
    persist(); closeModal(); render(); toast('Client saved');
  };
}

/* ---------- SETTINGS bindings ---------- */
function bindSettings(){
  document.getElementById('saveSettings').onclick=()=>{
    Object.assign(SETTINGS,{company:val('s_company'),brand:val('s_brand'),address:val('s_address'),gstin:val('s_gstin'),iec:val('s_iec'),email:val('s_email'),phone:val('s_phone'),website:val('s_web'),bank:val('s_bank')});
    persist(); toast('Company profile saved');
  };
  const au=document.getElementById('addUserBtn'); if(au) au.onclick=openUserForm;
  document.getElementById('saveQuoteDefaults').onclick=()=>{
    SETTINGS.quoteTerms=val('s_terms');
    SETTINGS.seniors=val('s_seniors').split(',').map(x=>x.trim()).filter(Boolean);
    SETTINGS.incoterms=val('s_incoterms').split(',').map(x=>x.trim()).filter(Boolean);
    persist(); toast('Quotation defaults saved');
  };
  document.getElementById('exportData').onclick=()=>{
    const blob=new Blob([JSON.stringify({products:PRODUCTS,clients:CLIENTS,deals:DEALS,settings:SETTINGS,users:USERS,exported:new Date().toISOString()},null,2)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='akshar-export-backup-'+today()+'.json'; a.click(); toast('Backup downloaded');
  };
  document.getElementById('importData').onclick=()=>document.getElementById('importFile').click();
  document.getElementById('importFile').onchange=e=>{ const f=e.target.files[0]; if(!f)return; const r=new FileReader();
    r.onload=()=>{ try{ const o=JSON.parse(r.result); if(!confirm('Replace ALL current data with this backup?'))return;
      PRODUCTS=o.products||[]; CLIENTS=o.clients||[]; DEALS=o.deals||[]; SETTINGS=o.settings||SETTINGS;
      persist(); toast('Backup restored to cloud'); render(); }
      catch(err){ toast('Invalid backup file'); } }; r.readAsText(f); };
  document.getElementById('resetData').onclick=()=>{ if(confirm('Server se data dobara load karo? (Kuch bhi delete nahi hoga.)')){ onSignedIn(CURRENT); toast('Data refreshed'); } };

  /* ---------- Excel export / import ---------- */
  const clientRow = c => ({Company:c.company||'', Contact:c.contact||'', Country:c.country||'', Email:c.email||'', Phone:c.phone||'', Address:c.address||'', Notes:c.notes||''});
  const productRow = p => ({Name:p.name||'', CAS:p.cas||'', HSN:p.hsn||'', Classification:p.classification||'', Unit:p.unit||'', Rate:p.rate||'', Currency:p.currency||'USD', Packing:p.packing||'', Hazard:(p.haz?'Yes':'No')});
  const dealRow = d => { const c=clientById(d.clientId)||{}; const it=(d.items&&d.items[0])||{}; const pr=productById(it.productId)||{};
    return {Inquiry:d.no||'', Date:d.date||'', Client:c.company||'', Country:c.country||'', Port:d.port||'', Product:pr.name||'', Qty:it.qty||'', Unit:it.unit||'', Rate:it.rate||'', Currency:d.currency||'', Stage:d.stage||'', QuoteNo:d.quoteNo||'', ETA:(d.shipping&&d.shipping.eta)||'', PaymentStatus:(d.payment&&d.payment.status)||''}; };

  document.getElementById('xlExportAll').onclick=()=>{
    if(typeof XLSX==='undefined'){ toast('Excel library load nahi hui — internet check karo'); return; }
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(CLIENTS.map(clientRow)), 'Clients');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(PRODUCTS.map(productRow)), 'Products');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(DEALS.map(dealRow)), 'Inquiries');
    XLSX.writeFile(wb, 'akshar-export-'+today()+'.xlsx');
    toast('Excel downloaded');
  };
  document.getElementById('xlTemplate').onclick=()=>{
    if(typeof XLSX==='undefined'){ toast('Excel library load nahi hui'); return; }
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([clientRow({})]), 'Clients');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([productRow({})]), 'Products');
    XLSX.writeFile(wb, 'akshar-import-template.xlsx');
    toast('Template downloaded');
  };
  document.getElementById('xlImport').onclick=()=>document.getElementById('xlFile').click();
  document.getElementById('xlFile').onchange=e=>{
    const f=e.target.files[0]; if(!f) return;
    if(typeof XLSX==='undefined'){ toast('Excel library load nahi hui'); return; }
    const r=new FileReader();
    r.onload=()=>{
      try{
        const wb=XLSX.read(r.result,{type:'array'});
        const get=name=> wb.SheetNames.includes(name)? XLSX.utils.sheet_to_json(wb.Sheets[name]) : [];
        const cRows=get('Clients'), pRows=get('Products');
        // if no named sheets, treat first sheet as Clients
        const firstRows = (!cRows.length && !pRows.length && wb.SheetNames.length)? XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) : [];
        const clientsIn = cRows.length? cRows : firstRows;
        let addedC=0, addedP=0;
        clientsIn.forEach(row=>{ const company=(row.Company||row.company||'').toString().trim(); if(!company) return;
          CLIENTS.push({id:uid('c'), company, contact:(row.Contact||'').toString().trim(), country:(row.Country||'').toString().trim(), email:(row.Email||'').toString().trim(), phone:(row.Phone||'').toString().trim(), address:(row.Address||'').toString().trim(), notes:(row.Notes||'').toString().trim()}); addedC++; });
        pRows.forEach(row=>{ const name=(row.Name||row.name||'').toString().trim(); if(!name) return;
          PRODUCTS.push({id:uid('p'), name, cas:(row.CAS||'').toString().trim(), hsn:(row.HSN||'').toString().trim(), classification:(row.Classification||'').toString().trim(), unit:(row.Unit||'').toString().trim(), rate:Number(row.Rate)||0, currency:(row.Currency||'USD').toString().trim(), packing:(row.Packing||'').toString().trim(), haz:/^y/i.test((row.Hazard||'').toString()), msds:null, coa:null}); addedP++; });
        if(!addedC && !addedP){ toast('Koi valid row nahi mili (Company/Name column check karo)'); return; }
        persist(); render();
        toast(addedC+' clients, '+addedP+' products added');
      }catch(err){ toast('Excel padhne mein error — file check karo'); }
    };
    r.readAsArrayBuffer(f);
    e.target.value='';
  };

  /* ---------- Clear all clients ---------- */
  document.getElementById('clearClients').onclick=()=>{
    if(!CLIENTS.length){ toast('Koi client nahi hai'); return; }
    if(!confirm('Saare '+CLIENTS.length+' clients delete karein? (Inquiries/products safe rahenge.)')) return;
    const ids=CLIENTS.map(c=>c.id);
    CLIENTS=[]; persist(); ids.forEach(id=>cloudDelete('clients',id)); render(); toast('All clients cleared');
  };
}

/* ============================================================
   QUOTATION — printable, consistent format (new window)
   ============================================================ */
function printQuotation(id){
  const d=DEALS.find(x=>x.id===id); const c=clientById(d.clientId); const s=SETTINGS;
  const rows=(d.items||[]).map((it,i)=>{const p=productById(it.productId);const amt=(Number(it.qty)||0)*(Number(it.rate)||0);
    return `<tr><td>${i+1}</td><td><b>${esc(p?p.name:'')}</b><br><span class="sm">CAS: ${esc(p?p.cas:'-')} · HSN: ${esc(p?p.hsn:'-')} · ${esc(p?p.classification:'')}</span></td>
      <td class="c">${it.qty} ${esc(it.unit||'')}</td><td class="r">${money(it.rate,d.currency)}</td><td class="r">${money(amt,d.currency)}</td></tr>`;}).join('');
  const total=dealTotal(d);
  const win=window.open('','_blank');
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.quoteNo)} — ${esc(c?c.company:'')}</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:Arial,Helvetica,sans-serif;color:#1a2433;margin:0;padding:34px 40px;font-size:13px}
    .head{display:flex;justify-content:space-between;border-bottom:3px solid #0e7c86;padding-bottom:16px}
    .co{max-width:60%}
    .co .nm{font-size:22px;font-weight:800;color:#0e7c86;letter-spacing:.3px}
    .co .lg{font-size:12px;color:#555}
    .co .ad{font-size:12px;color:#444;margin-top:6px;line-height:1.5}
    .qt{text-align:right}
    .qt .title{font-size:20px;font-weight:800;letter-spacing:2px;color:#1a2433}
    .qt table{font-size:12px;margin-top:8px}
    .qt td{padding:2px 0 2px 12px;text-align:right}
    .qt td.l{color:#666;text-align:right;padding-right:8px}
    .to{margin:22px 0 6px}
    .to .lbl{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#888}
    .to .who{font-size:15px;font-weight:700;margin-top:2px}
    table.items{width:100%;border-collapse:collapse;margin-top:14px}
    table.items th{background:#0e7c86;color:#fff;padding:9px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;text-align:left}
    table.items td{padding:9px 10px;border-bottom:1px solid #e2e7ee;vertical-align:top}
    table.items .c{text-align:center}.table .r,td.r,th.r{text-align:right}
    .sm{font-size:10.5px;color:#777}
    .tot{margin-top:10px;display:flex;justify-content:flex-end}
    .tot table{font-size:14px}
    .tot td{padding:6px 10px}
    .tot .grand{font-size:17px;font-weight:800;color:#0e7c86;border-top:2px solid #0e7c86}
    .terms{margin-top:26px;font-size:11.5px;color:#444;line-height:1.6}
    .terms h4{margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#0e7c86}
    .sign{margin-top:40px;display:flex;justify-content:space-between;align-items:flex-end}
    .sign .for{font-size:12px}
    .sign .nm{margin-top:44px;border-top:1px solid #333;padding-top:5px;font-weight:700;font-size:12px}
    .foot{margin-top:26px;border-top:1px solid #e2e7ee;padding-top:10px;font-size:10.5px;color:#888;text-align:center}
    @media print{body{padding:18px 24px}.noprint{display:none}}
    .bar{position:fixed;top:0;left:0;right:0;background:#0e7c86;color:#fff;padding:10px;text-align:center}
    .bar button{background:#fff;color:#0e7c86;border:0;padding:7px 16px;border-radius:6px;font-weight:700;cursor:pointer;margin:0 5px}
  </style></head><body>
  <div class="bar noprint">Quotation ready — <button onclick="window.print()">🖨 Print / Save as PDF</button><button onclick="window.close()">Close</button></div>
  <div style="height:44px" class="noprint"></div>
  <div class="head">
    <div class="co"><div class="nm">${esc(s.brand||s.company)}</div><div class="lg">${esc(s.company)}</div>
      <div class="ad">${esc(s.address)}<br>${s.gstin?'GSTIN: '+esc(s.gstin)+'  ':''}${s.iec?'IEC: '+esc(s.iec):''}<br>${esc(s.email)} · ${esc(s.phone)} · ${esc(s.website)}</div></div>
    <div class="qt"><div class="title">QUOTATION</div>
      <table><tr><td class="l">Quote No</td><td>${esc(d.quoteNo)}</td></tr>
      <tr><td class="l">Date</td><td>${dfmt(d.quoteDate)}</td></tr>
      <tr><td class="l">Validity</td><td>${d.validity||15} days</td></tr>
      <tr><td class="l">Incoterm</td><td>${esc(d.incoterm||'-')}</td></tr>
      <tr><td class="l">Currency</td><td>${esc(d.currency)}</td></tr></table></div>
  </div>
  <div class="to"><div class="lbl">Quotation to</div><div class="who">${esc(c?c.company:'')}</div>
    <div class="sm">${esc(c?c.contact:'')}${c&&c.contact?' · ':''}${esc(c?c.country:'')}${c&&c.email?' · '+esc(c.email):''}</div></div>
  <table class="items"><thead><tr><th style="width:34px">#</th><th>Product / Specification</th><th class="c">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
    <tbody>${rows}</tbody></table>
  <div class="tot"><table>
    <tr><td>Sub-total</td><td class="r">${money(total,d.currency)}</td></tr>
    <tr class="grand"><td>Total (${esc(d.incoterm||'')})</td><td class="r">${money(total,d.currency)}</td></tr></table></div>
  <div class="terms"><h4>Terms &amp; Conditions</h4>${esc(d.terms||s.quoteTerms).replace(/\n/g,'<br>')}
    <br><br><b>Bank details:</b> ${esc(s.bank)}</div>
  <div class="sign"><div class="for">Awaiting your valued order.<div class="sm" style="margin-top:6px">Approved by: ${esc(d.quotedBy||'-')}</div></div>
    <div><div class="nm">For ${esc(s.company)}<br><span style="font-weight:400;color:#666">Authorised Signatory</span></div></div></div>
  <div class="foot">This is a computer-generated quotation. ${esc(s.website)}</div>
  </body></html>`);
  win.document.close();
}

/* ============================================================
   AUTH + DATA SYNC — talks to our own Node.js/Express backend
   (JWT login, REST endpoints) instead of Firebase.
   ============================================================ */
let CURRENT=null, USERS=[];
const authCard=()=>document.getElementById('authCard');
const isAdmin=()=> CURRENT && CURRENT.role==='Admin';
function brandRow(sub){ return `<div class="brandrow"><div class="mark">AX</div><div><h2>Akshar Export Desk</h2></div></div><div class="sub">${sub}</div>`; }
function authErr(m){ const e=document.getElementById('aErr'); if(e){ e.textContent=m; e.style.display='block'; } }

function showLogin(){
  authCard().innerHTML = brandRow('Sign in to continue')+`
    <div class="auth-err" id="aErr"></div>
    <div class="field"><label class="lbl">Email</label><input id="li_id" type="email" autocomplete="username" placeholder="you@company.com"></div>
    <div class="field"><label class="lbl">Password</label><input id="li_pw" type="password" autocomplete="current-password"></div>
    <button class="btn primary" id="li_go">Sign in</button>
    <div class="auth-note" id="firstHint"></div>`;
  const go=async()=>{
    try{
      const r=await api('/auth/login', {method:'POST', body:JSON.stringify({email:document.getElementById('li_id').value.trim(), password:document.getElementById('li_pw').value})});
      localStorage.setItem(LS_TOKEN, r.token);
      await onSignedIn(r.user);
    }catch(e){ authErr(e.message); }
  };
  document.getElementById('li_go').onclick=go;
  document.getElementById('li_pw').addEventListener('keydown',e=>{ if(e.key==='Enter') go(); });
  checkFirstRun();
}
async function checkFirstRun(){
  const setLink=(txt)=>{ const h=document.getElementById('firstHint'); if(h){ h.innerHTML=txt+' <a href="#" id="mkAdmin">Create the admin account &rarr;</a>'; const a=document.getElementById('mkAdmin'); if(a) a.onclick=ev=>{ev.preventDefault(); showSignup();}; } };
  try{ const r=await api('/auth/users-exist'); if(!r.exists) setLink('No users yet.'); }
  catch(e){ /* backend unreachable — login form still shows, error will surface on submit */ }
}
function showSignup(){
  authCard().innerHTML = brandRow('Create admin account')+`
    <div class="auth-err" id="aErr"></div>
    <div class="field"><label class="lbl">Full name</label><input id="su_name" placeholder="e.g. Karan"></div>
    <div class="field"><label class="lbl">Email</label><input id="su_email" type="email" placeholder="you@company.com"></div>
    <div class="field"><label class="lbl">Password</label><input id="su_pw" type="password" placeholder="min 6 characters"></div>
    <button class="btn primary" id="su_go">Create &amp; sign in</button>
    <div style="text-align:center;margin-top:12px"><a href="#" id="su_back" style="font-size:12.5px">&larr; Back to sign in</a></div>`;
  document.getElementById('su_back').onclick=e=>{e.preventDefault(); showLogin();};
  document.getElementById('su_go').onclick=async()=>{
    const name=document.getElementById('su_name').value.trim(), em=document.getElementById('su_email').value.trim(), pw=document.getElementById('su_pw').value;
    if(!name) return authErr('Naam daalo.');
    if(pw.length<6) return authErr('Password min 6 characters.');
    try{
      const r=await api('/auth/signup', {method:'POST', body:JSON.stringify({name,email:em,password:pw})});
      localStorage.setItem(LS_TOKEN, r.token);
      await onSignedIn(r.user);
    }catch(e){ authErr(e.message); }
  };
}
function logout(){ localStorage.removeItem(LS_TOKEN); CURRENT=null; location.reload(); }

async function onSignedIn(user){
  CURRENT=user;
  try{
    const [dataRes, usersRes] = await Promise.all([ api('/data'), api('/users') ]);
    PRODUCTS=dataRes.products; CLIENTS=dataRes.clients; DEALS=dataRes.deals; SETTINGS=dataRes.settings;
    USERS=usersRes.users;
  }catch(e){ toast(e.message||'Data load error'); }
  document.getElementById('authGate').style.display='none';
  document.getElementById('appRoot').style.display='flex';
  renderUserFoot();
  const sb=document.querySelector('#nav button[data-view="settings"]'); if(sb) sb.style.display=isAdmin()?'flex':'none';
  if(!isAdmin() && VIEW==='settings') VIEW='dashboard';
  render();
}

/* try to resume a session using the saved token */
async function boot(){
  const token=localStorage.getItem(LS_TOKEN);
  if(token){
    try{ const r=await api('/auth/me'); await onSignedIn(r.user); return; }
    catch(e){ localStorage.removeItem(LS_TOKEN); }
  }
  showLogin();
}

/* ---- sidebar user footer ---- */
function renderUserFoot(){
  const f=document.getElementById('sideFoot');
  f.innerHTML=`Signed in as <span class="who">${esc(CURRENT.name)}</span><br><span style="color:#7f93ac">${esc(CURRENT.role)} &middot; ${esc(CURRENT.email)}</span><br>
    <button class="fbtn" id="footPw">Change password</button><button class="fbtn" id="footOut">Logout</button>`;
  document.getElementById('footOut').onclick=()=>logout();
  document.getElementById('footPw').onclick=()=>openChangePw();
}

/* ---- change own password / admin reset others ---- */
function openChangePw(targetUid){
  if(targetUid && typeof targetUid==='string' && targetUid!==CURRENT.uid){
    openModal(`<div class="m-head"><h3>Reset password</h3><button class="x" onclick="closeModal()">&times;</button></div>
     <div class="m-body">
       <p class="hint" style="margin-top:0">Naya temporary password set karo, phir user ko batado.</p>
       <div class="field full"><label class="lbl">New password</label><input id="rp_new" type="password" placeholder="min 6 characters"></div>
     </div>
     <div class="m-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="rpSave">Save</button></div>`);
    document.getElementById('rpSave').onclick=async()=>{
      const n=document.getElementById('rp_new').value;
      if(n.length<6){ toast('Min 6 characters'); return; }
      try{ await api('/users/'+targetUid+'/reset-password', {method:'POST', body:JSON.stringify({newPassword:n})}); closeModal(); toast('Password reset'); }
      catch(e){ toast(e.message); }
    };
    return;
  }
  openModal(`<div class="m-head"><h3>Change password</h3><button class="x" onclick="closeModal()">&times;</button></div>
   <div class="m-body">
     <div class="field full"><label class="lbl">Current password</label><input id="cp_old" type="password"></div>
     <div class="field full"><label class="lbl">New password</label><input id="cp_new" type="password" placeholder="min 6 characters"></div>
     <div class="field full"><label class="lbl">Confirm new password</label><input id="cp_new2" type="password"></div>
   </div>
   <div class="m-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="cpSave">Save</button></div>`);
  document.getElementById('cpSave').onclick=async()=>{
    const oldp=document.getElementById('cp_old').value, n=document.getElementById('cp_new').value, n2=document.getElementById('cp_new2').value;
    if(n.length<6){ toast('Min 6 characters'); return; }
    if(n!==n2){ toast('Passwords match nahi'); return; }
    try{ await api('/auth/change-password', {method:'POST', body:JSON.stringify({oldPassword:oldp,newPassword:n})}); closeModal(); toast('Password updated'); }
    catch(e){ toast(e.message); }
  };
}

/* ---- add / remove users (Admin) ---- */
function openUserForm(){
  openModal(`<div class="m-head"><h3>Add user</h3><button class="x" onclick="closeModal()">&times;</button></div>
   <div class="m-body"><div class="grid2">
     <div class="field"><label class="lbl">Full name <span class="req">*</span></label><input id="nu_name"></div>
     <div class="field"><label class="lbl">Email <span class="req">*</span></label><input id="nu_id" type="email" autocomplete="off"></div>
     <div class="field"><label class="lbl">Role</label><select id="nu_role"><option>Admin</option><option>Senior</option><option selected>Staff</option></select></div>
     <div class="field"><label class="lbl">Temp password <span class="req">*</span></label><input id="nu_pw" type="password" placeholder="min 6 characters"></div>
   </div>
   <p class="hint">User ko email + temp password do; wo login karke apna password badal lega.</p></div>
   <div class="m-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="nuSave">Add user</button></div>`);
  document.getElementById('nuSave').onclick=async()=>{
    const name=val('nu_name'), em=val('nu_id'), role=document.getElementById('nu_role').value, pw=document.getElementById('nu_pw').value;
    if(!name||!em){ toast('Name aur email zaroori'); return; }
    if(pw.length<6){ toast('Password min 6'); return; }
    try{
      const r=await api('/users', {method:'POST', body:JSON.stringify({name,email:em,role,password:pw})});
      USERS.push(r.user);
      closeModal(); toast('User added'); render();
    }catch(e){ toast(e.message); }
  };
}
function removeUser(u){
  if(u.uid===CURRENT.uid){ toast('Apne aap ko delete nahi kar sakte'); return; }
  if(confirm('Remove '+u.name+' from workspace?')){
    api('/users/'+u.uid, {method:'DELETE'})
      .then(()=>{ USERS=USERS.filter(x=>x.uid!==u.uid); toast('User removed'); render(); })
      .catch(e=>toast(e.message||'Error'));
  }
}

/* boot */
boot();
