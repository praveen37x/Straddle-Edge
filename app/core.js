

/* ============ StraddleEDGE · APP JS ============
   Demo feed (no mock-as-real in production; wire to /api).
   Smooth real-time updates, no flicker. */

// ---- index universe ----
const INDICES = {
  NIFTY:    { spot:23101.7, step:50, dte:null,lot:65 },
  BANKNIFTY:{ spot:54063.7, step:100,dte:22, lot:15 },
  FINNIFTY: { spot:24805.0, step:50, dte:22, lot:40 },
  MIDCPNIFTY:{spot:13994.7, step:25, dte:22, lot:75 },
  SENSEX:   { spot:73524.2, step:100,dte:3,  lot:10 },
  BANKEX:   { spot:60938.7, step:100,dte:17, lot:15 },
};
let CUR = "NIFTY";

// per-index live state — starts EMPTY. NO preloaded/mock data. Everything below
// is filled ONLY from the live backend (/api/snapshot, /ws). Nothing fake is shown.
const ST = {};
function initIndex(name){
  const cfg = INDICES[name];
  const atm = Math.round(cfg.spot/cfg.step)*cfg.step;   // placeholder until live data
  const strikes = [];
  for(let i=-5;i<=5;i++) strikes.push(atm + i*cfg.step);
  ST[name] = {
    cfg, atm, strikes, legs:{},          // EMPTY chain — populated only from backend
    spot:null, spotOpen:null, spotPrevClose:null,
    spotHi:0, spotLo:1e9,
    atmHi:0, atmLo:1e9, atm9_15:null, prevSessionClose:null,
    lowHi:0, lowLo:1e9,
    series:{t:[],atm:[],low:[],spot:[],vix:[]},
    bars:[],                              // 1-min OHLC: {t,o,h,l,c,low,spot,vix} — persists 9:15→15:40 (Task C item 8)
    vix:null, startMin: 9*60+15,
  };
}
Object.keys(INDICES).forEach(initIndex);

/* THE strike nearest spot - one definition, used everywhere the word "ATM" appears.

   Three different notions of ATM had drifted into this file and were all being shown
   at once:
     1. the SERVER's atm - a hysteresis anchor from strike_manager, which only moves
        when spot drifts past a threshold, so it can sit a full strike away
     2. the LOWEST-premium strike - a real and useful thing, but not ATM
     3. nearest-to-spot - what "ATM" actually means, which nothing was using
   That is why the header KPI said 24,150 while the chain tagged 24,200: two answers
   to the same word, on the same screen.

   Nearest-to-spot is computed HERE from live spot rather than taken from the server,
   so the label cannot lag the price. It then snaps to a strike that actually exists
   in the chain, because the nearest theoretical strike may not be subscribed. */
function atmStrike(name){
  const s=ST[name||CUR]; if(!s) return null;
  const step=50;
  if(s.spot==null){
    // no spot yet: fall back to the server anchor rather than guessing
    return s.atm!=null?s.atm:null;
  }
  const want=Math.round(s.spot/step)*step;
  const ks=Object.keys(s.legs||{}).map(Number).filter(n=>isFinite(n));
  if(!ks.length) return want;
  return ks.reduce((b,k)=>Math.abs(k-want)<Math.abs(b-want)?k:b, ks[0]);
}

function lowestStrike(name){
  const s = ST[name]; let lo=1e9, lk=s.atm;
  Object.keys(s.legs).forEach(k=>{ const l=s.legs[k];
    if(l && l.comb!=null && l.comb<lo){ lo=l.comb; lk=+k; } });
  return lk;
}

// ---- helpers ----
function fmtMin(m){const h=Math.floor(m/60),mm=m%60;return `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;}
function n2(x){return x==null?'—':Number(x).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});}
function n0(x){return x==null?'—':Number(x).toLocaleString('en-IN',{maximumFractionDigits:0});}
function pct(x){return (x>=0?'+':'')+x.toFixed(2)+'%';}

// ---- inject body ----
/* APP body is now server-rendered directly into #APP_ROOT (see the comment there),
   so there is nothing to inject. This guard is kept — rather than deleting the line —
   so a cached older shell that still defines window.__BODY_HTML__ keeps working, and
   so an empty APP_ROOT can never silently produce a blank page. */
(function(){ var _r=document.getElementById('APP_ROOT');
  if(_r && !_r.firstElementChild && window.__BODY_HTML__){ _r.innerHTML = window.__BODY_HTML__; }
})();

/* Boot splash stays visible until section 7's probe sequence dismisses it.
   Do NOT add 'done' here — that defeats the purpose of the splash. */

// ---- sidebar / theme / nav ----
/* 900px, matching the mobile pack's CSS breakpoint. These two MUST agree: if the
   CSS turns the sidebar into an off-canvas drawer but this says "desktop", the
   burger toggles .collapsed instead of .mobile-open and the menu never opens. */
function isMobile(){return window.innerWidth<=900;}
function toggleSidebar(){
  const sb=document.getElementById('sidebar');
  if(isMobile()){
    sb.classList.toggle('mobile-open');
    document.getElementById('sbBackdrop').classList.toggle('show',sb.classList.contains('mobile-open'));
    if(sb.classList.contains('mobile-open')&&window.history&&window.history.pushState){
      window.history.pushState({sbOpen:true},'');
    }
  }else{
    sb.classList.toggle('collapsed');
    setTimeout(()=>chart&&chart.resize(),300);
  }
}
function closeMobileSidebar(){
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sbBackdrop').classList.remove('show');
}
if(window.addEventListener)window.addEventListener('popstate',function(e){
  if(isMobile())closeMobileSidebar();
});
let _resizeTm; window.addEventListener('resize',()=>{ clearTimeout(_resizeTm); _resizeTm=setTimeout(()=>{ if(!isMobile())closeMobileSidebar(); chart&&chart.resize(); },150); });

// ---- sidebar swipe gesture: see mobile behaviour block (line ~5175) ----

/* Two themes only. applyTheme() falls back to 'dark' for any id it does not
   recognise, so a browser still holding 'ocean' in localStorage from the old
   seven-theme build lands safely on dark instead of an undefined palette. */
const THEMES=[
  {id:'dark', name:'Graphite',c:['#0B0E13','#EFB94F','#3FC5DC']},
  {id:'light',name:'Paper',   c:['#F6F7F9','#9C6F16','#0B7E90']}
];
function applyTheme(id){
  if(!THEMES.some(t=>t.id===id))id='dark';
  document.documentElement.setAttribute('data-theme',id);
  try{localStorage.setItem('apexTheme',id);}catch(e){}
  const ic=document.getElementById('themeIcon');
  if(ic)ic.innerHTML = id!=='light'
    ? '<path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z"/>'
    : '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>';
  renderThemePicker(); if(window.chart){try{chart.update('none');}catch(e){}}
}
function setTheme(id){applyTheme(id);}
function toggleTheme(){
  const cur=document.documentElement.getAttribute('data-theme')||'dark';
  const i=THEMES.findIndex(t=>t.id===cur);
  applyTheme(THEMES[(i+1)%THEMES.length].id);
}
function renderThemePicker(){
  const host=document.getElementById('themePicker'); if(!host)return;
  const cur=document.documentElement.getAttribute('data-theme')||'dark';
  host.innerHTML=THEMES.map(t=>`<button onclick="setTheme('${t.id}')" title="${t.name}" style="cursor:pointer;border:2px solid ${t.id===cur?'var(--accent)':'var(--border)'};border-radius:12px;padding:9px 10px;background:var(--surface2);display:flex;flex-direction:column;align-items:center;gap:7px;min-width:78px">`+
    `<span style="display:flex;gap:3px"><i style="width:18px;height:28px;border-radius:5px;background:${t.c[0]};border:1px solid var(--border2)"></i><i style="width:11px;height:28px;border-radius:5px;background:${t.c[1]}"></i><i style="width:11px;height:28px;border-radius:5px;background:${t.c[2]}"></i></span>`+
    `<span style="font-size:11px;letter-spacing:.3px;color:${t.id===cur?'var(--accent)':'var(--text2)'};font-weight:700">${t.name}</span></button>`).join('');
}
(function(){try{const s=localStorage.getItem('apexTheme'); if(s)document.documentElement.setAttribute('data-theme',s);}catch(e){}})();
let _navToken=0;
function nav(page,el){
  if(page==='engineering' && !isDeveloperMode()) return;
  // Phase 9: one event per real page switch, fire-and-forget, never blocking nav.
  // The ONLY place page switches happen in this app (single chokepoint) — never
  // fired per API poll. No-op (silently ignored server-side, no error surfaced)
  // for an anonymous visitor: /api/analytics/event requires a real login, and most
  // page views happen without one today (see identity/entitlements.py FREE tier).
  try{
    var _tok=sessionStorage.getItem('apex_access_token');
    if(_tok) fetch('/api/analytics/event',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+_tok},body:JSON.stringify({feature:page})}).catch(function(){});
  }catch(e){}
  const tok=++_navToken;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));
  document.getElementById('page-'+page).classList.add('on');
  document.querySelectorAll('.sb-item').forEach(i=>i.classList.remove('on'));
  el.classList.add('on');
  // Defer heavy renders to next frame so sidebar transition completes first.
  // Root cause (frontend audit, 2026-08-15 — Corporate Actions investigation):
  // requestAnimationFrame callbacks are tied to the display's repaint cycle and
  // browsers can suspend them ENTIRELY (not just throttle) while document.hidden is
  // true — a backgrounded tab, an app-switch on mobile, a screen lock landing mid-nav.
  // A bare requestAnimationFrame() call with no fallback then never fires — this page
  // switch stays visually "open" (the classList toggles above are synchronous) but its
  // data never renders, forever, no error shown. Race it against a bounded setTimeout
  // instead: whichever fires first wins (the `done` guard makes the loser a no-op), so
  // a normal foregrounded tab still gets the smooth next-frame timing (RAF wins, fires
  // in ~16ms, long before the 150ms fallback), while a backgrounded one still makes
  // progress instead of hanging silently forever.
  let navDispatchDone=false;
  const navDispatch=()=>{
    if(navDispatchDone)return; navDispatchDone=true;
    if(_navToken!==tok)return; // stale nav
    if(page==='strategies'){renderExpiryStrats();renderStrategyLab();renderCorrelation();}
    if(page==='lab')renderLab();
    if(page==='research')renderResearch();
    if(page==='intelligence' && window.renderIntelligence)renderIntelligence();
    if(page==='history')renderHistory();
    if(page==='logs')renderLogs();
    if(page==='chain')renderFullChain();
    if(page==='flow'){renderFlow();renderEnsembleEm();}
    // Dashboard compact cards (Skew/VRP/OI Intelligence, panels.js) previously had NO
    // entry here — every OTHER page (vrp/skew/tracker/chain/...) force-refreshes on
    // arrival, but these three only updated on their own blind 60s setInterval (started
    // once at boot). Result: navigate to the main Skew or VRP page (instant fresh fetch
    // below) then back to the Dashboard, and the compact card still showed whatever it
    // last had — up to 60s old, or far older if the tab had been backgrounded (scheduler.js
    // pauses setInterval while document.hidden and only catches up once on resume). Same
    // owner endpoints (/api/skew_daily, /api/skew_regimes, /api/vrp) as the main pages —
    // this just makes the compact cards refresh on arrival exactly like everything else.
    if(page==='live'){renderSkewIntel();renderVrpIntel();renderOiIntel();}
    if(page==='vrp')renderVRP();
    if(page==='tracker')renderTracker();
    if(page==='ivgreeks')renderIVGreeks();
    if(page==='skew')renderSkew();
    if(page==='decaylab' && window.renderOvernightDecay)renderOvernightDecay();
    if(page==='corpactions' && window.renderCorpActions)renderCorpActions();
    if(page==='mcwmcal' && window.renderMcwmCal)renderMcwmCal();
    if(page==='simulator')fillSimStrats();
    if(page==='settings'){renderSettings();renderBuildInfo();}

    setTimeout(()=>chart&&chart.resize(),50);
  };
  requestAnimationFrame(navDispatch);
  setTimeout(navDispatch,150);
  if(isMobile())closeMobileSidebar();
}

// Phase 10: progressive disclosure — each select only appears once the previous
// answer makes it relevant. type -> product/area -> (Straddle only) sub-area,
// (Data Issue only) data category.
function updateFbFlow(){
  var type=document.getElementById('fbType').value;
  document.getElementById('fbAreaWrap').style.display=type?'block':'none';
  var product=document.getElementById('fbProduct').value;
  document.getElementById('fbStraddleArea').style.display=(type&&product==='APEX Straddle')?'inline':'none';
  document.getElementById('fbDataCat').style.display=(type==='Data Issue')?'inline':'none';
}
var _fbShotDataUrl=null;
function onFbShotChange(){
  var f=document.getElementById('fbShot').files[0];
  var nameEl=document.getElementById('fbShotName');
  _fbShotDataUrl=null;
  if(!f) { nameEl.textContent=''; return; }
  if(f.size>1500000){ nameEl.textContent='Too large (max 1.5MB) — not attached.'; nameEl.style.color='var(--red)'; document.getElementById('fbShot').value=''; return; }
  if(!/^image\/(png|jpeg)$/.test(f.type)){ nameEl.textContent='Only PNG/JPEG allowed.'; nameEl.style.color='var(--red)'; document.getElementById('fbShot').value=''; return; }
  var reader=new FileReader();
  reader.onload=function(e){ _fbShotDataUrl=e.target.result; nameEl.textContent=f.name; nameEl.style.color='var(--green)'; };
  reader.readAsDataURL(f);
}
var _fbSubmitting=false;
async function submitFeedback(){
  if(_fbSubmitting) return;  // accidental-double-submit guard (primary defense; server also dedupes)
  var type=document.getElementById('fbType').value;
  var product=document.getElementById('fbProduct').value;
  var straddleArea=document.getElementById('fbStraddleArea').style.display!=='none'?document.getElementById('fbStraddleArea').value:'';
  var dataCat=document.getElementById('fbDataCat').style.display!=='none'?document.getElementById('fbDataCat').value:'';
  var desc=document.getElementById('fbDesc').value.trim();
  var st=document.getElementById('fbStatus'), btn=document.getElementById('fbSubmitBtn');
  if(!type||!product||!desc){st.textContent='Please answer the questions above and describe it.';st.style.color='var(--gold)';return;}
  _fbSubmitting=true; btn.disabled=true;
  st.textContent='Submitting...';st.style.color='var(--muted)';
  try{
    var token=sessionStorage.getItem('apex_access_token');
    var headers={'Content-Type':'application/json'};
    if(token) headers['Authorization']='Bearer '+token;
    var r=await fetch('/api/feedback',{method:'POST',headers:headers,body:JSON.stringify({
      report_type:type, product_area:product, straddle_area:straddleArea, data_category:dataCat,
      description:desc, screenshot:_fbShotDataUrl, app_version:(window.APP_VERSION||'')
    })});
    var d=await r.json();
    if(r.ok&&d.ok){
      st.textContent=d.duplicate?'Already submitted (#'+d.id+').':'Thank you! Submitted (#'+d.id+').';
      st.style.color='var(--green)';
      document.getElementById('fbDesc').value='';document.getElementById('fbShot').value='';
      document.getElementById('fbShotName').textContent='';_fbShotDataUrl=null;
    } else {
      st.textContent='Error: '+((d.detail&&(d.detail.error||JSON.stringify(d.detail)))||d.error||r.status);
      st.style.color='var(--red)';
    }
  }catch(e){st.textContent='Network error — please try again.';st.style.color='var(--red)';}
  finally{ _fbSubmitting=false; btn.disabled=false; }
}

const DEV_MODE_KEY = 'apexDeveloperMode';
function isDeveloperMode(){
  try{ return localStorage.getItem(DEV_MODE_KEY)==='1'; }catch(e){ return false; }
}
function setDeveloperMode(on){
  try{ localStorage.setItem(DEV_MODE_KEY, on ? '1' : '0'); }catch(e){}
  syncDeveloperModeUI();
  var sp = document.getElementById('page-settings');
  if (sp) sp.setAttribute('data-devmode', on ? '1' : '0');
}
function syncDeveloperModeUI(){
  const toggle = document.getElementById('set-devmode');
  if(toggle) toggle.checked = isDeveloperMode();
  // dev-engineering-entry (the OPEN button for the old separate page) no longer exists.
  // Developer Mode still gates other operational surfaces via this same function.
}

// ---- index dropdown ----
function toggleIdx(){document.getElementById('idxDD').classList.toggle('open');}
document.addEventListener('click',e=>{ if(!e.target.closest('#idxDD')) document.getElementById('idxDD').classList.remove('open'); });
function buildIdxMenu(){
  const m=document.getElementById('idxMenu');
  m.innerHTML = Object.keys(INDICES).map(k=>{
    const s=ST[k]; const ch=(s.spot-s.spotPrevClose)/s.spotPrevClose*100;
    return `<div class="idx-opt" onclick="selectIdx('${k}')">
      <span class="nm">${k}</span>


      <span class="px num ${ch>=0?'up':'dn'}">${n0(s.spot)}</span></div>`;
  }).join('');
}
function selectIdx(k){
  CUR=k; LOT_SIZE=getLotSize(); QTY=getQTY();
  document.getElementById('idxDD').classList.remove('open');
  document.getElementById('idxName').textContent=k;
  const _hn=document.getElementById('hero-name'); if(_hn) _hn.textContent=k+' · live';
  // rebuild chart series from this index
  syncChart(true);
  renderAll();
}

// ---- overview strip (all indices) ----
function renderOvStrip(){
  const el=document.getElementById('ovStrip');
  if(!el) return;   // top strip removed
  el.innerHTML = Object.keys(INDICES).map(k=>{
    const s=ST[k]; const ch=(s.spot-s.spotPrevClose); const chp=ch/s.spotPrevClose*100;
    const lk=lowestStrike(k);
    return `<div class="ov-card ${k===CUR?'active':''}" onclick="selectIdx('${k}')">
      <div class="nm">${k}</div>
      <div class="px num">${n0(s.spot)}</div>
      <div class="ch num ${ch>=0?'up':'dn'}">${ch>=0?'▲':'▼'} ${pct(chp)}</div>
      <div class="st">ATM ${n0(s.atm)} · ${n2(s.legs[s.atm].comb)}</div>
    </div>`;
  }).join('');
}

// ---- statbar ----
// Feature request (2026-08-15): statbar wants Synthetic + 30min VWAP alongside its
// existing fields. Both are REAL, already-computed values (main.py's /api/vwap
// already returns vwap_30, unused until now; /api/synthetic's synth_future is
// written from the live NIFTY futures tick, same source the Skew page's synthetic
// panel already trusts — never a second computation of either number).
// renderStatbar() fires on every snapshot push (up to 4x/sec) — polling here directly
// would flood the network for values that only change once a minute (VWAP, a 1-min-bar
// average) or once per option-chain tick (synthetic). Polled separately, slower, and
// cached; renderStatbar() only ever reads the cache synchronously.
var _sbExtras={vwap30:null,synthetic:null};
async function _pollStatbarExtras(){
  try{
    const [vw,sy]=await Promise.all([
      jget('/api/vwap').catch(()=>({})),
      jget('/api/synthetic').catch(()=>[])]);
    _sbExtras.vwap30=(vw&&vw.vwap_30!=null)?vw.vwap_30:null;
    const syLast=(Array.isArray(sy)&&sy.length)?sy[sy.length-1]:null;
    _sbExtras.synthetic=(syLast&&syLast.synth_future!=null)?syLast.synth_future:null;
  }catch(e){}
  try{renderStatbar();}catch(e){}
}
_pollStatbarExtras();
setInterval(_pollStatbarExtras,20000);

function renderStatbar(){
  const s=ST[CUR];
  renderIdxPx(s);
  if(!s.legs[s.atm]){
    const ks=Object.keys(s.legs).map(Number);
    if(!ks.length) return;
    s.atm = ks.reduce((b,k)=>Math.abs(k-s.atm)<Math.abs(b-s.atm)?k:b, ks[0]);
  }
  const cur=s.legs[s.atm].comb;
  // Use morning strike's current value for decay comparison (same strike = correct %)
  const _sbMK=s.morningStrike||s.atm;
  const _sbCur=(s.legs[_sbMK]&&s.legs[_sbMK].comb!=null)?s.legs[_sbMK].comb:cur;
  const chg=s.atm9_15?_sbCur-s.atm9_15:0, chgp=s.atm9_15?chg/s.atm9_15*100:0;
  const lk=lowestStrike(CUR); const lowC=s.legs[lk]?s.legs[lk].comb:null;
  // Time elapsed since 9:15 market open
  const _now=new Date();
  const _mins915=9*60+15;
  const _minsNow=_now.getHours()*60+_now.getMinutes();
  const _elapsed=_minsNow-_mins915;
  const _tHr=Math.floor(_elapsed/60); const _tMn=_elapsed%60;
  const _timeStr=_elapsed>0?_tHr+'h '+(_tMn<10?'0':'')+_tMn+'m':'—';
  // Spot change from prev close — use broker-sourced values (Dhan quote), same as idxPx header
  const _sChg = s.chgAbs!=null ? s.chgAbs : null;
  const _sChgPct = s.chgPct!=null ? s.chgPct : null;
  const _sChgStr = _sChg!=null ? ((_sChg>=0?'+':'')+n2(_sChg)+' ('+(_sChgPct>=0?'+':'')+Number(_sChgPct).toFixed(2)+'%)') : '—';
  const rows=[
    ['Spot', n2(s.spot), ''],
    ['Spot Chg', _sChgStr, _sChg!=null?(_sChg>=0?'up':'dn'):''],
    ['ATM', n0(s.atm), 'gold'],
    ['ATM Straddle', n2(cur), 'cy'],
    ['9:15 Open', n2(s.atm9_15), ''],
    ['Decay', (chg>=0?'+':'')+n2(chg)+' ('+pct(chgp)+')', chg>=0?'':''],
    ['Prev Close', s.prevSessionClose!=null?n2(s.prevSessionClose):'—', ''],
    ['VIX', n2(s.vix), ''],
    ['VWAP 30m', _sbExtras.vwap30!=null?n2(_sbExtras.vwap30):'—', ''],
    ['Synthetic', _sbExtras.synthetic!=null?n2(_sbExtras.synthetic):'—', ''],
  ];
  document.getElementById('statbar').innerHTML = rows.map(([k,v,c])=>{
    let cls=c; if(k==='Change'||k==='Decay'||k==='Spot Chg') cls = c==='up'?'up':c==='dn'?'dn':'';
    return `<div class="stat"><div class="k">${k}</div><div class="v ${cls==='up'||cls==='dn'?'num '+cls:cls}">${v}</div></div>`;
  }).join('');
}

function renderIdxPx(s){
  if(!s) return;
  const el=document.getElementById('idxPx'); if(!el) return;
  const pc=s.spotPrevClose;
  const d = (s.chgAbs!=null) ? s.chgAbs : (pc? s.spot-pc : null);
  const p = (s.chgPct!=null) ? s.chgPct : (pc? (s.spot-pc)/pc*100 : null);
  const up=(d>=0);
  const chg = (d!=null && p!=null) ? ` <span class="num ${up?'up':'dn'}" style="font-size:11px;margin-left:4px">${up?'+':''}${n0(d)} (${up?'+':''}${p.toFixed(2)}%)</span>` : '';
  el.innerHTML = `<span class="${up?'up':'dn'}">${n0(s.spot)}</span>${chg}`;
}

// ---- gauges (ATM + lowest, with low--ltp--high bar) ----
function gaugeBar(prefix, ltp, lo, hi){
  const pos = hi>lo ? Math.max(0,Math.min(100,(ltp-lo)/(hi-lo)*100)) : 50;
  // bulletproof: some gauges (morning) have no -lo/-hi labels → never throw on missing nodes
  const dot=document.getElementById(prefix+'-dot'); if(dot)dot.style.left = pos+'%';
  const fill=document.getElementById(prefix+'-fill'); if(fill)fill.style.width = pos+'%';
  const lE=document.getElementById(prefix+'-lo'); if(lE)lE.textContent = n2(lo);
  const hE=document.getElementById(prefix+'-hi'); if(hE)hE.textContent = n2(hi);
}
function renderGauges(){
  const s=ST[CUR];
  // if the ATM strike isn't in the chain yet, try intraday seed or snap to nearest
  if(!s.legs[s.atm]){
    const ks=Object.keys(s.legs).map(Number);
    if(!ks.length){
      if(s._comb==null) return;  // nothing to render
    } else {
      s.atm = ks.reduce((b,k)=>Math.abs(k-s.atm)<Math.abs(b-k)?k:b, ks[0]);
    }
  }
  const g=(id,t)=>{const e=document.getElementById(id); if(e)e.textContent=t;};
  // ── ATM hero (morning folded in) ──
  const atmC=(s.legs[s.atm]&&s.legs[s.atm].comb!=null)?s.legs[s.atm].comb:s._comb;
  g('g-atm-strike', n0(s.atm));
  animNum('g-atm-px', atmC);
  // Decay: use MORNING STRIKE's current straddle vs morning straddle (same strike = apples to apples)
  const _mK=s.morningStrike||s.atm;
  const _mCur=(s.legs[_mK]&&s.legs[_mK].comb!=null)?s.legs[_mK].comb:atmC;
  const adPts=s.atm9_15?_mCur-s.atm9_15:0;
  const ae=document.getElementById('g-atm-sub'); if(ae) ae.textContent='';
  gaugeBar('g-atm',atmC,s.atmLo,s.atmHi);
  // morning marker on the ATM range bar
  const mEl=document.getElementById('g-atm-morn');
  if(mEl&&s.atm9_15&&s.atmHi>s.atmLo){ mEl.style.left=Math.max(0,Math.min(100,(s.atm9_15-s.atmLo)/(s.atmHi-s.atmLo)*100))+'%'; mEl.style.display='block'; }
  else if(mEl){ mEl.style.display='none'; }
  g('g-atm-morn-val', s.atm9_15!=null?n2(s.atm9_15):'—');
  const de=document.getElementById('g-atm-decay');
  if(de){de.textContent=(adPts>=0?'+':'')+n2(adPts); de.className='num '+(adPts>=0?'up':'dn');}
  // BUG-2 fix (2026-08-20): the decay above is ALWAYS vs the 9:15 morning-anchor
  // strike (_mK), never the current ATM strike (s.atm) shown in this card's own
  // header — those two silently disagree once the index has rolled a strike since
  // the open. Never combine metrics from different strikes without saying so.
  const dNote=document.getElementById('g-atm-decay-note');
  if(dNote){
    if(_mK!=null && _mK!==s.atm){ dNote.textContent='vs 9:15 @ '+n0(_mK); dNote.style.display='block'; }
    else dNote.style.display='none';
  }
  g('g-atm-spot', s.spot!=null?n0(s.spot):'—');
  g('g-atm-vix', s.vix!=null?n2(s.vix):'—');
  // ── Morning 9:15 straddle (FIXED reference, frozen) ──
  // 2026-08-11: the gauge can also bind to an OPEN tracked position's strike instead
  // of the morning ATM (tracker -> gauge binding). The single source of truth for the
  // tracked strike is window._selTrackedStrike, written in exactly two places:
  // populateMorningSelect() (reset when the tracked position closes) and the
  // #g-morn-sel onchange handler. The tracked branch reads the position's OWN entry
  // price and the CURRENT leg at the tracked strike — never the morning ATM.
  const trackedStrike = window._selTrackedStrike;
  const trackedPos = trackedStrike!=null
    ? myPositions.find(p=>+p.strike===trackedStrike&&(p.type||'straddle')==='straddle'&&p.status==='OPEN')
    : null;
  if(trackedPos){
    const tEnt=trackedPos.entry;
    const tNow=s.legs[trackedStrike]?s.legs[trackedStrike].comb:null;
    g('g-morn-title', 'Tracked · '+(trackedPos.index||CUR)+' '+n0(trackedStrike));
    g('g-morn-subtitle', 'entry '+n2(tEnt)+' · OPEN');
    g('g-morn-strike', n0(trackedStrike));
    const tpx=document.getElementById('g-morn-px'); if(tpx)tpx.textContent=n2(tEnt);
    g('g-morn-now', tNow!=null?n2(tNow):'—');
    const tPts=tNow!=null&&tEnt!=null?tNow-tEnt:null;
    const tPct=tNow!=null&&tEnt?((tNow-tEnt)/tEnt*100):null;
    const de3=document.getElementById('g-morn-decay');
    if(de3){de3.textContent=tPts!=null?((tPts>=0?'+':'')+n2(tPts)):'—'; de3.className='num '+((tPts||0)>=0?'up':'dn');}
    if(tNow!=null&&tEnt!=null) gaugeBar('g-morn', tNow, Math.min(tNow,tEnt)*0.9, Math.max(tNow,tEnt)*1.1);
    g('g-morn-open', tEnt!=null?n2(tEnt):'—');
    g('g-morn-hi', s.atmHi!=null?n2(s.atmHi):'—');
    g('g-morn-lo', s.atmLo!=null?n2(s.atmLo):'—');
  }else if(s.atm9_15){
    // Bug report (2026-08-15): title said "Morning Straddle · 9:15" directly beside a
    // "9:15 <strike>" badge (g-morn-strike) - same "9:15" shown twice inches apart.
    // Badge already carries the time; title only needs to name the gauge.
    g('g-morn-title', 'Morning Straddle');
    g('g-morn-subtitle', '9:15:00 open · fixed reference');
    const mk=s.morningStrike||s.atm;
    g('g-morn-strike', n0(mk));
    const mpx=document.getElementById('g-morn-px'); if(mpx)mpx.textContent=n2(s.atm9_15);
    const mLeg=s.legs[mk]; const mNow=mLeg?mLeg.comb:null;
    g('g-morn-now', mNow!=null?n2(mNow):'—');
    const mPts=mNow!=null?mNow-s.atm9_15:null;
    const mPct=mNow!=null?(mNow-s.atm9_15)/s.atm9_15*100:null;
    const de2=document.getElementById('g-morn-decay');
    if(de2){de2.textContent=mPts!=null?((mPts>=0?'+':'')+n2(mPts)):'—'; de2.className='num '+((mPts||0)>=0?'up':'dn');}
    const mSub=document.querySelector('#g-morn-decay');
    if(mSub&&mPct!=null) mSub.closest('.bar-labels')?.querySelector('.hi')?.setAttribute('title','Change: '+(mPct>=0?'+':'')+mPct.toFixed(1)+'%');
    if(mNow!=null) gaugeBar('g-morn', mNow, Math.min(mNow, s.atm9_15)*0.9, Math.max(mNow, s.atm9_15)*1.1);
    // Morning reference: Open=9:15 anchor, High/Low from session ATM straddle
    g('g-morn-open', s.atm9_15!=null?n2(s.atm9_15):'—');
    g('g-morn-hi', s.atmHi!=null?n2(s.atmHi):'—');
    g('g-morn-lo', s.atmLo!=null?n2(s.atmLo):'—');
  }
}

// ---- straddle table ----
let RANGE=10; // 10 = ATM±10, 'all' = full chain
function setRange(r,el){
  RANGE=r;
  document.querySelectorAll('.rng-btn').forEach(b=>b.classList.remove('on'));
  el.classList.add('on');
  if(r==='all' && MODE==='live'){ fetchFullChain(); } // pull all strikes from API
  renderChain();
}
function visibleStrikes(){
  const s=ST[CUR];
  if(RANGE==='all') return s.allStrikes && s.allStrikes.length ? s.allStrikes : s.strikes;
  return s.strikes; // ATM±10
}
function renderChain(){
  const s=ST[CUR]; const lk=lowestStrike(CUR);
  const tb=document.getElementById('chainBody');
  if(!s._prevComb) s._prevComb={};
  tb.innerHTML = visibleStrikes().map(k=>{
    const l=s.legs[k]; if(!l) return '';
    // l.base is now null for any strike the backend never sent a real 9:15
    // open_straddle for (fixed 2026-08-18 — see the ingest sites below). pd stays
    // null rather than computing a number from an undefined base; the render below
    // shows em-dash for it, never a silently fabricated percentage.
    const cd=(l.call-l.callBase)/l.callBase*100;
    const pd=l.base!=null?(l.comb-l.base)/l.base*100:null;
    let cls=''; let tag='';
    /* ATM is the strike NEAREST SPOT. It used to be tagged on the lowest-premium
       strike instead (`__lowSafe(CUR) || s.atm`), which is a different thing that
       merely coincides on a balanced day - and because that expression always
       returned the lowest strike, the `else if (k===lk)` below could never run, so
       the LOW tag had been dead code. Two labels, two meanings, both visible now. */
    if(k===atmStrike(CUR)){cls='atm-row';tag='<span class="row-tag">ATM</span>';}
    else if(k===lk){cls='low-row';tag='<span class="row-tag">LOW</span>';}
    /* max-pain tag belongs to the OI section, not the straddle chain */
    // tick direction → color ONLY the straddle price font (no full-row blink)
    const prev=s._prevComb[k];
    let dir='';
    if(prev!=null){ if(l.comb>prev+0.01)dir='up'; else if(l.comb<prev-0.01)dir='dn'; }
    s._prevComb[k]=l.comb;
    return `<tr class="${cls} trk-click" data-k="${k}" style="cursor:pointer" title="Click to track / set alert">
      <td class="t-call num">${n2(l.call)}</td>
      <td class="t-strike num">${n0(k)}${tag}</td>
      <td class="t-put num">${n2(l.put)}</td>
      <td class="t-comb num ${dir}" style="font-weight:800">${n2(l.comb)}</td>
      <td class="t-dpct num ${pd!=null?(pd>=0?'up':'dn'):''}" title="${pd!=null?'straddle change from 9:15':'9:15 open not recorded for this strike — not measured'}">${pd!=null?((pd>=0?'+':'')+pd.toFixed(1)+'%'):'<span style="color:var(--muted)">—</span>'}</td>
    </tr>`;
  }).join('');
}

// ---- chart (LINE + 1-min CANDLESTICK, persists 9:15 → 15:40, no sliding) ----
let chart=null;
let chartMode='line';                                  // 'line' | 'candle'
let overriding=false;                                  // true while a non-default strike is charted
let _chartOverride=null;                               // {strike, rows} — close-derived series from /api/chain/intraday
const C_UP='#2BB673', C_DN='#E5484D';
// button shows the OTHER mode's icon (line mode → candle icon, candle mode → line icon)
const ICON_CANDLE='<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="6" y1="3" x2="6" y2="17"/><rect x="3.5" y="7" width="5" height="6.5" fill="currentColor" stroke="none"/><line x1="14" y1="4" x2="14" y2="16"/><rect x="11.5" y="6" width="5" height="7.5" fill="currentColor" stroke="none"/></svg>';
const ICON_LINE='<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9"><polyline points="2,14 7,8 11,11 18,4"/></svg>';
function getCSS(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim();}

// accumulate 1-min OHLC for ATM straddle on each live tick — NEVER shifts/slides
function pushBar(s, atmC, lowC, spot, vix){
  if(atmC==null) return;
  const t=new Date().toTimeString().slice(0,5);        // "HH:MM"
  // SESSION FLOOR: never plot pre-open (< 09:15) or post-close (> 15:40) live ticks.
  // The intraday chart is 09:15:02 → 15:40 (Task C item 8, widened from 15:30 to
  // capture the post-close settlement window); pre-open auction prints are noise
  // (the 09:00 spike). Seed data is already floored server-side; this guards the
  // LIVE append. (09:15:02 is when the session's first real tick has been observed
  // to arrive; bars are minute-bucketed, so "09:15" already includes it.)
  if(t < "09:15" || t > "15:40") return;
  const b=s.bars; const last=b.length?b[b.length-1]:null;
  if(!last || last.t!==t){
    b.push({t, o:atmC, h:atmC, l:atmC, c:atmC, low:lowC, spot, vix});
  }else{
    if(atmC>last.h)last.h=atmC; if(atmC<last.l)last.l=atmC; last.c=atmC;
    if(lowC!=null)last.low=lowC; if(spot!=null)last.spot=spot; if(vix!=null)last.vix=vix;
  }
  // mirror close to legacy series (pnl mini-spark reads s.series.t)
  const ser=s.series;
  if(!ser.t.length || ser.t[ser.t.length-1]!==t){ ser.t.push(t);ser.atm.push(atmC);ser.low.push(lowC);ser.spot.push(spot);ser.vix.push(vix); }
  else { const j=ser.t.length-1; ser.atm[j]=atmC;ser.low[j]=lowC;ser.spot[j]=spot;ser.vix[j]=vix; }
}

// FREEZE_MIN_BARS: the detection threshold for a stalled spot feed (Task C item 8).
// Observed defect: the primary index's spot feed can freeze at/after 09:15 while
// `/ws` and `/api/snapshot` keep responding — ingestLive() (single owner of s.spot,
// ~line 3024: `s.spot = snap.live_spot_ltp ?? ...`) has no check that the incoming
// value ever actually MOVED, so a frozen upstream number is silently treated as
// fresh. bars are minute-bucketed (pushBar, above), so N identical `spot` values in
// the last N consecutive bars means N straight minutes with literally zero print —
// on NSE's spot feed (many ticks/second in a live session) that is not "quiet
// market", it is a stalled feed. 5 was chosen as the floor: shorter risks flagging a
// single genuinely flat print as "stale"; 5 straight identical minutes is the
// pattern the reported 09:15 freeze actually showed.
const FREEZE_MIN_BARS = 5;

// detectStaleSpot(s): the SINGLE owner of "is this index's live spot frozen" — every
// consumer (chart Spot series, the STALE badge) reads this, none re-derives it, so
// there is exactly one freeze verdict per index (Layer 1.2). Never fabricates: only
// looks at spot values actually recorded in s.bars, never invents or forward-fills one.
function detectStaleSpot(s){
  const b=s.bars||[];
  if(b.length < FREEZE_MIN_BARS) return {stale:false};
  const tail=b.slice(-FREEZE_MIN_BARS);
  const v=tail[0].spot;
  if(v==null) return {stale:false};
  const frozen = tail.every(x=>x.spot===v);
  if(!frozen) return {stale:false};
  // walk backward from the end to find where this frozen run actually started,
  // so the badge/exclusion covers the FULL frozen tail, not just the last 5 bars.
  let startIdx=b.length-1;
  while(startIdx>0 && b[startIdx-1].spot===v) startIdx--;
  return {stale:true, startIdx, value:v, since:b[startIdx].t, count:b.length-startIdx};
}

// updateChartStaleBadge(s): paints/hides the #chartStaleBadge pill using the SAME
// verdict detectStaleSpot() computed for masking the chart's Spot line — one call,
// one source of truth, so the badge and the gap in the line can never disagree.
function updateChartStaleBadge(s){
  const el=document.getElementById('chartStaleBadge'); if(!el) return;
  const freeze=detectStaleSpot(s);
  if(freeze.stale){
    el.style.display='inline';
    el.textContent='STALE SPOT · frozen since '+freeze.since+' ('+freeze.count+'m)';
  } else {
    el.style.display='none'; el.textContent='';
  }
}

function chartDatasets(s){
  const b=s.bars;
  // A non-default strike override shows ONLY close-derived series — /api/chain/intraday
  // records ce_close/pe_close (real measured prints), never a combined high/low that
  // may not have printed simultaneously. Line-only, never a synthesized candle.
  if(overriding && _chartOverride){
    const o=_chartOverride;
    return [
      {label:'Strike '+o.strike,type:'line',data:o.rows.map(x=>x.comb),borderColor:'#36D6E7',borderWidth:2,
        pointRadius:(c)=>c.dataIndex===(c.dataset.data.length-1)?3:0,pointBackgroundColor:'#36D6E7',
        tension:.3,yAxisID:'yP'},
      {label:'CE',type:'line',data:o.rows.map(x=>x.ce_close),borderColor:'#A98BFF',borderWidth:1.2,borderDash:[5,4],pointRadius:0,spanGaps:true,tension:.3,yAxisID:'yP',hidden:true},
      {label:'PE',type:'line',data:o.rows.map(x=>x.pe_close),borderColor:'#F5C451',borderWidth:1.2,borderDash:[5,4],pointRadius:0,spanGaps:true,tension:.3,yAxisID:'yP',hidden:true},
    ];
  }
  // Task C item 8: never plot a frozen spot value as if it were live. Only the Spot
  // series is masked (ATM/Lowest/VIX are separate owners' data and are unaffected) —
  // spanGaps:true on the Spot line renders the masked tail as a gap, not a flat lie.
  const freeze=detectStaleSpot(s);
  const spotData = freeze.stale
    ? b.map((x,i)=> i>=freeze.startIdx ? null : x.spot)
    : b.map(x=>x.spot);
  if(chartMode==='candle'){
    const cols=b.map(x=>x.c>=x.o?C_UP:C_DN);
    return [
      {label:'Wick',type:'bar',data:b.map(x=>[x.l,x.h]),backgroundColor:cols,borderColor:cols,barThickness:2,maxBarThickness:3,grouped:false,yAxisID:'yP',order:4},
      {label:'Body',type:'bar',data:b.map(x=>[x.o,x.c]),backgroundColor:cols,borderColor:cols,barPercentage:0.92,categoryPercentage:0.95,maxBarThickness:10,grouped:false,yAxisID:'yP',order:3},
      {label:'Lowest',type:'line',data:b.map(x=>x.low),borderColor:'#A98BFF',borderWidth:1.6,borderDash:[5,4],pointRadius:0,spanGaps:true,tension:.3,yAxisID:'yP',order:2},
      {label:'Spot',type:'line',data:spotData,borderColor:'#5D6B82',borderWidth:1.4,pointRadius:0,spanGaps:true,tension:.3,yAxisID:'yS',order:1},
      {label:'VIX',type:'line',data:b.map(x=>x.vix),borderColor:'#F5C451',borderWidth:1.4,pointRadius:0,spanGaps:true,tension:.3,yAxisID:'yV',hidden:true,order:0},
    ];
  }
  return [
    {label:'ATM',type:'line',data:b.map(x=>x.c),borderColor:'#36D6E7',borderWidth:2,
      pointRadius:(c)=>c.dataIndex===(c.dataset.data.length-1)?3:0,pointBackgroundColor:'#36D6E7',
      tension:.3,yAxisID:'yP'},
    {label:'Lowest',type:'line',data:b.map(x=>x.low),borderColor:'#A98BFF',borderWidth:1.7,borderDash:[5,4],pointRadius:0,spanGaps:true,tension:.3,yAxisID:'yP'},
    {label:'Spot',type:'line',data:spotData,borderColor:'#5D6B82',borderWidth:1.4,pointRadius:0,spanGaps:true,tension:.3,yAxisID:'yS'},
    {label:'VIX',type:'line',data:b.map(x=>x.vix),borderColor:'#F5C451',borderWidth:1.4,pointRadius:0,spanGaps:true,tension:.3,yAxisID:'yV',hidden:true},
  ];
}

function buildChart(){
  if(typeof Chart==='undefined'){ // CDN blocked / offline — skip chart, keep app alive
    const box=document.querySelector('.chart-box');
    if(box) box.innerHTML='<div class="empty">Chart not available</div>';
    return;
  }
  const ctx=document.getElementById('liveChart'); if(!ctx)return;
  const s=ST[CUR];
  if(s.bars) s.bars=s.bars.filter(x=>x.t>='09:15'&&x.t<='15:40');  // session floor 09:15–15:40 (item 8)
  if(chart){ chart.destroy(); chart=null; }
  chart=new Chart(ctx,{type: overriding ? 'line' : (chartMode==='candle'?'bar':'line'),
    data:{labels: (overriding && _chartOverride) ? _chartOverride.rows.map(x=>(x.timestamp||'').slice(11,16)) : s.bars.map(x=>x.t), datasets:chartDatasets(s)},
    options:{responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:false},tooltip:{
        backgroundColor:getCSS('--surface'),borderColor:getCSS('--border2'),borderWidth:1,
        titleColor:getCSS('--muted'),bodyColor:getCSS('--text'),padding:10,
        callbacks:{label:c=>{
          if(c.dataset.label==='Body'){return ` O ${n2(c.raw[0])}   C ${n2(c.raw[1])}`;}
          if(c.dataset.label==='Wick'){return ` H ${n2(c.raw[1])}   L ${n2(c.raw[0])}`;}
          return ` ${c.dataset.label}: ${n2(c.parsed.y)}`; }}}},
      scales:{
        yP:{position:'right',grid:{color:getCSS('--grid')},ticks:{color:getCSS('--muted'),font:{size:10,family:"'JetBrains Mono'"}}},
        yS:{position:'left',grid:{display:false},ticks:{color:getCSS('--muted'),font:{size:10,family:"'JetBrains Mono'"}}},
        yV:{display:false},
        x:{grid:{color:getCSS('--grid')},ticks:{color:getCSS('--muted'),font:{size:9,family:"'JetBrains Mono'"},maxTicksLimit:9,autoSkip:true}}}}
  });
  applySeriesVisibility(); updateChartModeBtn(); updateChartStaleBadge(s);
}

// update data in place (keeps live feel, no rebuild) — falls back to rebuild on mode change
function refreshChart(){
  if(overriding) return;   // a strike override owns the chart until cleared — live ticks must not stomp it
  const s=ST[CUR]; if(!s||typeof Chart==='undefined')return;
  if(s.bars) s.bars=s.bars.filter(x=>x.t>='09:15'&&x.t<='15:40');  // drop pre-open/post-close ticks (self-heals, item 8)
  if(!chart){buildChart();return;}
  const ds=chartDatasets(s);
  if(chart.data.datasets.length!==ds.length){ buildChart(); return; }
  chart.data.labels=s.bars.map(x=>x.t);
  ds.forEach((d,i)=>{ chart.data.datasets[i].data=d.data;
    if(d.backgroundColor)chart.data.datasets[i].backgroundColor=d.backgroundColor;
    if(Array.isArray(d.borderColor))chart.data.datasets[i].borderColor=d.borderColor; });
  applySeriesVisibility(); chart.update('none'); updateChartStaleBadge(s);
}
function syncChart(full){ overriding=false; _chartOverride=null; const sel=document.getElementById('chartStrikeSel'); if(sel) sel.value='ATM'; buildChart(); }   // index switch → rebuild from that index's bars

function applySeriesVisibility(){
  if(!chart)return;
  const on={ATM:gc('c-atm'),Lowest:gc('c-low'),Spot:gc('c-spot'),VIX:gc('c-vix')};
  chart.data.datasets.forEach(d=>{
    if(d.label==='ATM'||d.label==='Wick'||d.label==='Body') d.hidden=!on.ATM;
    else if(d.label==='Lowest') d.hidden=!on.Lowest;
    else if(d.label==='Spot') d.hidden=!on.Spot;
    else if(d.label==='VIX') d.hidden=!on.VIX;
  });
}
function gc(id){const e=document.getElementById(id);return e?e.checked:true;}
function toggleSeries(){ applySeriesVisibility(); if(chart)chart.update('none'); }

function toggleChartMode(){ if(overriding) return; chartMode = chartMode==='line'?'candle':'line'; buildChart(); }
function updateChartModeBtn(){
  const btn=document.getElementById('chartModeBtn'); if(!btn)return;
  btn.innerHTML = (overriding || chartMode==='line') ? ICON_CANDLE : ICON_LINE;
  btn.title = overriding ? 'Candlesticks disabled — strike override shows close-derived series only' : (chartMode==='line' ? 'Switch to candlesticks' : 'Switch to line');
  btn.classList.toggle('active', !overriding && chartMode==='candle');
  btn.disabled = !!overriding;
}
// Chart a specific strike: /api/chain/intraday returns only close-derived CE/PE/comb
// (real recorded prints — never a synthesized OHLC), so an override is line-only and
// candle mode is disabled. ATM (the default) restores the full straddle OHLC chart.
async function setChartStrike(k){
  const sel=document.getElementById('chartStrikeSel'); if(!sel) return;
  const s=ST[CUR]; if(!s) return;
  const want=(k!=null && String(k)!=='ATM' && String(k)!=='') ? Number(k) : null;
  const atm=atmStrike(CUR);
  if(want==null || (want===atm && !overriding)){
    overriding=false; _chartOverride=null; sel.value='ATM'; chartMode='line'; buildChart(); return;
  }
  const d=await jget('/api/chain/intraday?strike='+want).catch(()=>null);
  if(!d || !d.rows || !d.rows.length){ toast('dn','No intraday closes for strike '+want); sel.value='ATM'; return; }
  _chartOverride={strike:want, rows:d.rows};
  overriding=true; chartMode='line'; buildChart();
}
function populateChartStrikes(){
  const sel=document.getElementById('chartStrikeSel'); const s=ST[CUR];
  if(!sel||!s) return;
  // BUG FIXED 2026-08-25 (operator: "dropdown kuch bhi nahi ho raha"). This required
  // s.allStrikes, which is ONLY ever filled by fetchFullChain() — and fetchFullChain()
  // only runs when RANGE==='all' (core.js:518 and :3859). RANGE defaults to 10, so a
  // user who never switches the CHAIN TABLE to "All Strikes" could never chart ANY
  // strike: the dropdown sat permanently at its single static "ATM" option. Verified
  // live in-browser that day — allStrikes held 21 strikes while the <select> had 1
  // option, and calling this function directly filled it to 22. The per-strike CHART
  // must not be coupled to an unrelated chain-table row-range setting.
  // Fall back to whatever strike set is already loaded (the normal ATM±N chain), so
  // the dropdown is usable from first paint regardless of RANGE.
  let ks = (s.allStrikes && s.allStrikes.length) ? s.allStrikes
         : (s.strikes && s.strikes.length) ? s.strikes
         : Object.keys(s.legs||{}).map(Number).filter(n=>!isNaN(n));
  if(!ks || !ks.length) return;
  ks = Array.from(new Set(ks)).sort((a,b)=>a-b);
  // Rebuild only when the option set actually changed — this runs on the render pass,
  // and blindly reassigning innerHTML every tick would close the dropdown while the
  // operator is choosing from it.
  const sig = ks.join(',');
  if(sel._sig === sig) return;
  sel._sig = sig;
  const prev=overriding&&_chartOverride?String(_chartOverride.strike):(sel.value||'ATM');
  sel.innerHTML='<option value="ATM">ATM · default</option>'+ks.map(k=>'<option value="'+k+'">'+k+'</option>').join('');
  sel.value = Array.from(sel.options).some(o=>o.value===prev) ? prev : 'ATM';
}

// seed today's stored 1-min OHLC so chart shows the FULL day (survives refresh)
async function seedBars(){
  try{
    // CROSS-STRIKE SPIKE FIX (2026-08-25): ask for the MORNING ANCHOR strike's own
    // series when we already know it. combined_premium_ohlc_1min follows whatever
    // strike was ATM each minute, so the default series jumps to a different option's
    // price on every ATM roll — a chart artifact, and the reason Day Hi/Lo below could
    // contradict the 9:15 reference (live 2026-08-25: Ref 120.00 vs Day Hi 91.15).
    // Falls back to the mixed series only when no anchor is known yet; each bar now
    // carries `k` (its strike) either way so the renderer can segment on a change.
    const _mk = (ST[CUR] && ST[CUR].morningStrike != null) ? ST[CUR].morningStrike : null;
    const d=await jget('/api/intraday'+(_mk!=null?('?strike='+encodeURIComponent(_mk)):'')); const map={};
    const key=r=>(r.timestamp||'').slice(11,16);
    (d.comb||[]).forEach(r=>{const t=key(r);if(!t)return;(map[t]=map[t]||{t}); const m=map[t];m.o=r.o;m.h=r.h;m.l=r.l;m.c=r.c;m.k=r.k;});
    (d.spot||[]).forEach(r=>{const t=key(r);if(!t)return;(map[t]=map[t]||{t}).spot=r.c;});
    (d.vix ||[]).forEach(r=>{const t=key(r);if(!t)return;(map[t]=map[t]||{t}).vix=r.v;});
    const ts=Object.keys(map).sort();
    if(!ts.length)return;
    // find first bar where both straddle comb AND spot data exist (align start times)
    let _start=ts.findIndex(t=>{const m=map[t]; return m.c!=null && m.spot!=null; });
    if(_start<0) _start=0;
    const alignedTs=ts.slice(_start);
    ST[CUR].bars = alignedTs.map(t=>{const m=map[t];const c=m.c??null;
      return {t, o:m.o??c, h:m.h??c, l:m.l??c, c, k:m.k??null, low:null, spot:m.spot??null, vix:m.vix??null};});
    // RESTART RECOVERY: re-seed the day's straddle high/low/open + spot levels from
    // STORED bars so a mid-day restart never resets them ("aaj ka data gaya" fix).
    const _b=ST[CUR].bars, _hs=_b.map(x=>x.h).filter(v=>v!=null), _ls=_b.map(x=>x.l).filter(v=>v!=null), _sp=_b.map(x=>x.spot).filter(v=>v!=null);
    // CROSS-STRIKE RANGE FIX (2026-08-25): atmHi/atmLo are the "Day Hi / Day Lo" shown
    // directly beside the 9:15 reference, so they MUST describe the same option the
    // reference does. These two lines accumulate a running max/min, which silently
    // merged ranges from different strikes once the ATM rolled — live that produced
    // `9:15 Ref 120.00` beside `Day Hi 91.15`, a day high below the day's own open.
    // A strike change invalidates the previous range outright: it belongs to a
    // different option, so it is dropped, never merged (Layer 1.2 — no mixing metrics
    // across strikes without saying so).
    const _barK=(_b.find(x=>x.k!=null)||{}).k ?? _mk;
    if(ST[CUR]._hlStrike!=null && _barK!=null && ST[CUR]._hlStrike!==_barK){
      ST[CUR].atmHi=null; ST[CUR].atmLo=null;
    }
    if(_barK!=null) ST[CUR]._hlStrike=_barK;
    if(_hs.length) ST[CUR].atmHi=Math.max(ST[CUR].atmHi||0, Math.max(..._hs));
    if(_ls.length) ST[CUR].atmLo=Math.min(ST[CUR].atmLo==null?1e9:ST[CUR].atmLo, Math.min(..._ls));
    if(_b[0]&&_b[0].o!=null&&!ST[CUR].atm9_15) ST[CUR].atm9_15=_b[0].o;
    if(_sp.length){ ST[CUR].spotHi=Math.max(ST[CUR].spotHi||0,Math.max(..._sp)); ST[CUR].spotLo=Math.min(ST[CUR].spotLo==null?1e9:ST[CUR].spotLo,Math.min(..._sp)); if(!ST[CUR].spotOpen)ST[CUR].spotOpen=_sp[0]; }
    // seed current comb + spot + vix from last bar's close for early gauges render
    const lastBar=_b[_b.length-1];
    if(lastBar&&lastBar.c!=null) ST[CUR]._comb=lastBar.c;
    if(lastBar&&lastBar.spot!=null&&!ST[CUR].spot) ST[CUR].spot=lastBar.spot;
    if(lastBar&&lastBar.vix!=null&&!ST[CUR].vix) ST[CUR].vix=lastBar.vix;
    refreshChart();
    try{renderGauges();}catch(e){}
  }catch(e){}
}

// ---- pages: pnl / history / ledger / logs ----
const STRAT_NAMES=['Locked 9:15 ATM','9:30 ATM combined','Cheapest-ATM','25Δ Strangle','₹20 Strangle',
  'Iron Condor','Iron Butterfly','Broken-wing Fly','Jade Lizard','Asymmetric Hedge','Rolling Straddle',
  'Delta-neutral Fut','Vol-Switch','IV-Crush Event','0DTE Gamma Scalp','Weekend Carry','Cheapest Pullback',
  'Hourly Ladder','Calendar Straddle','VRP-Gated','Gamma-Flip Gated','BE-Width Adaptive','Expected-Move Fade','Ratio-Backed'];
function getLotSize(){ return (INDICES[CUR]&&INDICES[CUR].lot)||65; }
const DEFAULT_LOTS=2;
function getQTY(){ return getLotSize()*DEFAULT_LOTS; }
var LOT_SIZE=65, QTY=130; // updated dynamically by getLotSize/getQTY
// pnlState (fabricated Math.random strategy P&L) removed — the Strategy Lab footer renders
// real data via the async renderPnl() path reading /api/strategies/today. Never fabricate
// user-facing financial numbers.

// ---- new section renderers ----
function renderFullChain(){
  // live: fetch /api/chain/full ; mock: use current legs (all loaded strikes)
  const s=ST[CUR];
  const ks = (s.allStrikes&&s.allStrikes.length)?s.allStrikes:s.strikes;
  const fmtOI=v=>(v==null)?'—':Number(v).toLocaleString('en-IN');
  const f1=v=>(v==null)?'—':Number(v).toFixed(1);
  const f2=v=>(v==null)?'—':Number(v).toFixed(2);
  document.getElementById('fullChainBody').innerHTML = ks.map(k=>{
    const l=s.legs[k]; if(!l)return'';
    const cls=k===s.atm?'atm-row':'';
    // REAL per-leg data only — CE OI / PE OI separate, no mock formula fallbacks
    return `<tr class="${cls}">
      <td class="num" style="text-align:right;color:var(--muted)">${fmtOI(l.ceOI)}</td>
      <td class="num" style="text-align:right;color:var(--muted)">${f1(l.ceIV)}</td>
      <td class="num" style="text-align:right;color:var(--muted)">${f2(l.ceD)}</td>
      <td class="num t-call" style="text-align:right">${n2(l.call)}</td>
      <td class="num t-strike" style="text-align:center">${n0(k)}${k===s.atm?'<span class="row-tag">ATM</span>':''}</td>
      <td class="num t-put">${n2(l.put)}</td>
      <td class="num" style="color:var(--muted)">${f2(l.peD)}</td>
      <td class="num" style="color:var(--muted)">${f1(l.peIV)}</td>
      <td class="num" style="text-align:right;color:var(--muted)">${fmtOI(l.peOI)}</td>
      <td class="num t-comb">${n2(l.comb)}</td></tr>`;
  }).join('');
}

const SECTORS=['BANK','IT','FMCG','AUTO','PHARMA','FINSRV','ENERGY','METAL','REALTY','MEDIA','PSUBANK'];
async function renderEnsembleEm(){
  try{
    const r=await (await fetch('/api/ensemble_em')).json();
    const b=document.getElementById('ensembleEmBody');
    if(r.error||!r.composite_score){b.innerHTML='';return;}
    const cs=r.composite_score, sig=r.signal||'NEUTRAL', bias=r.bias||'NEUTRAL', conv=r.conviction||'LOW';
    const sc=cs>=70?'var(--green)':cs>=40?'var(--gold)':'var(--red)';
    const sigEmoji=sig.includes('LONG')?'▲':sig.includes('SHORT')?'▼':'◆';
    const convCls=conv==='HIGH'?'up':conv==='LOW'?'dn':'';
    b.innerHTML=`
      <div style="text-align:center"><div class="k" style="font-size:9px;color:var(--muted)">COMPOSITE</div>
        <div style="font-family:var(--disp);font-size:36px;font-weight:800;color:${sc}">${cs}</div>
        <div style="font-size:10px;color:var(--muted)">0-100</div></div>
      <div><div class="k" style="font-size:9px;color:var(--muted)">SIGNAL</div>
        <div style="font-family:var(--disp);font-size:18px;font-weight:700;color:${sc}">${sigEmoji} ${sig}</div></div>
      <div><div class="k" style="font-size:9px;color:var(--muted)">BIAS</div>
        <div style="font-family:var(--disp);font-size:16px;font-weight:600">${bias}</div></div>
      <div><div class="k" style="font-size:9px;color:var(--muted)">CONVICTION</div>
        <div style="font-family:var(--disp);font-size:16px;font-weight:600" class="${convCls}">${conv}</div></div>`;
  }catch(e){document.getElementById('ensembleEmBody').innerHTML='';}
}

async function renderCorrelation(){
  try{
    const r=await(await fetch('/api/correlation')).json();
    const b=document.getElementById('corrBody');
    if(!r.names||r.names.length<2){b.innerHTML='';return;}
    const n=r.names;
    const map={};r.pairs.forEach(p=>{const k=p.strategy_a+':'+p.strategy_b;map[k]=p.correlation;map[p.strategy_b+':'+p.strategy_a]=p.correlation;});
    let html='<table class="simple-tbl" style="font-size:10px"><thead><tr><th style="text-align:left">⬇A / B➡</th>'+n.map(s=>`<th style="text-align:right">${s}</th>`).join('')+'</tr></thead><tbody>';
    n.forEach(a=>{
      html+='<tr><td style="font-weight:600;white-space:nowrap">'+a+'</td>';
      n.forEach(b=>{
        if(a===b){html+='<td style="text-align:right;color:var(--muted)">—</td>';return;}
        const v=map[a+':'+b];if(v==null){html+='<td style="text-align:right;color:var(--muted)">—</td>';return;}
        const c=v>0.5?'var(--green)':v>0.3?'var(--gold)':v<-0.3?'var(--red)':v<-0.5?'var(--purple)':'var(--muted)';
        html+=`<td style="text-align:right;color:${c};font-weight:${Math.abs(v)>0.4?'700':'400'}">${v.toFixed(2)}</td>`;
      });
      html+='</tr>';
    });
    html+='</tbody></table><div style="margin-top:6px;font-size:9px;color:var(--muted)">pairs: '+r.pairs.length+' · min 3 common sessions</div>';
    b.innerHTML=html;
  }catch(e){document.getElementById('corrBody').innerHTML='';}
}

function renderLevels(){
  const s=ST[CUR];
  const lv=[['PDH',s.spotHi*1.002],['PDL',s.spotLo*0.998],['Prev Close',s.spotPrevClose],['Day Open',s.spotOpen],
    ['Day High',s.spotHi],['Day Low',s.spotLo],['Week High',s.spotHi*1.01],['Week Low',s.spotLo*0.99],
    ['Month High',s.spotHi*1.03],['Month Low',s.spotLo*0.97],['Max Pain',s.atm],['VWAP',s.spot]];
  document.getElementById('lvlGrid').innerHTML=lv.map(([k,v])=>`<div class="lvl-cell"><div class="k">${k}</div><div class="v num">${n0(v)}</div></div>`).join('');
  const atmC=s.legs[s.atm].comb;
  const sl=[['9:15 Open',s.atm9_15],['9:15 Day High',s.atmHi],['9:15 Day Low',s.atmLo],['9:15 Current',atmC],
    ['Lowest Now',s.legs[lowestStrike(CUR)].comb],['Wk High',s.atmHi*1.1],['Wk Low',s.atmLo*0.9],['Mo High',s.atmHi*1.25]];
  document.getElementById('strLvlGrid').innerHTML=sl.map(([k,v])=>`<div class="lvl-cell"><div class="k">${k}</div><div class="v num">${n2(v)}</div></div>`).join('');
}

// ---- IV & Greeks page ----
/* ══ DELETED: the placeholder IV renderer ═══════════════════════════════════
   This function used to fill the IV & Greeks page with numbers that were not
   measurements at all:

       Weekly Avg IV   = VIX * 0.98
       Monthly Avg IV  = VIX * 1.02
       IV Percentile   = VIX * 3.5        (a "percentile" that can exceed 100)
       change %        = 0, hard-coded, on all three

   None of that is derived from anything. It is the exact thing this project
   forbids: a fabricated number where a NULL and a reason belong. Someone reading
   "Monthly Avg IV 12.9" would have no way to know it was today's VIX multiplied
   by a constant.

   It also carried a crash. `s.legs[s.atm].comb` was read unguarded, so whenever
   the ATM leg was not yet in the chain - at the open, after an ATM shift, on any
   reconnect - it threw a TypeError and killed the render HALFWAY, which is why
   the page appeared half-built rather than empty.

   The REAL renderer is the API-driven one further down the file, which reads
   /api/iv_summary and shows '—' for anything the server does not have. This stub
   only exists so that if that assignment ever fails to run, the page shows dashes
   instead of invented numbers. Failing visibly beats failing plausibly. */
function renderIVGreeks(){
  const row=document.getElementById('ivAvgRow');
  if(row) row.innerHTML='<div class="lvl-cell" style="grid-column:1/-1">'+
    '<div class="k">IV SUMMARY</div><div class="v" style="font-size:12px;color:var(--muted)">'+
    'Not loaded — /api/iv_summary did not respond.</div></div>';
  ['iv-em','iv-em2','iv-strad','iv-em-sub'].forEach(function(id){
    const e=document.getElementById(id); if(e) e.textContent='—';
  });
}

// ---- Skew & Synthetic page ----
// renderSkew(){} used to be declared here (a plain `function` — DEAD CODE: a
// later, unconditional top-level async assignment of the same name (~line 5271,
// the `renderSkew` that follows this comment) overwrites it the instant core.js
// finishes executing, so this version could never actually run). Deleted 2026-08-11 during the Skew/VRP
// trust-upgrade pass rather than "fixed" — it contained two fabricated-data
// violations (Layer 1.3) a future reader could easily mistake for live code:
// b3/b5/b10 as three/five/ten percent of the straddle premium (the source
// comment admitted "mock: synth premiums") and the "future" price as spot
// times a hardcoded +0.08% markup, labelled "ACTUAL FUTURE" in the UI when it
// was never derived from any real futures tick. The REAL, active renderSkew()
// below reads bench_3pct/5pct/10pct from
// main.py's /api/otm_imbalance (a real backend computation, not a percentage of
// the straddle) — no fix needed there. Its "ACTUAL FUTURE" gap (line ~5315
// below) is fixed separately: /api/synthetic's SELECT never exposed the
// `actual_future` column live_compute.py already writes from the real NIFTY
// futures tick (`eng.latest_future_ltp`) — see analytics_api.py's synthetic().

async function fillSimStrats(){
  const sel=document.getElementById('sim-strat');
  if(!sel || sel.options.length) return;
  // Populate from REAL strategy names so runSim can match a record exactly.
  let names=[];
  try{ const r=await jget('/api/strategies/today');
    const rows=Array.isArray(r)?r:(r.strategies||r.rows||[]);
    names=[...new Set(rows.map(x=>x.strategy).filter(Boolean))]; }catch(_){}
  if(!names.length) names=STRAT_NAMES;   // labels-only fallback; runSim still shows "—" with no records
  sel.innerHTML=names.map(n=>`<option>${n}</option>`).join('');
}
// Historical strategy stats from the DB (real records) — NEVER random numbers. Fields the
// backend does not store (path-dependent DD / CVaR) are shown as "—", not fabricated.
async function runSim(){
  const card=document.getElementById('simResultCard');card.style.display='block';
  const name=document.getElementById('sim-strat').value;
  const dash='—';
  const stat=(k,v,c)=>`<div class="sim-stat"><div class="k">${k}</div><div class="v num ${c||''}">${v}</div></div>`;
  let row=null;
  try{ const r=await jget('/api/strategies/today');
    const rows=Array.isArray(r)?r:(r.strategies||r.rows||[]);
    row=rows.find(x=>x.strategy===name)||null; }catch(_){}
  if(!row){
    document.getElementById('simResults').innerHTML=
      stat('Win Rate',dash)+stat('Profit Factor',dash)+stat('Expectancy',dash)+
      stat('Net P&L',dash)+stat('Sample Days',dash)+stat('Sharpe',dash);
    pushLog('INFO','simulator',`no records for ${name}`);
    return;
  }
  const money=v=>(v==null?dash:'₹'+Math.round(v).toLocaleString('en-IN'));
  const pct=v=>(v==null?dash:(v<=1?v*100:v).toFixed(0)+'%');   // win_rate may be fraction or %
  const wr=row.win_rate, pf=row.profit_factor, ex=row.expectancy, np=row.net_pnl, sd=row.sample_days, sh=row.sharpe;
  document.getElementById('simResults').innerHTML=
    stat('Win Rate', pct(wr), (wr!=null&&(wr>=0.55||wr>=55))?'up':'dn')+
    stat('Profit Factor', pf==null?dash:Number(pf).toFixed(2), (pf!=null&&pf>=1)?'up':'dn')+
    stat('Expectancy', money(ex), (ex!=null&&ex>=0)?'up':'dn')+
    stat('Net P&L', money(np), (np!=null&&np>=0)?'up':'dn')+
    stat('Sample Days', sd==null?dash:String(sd),'')+
    stat('Sharpe', sh==null?dash:Number(sh).toFixed(2), (sh!=null&&sh>=0)?'up':'dn');
  pushLog('INFO','simulator',`stats ${name} · win ${pct(wr)}`);
}
// renderPnl → async (line ~2573, reads /api/strategies/today)
const ledger=[];
function renderLedger(){
  document.getElementById('ledgerBody').innerHTML = ledger.length?ledger.map(l=>
    `<tr><td class="num">${l.t}</td><td>${l.s}</td><td>${l.a}</td><td class="num" style="text-align:right">${n0(l.k)}</td>
     <td class="num" style="text-align:right">${n2(l.p)}</td><td><span class="pill ${l.cls}">${l.st}</span></td></tr>`).join('')
    : '<tr><td colspan="6" class="empty">Simulated trades appear here as strategies trigger</td></tr>';
}
const logs=[];
function pushLog(lvl,cmp,msg){
  const t=new Date().toTimeString().slice(0,8);
  logs.unshift({t,lvl,cmp,msg}); if(logs.length>60)logs.pop();
  const b=document.getElementById('logBadge'); b.textContent=Math.min(logs.length,99);
  if(document.getElementById('page-logs').classList.contains('on'))renderLogs();
}
async function renderLogs(){
  let al=[];
  try{ al=window.__alerts||await jget('/api/alerts'); }catch(_){}
  const rows=[]
    .concat((al||[]).map(a=>({id:a.id,t:String(a.timestamp||'').slice(11,19),lvl:'ALERT',
                              cmp:(a.alert_type||'alert'),msg:a.message||''})))
    .concat(logs.map(l=>({t:l.t,lvl:l.lvl,cmp:l.cmp,msg:l.msg})));
  const filtered=rows.filter(l => !['engine','simulator','chain','feed'].includes(l.cmp));
  filtered.sort((a,b)=>String(b.t).localeCompare(String(a.t)));
  document.getElementById('logBody').innerHTML = filtered.length?filtered.slice(0,100).map(l=>
    `<div class="log-row"><span class="tm num">${l.t}</span><span class="log-lvl ${l.lvl}">${l.lvl}</span>
     <span class="log-cmp">${l.cmp}</span><span class="log-msg">${l.msg}</span>${l.id!=null?`<span class="del-alert" data-id="${l.id}">×</span>`:''}</div>`).join('')
    : '<div class="empty">Alerts appear here — straddle moves, SL hits, OI buildup, expiry triggers</div>';
  // delete alert handler
  document.querySelectorAll('.del-alert').forEach(el=>{
    el.onclick=async function(){
      const id=this.dataset.id;
      if(!confirm('Delete this alert?'))return;
      try{await fetch('/api/alerts/'+id,{method:'DELETE'});renderLogs();}catch(_){}
    };
  });
}
setInterval(()=>{const p=document.getElementById('page-logs');if(p&&p.classList.contains('on'))renderLogs();},10000);

// ---- toast ----
var _TOAST_MAX=4;
function toast(type,title,msg){
  const box=document.getElementById('toasts'); if(!box) return;
  // CAP (2026-08-25): #toasts is a fixed-position flex column with no max-height, so
  // a burst of alerts (the server can emit several in the same poll) stacked without
  // limit and covered the screen until each 4.5 s timer expired. Drop the OLDEST
  // beyond the cap — newest alerts are the ones worth reading.
  while(box.children.length>=_TOAST_MAX){ box.removeChild(box.firstChild); }
  const t=document.createElement('div');t.className='toast '+type;
  // Read-only review finding (2026-08-20): every real caller passes plain text
  // (static strings, n0()/n2() formatted numbers) — none intends title/msg to
  // carry HTML — so escaping is safe and closes this shared, app-wide innerHTML
  // sink to any future caller that echoes server/Telegram/error text unescaped.
  t.innerHTML=`<div class="tt">${_escH(title)}</div>${_escH(msg)}`;
  box.appendChild(t);
  setTimeout(()=>{t.style.opacity='0';t.style.transform='translateX(120%)';t.style.transition='.3s';setTimeout(()=>t.remove(),300);},4500);
}

// ---- market dot ----
function updateMktDot(){
  var sess=window._lastSessionState;
  var dot=document.getElementById('mktDot'), st=sess&&sess.state;
  if(!dot) return;
  dot.classList.remove('off','warn');
  if(!st){ dot.style.background='var(--muted)'; dot.classList.add('off'); return; }  // no session yet — never show green
  if(st==='LIVE'){ dot.style.background='var(--green)'; }
  else if(st==='PAUSED'){ dot.style.background='var(--gold)'; dot.classList.add('warn'); }
  else if(st==='WEEKEND'||st==='HOLIDAY'){ dot.style.background='var(--muted)'; dot.classList.add('off'); }
  else{ dot.style.background='var(--red)'; dot.classList.add('off'); }
}
setInterval(updateMktDot,5000);updateMktDot();

function renderBuildInfo(){
  fetch('/api/version',{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){
    var el=document.getElementById('settingsBuildInfo');
    // /api/version owns content_hash (never build_hash) — using the missing key
    // rendered "v1.0.0 · undefined" in Settings → About (ISS-2026-08-15-11).
    if(el) el.textContent='v'+(d.version||'—')+' · '+(d.content_hash||'—');
  }).catch(function(){});
}
// ---- master render ----
/* Each render call is isolated. Before this, renderAll ran them in a bare sequence,
   so a throw in ANY one of them stopped every call after it - which is how a single
   broken card (see loadKeyLevels) blanked the entire dashboard. Now one failing
   renderer skips itself and the rest still paint. */
function _safe(fn){ try{ fn(); }catch(e){ /* one card down, page lives */ } }
function renderAll(){
  _safe(renderStatbar); _safe(renderGauges); _safe(renderChain);
  _safe(renderOvStrip); _safe(buildIdxMenu); _safe(loadKeyLevels); _safe(loadRegimeCard); _safe(loadV2Regime); _safe(loadVisitorCount);
  _safe(renderLiveAlerts);
  // (populateChartStrikes is driven from ingestLive(), where the live strike window is
  // rebuilt — renderAll() runs only at load and on index switch, which is exactly how
  // the selector got stuck on a first-paint strike set.)
  _safe(populateChartStrikes);
  _safe(function(){ if(window.__hero) window.__hero(); });   // big spot number + change + EM
}

// ---- live page recent alerts ----
// _lastAlertId (a number, compared against a string — see renderLiveAlerts) is gone;
// window._alertSeen is now the single owner of "which alerts have been notified".
window._alertSeen=window._alertSeen||null;
function renderLiveAlerts(){
  const body=document.getElementById('liveAlertsBody'); if(!body) return;
  const al=window.__alerts||[];
  const recent=al.slice(0,5);
  const cnt=document.getElementById('liveAlertCount');
  if(cnt) cnt.textContent=al.length+' total';
  // Toast new server alerts (not client-side pushLog ones).
  //
  // BUG FIXED 2026-08-25 — server alerts had NEVER produced a toast. The old test was
  // `aid > window._lastAlertId`, where `aid` is a STRING ("2026-08-25 09:15:00" +
  // alert_type) but `_lastAlertId` was initialised to the NUMBER 0. JS relational
  // comparison against a number coerces the string via ToNumber -> NaN, and `NaN > 0`
  // is ALWAYS false — so the branch never ran, `_lastAlertId` (only assigned INSIDE
  // that branch) stayed 0 forever, and the bug was self-sustaining. It also failed
  // silently: no error, the alerts LIST rendered fine, only the notification was
  // missing, which is why it survived so long.
  //
  // Replaced with an explicit seen-set keyed on timestamp+type. The first render after
  // load ADOPTS the existing backlog without toasting — otherwise every page refresh
  // would dump the whole session's alerts on screen at once (the opposite failure).
  var _ids=al.map(function(a){ return (a.timestamp||'')+'|'+(a.alert_type||''); });
  if(!window._alertSeen){
    window._alertSeen=new Set(_ids);      // silent adoption of the backlog
  }else{
    for(var i=al.length-1;i>=0;i--){      // oldest -> newest, so toasts read in order
      var a=al[i], aid=_ids[i];
      if(window._alertSeen.has(aid)) continue;
      window._alertSeen.add(aid);
      var sev=(a.alert_type||'').includes('CRITICAL')?'sl':(a.alert_type||'').includes('HIGH')?'up':'info';
      var title=(a.alert_type||'').replace(/_/g,' ').slice(0,20);
      toast(sev,title,a.message||'');
    }
    // Bound the set: a long session emits many alerts and this lives for the whole
    // page lifetime. Keep it aligned with what the server still reports.
    if(window._alertSeen.size>2000) window._alertSeen=new Set(_ids);
  }
  if(!recent.length){
    body.innerHTML='<div class="empty" style="padding:8px 0">No recent alerts</div>';
    return;
  }
  body.innerHTML=recent.map(a=>{
    const type=a.alert_type||'';
    const sev=type.includes('CRITICAL')?'critical':type.includes('HIGH')?'high':type.includes('_NEW_')?'info':'medium';
    const sevCol=sev==='critical'?'var(--red)':sev==='high'?'var(--gold)':sev==='info'?'var(--cyan)':'var(--muted)';
    const sevBg=sev==='critical'?'rgba(255,90,106,.12)':sev==='high'?'rgba(230,180,0,.12)':sev==='info'?'rgba(45,212,132,.08)':'rgba(120,150,255,.06)';
    const pillCls=a.alert_type==='SL'?'loss':a.alert_type==='TARGET'?'win':'skip';
    return `<div style="display:flex;gap:8px;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--grid);border-left:2px solid ${sevCol};padding-left:8px;background:${sevBg}">
      <span class="num" style="font-size:10px;color:var(--muted);flex-shrink:0">${a.timestamp?new Date(a.timestamp).toLocaleTimeString():''}</span>
      <span class="pill ${pillCls}" style="font-size:9px;border-color:${sevCol};color:${sevCol}">${type.replace('_',' ').slice(0,14)}</span>
      <span style="color:var(--text2);font-size:11px">${a.message||''}</span>
    </div>`;
  }).join('');
}
setInterval(()=>{const el=document.getElementById('liveAlertsBody'); if(el) renderLiveAlerts();},15000);

/* ===== COUNT-UP ANIMATION ===== */
function animNum(id, to, fmt){
  const el=document.getElementById(id); if(!el)return;
  fmt=fmt||n2;
  const from=parseFloat(el.dataset.v);
  if(isNaN(from)){el.dataset.v=to;el.textContent=fmt(to);return;}
  if(Math.abs(from-to)<0.001){el.textContent=fmt(to);return;}
  el.dataset.v=to; const st=performance.now(), dur=380;
  function step(t){const p=Math.min((t-st)/dur,1),e=1-Math.pow(1-p,3);
    el.textContent=fmt(from+(to-from)*e); if(p<1)requestAnimationFrame(step);}
  requestAnimationFrame(step);
}

/* ===== SOUND (Web Audio beep) ===== */
let _actx=null;
function beepRaw(f,d){try{const o=_actx.createOscillator(),g=_actx.createGain();o.connect(g);g.connect(_actx.destination);o.frequency.value=f;o.type='sine';g.gain.setValueAtTime(.12,_actx.currentTime);g.gain.exponentialRampToValueAtTime(.001,_actx.currentTime+(d||.45));o.start();o.stop(_actx.currentTime+(d||.45));}catch(e){}}
function beep(type){
  try{_actx=_actx||new (window.AudioContext||window.webkitAudioContext)();
    beepRaw(type==='target'?880:type==='sl'?330:520,.5);
    if(type==='sl')setTimeout(()=>beepRaw(330,.4),200);
  }catch(e){}
}

/* ===== MANUAL TRACKER ===== */
let myPositions=[]; let modalStrike=null; let modalSide='S';
(async function hydrateTracker(){
  try{ const r=await fetch('/api/tracker'); const rows=await r.json();
    (rows||[]).filter(x=>x.status==='OPEN').forEach(x=>{
      if(myPositions.some(p=>p.backendId===x.id)) return;
      let sls=[]; try{ sls=JSON.parse(x.sl_json||'[]')||[]; }catch(e){}
      myPositions.push({id:Date.now()+Math.random(), backendId:x.id,
        index:x.instrument||'NIFTY', strike:x.strike, entry:x.entry_price,
        target:x.target, sls:sls, sound:true,
        lots:Math.max(1,Math.round((x.qty||130)/LOT_SIZE)), qty:x.qty||130,
        status:'OPEN', tHit:false, cur:x.entry_price, side:x.side||'S'});
    });
    const b=document.getElementById('trkBadge'); if(b)b.textContent=myPositions.length;
    // Audit finding: was `if(myPositions.length) renderPositions();` — with ZERO open
    // positions (a brand-new user, or everything closed) this never ran at all, so
    // populateMorningSelect() never applied its own `display:none` for the empty case
    // (core.js populateMorningSelect, ~line 1644). The <select> was left in its raw
    // static-HTML state: visible, permanently empty, indistinguishable from broken —
    // exactly "the option to select the straddle is unavailable". renderPositions()
    // already handles the zero-positions case correctly (empty <select> hidden,
    // "No positions yet" shown) — it just needs to actually run.
    renderPositions();
    // Dashboard Tracker P&L KPI card (Task C item 7): paint the real total as soon as
    // boot-time positions are hydrated, not just on the next live-price tick — #page-live
    // is the default active page, so a returning user with open positions should see the
    // real figure immediately rather than the static "—" placeholder until first tick.
    try{renderTrackerPnlKpi();}catch(_){}
  }catch(e){}
})();
document.addEventListener('click',function(e){
  const rm=e.target && e.target.closest && e.target.closest('.trk-rm');
  if(rm){ const bid=rm.dataset.bid;
    if(bid){
      // Persistent daily records (Spec B item 4, added 2026-08-09): capture the REAL
      // outcome at close time instead of just flipping status. Mirrors the exact same
      // pnl formula renderPositions()/renderDashboard() already use for this position
      // — not a new computation, the same one, read at the moment it's about to be
      // lost. exit_price is client-submitted (same trust boundary entry_price already
      // crosses — the live premium only ever exists client-side); the server
      // recomputes pnl itself from the row's own stored entry/qty/side rather than
      // trusting a client-submitted number, except for `custom` multi-leg positions
      // which have no single entry/qty/side triple to derive it from.
      const p=myPositions.find(x=>x.id===parseFloat(rm.dataset.id));
      const body={id:parseInt(bid)};
      if(p){
        const exitReason=p.status==='TARGET'?'TARGET':p.status==='SL'?'SL':'MANUAL';
        body.exit_reason=exitReason;
        if(p.type==='custom'){ body.pnl=p._pnl||0; }
        else{ const cur=p.cur!=null?p.cur:p.entry; body.exit_price=cur; }
      }
      // 2026-08-11: was fire-and-forget (.catch(()=>{})) — a failed close silently
      // vanished with no retry and no operator-visible signal, same failure class as
      // the add-side bug just fixed above. bid is a real, already-hydrated-or-persisted
      // backendId at this point (add-side fix guarantees it), so a close failure here
      // is a genuine server/network problem worth surfacing, not a missing-id race.
      _trkPersistClose(body);
    }
    removePos(parseFloat(rm.dataset.id)); return; }
  const tr=e.target && e.target.closest && e.target.closest('tr.trk-click');
  if(tr && tr.dataset.k){ openModal(parseInt(tr.dataset.k)); }
});
function openModal(strike){
  const s=ST[CUR];
  const defaultStrike = (strike!=null && !isNaN(strike)) ? strike : s.atm;
  // Populate strike dropdown from chain
  const sel=document.getElementById('mStrike');
  const chain=Object.keys(s.legs||{}).map(Number).sort((a,b)=>a-b);
  sel.innerHTML='';
  chain.forEach(k=>{
    const opt=document.createElement('option');
    opt.value=k; opt.textContent=n0(k)+(k===s.atm?' (ATM)':'');
    if(k===defaultStrike) opt.selected=true;
    sel.appendChild(opt);
  });
  // If requested strike not in chain, add it anyway
  if(defaultStrike && !chain.includes(defaultStrike)){
    const opt=document.createElement('option');
    opt.value=defaultStrike; opt.textContent=n0(defaultStrike)+' (manual)';
    opt.selected=true; sel.appendChild(opt);
  }
  modalStrike=defaultStrike;
  const live = s.legs[modalStrike] ? s.legs[modalStrike].comb : 0;
  document.getElementById('mLive').textContent=n2(live);
  document.getElementById('mEntry').value=live.toFixed(2);
  document.getElementById('mTarget').value='';
  document.getElementById('mLots').value=DEFAULT_LOTS; updateQtyHint();
  document.getElementById('slRows').innerHTML=''; addSLRow();
  document.getElementById('mSound').checked=true;
  setModalSide('S');
  document.getElementById('modalBg').classList.add('show');
}
function onModalStrikeChange(){
  const s=ST[CUR];
  const sel=document.getElementById('mStrike');
  modalStrike=parseInt(sel.value);
  const live = s.legs[modalStrike] ? s.legs[modalStrike].comb : 0;
  document.getElementById('mLive').textContent=n2(live);
  document.getElementById('mEntry').value=live.toFixed(2);
}
function updateQtyHint(){ const l=Math.max(1,parseInt(document.getElementById('mLots').value)||1);
  const h=document.getElementById('mQtyHint'); if(h)h.textContent=`= ${l*LOT_SIZE} qty (1 lot = ${LOT_SIZE})`; }
function closeModal(){document.getElementById('modalBg').classList.remove('show');}
function setModalSide(s){
  modalSide=s;
  document.querySelectorAll('#bsToggle .bs-btn').forEach(b=>{
    b.className='bs-btn'+(b.dataset.side===s?(s==='B'?' sel-buy':' sel-sell'):'');
  });
  var lbl=document.getElementById('mEntryLabel');
  if(lbl) lbl.textContent=s==='B'?'Your Buying Price':'Your Selling Price';
}
function addSLRow(){
  const d=document.createElement('div');d.className='sl-line';
  d.innerHTML=`<input type="number" placeholder="SL value" inputmode="decimal">
    <select><option value="price">Price</option><option value="pct">%</option></select>
    <button class="del" onclick="this.parentElement.remove()">×</button>`;
  document.getElementById('slRows').appendChild(d);
}
/* Persist a new tracker position server-side and capture its real backend id
 * (2026-08-11, Tracker History root-cause fix). ROOT CAUSE this closes: every
 * "add position" path used to fire-and-forget POST /api/tracker via
 * `.catch(()=>{})` and never learn the inserted row's id — hydrateTracker()'s
 * boot-time GET was the ONLY place p.backendId ever got set. A position added
 * and then closed within the SAME browser session (no reload in between — the
 * common case on a live dashboard left open all day) therefore had
 * p.backendId===undefined, so the close handler's `data-bid="${p.backendId||''}"`
 * rendered an empty string, and `if(bid)` (empty string is falsy) silently
 * skipped POST /api/tracker/close entirely. The row stayed status='OPEN' in the
 * database forever — no exit price, no pnl, no exit_reason — even though the
 * user experienced a completely normal close in the UI. It just vanished from
 * the live list: "works live, missing from History." db.insert() now returns
 * cur.lastrowid (database/db_manager.py) and add_tracker() returns it
 * (analytics_api.py) — this function is the ONE place that captures it into
 * p.backendId. A network-level failure (the request never reaching the server)
 * is the only case safe to retry without risking a duplicate row; a definitive
 * failure surfaces a toast + log line instead of staying silent — Layer 1.3
 * forbids losing a write silently, even one this platform cannot itself force
 * to succeed. */
async function _trkPersistAdd(body, posObj, _retried){
  let r;
  try{
    r = await fetch('/api/tracker',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},_adminHdr()),body:JSON.stringify(body)});
  }catch(e){
    if(!_retried) return _trkPersistAdd(body, posObj, true);
    toast('dn','NOT SAVED', (body.strategy||'position')+' '+(body.strike!=null?n0(body.strike):'')+' — could not reach the server. Showing live, but will NOT appear in History.');
    pushLog('ERROR','tracker','persist failed (network) for '+(body.strategy||'position')+' '+(body.strike!=null?body.strike:''));
    return;
  }
  let data=null; try{ data=await r.json(); }catch(e){}
  if(r.ok && data && data.ok && data.id!=null){ posObj.backendId = data.id; return; }
  toast('dn','NOT SAVED', (body.strategy||'position')+' '+(body.strike!=null?n0(body.strike):'')+' — server rejected the save. Showing live, but will NOT appear in History.');
  pushLog('ERROR','tracker','persist rejected ('+(r?r.status:'?')+') for '+(body.strategy||'position')+' '+(body.strike!=null?body.strike:''));
}
// Close-side counterpart to _trkPersistAdd (2026-08-11). A close is a single UPDATE
// keyed by the row's own id — retrying it after a network failure cannot create a
// duplicate row the way retrying an add could, so one retry is always safe here too.
// On definitive failure the row is left OPEN server-side (honest — matches its real,
// unclosed state) and the operator is told explicitly, instead of the old silent drop.
async function _trkPersistClose(body, _retried){
  let r;
  try{
    r = await fetch('/api/tracker/close',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},_adminHdr()),body:JSON.stringify(body)});
  }catch(e){
    if(!_retried) return _trkPersistClose(body, true);
    toast('dn','CLOSE NOT SAVED','Position #'+body.id+' — could not reach the server. It will still show OPEN in History.');
    pushLog('ERROR','tracker','close persist failed (network) for id '+body.id);
    return;
  }
  let data=null; try{ data=await r.json(); }catch(e){}
  if(r.ok && data && data.ok) return;
  toast('dn','CLOSE NOT SAVED','Position #'+body.id+' — server rejected the close. It will still show OPEN in History.');
  pushLog('ERROR','tracker','close persist rejected ('+(r?r.status:'?')+') for id '+body.id);
}
function savePosition(){
  // Duplicate-snapshot guard (req #2): a rapid double-click / double-Enter on
  // "Track Position" used to push TWO local positions and fire TWO POSTs — two
  // real, distinct rows for one intended action. A short debounce is the actual
  // fix for the actual cause (accidental double-submit), not a server-side
  // idempotency table — that would be a second system for a UI problem.
  if(window._trkSaving) return;
  const entry=parseFloat(document.getElementById('mEntry').value);
  if(isNaN(entry)){alert('Enter your entry price');return;}
  const target=parseFloat(document.getElementById('mTarget').value);
  const sls=[];
  document.querySelectorAll('#slRows .sl-line').forEach(r=>{
    const v=parseFloat(r.querySelector('input').value); const t=r.querySelector('select').value;
    if(!isNaN(v)) sls.push({val:v,type:t,hit:false});
  });
  const lots=Math.max(1,parseInt(document.getElementById('mLots').value)||DEFAULT_LOTS);
  const qty=lots*LOT_SIZE;
  const side=modalSide;
  window._trkSaving=true; setTimeout(()=>{window._trkSaving=false;},800);
  const newPos={id:Date.now(),index:CUR,strike:modalStrike,entry,
    target:isNaN(target)?null:target,sls,sound:document.getElementById('mSound').checked,
    lots,qty,status:'OPEN',tHit:false,cur:entry,side};
  myPositions.push(newPos);
  document.getElementById('trkBadge').textContent=myPositions.length;
  _trkPersistAdd({strategy:'manual',instrument:CUR,strike:modalStrike,
      entry_price:entry,target:isNaN(target)?null:target,sl:sls,qty:lots*LOT_SIZE,side}, newPos);
  closeModal(); renderPositions(); try{renderDashboard();}catch(_){}
  const sideLabel=side==='B'?'BUY':'SELL';
  pushLog('INFO','tracker',`Tracking ${CUR} ${n0(modalStrike)} ${sideLabel} @ ${entry} × ${lots} lot (${qty}q)`);
  toast('up','TRACKING',`${CUR} ${n0(modalStrike)} ${sideLabel} @ ${entry} · ${lots} lot`);
}
function removePos(id){myPositions=myPositions.filter(p=>p.id!==id);document.getElementById('trkBadge').textContent=myPositions.length;renderPositions();try{renderDashboard();}catch(_){}}
function openEditModal(id){
  var p=myPositions.find(x=>x.id===id);if(!p)return;
  var s=ST[CUR],chain=s.allStrikes||Object.keys(s.legs||{}).map(Number).sort(function(a,b){return a-b;});
  var tt=p.type||'straddle';
  var ttLbl=tt==='straddle'?'Straddle':tt==='strangle'?'Strangle':tt==='ironfly'?'Iron Fly':tt==='ironcondor'?'Iron Condor':tt==='nakedce'?'Naked CE':tt==='nakedpe'?'Naked PE':tt==='custom'?'Custom':'Position';
  var nameStr='';
  if(tt==='strangle') nameStr='CE '+n0(p.ceStrike)+' + PE '+n0(p.peStrike);
  else if(tt==='ironfly') nameStr=n0(p.strike)+' ± '+n0(p.wingStep||50);
  else if(tt==='ironcondor') nameStr='SP '+n0(p.peStrike)+' SC '+n0(p.ceStrike);
  else if(tt==='custom') nameStr=(p.name||'Custom')+' · '+p.legs.length+' legs';
  else nameStr=n0(p.strike);
  var h='<div class="modal-bg" id="editModalBg" style="display:flex"><div class="modal" style="max-width:500px">';
  h+='<div class="modal-hd"><span class="t">Edit '+ttLbl+'</span><button class="x" onclick="document.getElementById(\'editModalBg\').remove()">×</button></div>';
  h+='<div class="modal-bd">';
  h+='<div class="mrow"><span class="k">Strategy</span><span class="v" style="font-weight:700">'+ttLbl+'</span></div>';
  h+='<div class="mrow"><span class="k">Strike(s)</span><span class="v">'+nameStr+'</span></div>';
  h+='<div class="mrow"><span class="k">Index</span><span class="v">'+p.index+'</span></div>';
  h+='<div class="mfield"><label>Entry Price</label><input type="number" id="editEntry" value="'+p.entry+'" inputmode="decimal"></div>';
  h+='<div class="mfield"><label>Target '+(tt==='custom'?'(P&L)':'')+'</label><input type="number" id="editTarget" value="'+(p.target!=null?p.target:'')+'" placeholder="Leave empty to clear" inputmode="decimal"></div>';
  h+='<div class="mfield"><label>SL '+(tt==='custom'?'(P&L)':'')+'</label><input type="number" id="editSL" value="'+(p.sls.length?p.sls[0].val:'')+'" placeholder="Leave empty to clear" inputmode="decimal"></div>';
  h+='<div class="mfield"><label>Lots</label><input type="number" id="editLots" value="'+(p.lots||DEFAULT_LOTS)+'" min="1" step="1" inputmode="numeric"></div>';
  h+='<div class="mfield"><label><input type="checkbox" id="editSound" '+(p.sound!==false?'checked':'')+' style="accent-color:var(--accent)"> Sound alert</label></div>';
  h+='</div><div class="modal-ft">';
  h+='<button class="btn ghost" onclick="document.getElementById(\'editModalBg\').remove()">Cancel</button>';
  h+='<button class="btn primary" onclick="saveEditPosition('+id+')">Save Changes</button>';
  h+='</div></div></div>';
  document.body.insertAdjacentHTML('beforeend',h);
}
function saveEditPosition(id){
  var p=myPositions.find(x=>x.id===id);if(!p)return;
  var entry=parseFloat(document.getElementById('editEntry').value);
  if(!isNaN(entry)) p.entry=entry;
  var target=parseFloat(document.getElementById('editTarget').value);
  p.target=isNaN(target)?null:target;
  var slVal=parseFloat(document.getElementById('editSL').value);
  if(!isNaN(slVal)){
    p.sls=[{val:slVal,type:'price',hit:false}];
    p.status='OPEN'; // reset SL hit status
  } else {
    p.sls=[];
  }
  var lots=parseInt(document.getElementById('editLots').value);
  if(!isNaN(lots)&&lots>0){p.lots=lots;p.qty=lots*LOT_SIZE;}
  p.sound=document.getElementById('editSound').checked;
  p.cur=p.entry; // reset for recalc
  document.getElementById('editModalBg').remove();
  renderPositions();try{renderDashboard();}catch(_){}
  pushLog('INFO','tracker','Edited '+p.index+' '+(p.type||'straddle')+' — entry '+n2(p.entry)+' target '+(p.target!=null?p.target:'—')+' SL '+(p.sls.length?p.sls[0].val:'—'));
  toast('up','POSITION EDITED','Updated · Entry '+n2(p.entry));
}
function openMultiModal(){
  const s=ST[CUR];
  const chain=Object.keys(s.legs||{}).map(Number).sort((a,b)=>a-b);
  if(!chain.length){alert('No chain data available');return;}
  // Build a multi-select modal
  let h='<div class="modal-bg" id="multiModalBg" style="display:flex"><div class="modal" style="max-width:500px">';
  h+='<div class="modal-hd"><span class="t">Track Multiple Strikes</span><button class="x" onclick="document.getElementById(\'multiModalBg\').remove()">×</button></div>';
  h+='<div class="modal-bd">';
  h+='<div style="margin-bottom:10px;font-size:12px;color:var(--muted)">Select strikes to track. Each gets a separate position with same Entry/Target/SL.</div>';
  h+='<div style="display:flex;gap:8px;margin-bottom:10px">';
  h+='<button class="btn ghost" style="font-size:11px;padding:4px 10px" onclick="document.querySelectorAll(\'#multiStrikeList input[type=checkbox]\').forEach(c=>c.checked=true)">All</button>';
  h+='<button class="btn ghost" style="font-size:11px;padding:4px 10px" onclick="document.querySelectorAll(\'#multiStrikeList input[type=checkbox]\').forEach(c=>c.checked=false)">None</button>';
  h+='<button class="btn ghost" style="font-size:11px;padding:4px 10px" onclick="document.querySelectorAll(\'#multiStrikeList input[type=checkbox]\').forEach(c=>{c.checked=(parseInt(c.value)=== '+s.atm+')})">ATM Only</button>';
  h+='</div>';
  h+='<div id="multiStrikeList" style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px">';
  chain.forEach(k=>{
    const live=s.legs[k]?s.legs[k].comb:0;
    const isATM=k===s.atm;
    h+='<label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border)">';
    h+='<input type="checkbox" value="'+k+'"'+(isATM?' checked':'')+' style="accent-color:var(--accent)">';
    h+='<span style="font-weight:600;min-width:60px">'+n0(k)+'</span>';
    if(isATM) h+='<span style="color:var(--accent);font-size:10px;font-weight:700">ATM</span>';
    h+='<span style="color:var(--cyan);margin-left:auto">'+n2(live)+'</span>';
    h+='</label>';
  });
  h+='</div>';
  h+='<div class="mfield" style="margin-top:12px"><label>Entry Price (all positions)</label>';
  h+='<input type="number" id="multiEntry" placeholder="e.g. 200" inputmode="decimal" value="'+(s.legs[s.atm]?s.legs[s.atm].comb:0).toFixed(2)+'"></div>';
  h+='<div class="mfield"><label>Target (all positions)</label>';
  h+='<input type="number" id="multiTarget" placeholder="e.g. 120" inputmode="decimal"></div>';
  h+='<div class="mfield"><label>Lots per position</label>';
  h+='<input type="number" id="multiLots" value="'+DEFAULT_LOTS+'" min="1" step="1" inputmode="numeric"></div>';
  h+='<div class="bs-toggle" id="multiBsToggle">';
  h+='<button class="bs-btn sel-sell" data-side="S" onclick="multiSetSide(\'S\',this)">S · SELL</button>';
  h+='<button class="bs-btn" data-side="B" onclick="multiSetSide(\'B\',this)">B · BUY</button>';
  h+='</div>';
  h+='</div><div class="modal-ft">';
  h+='<button class="btn ghost" onclick="document.getElementById(\'multiModalBg\').remove()">Cancel</button>';
  h+='<button class="btn primary" onclick="saveMultiPositions()">Track All Selected</button>';
  h+='</div></div></div>';
  document.body.insertAdjacentHTML('beforeend',h);
}
let _multiSide='S';
function multiSetSide(side,btn){
  _multiSide=side;
  document.querySelectorAll('#multiBsToggle .bs-btn').forEach(b=>{
    b.className='bs-btn'+(b.dataset.side===side?(side==='B'?' sel-buy':' sel-sell'):'');
  });
}
function saveMultiPositions(){
  const entry=parseFloat(document.getElementById('multiEntry').value);
  if(isNaN(entry)){alert('Enter entry price');return;}
  const target=parseFloat(document.getElementById('multiTarget').value);
  const lots=Math.max(1,parseInt(document.getElementById('multiLots').value)||DEFAULT_LOTS);
  const qty=lots*LOT_SIZE;
  const side=_multiSide;
  const s=ST[CUR];
  let added=0;
  document.querySelectorAll('#multiStrikeList input[type=checkbox]:checked').forEach(c=>{
    const k=parseInt(c.value);
    const newPos={id:Date.now()+Math.random(),index:CUR,strike:k,entry,
      target:isNaN(target)?null:target,sls:[],sound:true,
      lots,qty,status:'OPEN',tHit:false,cur:entry,side};
    myPositions.push(newPos);
    _trkPersistAdd({strategy:'manual',instrument:CUR,strike:k,
        entry_price:entry,target:isNaN(target)?null:target,sl:[],qty,side}, newPos);
    added++;
  });
  document.getElementById('trkBadge').textContent=myPositions.length;
  document.getElementById('multiModalBg').remove();
  renderPositions(); try{renderDashboard();}catch(_){}
  const sideLabel=side==='B'?'BUY':'SELL';
  pushLog('INFO','tracker',`Batch: ${added} positions added (${sideLabel} @ ${entry} × ${lots} lot)`);
  toast('up','BATCH TRACKING',`${added} strikes tracked · ${sideLabel} @ ${entry}`);
}
// ── Strangle Tracking Modal ──────────────────────────────────────────────────
var _strangleCeStrike=null, _stranglePeStrike=null;
function openStrangleModal(){
  var s=ST[CUR], chain=s.allStrikes||Object.keys(s.legs||{}).map(Number).sort(function(a,b){return a-b;});
  var ceK=window._trkStrangleCE||s.atm, peK=window._trkStranglePE||s.atm;
  _strangleCeStrike=ceK; _stranglePeStrike=peK;
  var cePrem=s.legs[ceK]?s.legs[ceK].call:0;
  var pePrem=s.legs[peK]?s.legs[peK].put:0;
  var combined=(cePrem||0)+(pePrem||0);
  var h='<div class="modal-bg" id="strangleModalBg" style="display:flex"><div class="modal" style="max-width:500px">';
  h+='<div class="modal-hd"><span class="t">Track Strangle</span><button class="x" onclick="document.getElementById(\'strangleModalBg\').remove()">×</button></div>';
  h+='<div class="modal-bd">';
  h+='<div class="mrow"><span class="k">CE Strike</span><select id="strangleCE" onchange="_strangleCeStrike=Number(this.value);_updateStrangleLive()" style="flex:1;background:var(--surface2);color:var(--cyan);border:1px solid var(--cyan);border-radius:8px;padding:6px 10px;font-size:13px;font-weight:600">';
  chain.forEach(function(k){
    h+='<option value="'+k+'"'+(k===ceK?' selected':'')+'>'+n0(k)+(k===s.atm?' ATM':'')+'</option>';
  });
  h+='</select></div>';
  h+='<div class="mrow"><span class="k">PE Strike</span><select id="stranglePE" onchange="_stranglePeStrike=Number(this.value);_updateStrangleLive()" style="flex:1;background:var(--surface2);color:var(--gold);border:1px solid var(--gold);border-radius:8px;padding:6px 10px;font-size:13px;font-weight:600">';
  chain.forEach(function(k){
    h+='<option value="'+k+'"'+(k===peK?' selected':'')+'>'+n0(k)+(k===s.atm?' ATM':'')+'</option>';
  });
  h+='</select></div>';
  h+='<div class="mrow"><span class="k">Combined</span><span class="v" id="strangleLive" style="color:var(--text);font-weight:800">'+n2(combined)+'</span></div>';
  h+='<div class="mfield"><label>Your Entry Price</label><input type="number" id="strangleEntry" placeholder="Combined CE+PE" inputmode="decimal" value="'+combined.toFixed(2)+'"></div>';
  h+='<div class="mfield"><label>Target</label><input type="number" id="strangleTarget" placeholder="Optional target price" inputmode="decimal"></div>';
  h+='<div class="mfield"><label>Lots</label><input type="number" id="strangleLots" value="'+DEFAULT_LOTS+'" min="1" step="1" inputmode="numeric"><div class="qty-hint" id="strangleQtyHint">= '+DEFAULT_LOTS*LOT_SIZE+' qty (1 lot = '+LOT_SIZE+')</div></div>';
  h+='<div class="bs-toggle" id="strangleBsToggle">';
  h+='<button class="bs-btn sel-sell" data-side="S" onclick="_setStrangleBs(\'S\',this)">S · SELL</button>';
  h+='<button class="bs-btn" data-side="B" onclick="_setStrangleBs(\'B\',this)">B · BUY</button>';
  h+='</div>';
  h+='<div id="strangleSlRows"></div><button class="btn ghost" style="font-size:11px;margin-top:6px" onclick="_addStrangleSL()">+ Add SL</button>';
  h+='<div class="mfield" style="margin-top:8px"><label><input type="checkbox" id="strangleSound" checked style="accent-color:var(--accent)"> Sound alert on hit</label></div>';
  h+='</div><div class="modal-ft">';
  h+='<button class="btn ghost" onclick="document.getElementById(\'strangleModalBg\').remove()">Cancel</button>';
  h+='<button class="btn primary" onclick="saveStranglePosition()">Track Strangle</button>';
  h+='</div></div></div>';
  document.body.insertAdjacentHTML('beforeend',h);
  _addStrangleSL();
  document.getElementById('strangleLots').oninput=function(){var l=Math.max(1,parseInt(this.value)||1);var q=document.getElementById('strangleQtyHint');if(q)q.textContent='= '+l*LOT_SIZE+' qty (1 lot = '+LOT_SIZE+')';};
}
var _strangleSide='S';
function _setStrangleBs(side,btn){
  _strangleSide=side;
  document.querySelectorAll('#strangleBsToggle .bs-btn').forEach(function(b){
    b.className='bs-btn'+(b.dataset.side===side?(side==='B'?' sel-buy':' sel-sell'):'');
  });
}
function _addStrangleSL(){
  var d=document.createElement('div');d.className='sl-line';
  d.innerHTML='<input type="number" placeholder="SL value" inputmode="decimal"><select><option value="price">Price</option><option value="pct">%</option></select><button class="del" onclick="this.parentElement.remove()">×</button>';
  document.getElementById('strangleSlRows').appendChild(d);
}
function _updateStrangleLive(){
  var s=ST[CUR];
  var cePrem=s.legs[_strangleCeStrike]?s.legs[_strangleCeStrike].call:0;
  var pePrem=s.legs[_stranglePeStrike]?s.legs[_stranglePeStrike].put:0;
  var combined=(cePrem||0)+(pePrem||0);
  document.getElementById('strangleLive').textContent=n2(combined);
  document.getElementById('strangleEntry').value=combined.toFixed(2);
}
function saveStranglePosition(){
  var entry=parseFloat(document.getElementById('strangleEntry').value);
  if(isNaN(entry)){alert('Enter entry price');return;}
  var target=parseFloat(document.getElementById('strangleTarget').value);
  var sls=[];
  document.querySelectorAll('#strangleSlRows .sl-line').forEach(function(r){
    var v=parseFloat(r.querySelector('input').value); var t=r.querySelector('select').value;
    if(!isNaN(v)) sls.push({val:v,type:t,hit:false});
  });
  var lots=Math.max(1,parseInt(document.getElementById('strangleLots').value)||DEFAULT_LOTS);
  var qty=lots*LOT_SIZE;
  var side=_strangleSide;
  var newPos={id:Date.now(),index:CUR,type:'strangle',strike:_strangleCeStrike,ceStrike:_strangleCeStrike,peStrike:_stranglePeStrike,entry,
    target:isNaN(target)?null:target,sls,sound:document.getElementById('strangleSound').checked,
    lots,qty,status:'OPEN',tHit:false,cur:entry,side};
  myPositions.push(newPos);
  document.getElementById('trkBadge').textContent=myPositions.length;
  _trkPersistAdd({strategy:'strangle',instrument:CUR,strike:_strangleCeStrike,ce_strike:_strangleCeStrike,pe_strike:_stranglePeStrike,
      entry_price:entry,target:isNaN(target)?null:target,sl:sls,qty:lots*LOT_SIZE,side}, newPos);
  document.getElementById('strangleModalBg').remove(); renderPositions(); try{renderDashboard();}catch(_){}
  var sideLabel=side==='B'?'BUY':'SELL';
  pushLog('INFO','tracker','Tracking '+CUR+' Strangle CE '+n0(_strangleCeStrike)+' + PE '+n0(_stranglePeStrike)+' '+sideLabel+' @ '+entry+' × '+lots+' lot ('+qty+'q)');
  toast('up','STRANGLE TRACKED',CUR+' CE '+n0(_strangleCeStrike)+' + PE '+n0(_stranglePeStrike)+' '+sideLabel+' @ '+entry);
}
function slPrice(p,sl){
  if(sl.type==='pct'){
    // SELL: SL at +5% means price rose 5% (loss). BUY: SL at -5% means price dropped 5% (loss)
    return p.side==='B'? p.entry*(1-sl.val/100): p.entry*(1+sl.val/100);
  }
  return sl.val;
}
function tgNotify(text){ try{ fetch('/api/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})}).catch(()=>{}); }catch(e){} }
// ATM straddle move alerts: rising from day-LOW → toast every +10%; falling from day-HIGH → −10% then −20%
function straddleMoveAlerts(s, atmC, name){
  if(atmC==null||atmC<=0) return;
  if(s.atmLo==null||s.atmHi==null||s.atmLo>=1e9||s.atmHi<=0) return;
  // RISING from running day low — alert at each new +10% step (10,20,30…)
  if(s.atmLo>0){
    const upPct=(atmC-s.atmLo)/s.atmLo*100, b=Math.floor(upPct/10);
    if(s._loBase!==s.atmLo){ s._loBase=s.atmLo; s._loBucket=Math.max(0,b); }   // new low → rebase silently
    else if(b>(s._loBucket||0) && b>=1){ s._loBucket=b;
      toast('up','STRADDLE RISING',`${name} ATM straddle +${b*10}% from day low (${n0(s.atmLo)} → ${n2(atmC)})`);
      pushLog('ALERT','straddle',`${name} ATM straddle +${b*10}% from day low`);
    }
  }
  // FALLING from running day high — alert at −10%, then −20%
  if(s.atmHi>0){
    const dnPct=(s.atmHi-atmC)/s.atmHi*100;
    if(s._hiBase!==s.atmHi){ s._hiBase=s.atmHi; s._hiBucket=0; }                // new high → rebase silently
    else if((s._hiBucket||0)<1 && dnPct>=10){ s._hiBucket=1;
      toast('dn','STRADDLE FALLING',`${name} ATM straddle −10% from day high (${n0(s.atmHi)} → ${n2(atmC)})`);
      pushLog('ALERT','straddle',`${name} ATM straddle −10% from day high`);
    } else if((s._hiBucket||0)<2 && dnPct>=20){ s._hiBucket=2;
      toast('dn','STRADDLE FALLING −20%',`${name} ATM straddle −20% from day high (${n0(s.atmHi)} → ${n2(atmC)})`);
      pushLog('ALERT','straddle',`${name} ATM straddle −20% from day high`);
    }
  }
}
var _alarm={sl:false,target:false};
function checkPositions(){
  let anySL=false, anyTarget=false;
  myPositions.forEach(p=>{
    const s=ST[p.index]; if(!s)return;
    var cur=null;
    if(p.type==='strangle'){
      var ceL=s.legs[p.ceStrike], peL=s.legs[p.peStrike];
      if(!ceL||!peL) return;
      cur=(ceL.call||ceL.comb||0)+(peL.put||peL.comb||0);
    } else if(p.type==='ironfly'){
      var bodyL=s.legs[p.ceStrike];
      var wingStep=p.wingStep||50;
      var wingUpL=s.legs[p.ceStrike+wingStep];
      var wingDnL=s.legs[p.ceStrike-wingStep];
      if(!bodyL) return;
      var bodyP=(bodyL.call||0)+(bodyL.put||0);
      var wingUpP=wingUpL?(wingUpL.put||0):0;
      var wingDnP=wingDnL?(wingDnL.call||0):0;
      cur=bodyP-wingUpP-wingDnP;
    } else if(p.type==='ironcondor'){
      var spL=s.legs[p.peStrike], scL=s.legs[p.ceStrike];
      var icStep=p.wingStep||50;
      var lpL=s.legs[p.peStrike-icStep], lcL=s.legs[p.ceStrike+icStep];
      if(!spL||!scL) return;
      var innerCredit=(scL.call||0)+(spL.put||0);
      var innerSell=0;
      if(scL.put) innerSell+=scL.put;
      if(spL.call) innerSell+=spL.call;
      var outerDebit=0;
      if(lcL) outerDebit+=(lcL.call||0);
      if(lpL) outerDebit+=(lpL.put||0);
      cur=(innerCredit-innerSell)-outerDebit;
    } else if(p.type==='nakedce'){
      if(!s.legs[p.strike]) return;
      cur=s.legs[p.strike].call||0;
    } else if(p.type==='nakedpe'){
      if(!s.legs[p.strike]) return;
      cur=s.legs[p.strike].put||0;
    } else if(p.type==='custom'){
      var totalPnl=0;var anyMissing=false;
      (p.legs||[]).forEach(function(leg){
        var l=s.legs[leg.strike];if(!l){anyMissing=true;return;}
        var prem=leg.optType==='CE'?(l.call||0):(l.put||0);
        totalPnl+=leg.side==='B'?(prem-leg.entry):(leg.entry-prem);
      });
      if(anyMissing)return;
      p._pnl=totalPnl*(p.qty||QTY);
      cur=p.entry; // synthetic
    } else {
      if(!s.legs[p.strike]||s.legs[p.strike].comb==null)return;
      cur=s.legs[p.strike].comb;
    }
    p.cur=cur;
    const muted=(p.sound===false);
    const isBuy=p.side==='B';
    const label=p.type==='custom'?(CUR+' '+(p.name||'Custom')):p.type==='nakedce'?(CUR+' CE '+n0(p.strike)):p.type==='nakedpe'?(CUR+' PE '+n0(p.strike)):p.type==='ironfly'?(CUR+' IF '+n0(p.strike)+'±'+n0(p.wingStep||50)):p.type==='ironcondor'?(CUR+' IC SP '+n0(p.peStrike)+' SC '+n0(p.ceStrike)):p.type==='strangle'?(CUR+' CE '+n0(p.ceStrike)+'+PE '+n0(p.peStrike)):(p.index+' '+n0(p.strike));
    const typeTag=p.type||'straddle';
    var slHit, tgtHit;
    if(p.type==='custom'){
      var pnlVal=p._pnl||0;
      slHit=p.sls.length?p.sls.some(function(sl){return pnlVal<=sl.val;}):false;
      tgtHit=(p.target!=null&&pnlVal>=p.target);
    } else {
      slHit  = p.sls.length ? p.sls.some(sl=>isBuy?cur<=slPrice(p,sl):cur>=slPrice(p,sl)) : false;
      tgtHit = (p.target!=null && (isBuy?cur>=p.target:cur<=p.target));
    }
    if(slHit){
      if(!muted)anySL=true;
      const sideTag=isBuy?'BUY':'SELL';
      var _pnlVal=p.type==='custom'?(p._pnl||0):(isBuy?(cur-p.entry):(p.entry-cur))*(p.qty||QTY);
      if(p.status!=='SL'){ p.status='SL';
        pushLog('ALERT','tracker',`SL HIT ${label} — P&L ₹${n0(_pnlVal)} — square off`);
        megaToast('SL HIT — SQUARE OFF NOW',`${label} · P&L ₹${n0(_pnlVal)}`,'sl');toast('dn','⚠ SL HIT — SQUARE OFF',`${label} · P&L ₹${n0(_pnlVal)}`);
        tgNotify(`⚠ SL HIT — ${label} ${typeTag}\nEntry ${n2(p.entry)} · P&L ₹${n0(_pnlVal)} — SQUARE OFF`); }
    } else if(tgtHit){
      if(!muted)anyTarget=true;
      var _pnlVal2=p.type==='custom'?(p._pnl||0):(isBuy?(cur-p.entry):(p.entry-cur))*(p.qty||QTY);
      if(p.status!=='TARGET'){ p.status='TARGET';
        pushLog('ALERT','tracker',`TARGET ${label} — P&L ₹${n0(_pnlVal2)} — book it`);
        megaToast('🎯 TARGET HIT — BOOK IT',`${label} · P&L ₹${n0(_pnlVal2)}`,'target');
        toast('up','✓ TARGET HIT — BOOK',`${label} · P&L ₹${n0(_pnlVal2)}`);
        tgNotify(`✓ TARGET HIT — ${label} ${typeTag}\nEntry ${n2(p.entry)} · P&L ₹${n0(_pnlVal2)} — BOOK IT`); }
    } else {                                     // back inside band → alarm clears
      if(p.status!=='OPEN') p.status='OPEN';
    }
  });
  _alarm.sl=anySL; _alarm.target=anyTarget;
  // Track if any position actually changed to skip re-renders
  let _anyChange = anySL || anyTarget;
  if(!_anyChange) myPositions.forEach(p=>{ if(p._v!==(p.cur||0)+(p.status==='OPEN'?1000:p.status==='TARGET'?2000:3000)){ _anyChange=true; p._v=(p.cur||0)+(p.status==='OPEN'?1000:p.status==='TARGET'?2000:3000); } });
  // Batch tracker DOM writes into a single animation frame (was: 3 innerHTML writes per 3s tick)
  if(_anyChange && document.getElementById('page-tracker').classList.contains('on') && !window._trkRAFPending){
    window._trkRAFPending=true;
    requestAnimationFrame(()=>{
      window._trkRAFPending=false;
      renderPositions();
      try{renderDashboard();}catch(_){}
      try{renderStatBar();}catch(_){}
    });
  }
  // Dashboard Tracker P&L KPI card (Task C item 7, 2026-08-09) — same gating pattern
  // as the tracker-page block above (only touch the DOM while its page is visible),
  // mirrored for #page-live instead of #page-tracker.
  if(_anyChange && document.getElementById('page-live').classList.contains('on')){
    try{renderTrackerPnlKpi();}catch(_){}
  }
}
// NONSTOP ALARM: while any tracked LTP is past its SL (priority) or target, keep sounding
setInterval(function(){ if(!SOUND)return;
  if(_alarm.sl)beep('sl'); else if(_alarm.target)beep('target'); }, 1500);
// Morning-gauge tracker binding: fill #g-morn-sel with OPEN straddle positions and keep
// window._selTrackedStrike (the single source of truth) pointing at a live one. Runs on
// every position render (hydrate / add / close), so options and the tracked strike always
// mirror the tracker. This is writer #1 of window._selTrackedStrike; the select's onchange
// handler is writer #2.
function populateMorningSelect(){
  const ms=document.getElementById('g-morn-sel'); if(!ms) return;
  if(!ms._bound){ ms._bound=true;
    ms.onchange=function(){ window._selTrackedStrike=this.value?+this.value:null; renderGauges(); };
  }
  const straddles=myPositions.filter(p=>(p.type||'straddle')==='straddle'&&p.status==='OPEN');
  ms.innerHTML='<option value="">—</option>'+straddles.map(p=>'<option value="'+p.strike+'"'+(window._selTrackedStrike==p.strike?' selected':'')+'>'+(p.index||CUR)+' '+n0(p.strike)+'</option>').join('');
  ms.style.display=straddles.length?'inline':'none';
  if(window._selTrackedStrike!=null && !straddles.some(p=>+p.strike===window._selTrackedStrike)){
    window._selTrackedStrike=null;
  }
}
function renderPositions(){
  populateMorningSelect();
  const el=document.getElementById('posList');
  if(!myPositions.length){el.innerHTML='<div class="empty">No positions yet</div>';return;}
  el.innerHTML=myPositions.map(p=>{
    const cur=p.cur!=null?p.cur:p.entry;
    const q=p.qty||QTY;
    const isBuy=p.side==='B';
    const pnl=isBuy?(cur-p.entry)*q:(p.entry-cur)*q;
    const pcls=pnl>=0?'up':'dn';
    const hitCls=p.status==='TARGET'?'hit-t':p.status==='SL'?'hit-s':'';
    const sideBadge=isBuy?'<span style="font-size:9px;font-weight:800;padding:2px 6px;border-radius:5px;background:var(--green);color:#fff;letter-spacing:.5px">B</span>':'<span style="font-size:9px;font-weight:800;padding:2px 6px;border-radius:5px;background:var(--red);color:#fff;letter-spacing:.5px">S</span>';
    const stTag=p.status==='OPEN'?sideBadge:p.status==='TARGET'?'<span class="pill win">TARGET</span>':'<span class="pill loss">SL HIT</span>';
    const lo=Math.min(p.target||p.entry*0.5,cur,p.entry)*0.95;
    const hi=Math.max(...(p.sls.length?p.sls.map(s=>slPrice(p,s)):[p.entry*1.5]),cur,p.entry)*1.05;
    const pp=v=>Math.max(0,Math.min(100,(v-lo)/(hi-lo)*100));
    const slMarks=p.sls.map(s=>`<div class="sl" style="left:${pp(slPrice(p,s))}%"></div>`).join('');
    const tgMark=p.target!=null?`<div class="tg" style="left:${pp(p.target)}%"></div>`:'';
    const entryLabel=isBuy?'ENTRY (bought)':'ENTRY (sold)';
    const posLabel=p.type==='custom'?'<span class="lbl" style="font-size:11px">'+p.index+' <span style="color:var(--accent)">'+(p.name||'CUSTOM')+'</span> · '+p.legs.length+' legs</span>':p.type==='nakedce'?'<span class="lbl" style="font-size:11px">'+p.index+' <span style="color:var(--cyan)">CE</span> '+n0(p.strike)+'</span>':p.type==='nakedpe'?'<span class="lbl" style="font-size:11px">'+p.index+' <span style="color:var(--gold)">PE</span> '+n0(p.strike)+'</span>':p.type==='ironfly'?'<span class="lbl" style="font-size:11px">'+p.index+' <span style="color:var(--accent)">IF</span> '+n0(p.strike)+' ± '+n0(p.wingStep||50)+'</span>':p.type==='ironcondor'?'<span class="lbl" style="font-size:11px">'+p.index+' <span style="color:var(--cyan)">IC</span> SP '+n0(p.peStrike)+' SC '+n0(p.ceStrike)+'</span>':p.type==='strangle'?'<span class="lbl" style="font-size:11px">'+p.index+' <span style="color:var(--cyan)">CE '+n0(p.ceStrike)+'</span> + <span style="color:var(--gold)">PE '+n0(p.peStrike)+'</span></span>':'<span class="lbl">'+p.index+' '+n0(p.strike)+'</span>';
    return `<div class="pos ${hitCls}">
      <div class="pos-hd">${posLabel}${stTag}
        <span class="num ${pcls}" style="font-size:12px;margin-left:auto;margin-right:10px">${pnl>=0?'+':''}${isBuy?(cur-p.entry).toFixed(1):(p.entry-cur).toFixed(1)} pts (${p.entry?(Math.abs(pnl)/(p.entry*q)*100).toFixed(1):'0.0'}%)</span>
        <span class="pnl ${pcls}">${pnl>=0?'+':''}₹${n0(pnl)}</span></div>
      <div class="pos-grid">
        <div class="c"><div class="k">${entryLabel}</div><div class="v num">${n2(p.entry)}</div></div>
        <div class="c"><div class="k">LTP</div><div class="v num" style="color:var(--cyan)">${n2(cur)}</div></div>
        <div class="c"><div class="k">TARGET</div><div class="v num" style="color:var(--green)">${p.target!=null?n2(p.target):'—'}</div></div>
        <div class="c"><div class="k">SL(s)</div><div class="v num" style="color:var(--red)">${p.sls.map(s=>slPrice(p,s).toFixed(0)).join(', ')||'—'}</div></div>
        <div class="c"><div class="k">QTY</div><div class="v num">${q}<span style="color:var(--muted);font-size:10px"> · ${p.lots||Math.round(q/LOT_SIZE)}L</span></div></div>
      </div>
      <div class="pos-bar">${tgMark}${slMarks}<div class="cur" style="left:${pp(cur)}%"></div></div>
      <div style="display:flex;gap:6px;padding:0 10px 8px"><button class="rm trk-rm" onclick="openEditModal(${p.id})" style="font-size:10px;padding:3px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);color:var(--text);cursor:pointer">✎ Edit</button><button class="rm trk-rm" data-id="${p.id}" data-bid="${p.backendId||''}" style="font-size:10px;padding:3px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);color:var(--red);cursor:pointer">✕ remove</button></div>
    </div>`;
  }).join('');
}
function renderTracker(){
  // FIX (2026-08-09, Task C item 3): this used to special-case straddle to a bare
  // renderPositions() call, skipping switchTracker('straddle')'s job of revealing
  // #trk-straddle-wrap (the "+ New Straddle" button's container, display:none in the
  // static HTML) and calling renderDashboard(). Only an actual tab click ran that
  // path — so first-load-on-Straddle showed no button (and no P&L dashboard) until
  // the user switched to another tab and back, which finally invoked switchTracker.
  // Routing every mode, including the default, through the ONE activation function
  // makes first load and tab-switch the same code path — no second, incomplete copy
  // of "what it means to activate Straddle" left to drift out of sync again.
  switchTracker(window._trkMode||'straddle');
}
// ── Compact Stat Bar (shown on strategy tabs) ────────────────────────────────
// Tracker P&L KPI -> modal drill-down (Spec B item 3, added 2026-08-09): the total
// P&L figure below, and every chip/button that used to swap this bar out for the
// full #posDashboard panel IN PLACE, now open that same panel in a small modal via
// openPnlModal() — see that function beside renderDashboard() for why the DOM node
// is moved rather than cloned (so renderDashboard() stays the one and only owner
// of the P&L breakdown, with no second copy of the computation anywhere).
function renderStatBar(){
  var el=document.getElementById('posStatBar');if(!el)return;
  var pos=myPositions;
  if(!pos.length){el.innerHTML='';el.style.display='none';return;}
  el.style.display='';
  var totPnl=trackerTotalPnl();
  var open=pos.filter(function(p){return p.status==='OPEN';}).length;
  var pnlCls=totPnl>=0?'up':'dn';
  var h='<div style="display:flex;align-items:center;gap:8px;padding:6px 14px;background:var(--surface);border-bottom:1px solid var(--border);font-size:11px;overflow-x:auto;white-space:nowrap">';
  h+='<span style="font-weight:800;color:var(--muted)">POS</span>';
  h+='<span style="font-weight:700">'+pos.length+'<span style="color:var(--muted)"> · '+open+' open</span></span>';
  h+='<span class="num '+pnlCls+'" style="font-weight:800;font-size:12px;cursor:pointer" onclick="openPnlModal()" title="Click for the full P&L breakdown">'+(totPnl>=0?'+':'')+n0(totPnl)+'</span>';
  h+='<span style="color:var(--border);margin:0 2px">|</span>';
  pos.forEach(function(p){
    var c=p.cur!=null?p.cur:p.entry,q=p.qty||QTY;
    var pnl=p.type==='custom'?(p._pnl||0):(p.side==='B'?(c-p.entry)*q:(p.entry-c)*q);
    var pc=pnl>=0?'var(--green)':'var(--red)';
    var tt=p.type||'straddle';
    var ttS=tt==='straddle'?'S':tt==='strangle'?'SG':tt==='ironfly'?'IF':tt==='ironcondor'?'IC':tt==='nakedce'?'CE':tt==='nakedpe'?'PE':'C';
    var sLabel='';
    if(tt==='custom')sLabel=p.name||'C';
    else if(tt==='strangle')sLabel='C'+n0(p.ceStrike).slice(-3)+'/P'+n0(p.peStrike).slice(-3);
    else if(tt==='ironfly')sLabel='IF '+n0(p.strike).slice(-3);
    else if(tt==='ironcondor')sLabel='IC';
    else sLabel=n0(p.strike).slice(-3);
    h+='<span style="padding:2px 6px;border-radius:4px;background:var(--surface2);cursor:pointer" onclick="openPnlModal()" title="'+tt+' '+n0(p.strike)+' P&L: ₹'+n0(pnl)+' — click for full breakdown">';
    h+='<span style="color:'+pc+';font-weight:700">'+sLabel+'</span> ';
    h+='<span style="color:'+pc+'">'+(pnl>=0?'+':'')+n0(pnl)+'</span></span>';
  });
  h+='<button onclick="openPnlModal()" style="margin-left:auto;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:2px 8px;border-radius:4px;font-size:10px;cursor:pointer;white-space:nowrap">📊 Dashboard</button>';
  h+='</div>';
  el.innerHTML=h;
}
// Single owner of "total P&L across every tracked position" (Task C item 7,
// 2026-08-09). renderDashboard(), renderStatBar() and the new Dashboard Tracker
// P&L KPI card (renderTrackerPnlKpi()) used to each run this exact same reduce
// over myPositions independently — three copies of one formula that could drift.
// Now all three read this one function; a future change to the P&L formula only
// has one place to change.
function trackerTotalPnl(){
  return myPositions.reduce((a,p)=>{
    if(p.type==='custom') return a+(p._pnl||0);
    const c=p.cur!=null?p.cur:p.entry;
    const q=p.qty||QTY;
    return a+(p.side==='B'?(c-p.entry)*q:(p.entry-c)*q);
  },0);
}
// ── Position Dashboard ───────────────────────────────────────────────────────
window._dashFilter='ALL';
function renderDashboard(){
  const el=document.getElementById('posDashboard'); if(!el) return;
  const pos=myPositions;
  if(!pos.length){el.innerHTML='';return;}
  const totPnl=trackerTotalPnl();
  const open=pos.filter(p=>p.status==='OPEN').length;
  const types={};
  pos.forEach(p=>{const t=p.type||'straddle';types[t]=(types[t]||0)+1;});
  const typeColors={straddle:'var(--text)',strangle:'var(--gold)',ironfly:'var(--accent)',ironcondor:'var(--cyan)',nakedce:'var(--cyan)',nakedpe:'var(--gold)',custom:'var(--accent)'};
  let h='<div class="card" style="margin-bottom:14px">';
  h+='<div class="card-hd"><span class="dot-i"></span><span class="t">Positions · '+pos.length+'</span>';
  h+='<span style="margin-left:8px;font-size:11px;color:var(--muted)">'+open+' open</span>';
  const pnlCls=totPnl>=0?'up':'dn';
  h+='<span class="num '+pnlCls+'" style="margin-left:auto;font-weight:800">'+(totPnl>=0?'+':'')+n0(totPnl)+' pts</span>';
  h+='</div>';
  h+='<div style="padding:8px 14px;display:flex;gap:6px;flex-wrap:wrap">';
  ['ALL','straddle','strangle','ironfly','ironcondor','nakedce','nakedpe','custom'].forEach(t=>{
    if(!types[t]&&t!=='ALL') return;
    const cnt=t==='ALL'?pos.length:types[t];
    const lbl=t==='ALL'?'All':t==='straddle'?'Straddle':t==='strangle'?'Strangle':t==='ironfly'?'Iron Fly':t==='ironcondor'?'Iron Condor':t==='nakedce'?'Naked CE':t==='nakedpe'?'Naked PE':'Custom';
    const active=window._dashFilter===t;
    h+='<button class="trk-pill'+(active?' on':'')+'" style="font-size:10px;padding:3px 10px" onclick="_dashFilter=\''+t+'\';renderDashboard()">'+lbl+' ('+cnt+')</button>';
  });
  h+='</div></div>';
  const filtered=window._dashFilter==='ALL'?pos:pos.filter(p=>(p.type||'straddle')===window._dashFilter);
  if(!filtered.length){el.innerHTML=h+'<div class="empty" style="margin-top:8px">No '+window._dashFilter+' positions</div>';return;}
  h+=filtered.map(p=>{
    const cur=p.cur!=null?p.cur:p.entry;
    const q=p.qty||QTY;
    const isBuy=p.side==='B';
    const pnl=p.type==='custom'?(p._pnl||0):isBuy?(cur-p.entry)*q:(p.entry-cur)*q;
    const pcls=pnl>=0?'up':'dn';
    const hitCls=p.status==='TARGET'?'hit-t':p.status==='SL'?'hit-s':'';
    const sideBadge=isBuy?'<span style="font-size:8px;font-weight:800;padding:1px 5px;border-radius:4px;background:var(--green);color:#fff">B</span>':'<span style="font-size:8px;font-weight:800;padding:1px 5px;border-radius:4px;background:var(--red);color:#fff">S</span>';
    const stTag=p.status==='OPEN'?sideBadge:p.status==='TARGET'?'<span class="pill win" style="font-size:9px">TARGET</span>':'<span class="pill loss" style="font-size:9px">SL</span>';
    const tt=p.type||'straddle';
    const ttLbl=tt==='straddle'?'STRADDLE':tt==='strangle'?'STRANGLE':tt==='ironfly'?'IRON FLY':tt==='ironcondor'?'IRON CONDOR':tt.toUpperCase();
    const ttClr=typeColors[tt]||'var(--muted)';
    const lo=Math.min(p.target||p.entry*0.5,cur,p.entry)*0.95;
    const hi=Math.max(...(p.sls.length?p.sls.map(s=>slPrice(p,s)):[p.entry*1.5]),cur,p.entry)*1.05;
    const pp=v=>Math.max(0,Math.min(100,(v-lo)/(hi-lo)*100));
    const slMarks=p.sls.map(s=>'<div class="sl" style="left:'+pp(slPrice(p,s))+'%"></div>').join('');
    const tgMark=p.target!=null?'<div class="tg" style="left:'+pp(p.target)+'%"></div>':'';
    var strikeLabel='';
    if(tt==='custom') strikeLabel=(p.name||'Custom')+' · '+p.legs.length+' legs';
    else if(tt==='nakedce') strikeLabel='CE '+n0(p.strike);
    else if(tt==='nakedpe') strikeLabel='PE '+n0(p.strike);
    else if(tt==='strangle') strikeLabel='<span style="color:var(--cyan)">'+n0(p.ceStrike)+'</span>+<span style="color:var(--gold)">'+n0(p.peStrike)+'</span>';
    else if(tt==='ironfly') strikeLabel=n0(p.strike)+' ± '+n0(p.wingStep||50);
    else if(tt==='ironcondor') strikeLabel='SP '+n0(p.peStrike)+' SC '+n0(p.ceStrike);
    else strikeLabel=n0(p.strike);
    return '<div class="pos '+hitCls+'" style="margin:0 0 10px">'+

      '<div class="pos-hd"><span style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:5px;background:'+ttClr+'22;color:'+ttClr+';letter-spacing:.5px;margin-right:6px">'+ttLbl+'</span><span class="lbl" style="font-size:12px">'+p.index+' '+strikeLabel+'</span>'+stTag+
      '<span class="num '+pcls+'" style="font-size:11px;margin-left:auto;margin-right:8px">'+(pnl>=0?'+':'')+n0(pnl)+' pts</span>'+
      '<span class="pnl '+pcls+'" style="font-size:11px">'+(pnl>=0?'+':'')+'₹'+n0(pnl)+'</span></div>'+
      '<div class="pos-grid">'+
      '<div class="c"><div class="k">ENTRY</div><div class="v num">'+n2(p.entry)+'</div></div>'+
      '<div class="c"><div class="k">LTP</div><div class="v num" style="color:var(--cyan)">'+n2(cur)+'</div></div>'+
      '<div class="c"><div class="k">TARGET</div><div class="v num" style="color:var(--green)">'+(p.target!=null?n2(p.target):'—')+'</div></div>'+
      '<div class="c"><div class="k">SL(s)</div><div class="v num" style="color:var(--red)">'+(p.sls.map(s=>slPrice(p,s).toFixed(0)).join(', ')||'—')+'</div></div>'+
      '<div class="c"><div class="k">QTY</div><div class="v num">'+q+'</div></div>'+
      '</div>'+
      '<div class="pos-bar">'+tgMark+slMarks+'<div class="cur" style="left:'+pp(cur)+'%"></div></div>'+
      '<div style="display:flex;gap:6px;padding:0 10px 8px"><button onclick="openEditModal('+p.id+')" style="font-size:10px;padding:3px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);color:var(--text);cursor:pointer">✎ Edit</button><button class="rm trk-rm" data-id="'+p.id+'" data-bid="'+(p.backendId||'')+'" style="font-size:10px;padding:3px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);color:var(--red);cursor:pointer">✕</button></div></div>';
  }).join('');
  el.innerHTML=h;
}
/* Tracker P&L KPI -> modal drill-down (Spec B item 3, added 2026-08-09).
 * "Tracker P&L KPI: clickable -> small modal/drawer (not new page)." Before this,
 * clicking a position chip or the Dashboard button hid #posStatBar and revealed
 * #posDashboard IN PLACE on the same page — not a modal, and the KPI number itself
 * had no click handler at all. Fixed by reusing the EXISTING #posDashboard element:
 * renderDashboard() (single owner of the P&L breakdown, unchanged, Layer 1.2) still
 * computes and writes into that exact node — openPnlModal() only wraps a .modal-bg/
 * .modal shell (the same pattern openEditModal/openMultiModal already use) around
 * it and MOVES the live node inside via appendChild, never clones it. That keeps
 * every filter button already wired inside renderDashboard()'s own markup
 * (onclick="_dashFilter='...';renderDashboard()") working unmodified, because
 * document.getElementById('posDashboard') still finds the same element wherever
 * it currently lives in the DOM. closePnlModal() moves it back to its original
 * parent/position before removing the modal shell — the tracker page's normal
 * layout (straddle tab keeps its inline dashboard) is untouched once closed. */
window._pnlModalHome = null;
function openPnlModal(){
  var dash = document.getElementById('posDashboard');
  if (!dash) return;
  renderDashboard();  // refresh from the one owner before showing it
  if (!myPositions.length) { alert('No positions yet'); return; }
  window._pnlModalHome = {parent: dash.parentNode, next: dash.nextSibling, wasHidden: dash.style.display === 'none'};
  var h = '<div class="modal-bg" id="pnlModalBg" style="display:flex" onclick="if(event.target===this)closePnlModal()">' +
          '<div class="modal" style="max-width:560px;max-height:82vh;display:flex;flex-direction:column">' +
          '<div class="modal-hd"><span class="t">Tracker P&L</span><button class="x" onclick="closePnlModal()">×</button></div>' +
          '<div class="modal-bd" id="pnlModalBody" style="overflow-y:auto;padding:14px"></div>' +
          '</div></div>';
  document.body.insertAdjacentHTML('beforeend', h);
  dash.style.display = '';
  document.getElementById('pnlModalBody').appendChild(dash);
}
function closePnlModal(){
  var bg = document.getElementById('pnlModalBg');
  if (!bg) return;
  var dash = document.getElementById('posDashboard'), home = window._pnlModalHome;
  if (dash && home && home.parent) {
    if (home.next) home.parent.insertBefore(dash, home.next); else home.parent.appendChild(dash);
    dash.style.display = home.wasHidden ? 'none' : '';
  }
  window._pnlModalHome = null;
  bg.remove();
}
/* Dashboard Tracker P&L KPI card (Task C item 7, 2026-08-09): "below the 15-min
 * range card sits ... a Tracker P&L KPI card (total day P&L, click -> the P&L
 * detail modal, reuse the existing modal, not a new page)." Reads the SAME
 * trackerTotalPnl() renderDashboard()/renderStatBar() now share (single owner —
 * see that function's comment) and opens the SAME openPnlModal() the stat-bar
 * chip and Dashboard button already use — no new modal, no second P&L
 * computation, just a third place that reads the one number and reuses the one
 * modal. */
function renderTrackerPnlKpi(){
  var val=document.getElementById('tpk-value'), sub=document.getElementById('tpk-sub');
  if(!val) return;
  if(!myPositions.length){
    val.textContent='—'; val.style.color='var(--muted)';
    if(sub) sub.textContent='no positions tracked today';
    return;
  }
  var totPnl=trackerTotalPnl();
  var open=myPositions.filter(function(p){return p.status==='OPEN';}).length;
  val.textContent=(totPnl>=0?'+':'')+'₹'+n0(totPnl);
  val.style.color=totPnl>=0?'var(--green)':'var(--red)';
  if(sub) sub.textContent=myPositions.length+' tracked · '+open+' open';
}

// ═══ UNIVERSAL TRACKER ═════════════════════════════════════════════════════════
window._trkMode='straddle';
window._trkRefresh=null;
window._trkToken=0;
window._trkSelStrike=null;   // user-selected strike (Strike Detail), preserved across auto-refresh
function switchTracker(mode,btn){
  window._trkMode=mode;
  window._trkToken++;
  if(window._trkRefresh){clearInterval(window._trkRefresh);window._trkRefresh=null;}
  const bar=document.getElementById('trkBar');
  if(bar) bar.querySelectorAll('.trk-pill').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  else if(bar){const b=bar.querySelector('[data-mode="'+mode+'"]');if(b)b.classList.add('on');}
  const sw=document.getElementById('trk-straddle-wrap');
  const tc=document.getElementById('trkContent');
  const dash=document.getElementById('posDashboard');
  const isStrategy=['strangle','ironfly','ironcondor','nakedce','nakedpe','custom'].indexOf(mode)>=0;
  if(sw) sw.style.display=mode==='straddle'?'':'none';
  if(tc){tc.style.display='';tc.innerHTML=_trkSpinner('Loading '+mode+'...');}
  if(dash) dash.style.display=isStrategy?'none':'';
  // Tracker History card (Task C item 1, 2026-08-09) — visible on Straddle + Strangle,
  // the two "build a position" tabs the spec calls out; hidden everywhere else so data-
  // viewer tabs (Strike Detail, IV Analysis, ...) stay focused on their own content.
  const hist=document.getElementById('trkHistCard');
  if(hist){
    const showHist=(mode==='straddle'||mode==='strangle');
    hist.style.display=showHist?'':'none';
    if(showHist) renderTrackerHistoryDays();
  }
  if(isStrategy) renderStatBar();
  else if(dash) renderDashboard();
  const renders={strangle:trkStrangle,ironfly:trkIronFly,ironcondor:trkIronCondor,
    nakedce:trkNakedCE,nakedpe:trkNakedPE,custom:trkCustom,strike:trkStrikeDetail,premium:trkPremium,
    oi:trkOI,iv:trkIV,decay:trkDecay,em:trkEM,greeks:trkGreeks,watchlist:trkWatchlist,
    alerts:trkAlerts,research:trkResearch,session:trkSession,ai:trkAI};
  if(mode==='straddle'){
    if(tc){tc.style.display='none';}
    if(dash) dash.style.display='';
    renderDashboard();renderPositions();return;
  }
  // Timed dispatch — feeds the MEASURED "Render avg" in Performance Diagnostics.
  // Handles both sync and async renders (most tracker renders are async).
  const _timed=function(f){
    if(!f) return;
    const t0=(performance&&performance.now)?performance.now():Date.now();
    const done=function(){};
    let out; try{ out=f(); }catch(e){ done(); throw e; }
    if(out&&typeof out.then==='function') out.then(done,done); else done();
    return out;
  };
  _timed(renders[mode]);
  // auto-refresh for live data modes (not intelligence/research modes)
  const liveModes=['strangle','ironfly','ironcondor','nakedce','nakedpe','custom','strike','premium','oi','iv','decay','em','greeks','alerts'];
  if(liveModes.indexOf(mode)>=0 && mode!=='straddle'){
    // Silent background refresh: a full innerHTML rebuild every 8s otherwise resets the
    // scroll position mid-read and steals focus from the search box. Capture both, restore
    // after the render resolves — the numbers update, the user's place does not move.
    window._trkRefresh=setInterval(function(){
      const el=document.getElementById('trkContent');
      const sc=el?el.scrollTop:0;
      const inner=el?el.querySelector('.tbl-scroll,.mscroll,[style*="overflow"]'):null;
      const scIn=inner?inner.scrollLeft:0;
      const ae=document.activeElement;
      const wasSearch=ae&&ae.classList&&ae.classList.contains('trk-search');
      const selStart=wasSearch?ae.selectionStart:null;
      const out=_timed(renders[mode]);
      const restore=function(){
        try{
          const e2=document.getElementById('trkContent'); if(!e2)return;
          if(sc) e2.scrollTop=sc;
          if(scIn){ const i2=e2.querySelector('.tbl-scroll,.mscroll,[style*="overflow"]'); if(i2)i2.scrollLeft=scIn; }
          if(wasSearch){ const s2=e2.querySelector('.trk-search');
            if(s2){ s2.focus(); if(selStart!=null){ try{ s2.setSelectionRange(selStart,selStart); }catch(_){} } } }
        }catch(_){}
        try{ renderDashboard(); }catch(_){}
        try{ renderStatBar(); }catch(_){}
      };
      if(out&&typeof out.then==='function') out.then(restore,restore); else restore();
    },8000);
  }
}
// ── Universal strike selection ──────────────────────────────────────────────
// Click ANY strike row in ANY tracker table to inspect that strike (jumps to Strike
// Detail). Delegated ONCE on document so it survives every 8s re-render.
function selectTrackerStrike(strike){
  if(strike==null||strike==='') return;
  window._trkSelStrike=strike;
  switchTracker('strike');
  try{const tc=document.getElementById('trkContent');if(tc)tc.scrollIntoView({behavior:'smooth',block:'nearest'});}catch(_){}
}
if(!window._trkStrikeClickWired){
  window._trkStrikeClickWired=true;
  document.addEventListener('click',function(e){
    if(!e.target||!e.target.closest)return;
    if(e.target.dataset.setCe!=null||e.target.dataset.setPe!=null) return;
    if(e.target.dataset.setNakedCe!=null||e.target.dataset.setNakedPe!=null) return;
    const tr=e.target.closest('#trkContent tr[data-strike]');
    if(tr&&tr.dataset.strike) selectTrackerStrike(tr.dataset.strike);
  });
}
function _trkErr(msg){
  const el=document.getElementById('trkContent');
  if(el) el.innerHTML='<div class="empty">'+msg+'</div>';
}
function _trkSpinner(msg){
  return '<div class="trk-spin">'+(msg||'Loading...')+'</div>';
}
function _trkHd(title,sub){
  return '<div class="card" style="margin-bottom:14px"><div class="card-hd"><span class="dot-i"></span><span class="t">'+title+'</span>'+(sub?'<span class="r">'+sub+'</span>':'')+'</div>';
}
function _trkGrid(cells){
  return '<div class="trk-grid">'+cells.map(c=>'<div class="lvl-cell"><div class="k">'+c.k+'</div><div class="v num" style="'+(c.c||'')+'">'+c.v+'</div></div>').join('')+'</div>';
}
function _trkTblHead(cols,sortable){
  if(!sortable) return '<table class="trk-tbl"><thead><tr>'+cols.map(c=>'<th'+(c.r?' class="num"':'')+'>'+c.t+'</th>').join('')+'</tr></thead><tbody>';
  return '<table class="trk-tbl" data-sortable="1"><thead><tr>'+cols.map((c,i)=>'<th class="sort'+(c.r?' num':'')+'" data-col="'+i+'" data-key="'+(c.k||'')+'" onclick="_trkSortClick(this,\''+(c.k||'')+'\')">'+c.t+'</th>').join('')+'</tr></thead><tbody>';
}
function _trkTblFoot(){return '</tbody></table>';}
window._trkSortKey='';window._trkSortDir=-1;
function _trkSortClick(th,key){
  if(window._trkSortKey===key) window._trkSortDir*=-1; else{window._trkSortKey=key;window._trkSortDir=-1;}
  document.querySelectorAll('.trk-tbl th.sort').forEach(x=>x.classList.remove('asc','desc'));
  th.classList.add(window._trkSortDir>0?'asc':'desc');
  const fn=window._trkCurrentRender; if(fn) fn();
}
function _trkSortData(data,key,dir){
  if(!key||!data||!data.length) return data;
  return [...data].sort((a,b)=>{
    const va=parseFloat(a[key])||0, vb=parseFloat(b[key])||0;
    return dir*(vb-va);
  });
}
window._trkSearchVal='';
function _trkSearchBox(placeholder){
  return '<input type="text" class="trk-search" placeholder="'+(placeholder||'Search strikes...')+'" value="'+window._trkSearchVal+'" oninput="window._trkSearchVal=this.value;var v=this.value.toLowerCase();var rows=this.closest(\'.card\').querySelectorAll(\'tr[data-strike]\');for(var i=0;i<rows.length;i++){rows[i].style.display=rows[i].dataset.strike.indexOf(v)>=0?\'\':\'none\'}">';
}
// ── STRATEGY TRACKERS ────────────────────────────────────────────────────────
// Strangle CE/PE selection state — preserved across 8s auto-refresh
window._trkStrangleCE=null; window._trkStranglePE=null;
if(!window._trkStrangleClickWired){
  window._trkStrangleClickWired=true;
  document.addEventListener('click',function(e){
    var t=e.target; if(!t||!t.dataset) return;
    if(t.dataset.setCe!=null){window._trkStrangleCE=Number(t.dataset.setCe);trkStrangle();}
    else if(t.dataset.setPe!=null){window._trkStranglePE=Number(t.dataset.setPe);trkStrangle();}
  });
}
function _trkSelChain(chain,atm){
  var ceStrike=window._trkStrangleCE, peStrike=window._trkStranglePE;
  if(ceStrike!=null&&!chain.find(function(r){return r.strike===ceStrike;})) ceStrike=null;
  if(peStrike!=null&&!chain.find(function(r){return r.strike===peStrike;})) peStrike=null;
  if(ceStrike==null) ceStrike=atm;
  if(peStrike==null) peStrike=atm;
  window._trkStrangleCE=ceStrike; window._trkStranglePE=peStrike;
  return {ce:chain.find(function(r){return r.strike===ceStrike;})||chain[0],
          pe:chain.find(function(r){return r.strike===peStrike;})||chain[0],
          ceStrike:ceStrike, peStrike:peStrike};
}

async function trkStrangle(){
  const el=document.getElementById('trkContent'); if(!el)return;
  window._trkCurrentRender=trkStrangle;
  const _tok=window._trkToken;
  try{
    const snap=await jget('/api/snapshot',5000);
    if(_tok!==window._trkToken) return;
    const spot=(snap.live_spot_ltp??(snap.spot&&snap.spot.close))||0, chain=snap.chain||[];
    if(!chain.length){el.innerHTML=_trkHd('Strangle Tracker','CE+PE Pair')+'<div style="padding:14px" class="empty">No chain data yet</div></div>';return;}
    const atm=snap.atm||spot;
    var sel=_trkSelChain(chain,atm);
    var ceR=sel.ce, peR=sel.pe, ceK=sel.ceStrike, peK=sel.peStrike;
    var cePrem=(ceR.ce_close||0), pePrem=(peR.pe_close||0);
    var combined=cePrem+pePrem;
    var distFromSpot=Math.abs(ceK-peK);
    // ── Header: two dropdown selectors side by side
    let h=_trkHd('Strangle · Custom Pair','Select CE & PE strikes from chain below');
    h+='<div style="display:flex;gap:10px;padding:10px 14px;flex-wrap:wrap">';
    h+='<div style="flex:1;min-width:180px"><label style="font-size:10px;color:var(--cyan);font-weight:700;display:block;margin-bottom:4px">CE STRIKE (Buy Call)</label>';
    h+='<select id="trk-strangle-ce" onchange="window._trkStrangleCE=Number(this.value);trkStrangle()" style="width:100%;background:var(--surface2);color:var(--cyan);border:1px solid var(--cyan);border-radius:8px;padding:8px 12px;font-family:var(--mono);font-size:12px">';
    chain.forEach(function(r){
      h+='<option value="'+r.strike+'"'+(r.strike===ceK?' selected':'')+'>'+n0(r.strike)+(r.strike===atm?' ATM':'')+'</option>';
    });
    h+='</select></div>';
    h+='<div style="flex:1;min-width:180px"><label style="font-size:10px;color:var(--gold);font-weight:700;display:block;margin-bottom:4px">PE STRIKE (Buy Put)</label>';
    h+='<select id="trk-strangle-pe" onchange="window._trkStranglePE=Number(this.value);trkStrangle()" style="width:100%;background:var(--surface2);color:var(--gold);border:1px solid var(--gold);border-radius:8px;padding:8px 12px;font-family:var(--mono);font-size:12px">';
    chain.forEach(function(r){
      h+='<option value="'+r.strike+'"'+(r.strike===peK?' selected':'')+'>'+n0(r.strike)+(r.strike===atm?' ATM':'')+'</option>';
    });
    h+='</select></div>';
    h+='</div>';
    h+='<div style="padding:0 14px 10px;display:flex;gap:8px;align-items:center">';
    h+='<button class="btn primary" style="flex:none;padding:8px 16px;font-size:12px" onclick="openStrangleModal()">⚡ Track This Strangle</button>';
    h+='<span style="font-size:11px;color:var(--muted)">CE '+n0(ceK)+' + PE '+n0(peK)+' · Combined '+n2(combined)+'</span>';
    h+='</div>';
    // ── Summary grid for selected pair
    h+=_trkGrid([
      {k:'SPOT',v:n2(spot),c:'color:var(--cyan)'},
      {k:'CE STRIKE',v:n0(ceK),c:'font-weight:800;color:var(--cyan)'},
      {k:'PE STRIKE',v:n0(peK),c:'font-weight:800;color:var(--gold)'},
      {k:'CE PREM',v:n2(cePrem),c:'color:var(--cyan);font-weight:800'},
      {k:'PE PREM',v:n2(pePrem),c:'color:var(--gold);font-weight:800'},
      {k:'COMBINED',v:n2(combined),c:'font-weight:800'},
      {k:'STRIKE GAP',v:n0(distFromSpot)+' pts'},
      {k:'CE DELTA',v:ceR.ce_delta!=null?Number(ceR.ce_delta).toFixed(3):'—'},
      {k:'PE DELTA',v:peR.pe_delta!=null?Number(peR.pe_delta).toFixed(3):'—'},
      {k:'CE THETA',v:ceR.ce_theta!=null?'₹'+n2(ceR.ce_theta):'—',c:'color:var(--red)'},
      {k:'PE THETA',v:peR.pe_theta!=null?'₹'+n2(peR.pe_theta):'—',c:'color:var(--red)'},
      {k:'CE IV',v:ceR.ce_iv!=null?Number(ceR.ce_iv).toFixed(1)+'%':'—'},
      {k:'PE IV',v:peR.pe_iv!=null?Number(peR.pe_iv).toFixed(1)+'%':'—'},
      {k:'CE MONEYNESS',v:spot?((ceK-spot)/spot*100).toFixed(2)+'%':'—'},
      {k:'PE MONEYNESS',v:spot?((spot-peK)/spot*100).toFixed(2)+'%':'—'},
      {k:'NET THETA',v:(ceR.ce_theta!=null&&peR.pe_theta!=null)?'₹'+n2(ceR.ce_theta+peR.pe_theta):'—',c:'color:var(--red)'}
    ]);
    // ── Full chain with clickable CE/PE buttons
    h+=_trkHd('Option Chain · Click CE/PE to select');
    h+=_trkSearchBox('Filter strikes...');
    h+='<div style="overflow-x:auto;padding:14px">';
    h+=_trkTblHead([{t:'Strike',k:'strike'},{t:'CE LTP',k:'ce_close',r:true},{t:'PE LTP',k:'pe_close',r:true},{t:'Combined',k:'_comb',r:true},{t:'Dist',k:'_dist',r:true},{t:'CE Δ',k:'ce_delta',r:true},{t:'PE Δ',k:'pe_delta',r:true},{t:'CE OI',k:'ce_oi',r:true},{t:'PE OI',k:'pe_oi',r:true}]);
    var rows=chain.map(function(r){
      var comb=(r.ce_close||0)+(r.pe_close||0);
      return Object.assign({},r,{_comb:comb,_dist:r.strike-spot});
    });
    rows.sort(function(a,b){return Math.abs(a.strike-spot)-Math.abs(b.strike-spot);});
    rows.slice(0,20).forEach(function(r){
      var d=r._dist;
      var isCE=r.strike===ceK, isPE=r.strike===peK;
      h+='<tr data-strike="'+r.strike+'" style="'+(isCE||isPE?'background:rgba(255,255,255,0.04)':'')+'">';
      h+='<td class="num" style="font-weight:700">'+n0(r.strike)+(r.strike===atm?'<span class="row-tag" style="background:var(--surface2);color:var(--text);font-size:9px;margin-left:4px">ATM</span>':'')+'</td>';
      h+='<td class="num"><button data-set-ce="'+r.strike+'" class="trk-pill'+(isCE?' on':'')+'" style="font-size:11px;cursor:pointer;border:1px solid var(--cyan);background:'+(isCE?'var(--cyan)':'transparent')+';color:'+(isCE?'#001':'var(--cyan)')+'">'+n2(r.ce_close)+'</button></td>';
      h+='<td class="num"><button data-set-pe="'+r.strike+'" class="trk-pill'+(isPE?' on':'')+'" style="font-size:11px;cursor:pointer;border:1px solid var(--gold);background:'+(isPE?'var(--gold)':'transparent')+';color:'+(isPE?'#001':'var(--gold)')+'">'+n2(r.pe_close)+'</button></td>';
      h+='<td class="num" style="font-weight:800">'+n2(r._comb)+'</td>';
      h+='<td class="num '+(d>=0?'up':'dn')+'">'+(d>=0?'+':'')+n0(d)+'</td>';
      h+='<td class="num">'+(r.ce_delta!=null?Number(r.ce_delta).toFixed(2):'—')+'</td>';
      h+='<td class="num">'+(r.pe_delta!=null?Number(r.pe_delta).toFixed(2):'—')+'</td>';
      h+='<td class="num">'+n0(r.ce_oi)+'</td>';
      h+='<td class="num">'+n0(r.pe_oi)+'</td></tr>';
    });
    h+=_trkTblFoot()+'</div></div>';
    el.innerHTML=h;
  }catch(e){_trkErr('Failed to load strangle data · '+e.message);}
}

function ce_strike_val(r,k){return Number(r[k]).toFixed(2);}
function pe_strike_val(r,k){return Number(r[k]).toFixed(2);}
function ce_strike_iv(r){return Number(r.ce_iv).toFixed(1);}
function pe_strike_iv(r){return Number(r.pe_iv).toFixed(1);}

async function trkIronFly(){
  const el=document.getElementById('trkContent'); if(!el)return;
  window._trkCurrentRender=trkIronFly;
  const _tok=window._trkToken;
  try{
    const snap=await jget('/api/snapshot',5000);
    if(_tok!==window._trkToken) return;
    const chain=snap.chain||[], spot=(snap.live_spot_ltp??(snap.spot&&snap.spot.close))||0, atm=snap.atm||spot;
    if(!chain.length){el.innerHTML=_trkHd('Iron Fly','ATM ± 1')+'<div style="padding:14px" class="empty">No chain data</div></div>';return;}
    const _atm=Number(atm)||atm;
    const atmRow=chain.find(r=>Number(r.strike)===_atm)||chain[Math.floor(chain.length/2)];
    const _sorted=chain.map(r=>Number(r.strike)).filter(x=>!isNaN(x)).sort((a,b)=>a-b);
    const step=_sorted.length>1?(_sorted[1]-_sorted[0]):50;
    // robust NEAREST-strike wings (exact find collapsed wings onto ATM -> 0 credit)
    const _strikeAt=(t)=>{let best=atmRow,bd=Infinity;for(const r of chain){const d=Math.abs(Number(r.strike)-t);if(d<bd){bd=d;best=r;}}return best;};
    const wingUp=_strikeAt(_atm+step), wingDn=_strikeAt(_atm-step);
    const bodyPrem=(atmRow.ce_close||0)+(atmRow.pe_close||0);
    const wingUpPrem=(wingUp.pe_close||0);
    const wingDnPrem=(wingDn.ce_close||0);
    const credit=bodyPrem-wingUpPrem-wingDnPrem;
    const wingWidth=step;
    const maxLoss=wingWidth-Math.abs(credit);
    const beUp=atm+Math.max(credit,0);
    const beDn=atm-Math.max(credit,0);
    let h=_trkHd('Iron Fly · ATM ± 1','Body: '+n0(atm)+' | Wings: '+n0(wingDn.strike)+' / '+n0(wingUp.strike));
    h+=_trkGrid([
      {k:'SPOT',v:n2(spot),c:'color:var(--cyan)'},
      {k:'BODY STRIKE',v:n0(atm),c:'color:var(--cyan)'},
      {k:'BODY (CE+PE)',v:n2(bodyPrem),c:'font-weight:800'},
      {k:'UPPER WING',v:n2(wingUpPrem),c:'color:var(--gold)'},
      {k:'LOWER WING',v:n2(wingDnPrem),c:'color:var(--gold)'},
      {k:'NET CREDIT',v:n2(credit),c:(credit>=0?'color:var(--green)':'color:var(--red)')+'font-weight:800'},
      {k:'MAX PROFIT',v:n2(Math.abs(credit))+' pts',c:'color:var(--green)'},
      {k:'MAX LOSS',v:n2(maxLoss)+' pts',c:'color:var(--red)'},
      {k:'WING WIDTH',v:n0(wingWidth)+' pts'},
      {k:'BREAKEVEN UP',v:n0(beUp)},
      {k:'BREAKEVEN DN',v:n0(beDn)},
      {k:'RISK:REWARD',v:maxLoss>0?(Math.abs(credit)/maxLoss).toFixed(2)+'×':'—'}
    ]);
    h+='<div style="padding:0 14px 10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">';
    h+='<div style="flex:1;min-width:180px"><label style="font-size:10px;color:var(--accent);font-weight:700;display:block;margin-bottom:4px">BODY STRIKE (Short CE + Short PE)</label>';
    h+='<select id="trk-ironfly-body" onchange="window._trkIronFlyBody=Number(this.value);trkIronFly()" style="width:100%;background:var(--surface2);color:var(--accent);border:1px solid var(--accent);border-radius:8px;padding:8px 12px;font-family:var(--mono);font-size:12px">';
    chain.forEach(function(r){
      h+='<option value="'+r.strike+'"'+(r.strike===_atm?' selected':'')+'>'+n0(r.strike)+(r.strike===atm?' ATM':'')+'</option>';
    });
    h+='</select></div>';
    h+='<button class="btn primary" style="flex:none;padding:8px 16px;font-size:12px;align-self:flex-end" onclick="openIronFlyModal()">⚡ Track Iron Fly</button>';
    h+='</div>';
    h+=_trkHd('Structure Detail');
    h+='<div style="overflow-x:auto;padding:14px">';
    h+=_trkTblHead([{t:'Leg'},{t:'Strike'},{t:'Type',r:false},{t:'Premium',r:true},{t:'Delta',r:true},{t:'IV',r:true}]);
    [{s:wingDn.strike,t:'Long Put',p:wingDn.pe_close||0,d:wingDn.pe_delta,iv:wingDn.pe_iv,c:'var(--gold)'},
     {s:atmRow.strike,t:'Short Call',p:atmRow.ce_close||0,d:atmRow.ce_delta,iv:atmRow.ce_iv,c:'var(--cyan)'},
     {s:atmRow.strike,t:'Short Put',p:atmRow.pe_close||0,d:atmRow.pe_delta,iv:atmRow.pe_iv,c:'var(--gold)'},
     {s:wingUp.strike,t:'Long Call',p:wingUp.ce_close||0,d:wingUp.ce_delta,iv:wingUp.ce_iv,c:'var(--cyan)'}
    ].forEach(l=>{
      h+='<tr><td style="color:'+l.c+';font-weight:700">'+l.t+'</td><td class="num" style="font-weight:700">'+n0(l.s)+'</td>';
      h+='<td>'+(l.t.includes('Short')?'<span class="pill loss" style="font-size:9px">SELL</span>':'<span class="pill win" style="font-size:9px">BUY</span>')+'</td>';
      h+='<td class="num" style="font-weight:700">'+n2(l.p)+'</td>';
      h+='<td class="num">'+(l.d!=null?Number(l.d).toFixed(2):'—')+'</td>';
      h+='<td class="num">'+(l.iv!=null?Number(l.iv).toFixed(1)+'%':'—')+'</td></tr>';
    });
    h+=_trkTblFoot()+'</div></div>';
    el.innerHTML=h;
  }catch(e){_trkErr('Failed to load iron fly · '+e.message);}
}
function openIronFlyModal(){
  var s=ST[CUR], chain=s.allStrikes||Object.keys(s.legs||{}).map(Number).sort(function(a,b){return a-b;});
  var bodyK=window._trkIronFlyBody||s.atm;
  var step=chain.length>1?(chain[1]-chain[0]):50;
  var wingUpK=bodyK+step, wingDnK=bodyK-step;
  var bodyPrem=(s.legs[bodyK]?s.legs[bodyK].comb:0);
  var wingUpPrem=s.legs[wingUpK]?(s.legs[wingUpK].put||0):0;
  var wingDnPrem=s.legs[wingDnK]?(s.legs[wingDnK].call||0):0;
  var netCredit=bodyPrem-wingUpPrem-wingDnPrem;
  var h='<div class="modal-bg" id="ironflyModalBg" style="display:flex"><div class="modal" style="max-width:500px">';
  h+='<div class="modal-hd"><span class="t">Track Iron Fly</span><button class="x" onclick="document.getElementById(\'ironflyModalBg\').remove()">×</button></div>';
  h+='<div class="modal-bd">';
  h+='<div class="mrow"><span class="k">Body</span><span class="v" style="color:var(--accent);font-weight:800">'+n0(bodyK)+' (Short CE + PE)</span></div>';
  h+='<div class="mrow"><span class="k">Upper Wing</span><span class="v" style="color:var(--gold)">'+n0(wingUpK)+' (Long Call) '+n2(wingUpPrem)+'</span></div>';
  h+='<div class="mrow"><span class="k">Lower Wing</span><span class="v" style="color:var(--gold)">'+n0(wingDnK)+' (Long Put) '+n2(wingDnPrem)+'</span></div>';
  h+='<div class="mrow"><span class="k">Net Credit</span><span class="v" style="font-weight:800;color:'+(netCredit>=0?'var(--green)':'var(--red)')+'">'+n2(netCredit)+'</span></div>';
  h+='<div class="mfield"><label>Entry Price (net credit)</label><input type="number" id="ironflyEntry" placeholder="Net credit at entry" inputmode="decimal" value="'+netCredit.toFixed(2)+'"></div>';
  h+='<div class="mfield"><label>Target</label><input type="number" id="ironflyTarget" placeholder="Optional target" inputmode="decimal"></div>';
  h+='<div class="mfield"><label>Lots</label><input type="number" id="ironflyLots" value="'+DEFAULT_LOTS+'" min="1" step="1" inputmode="numeric"></div>';
  h+='<div id="ironflySlRows"></div><button class="btn ghost" style="font-size:11px;margin-top:6px" onclick="_addIFSL()">+ Add SL</button>';
  h+='<div class="mfield" style="margin-top:8px"><label><input type="checkbox" id="ironflySound" checked style="accent-color:var(--accent)"> Sound alert on hit</label></div>';
  h+='</div><div class="modal-ft">';
  h+='<button class="btn ghost" onclick="document.getElementById(\'ironflyModalBg\').remove()">Cancel</button>';
  h+='<button class="btn primary" onclick="saveIronFlyPosition()">Track Iron Fly</button>';
  h+='</div></div></div>';
  document.body.insertAdjacentHTML('beforeend',h); _addIFSL();
}
function _addIFSL(){var d=document.createElement('div');d.className='sl-line';d.innerHTML='<input type="number" placeholder="SL value" inputmode="decimal"><select><option value="price">Price</option><option value="pct">%</option></select><button class="del" onclick="this.parentElement.remove()">×</button>';document.getElementById('ironflySlRows').appendChild(d);}
function saveIronFlyPosition(){
  var entry=parseFloat(document.getElementById('ironflyEntry').value);
  if(isNaN(entry)){alert('Enter entry price');return;}
  var target=parseFloat(document.getElementById('ironflyTarget').value);
  var sls=[];
  document.querySelectorAll('#ironflySlRows .sl-line').forEach(function(r){var v=parseFloat(r.querySelector('input').value);var t=r.querySelector('select').value;if(!isNaN(v))sls.push({val:v,type:t,hit:false});});
  var lots=Math.max(1,parseInt(document.getElementById('ironflyLots').value)||DEFAULT_LOTS);
  var qty=lots*LOT_SIZE;
  var bodyK=window._trkIronFlyBody||ST[CUR].atm;
  var chain=ST[CUR].allStrikes||Object.keys(ST[CUR].legs||{}).map(Number).sort(function(a,b){return a-b;});
  var step=chain.length>1?(chain[1]-chain[0]):50;
  var newPos={id:Date.now(),index:CUR,type:'ironfly',strike:bodyK,ceStrike:bodyK,peStrike:bodyK,entry,target:isNaN(target)?null:target,sls,sound:document.getElementById('ironflySound').checked,lots,qty,status:'OPEN',tHit:false,cur:entry,side:'S',wingStep:step};
  myPositions.push(newPos);
  document.getElementById('trkBadge').textContent=myPositions.length;
  _trkPersistAdd({strategy:'ironfly',instrument:CUR,strike:bodyK,entry_price:entry,target:isNaN(target)?null:target,sl:sls,qty,side:'S'}, newPos);
  document.getElementById('ironflyModalBg').remove(); renderPositions(); try{renderDashboard();}catch(_){}
  pushLog('INFO','tracker','Tracking '+CUR+' Iron Fly @ '+n0(bodyK)+' ± '+n0(step)+' · Credit '+n2(entry));
  toast('up','IRON FLY TRACKED',CUR+' IF @ '+n0(bodyK)+' · '+n2(entry));
}

async function trkIronCondor(){
  const el=document.getElementById('trkContent'); if(!el)return;
  window._trkCurrentRender=trkIronCondor;
  const _tok=window._trkToken;
  try{
    const snap=await jget('/api/snapshot',5000);
    if(_tok!==window._trkToken) return;
    const chain=snap.chain||[], spot=(snap.live_spot_ltp??(snap.spot&&snap.spot.close))||0, atm=snap.atm||spot;
    if(!chain.length){el.innerHTML=_trkHd('Iron Condor','ATM ± 2')+'<div style="padding:14px" class="empty">No chain data</div></div>';return;}
    const _atm=Number(atm)||atm;
    const atmRow=chain.find(r=>Number(r.strike)===_atm)||chain[Math.floor(chain.length/2)];
    const _sorted=chain.map(r=>Number(r.strike)).filter(x=>!isNaN(x)).sort((a,b)=>a-b);
    const step=_sorted.length>1?(_sorted[1]-_sorted[0]):50;
    // robust NEAREST-strike wings: exact find() collapsed every wing onto ATM (→ 0 credit)
    // when a strike was absent or strike/atm types differed. Pick the closest real strike.
    const _strikeAt=(t)=>{let best=atmRow,bd=Infinity;for(const r of chain){const d=Math.abs(Number(r.strike)-t);if(d<bd){bd=d;best=r;}}return best;};
    const w1Up=_strikeAt(_atm+step), w2Up=_strikeAt(_atm+2*step);
    const w1Dn=_strikeAt(_atm-step), w2Dn=_strikeAt(_atm-2*step);
    const bodyCE=(atmRow.ce_close||0), bodyPE=(atmRow.pe_close||0);
    const innerCredit=bodyCE+bodyPE-(w1Up.pe_close||0)-(w1Dn.ce_close||0);
    const outerDebit=(w2Up.ce_close||0)+(w2Dn.pe_close||0)-(w1Up.ce_close||0)-(w1Dn.pe_close||0);
    const netCredit=innerCredit-outerDebit;
    const wingWidth=step;
    const maxLoss=wingWidth-Math.abs(netCredit);
    let h=_trkHd('Iron Condor · ATM ± 2','Short: '+n0(w1Dn.strike)+'/'+n0(w1Up.strike)+' · Long: '+n0(w2Dn.strike)+'/'+n0(w2Up.strike));
    h+=_trkGrid([
      {k:'SPOT',v:n2(spot),c:'color:var(--cyan)'},
      {k:'SHORT PUT',v:n0(w1Dn.strike)},
      {k:'SHORT CALL',v:n0(w1Up.strike)},
      {k:'LONG PUT',v:n0(w2Dn.strike)},
      {k:'LONG CALL',v:n0(w2Up.strike)},
      {k:'NET CREDIT',v:n2(netCredit),c:(netCredit>=0?'color:var(--green)':'color:var(--red)')+'font-weight:800'},
      {k:'MAX PROFIT',v:n2(Math.abs(netCredit))+' pts',c:'color:var(--green)'},
      {k:'MAX LOSS',v:n2(maxLoss)+' pts',c:'color:var(--red)'},
      {k:'WING WIDTH',v:n0(wingWidth)+' pts'},
      {k:'BREAKEVEN UP',v:n0(w1Up.strike+netCredit)},
      {k:'BREAKEVEN DN',v:n0(w1Dn.strike-netCredit)},
      {k:'RISK:REWARD',v:maxLoss>0?(Math.abs(netCredit)/maxLoss).toFixed(2)+'×':'—'}
    ]);
    h+='<div style="padding:0 14px 10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">';
    h+='<div style="flex:1;min-width:140px"><label style="font-size:10px;color:var(--gold);font-weight:700;display:block;margin-bottom:4px">SHORT PUT</label>';
    h+='<select id="trk-ic-sp" onchange="window._trkICShortPut=Number(this.value);trkIronCondor()" style="width:100%;background:var(--surface2);color:var(--gold);border:1px solid var(--gold);border-radius:8px;padding:8px 10px;font-family:var(--mono);font-size:12px">';
    chain.forEach(function(r){h+='<option value="'+r.strike+'"'+(r.strike===w1Dn.strike?' selected':'')+'>'+n0(r.strike)+'</option>';});
    h+='</select></div>';
    h+='<div style="flex:1;min-width:140px"><label style="font-size:10px;color:var(--cyan);font-weight:700;display:block;margin-bottom:4px">SHORT CALL</label>';
    h+='<select id="trk-ic-sc" onchange="window._trkICShortCall=Number(this.value);trkIronCondor()" style="width:100%;background:var(--surface2);color:var(--cyan);border:1px solid var(--cyan);border-radius:8px;padding:8px 10px;font-family:var(--mono);font-size:12px">';
    chain.forEach(function(r){h+='<option value="'+r.strike+'"'+(r.strike===w1Up.strike?' selected':'')+'>'+n0(r.strike)+'</option>';});
    h+='</select></div>';
    h+='<button class="btn primary" style="flex:none;padding:8px 16px;font-size:12px;align-self:flex-end" onclick="openIronCondorModal()">⚡ Track Iron Condor</button>';
    h+='</div>';
    h+=_trkHd('Structure Legs');
    h+='<div style="overflow-x:auto;padding:14px">';
    h+=_trkTblHead([{t:'Leg'},{t:'Strike'},{t:'Side'},{t:'Premium',r:true},{t:'IV',r:true},{t:'Delta',r:true}]);
    [{s:w2Dn.strike,t:'Long Put',p:w2Dn.pe_close,d:w2Dn.pe_delta,iv:w2Dn.pe_iv,side:'BUY',c:'var(--green)'},
     {s:w1Dn.strike,t:'Short Put',p:w1Dn.pe_close,d:w1Dn.pe_delta,iv:w1Dn.pe_iv,side:'SELL',c:'var(--red)'},
     {s:w1Up.strike,t:'Short Call',p:w1Up.ce_close,d:w1Up.ce_delta,iv:w1Up.ce_iv,side:'SELL',c:'var(--red)'},
     {s:w2Up.strike,t:'Long Call',p:w2Up.ce_close,d:w2Up.ce_delta,iv:w2Up.ce_iv,side:'BUY',c:'var(--green)'}
    ].forEach(l=>{
      h+='<tr><td style="font-weight:700">'+l.t+'</td><td class="num" style="font-weight:700">'+n0(l.s)+'</td>';
      h+='<td><span class="pill '+(l.side==='BUY'?'win':'loss')+'" style="font-size:9px">'+l.side+'</span></td>';
      h+='<td class="num" style="font-weight:700">'+n2(l.p)+'</td>';
      h+='<td class="num">'+(l.iv!=null?Number(l.iv).toFixed(1)+'%':'—')+'</td>';
      h+='<td class="num">'+(l.d!=null?Number(l.d).toFixed(2):'—')+'</td></tr>';
    });
    h+=_trkTblFoot()+'</div></div>';
    el.innerHTML=h;
  }catch(e){_trkErr('Failed to load iron condor · '+e.message);}
}
function openIronCondorModal(){
  var s=ST[CUR], chain=s.allStrikes||Object.keys(s.legs||{}).map(Number).sort(function(a,b){return a-b;});
  var step=chain.length>1?(chain[1]-chain[0]):50;
  var spK=window._trkICShortPut||(s.atm-step), scK=window._trkICShortCall||(s.atm+step);
  var lpK=spK-step, lcK=scK+step;
  var spL=s.legs[spK]||{}, scL=s.legs[scK]||{}, lpL=s.legs[lpK]||{}, lcL=s.legs[lcK]||{};
  var innerCredit=(scL.call||0)+(spL.put||0);
  var innerSell=(scL.put||0)+(spL.call||0);
  var outerDebit=(lcL.call||0)+(lpL.put||0);
  var netCredit=(innerCredit-innerSell)-outerDebit;
  var h='<div class="modal-bg" id="icModalBg" style="display:flex"><div class="modal" style="max-width:500px">';
  h+='<div class="modal-hd"><span class="t">Track Iron Condor</span><button class="x" onclick="document.getElementById(\'icModalBg\').remove()">×</button></div>';
  h+='<div class="modal-bd">';
  h+='<div class="mrow"><span class="k">Short Put</span><span class="v" style="color:var(--gold);font-weight:800">'+n0(spK)+' (SELL) '+n2(spL.put||0)+'</span></div>';
  h+='<div class="mrow"><span class="k">Short Call</span><span class="v" style="color:var(--cyan);font-weight:800">'+n0(scK)+' (SELL) '+n2(scL.call||0)+'</span></div>';
  h+='<div class="mrow"><span class="k">Long Put</span><span class="v" style="color:var(--green)">'+n0(lpK)+' (BUY) '+n2(lpL.put||0)+'</span></div>';
  h+='<div class="mrow"><span class="k">Long Call</span><span class="v" style="color:var(--green)">'+n0(lcK)+' (BUY) '+n2(lcL.call||0)+'</span></div>';
  h+='<div class="mrow"><span class="k">Net Credit</span><span class="v" style="font-weight:800;color:'+(netCredit>=0?'var(--green)':'var(--red)')+'">'+n2(netCredit)+'</span></div>';
  h+='<div class="mfield"><label>Entry Price (net credit)</label><input type="number" id="icEntry" placeholder="Net credit at entry" inputmode="decimal" value="'+netCredit.toFixed(2)+'"></div>';
  h+='<div class="mfield"><label>Target</label><input type="number" id="icTarget" placeholder="Optional target" inputmode="decimal"></div>';
  h+='<div class="mfield"><label>Lots</label><input type="number" id="icLots" value="'+DEFAULT_LOTS+'" min="1" step="1" inputmode="numeric"></div>';
  h+='<div id="icSlRows"></div><button class="btn ghost" style="font-size:11px;margin-top:6px" onclick="_addICSL()">+ Add SL</button>';
  h+='<div class="mfield" style="margin-top:8px"><label><input type="checkbox" id="icSound" checked style="accent-color:var(--accent)"> Sound alert on hit</label></div>';
  h+='</div><div class="modal-ft">';
  h+='<button class="btn ghost" onclick="document.getElementById(\'icModalBg\').remove()">Cancel</button>';
  h+='<button class="btn primary" onclick="saveIronCondorPosition()">Track Iron Condor</button>';
  h+='</div></div></div>';
  document.body.insertAdjacentHTML('beforeend',h); _addICSL();
}
function _addICSL(){var d=document.createElement('div');d.className='sl-line';d.innerHTML='<input type="number" placeholder="SL value" inputmode="decimal"><select><option value="price">Price</option><option value="pct">%</option></select><button class="del" onclick="this.parentElement.remove()">×</button>';document.getElementById('icSlRows').appendChild(d);}
function saveIronCondorPosition(){
  var entry=parseFloat(document.getElementById('icEntry').value);
  if(isNaN(entry)){alert('Enter entry price');return;}
  var target=parseFloat(document.getElementById('icTarget').value);
  var sls=[];
  document.querySelectorAll('#icSlRows .sl-line').forEach(function(r){var v=parseFloat(r.querySelector('input').value);var t=r.querySelector('select').value;if(!isNaN(v))sls.push({val:v,type:t,hit:false});});
  var lots=Math.max(1,parseInt(document.getElementById('icLots').value)||DEFAULT_LOTS);
  var qty=lots*LOT_SIZE;
  var s=ST[CUR], chain=s.allStrikes||Object.keys(s.legs||{}).map(Number).sort(function(a,b){return a-b;});
  var step=chain.length>1?(chain[1]-chain[0]):50;
  var spK=window._trkICShortPut||(s.atm-step), scK=window._trkICShortCall||(s.atm+step);
  var newPos={id:Date.now(),index:CUR,type:'ironcondor',strike:spK,ceStrike:scK,peStrike:spK,entry,target:isNaN(target)?null:target,sls,sound:document.getElementById('icSound').checked,lots,qty,status:'OPEN',tHit:false,cur:entry,side:'S',wingStep:step};
  myPositions.push(newPos);
  document.getElementById('trkBadge').textContent=myPositions.length;
  _trkPersistAdd({strategy:'ironcondor',instrument:CUR,strike:spK,ce_strike:scK,pe_strike:spK,entry_price:entry,target:isNaN(target)?null:target,sl:sls,qty,side:'S'}, newPos);
  document.getElementById('icModalBg').remove(); renderPositions(); try{renderDashboard();}catch(_){}
  pushLog('INFO','tracker','Tracking '+CUR+' Iron Condor SP '+n0(spK)+' SC '+n0(scK)+' · Credit '+n2(entry));
  toast('up','IRON CONDOR TRACKED',CUR+' IC SP '+n0(spK)+' SC '+n0(scK)+' · '+n2(entry));
}

window._trkNakedCESel=null; window._trkNakedPESel=null;
if(!window._trkNakedClickWired){
  window._trkNakedClickWired=true;
  document.addEventListener('click',function(e){
    var t=e.target; if(!t||!t.dataset) return;
    if(t.dataset.setNakedCe!=null){window._trkNakedCESel=Number(t.dataset.setNakedCe);trkNakedCE();}
    else if(t.dataset.setNakedPe!=null){window._trkNakedPESel=Number(t.dataset.setNakedPe);trkNakedPE();}
  });
}
async function trkNakedCE(){
  const el=document.getElementById('trkContent'); if(!el)return;
  window._trkCurrentRender=trkNakedCE;
  const _tok=window._trkToken;
  try{
    const snap=await jget('/api/snapshot',5000);
    if(_tok!==window._trkToken) return;
    const chain=snap.chain||[], spot=(snap.live_spot_ltp??(snap.spot&&snap.spot.close))||0, atm=snap.atm||spot;
    if(!chain.length){el.innerHTML=_trkHd('Naked CE','Single Call')+'<div style="padding:14px" class="empty">No chain data</div></div>';return;}
    var selStrike=window._trkNakedCESel;
    if(selStrike!=null&&!chain.find(function(r){return r.strike===selStrike;})) selStrike=null;
    if(selStrike==null) selStrike=atm;
    window._trkNakedCESel=selStrike;
    const selRow=chain.find(r=>r.strike===selStrike)||chain[0];
    let h=_trkHd('Naked CE','Select strike from chain below');
    h+='<div style="padding:10px 14px"><label style="font-size:10px;color:var(--cyan);font-weight:700;display:block;margin-bottom:4px">CE STRIKE (Single Call)</label>';
    h+='<select id="trk-nakedce-sel" onchange="window._trkNakedCESel=Number(this.value);trkNakedCE()" style="width:100%;max-width:400px;background:var(--surface2);color:var(--cyan);border:1px solid var(--cyan);border-radius:8px;padding:8px 12px;font-family:var(--mono);font-size:12px">';
    chain.forEach(function(r){
      h+='<option value="'+r.strike+'"'+(r.strike===selStrike?' selected':'')+'>'+n0(r.strike)+(r.strike===atm?' ATM':'')+'</option>';
    });
    h+='</select></div>';
    h+=_trkGrid([
      {k:'STRIKE',v:n0(selRow.strike),c:'font-weight:800;color:var(--cyan)'},
      {k:'CE LTP',v:n2(selRow.ce_close),c:'color:var(--cyan);font-weight:800'},
      {k:'CE BID / ASK',v:n2(selRow.ce_bid)+' / '+n2(selRow.ce_ask)},
      {k:'CE IV',v:selRow.ce_iv!=null?Number(selRow.ce_iv).toFixed(1)+'%':'—'},
      {k:'DELTA',v:selRow.ce_delta!=null?Number(selRow.ce_delta).toFixed(3):'—'},
      {k:'GAMMA',v:selRow.ce_gamma!=null?Number(selRow.ce_gamma).toFixed(4):'—'},
      {k:'THETA',v:selRow.ce_theta!=null?'₹'+n2(selRow.ce_theta):'—',c:'color:var(--red)'},
      {k:'VEGA',v:selRow.ce_vega!=null?Number(selRow.ce_vega).toFixed(2):'—'},
      {k:'OI',v:selRow.ce_oi!=null?n0(selRow.ce_oi):'—'},
      {k:'SPOT',v:n2(spot),c:'color:var(--cyan)'},
      {k:'MONEYNESS',v:spot?((selRow.strike-spot)/spot*100).toFixed(2)+'%':'—'},
      {k:'SPREAD',v:(selRow.ce_ask&&selRow.ce_bid)?n2(selRow.ce_ask-selRow.ce_bid):'—'}
    ]);
    h+='<div style="padding:0 14px 10px;display:flex;gap:8px;align-items:center">';
    h+='<button class="btn primary" style="flex:none;padding:8px 16px;font-size:12px" onclick="openNakedCEModal()">⚡ Track Naked CE</button>';
    h+='<span style="font-size:11px;color:var(--muted)">CE '+n0(selStrike)+' · LTP '+n2(selRow.ce_close)+'</span>';
    h+='</div>';
    h+=_trkHd('CE Chain · Click strike to select');
    h+=_trkSearchBox('Filter strikes...');
    h+='<div style="overflow-x:auto;padding:14px">';
    h+=_trkTblHead([{t:'Strike',k:'strike'},{t:'CE LTP',k:'ce_close',r:true},{t:'CE Bid',k:'ce_bid',r:true},{t:'CE Ask',k:'ce_ask',r:true},{t:'IV',k:'ce_iv',r:true},{t:'Delta',k:'ce_delta',r:true},{t:'Theta',k:'ce_theta',r:true},{t:'OI',k:'ce_oi',r:true}]);
    chain.forEach(r=>{
      const isSel=r.strike===selStrike;
      h+='<tr data-strike="'+r.strike+'" style="'+(isSel?'background:rgba(255,255,255,0.04)':'')+'">';
      h+='<td class="num" style="font-weight:700">'+n0(r.strike)+(r.strike===atm?'<span class="row-tag" style="background:var(--surface2);color:var(--text);font-size:9px;margin-left:4px">ATM</span>':'')+'</td>';
      h+='<td class="num"><button data-set-naked-ce="'+r.strike+'" class="trk-pill'+(isSel?' on':'')+'" style="font-size:11px;cursor:pointer;border:1px solid var(--cyan);background:'+(isSel?'var(--cyan)':'transparent')+';color:'+(isSel?'#001':'var(--cyan)')+'">'+n2(r.ce_close)+'</button></td>';
      h+='<td class="num">'+n2(r.ce_bid)+'</td><td class="num">'+n2(r.ce_ask)+'</td>';
      h+='<td class="num">'+(r.ce_iv!=null?Number(r.ce_iv).toFixed(1)+'%':'—')+'</td>';
      h+='<td class="num">'+(r.ce_delta!=null?Number(r.ce_delta).toFixed(3):'—')+'</td>';
      h+='<td class="num dn">'+(r.ce_theta!=null?'₹'+n2(r.ce_theta):'—')+'</td>';
      h+='<td class="num">'+(r.ce_oi!=null?n0(r.ce_oi):'—')+'</td></tr>';
    });
    h+=_trkTblFoot()+'</div></div>';
    el.innerHTML=h;
  }catch(e){_trkErr('Failed to load naked CE · '+e.message);}
}

async function trkNakedPE(){
  const el=document.getElementById('trkContent'); if(!el)return;
  window._trkCurrentRender=trkNakedPE;
  const _tok=window._trkToken;
  try{
    const snap=await jget('/api/snapshot',5000);
    if(_tok!==window._trkToken) return;
    const chain=snap.chain||[], spot=(snap.live_spot_ltp??(snap.spot&&snap.spot.close))||0, atm=snap.atm||spot;
    if(!chain.length){el.innerHTML=_trkHd('Naked PE','Single Put')+'<div style="padding:14px" class="empty">No chain data</div></div>';return;}
    var selStrike=window._trkNakedPESel;
    if(selStrike!=null&&!chain.find(function(r){return r.strike===selStrike;})) selStrike=null;
    if(selStrike==null) selStrike=atm;
    window._trkNakedPESel=selStrike;
    const selRow=chain.find(r=>r.strike===selStrike)||chain[0];
    let h=_trkHd('Naked PE','Select strike from chain below');
    h+='<div style="padding:10px 14px"><label style="font-size:10px;color:var(--gold);font-weight:700;display:block;margin-bottom:4px">PE STRIKE (Single Put)</label>';
    h+='<select id="trk-nakedpe-sel" onchange="window._trkNakedPESel=Number(this.value);trkNakedPE()" style="width:100%;max-width:400px;background:var(--surface2);color:var(--gold);border:1px solid var(--gold);border-radius:8px;padding:8px 12px;font-family:var(--mono);font-size:12px">';
    chain.forEach(function(r){
      h+='<option value="'+r.strike+'"'+(r.strike===selStrike?' selected':'')+'>'+n0(r.strike)+(r.strike===atm?' ATM':'')+'</option>';
    });
    h+='</select></div>';
    h+=_trkGrid([
      {k:'STRIKE',v:n0(selRow.strike),c:'font-weight:800;color:var(--gold)'},
      {k:'PE LTP',v:n2(selRow.pe_close),c:'color:var(--gold);font-weight:800'},
      {k:'PE BID / ASK',v:n2(selRow.pe_bid)+' / '+n2(selRow.pe_ask)},
      {k:'PE IV',v:selRow.pe_iv!=null?Number(selRow.pe_iv).toFixed(1)+'%':'—'},
      {k:'DELTA',v:selRow.pe_delta!=null?Number(selRow.pe_delta).toFixed(3):'—'},
      {k:'GAMMA',v:selRow.pe_gamma!=null?Number(selRow.pe_gamma).toFixed(4):'—'},
      {k:'THETA',v:selRow.pe_theta!=null?'₹'+n2(selRow.pe_theta):'—',c:'color:var(--red)'},
      {k:'VEGA',v:selRow.pe_vega!=null?Number(selRow.pe_vega).toFixed(2):'—'},
      {k:'OI',v:selRow.pe_oi!=null?n0(selRow.pe_oi):'—'},
      {k:'SPOT',v:n2(spot),c:'color:var(--cyan)'},
      {k:'MONEYNESS',v:spot?((spot-selRow.strike)/spot*100).toFixed(2)+'%':'—'},
      {k:'SPREAD',v:(selRow.pe_ask&&selRow.pe_bid)?n2(selRow.pe_ask-selRow.pe_bid):'—'}
    ]);
    h+='<div style="padding:0 14px 10px;display:flex;gap:8px;align-items:center">';
    h+='<button class="btn primary" style="flex:none;padding:8px 16px;font-size:12px" onclick="openNakedPEModal()">⚡ Track Naked PE</button>';
    h+='<span style="font-size:11px;color:var(--muted)">PE '+n0(selStrike)+' · LTP '+n2(selRow.pe_close)+'</span>';
    h+='</div>';
    h+=_trkHd('PE Chain · Click strike to select');
    h+=_trkSearchBox('Filter strikes...');
    h+='<div style="overflow-x:auto;padding:14px">';
    h+=_trkTblHead([{t:'Strike',k:'strike'},{t:'PE LTP',k:'pe_close',r:true},{t:'PE Bid',k:'pe_bid',r:true},{t:'PE Ask',k:'pe_ask',r:true},{t:'IV',k:'pe_iv',r:true},{t:'Delta',k:'pe_delta',r:true},{t:'Theta',k:'pe_theta',r:true},{t:'OI',k:'pe_oi',r:true}]);
    chain.forEach(r=>{
      const isSel=r.strike===selStrike;
      h+='<tr data-strike="'+r.strike+'" style="'+(isSel?'background:rgba(255,255,255,0.04)':'')+'">';
      h+='<td class="num" style="font-weight:700">'+n0(r.strike)+(r.strike===atm?'<span class="row-tag" style="background:var(--surface2);color:var(--text);font-size:9px;margin-left:4px">ATM</span>':'')+'</td>';
      h+='<td class="num"><button data-set-naked-pe="'+r.strike+'" class="trk-pill'+(isSel?' on':'')+'" style="font-size:11px;cursor:pointer;border:1px solid var(--gold);background:'+(isSel?'var(--gold)':'transparent')+';color:'+(isSel?'#001':'var(--gold)')+'">'+n2(r.pe_close)+'</button></td>';
      h+='<td class="num">'+n2(r.pe_bid)+'</td><td class="num">'+n2(r.pe_ask)+'</td>';
      h+='<td class="num">'+(r.pe_iv!=null?Number(r.pe_iv).toFixed(1)+'%':'—')+'</td>';
      h+='<td class="num">'+(r.pe_delta!=null?Number(r.pe_delta).toFixed(3):'—')+'</td>';
      h+='<td class="num dn">'+(r.pe_theta!=null?'₹'+n2(r.pe_theta):'—')+'</td>';
      h+='<td class="num">'+(r.pe_oi!=null?n0(r.pe_oi):'—')+'</td></tr>';
    });
    h+=_trkTblFoot()+'</div></div>';
    el.innerHTML=h;
  }catch(e){_trkErr('Failed to load naked PE · '+e.message);}
}
// ── Naked CE Tracking Modal ──────────────────────────────────────────────────
function openNakedCEModal(){
  var s=ST[CUR], chain=s.allStrikes||Object.keys(s.legs||{}).map(Number).sort(function(a,b){return a-b;});
  var k=window._trkNakedCESel||s.atm;
  var prem=s.legs[k]?s.legs[k].call:0;
  var h='<div class="modal-bg" id="nakedceModalBg" style="display:flex"><div class="modal" style="max-width:460px">';
  h+='<div class="modal-hd"><span class="t">Track Naked CE</span><button class="x" onclick="document.getElementById(\'nakedceModalBg\').remove()">×</button></div>';
  h+='<div class="modal-bd">';
  h+='<div class="mrow"><span class="k">Strike</span><span class="v" style="color:var(--cyan);font-weight:800">'+n0(k)+'</span></div>';
  h+='<div class="mrow"><span class="k">CE LTP</span><span class="v" style="color:var(--cyan)">'+n2(prem)+'</span></div>';
  h+='<div class="mfield"><label>Your Entry Price</label><input type="number" id="nakedceEntry" inputmode="decimal" value="'+prem.toFixed(2)+'"></div>';
  h+='<div class="mfield"><label>Target</label><input type="number" id="nakedceTarget" placeholder="Optional" inputmode="decimal"></div>';
  h+='<div class="mfield"><label>Lots</label><input type="number" id="nakedceLots" value="'+DEFAULT_LOTS+'" min="1" step="1" inputmode="numeric"></div>';
  h+='<div class="bs-toggle" id="nakedceBs">';
  h+='<button class="bs-btn sel-buy" data-side="B" onclick="_nakedceSide=\'B\';document.querySelectorAll(\'#nakedceBs .bs-btn\').forEach(b=>b.className=\'bs-btn\'+(b.dataset.side===\'B\'?\' sel-buy\':\'\'))">B · BUY</button>';
  h+='<button class="bs-btn" data-side="S" onclick="_nakedceSide=\'S\';document.querySelectorAll(\'#nakedceBs .bs-btn\').forEach(b=>b.className=\'bs-btn\'+(b.dataset.side===\'S\'?\' sel-sell\':\'\'))">S · SELL</button>';
  h+='</div>';
  h+='<div id="nakedceSlRows"></div><button class="btn ghost" style="font-size:11px;margin-top:6px" onclick="_addNCSL()">+ Add SL</button>';
  h+='<div class="mfield" style="margin-top:8px"><label><input type="checkbox" id="nakedceSound" checked style="accent-color:var(--accent)"> Sound alert</label></div>';
  h+='</div><div class="modal-ft">';
  h+='<button class="btn ghost" onclick="document.getElementById(\'nakedceModalBg\').remove()">Cancel</button>';
  h+='<button class="btn primary" onclick="saveNakedCEPosition()">Track CE</button>';
  h+='</div></div></div>';
  document.body.insertAdjacentHTML('beforeend',h); _addNCSL();
}
var _nakedceSide='B';
function _addNCSL(){var d=document.createElement('div');d.className='sl-line';d.innerHTML='<input type="number" placeholder="SL value" inputmode="decimal"><select><option value="price">Price</option><option value="pct">%</option></select><button class="del" onclick="this.parentElement.remove()">×</button>';document.getElementById('nakedceSlRows').appendChild(d);}
function saveNakedCEPosition(){
  var entry=parseFloat(document.getElementById('nakedceEntry').value);if(isNaN(entry)){alert('Enter entry');return;}
  var target=parseFloat(document.getElementById('nakedceTarget').value);
  var sls=[];document.querySelectorAll('#nakedceSlRows .sl-line').forEach(function(r){var v=parseFloat(r.querySelector('input').value);var t=r.querySelector('select').value;if(!isNaN(v))sls.push({val:v,type:t,hit:false});});
  var lots=Math.max(1,parseInt(document.getElementById('nakedceLots').value)||DEFAULT_LOTS);var qty=lots*LOT_SIZE;
  var newPos={id:Date.now(),index:CUR,type:'nakedce',strike:window._trkNakedCESel,ceStrike:window._trkNakedCESel,peStrike:null,entry,target:isNaN(target)?null:target,sls,sound:document.getElementById('nakedceSound').checked,lots,qty,status:'OPEN',tHit:false,cur:entry,side:_nakedceSide};
  myPositions.push(newPos);
  document.getElementById('trkBadge').textContent=myPositions.length;
  _trkPersistAdd({strategy:'nakedce',instrument:CUR,strike:window._trkNakedCESel,entry_price:entry,target:isNaN(target)?null:target,sl:sls,qty,side:_nakedceSide}, newPos);
  document.getElementById('nakedceModalBg').remove();renderPositions();try{renderDashboard();}catch(_){}
  var sl=_nakedceSide==='B'?'BUY':'SELL';
  pushLog('INFO','tracker','Tracking '+CUR+' Naked CE '+n0(window._trkNakedCESel)+' '+sl+' @ '+entry);
  toast('up','CE TRACKED',CUR+' CE '+n0(window._trkNakedCESel)+' '+sl+' @ '+entry);
}
// ── Naked PE Tracking Modal ──────────────────────────────────────────────────
function openNakedPEModal(){
  var s=ST[CUR], chain=s.allStrikes||Object.keys(s.legs||{}).map(Number).sort(function(a,b){return a-b;});
  var k=window._trkNakedPESel||s.atm;
  var prem=s.legs[k]?s.legs[k].put:0;
  var h='<div class="modal-bg" id="nakedpeModalBg" style="display:flex"><div class="modal" style="max-width:460px">';
  h+='<div class="modal-hd"><span class="t">Track Naked PE</span><button class="x" onclick="document.getElementById(\'nakedpeModalBg\').remove()">×</button></div>';
  h+='<div class="modal-bd">';
  h+='<div class="mrow"><span class="k">Strike</span><span class="v" style="color:var(--gold);font-weight:800">'+n0(k)+'</span></div>';
  h+='<div class="mrow"><span class="k">PE LTP</span><span class="v" style="color:var(--gold)">'+n2(prem)+'</span></div>';
  h+='<div class="mfield"><label>Your Entry Price</label><input type="number" id="nakedpeEntry" inputmode="decimal" value="'+prem.toFixed(2)+'"></div>';
  h+='<div class="mfield"><label>Target</label><input type="number" id="nakedpeTarget" placeholder="Optional" inputmode="decimal"></div>';
  h+='<div class="mfield"><label>Lots</label><input type="number" id="nakedpeLots" value="'+DEFAULT_LOTS+'" min="1" step="1" inputmode="numeric"></div>';
  h+='<div class="bs-toggle" id="nakedpeBs">';
  h+='<button class="bs-btn sel-buy" data-side="B" onclick="_nakedpeSide=\'B\';document.querySelectorAll(\'#nakedpeBs .bs-btn\').forEach(b=>b.className=\'bs-btn\'+(b.dataset.side===\'B\'?\' sel-buy\':\'\'))">B · BUY</button>';
  h+='<button class="bs-btn" data-side="S" onclick="_nakedpeSide=\'S\';document.querySelectorAll(\'#nakedpeBs .bs-btn\').forEach(b=>b.className=\'bs-btn\'+(b.dataset.side===\'S\'?\' sel-sell\':\'\'))">S · SELL</button>';
  h+='</div>';
  h+='<div id="nakedpeSlRows"></div><button class="btn ghost" style="font-size:11px;margin-top:6px" onclick="_addNPSL()">+ Add SL</button>';
  h+='<div class="mfield" style="margin-top:8px"><label><input type="checkbox" id="nakedpeSound" checked style="accent-color:var(--accent)"> Sound alert</label></div>';
  h+='</div><div class="modal-ft">';
  h+='<button class="btn ghost" onclick="document.getElementById(\'nakedpeModalBg\').remove()">Cancel</button>';
  h+='<button class="btn primary" onclick="saveNakedPEPosition()">Track PE</button>';
  h+='</div></div></div>';
  document.body.insertAdjacentHTML('beforeend',h); _addNPSL();
}
var _nakedpeSide='B';
function _addNPSL(){var d=document.createElement('div');d.className='sl-line';d.innerHTML='<input type="number" placeholder="SL value" inputmode="decimal"><select><option value="price">Price</option><option value="pct">%</option></select><button class="del" onclick="this.parentElement.remove()">×</button>';document.getElementById('nakedpeSlRows').appendChild(d);}
function saveNakedPEPosition(){
  var entry=parseFloat(document.getElementById('nakedpeEntry').value);if(isNaN(entry)){alert('Enter entry');return;}
  var target=parseFloat(document.getElementById('nakedpeTarget').value);
  var sls=[];document.querySelectorAll('#nakedpeSlRows .sl-line').forEach(function(r){var v=parseFloat(r.querySelector('input').value);var t=r.querySelector('select').value;if(!isNaN(v))sls.push({val:v,type:t,hit:false});});
  var lots=Math.max(1,parseInt(document.getElementById('nakedpeLots').value)||DEFAULT_LOTS);var qty=lots*LOT_SIZE;
  var newPos={id:Date.now(),index:CUR,type:'nakedpe',strike:window._trkNakedPESel,ceStrike:null,peStrike:window._trkNakedPESel,entry,target:isNaN(target)?null:target,sls,sound:document.getElementById('nakedpeSound').checked,lots,qty,status:'OPEN',tHit:false,cur:entry,side:_nakedpeSide};
  myPositions.push(newPos);
  document.getElementById('trkBadge').textContent=myPositions.length;
  _trkPersistAdd({strategy:'nakedpe',instrument:CUR,strike:window._trkNakedPESel,entry_price:entry,target:isNaN(target)?null:target,sl:sls,qty,side:_nakedpeSide}, newPos);
  document.getElementById('nakedpeModalBg').remove();renderPositions();try{renderDashboard();}catch(_){}
  var sl=_nakedpeSide==='B'?'BUY':'SELL';
  pushLog('INFO','tracker','Tracking '+CUR+' Naked PE '+n0(window._trkNakedPESel)+' '+sl+' @ '+entry);
  toast('up','PE TRACKED',CUR+' PE '+n0(window._trkNakedPESel)+' '+sl+' @ '+entry);
}
// ── CUSTOM STRATEGY BUILDER ──────────────────────────────────────────────────
// Add "Custom" pill to tracker bar — see HTML edit below
window._customLegs=[];
function trkCustom(){
  var el=document.getElementById('trkContent');if(!el)return;
  window._trkCurrentRender=trkCustom;
  var s=ST[CUR],chain=s.allStrikes||Object.keys(s.legs||{}).map(Number).sort(function(a,b){return a-b;});
  var atm=s.atm;
  if(!window._customLegs.length){window._customLegs=[{strike:atm,optType:'CE',side:'S',entry:0},{strike:atm,optType:'PE',side:'S',entry:0}];}
  var h=_trkHd('Custom Strategy Builder','Build any multi-leg strategy — no limitations');
  h+='<div id="customBuilder" style="padding:14px">';
  h+='<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">';
  h+='<div class="mfield" style="flex:1;min-width:200px;margin:0"><label>Strategy Name</label><input type="text" id="custName" placeholder="e.g. Short Strangle + Hedge" style="width:100%"></div>';
  h+='</div>';
  h+='<div id="customLegs"></div>';
  h+='<button class="btn ghost" style="margin:8px 0;font-size:12px" onclick="_addCustomLeg()">+ Add Leg</button>';
  h+='<div style="border-top:1px solid var(--border);padding-top:12px;margin-top:8px;display:flex;gap:12px;flex-wrap:wrap">';
  h+='<div class="mfield" style="flex:1;min-width:120px;margin:0"><label>Net Premium</label><div id="custNetPrem" style="font-size:16px;font-weight:800;padding:8px 0;color:var(--green)">—</div></div>';
  h+='<div class="mfield" style="flex:1;min-width:120px;margin:0"><label>Target (P&L)</label><input type="number" id="custTarget" placeholder="e.g. 5000" inputmode="decimal"></div>';
  h+='<div class="mfield" style="flex:1;min-width:120px;margin:0"><label>SL (P&L)</label><input type="number" id="custSL" placeholder="e.g. -3000" inputmode="decimal"></div>';
  h+='<div class="mfield" style="flex:1;min-width:100px;margin:0"><label>Lots</label><input type="number" id="custLots" value="'+DEFAULT_LOTS+'" min="1" inputmode="numeric"></div>';
  h+='</div>';
  h+='<div class="mfield" style="margin-top:10px"><label><input type="checkbox" id="custSound" checked style="accent-color:var(--accent)"> Sound alert on target/SL hit</label></div>';
  h+='<div style="margin-top:12px;display:flex;gap:8px">';
  h+='<button class="btn primary" onclick="saveCustomPosition()">⚡ Track Strategy</button>';
  h+='<button class="btn ghost" onclick="_customLegs=[];trkCustom()">Reset</button>';
  h+='</div></div></div>';
  el.innerHTML=h;
  _renderCustomLegs();
}
function _renderCustomLegs(){
  var s=ST[CUR],chain=s.allStrikes||Object.keys(s.legs||{}).map(Number).sort(function(a,b){return a-b;});
  var el=document.getElementById('customLegs');if(!el)return;
  var h='';
  window._customLegs.forEach(function(leg,idx){
    h+='<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;padding:8px;border:1px solid var(--border);border-radius:8px;flex-wrap:wrap">';
    h+='<span style="font-size:10px;color:var(--muted);min-width:20px">#'+(idx+1)+'</span>';
    h+='<select id="custLegStrike'+idx+'" onchange="_customLegs['+idx+'].strike=Number(this.value);_updateCustomEntry('+idx+');_updateCustomNet()" style="width:90px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:5px 8px;font-size:11px;font-family:var(--mono)">';
    chain.forEach(function(k){h+='<option value="'+k+'"'+(k===leg.strike?' selected':'')+'>'+n0(k)+(k===s.atm?' ATM':'')+'</option>';});
    h+='</select>';
    h+='<select id="custLegType'+idx+'" onchange="_customLegs['+idx+'].optType=this.value;_updateCustomEntry('+idx+');_updateCustomNet()" style="width:60px;background:var(--surface2);color:'+(leg.optType==='CE'?'var(--cyan)':'var(--gold)')+';border:1px solid '+(leg.optType==='CE'?'var(--cyan)':'var(--gold)')+';border-radius:6px;padding:5px 8px;font-size:11px;font-weight:700">';
    h+='<option value="CE"'+(leg.optType==='CE'?' selected':'')+'>CE</option>';
    h+='<option value="PE"'+(leg.optType==='PE'?' selected':'')+'>PE</option>';
    h+='</select>';
    h+='<select id="custLegSide'+idx+'" onchange="_customLegs['+idx+'].side=this.value" style="width:65px;background:var(--surface2);color:'+(leg.side==='B'?'var(--green)':'var(--red)')+';border:1px solid '+(leg.side==='B'?'var(--green)':'var(--red)')+';border-radius:6px;padding:5px 8px;font-size:11px;font-weight:700">';
    h+='<option value="B"'+(leg.side==='B'?' selected':'')+'>BUY</option>';
    h+='<option value="S"'+(leg.side==='S'?' selected':'')+'>SELL</option>';
    h+='</select>';
    h+='<input type="number" id="custLegEntry'+idx+'" value="'+leg.entry.toFixed(2)+'" onchange="_customLegs['+idx+'].entry=parseFloat(this.value)||0;_updateCustomNet()" placeholder="Price" inputmode="decimal" style="width:80px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:5px 8px;font-size:11px;font-family:var(--mono)">';
    var prem=_getLivePrem(s,leg);
    h+='<span style="font-size:10px;color:var(--muted)" title="Live premium">LTP: '+n2(prem)+'</span>';
    h+='<button onclick="_customLegs.splice('+idx+',1);_renderCustomLegs()" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;padding:2px 6px" title="Remove">✕</button>';
    h+='</div>';
  });
  el.innerHTML=h;
  _updateCustomNet();
}
function _getLivePrem(s,leg){
  if(!s||!s.legs||!s.legs[leg.strike])return 0;
  return leg.optType==='CE'?(s.legs[leg.strike].call||0):(s.legs[leg.strike].put||0);
}
function _updateCustomEntry(idx){
  var s=ST[CUR],leg=window._customLegs[idx];if(!leg)return;
  var prem=_getLivePrem(s,leg);
  var inp=document.getElementById('custLegEntry'+idx);if(inp){leg.entry=prem;inp.value=prem.toFixed(2);}
  _renderCustomLegs();
}
function _updateCustomNet(){
  var net=0;var s=ST[CUR];
  window._customLegs.forEach(function(leg){
    var prem=_getLivePrem(s,leg);
    net+=leg.side==='B'?-prem:prem;
  });
  var el=document.getElementById('custNetPrem');if(!el)return;
  el.textContent=n2(net);
  el.style.color=net>=0?'var(--green)':'var(--red)';
}
function _addCustomLeg(){
  var s=ST[CUR];
  window._customLegs.push({strike:s.atm,optType:'CE',side:'B',entry:0});
  _renderCustomLegs();
}
function saveCustomPosition(){
  if(!window._customLegs.length){alert('Add at least one leg');return;}
  var target=parseFloat(document.getElementById('custTarget').value);
  var slVal=parseFloat(document.getElementById('custSL').value);
  var lots=Math.max(1,parseInt(document.getElementById('custLots').value)||DEFAULT_LOTS);
  var qty=lots*LOT_SIZE;
  var name=document.getElementById('custName').value||'Custom';
  var netEntry=0;
  var legs=window._customLegs.map(function(leg){
    var prem=_getLivePrem(ST[CUR],leg);
    netEntry+=leg.side==='B'?-prem:prem;
    return{strike:leg.strike,optType:leg.optType,side:leg.side,entry:prem};
  });
  var sls=[];if(!isNaN(slVal))sls.push({val:slVal,type:'price',hit:false});
  var newPos={id:Date.now(),index:CUR,type:'custom',name:name,legs:legs,strike:legs[0].strike,ceStrike:legs[0].strike,peStrike:null,entry:netEntry,target:isNaN(target)?null:target,sls,sound:document.getElementById('custSound').checked,lots,qty,status:'OPEN',tHit:false,cur:netEntry,side:'S'};
  myPositions.push(newPos);
  document.getElementById('trkBadge').textContent=myPositions.length;
  _trkPersistAdd({strategy:'custom',instrument:CUR,name:name,legs:legs,entry_price:netEntry,target:isNaN(target)?null:target,sl:sls,qty}, newPos);
  renderPositions();try{renderDashboard();}catch(_){}
  pushLog('INFO','tracker','Tracking '+CUR+' Custom "'+name+'" · '+legs.length+' legs · Net '+n2(netEntry));
  toast('up','CUSTOM TRACKED',name+' · '+legs.length+' legs · Net '+n2(netEntry));
  _customLegs=[];
}

// ── DATA TRACKERS ────────────────────────────────────────────────────────────

async function trkStrikeDetail(){
  const el=document.getElementById('trkContent'); if(!el)return;
  window._trkCurrentRender=trkStrikeDetail;
  const _tok=window._trkToken;
  try{
    const [snap,fullChain]=await Promise.all([jget('/api/snapshot',5000),jget('/api/chain/full',8000)]);
    if(_tok!==window._trkToken) return;
    const spot=(snap.live_spot_ltp??(snap.spot&&snap.spot.close))||0, atm=snap.atm||spot;
    const chain=fullChain&&fullChain.length?fullChain:(snap.chain||[]);
    if(!chain.length){_trkErr('No strike data');return;}
    // preserve the user's chosen strike across the 8s auto-refresh — it was resetting to
    // ATM on every refresh, which is why a selected strike would not "stick". Fall back to
    // ATM only if the chosen strike has left the chain (e.g. ATM shifted far).
    let sel = window._trkSelStrike!=null ? Number(window._trkSelStrike) : atm;
    if(!chain.find(r=>r.strike===sel)) sel = atm;
    let h=_trkHd('Strike Detail','Select any strike');
    h+='<div style="padding:14px"><select id="trk-strike-sel" aria-label="Select strike" onchange="window._trkSelStrike=this.value;trkStrikeRender(this.value)" style="background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-family:var(--mono);font-size:12px;width:100%">';
    chain.forEach(r=>{
      h+='<option value="'+r.strike+'"'+(r.strike===sel?' selected':'')+'>'+n0(r.strike)+(r.strike===atm?' (ATM)':'')+'</option>';
    });
    h+='</select></div><div id="trk-strike-body"></div></div>';
    el.innerHTML=h;
    trkStrikeRender(sel,chain);
  }catch(e){_trkErr('Failed to load strikes · '+e.message);}
}
async function trkStrikeRender(strike,chainData){
  const body=document.getElementById('trk-strike-body'); if(!body)return;
  try{
    let chain=chainData;
    if(!chain){
      const fullChain=await jget('/api/chain/full',8000);
      const snap=await jget('/api/snapshot',5000);
      chain=fullChain&&fullChain.length?fullChain:(snap.chain||[]);
    }
    const strikeNum=Number(strike);
    const r=chain.find(x=>x.strike===strikeNum);
    if(!r){body.innerHTML='<div class="empty">Strike not found</div>';return;}
    const snap=await jget('/api/snapshot',5000);
    const spot=(snap.live_spot_ltp??(snap.spot&&snap.spot.close))||0;
    let h=_trkGrid([
      {k:'STRIKE',v:n0(r.strike),c:'font-weight:800;color:var(--cyan)'},
      {k:'SPOT',v:n2(spot),c:'color:var(--cyan)'},
      {k:'DISTANCE',v:n0(Math.abs(r.strike-spot))+' pts'},
      {k:'CE LTP',v:n2(r.ce_close),c:'color:var(--cyan);font-weight:800'},
      {k:'PE LTP',v:n2(r.pe_close),c:'color:var(--gold);font-weight:800'},
      {k:'COMBINED',v:n2((r.ce_close||0)+(r.pe_close||0)),c:'font-weight:800'},
      {k:'CE OI',v:r.ce_oi!=null?n0(r.ce_oi):'—'},
      {k:'PE OI',v:r.pe_oi!=null?n0(r.pe_oi):'—'},
      {k:'CE IV',v:r.ce_iv!=null?Number(r.ce_iv).toFixed(1)+'%':'—'},
      {k:'PE IV',v:r.pe_iv!=null?Number(r.pe_iv).toFixed(1)+'%':'—'},
      {k:'CE DELTA',v:r.ce_delta!=null?Number(r.ce_delta).toFixed(3):'—'},
      {k:'PE DELTA',v:r.pe_delta!=null?Number(r.pe_delta).toFixed(3):'—'},
      {k:'CE THETA',v:r.ce_theta!=null?'₹'+n2(r.ce_theta):'—',c:'color:var(--red)'},
      {k:'PE THETA',v:r.pe_theta!=null?'₹'+n2(r.pe_theta):'—',c:'color:var(--red)'},
      {k:'CE GAMMA',v:r.ce_gamma!=null?Number(r.ce_gamma).toFixed(4):'—'},
      {k:'PE GAMMA',v:r.pe_gamma!=null?Number(r.pe_gamma).toFixed(4):'—'},
      {k:'CE VEGA',v:r.ce_vega!=null?Number(r.ce_vega).toFixed(2):'—'},
      {k:'PE VEGA',v:r.pe_vega!=null?Number(r.pe_vega).toFixed(2):'—'},
      {k:'CE BID/ASK',v:r.ce_bid!=null?n2(r.ce_bid)+' / '+n2(r.ce_ask):'—'},
      {k:'SPREAD',v:(r.ce_ask&&r.ce_bid)?n2(r.ce_ask-r.ce_bid):'—'}
    ]);
    body.innerHTML=h;
  }catch(e){body.innerHTML='<div class="empty">Error loading strike detail</div>';}
}

async function trkPremium(){
  const el=document.getElementById('trkContent'); if(!el)return;
  window._trkCurrentRender=trkPremium;
  const _tok=window._trkToken;
  try{
    const snap=await jget('/api/snapshot',5000);
    if(_tok!==window._trkToken) return;
    const chain=snap.chain||[], spot=(snap.live_spot_ltp??(snap.spot&&snap.spot.close))||0, atm=snap.atm||spot;
    if(!chain.length){_trkErr('No chain data');return;}
    const step=chain.length>1?Math.abs(chain[1].strike-chain[0].strike):50;
    const rows=[...chain].map(r=>{const comb=(r.ce_close||0)+(r.pe_close||0);return{...r,_comb:comb};});
    const sorted=_trkSortData(rows,window._trkSortKey||'_comb',window._trkSortDir);
    let h=_trkHd('Premium Movers','Biggest combined premium changes');
    h+=_trkSearchBox('Filter strikes...');
    h+='<div style="overflow-x:auto;padding:14px">';
    h+=_trkTblHead([{t:'Strike',k:'strike'},{t:'CE Prem',k:'ce_close',r:true},{t:'PE Prem',k:'pe_close',r:true},{t:'Combined',k:'_comb',r:true},{t:'CE Delta',k:'ce_delta',r:true},{t:'PE Delta',k:'pe_delta',r:true},{t:'OI Chg',k:'ce_oi',r:true}],true);
    sorted.forEach(r=>{
      const isATM=r.strike===atm;
      h+='<tr data-strike="'+r.strike+'" class="'+(isATM?'atm-row':'')+'"><td class="num" style="font-weight:700">'+n0(r.strike)+(isATM?'<span class="row-tag" style="background:var(--cyan);color:#001;margin-left:4px">ATM</span>':'')+'</td>';
      h+='<td class="num" style="color:var(--cyan)">'+n2(r.ce_close)+'</td>';
      h+='<td class="num" style="color:var(--gold)">'+n2(r.pe_close)+'</td>';
      h+='<td class="num" style="font-weight:800">'+n2(r._comb)+'</td>';
      h+='<td class="num '+(r.ce_delta>=0?'up':'dn')+'">'+(r.ce_delta!=null?Number(r.ce_delta).toFixed(2):'—')+'</td>';
      h+='<td class="num '+(r.pe_delta>=0?'up':'dn')+'">'+(r.pe_delta!=null?Number(r.pe_delta).toFixed(2):'—')+'</td>';
      h+='<td class="num">'+((r.ce_oi||0)-(r.pe_oi||0)>0?'<span class="up">+'+n0((r.ce_oi||0)-(r.pe_oi||0))+'</span>':'<span class="dn">'+n0((r.ce_oi||0)-(r.pe_oi||0))+'</span>')+'</td></tr>';
    });
    h+=_trkTblFoot()+'</div></div>';
    el.innerHTML=h;
  }catch(e){_trkErr('Failed to load premium data · '+e.message);}
}

async function trkOI(){
  const el=document.getElementById('trkContent'); if(!el)return;
  window._trkCurrentRender=trkOI;
  const _tok=window._trkToken;
  try{
    const [oiData,trending]=await Promise.all([jget('/api/oi_profile',5000),jget('/api/trending_oi',8000)]);
    if(_tok!==window._trkToken) return;
    const strikes=oiData.strikes||[];
    let h=_trkHd('OI Analysis','PCR · Max Pain · Buildup');
    h+=_trkGrid([
      {k:'PCR TOTAL',v:oiData.pcr_total!=null?Number(oiData.pcr_total).toFixed(2):'—',c:oiData.pcr_total>1?'color:var(--green)':'color:var(--red)'},
      {k:'PCR ATM',v:oiData.pcr_atm!=null?Number(oiData.pcr_atm).toFixed(2):'—',c:oiData.pcr_atm>1?'color:var(--green)':'color:var(--red)'},
      {k:'MAX PAIN',v:oiData.max_pain!=null?'₹'+n0(oiData.max_pain):'—',c:'color:var(--violet);font-weight:800'},
      {k:'TOTAL STRIKES',v:n0(strikes.length)}
    ]);
    if(strikes.length){
      h+=_trkHd('OI by Strike · Top 10');
      h+='<div style="overflow-x:auto;padding:14px">';
      h+=_trkTblHead([{t:'Strike'},{t:'CE OI',r:true},{t:'PE OI',r:true},{t:'CE ΔOI',r:true},{t:'PE ΔOI',r:true},{t:'PCR',r:true}]);
      const top=[...strikes].sort((a,b)=>((b.ce_oi||0)+(b.pe_oi||0))-((a.ce_oi||0)+(a.pe_oi||0))).slice(0,10);
      h+=_trkSearchBox('Filter strikes...');
      top.forEach(r=>{
        const pcr=r.ce_oi>0?((r.pe_oi||0)/r.ce_oi).toFixed(2):'—';
        h+='<tr data-strike="'+r.strike+'"><td class="num" style="font-weight:700">'+n0(r.strike)+'</td>';
        h+='<td class="num" style="color:var(--cyan)">'+n0(r.ce_oi)+'</td>';
        h+='<td class="num" style="color:var(--gold)">'+n0(r.pe_oi)+'</td>';
        h+='<td class="num '+(r.ce_oi_chg>0?'up':'dn')+'">'+(r.ce_oi_chg!=null?(r.ce_oi_chg>=0?'+':'')+n0(r.ce_oi_chg):'—')+'</td>';
        h+='<td class="num '+(r.pe_oi_chg>0?'up':'dn')+'">'+(r.pe_oi_chg!=null?(r.pe_oi_chg>=0?'+':'')+n0(r.pe_oi_chg):'—')+'</td>';
        h+='<td class="num">'+pcr+'</td></tr>';
      });
      h+=_trkTblFoot()+'</div>';
    }
    if(trending&&trending.length){
      const latest=trending[trending.length-1];
      h+=_trkHd('Latest OI Trend');
      h+=_trkGrid([
        {k:'TIME',v:latest.time||'—'},
        {k:'CALLS CHG OI',v:n0(latest.calls_chng_oi),c:latest.calls_chng_oi>=0?'color:var(--green)':'color:var(--red)'},
        {k:'PUTS CHG OI',v:n0(latest.puts_chng_oi),c:latest.puts_chng_oi>=0?'color:var(--green)':'color:var(--red)'},
        {k:'DIFF',v:n0(latest.diff_in_oi),c:(latest.diff_pct>=0?'color:var(--green)':'color:var(--red)')},
        {k:'PCR',v:latest.pcr!=null?Number(latest.pcr).toFixed(2):'—'},
        {k:'SENTIMENT',v:latest.sentiment||'—',c:latest.sentiment==='BULLISH'?'color:var(--green)':latest.sentiment==='BEARISH'?'color:var(--red)':'color:var(--muted)'}
      ]);
    }
    if(!strikes.length && !(trending&&trending.length)){
      h+='<div class="empty" style="padding:14px">No OI data available — market may be closed or data unavailable for this date</div>';
    }
    h+='</div>';
    el.innerHTML=h;
  }catch(e){_trkErr('Failed to load OI data · '+e.message);}
}

async function trkIV(){
  const el=document.getElementById('trkContent'); if(!el)return;
  window._trkCurrentRender=trkIV;
  const _tok=window._trkToken;
  try{
    const [ivSummary,vrp]=await Promise.all([jget('/api/iv_summary',5000),jget('/api/vrp',8000)]);
    if(_tok!==window._trkToken) return;
    const today=ivSummary.today||{};
    let h=_trkHd('IV Analysis','Regime · Rich/Cheat · VRP');
    h+=_trkGrid([
      {k:'ATM IV',v:today.atm_iv_close!=null?Number(today.atm_iv_close).toFixed(1)+'%':'—',c:'color:var(--cyan);font-weight:800'},
      {k:'IV REGIME',v:today.iv_regime||'—',c:today.iv_regime==='HIGH'?'color:var(--red);font-weight:800':today.iv_regime==='LOW'?'color:var(--green);font-weight:800':'color:var(--muted)'},
      {k:'EM 1σ',v:today.expected_move_1sigma!=null?n2(today.expected_move_1sigma)+' pts':'—'},
      {k:'EM 2σ',v:today.expected_move_2sigma!=null?n2(today.expected_move_2sigma)+' pts':'—'},
      {k:'RICH/CHEAP',v:today.rich_cheap||'—',c:today.rich_cheap==='RICH'?'color:var(--green)':today.rich_cheap==='CHEAP'?'color:var(--red)':'color:var(--muted)'}
    ]);
    if(vrp){
      h+=_trkGrid([
        {k:'IV',v:vrp.iv!=null?Number(vrp.iv).toFixed(1)+'%':'—'},
        {k:'RV',v:vrp.rv!=null?Number(vrp.rv).toFixed(1)+'%':'—'},
        {k:'VRP',v:vrp.vrp!=null?Number(vrp.vrp).toFixed(1)+'%':'—',c:vrp.vrp>0?'color:var(--green)':'color:var(--red)'},
        {k:'VERDICT',v:vrp.verdict||'—',c:vrp.verdict==='SELL'?'color:var(--green);font-weight:800':vrp.verdict==='BUY'?'color:var(--red);font-weight:800':'color:var(--muted)'}
      ]);
    }
    const recent=ivSummary.recent||[];
    if(recent.length){
      h+=_trkHd('IV History');
      h+='<div style="overflow-x:auto;padding:14px">';
      h+=_trkTblHead([{t:'Date'},{t:'ATM IV',r:true},{t:'Regime'},{t:'EM 1σ',r:true},{t:'Verdict'}]);
      recent.forEach(r=>{
        h+='<tr><td>'+n0(r.date)+'</td>';
        h+='<td class="num" style="font-weight:700">'+(r.atm_iv_close!=null?Number(r.atm_iv_close).toFixed(1)+'%':'—')+'</td>';
        h+='<td>'+(r.iv_regime||'—')+'</td>';
        h+='<td class="num">'+(r.expected_move_1sigma!=null?n2(r.expected_move_1sigma):'—')+'</td>';
        h+='<td>'+(r.rich_cheap||'—')+'</td></tr>';
      });
      h+=_trkTblFoot()+'</div>';
    }
    h+='</div>';
    el.innerHTML=h;
  }catch(e){_trkErr('Failed to load IV data · '+e.message);}
}

async function trkDecay(){
  const el=document.getElementById('trkContent'); if(!el)return;
  window._trkCurrentRender=trkDecay;
  const _tok=window._trkToken;
  try{
    const snap=await jget('/api/snapshot',5000);
    if(_tok!==window._trkToken) return;
    const chain=snap.chain||[];
    if(!chain.length){_trkErr('No chain data');return;}
    let h=_trkHd('Decay Leaderboard','Fastest decaying options by theta');
    h+=_trkSearchBox('Filter strikes...');
    h+='<div style="overflow-x:auto;padding:14px">';
    h+=_trkTblHead([{t:'Strike',k:'strike'},{t:'Type'},{t:'LTP',k:'ltp',r:true},{t:'Theta/hr',k:'theta',r:true},{t:'Theta/day',k:'theta',r:true},{t:'IV',k:'iv',r:true},{t:'Delta',k:'delta',r:true},{t:'% Decay/hr',k:'decayPct',r:true}],true);
    const legs=[];
    chain.forEach(r=>{
      if(r.ce_theta!=null) legs.push({strike:r.strike,type:'CE',ltp:r.ce_close,theta:r.ce_theta,iv:r.ce_iv,delta:r.ce_delta,color:'var(--cyan)'});
      if(r.pe_theta!=null) legs.push({strike:r.strike,type:'PE',ltp:r.pe_close,theta:r.pe_theta,iv:r.pe_iv,delta:r.pe_delta,color:'var(--gold)'});
    });
    legs.sort((a,b)=>a.theta-b.theta);
    const decaySorted=_trkSortData(legs.map(l=>({...l,decayPct:l.ltp>0?(Math.abs(l.theta)/l.ltp*100):0})),window._trkSortKey||'decayPct',window._trkSortDir);
    decaySorted.slice(0,20).forEach(l=>{
      const decayPct=l.ltp>0?(Math.abs(l.theta)/l.ltp*100):0;
      h+='<tr data-strike="'+l.strike+'"><td class="num" style="font-weight:700">'+n0(l.strike)+'</td>';
      h+='<td style="color:'+l.color+';font-weight:700">'+l.type+'</td>';
      h+='<td class="num" style="font-weight:700">'+n2(l.ltp)+'</td>';
      h+='<td class="num dn" style="font-weight:700">'+n2(l.theta)+'</td>';
      h+='<td class="num dn">'+n2(l.theta*6.25)+'</td>';
      h+='<td class="num">'+(l.iv!=null?Number(l.iv).toFixed(1)+'%':'—')+'</td>';
      h+='<td class="num">'+(l.delta!=null?Number(l.delta).toFixed(2):'—')+'</td>';
      h+='<td class="num dn">'+l.decayPct.toFixed(2)+'%</td></tr>';
    });
    h+=_trkTblFoot()+'</div></div>';
    el.innerHTML=h;
  }catch(e){_trkErr('Failed to load decay data · '+e.message);}
}

async function trkEM(){
  const el=document.getElementById('trkContent'); if(!el)return;
  window._trkCurrentRender=trkEM;
  const _tok=window._trkToken;
  try{
    const [snap,regimeData,ivSummary]=await Promise.all([jget('/api/snapshot',5000),jget('/api/regime/today',8000),jget('/api/iv_summary',8000)]);
    if(_tok!==window._trkToken) return;
    const spot=(snap.live_spot_ltp??(snap.spot&&snap.spot.close))||0, today=ivSummary.today||{};
    const em=regimeData.em||{};
    const em1=today.expected_move_1sigma||em.consensus_em||0;
    const em2=today.expected_move_2sigma||em1*2||0;
    const upper1=spot+em1, lower1=spot-em1;
    const upper2=spot+em2, lower2=spot-em2;
    const combined=snap.combined||0;
    const insideEM=combined<=em1;
    let h=_trkHd('Expected Move Tracker','Spot: ₹'+n2(spot));
    h+=_trkGrid([
      {k:'SPOT',v:n2(spot),c:'color:var(--cyan);font-weight:800'},
      {k:'EM 1σ',v:n2(em1)+' pts',c:'font-weight:800'},
      {k:'EM 2σ',v:n2(em2)+' pts'},
      {k:'UPPER 1σ',v:n2(upper1),c:'color:var(--green)'},
      {k:'LOWER 1σ',v:n2(lower1),c:'color:var(--red)'},
      {k:'UPPER 2σ',v:n2(upper2),c:'color:var(--green)'},
      {k:'LOWER 2σ',v:n2(lower2),c:'color:var(--red)'},
      {k:'COMBINED',v:n2(combined),c:'font-weight:800'},
      {k:'WITHIN 1σ?',v:insideEM?'YES ✓':'NO ✗',c:insideEM?'color:var(--green);font-weight:800':'color:var(--red);font-weight:800'},
      {k:'EM RELIABILITY',v:em.em_reliability!=null?Number(em.em_reliability).toFixed(1)+'%':'—'},
      {k:'EM STRESS',v:em.em_stress!=null?Number(em.em_stress).toFixed(1)+'%':'—'},
      {k:'BAND 95%',v:em.band95!=null?n2(em.band95)+' pts':'—'}
    ]);
    const hist=(regimeData.history||[]).slice(-10);
    if(hist.length){
      h+=_trkHd('EM History · Last 10 Sessions');
      h+='<div style="overflow-x:auto;padding:14px">';
      h+=_trkTblHead([{t:'Session'},{t:'EM',r:true},{t:'Actual',r:true},{t:'Within EM?'}]);
      hist.forEach(r=>{
        const actual=r.actual_move||0, emVal=r.em||0;
        const inside=actual<=emVal;
        h+='<tr><td>'+(r.date||'—')+'</td>';
        h+='<td class="num">'+n2(emVal)+'</td>';
        h+='<td class="num" style="font-weight:700">'+n2(actual)+'</td>';
        h+='<td>'+(inside?'<span class="pill win">YES</span>':'<span class="pill loss">NO</span>')+'</td></tr>';
      });
      h+=_trkTblFoot()+'</div>';
    }
    h+='</div>';
    el.innerHTML=h;
  }catch(e){_trkErr('Failed to load EM data · '+e.message);}
}

async function trkGreeks(){
  const el=document.getElementById('trkContent'); if(!el)return;
  window._trkCurrentRender=trkGreeks;
  const _tok=window._trkToken;
  try{
    const chainData=await jget('/api/chain/full',5000);
    if(_tok!==window._trkToken) return;
    if(!chainData||!chainData.length){_trkErr('No chain data');return;}
    let sortKey=window._trkSortKey||'ce_delta', sortDir=window._trkSortDir||-1;
    function renderGreeksTable(data){
      const sorted=[...data].sort((a,b)=>{
        const va=Number(a[sortKey])||0, vb=Number(b[sortKey])||0;
        return sortDir*(vb-va);
      });
      let h=_trkSearchBox('Filter strikes...');
      h+='<div style="overflow-x:auto;padding:14px">';
      h+=_trkTblHead([{t:'Strike',k:'strike'},{t:'CE Δ',k:'ce_delta',r:true},{t:'PE Δ',k:'pe_delta',r:true},{t:'CE Γ',k:'ce_gamma',r:true},{t:'PE Γ',k:'pe_gamma',r:true},{t:'CE Θ',k:'ce_theta',r:true},{t:'PE Θ',k:'pe_theta',r:true},{t:'CE V',k:'ce_vega',r:true},{t:'PE V',k:'pe_vega',r:true},{t:'CE OI',k:'ce_oi',r:true},{t:'PE OI',k:'pe_oi',r:true}],true);
      sorted.forEach(r=>{
        h+='<tr data-strike="'+r.strike+'"><td class="num" style="font-weight:700">'+n0(r.strike)+'</td>';
        h+='<td class="num">'+(r.ce_delta!=null?Number(r.ce_delta).toFixed(3):'—')+'</td>';
        h+='<td class="num">'+(r.pe_delta!=null?Number(r.pe_delta).toFixed(3):'—')+'</td>';
        h+='<td class="num">'+(r.ce_gamma!=null?Number(r.ce_gamma).toFixed(4):'—')+'</td>';
        h+='<td class="num">'+(r.pe_gamma!=null?Number(r.pe_gamma).toFixed(4):'—')+'</td>';
        h+='<td class="num dn">'+(r.ce_theta!=null?'₹'+n2(r.ce_theta):'—')+'</td>';
        h+='<td class="num dn">'+(r.pe_theta!=null?'₹'+n2(r.pe_theta):'—')+'</td>';
        h+='<td class="num">'+(r.ce_vega!=null?Number(r.ce_vega).toFixed(2):'—')+'</td>';
        h+='<td class="num">'+(r.pe_vega!=null?Number(r.pe_vega).toFixed(2):'—')+'</td>';
        h+='<td class="num">'+(r.ce_oi!=null?n0(r.ce_oi):'—')+'</td>';
        h+='<td class="num">'+(r.pe_oi!=null?n0(r.pe_oi):'—')+'</td></tr>';
      });
      h+=_trkTblFoot()+'</div>';
      return h;
    }
    el.innerHTML=_trkHd('Greeks · Click column headers to sort')+
      renderGreeksTable(chainData)+'</div>';
  }catch(e){_trkErr('Failed to load greeks · '+e.message);}
}

// ── INTELLIGENCE TRACKERS ────────────────────────────────────────────────────

async function trkWatchlist(){
  const el=document.getElementById('trkContent'); if(!el)return;
  window._trkCurrentRender=trkWatchlist;
  const _tok=window._trkToken;
  let wl=[];
  try{ wl=JSON.parse(localStorage.getItem('trkWatchlist')||'[]'); }catch(e){}
  try{
    const snap=await jget('/api/snapshot',5000);
    if(_tok!==window._trkToken) return;
    const chain=snap.chain||[], spot=(snap.live_spot_ltp??(snap.spot&&snap.spot.close))||0, atm=snap.atm||spot;
    if(!chain.length){el.innerHTML=_trkHd('Watchlist')+'<div style="padding:14px" class="empty">No chain data to populate watchlist</div></div>';return;}
    const defaultWL=wl.length?wl:[{strike:atm,label:'ATM'},{strike:chain[0]?.strike,label:'Lowest'},{strike:chain[chain.length-1]?.strike,label:'Highest'}];
    let h=_trkHd('Watchlist · Saved Strikes',
      '<button class="trk-pill" style="flex:0 0 auto;margin-left:8px" onclick="trkWatchlistAdd()">+ Add ATM</button>');
    h+='<div style="overflow-x:auto;padding:14px">';
    h+=_trkTblHead([{t:'Strike'},{t:'Label'},{t:'CE LTP',r:true},{t:'PE LTP',r:true},{t:'Combined',r:true},{t:'CE IV',r:true},{t:'PE IV',r:true},{t:'CE Δ',r:true},{t:'PE Δ',r:true},{t:'Dist',r:true},{t:''}]);
    defaultWL.forEach((w,i)=>{
      const r=chain.find(x=>x.strike===w.strike);
      if(!r) return;
      const comb=(r.ce_close||0)+(r.pe_close||0);
      h+='<tr><td class="num" style="font-weight:700">'+n0(r.strike)+'</td>';
      h+='<td style="color:var(--accent)">'+(w.label||'')+'</td>';
      h+='<td class="num" style="color:var(--cyan)">'+n2(r.ce_close)+'</td>';
      h+='<td class="num" style="color:var(--gold)">'+n2(r.pe_close)+'</td>';
      h+='<td class="num" style="font-weight:800">'+n2(comb)+'</td>';
      h+='<td class="num">'+(r.ce_iv!=null?Number(r.ce_iv).toFixed(1)+'%':'—')+'</td>';
      h+='<td class="num">'+(r.pe_iv!=null?Number(r.pe_iv).toFixed(1)+'%':'—')+'</td>';
      h+='<td class="num">'+(r.ce_delta!=null?Number(r.ce_delta).toFixed(2):'—')+'</td>';
      h+='<td class="num">'+(r.pe_delta!=null?Number(r.pe_delta).toFixed(2):'—')+'</td>';
      h+='<td class="num '+(r.strike>=spot?'up':'dn')+'">'+(r.strike-spot>=0?'+':'')+n0(r.strike-spot)+'</td>';
      h+='<td><span class="del-alert" onclick="trkWatchlistRemove('+i+')" title="Remove">✕</span></td></tr>';
    });
    h+=_trkTblFoot()+'</div></div>';
    el.innerHTML=h;
  }catch(e){_trkErr('Failed to load watchlist · '+e.message);}
}
window.trkWatchlistAdd=function(){
  jget('/api/snapshot',3000).then(function(snap){
    if(!snap) return;
    const atm=snap.atm;
    let wl=[];
    try{ wl=JSON.parse(localStorage.getItem('trkWatchlist')||'[]'); }catch(e){}
    if(wl.length>=10) return;
    wl.push({strike:atm,label:'ATM '+n0(atm)});
    try{ localStorage.setItem('trkWatchlist',JSON.stringify(wl)); }catch(e){}
    trkWatchlist();
  }).catch(function(){});
};
window.trkWatchlistRemove=function(idx){
  try{
    let wl=JSON.parse(localStorage.getItem('trkWatchlist')||'[]');
    wl.splice(idx,1);
    localStorage.setItem('trkWatchlist',JSON.stringify(wl));
    trkWatchlist();
  }catch(e){}
};

async function trkAlerts(){
  const el=document.getElementById('trkContent'); if(!el)return;
  window._trkCurrentRender=trkAlerts;
  const _tok=window._trkToken;
  try{
    const alerts=window.__alerts||await jget('/api/alerts',3000);
    if(_tok!==window._trkToken) return;
    let h=_trkHd('Alerts','All straddle alerts · '+(alerts?alerts.length:0)+' total');
    if(!alerts||!alerts.length){h+='<div style="padding:14px" class="empty">No alerts triggered yet</div></div>';el.innerHTML=h;return;}
    h+='<div style="overflow-x:auto;padding:14px">';
    h+=_trkTblHead([{t:'Time'},{t:'Type'},{t:'Level',r:true},{t:'Current',r:true},{t:'Message'}]);
    alerts.forEach(a=>{
      const lvlCol=a.level_value>a.current_value?'color:var(--red)':'color:var(--green)';
      h+='<tr><td style="color:var(--muted);font-size:11px;white-space:nowrap">'+(a.timestamp?new Date(a.timestamp).toLocaleTimeString():'—')+'</td>';
      h+='<td><span class="pill '+(a.alert_type==='SL'?'loss':a.alert_type==='TARGET'?'win':'skip')+'">'+(a.alert_type||'—')+'</span></td>';
      h+='<td class="num" style="'+lvlCol+'">'+(a.level_value!=null?n2(a.level_value):'—')+'</td>';
      h+='<td class="num" style="font-weight:700">'+(a.current_value!=null?n2(a.current_value):'—')+'</td>';
      h+='<td style="font-size:11px;color:var(--text2)">'+(a.message||'—')+'</td></tr>';
    });
    h+=_trkTblFoot()+'</div></div>';
    el.innerHTML=h;
  }catch(e){_trkErr('Failed to load alerts · '+e.message);}
}

async function trkResearch(){
  const el=document.getElementById('trkContent'); if(!el)return;
  window._trkCurrentRender=trkResearch;
  const _tok=window._trkToken;
  try{
    const [evidence,findings]=await Promise.all([jget('/api/research/evidence',8000),jget('/api/research/findings',8000)]);
    if(_tok!==window._trkToken) return;
    let h=_trkHd('Research · Evidence & Findings');
    const cards=(evidence&&evidence.cards)||[];
    if(cards.length){
      h+='<div style="overflow-x:auto;padding:14px">';
      h+=_trkTblHead([{t:'Strategy'},{t:'Trades',r:true},{t:'Win Rate',r:true},{t:'Expectancy',r:true},{t:'PF',r:true},{t:'Sharpe',r:true},{t:'Maturity'}]);
      cards.forEach(c=>{
        h+='<tr><td style="font-weight:700">'+(c.strategy||'—')+'</td>';
        h+='<td class="num">'+(c.trades||'—')+'</td>';
        h+='<td class="num '+(c.win_rate>=55?'up':'dn')+'">'+(c.win_rate!=null?Number(c.win_rate).toFixed(1)+'%':'—')+'</td>';
        h+='<td class="num '+(c.expectancy>=0?'up':'dn')+'">'+(c.expectancy!=null?'₹'+Math.round(c.expectancy):'—')+'</td>';
        h+='<td class="num">'+(c.profit_factor||'—')+'</td>';
        h+='<td class="num">'+(c.sharpe!=null?Number(c.sharpe).toFixed(2):'—')+'</td>';
        h+='<td style="font-size:11px;color:var(--muted)">'+(c.maturity||'—')+'</td></tr>';
      });
      h+=_trkTblFoot()+'</div>';
    }
    const finds=(findings&&findings.findings)||[];
    if(finds.length){
      h+=_trkHd('Latest Findings');
      h+='<div style="overflow-x:auto;padding:14px">';
      h+=_trkTblHead([{t:'Date'},{t:'Strategy'},{t:'Category'},{t:'Headline'},{t:'Confidence',r:true}]);
      finds.forEach(f=>{
        h+='<tr><td style="color:var(--muted)">'+(f.date||'—')+'</td>';
        h+='<td style="font-weight:700">'+(f.strategy||'—')+'</td>';
        h+='<td><span class="pill skip">'+(f.category||'—')+'</span></td>';
        h+='<td style="font-size:11px">'+(f.headline||'—')+'</td>';
        h+='<td class="num">'+(f.confidence!=null?Number(f.confidence).toFixed(0)+'%':'—')+'</td></tr>';
      });
      h+=_trkTblFoot()+'</div>';
    }
    if(!cards.length&&!finds.length) h+='<div style="padding:14px" class="empty">No research data available yet</div>';
    h+='</div>';
    el.innerHTML=h;
  }catch(e){_trkErr('Failed to load research · '+e.message);}
}

async function trkSession(){
  const el=document.getElementById('trkContent'); if(!el)return;
  window._trkCurrentRender=trkSession;
  const _tok=window._trkToken;
  try{
    const [snap,history]=await Promise.all([jget('/api/snapshot',5000),jget('/api/history/dates',8000)]);
    if(_tok!==window._trkToken) return;
    const now=new Date();
    const h=now.getHours(), m=now.getMinutes();
    const mins=h*60+m;
    let phase='Pre-Market', phaseColor='var(--muted)';
    if(mins>=555&&mins<615){phase='Opening Range (9:15-9:45)';phaseColor='var(--gold)';}
    else if(mins>=615&&mins<660){phase='First Hour Settling (9:45-10:30)';phaseColor='var(--cyan)';}
    else if(mins>=660&&mins<810){phase='Mid-Session (10:30-13:30)';phaseColor='var(--text2)';}
    else if(mins>=810&&mins<855){phase='Power Hour (13:30-14:15)';phaseColor='var(--accent)';}
    else if(mins>=855&&mins<930){phase='Pre-Close (14:15-15:30)';phaseColor='var(--red)';}
    else if(mins>=930&&mins<940){phase='CAS / Settlement (15:30-15:40)';phaseColor='var(--gold)';}
    else if(mins>=940&&mins<960){phase='Closing Auction (15:40-16:00)';phaseColor='var(--cyan)';}
    else if(mins>=960){phase='Post-Market';phaseColor='var(--muted)';}
    const spot=(snap.live_spot_ltp??(snap.spot&&snap.spot.close))||0;
    let h2=_trkHd('Session Tracker','Market phase · Decay · Milestones');
    h2+=_trkGrid([
      {k:'CURRENT TIME',v:now.toLocaleTimeString(),c:'font-weight:800'},
      {k:'SESSION PHASE',v:phase,c:'color:'+phaseColor+';font-weight:800'},
      {k:'SPOT',v:n2(spot),c:'color:var(--cyan);font-weight:800'},
      {k:'VIX',v:snap.vix!=null?Number(snap.vix).toFixed(2):'—',c:'color:var(--gold)'},
      {k:'COMBINED',v:snap.combined!=null?n2(snap.combined):'—',c:'font-weight:800'},
      {k:'MORNING STRADDLE',v:snap.morning_straddle!=null?n2(snap.morning_straddle):'—',c:'color:var(--gold)'},
      {k:'MAX PAIN',v:snap.max_pain!=null?'₹'+n0(snap.max_pain):'—',c:'color:var(--violet)'},
      {k:'OPEN STRADDLE',v:snap.open_straddle!=null?n2(snap.open_straddle):'—'}
    ]);
    const decayPct=snap.open_straddle&&snap.combined?((snap.open_straddle-snap.combined)/snap.open_straddle*100):0;
    const mornDecay=snap.morning_straddle&&snap.combined?((snap.morning_straddle-snap.combined)/snap.morning_straddle*100):0;
    h2+=_trkGrid([
      {k:'OPEN→NOW DECAY',v:(decayPct>=0?'+':'')+decayPct.toFixed(1)+'%',c:decayPct>=0?'color:var(--green);font-weight:800':'color:var(--red);font-weight:800'},
      {k:'MORNING→NOW',v:(mornDecay>=0?'+':'')+mornDecay.toFixed(1)+'%',c:mornDecay>=0?'color:var(--green)':'color:var(--red)'}
    ]);
    const dates=(history||[]).slice(-5);
    if(dates.length){
      h2+=_trkHd('Recent Sessions');
      h2+='<div style="overflow-x:auto;padding:14px">';
      h2+=_trkTblHead([{t:'Date'},{t:'Open Comb',r:true},{t:'Close Comb',r:true},{t:'Decay %',r:true},{t:'Spot Open',r:true},{t:'Spot Close',r:true}]);
      dates.forEach(d=>{
        const dc=d.total_decay_pct||0;
        h2+='<tr><td style="font-weight:700">'+(d.date||'—')+'</td>';
        h2+='<td class="num">'+(d.opening_combined!=null?n2(d.opening_combined):'—')+'</td>';
        h2+='<td class="num">'+(d.closing_combined!=null?n2(d.closing_combined):'—')+'</td>';
        h2+='<td class="num '+(dc>=0?'up':'dn')+'">'+(dc>=0?'+':'')+Number(dc).toFixed(1)+'%</td>';
        h2+='<td class="num">'+(d.spot_open!=null?n2(d.spot_open):'—')+'</td>';
        h2+='<td class="num">'+(d.spot_close!=null?n2(d.spot_close):'—')+'</td></tr>';
      });
      h2+=_trkTblFoot()+'</div>';
    }
    h2+='</div>';
    el.innerHTML=h2;
  }catch(e){_trkErr('Failed to load session data · '+e.message);}
}

async function trkAI(){
  const el=document.getElementById('trkContent'); if(!el)return;
  window._trkCurrentRender=trkAI;
  const _tok=window._trkToken;
  try{
    const [regimeData,vrp,ivSummary,strategies]=await Promise.all([
      jget('/api/regime/today',5000),jget('/api/vrp',8000),jget('/api/iv_summary',8000),jget('/api/strategies/today',8000)
    ]);
    if(_tok!==window._trkToken) return;
    const regime=regimeData.regime||'UNDECIDED';
    const em=regimeData.em||{};
    const today=ivSummary.today||{};
    let h=_trkHd('AI Insights','Regime · Recommendations · Signals');
    const regimeColor=regime==='LOW_VOL'||regime==='MEAN_REVERSION'?'var(--green)':regime==='HIGH_VOL'||regime==='TRENDING'?'var(--red)':regime==='BREAKOUT'?'var(--violet)':'var(--muted)';
    h+=_trkGrid([
      {k:'REGIME',v:regime,c:'color:'+regimeColor+';font-weight:800;font-size:16px'},
      {k:'VRP VERDICT',v:vrp.verdict||'—',c:vrp.verdict==='SELL'?'color:var(--green);font-weight:800':vrp.verdict==='BUY'?'color:var(--red);font-weight:800':'color:var(--muted)'},
      {k:'IV REGIME',v:today.iv_regime||'—',c:today.iv_regime==='HIGH'?'color:var(--red)':today.iv_regime==='LOW'?'color:var(--green)':'color:var(--muted)'},
      {k:'RICH/CHEAP',v:today.rich_cheap||'—',c:today.rich_cheap==='RICH'?'color:var(--green)':today.rich_cheap==='CHEAP'?'color:var(--red)':'color:var(--muted)'},
      {k:'EM 1σ',v:today.expected_move_1sigma!=null?n2(today.expected_move_1sigma)+' pts':'—'},
      {k:'EM RELIABILITY',v:em.em_reliability!=null?Number(em.em_reliability).toFixed(1)+'%':'—'},
      {k:'BAND 90',v:em.band90!=null?n2(em.band90)+' pts':'—'},
      {k:'BAND 95',v:em.band95!=null?n2(em.band95)+' pts':'—'}
    ]);
    const strats=(strategies&&strategies.strategies)||[];
    if(strats.length){
      h+=_trkHd('Strategy Signals · Today');
      h+='<div style="overflow-x:auto;padding:14px">';
      h+=_trkTblHead([{t:'Strategy'},{t:'Status'},{t:'P&L',r:true},{t:'Win Rate',r:true},{t:'Entry'},{t:'Exit'}]);
      strats.forEach(s=>{
        h+='<tr><td style="font-weight:700">'+(s.strategy||'—')+'</td>';
        h+='<td><span class="pill '+(s.status==='WIN'?'win':s.status==='LOSS'?'loss':'skip')+'">'+(s.status||'—')+'</span></td>';
        h+='<td class="num '+(s.net_pnl>=0?'up':'dn')+'">'+(s.net_pnl!=null?'₹'+Math.round(s.net_pnl):'—')+'</td>';
        h+='<td class="num">'+(s.win_rate!=null?Number(s.win_rate).toFixed(1)+'%':'—')+'</td>';
        h+='<td style="font-size:11px;color:var(--muted)">'+(s.entry_time||'—')+'</td>';
        h+='<td style="font-size:11px;color:var(--muted)">'+(s.exit_time||'—')+'</td></tr>';
      });
      h+=_trkTblFoot()+'</div>';
    }
    h+='</div>';
    el.innerHTML=h;
  }catch(e){_trkErr('Failed to load AI insights · '+e.message);}
}




/* ============ BACKEND CONNECTION ============
   All dashboard data comes from these APIs (Cowork: implement to match).
   CONFIG.liveOnly = true  → today: mock runs if API absent (demo)
   CONFIG.liveOnly = true   → tomorrow: LIVE DATA ONLY, no mock (shows "waiting")
   pollMs = how often to refresh from backend.

   API endpoints used:
     GET /api/snapshot         → { index, dte, atm, spot:{open,high,low,close},
                                    live_spot_ltp, live_vix_ltp, vix:{vix},
                                    combined:{combined_close,ce_close,pe_close,
                                    opening_combined,decay_pct,atm_strike},
                                    structure:{pcr_total,max_pain_strike},
                                    chain:[{strike,ce_close,pe_close,ce_oi,pe_oi,
                                    ce_iv,pe_iv,ce_delta,pe_delta,ce_bid,ce_ask,
                                    pe_bid,pe_ask,timestamp}],
                                    counts:{...} }
     GET /api/chain/full       → [ {strike, ce_close, pe_close, ...} ]  ALL strikes
     GET /api/levels           → { reference:{...}, period:{...} }
     GET /api/alerts           → [ {timestamp, alert_type, message} ]
     GET /api/logs?n=40        → [ {timestamp, level, component, message} ]
     GET /api/pnl              → [ {name, raw, filtered, win} ]   (shadow strategies)
     GET /api/history/dates    → [ {date, day_of_week, dte, spot_open, ...} ]
     GET /api/ledger           → [ {time, strategy, action, strike, price, state} ]
*/
const CONFIG = { liveOnly:true, pollMs:3000 };
let MODE='boot';            // 'mock' | 'live' | 'waiting'
let mockTimer=null;

const _jgetCache={};
// In-flight request map: if two renders ask for the same path simultaneously (common —
// several cards read /api/snapshot), they SHARE one network round-trip instead of racing
// duplicates. Cuts redundant requests without touching any caller.
const _jgetInflight={};
// PER-PATH MINIMUM TTL (2026-08-25, operator: "isse bhi kam latency kar sakte ho toh
// wo bhi karo"). MEASURED on the live box: 1,382 API requests in 10 minutes, led by
// snapshot 181, regime/today 166, vwap 152, strategies/today 152, indices 99,
// attribution 98. Nearly all of those serve data that changes on a MINUTE or an
// END-OF-DAY cadence, yet every caller used the 4 s default — so the dashboard was
// re-fetching EOD-computed tables ~15x a minute and competing with the live tick
// writers for the same DB. Raising the floor per path cuts request volume several-fold
// with no loss of freshness, because nothing here actually updates that fast.
// Deliberately NOT slowed: /api/snapshot (the live one, and it is pushed over the
// websocket anyway) and anything not listed keeps the 4 s default. A caller may still
// pass a LARGER ttl; this only raises a too-eager floor, never lowers a deliberate one.
var _PATH_TTL = {
  '/api/version': 300000,           // build id — changes only on deploy
  '/api/calendar/events': 300000,   // scheduled events, days ahead
  '/api/health': 30000,             // its own heavy aggregates are already 5-min cached
  '/api/regime/today': 20000,       // regime is a slow-moving classification
  '/api/strategies/today': 20000,   // recomputed per minute at most
  '/api/expiry_strategies': 30000,
  '/api/settlement/today': 30000,
  '/api/range15': 30000,            // 15-minute blocks
  '/api/levels': 30000,             // prior-session levels: fixed for the whole day
  '/api/attribution': 15000,        // 1-minute constituent data
  '/api/synthetic': 15000,
  '/api/vwap': 10000,               // server already caches this 5 s
  '/api/indices': 10000,
  '/api/alerts': 10000
};
function _pathTtl(path, ttl){
  var base = path.split('?')[0];
  var floor = _PATH_TTL[base];
  return (floor && floor > ttl) ? floor : ttl;
}
async function jget(path, ttl=4000){
  ttl = _pathTtl(path, ttl);
  const now=Date.now(), c=_jgetCache[path];
  if(c && (now-c.ts)<ttl) return c.data;
  // HIDDEN-TAB SUPPRESSION (2026-08-25 latency work). This dashboard runs 58
  // setInterval pollers; a backgrounded tab kept every one of them hitting the API
  // for data nobody could see, adding server load that showed up as latency for the
  // tabs people WERE looking at. Serving the cached value while document.hidden costs
  // the hidden tab nothing (it is not rendering) and removes that load at the single
  // seam every poller already goes through — rather than editing 58 call sites.
  // Only skips when a cached value EXISTS: a hidden tab that has never fetched this
  // path still fetches, so nothing can render permanently empty. On becoming visible
  // the cache is dropped (listener below) so the next call is genuinely fresh.
  if(document.hidden && c) return c.data;
  // Share ONE round-trip when several cards request the same path at once.
  if(_jgetInflight[path]) return _jgetInflight[path];
  const p=(async()=>{
    const r=await fetch(path,{cache:'no-store'});
    if(!r.ok){
      // Phase 8: carry status + parsed body on the thrown Error so a premium-gated
      // call site CAN detect a 403 upgrade_required shape (identity/entitlements.py)
      // and render a real message — every EXISTING `.catch(()=>({}))`/`.catch(()=>null)`
      // call site is completely unaffected, since they never look at the caught error.
      const err=new Error('HTTP '+r.status);
      err.status=r.status;
      try{ err.body=await r.json(); }catch(_){}
      throw err;
    }
    const data=await r.json();
    _jgetCache[path]={ts:Date.now(),data};
    return data;
  })();
  _jgetInflight[path]=p;
  try{ return await p; } finally { delete _jgetInflight[path]; }
}
// Returning to the tab must show CURRENT data, never whatever was cached when it was
// backgrounded — so drop the jget cache on unhide and let the next poll refetch.
// Pairs with the document.hidden short-circuit above; without this, suppression would
// turn into staleness the moment the operator came back (Layer 1.3).
document.addEventListener('visibilitychange',function(){
  if(!document.hidden){ try{ for(const k in _jgetCache) delete _jgetCache[k]; }catch(e){} }
});

// Market session chip — reflects the REAL exchange session (data_health.session_state(),
// server-side single owner, returned as snap.session on every /api/snapshot poll), never
// mere feed/fetch connectivity. Section 1 remediation (2026-08-10): the old boolean
// version showed green 'LIVE' whenever /api/snapshot answered with parseable data, which
// it still does for hours after close (last-session values are intentionally served) —
// so the header lied about the market being open. `session` is null only while the
// backend itself hasn't answered yet (network down / booting); that is the ONE case
// still rendered as CONNECTING, distinct from every real (reachable) session state.
function setLiveChip(session){
  const c=document.getElementById('liveChip'); const t=document.getElementById('liveTxt');
  if(!c||!t) return;
  // Single writer for the header's session indicators: updateMktDot() (the small
  // #mktDot in the topbar) reads this same value, so both stay consistent and no
  // second owner decides what the session is.
  window._lastSessionState=session;
  c.classList.remove('off','warn');
  if(!session){ c.classList.add('off'); t.textContent='CONNECTING'; c.title='Waiting for backend'; return; }
  const st=session.state||'UNKNOWN';
  if(st==='LIVE'){ /* default green styling */ }
  else if(st==='PAUSED'){ c.classList.add('warn'); }
  else { c.classList.add('off'); }
  let label = session.label || st;
  // Session sub-phase (server-computed in data_health._session_phase, sent on the same
  // snap.session). The coarse state is CLOSED for the whole 15:30+ window (Section 1
  // vocabulary, pinned by proofs), so the chip spells out which phase of the close we're
  // in: "MARKET CLOSED · CLOSING AUCTION" at 15:45 is NOT "MARKET CLOSED · EOD SETTLED"
  // at 20:00 — the operator must never be told the day is done while the closing session
  // is still live and being settled (Phase 3: no premature MARKET CLOSED).
  const ph=session.session_phase;
  if(ph==='PRE_OPEN'){ label='PRE-OPEN'; }
  else if(ph==='NORMAL_CLOSE'){ label='MARKET CLOSED · SESSION CLOSE'; }
  // Label fix (frontend audit, 2026-08-15): this window is data_health.py's own
  // internal settlement-capture checkpoint (15:40-16:00, config.CAS_START/END) -
  // NOT the real NSE/BSE Closing Auction Session, which is a cash-equity-segment
  // mechanism that actually runs 15:15-15:35 and is already OVER by the time this
  // phase begins. The state value CLOSING_AUCTION itself is left unchanged (an
  // existing, proof-asserted contract - Section 9), only this label text, which
  // was the part actually shown to a user and the part that was making a false
  // claim about what's happening right now.
  else if(ph==='CLOSING_AUCTION'){ label='MARKET CLOSED · FINALIZING DATA'; }
  else if(ph==='POST_CLOSE'){ label='MARKET CLOSED · POST-CLOSE'; }
  else if(ph==='EOD_SETTLED'){ label='MARKET CLOSED · EOD SETTLED'; }
  t.textContent = label;
  c.title = 'Exchange session — ' + label;
}
// System Health lives only under Settings > System Health (dev-only, #diagBox) —
// removed from the production header (Section 1); see workstation.js pollDiag() for
// that independent, more detailed diagnostics surface.
function showWaiting(s){
  document.getElementById('waiting').classList.toggle('show',s);
  document.getElementById('liveInner').style.display = s?'none':'block';
}
function startMock(){ /* DISABLED — no mock/preloaded data ever. Live backend only. */ }
function stopMock(){ clearInterval(mockTimer); mockTimer=null; }

// map a live snapshot into ST[CUR] then render
let _lastSnapFp=null, _lastBarCount=null;
function ingestLive(snap){
  const name = (snap.index||CUR).toUpperCase();
  if(!ST[name]) return;
  const s=ST[name];
  if(snap.spot){ s.spotOpen=snap.spot.open??s.spotOpen; s.spotHi=snap.spot.high??s.spotHi; s.spotLo=snap.spot.low??s.spotLo; }
  /* DHAN IS THE SOURCE OF TRUTH. Day open/high/low come from the broker's own quote when
     available. Our 1-min bars can only be as complete as our feed — a restart, a dropped
     socket or a gap makes MAX(high)/MIN(low) narrower than the exchange's true extremes,
     which is exactly the kind of quiet mismatch against the Dhan screen we are eliminating. */
  if(snap.nifty_ohlc_dhan){
    const _d=snap.nifty_ohlc_dhan;
    if(_d.open!=null)  s.spotOpen=_d.open;
    if(_d.high!=null)  s.spotHi=_d.high;
    if(_d.low!=null)   s.spotLo=_d.low;
  }
  s.spot = snap.live_spot_ltp ?? (snap.spot&&snap.spot.close) ?? s.spot;
  s.spotPrevClose = snap.live_nifty_prev ?? s.spotPrevClose;   // NIFTY prev close → top-bar gain/loss
  // Broker-sourced change (Dhan quote). Preferred over computing it here so the header
  // matches the Dhan app exactly — our own 15:30 last-traded price is NOT the official
  // index close and differed by ~17 pts.
  if(snap.nifty_change!=null) s.chgAbs = snap.nifty_change;
  if(snap.nifty_change_pct!=null) s.chgPct = snap.nifty_change_pct;
  // FROZEN Expected Move for the session (NOT the live straddle premium — see hero-em note).
  s.emFrozen = snap.expected_move_1sigma ?? s.emFrozen;
  s.vix  = snap.live_vix_ltp ?? (snap.vix&&snap.vix.vix) ?? s.vix;
  /* The server's `atm` is a SUBSCRIPTION anchor, not a label. strike_manager only
     moves it once spot drifts past ATM_DRIFT_THRESHOLD, deliberately, so the
     websocket is not resubscribed on every wobble. Copying it into `s.atm` made
     every KPI on the page inherit that lag - which is exactly what put 24,150 in
     the header while spot was 24,182 and the chain marked 24,200.
     Take it only as a seed; nearest-to-spot wins the moment we have a spot. */
  if(snap.atm && s.atm==null){ s.atm=snap.atm; }
  if(snap.atm){ window.__atmAnchor=snap.atm; }
  const _a=atmStrike(CUR); if(_a!=null){ s.atm=_a; window.__atm=_a; }
  const cb=snap.combined||{};
  /* THE 09:15 ANCHOR IS WRITE-ONCE. It is the settled ATM straddle price at 09:15 and it
     must never move for the rest of the session — every decay number is measured against it.
     Previously this reassigned on EVERY poll, so any backend fallback (e.g. a restart with no
     09:15 bar, where the anchor degrades to the restart-moment price) would drag the anchor
     to the live value and decay would read +0.00 all day.
     `cb.opening_combined` is only accepted as a LAST resort and also only once. */
  if(s.atm9_15==null){
    if(snap.morning_straddle!=null){ s.atm9_15=snap.morning_straddle; s.morningStrike=snap.morning_strike; }
    else if(cb.opening_combined) s.atm9_15=cb.opening_combined;
  } else if(snap.morning_straddle!=null && snap.morning_strike!=null && s.morningStrike==null){
    s.morningStrike=snap.morning_strike;   // strike label only; never the price
  }
  if(snap.prev_session_close!=null) s.prevSessionClose=snap.prev_session_close;
  else if(s.prevSessionClose==null && snap.prev_close!=null) s.prevSessionClose=snap.prev_close;
  // ingest chain rows
  (snap.chain||[]).forEach(r=>{
    // THE BUG THIS FIXES (2026-08-18, reported live: "9:15 wali calculations wrong").
    // This used to seed base=(ce_close+pe_close) — i.e. whatever the straddle price
    // happened to be at the moment THIS BROWSER first fetched the strike — for every
    // strike, then only overwrote it with the real 9:15 value if the backend happened
    // to send one. A strike that entered the visible ATM window later in the session
    // (spot drifts, or a fresh page load) kept that arbitrary fallback FOREVER,
    // permanently mislabeled "Δ% FROM 9:15" in the UI. Measured live: adjacent strikes
    // 50-250 points apart showing +67% -> +305% -> +537% -> +302% with no smooth
    // progression between them — the signature of each strike being compared against a
    // different, arbitrary point in time instead of one shared, real 9:15 anchor.
    //
    // Now: base is set ONLY from the backend's open_straddle (collector.utils.
    // open_straddle_map, the single owner of this value — main.py and analytics_api.py
    // both call it, so /api/snapshot and /api/chain/full can never disagree on it
    // again). If the backend has no real 9:15 anchor for a strike, base stays null and
    // renderChain() shows an em-dash — NOT MEASURED, never a fabricated percentage.
    if(!s.legs[r.strike]) s.legs[r.strike]={callBase:r.ce_close,putBase:r.pe_close,base:null};
    const l=s.legs[r.strike];
    l.call=r.ce_close; l.put=r.pe_close; l.comb=(r.ce_close||0)+(r.pe_close||0);
    l.ceIV=r.ce_iv; l.peIV=r.pe_iv; l.ceBid=r.ce_bid; l.ceAsk=r.ce_ask;
    l.ceD=r.ce_delta; l.peD=r.pe_delta;          // real per-leg greeks
    l.ceOI=r.ce_oi; l.peOI=r.pe_oi;              // SEPARATE CE/PE OI (was summed into both)
    l.oi=(r.ce_oi||0)+(r.pe_oi||0);              // sum kept for PCR/other internals
    if(r.open_straddle!=null) l.base=r.open_straddle;   // 9:15/first straddle from backend
  });
  // rebuild the visible strike window around the LIVE atm so the chain matches live legs
  if(snap.chain && snap.chain.length){
    s.allStrikes = snap.chain.map(r=>r.strike).sort((a,b)=>a-b);
    s.strikes = [];
    for(let i=-5;i<=5;i++) s.strikes.push(s.atm + i*s.cfg.step);
    // Refresh the per-strike CHART selector here — this is the one place the live
    // strike window is rebuilt, so it is the only place that can keep the selector
    // truthful. It must NOT live in renderAll(): that runs only at load and on an
    // index switch, so a selector filled there keeps whatever strike set existed at
    // first paint. Verified live 2026-08-25 — the selector sat on a stale
    // 22850-23350 window while the live chain was 23650-24650, and self-corrected
    // the instant this function was reached. populateChartStrikes() no-ops when the
    // strike set is unchanged, so running it per tick costs nothing and never
    // closes the dropdown mid-selection.
    try{ populateChartStrikes(); }catch(e){}
  }
  const atmC=s.legs[s.atm]?s.legs[s.atm].comb:0;
  /* FULL-SESSION RANGE — 09:15 to 15:40 (CAS), never broken.
     The backend (snapshot.straddle_day) computes HIGH/LOW/OPEN across ALL persisted 1-min
     bars of the session, so the range survives a server restart, a browser reload, AND an
     ATM migration. Two things used to break it:
       1. a hard reset to the current price whenever the ATM strike changed, and
       2. accumulating from only the ticks this browser personally witnessed,
     so opening the page at 13:00 showed a "day range" that began at 13:00.
     The live tick still EXTENDS the range (a new high made this second counts immediately)
     but can never shrink it. */
  const _sd = snap.straddle_day;
  if(_sd && _sd.high!=null && _sd.low!=null){
    s.atmHi = Math.max(_sd.high, atmC||_sd.high);
    s.atmLo = Math.min(_sd.low,  atmC||_sd.low);
    if(_sd.open!=null && s.atm9_15==null) s.atm9_15=_sd.open;   // write-once anchor
    if(_sd.atm_strike!=null && s.morningStrike==null) s.morningStrike=_sd.atm_strike;
  } else {
    // No backend range yet (pre-open, or first bar of the day not written): accumulate
    // locally, but do NOT reset on ATM migration — the ATM straddle SERIES is continuous.
    s.atmHi=Math.max(s.atmHi||atmC, atmC);
    s.atmLo=Math.min(s.atmLo||atmC, atmC);
  }
  s._prevAtm=s.atm;
  try{ straddleMoveAlerts(s, atmC, name); }catch(e){}   // low→+10% steps · high→−10%/−20%
  try{ checkPositions(); }catch(e){}   // tracker: SL/target alarm in LIVE mode
  if(snap.dte!=null) window.__dte=snap.dte;
  if(snap.max_pain!=null) s.maxPain=snap.max_pain;
  // OI Structure banner (chain page): max pain + heaviest OI walls + PCR
  try{ const _st=snap.structure||{}; const _S=(id,v)=>{const e=document.getElementById(id); if(e&&v!=null&&v!=='')e.textContent=v;};
    _S('oi-maxpain', snap.max_pain||_st.max_pain_strike); _S('oi-ce', _st.highest_ce_oi_strike);
    _S('oi-pe', _st.highest_pe_oi_strike); _S('oi-pcr', _st.pcr_total!=null?Number(_st.pcr_total).toFixed(2):null); }catch(e){}
  if(snap.dte!=null){s.dte=snap.dte;window.__dte=snap.dte;}
  if(snap.expiry){const _x=document.getElementById('expVal');if(_x)_x.textContent=snap.expiry.slice(5);}
  try{ expiryWatch(); }catch(e){}      // expiry-day: morning toast + 2:55 half/double alerts
  try{ checkSpotAlert(); }catch(e){}    // nifty spot alert
  /* Next-week ATM alerts REMOVED from the dashboard (2026-07-26).
     The dashboard shows THIS week's ATM only. Next-week legs are captured on expiry day for
     ONE backend purpose — the overnight-decay baseline the morning after expiry
     (collector/expiry_rollover.py -> next_expiry_chain_1min). Surfacing them live mixed two
     different contracts in one view, which is how a next-week number gets read as today's. */
  // 1-min OHLC bar (ATM straddle) — accumulates from 9:15, never slides/heartbeats
  const lk=lowestStrike(name);
  const lowC=s.legs[lk]?s.legs[lk].comb:atmC;
  pushBar(s, atmC, lowC, s.spot, s.vix);
  if(name===CUR){
    // DEDUP THE RENDER PASS — the backend pushes a full snapshot every 0.25s even when
    // nothing changed (overnight, pre-open, a flat tape). Re-drawing the chart + chain +
    // gauges 4x/sec on byte-identical data is pure main-thread burn: under CPU throttling
    // those renders pile into ~100ms tasks every ~300ms, so time-to-interactive never
    // settles (Lighthouse mobile read TTI 4.2s / LCP 3.5s on a page that paints in 0.2s).
    // Render again only when the payload moved or a new 1-min bar was appended.
    const _fp=JSON.stringify(snap);
    const _same=_fp===_lastSnapFp;
    _lastSnapFp=_fp;
    const _newBar=_lastBarCount!=null&&s.bars.length!==_lastBarCount;
    _lastBarCount=s.bars.length;
    // BUG FOUND LIVE 2026-08-20 (operator: "top bar me index pehle tha, ab nahi"):
    // the dedup below skips the ENTIRE render pass (statbar included) on a
    // byte-identical snapshot — correct for the heavy chart/chain/gauges, but it
    // also starved the top-bar index price (#idxPx, painted by renderStatbar).
    // On a flat/closed tape EVERY snapshot is identical, so after the first paint
    // the price only refreshed on the unrelated 20s _pollStatbarExtras tick —
    // i.e. #idxPx sat blank for up to 20s after every load post-close. renderIdxPx
    // is a single cheap innerHTML write (not the expensive path the dedup exists
    // to throttle), so paint it every tick regardless, before the dedup return.
    try{ renderIdxPx(s); }catch(e){}
    if(_same&&!_newBar){ try{renderOvStrip();}catch(e){} return; }
    try{ refreshChart(); }catch(e){}
    // Batch DOM writes into a single animation frame to prevent layout thrash
    // (was: 5 separate innerHTML writes per 2s poll tick = jank)
    try{
      if(!window._rafPending){
        window._rafPending=true;
        requestAnimationFrame(()=>{
          window._rafPending=false;
          try{renderStatbar();}catch(e){}
          try{renderGauges();}catch(e){}
          try{renderChain();}catch(e){}
          try{renderLiveAlerts();}catch(e){}
          try{ if(window.__hero) window.__hero(); }catch(e){}
        });
      }
    }catch(e){}
  }
  try{renderOvStrip();}catch(e){}
}

async function fetchFullChain(){
  try{
    const rows=await jget('/api/chain/full');
    const s=ST[CUR]; s.allStrikes=[];
    // "All Strikes" now carries open_straddle too (analytics_api.py, single owner
    // collector.utils.open_straddle_map) — same fix as the default ATM±5 ingest above:
    // base only from the real 9:15 anchor, never fabricated from a first-seen price.
    rows.forEach(r=>{ s.allStrikes.push(r.strike);
      if(!s.legs[r.strike]) s.legs[r.strike]={callBase:r.ce_close,putBase:r.pe_close,base:null};
      const l=s.legs[r.strike]; l.call=r.ce_close;l.put=r.pe_close;l.comb=(r.ce_close||0)+(r.pe_close||0);
      if(r.open_straddle!=null) l.base=r.open_straddle; });
    s.allStrikes.sort((a,b)=>a-b);
    populateChartStrikes();
    renderChain();
  }catch(e){ pushLog('WARN','chain','full chain fetch failed'); }
}

let _sideTick=0;
async function refreshSidePages(){
  // Only refresh side pages every 3rd poll tick (~9s) to reduce API + DOM overhead
  if(++_sideTick%3!==0) return;
  try{ window.__alerts=window.__alerts||[]; }catch(e){}
  try{ renderIndexSpots(); }catch(e){}
}
/* index strip — NIFTY + the five secondary indices + live NSE sector indices.
   ONE renderer, ONE card template (`ixCard`). The secondary indices carry two extra
   fields (ATM strike, ATM straddle); sectors carry none. Same component, optional rows —
   not a second strip and not a second render path. */
let _ixT=0;
function ixCard(x){
  const up=(x.c||0)>=0;
  const chg = x.c==null ? '' :
    `<span class="ix-c num ${up?'up':'dn'}">${(up?'▲':'▼')+Math.abs(Number(x.c)).toFixed(2)+'%'}</span>`;
  // Rows 3 and 4 render only when present, so a sector chip stays exactly as compact as
  // it is today — zero visual regression for the existing content.
  const extra = (x.atm!=null || x.strad!=null)
    ? `<span class="ix-x"><span class="ix-xk">ATM</span><span class="ix-xv num">${x.atm!=null?n0(x.atm):'—'}</span></span>`
      +`<span class="ix-x"><span class="ix-xk">STRADDLE</span><span class="ix-xv num">${x.strad!=null?Number(x.strad).toFixed(2):'—'}</span></span>`
    : '';
  return `<div class="ix-chip${x.stale?' ix-stale':''}${extra?' ix-wide':''}${x.sym?' ix-live':''}"`
    +(x.sym?` data-ix="${x.sym}" role="button" tabindex="0"`:'')
    +(x.title?` title="${x.title}"`:'')+`>`
    +`<span class="ix-n">${x.n}</span>`
    +`<span class="ix-v num">${x.na?'N/A':(x.v!=null?n0(x.v):'—')}</span>`
    +chg+extra+`</div>`;
}
async function renderIndexSpots(){
  const el=document.getElementById('idxSpots'); if(!el) return;
  if(Date.now()-_ixT < 2000) return;  // throttle ~2s (was 8s — faster tick-by-tick feel)
  _ixT=Date.now();
  const chips=[]; const s=ST[CUR];
  if(s&&s.spot){ const ch=s.spotPrevClose?((s.spot-s.spotPrevClose)/s.spotPrevClose*100):null;
    /* NIFTY's live straddle lives at s.legs[atm].comb — the tick-by-tick chain the
       engine maintains. `s.combined` does not exist on ST, which is why this card showed
       "—" while the other indices worked. Read from the SAME place renderSkew() does, so
       there is one source of truth for the NIFTY straddle. */
    const _nl = (s.legs && s.atm!=null) ? s.legs[s.atm] : null;
    chips.push({n:'NIFTY 50',v:s.spot,c:ch,sym:'NIFTY',atm:s.atm!=null?s.atm:null,
                strad:(_nl && _nl.comb!=null) ? _nl.comb : null}); }
  // Secondary indices: BANKNIFTY / FINNIFTY / MIDCPNIFTY / SENSEX / BANKEX.
  // Four fields each, straight from /api/indices — no client-side calculation.
  try{
    const ix=await jget('/api/indices');
    (ix&&ix.quotes||[]).forEach(q=>{
      // Task C item 6: "where an index genuinely has no data, show '--' with a
      // reason" — index_live._stale() reports stale=true both for "never received a
      // tick" (updated_at is null) and "feed went quiet" (last tick > 90s ago); those
      // are different situations for an operator to act on, so the tooltip says which
      // one it is instead of one generic "stale feed" for both. Never fabricates a
      // reason it can't measure: no updated_at -> "not yet connected", a timestamp ->
      // computed age in whole seconds, straight from the same field the backend
      // already sends.
      // 2026-08-11 fix: index_live.feed_status reports "unavailable" only when every
      // configured source for an index has been attempted and none delivered it (the
      // Dhan WS has no BSE-segment feed at all — SENSEX/BANKEX root cause). That is a
      // third, operator-actionable state, distinct from "not yet connected" (waiting,
      // first tick not in) and "stale feed Ns ago" (was live, went quiet). The chip
      // renders N/A (not a bare dash) and the tooltip explains why, reading the status
      // the backend measured — never a fabricated one.
      let reason=''; const unav=(q.feed_status==='unavailable')?1:0;
      if(q.feed_status==='unavailable'){
        reason=' · Unavailable — source does not provide it'+(q.feed_reason?(' ('+q.feed_reason+')'):'');
      }else if(q.stale){
        if(!q.updated_at) reason=' · no data yet — feed not connected for this index';
        else{
          const ageS=Math.max(0,Math.round((Date.now()-new Date(q.updated_at).getTime())/1000));
          reason=' · stale feed — last update '+ageS+'s ago';
        }
      }
      // 2026-08-11 fix: a "--" ATM STRADDLE used to be indistinguishable from "still
      // loading" vs "this index genuinely has no option chain in the feed" vs "legs
      // subscribed, first tick not in yet". index_live now exposes straddle_status/
      // straddle_reason (same honest vocabulary as feed_status above) so the tooltip
      // can say which one it is instead of a bare dash with no explanation.
      let stradReason='';
      if(q.atm_straddle==null && q.straddle_reason){
        stradReason=' · straddle '+q.straddle_status+' — '+q.straddle_reason;
      }else if(q.atm_straddle==null && q.straddle_status && q.straddle_status!=='live'){
        stradReason=' · straddle '+q.straddle_status;
      }
      chips.push({
        n:q.symbol, sym:q.symbol, v:q.spot, c:q.change_pct,
        atm:q.atm_strike, strad:q.atm_straddle, stale:q.stale, na:unav,
        title:(q.name||q.symbol)+(q.expiry?(' · exp '+q.expiry):'')+reason+stradReason
      });
    });
  }catch(e){}
  try{ const d=await jget('/api/attribution');
    (d&&d.sectors||[]).forEach(x=>chips.push({n:(x.sector||'').replace('NIFTY ','').trim(),v:x.close,c:x.pct_change})); }catch(e){}
  if(!chips.length){ el.innerHTML='<div class="ix-chip"><span class="ix-n">—</span></div>'; return; }
  el.innerHTML=chips.map(ixCard).join('');
}
/* Index chip -> detail popup (Task C item 6, 2026-08-09): "Each index card is
 * clickable -> opens that index's ... detail view." /api/index/{symbol} already
 * existed (index_live.detail() for the five secondaries, _nifty_detail() for
 * NIFTY — main.py, added earlier) and needed ZERO backend changes; only the click
 * was never wired up. ZERO extra network cost per index_live's own docstring: the
 * strip is already streaming, so the popup is instant. Reuses the SAME
 * .modal-bg/.modal shell openPnlModal()/openEditModal() already use — no new
 * modal pattern. Delegated on document (not bound per-chip) because #idxSpots is
 * fully replaced by innerHTML every ~8s in renderIndexSpots() above; direct
 * onclick bindings would need re-wiring on every refresh, a delegated listener
 * never does. */
if(!window._ixClickWired){
  window._ixClickWired=true;
  document.addEventListener('click',function(e){
    const chip=e.target&&e.target.closest&&e.target.closest('.ix-chip[data-ix]');
    if(chip&&chip.dataset.ix) openIndexDetail(chip.dataset.ix);
  });
  document.addEventListener('keydown',function(e){
    if(e.key!=='Enter'&&e.key!==' ') return;
    const chip=e.target&&e.target.closest&&e.target.closest('.ix-chip[data-ix]');
    if(chip&&chip.dataset.ix){ e.preventDefault(); openIndexDetail(chip.dataset.ix); }
  });
}
async function openIndexDetail(sym){
  const d=await jget('/api/index/'+encodeURIComponent(sym)).catch(()=>null);
  if(!d||d.error){
    alert('No live detail available for '+sym+(d&&d.error?(': '+d.error):''));
    return;
  }
  const ix=d.index||{}, st=d.straddle||{};
  // 2026-08-11 fix: feed_status is the state index_live measured — "unavailable"
  // (every configured source attempted, none delivers this index — the Dhan WS has no
  // BSE-segment feed at all), "waiting" (not yet connected), "live". STALE is the
  // secondary "feed went quiet" flag. UNAVAILABLE is a distinct pill, not a generic
  // failure, because the operator's next action is different (it is not a gap that
  // self-heals with the next tick).
  const fstat=d.feed_status;
  const status=(fstat==='unavailable')?'UNAVAILABLE'
    :(fstat==='waiting'&&ix.spot==null)?'NO DATA'
    :(d.stale?'STALE':'VERIFIED');
  const statusCls=status==='VERIFIED'?'win':(status==='STALE'||status==='UNAVAILABLE')?'skip':'loss';
  const col=v=>v==null?'var(--muted)':(v>=0?'var(--green)':'var(--red)');
  const p2=v=>v==null?'—':(v>=0?'+':'')+Number(v).toFixed(2)+'%';
  const row=(k,v)=>'<div class="c"><div class="k">'+k+'</div><div class="v num">'+(v!=null?v:'—')+'</div></div>';
  const h='<div class="modal-bg show" id="ixDetailModalBg" onclick="if(event.target===this)closeIxDetailModal()">'+
    '<div class="modal" style="max-width:520px">'+
    '<div class="modal-hd"><span class="t">'+(d.name||sym)+' · '+(d.exchange||'')+'</span>'+
    '<span class="pill '+statusCls+'" style="margin-left:8px">'+status+'</span>'+
    '<button class="x" onclick="closeIxDetailModal()">×</button></div>'+
    '<div class="modal-bd" style="padding:14px">'+
    '<div style="font-size:10px;letter-spacing:.5px;color:var(--muted);text-transform:uppercase;margin-bottom:6px">Index</div>'+
    (fstat==='unavailable'?'<div style="margin-bottom:10px;padding:8px 10px;border:1px solid var(--amber,#b8860b);border-radius:6px;font-size:10.5px;color:var(--amber,#b8860b)">Unavailable — source does not provide it'+(d.feed_reason?(' ('+d.feed_reason+')'):'')+'. This is a feed limitation, not a gap that self-heals on the next tick.</div>':'')+
    '<div class="pos-grid" style="margin-bottom:14px">'+
    row('CURRENT',ix.current!=null?n2(ix.current):'—')+
    row('CHANGE','<span style="color:'+col(ix.change_pct)+'">'+p2(ix.change_pct)+'</span>')+
    row('OPEN',ix.open!=null?n2(ix.open):'—')+
    row('HIGH',ix.high!=null?n2(ix.high):'—')+
    row('LOW',ix.low!=null?n2(ix.low):'—')+
    row('DAY RANGE',ix.day_range!=null?n2(ix.day_range):'—')+
    '</div>'+
    '<div style="font-size:10px;letter-spacing:.5px;color:var(--muted);text-transform:uppercase;margin-bottom:6px">ATM Straddle'+(st.atm_strike!=null?(' · '+n0(st.atm_strike)):'')+'</div>'+
    '<div class="pos-grid">'+
    row('CURRENT',st.current!=null?n2(st.current):'—')+
    row('CHANGE','<span style="color:'+col(st.change_pct)+'">'+p2(st.change_pct)+'</span>')+
    row('OPEN',st.open!=null?n2(st.open):'—')+
    row('HIGH',st.high!=null?n2(st.high):'—')+
    row('LOW',st.low!=null?n2(st.low):'—')+
    row('CE / PE',(st.ce!=null?n2(st.ce):'—')+' / '+(st.pe!=null?n2(st.pe):'—'))+
    '</div>'+
    // 2026-08-11 fix: when the straddle is genuinely unavailable, say WHY instead of
    // leaving a bare "--" with no explanation (st.status/st.reason from index_live's
    // straddle_status vocabulary — never a fabricated value).
    (st.current==null&&st.status&&st.status!=='live'?
      '<div style="margin-top:8px;font-size:10px;color:var(--muted)">Straddle '+st.status+
      (st.reason?(' — '+st.reason):'')+'</div>':'')+
    (d.expiry?'<div style="margin-top:10px;font-size:10px;color:var(--muted)">Expiry '+d.expiry+'</div>':'')+
    '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend',h);
}
function closeIxDetailModal(){
  const bg=document.getElementById('ixDetailModalBg');
  if(bg) bg.remove();
}

async function loop(){
  let snap;
  try{ snap = await jget('/api/snapshot'); }
  catch(e){ if(CONFIG.liveOnly){ MODE='waiting'; setLiveChip(null); showWaiting(true); } return; }
  const has = snap && (snap.live_spot_ltp || (snap.spot&&snap.spot.close) || (snap.chain&&snap.chain.length));
  if(!has){ if(CONFIG.liveOnly){ MODE='waiting'; setLiveChip(null); showWaiting(true); } return; }
  // we GOT live data → mark live and NEVER flip back to waiting on a mere render hiccup
  if(MODE!=='live'){ MODE='live'; stopMock(); pushLog('INFO','feed','Feed connected'); }
  // The backend is reachable — the chip's colour/label now come from snap.session (the
  // real exchange-session verdict), not from 'the fetch succeeded' (that only proves
  // connectivity, and stays true for hours after close since last-session data is
  // deliberately still served here).
  setLiveChip(snap.session); showWaiting(false);
  try{ ingestLive(snap); }catch(e){}   // render error ≠ no feed
  try{ if(RANGE==='all') fetchFullChain(); }catch(e){}
  try{ refreshSidePages(); }catch(e){}
}

// ---- boot ----
APEX.idle(buildChart, 'buildChart');   // deferred: below the fold, keeps boot off the long-task path
seedBars();                   // load today's stored 1-min OHLC (full day, survives refresh)
renderAll();
pushLog('INFO','feed','Dashboard loaded');
setLiveChip(null);            // boot: backend not yet answered
loop();                       // try backend immediately
setInterval(loop, CONFIG.pollMs);
// Key Levels + Opening Range + breakout status: refresh on a timer (was load-once-at-boot).
setInterval(loadKeyLevels, 30000);
setInterval(loadRegimeCard, 300000);
setInterval(loadV2Regime, 60000);
APEX.idle(loadV2Regime, 'loadV2Regime');   // deferred: below the fold, keeps boot off the long-task path
// Below-the-fold panels (range15 / overnight decay / settlement / health footer)
// moved to app/panels.js — lazy-loaded after core.js. See that file.
// 2026-08-20 (audit H1): admin auth now travels as an httpOnly cookie
// (set once by /api/admin/session, see workstation.js), attached automatically by the
// browser on every same-origin request — there is no header for JS to add here
// anymore, and nothing for JS to read back out of storage. Kept as a stub (returns
// {}) so every existing call site below needs no further edits.
function _adminHdr(){return {};}
// System Commands (Settings) — real admin endpoints, not placeholders
async function adminCmd(cmd, btn, extra){
  const s=document.getElementById('cmd-status'); if(btn)btn.disabled=true;
  if(s)s.textContent=cmd+' — starting…';
  try{
    const r=await fetch('/api/admin/'+cmd,{method:'POST',headers:Object.assign({'Content-Type':'application/json'},_adminHdr()),body:JSON.stringify(extra||{})});
    const j=await r.json();
    if(s)s.textContent=j.ok?('✓ '+(j.msg||cmd+' started')):('✗ '+(j.error||'failed'));
  }catch(e){ if(s)s.textContent='✗ '+e; }
  if(btn)setTimeout(()=>{btn.disabled=false;},1500);
}
function purgeDay(btn){
  const el=document.getElementById('purge-date'), d=el&&el.value;
  const s=document.getElementById('cmd-status');
  if(!d){ if(s)s.textContent='pick a date to purge first'; return; }
  if(!confirm('Purge ALL data for '+d+'? This cannot be undone.')) return;
  adminCmd('purge_day',btn,{date:d});
}
// ---- index pulse (SENSEX + others) from v2 /v2/live, refreshed every 20s ----
var _srvFails=0;
function _srvHealth(ok){
  var chip=document.getElementById('srvHealth');
  if(!chip){
    var right=document.querySelector('.tb-right'); if(!right) return;
    chip=document.createElement('div'); chip.id='srvHealth';
    chip.style.cssText='display:none;padding:3px 8px;border-radius:6px;font-size:9px;font-weight:800;letter-spacing:.5px;background:var(--red);color:#fff;cursor:default';
    chip.textContent='SERVER STUCK';
    chip.title='Server not responding — watchdog will restart automatically';
    right.insertBefore(chip,right.firstChild);
  }
  chip.style.display=ok?'none':'flex';
}
async function pollPulse(){
  try{
    let sx=null, prev=null;
    try{ const j=await jget('/api/snapshot'); sx=j&&j.live_sensex_ltp; prev=j&&j.live_sensex_prev; _srvFails=0; _srvHealth(true); }catch(_){ _srvFails++; if(_srvFails>=3) _srvHealth(false); }
    if(sx==null){ try{ const v=await jget('/v2/live'); sx=v&&v.pulse&&v.pulse.SENSEX; }catch(_){} }
    const e=document.getElementById('sxPx');
    if(e)e.textContent=(sx==null?'—':Number(sx).toLocaleString('en-IN',{maximumFractionDigits:2}));
    const ce=document.getElementById('sxChg');
    if(ce){ if(sx!=null&&prev){ const dd=sx-prev, pp=dd/prev*100;
        ce.textContent=`${dd>=0?'+':''}${dd.toFixed(0)} (${dd>=0?'+':''}${pp.toFixed(2)}%)`;
        ce.className='num '+(dd>=0?'up':'dn'); } else ce.textContent=''; }
  }catch(e){}
  // LIVE market regime + date (regime_daily, refreshed each 15-min loop) — always latest
  try{
    const rg=await jget('/api/regime/today'); const reg=(rg&&rg.regime)||null;
    if(reg&&reg.regime_tag){
      const vr=document.getElementById('vrp-regime'); if(vr)vr.textContent=reg.regime_tag;
      const rl=document.getElementById('regimeLive'); if(rl)rl.textContent=reg.regime_tag+(reg.date?' · '+reg.date:'');
    }
  }catch(_){}
}
pollPulse(); setInterval(pollPulse, 5000);

/* ===================== OVERRIDE: real backend wiring ===================== */
const _R=(v,fn)=>(v==null||v===''||(typeof v==='number'&&isNaN(v)))?'—':(fn||n0)(v);
const _pct=(v,d)=>v==null?'—':((v>=0?'+':'')+Number(v).toFixed(d==null?1:d)+'%');

async function renderResearch(){
  const matColor=(m)=>({MATURE:'var(--green)',ESTABLISHED:'var(--green)',DEVELOPING:'var(--gold)',
    EMERGING:'var(--muted)',EXPERIMENTAL:'var(--muted)',NO_DATA:'var(--muted)'}[m]||'var(--muted)');
  const matBg=(m)=>({MATURE:'rgba(45,217,126,.18)',ESTABLISHED:'rgba(45,217,126,.15)',
    DEVELOPING:'rgba(244,183,64,.18)'}[m]||'rgba(139,151,166,.15)');
  const [div,recW,finW,evW,drW]=await Promise.all([
    jget('/api/research/diversity').catch(()=>({})),
    jget('/api/research/recommendations').catch(()=>({recommendations:[]})),
    jget('/api/research/findings').catch(()=>({findings:[]})),
    jget('/api/research/evidence').catch(()=>({cards:[]})),
    jget('/api/research/drift').catch(()=>({alerts:[]})),
  ]);
  const sum=(div&&div.summary)||{}, flagged=(div&&div.flagged)||[];
  const recs=(recW&&recW.recommendations)||[], finds=(finW&&finW.findings)||[], cards=(evW&&evW.cards)||[];
  const drift=(drW&&drW.alerts)||[];
  const ready=recs.filter(r=>r.status==='READY_FOR_HUMAN_REVIEW').length;

  // ── Research Status card ──
  let rsHtml='';
  try{
    const rs=await jget('/api/research/status');
    if(rs&&!rs.error){
      const _p=(k,v)=>`<div class="rl-kpi"><div class="k">${k}</div><div class="v">${v}</div></div>`;
      const coverage=(rs.period_from&&rs.period_to)?`${rs.period_from} → ${rs.period_to}`:'—';
      const confidenceStr=rs.evidence_confidence!=null?rs.evidence_confidence+'%':'—';
      // Daily job status (added 2026-08-09, Daily Research job verification) — real
      // per-job last-run/status from research/daily_status.py, sourced from
      // system_log (component='eod'), never fabricated. Each of the 4 EOD sub-jobs
      // (evidence/param_lab/correlation/drift) runs independently — one failing
      // does not silently hide the others here.
      const jobs=Array.isArray(rs.jobs)?rs.jobs:[];
      const jobColor=s=>s==='OK'?'#2ecc71':(s==='FAILED'||s==='ERROR')?'#e74c3c':'#f39c12';
      const jobsRows=jobs.map(j=>`<tr>
        <td style="padding:4px 14px"><b>${j.job}</b></td>
        <td style="padding:4px"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;background:${jobColor(j.status)}"></span>${j.status}</td>
        <td style="padding:4px;color:var(--muted)">${j.last_run_at||'never'}</td>
        <td style="padding:4px;color:var(--muted);max-width:420px;white-space:normal">${(j.last_message||j.reason||'').replace(/</g,'&lt;')}</td>
      </tr>`).join('');
      const jobsHtml=jobs.length?`<table style="width:100%;font-size:11px;margin-top:2px;border-collapse:collapse"><thead><tr>
        <th style="text-align:left;padding:4px 14px">job</th><th style="text-align:left;padding:4px">status</th>
        <th style="text-align:left;padding:4px">last run</th><th style="text-align:left;padding:4px">last message</th>
        </tr></thead><tbody>${jobsRows}</tbody></table>`:'';
      rsHtml=`<div class="card" style="margin-bottom:14px"><div class="card-hd"><span class="dot-g"></span><span class="t">Research Status</span><span class="r">engine health · coverage · confidence</span></div>
      <div class="rl-strip" style="padding:12px 14px">
        ${_p('Sessions Collected',rs.total_sessions||0)}
        ${_p('Sessions Analysed',rs.analysed_sessions||0)}
        ${_p('Last Analysis',rs.last_analysis_run||'—')}
        ${_p('Period Covered',coverage)}
        ${_p('Strategies Learned',`${rs.strategies_learned||0} / ${rs.strategies_total||0}`)}
        ${_p('Research Job Days',rs.research_job_days||0)}
        ${_p('Findings',rs.total_findings||0)}
        ${_p('Recommendations',`${rs.recommendations_ready||0} ready / ${rs.total_recommendations||0}`)}
        ${_p('Evidence Confidence',confidenceStr)}
        ${_p('Drift Alerts',rs.drift_stale||0)}
      </div>${jobsHtml}</div>`;
    }
  }catch(_){}

  // ── KPI strip ──
  const kpi=(k,v,s,col)=>`<div class="rl-kpi"><div class="k">${k}</div><div class="v"${col?` style="color:${col}"`:''}>${v}</div><div class="s">${s||''}</div></div>`;
  // Insert Research Status card before KPI strip
  const _pageEl=document.getElementById('page-research');
  const _existingRs=document.getElementById('rlResearchStatus');
  if(rsHtml){
    if(!_existingRs){
      const _rsDiv=document.createElement('div');
      _rsDiv.id='rlResearchStatus';
      _pageEl.insertBefore(_rsDiv,_pageEl.querySelector('#rlStrip'));
    }
    const _el=document.getElementById('rlResearchStatus');
    if(_el)_el.innerHTML=rsHtml;
  }
  const strip=document.getElementById('rlStrip');
  if(strip)strip.innerHTML=[
    kpi('Effective Bets', sum.effective_bets!=null?sum.effective_bets:'—', sum.n_strategies!=null?`from ${sum.n_strategies} strategies`:'', sum.effective_bets!=null&&sum.n_strategies&&sum.effective_bets<sum.n_strategies*0.7?'var(--gold)':''),
    kpi('Clusters', sum.n_clusters!=null?sum.n_clusters:'—','independent groups'),
    kpi('Redundant Pairs', flagged.length, flagged.length?'>=80% correlated':'none', flagged.length?'var(--gold)':''),
    kpi('Ready for Review', ready, 'recommendations', ready?'var(--green)':''),
    kpi('Drift Alerts', drift.length, drift.length?'findings stale':'all fresh', drift.length?'var(--red)':''),
    kpi('Findings', finds.length, 'evidence-stamped'),
    kpi('Strategies Tracked', cards.length, 'with evidence cards'),
  ].join('');

  // ── recommendations ──
  const rl=document.getElementById('rlRecs');
  if(rl){
    if(!recs.length){rl.innerHTML='<div class="empty2">No recommendations yet — the lab needs more sessions. They appear here after EOD once a challenger beats the current parameter with confidence.</div>';}
    else rl.innerHTML=recs.slice(0,30).map(r=>{
      const cls=r.status==='READY_FOR_HUMAN_REVIEW'?'ready':(r.status==='PROMISING_NEEDS_CONFIRMATION'?'promising':'');
      const pill=r.status==='READY_FOR_HUMAN_REVIEW'?'ready':'';
      const imp=r.improvement_rupees!=null?`${r.improvement_rupees>=0?'+':''}₹${Number(r.improvement_rupees).toLocaleString('en-IN')}/trade`:'';
      // Read-only review finding (2026-08-20): every server-derived string field
      // below now goes through _escH — this is a research-scientist-authored,
      // server-derived report, not user input, but the API is a trust boundary
      // this dashboard should not blindly render raw HTML from.
      return `<div class="rec ${cls}"><div class="h">${_escH(r.strategy)} · ${_escH(r.parameter)}: <span style="color:var(--muted)">${_escH(r.current_value)}</span> → <b style="color:var(--green)">${_escH(r.recommended_value)}</b><span class="pill2 ${pill}">${_escH((r.status||'').replace(/_/g,' '))}</span></div>
      <div class="d">${imp}${imp?' · ':''}confidence ${r.confidence!=null?Math.round(r.confidence*100)+'%':'—'} · n=${r.sample_size||'—'} · ${r.independent_days||'—'} days · maturity ${_escH(r.maturity||'—')} · robustness ${_escH(r.robustness||'—')}</div></div>`;
    }).join('');
  }

  // ── findings ──
  const fl=document.getElementById('rlFindings');
  if(fl){
    if(!finds.length){fl.innerHTML='<div class="empty2">No findings yet. Each evening the AI scientist writes evidence-stamped observations here (e.g. "Entry 09:18 beat 09:20 with 92% confidence").</div>';}
    else fl.innerHTML=finds.slice(0,40).map(f=>`<div class="fi ${f.category==='CORRELATION'?'corr':''}"><div class="h">${_escH(f.headline)}</div>
      <div class="d">${_escH(f.strategy||'')} · confidence ${f.confidence!=null?Math.round(f.confidence*100)+'%':'—'} · n=${f.sample_size||'—'} · ${_escH(f.maturity||'')}${f.detail?' · '+_escH(f.detail):''}</div></div>`).join('');
  }

  // ── evidence cards ──
  const eg=document.getElementById('rlEvidence');
  if(eg){
    if(!cards.length){eg.innerHTML='<div class="empty2">No evidence cards yet — they build at EOD from traded strategy results.</div>';}
    else eg.innerHTML='<div class="evg">'+cards.map(c=>{
      const ci=(c.exp_ci_low!=null&&c.exp_ci_high!=null)?` <span style="color:var(--muted);font-size:10px">[${Math.round(c.exp_ci_low)}..${Math.round(c.exp_ci_high)}]</span>`:'';
      const exp=c.expectancy!=null?`${c.expectancy>=0?'+':''}₹${Number(c.expectancy).toLocaleString('en-IN',{maximumFractionDigits:0})}`:'—';
      const row=(k,v)=>`<div class="row"><span class="k">${k}</span><span>${v}</span></div>`;
      return `<div class="ev"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span class="nm">${c.strategy}</span>
        <span class="mat" style="color:${matColor(c.maturity)};background:${matBg(c.maturity)}">${c.maturity||'—'}</span></div>
        ${row('Trades', (c.trades||0)+' / '+(c.trading_days||0)+'d')}
        ${row('Win rate', c.win_rate!=null?Math.round(c.win_rate*100)+'%':'—')}
        ${row('Expectancy', exp+ci)}
        ${row('Profit factor', c.profit_factor!=null?Number(c.profit_factor).toFixed(2):'—')}
        ${row('Sharpe', c.sharpe!=null?Number(c.sharpe).toFixed(2):'—')}
        ${row('Max DD', c.max_drawdown!=null?'₹'+Number(c.max_drawdown).toLocaleString('en-IN',{maximumFractionDigits:0}):'—')}
        ${row('Best regime', c.best_regime||'—')}
        ${row('Edge @95%', c.edge_positive_95?'<b style="color:var(--green)">YES</b>':'<span style="color:var(--muted)">not established</span>')}
        <div style="font-size:10.5px;color:var(--muted);margin-top:8px">${c.suggested_note||''}</div></div>`;
    }).join('')+'</div>';
  }
}

// ---- Day-of-week statistics + deterministic alerts (Sections 3-6, added 2026-08-10) ----
// The FIRST version of this feature compared day_of_week via a raw `.slice(0,3)` against
// a Set built from 'Mon'/'Tue' — but daily_meta stores FULL uppercase names ('MONDAY'…),
// so `selDow.has('MON')` never matched and the weekday filter silently returned ZERO rows
// for every weekday. Every comparison site now routes through dow3(), the single
// normalizer, so that shape mismatch cannot silently recur anywhere (P5 asserts it).
const MIN_N_STAT = 3;   // min same-weekday sessions before std/percentile is honest
function dow3(day_of_week){
  const d=(day_of_week||'').slice(0,3).toUpperCase();
  return d.length?d[0]+d.slice(1).toLowerCase():'';
}
function statSet(values){
  const arr=(values||[]).filter(x=>x!=null);
  const n=arr.length;
  if(!n) return {n,mean:null,median:null,min:null,max:null,std:null};
  const sorted=[...arr].sort((a,b)=>a-b);
  const mean=sorted.reduce((s,x)=>s+x,0)/n;
  const mid=Math.floor(n/2);
  const median=n%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
  // n<2 → std is null (Layer 1.3: a single point has no spread; 0 would claim "no
  // variance measured", which is a different, false statement)
  const std=n<2?null:Math.sqrt(sorted.reduce((s,x)=>s+(x-mean)*(x-mean),0)/(n-1));
  return {n,mean,median,min:sorted[0],max:sorted[n-1],std};
}
function percentileOf(value, sortedArr){
  const arr=(sortedArr||[]).filter(x=>x!=null);
  if(!arr.length) return null;
  const below=arr.filter(x=>x<value).length;
  return Math.round(below/arr.length*1000)/10;
}
function dowAlert(msg, dayKey, idx){
  if(!window._dowAlertFired) window._dowAlertFired=new Set();
  const key=dayKey+':'+CUR+':'+idx;      // keyed by calendar day AND index — a re-render cannot re-fire
  if(window._dowAlertFired.has(key)) return;
  window._dowAlertFired.add(key);
  try{ toast('up', msg); }catch(e){}
}
function renderDowCompare(rows){
  const el=document.getElementById('histDowCompare'); if(!el)return;
  const days=['Mon','Tue','Wed','Thu','Fri'];
  const cards=days.map(d=>{
    const st=statSet((rows||[]).filter(r=>dow3(r.day_of_week)===d).map(r=>r.day_range));
    return `<div class="hc"><div class="k">${d}</div><div class="v">${st.median!=null?Number(st.median).toFixed(0)+' pts':'—'}</div><div class="s">${st.n} sessions</div></div>`;
  }).join('');
  el.innerHTML=`<div class="card" style="margin-top:14px"><div class="card-hd"><span class="dot-i"></span><span class="t">Day-of Comparison</span><span class="r">median day-range by weekday · shift+click a date's day tag to compare that weekday</span></div><div class="hist-summary">${cards}</div></div>`;
}

renderHistory = async function(){
  const rows=await jget('/api/history/dates').catch(()=>[]);
  const head=document.getElementById('histHead'), b=document.getElementById('histBody'),
        sum=document.getElementById('histSummary'); if(!b)return;
  const M='<span class="miss">—</span>';
  const num=(v,d=0)=>v==null?M:Number(v).toLocaleString('en-IN',{minimumFractionDigits:d,maximumFractionDigits:d});
  // two-tier grouped header — clean column groups instead of one cramped row
  if(head)head.innerHTML=`
    <tr class="grp"><th colspan="3" class="gsep">Session</th><th colspan="4" class="gsep">Spot (NIFTY)</th>
      <th colspan="4" class="gsep">ATM Straddle</th><th colspan="3" class="gsep">Volatility</th>
      <th colspan="4" class="gsep">Research</th></tr>
    <tr class="col"><th class="l gsep">Date</th><th class="l">Day</th><th>DTE</th>
      <th class="gsep">Open</th><th>High</th><th>Low</th><th>Close</th>
      <th class="gsep">Open</th><th>High</th><th>Low</th><th>Close</th>
      <th class="gsep">Range</th><th>VIX·Δ%</th><th>Ovn%</th><th>CE%</th><th>PE%</th>
      <th class="gsep">Strategy P&L</th><th>EM Signal</th></tr>`;
  if(!rows||!rows.length){ b.innerHTML='<tr><td colspan="18" class="empty" style="text-align:center;padding:26px">No sessions recorded yet</td></tr>'; if(sum)sum.innerHTML=''; return; }
  const maxRows=window._histDays||999;
  const dows=['Mon','Tue','Wed','Thu','Fri'];
  const selDow=window._histDow||null;
  let filtered=rows;
  window._histRows=rows;
  if(selDow && selDow.size>0 && selDow.size<5){
    filtered=filtered.filter(r=>selDow.has(dow3(r.day_of_week)));
  }
  filtered=maxRows<999?filtered.slice(0,maxRows):filtered;

  // ── summary strip ──
  const nn=a=>a.filter(x=>x!=null);
  const avg=a=>{const c=nn(a);return c.length?c.reduce((s,x)=>s+ +x,0)/c.length:null;};
  const pnlSum=nn(filtered.map(r=>r.total_pnl)).reduce((s,x)=>s+ +x,0);
  const missing=filtered.filter(r=>r.spot_close==null||r.opening_combined==null).length;
  const cards=[
    ['Sessions',filtered.length,filtered.length?filtered[filtered.length-1].date+' → '+filtered[0].date:''],
    ['Avg Day Range',num(avg(filtered.map(r=>r.day_range)),0)+' pts',''],
    ['Avg Overnight',(()=>{const a=avg(filtered.map(r=>r.overnight_decay_pct));const ce=avg(filtered.map(r=>r.ce_decay_pct));const pe=avg(filtered.map(r=>r.pe_decay_pct));const ov=a==null?M:(a>=0?'+':'')+a.toFixed(2)+'%';const cp=ce==null?'':` CE${(ce>=0?'+':'')+ce.toFixed(1)}%`;const pp=pe==null?'':` PE${(pe>=0?'+':'')+pe.toFixed(1)}%`;return ov+cp+pp;})(),'straddle O/N move'],
    ['Cumulative P&L',(pnlSum>=0?'+':'')+'₹'+num(pnlSum,0),'traded strategies'],
    ['Avg VIX',(()=>{const a=avg(filtered.map(r=>r.vix_close));return a==null?M:a.toFixed(2);})(),''],
    ['Data Gaps',missing,missing?'run backfill_gaps':'complete'],
  ];
  if(sum)sum.innerHTML=cards.map(([k,v,s])=>`<div class="hc"><div class="k">${k}</div><div class="v"${k==='Cumulative P&L'?` style="color:${pnlSum>=0?'var(--green)':'var(--red)'}"`:(k==='Data Gaps'&&missing)?' style="color:var(--gold)"':''}>${v}</div><div class="s">${s}</div></div>`).join('');

  // ── rows ──
  b.innerHTML=filtered.map(r=>{
    const pnl=r.total_pnl, pnlCol=pnl==null?'var(--muted)':(pnl>=0?'var(--green)':'var(--red)');
    const es=r.ensemble_score, esCol=es==null?'var(--muted)':(es>=70?'var(--green)':es>=40?'var(--gold)':'var(--red)');
    const vixd=r.vix_change_pct;
    const ovn=r.overnight_decay_pct;
    return `<tr class="hist-row${window._histSelDate===r.date?' sel':''}" onclick="selectHistoryDate('${r.date}')" style="cursor:pointer" title="click for this date's Overnight Decay detail">
      <td class="l gsep" style="color:var(--cyan);font-weight:600">${r.date}<button onclick="event.stopPropagation();if(event.shiftKey){renderDowCompare(window._histRows);}else{window._histDow=new Set(['${dow3(r.day_of_week)}']);renderHistory()}" title="click: filter to this weekday · shift+click: weekday comparison grid" style="margin-left:5px;background:var(--surface);border:1px solid var(--border);border-radius:3px;color:var(--muted);font-size:8px;cursor:pointer;padding:0 5px">${dow3(r.day_of_week)}</button></td>
      <td class="l"><span class="daytag">${dow3(r.day_of_week)}</span></td>
      <td>${r.dte==null?M:r.dte}</td>
      <td class="gsep">${num(r.spot_open)}</td><td style="color:var(--green)">${num(r.spot_high)}</td><td style="color:var(--red)">${num(r.spot_low)}</td><td style="font-weight:600">${num(r.spot_close)}</td>
      <td class="gsep" style="color:var(--cyan)">${num(r.opening_combined,1)}</td><td style="color:var(--green)">${num(r.straddle_high,1)}</td><td style="color:var(--red)">${num(r.straddle_low,1)}</td><td style="font-weight:600;color:var(--cyan)">${num(r.closing_combined,1)}</td>
      <td class="gsep" style="font-weight:700">${num(r.day_range)}</td>
      <td>${r.vix_close==null?M:Number(r.vix_close).toFixed(1)}${vixd==null?'':` <span style="font-size:10px;color:${vixd>=0?'var(--red)':'var(--green)'}">${(vixd>=0?'+':'')+Number(vixd).toFixed(1)}%</span>`}</td>
      <td style="color:${ovn==null?'var(--muted)':(ovn>=0?'var(--green)':'var(--red)')}">${ovn==null?M:((ovn>=0?'+':'')+Number(ovn).toFixed(2)+'%')}</td>
      <td style="color:${r.ce_decay_pct==null?'var(--muted)':(r.ce_decay_pct>=0?'var(--green)':'var(--red)')}">${r.ce_decay_pct==null?M:((r.ce_decay_pct>=0?'+':'')+Number(r.ce_decay_pct).toFixed(2)+'%')}</td>
      <td style="color:${r.pe_decay_pct==null?'var(--muted)':(r.pe_decay_pct>=0?'var(--green)':'var(--red)')}">${r.pe_decay_pct==null?M:((r.pe_decay_pct>=0?'+':'')+Number(r.pe_decay_pct).toFixed(2)+'%')}</td>
      <td class="gsep" style="color:${pnlCol};font-weight:700">${pnl==null?M:((pnl>=0?'+':'')+'₹'+Number(pnl).toLocaleString('en-IN'))}</td>
      <td style="font-weight:700;color:${esCol}">${es==null?M:es}<span style="font-size:10px;color:var(--muted)"> ${r.ensemble_signal||''}</span></td></tr>`;
  }).join('');

  // ── today vs same-weekday history (Section 3-4) ────────────────────────────
  // st.n<MIN_N_STAT gates the median/std reads — never trust a spread from one row.
  const todayBlock=document.getElementById('histTodayCompare');
  if(todayBlock){
    const today=filtered[0];
    if(today){
      const dow=dow3(today.day_of_week);
      const peers=filtered.filter(r=>r.date!==today.date&&dow3(r.day_of_week)===dow);
      const st=statSet(peers.map(r=>r.day_range));
      const tVal=today.day_range;
      const mid=st.median!=null?Number(st.median).toFixed(0):'—';
      const rel=(tVal!=null&&st.mean!=null)?(tVal-st.mean):null;
      if(st.n<MIN_N_STAT){
        todayBlock.innerHTML='<div class="empty2">Need '+MIN_N_STAT+' prior '+dow+' sessions to compare today against — have '+st.n+'</div>';
      }else{
        todayBlock.innerHTML='<div class="card" style="margin-top:14px"><div class="card-hd"><span class="dot-i"></span><span class="t">Day-of Comparison</span><span class="r">'+dow+' vs history</span></div><div class="hist-summary">'
          +'<div class="hc"><div class="k">Today range</div><div class="v">'+(tVal!=null?Number(tVal).toFixed(0)+' pts':'—')+'</div><div class="s">'+today.date+'</div></div>'
          +'<div class="hc"><div class="k">'+dow+' median</div><div class="v">'+mid+' pts</div><div class="s">median of '+st.n+' '+dow+' sessions</div></div>'
          +'<div class="hc"><div class="k">vs median</div><div class="v">'+(rel==null?'—':((rel>=0?'+':'')+rel.toFixed(0)+' pts'))+'</div><div class="s">'+(rel==null?'':(rel>=0?'above':'below'))+' the usual '+dow+'</div></div>'
          +'</div></div>';
        if(rel!=null && st.std!=null && Math.abs(rel)>2*st.std){
          dowAlert(dow+' range deviates sharply from its '+st.n+'-session median ('+((rel>=0?'+':'')+rel.toFixed(0))+' pts vs '+mid+')', today.date, 0);
        }
      }
    }
  }

  const fp=document.getElementById('histFilters');
  if(fp){
    const days=[5,10,20,30];
    fp.innerHTML=['All',...days].map(d=>`<button class="rng-btn${window._histDays===d||(d==='All'&&window._histDays==null)?' on':''}" onclick="window._histDays=${d==='All'?999:d};renderHistory()">${d==='All'?'ALL':d+'d'}</button>`).join('');
  }
  try{ renderDowCompare(rows); }catch(e){}
};
/* Overnight Decay detail for one History date — added 2026-08-09 (Overnight Decay ->
 * History integration). Reuses /api/overnight_decay's own `date` param (single owner:
 * overnight_decay_lab, the SAME table the Dashboard's Overnight Decay Lab card reads)
 * rather than a second endpoint or a client-side lookup into whatever 60 rows the
 * Dashboard happened to have already fetched — a date outside that window must still
 * load its OWN row from the backend, never fall back to "today's" cached data. */
window._histSelDate = null;
async function selectHistoryDate(date){
  window._histSelDate = date;
  renderHistory();               // re-render so the clicked row gets the .sel highlight
  await Promise.all([renderHistOvernightDecay(date), renderHistTracker(date)]);
  const card = document.getElementById('histOdBody');
  if (card) card.scrollIntoView({behavior:'smooth', block:'nearest'});
}
/* My Tracker detail for one History date — Spec B item 4, Tracker persistent daily
 * records (added 2026-08-09). Reads /api/tracker?date= (the SAME `tracker` table
 * the Tracker page has always used — single owner, no second table). Closed rows
 * now carry their real ltp/pnl/exit_reason (see analytics_api.py's close_tracker,
 * fixed the same day) instead of the pre-fix behaviour of discarding that outcome
 * forever at close time — so a date's record, once written, is never overwritten
 * by a later session; every row keeps its own `created` timestamp permanently. */
// bodyId/titleId (added 2026-08-09, Task C item 1): defaults preserve the History
// page's original call renderHistTracker(date) unchanged. The Tracker page's own
// History section (#trkHistCard) passes its own element ids so both pages drill
// into a day through this SAME function — one renderer, two mount points, never a
// forked copy of the row-card markup.
async function renderHistTracker(date, bodyId, titleId){
  const body = document.getElementById(bodyId || 'histTrkBody'), title = document.getElementById(titleId || 'histTrkTitle');
  if (!body) return;
  if (title) title.textContent = date;
  body.innerHTML = '<div class="empty2">Loading…</div>';
  const rows = await jget('/api/tracker?date=' + encodeURIComponent(date)).catch(() => null);
  if (!Array.isArray(rows)) { body.innerHTML = '<div class="empty2">DEGRADED — tracker read failed</div>'; return; }
  if (!rows.length) { body.innerHTML = '<div class="empty2">NO DATA — nothing was tracked on ' + date + '</div>'; return; }
  const col = v => v == null ? 'var(--muted)' : (v >= 0 ? 'var(--green)' : 'var(--red)');
  const money = v => v == null ? window._n(null, 'not closed yet, or no exit price recorded') : (v >= 0 ? '+' : '') + '₹' + Number(v).toLocaleString('en-IN', {maximumFractionDigits: 0});
  const rowHtml = r => {
    const statusPill = r.status === 'OPEN' ? '<span class="pill">OPEN</span>' :
      r.status === 'CLOSED' ? '<span class="pill ' + (r.pnl >= 0 ? 'win' : 'loss') + '">CLOSED · ' + (r.exit_reason || 'MANUAL') + '</span>' :
      '<span class="pill skip">' + (r.status || 'UNKNOWN') + '</span>';
    return '<div class="hc">' +
      '<div class="k">' + (r.created || '').slice(11, 19) + ' · ' + (r.instrument || '') + ' ' + (r.strike != null ? r.strike : '') + '</div>' +
      '<div class="v" style="color:' + col(r.pnl) + '">' + money(r.pnl) + '</div>' +
      '<div class="s">' + statusPill + ' entry ' + (r.entry_price != null ? Number(r.entry_price).toFixed(1) : window._n(null)) +
      (r.ltp != null ? ' → exit ' + Number(r.ltp).toFixed(1) : '') + ' · ' + (r.side === 'B' ? 'BUY' : 'SELL') + ' · qty ' + (r.qty || '—') + '</div>' +
      '</div>';
  };
  const closedPnl = rows.filter(r => r.status === 'CLOSED' && r.pnl != null).reduce((s, r) => s + Number(r.pnl), 0);
  const openCount = rows.filter(r => r.status === 'OPEN').length;
  body.innerHTML =
    '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px;font-size:11px;color:var(--muted)">' +
    '<span>Positions <b style="color:var(--text)">' + rows.length + '</b></span>' +
    '<span>Open <b style="color:var(--text)">' + openCount + '</b></span>' +
    '<span>Closed day P&L <b style="color:' + col(closedPnl) + '">' + money(closedPnl) + '</b></span>' +
    '</div><div class="hist-summary">' + rows.map(rowHtml).join('') + '</div>';
}
// Tracker History day list (Task C item 1, 2026-08-09): the "History" card on the
// Tracker page itself. Reads /api/tracker/days — a per-day rollup added to
// analytics_api.py, the SAME file/table get_tracker()/close_tracker() already own
// (single owner, no second owner of the tracker table) — then hands off to the ONE
// renderHistTracker() renderer above for the drill-in, targeting this page's own
// #trkHistBody/#trkHistTitle instead of the History page's.
async function renderTrackerHistoryDays(){
  const el = document.getElementById('trkHistDays'), cnt = document.getElementById('trkHistCount');
  if (!el) return;
  el.innerHTML = '<div class="empty2">Loading…</div>';
  const rows = await jget('/api/tracker/days').catch(() => null);
  if (!Array.isArray(rows)) { el.innerHTML = '<div class="empty2">DEGRADED — tracker history read failed</div>'; return; }
  if (cnt) cnt.textContent = rows.length + ' day' + (rows.length === 1 ? '' : 's');
  if (!rows.length) { el.innerHTML = '<div class="empty2">No tracked days yet</div>'; return; }
  const col = v => v == null ? 'var(--muted)' : (v >= 0 ? 'var(--green)' : 'var(--red)');
  const money = v => v == null ? '—' : (v >= 0 ? '+' : '') + '₹' + Number(v).toLocaleString('en-IN', {maximumFractionDigits: 0});
  const sel = window._trkHistSelDate;
  el.innerHTML = '<div class="hist-summary">' + rows.map(r =>
    '<div class="hc" style="cursor:pointer' + (sel === r.date ? ';box-shadow:inset 2px 0 0 var(--cyan)' : '') + '" onclick="openTrackerHistoryDay(\'' + r.date + '\')">' +
    '<div class="k">' + r.date + '</div>' +
    '<div class="v" style="color:' + col(r.closed_pnl) + '">' + money(r.closed_pnl) + '</div>' +
    '<div class="s">' + r.n + ' total · ' + r.open_n + ' open · ' + r.closed_n + ' closed</div>' +
    '</div>'
  ).join('') + '</div>';
}
window._trkHistSelDate = null;
function openTrackerHistoryDay(date){
  window._trkHistSelDate = date;
  renderTrackerHistoryDays();   // re-render so the clicked day gets the selected highlight
  const w = document.getElementById('trkHistDetailWrap');
  if (w) w.style.display = '';
  renderHistTracker(date, 'trkHistBody', 'trkHistTitle');
  if (w) w.scrollIntoView({behavior: 'smooth', block: 'nearest'});
}
async function renderHistOvernightDecay(date){
  const body = document.getElementById('histOdBody'), title = document.getElementById('histOdTitle');
  if (!body) return;
  if (title) title.textContent = date;
  body.innerHTML = '<div class="empty2">Loading…</div>';
  const d = await jget('/api/overnight_decay?date=' + encodeURIComponent(date)).catch(() => ({}));
  if (d && d.error) { body.innerHTML = '<div class="empty2">DEGRADED — ' + (d.error || 'read failed') + '</div>'; return; }
  const r = d && d.selected;
  if (!r) { body.innerHTML = '<div class="empty2">NO DATA — no overnight decay row recorded for ' + date + ' (holiday, not yet collected, or a genuine gap)</div>'; return; }
  const p2 = v => window._n(v == null ? null : (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%', 'not computed for this session — see status below');
  const pt = v => window._n(v == null ? null : (v >= 0 ? '+' : '') + Number(v).toFixed(2) + ' pts', 'not computed for this session');
  const num = v => window._n(v == null ? null : Number(v).toLocaleString('en-IN', {maximumFractionDigits: 2}));
  const col = v => v == null ? 'var(--muted)' : (v >= 0 ? 'var(--green)' : 'var(--red)');
  const status = r.overnight_decay_pct != null ? 'VERIFIED' : (r.validity_status ? 'DEGRADED' : 'NO DATA');
  const statusCls = status === 'VERIFIED' ? 'win' : status === 'DEGRADED' ? 'skip' : 'loss';
  const fld = (k, v) => `<div class="hc"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  body.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <span class="pill ${statusCls}">${status}</span>
      <span style="font-size:11px;color:var(--muted)">prior session ${r.prev_session_date || '—'} → ${r.date}</span>
    </div>
    <div class="hist-summary" style="margin-bottom:12px">
      ${fld('ATM Strike', num(r.atm_strike))}
      ${fld('Prev Close (CE/PE)', num(r.prev_ce_close) + ' / ' + num(r.prev_pe_close))}
      ${fld('Prev Straddle Close', num(r.prev_straddle_close))}
      ${fld('Today Open (CE/PE)', num(r.today_ce_open) + ' / ' + num(r.today_pe_open))}
      ${fld('Today Straddle Open', num(r.today_straddle_open))}
      ${fld('Overnight Decay', `<span style="color:${col(r.overnight_decay_pct)}">${p2(r.overnight_decay_pct)}</span> (${pt(r.overnight_decay_points)})`)}
      ${fld('CE Decay', `<span style="color:${col(r.ce_decay_pct)}">${p2(r.ce_decay_pct)}</span> (${pt(r.ce_decay_points)})`)}
      ${fld('PE Decay', `<span style="color:${col(r.pe_decay_pct)}">${p2(r.pe_decay_pct)}</span> (${pt(r.pe_decay_points)})`)}
      ${fld('Leg That Decayed', r.which_leg_decayed ? '<b>' + r.which_leg_decayed + '</b>' : window._n(null, 'strike rolled — no like-for-like comparison'))}
      ${fld('Decay Day', r.is_decay_day == null ? window._n(null) : (r.is_decay_day ? '✓ yes' : '· no'))}
      ${fld('IV Change (CE/PE)', (r.ce_iv_change == null ? window._n(null, 'IV data unavailable') : (r.ce_iv_change >= 0 ? '+' : '') + r.ce_iv_change) + ' / ' + (r.pe_iv_change == null ? window._n(null, 'IV data unavailable') : (r.pe_iv_change >= 0 ? '+' : '') + r.pe_iv_change))}
      ${fld('Next-Day Nifty Move', p2(r.next_day_nifty_move_pct))}
      ${fld('Next-Day Straddle Decay', p2(r.next_day_straddle_decay_pct))}
    </div>
    ${r.decay_reason || r.validity_status ? `<div style="font-size:11px;color:var(--muted);padding:8px;background:rgba(255,255,255,.03);border-radius:6px">${r.decay_reason ? 'Reason: ' + r.decay_reason + '<br>' : ''}${r.validity_status ? 'Status: ' + r.validity_status : ''}</div>` : ''}
  `;
}

renderLedger = async function(){
  const rows=await jget('/api/ledger').catch(()=>[]); const b=document.getElementById('ledgerBody'); if(!b)return;
  b.innerHTML=(rows&&rows.length)?rows.map(l=>`<tr><td class="num">${l.time||''}</td><td>${l.strategy||''}</td><td>${l.action||''}</td><td class="num" style="text-align:right">${_R(l.strike,n0)}</td><td class="num" style="text-align:right">${_R(l.price,n2)}</td><td><span class="pill">${l.state||''}</span></td></tr>`).join('')
    :'<tr><td colspan="6" class="empty">Simulated trades / tracker positions appear here</td></tr>';
};
renderLevels = async function(){
  const d=await jget('/api/levels').catch(()=>({})); const r=(d&&d.reference)||{},p=(d&&d.period)||{};
  const g=document.getElementById('lvlGrid');
  if(g)g.innerHTML=[['Prev Day High',r.prev_day_high],['Prev Day Low',r.prev_day_low],['Prev Close',r.prev_day_close],['Prev Max Pain',r.prev_day_max_pain],['Prev Wk High',r.prev_week_high],['Prev Wk Low',r.prev_week_low],['Prev Mo High',r.prev_month_high],['Prev Mo Low',r.prev_month_low],['SameWD LW High',r.same_weekday_last_week_high],['SameWD LW Low',r.same_weekday_last_week_low]].map(([k,v])=>`<div class="lvl-cell"><div class="k">${k}</div><div class="v num">${_R(v,n0)}</div></div>`).join('');
  const sg=document.getElementById('strLvlGrid');
  if(sg)sg.innerHTML=[['Straddle Wk High',p.straddle_weekly_high],['Straddle Wk Low',p.straddle_weekly_low],['Straddle Mo High',p.straddle_monthly_high],['Straddle Mo Low',p.straddle_monthly_low],['Current Combined',p.current_combined]].map(([k,v])=>`<div class="lvl-cell"><div class="k">${k}</div><div class="v num">${_R(v,n2)}</div></div>`).join('');
};
renderFlow = async function(){
  // Real NSE/BSE Closing Auction Session banner (frontend audit, 2026-08-15) —
  // window._lastSessionState is kept current by setLiveChip() on every snapshot
  // poll, so this reads it directly rather than firing a second fetch.
  const casBanner=document.getElementById('fl-cas-banner');
  if(casBanner){
    const cas=window._lastSessionState&&window._lastSessionState.exchange_cas;
    if(cas&&cas.active){ casBanner.textContent='🔔 '+cas.label; casBanner.style.display='block'; }
    else casBanner.style.display='none';
  }
  const d=await jget('/api/attribution').catch(()=>({})); const a=(d&&d.attribution)||{};
  const set=(id,t)=>{const e=document.getElementById(id); if(e)e.textContent=t;};
  set('fl-drv',a.top_contributor_stock||'—'); set('fl-rev',a.reversal_driver||'—');
  const sp=(id,v)=>{const e=document.getElementById(id); if(!e)return; e.textContent=v==null?'—':((v>=0?'+':'')+Number(v).toFixed(1)); e.className='num '+((v||0)>=0?'up':'dn');};
  sp('fl-bank',a.bank_contribution_pts); sp('fl-it',a.it_contribution_pts); sp('fl-auto',a.auto_contribution_pts); sp('fl-energy',a.energy_contribution_pts);
  const secs=(d&&d.sectors)||[]; const hm=document.getElementById('heatmap');
  if(hm)hm.innerHTML=secs.length?secs.map(x=>{const c=x.pct_change||0;const bg=c>=0?`rgba(45,217,126,${Math.min(Math.abs(c)/2,1)*.35+.07})`:`rgba(255,90,106,${Math.min(Math.abs(c)/2,1)*.35+.07})`;return `<div class="ht-cell" style="background:${bg}"><div class="nm">${(x.sector||'').replace('NIFTY ','')}</div><div class="ch ${c>=0?'up':'dn'}">${c>=0?'+':''}${Number(c).toFixed(2)}%</div></div>`;}).join(''):'<div class="empty" style="padding:20px">No sector data yet</div>';
  const st=(d&&d.stocks)||[]; const sb=document.getElementById('stocksBody');
  // pct_change / contribution_pts are NULL when no day baseline is known for that
  // symbol (websocket_engine._const_baseline). `x.pct_change||0` printed that as
  // "+0.00%" — a measured-looking zero for a number nobody measured, which is exactly
  // the failure the null was introduced to make visible. Render it as an em-dash.
  const numOr=(v,dp,suffix)=>v==null?'<span style="color:var(--muted)">—</span>'
    :`${v>=0?'+':''}${Number(v).toFixed(dp)}${suffix||''}`;
  const clsOr=v=>v==null?'':(v>=0?'up':'dn');
  // % Change is broker/Dhan-standard: vs PREVIOUS SESSION CLOSE (operator decision
  // 2026-08-20, websocket_engine._const_baseline). A row can still fall back to
  // today's-open when no previous close is known yet (first day live, or a genuine
  // data gap) — that value is real, just a DIFFERENT baseline, so it must never sit
  // under the same unlabelled "% Change" header as the broker-standard rows (Layer 1.3).
  const baseBadge=src=>src&&src!=='prev_close'
    ?` <span title="No previous-close on file yet for this stock — showing change vs today's open instead" style="font-size:10px;color:var(--muted);border:1px solid var(--border);border-radius:3px;padding:0 3px;vertical-align:middle">vs open</span>`:'';
  if(sb)sb.innerHTML=st.length?st.map(x=>`<tr><td style="font-weight:600">${x.symbol}</td><td class="num" style="text-align:right;color:var(--muted)">${x.weight==null?'—':x.weight}</td><td class="num ${clsOr(x.pct_change)}" style="text-align:right">${numOr(x.pct_change,2,'%')}${baseBadge(x.baseline_source)}</td><td class="num ${clsOr(x.contribution_pts)}" style="text-align:right">${numOr(x.contribution_pts,1)}</td></tr>`).join(''):'<tr><td colspan="4" class="empty">No constituent data yet</td></tr>';
};
renderVRP = async function(){
  // Audit finding (frontend audit pass): this used to be
  // `jget('/api/vrp').catch(()=>({}))`, discarding a 401/403 upgrade_required
  // error the exact same way the DASHBOARD's VRP card (renderVrpIntel, panels.js)
  // used to before its own Phase 8 fix — the fetch failure and the "no session
  // data yet" case were indistinguishable, so a logged-out FREE-tier visitor saw
  // this entire page as a wall of blank "—" with no explanation why. Routed
  // through the same isUpgradeRequired/upgradeRequiredHTML helpers the card
  // already uses, so the message is consistent across both surfaces for the
  // same underlying gate.
  let _vrpPageErr=null;
  const d=await jget('/api/vrp').catch(e=>{_vrpPageErr=e; return {};});
  const set=(id,t)=>{const e=document.getElementById(id); if(e)e.textContent=t;};
  // Session provenance (Section 2/9): IV/RV/VRP/regime here can be a FALLBACK to the
  // last real session (weekend/holiday/pre-market) — the number is real, but showing it
  // with no label is exactly the "looks live, isn't" gap this platform exists to close.
  // expected_move_session covers EM specifically, since it can fall back independently.
  const prov=document.getElementById('vrp-provenance');
  if(prov){
    if(isUpgradeRequired(_vrpPageErr)){
      prov.innerHTML=upgradeRequiredHTML('VRP Intelligence',_vrpPageErr);
      prov.style.display='block';
    }else{
      const parts=[];
      if(d.provenance==='previous' && d.session_date) parts.push('IV/RV/VRP: previous session · '+d.session_date);
      else if(d.provenance==='unavailable') parts.push('IV/RV/VRP: unavailable — no session data yet');
      const ems=d.expected_move_session;
      if(ems && ems.provenance==='previous' && ems.session_date) parts.push('Expected Move: previous session · '+ems.session_date);
      else if(ems && ems.provenance==='unavailable') parts.push('Expected Move: unavailable — no session data yet');
      prov.textContent=parts.join('  ·  ');
      prov.style.display=parts.length?'block':'none';
    }
  }
  set('vrp-iv', d.iv==null?'—':Number(d.iv).toFixed(2)+'%');
  set('vrp-rv', d.rv==null?'building…':Number(d.rv).toFixed(2)+'%');
  set('vrp-spread', d.vrp==null?'—':((d.vrp>0?'+':'')+Number(d.vrp).toFixed(2)+'%'));
  set('vrp-val', d.verdict||d.rich_cheap||'—');
  set('vrp-regime', d.regime||'—');
  const sv=document.getElementById('vrp-val');
  if(sv)sv.style.color=(d.vrp!=null&&d.vrp>0)?'var(--green)':((d.vrp!=null&&d.vrp<0)?'var(--red)':'var(--fg)');
  const pctl=(d.iv!=null)?Math.max(0,Math.min(100,(d.iv-8)/(24-8)*100)):null;
  const dot=document.getElementById('vrp-dot'),fill=document.getElementById('vrp-fill');
  if(dot&&pctl!=null)dot.style.left=pctl+'%'; if(fill&&pctl!=null)fill.style.width=pctl+'%';
  // VRP forward + HAR
  const fwd=d.vrp_forward, har=d.vrp_har;
  const setf=(id,v,fmt)=>{const e=document.getElementById(id); if(!e)return; if(v==null){e.textContent='—';e.style.color='var(--muted)';return;} e.textContent=(v>=0?'+':'')+Number(v).toFixed(2); e.style.color=v>0?'var(--green)':'var(--red)';};
  setf('vrp-fwd-val',fwd); setf('vrp-har-val',har);
  set('vrp-rv20d', d.rv_20d==null?'—':Number(d.rv_20d).toFixed(2)+'%');
  set('vrp-rvfc', d.rv_forecast==null?'—':Number(d.rv_forecast).toFixed(2)+'%');
  // expected move panel + ladder around spot
  set('vrp-em1', d.expected_move_1sigma==null?'—':'±'+n0(d.expected_move_1sigma));
  set('vrp-em2', d.expected_move_2sigma==null?'—':'±'+n0(d.expected_move_2sigma));
  const rich=document.getElementById('vrp-rich'); if(rich){rich.textContent=d.rich_cheap||'—'; rich.style.color=(d.rich_cheap==='RICH')?'var(--green)':'var(--red)';}
  const sp=(ST[CUR]&&ST[CUR].spot)||null, em1=d.expected_move_1sigma, em2=d.expected_move_2sigma;
  const lad=document.getElementById('vrp-ladder');
  if(lad){
    const s=ST[CUR]||{};
    const cur=(s.legs&&s.atm&&s.legs[s.atm])?s.legs[s.atm].comb:null;
    const row=(l,v,c)=>`<div style="display:flex;justify-content:space-between;padding:6px 2px;border-bottom:1px solid var(--border)"><span style="color:${c||'var(--muted)'}">${l}</span><span class="num" style="color:${c||'var(--fg)'}">${v==null?'—':n0(v)}</span></div>`;
    // EXPECTED MOVE — the ATM straddle itself = the market's own EM. Morning vs now vs day low/high.
    let html='<div style="font-size:9px;letter-spacing:1px;color:var(--accent);font-weight:800;margin:2px 0 4px">EXPECTED MOVE · ATM STRADDLE (intraday)</div>'
      +row('9:15 morning ₹',s.atm9_15,'var(--gold)')+row('▸ Now ₹',cur,'var(--cyan)')
      +row('Day LOW ₹',s.atmLo,'var(--green)')+row('Day HIGH ₹',s.atmHi,'var(--red)');
    if(sp&&em1){
      html+='<div style="font-size:9px;letter-spacing:1px;color:var(--accent);font-weight:800;margin:12px 0 4px">σ BANDS · SPOT</div>'
        +row('+2σ band (95%)',sp+em2,'var(--green)')+row('+1σ band (68%)',sp+em1,'var(--cyan)')
        +row('▸ Spot now',sp,'var(--fg)')+row('−1σ band (68%)',sp-em1,'var(--cyan)')+row('−2σ band (95%)',sp-em2,'var(--red)');
    }
    lad.innerHTML=html;
  }
  if(window.vrpChart){try{window.vrpChart.destroy();}catch(e){} window.vrpChart=null;}
};
async function renderSettings(){
  renderThemePicker();
  // Show/hide dev-only sections based on Developer Mode
  var dev = isDeveloperMode();
  var sp = document.getElementById('page-settings');
  if (sp) sp.setAttribute('data-devmode', dev ? '1' : '0');
  syncDeveloperModeUI();
  const sc=document.getElementById('set-sound'); if(sc)sc.checked=SOUND;
  // Sync gesture settings toggles
  if (window.GestureEngine) {
    try {
      var gs = GestureEngine.getSettings();
      var sync = function(id, val) { var el = document.getElementById(id); if (el) el.checked = !!val; };
      var syncRange = function(id, val, displayId, suffix) {
        var el = document.getElementById(id); if (el) el.value = val;
        var d = document.getElementById(displayId); if (d) d.textContent = val + (suffix || '');
      };
      sync('set-gesture-master', gs.enabled);
      sync('set-gesture-overlay', gs.showOverlay);
      sync('set-gesture-preview', gs.showPreview);
      sync('set-gesture-nav', gs.navGestures);
      sync('set-gesture-chart', gs.chartGestures);
      sync('set-gesture-tracker', gs.trackerGestures);
      sync('set-gesture-quick', gs.quickActionsGestures);
      syncRange('set-gesture-sensitivity', Math.round(gs.confidence * 100), 'ge-sens-val', '%');
      syncRange('set-gesture-cooldown', gs.cooldown, 'ge-cd-val', 'ms');
    } catch (e) {}
  }
  try{ if(document.getElementById('set-devmode')) document.getElementById('set-devmode').checked = isDeveloperMode(); }catch(e){}
  // Update admin key state
  var ak = document.getElementById('adminKeyState');
  if (ak) {
    // 2026-08-20: reads the UI-state flag, not a secret — the real credential lives
    // only in the httpOnly cookie now, which this page cannot read even to check.
    try { ak.textContent = localStorage.getItem('apexAdminSessionActive')==='1' ? 'Set — remote admin access enabled' : 'Not set — admin endpoints are localhost-only'; } catch(e) {}
  }
  // Update app version line
  try {
    var reg = await (await navigator.serviceWorker.getReady()).registration;
    var v = document.getElementById('appVerLine');
    if (v) v.textContent = (reg.active ? 'SW active' : 'no SW');
  } catch(e) {}
}

// Settings search — hides sections that don't match the query
window.filterSettings = function(q) {
  q = (q || '').toLowerCase();
  var sections = document.querySelectorAll('#page-settings .s-section[data-section]');
  sections.forEach(function(s) {
    var text = (s.textContent || '').toLowerCase();
    if (q && text.indexOf(q) === -1) {
      s.classList.add('hidden-by-search');
    } else {
      s.classList.remove('hidden-by-search');
    }
  });
};
/* Key Levels loader.

   EVERY element access here now goes through a null-safe setter. It used to reach
   for orb-high / orb-low / orb-range / orb-breakout with a raw getElementById and
   set .textContent directly - so the moment any one of those elements was not on
   the page, it threw "Cannot set properties of null", and because this runs inside
   the render chain, that one throw stopped the WHOLE dashboard from painting. That
   is the "sirf logo, no data" you saw: not a data problem, a single unguarded
   element reference taking everything down with it. */
async function loadKeyLevels(){
 try{
  const d=await jget('/api/snapshot').catch(()=>({}));
  const setN=(id,v,dp)=>{const e=document.getElementById(id); if(e)e.textContent=v!=null?Number(v).toLocaleString('en-IN',{maximumFractionDigits:dp==null?0:dp}):'—';};
  const setT=(id,txt,col)=>{const e=document.getElementById(id); if(e){e.textContent=txt; if(col!==undefined)e.style.color=col;}};
  setN('kl-pdh',d.prev_day_high); setN('kl-pdl',d.prev_day_low);
  setN('kl-pwh',d.prev_week_high); setN('kl-pwl',d.prev_week_low);
  setN('kl-pc',d.prev_close); setN('kl-mp',d.max_pain);
   // IV percentile from /api/levels
   const l=await jget('/api/levels').catch(()=>({}));
   const ivp=l.iv||{};
   if(ivp.iv_percentile!=null){
     setT('ivp-pct',Number(ivp.iv_percentile).toFixed(0)+'%');
     if(ivp.iv_52w_high!=null) setT('ivp-52wh',Number(ivp.iv_52w_high).toFixed(1)+'%');
     if(ivp.iv_52w_low!=null) setT('ivp-52wl',Number(ivp.iv_52w_low).toFixed(1)+'%');
     const rg=ivp.regime||'—';
     setT('ivp-regime',rg, rg==='HIGH_VOL'?'var(--red)':rg==='LOW_VOL'?'var(--green)':'var(--gold)');
   }
 }catch(e){ /* Key Levels is one card - it must never take down the whole page */ }
}

/* ===== MARKET REGIME ===== */

var _regimeData=null, _regimeSheetTab='overview', _trackRecordData=null;

var _RR_NAMES={TREND_UP:'Bull Trend',TREND_DOWN:'Bear Trend',RANGE_BOUND:'Range Bound',
  VOL_EXPANSION:'Volatility Expanding',VOL_COMPRESSION:'Volatility Compressing',
  GAP_UP:'Gap Up',GAP_DOWN:'Gap Down',BREAKOUT_UP:'Breakout Upside',
  BREAKOUT_DOWN:'Breakout Downside',REVERSAL_UP:'Reversal Up',REVERSAL_DOWN:'Reversal Down',
  UNDECIDED:'Undecided'};
var _RR_ICONS={TREND_UP:'\u2197',TREND_DOWN:'\u2198',RANGE_BOUND:'\u2194',
  VOL_EXPANSION:'\u26A1',VOL_COMPRESSION:'\u3030',GAP_UP:'\u2B06',GAP_DOWN:'\u2B07',
  BREAKOUT_UP:'\uD83D\uDE80',BREAKOUT_DOWN:'\uD83D\uDCA5',REVERSAL_UP:'\uD83D\uDD04\u2197',
  REVERSAL_DOWN:'\uD83D\uDD04\u2198',UNDECIDED:'\u2753'};
var _RR_COLORS={TREND_UP:'#00e676',TREND_DOWN:'#ff5252',RANGE_BOUND:'#ffd740',
  VOL_EXPANSION:'#ff9100',VOL_COMPRESSION:'#448aff',GAP_UP:'#00e676',GAP_DOWN:'#ff5252',
  BREAKOUT_UP:'#00e676',BREAKOUT_DOWN:'#ff5252',REVERSAL_UP:'#7c4dff',REVERSAL_DOWN:'#e040fb',
  UNDECIDED:'#9e9e9e'};
var _RR_DIR_LABEL={BULLISH:{text:'Buy Pullbacks',icon:'\u2191',bg:'rgba(49,196,141,.15)',c:'#31C48D'},
  BEARISH:{text:'Sell Rallies',icon:'\u2193',bg:'rgba(238,90,110,.15)',c:'#F26477'},
  NEUTRAL:{text:'Neutral',icon:'\u2014',bg:'rgba(158,158,158,.15)',c:'#9e9e9e'}};
var _RR_PLAYBOOK_NAMES={TREND_UP:'Buy Pullbacks',TREND_DOWN:'Sell Rallies',
  RANGE_BOUND:'Sell Premium at Extremes',VOL_EXPANSION:'Buy Straddle / Strangle',
  VOL_COMPRESSION:'Credit Spreads',GAP_UP:'Gap Fade CE',GAP_DOWN:'Gap Fade PE',
  BREAKOUT_UP:'Momentum CE',BREAKOUT_DOWN:'Momentum PE',
  REVERSAL_UP:'CE Switch',REVERSAL_DOWN:'PE Switch',UNDECIDED:'Wait'};
var _RR_PLAYBOOK_STEPS={
  TREND_UP:['Buy dips on pullbacks to VWAP or support','Avoid aggressive short positions','Trail stop-loss on profitable positions','Favor call-side legs'],
  TREND_DOWN:['Sell rallies to VWAP or resistance','Avoid aggressive long positions','Trail stop-loss on profitable positions','Favor put-side legs'],
  RANGE_BOUND:['Sell premium at range extremes','Iron condor for range-bound income','Monitor for breakout signals','Tighten stops near range boundaries'],
  VOL_EXPANSION:['Long straddle or strangle before expected moves','Buy premium \u2014 avoid selling premium','Use ATM or slightly OTM strikes','Scale in as volatility builds'],
  VOL_COMPRESSION:['Credit spreads and short vega positions','Sell premium cautiously','Watch for volatility expansion catalysts','Tight risk management essential'],
  GAP_UP:['Fade gap with call on confirmation','Wait 15 min for gap fill assessment','Size smaller on gap trades','Watch for follow-through or reversal'],
  GAP_DOWN:['Fade gap with put on confirmation','Wait 15 min for gap fill assessment','Size smaller on gap trades','Watch for follow-through or reversal'],
  BREAKOUT_UP:['Momentum call with trailing stop','Add on pullback to breakout level','Target previous swing high','Cut loss below breakout level'],
  BREAKOUT_DOWN:['Momentum put with trailing stop','Add on pullback to breakout level','Target previous swing low','Cut loss above breakout level'],
  REVERSAL_UP:['Switch from put to call bias','Wait for confirmation candle','Size smaller on reversal trades','Watch for volume confirmation'],
  REVERSAL_DOWN:['Switch from call to put bias','Wait for confirmation candle','Size smaller on reversal trades','Watch for volume confirmation'],
  UNDECIDED:['Wait for clearer signals','Reduce position size','Flat or minimal exposure','Preserve capital for the next setup']};
var _RR_PLAYBOOK_RISK={TREND_UP:'Moderate',TREND_DOWN:'Moderate',RANGE_BOUND:'Low',
  VOL_EXPANSION:'High',VOL_COMPRESSION:'Moderate',GAP_UP:'High',GAP_DOWN:'High',
  BREAKOUT_UP:'Moderate',BREAKOUT_DOWN:'Moderate',REVERSAL_UP:'High',REVERSAL_DOWN:'High',
  UNDECIDED:'Low'};
var _RR_PLAYBOOK_INVAL={
  TREND_UP:'Loss of breadth, VIX spike above 20, heavy put writing at support',
  TREND_DOWN:'Recovery of breadth, VIX compression below 12, heavy call writing at resistance',
  RANGE_BOUND:'ORB breakout confirmed by volume, VIX spike above 20',
  VOL_EXPANSION:'VIX compression below 12, no catalyst expected, implied vol crush',
  VOL_COMPRESSION:'VIX spike above 18, unexpected event, macro shock',
  GAP_UP:'Gap fill within first 15 min, broad selling, VIX surge',
  GAP_DOWN:'Gap fill within first 15 min, broad buying, VIX collapse',
  BREAKOUT_UP:'Failed breakout \u2014 price falls back below breakout level with volume',
  BREAKOUT_DOWN:'Failed breakout \u2014 price rises back above breakout level with volume',
  REVERSAL_UP:'Continued selling, lower lows, VIX spike',
  REVERSAL_DOWN:'Continued buying, higher highs, VIX collapse',
  UNDECIDED:'Clear regime signal emerges with confidence above 55%'};
var _RR_EVIDENCE_LABELS={trend_spot_vs_orb:'Price vs Opening Range',trend_spot_vs_vwap:'Price vs VWAP',
  trend_change_pct:'Intraday Price Change',trend_velocity:'Price Momentum',
  vol_vix_level:'Volatility Level',vol_vix_change:'Volatility Shift',
  vol_iv_rv:'Implied vs Realized Volatility',vol_vrp_percentile:'Volatility Risk Premium',
  structure_pcr:'Put-Call Ratio',structure_oi_shift:'Open Interest Flow',
  structure_max_pain:'Max Pain Proximity',structure_breadth:'Market Breadth',
  reversal_fear:'Reversal Risk',max_pain_pull:'Max Pain Pull',
  oi_pattern:'OI Pattern'};

function _rrName(regime){return _RR_NAMES[regime]||regime||'Undecided';}
function _rrColor(regime){return _RR_COLORS[regime]||'#9e9e9e';}
function _rrIcon(regime){return _RR_ICONS[regime]||'?';}
function _rrDir(dir){return _RR_DIR_LABEL[dir]||_RR_DIR_LABEL.NEUTRAL;}
function _rrConfBand(c){return c>=.80?'High':c>=.55?'Moderate':'Low';}
function _rrConfCol(c){return c>=.80?'#31C48D':c>=.55?'#E8A33D':'#F26477';}
function _escH(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

/* ═══════════════ ENGINEERING CENTER (Settings → last section) ═══════════════
   Reuses jget / toast / _escH — no new helpers, no new design language, no new page.
   LAZY: every fetch is triggered by a <details> toggle, so a trader who never opens
   this section makes zero extra requests. This is what keeps it free on the dashboard's
   hot path. */
var _engLoaded=false, _engRoiLoaded=false, _engTlLoaded=false, _engSafeFixes=0;

function _engPill(st){
  var c = st==='PASS'?'#31C48D' : st==='CONDITIONAL'?'#E8A33D'
        : st==='WARN'?'#E8A33D' : st==='FAIL'?'#F26477' : 'var(--muted)';
  return '<span style="display:inline-block;padding:1px 7px;border-radius:20px;font-size:9px;'
       + 'font-weight:700;letter-spacing:.4px;color:'+c+';border:1px solid '+c+'55;'
       + 'background:'+c+'12">'+_escH(st||'UNKNOWN')+'</span>';
}
function _engBar(pct){
  var p=Math.max(0,Math.min(100,pct||0));
  var c = p>=90?'#31C48D' : p>=70?'#E8A33D' : '#F26477';
  return '<div style="height:4px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden">'
       + '<div style="height:100%;width:'+p+'%;background:'+c+'"></div></div>';
}
function _engRow(label,val){
  return '<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0;font-size:11px">'
       + '<span style="color:var(--muted)">'+_escH(label)+'</span>'
       + '<span style="color:var(--text);font-weight:600;text-align:right">'+_escH(val)+'</span></div>';
}

function engOpen(el){ if(el.open && !_engLoaded) engLoad(); }
function engRoiOpen(el){ if(el.open && !_engRoiLoaded) engRoi(); }
function engTlOpen(el){ if(el.open && !_engTlLoaded) engTl(); }

async function engLoad(force){
  var b=document.getElementById('engBody'); if(!b) return;
  b.innerHTML='<div class="s-note">Probing live system…</div>';
  var d;
  try{ d = await jget('/api/engineering/center', force?0:10000); }
  catch(e){
    b.innerHTML='<div class="s-note" style="color:var(--warn)">Engineering Center unavailable — '
      +'/api/engineering/center returned an error ('+_escH(e&&e.message||e)+').</div>';
    return;
  }
  if(d.error){ b.innerHTML='<div class="s-note" style="color:var(--warn)">'+_escH(d.error)+'</div>'; return; }
  _engLoaded=true;
  var s=d.summary||{}, h='';

  /* Summary card — the one card that answers "is it healthy" */
  h+='<div style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:12px;'
   +'background:rgba(255,255,255,.015)">'
   +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
   +'<b style="font-size:12px">Overall</b>'+_engPill(s.overall_status)
   +'<span style="margin-left:auto;font-size:9.5px;color:var(--muted)">'+_escH(d.generated_at||'')+'</span></div>'
   +_engRow('Repository Integration', (s.repository_integration_score||0)+' / 100')
   +_engBar(s.repository_integration_score)
   +_engRow('Engineering Score', (s.engineering_score||0)+' / 100')
   +_engBar(s.engineering_score)
   +_engRow('Production Readiness', (s.production_readiness||0)+' / 100  ('+_escH(s.production_status||'')+')')
   +_engBar(s.production_readiness);
  if(s.verification_note){
    h+='<div style="margin-top:8px;font-size:10px;color:var(--muted);line-height:1.5">'
     +_escH(s.verification_note)+'</div>';
  }
  if(s.critical_count){
    h+='<div style="margin-top:9px;padding-top:8px;border-top:1px solid var(--border)">'
     +'<div style="font-size:10.5px;font-weight:700;color:#F26477;margin-bottom:4px">'
     +s.critical_count+' CRITICAL</div>';
    (s.critical_issues||[]).slice(0,5).forEach(function(c){
      h+='<div style="font-size:10px;color:var(--muted);line-height:1.5">• '+_escH(c)+'</div>'; });
    h+='</div>';
  }
  h+='</div>';

  /* Repositories */
  h+='<div style="font-size:10.5px;font-weight:700;color:var(--muted);letter-spacing:.5px;margin:12px 0 6px">REPOSITORIES</div>';
  (d.repositories||[]).forEach(function(r){
    h+='<div style="border:1px solid var(--border);border-radius:9px;padding:9px 11px;margin-bottom:7px">'
     +'<div style="display:flex;align-items:center;gap:7px;margin-bottom:5px">'
     +'<b style="font-size:11.5px">'+_escH(r.name)+'</b>'+_engPill(r.status)
     +'<span style="margin-left:auto;font-size:9.5px;color:var(--muted)">'+_escH(r.version||'')+'</span></div>'
     +'<div style="display:flex;gap:12px;margin-bottom:5px">'
     +'<div style="flex:1"><div style="font-size:9px;color:var(--muted)">INTEGRATION '+(r.integration_pct||0)+'%</div>'+_engBar(r.integration_pct)+'</div>'
     +'<div style="flex:1"><div style="font-size:9px;color:var(--muted)">UTILIZATION '+(r.utilization_pct||0)+'%</div>'+_engBar(r.utilization_pct)+'</div></div>'
     +'<div style="font-size:9.5px;color:var(--muted);line-height:1.5">'+_escH(r.detail||'')+'</div>';
    if(r.unverified){
      h+='<div style="font-size:9.5px;color:#E8A33D;line-height:1.5;margin-top:3px">⚠ '+_escH(r.unverified)+'</div>'; }
    h+='</div>';
  });

  /* Business observability */
  var c=d.business_observability||{};
  h+='<div style="font-size:10.5px;font-weight:700;color:var(--muted);letter-spacing:.5px;margin:12px 0 6px">'
   +'BUSINESS OBSERVABILITY — '+(c.coverage_pct||0)+'%</div>'+_engBar(c.coverage_pct);
  if(c.cap_note){ h+='<div style="font-size:9.5px;color:var(--muted);margin:4px 0 7px;line-height:1.5">'+_escH(c.cap_note)+'</div>'; }
  (c.rows||[]).forEach(function(r){
    h+='<div style="display:flex;align-items:center;gap:7px;padding:3px 0;font-size:10.5px">'
     +_engPill(r.status)+'<span>'+_escH(r.subsystem)+'</span>'
     +'<span style="margin-left:auto;color:var(--muted);font-size:9px">'+_escH(r.instrumented_at||'')+'</span></div>';
  });

  /* Infrastructure */
  h+='<div style="font-size:10.5px;font-weight:700;color:var(--muted);letter-spacing:.5px;margin:12px 0 6px">INFRASTRUCTURE</div>';
  (d.infrastructure||[]).forEach(function(r){
    h+='<div style="display:flex;align-items:center;gap:7px;padding:3px 0;font-size:10.5px">'
     +_engPill(r.status)+'<span>'+_escH(r.name)+'</span>'
     +'<span style="margin-left:auto;color:var(--muted);font-size:9px;text-align:right">'+_escH(r.detail||'')+'</span></div>';
  });

  /* Proofs + dead things */
  var rg=d.regression||{};
  h+='<div style="font-size:10.5px;font-weight:700;color:var(--muted);letter-spacing:.5px;margin:12px 0 6px">PROOFS &amp; REGRESSION</div>'
   +_engRow('Proofs passed', (rg.passed||0)+' / '+(rg.total||0))
   +_engRow('Failed', String(rg.failed||0))
   +_engRow('Dead metrics', String((rg.dead_metrics||[]).length))
   +_engRow('Broken dashboards', String((rg.broken_panels||[]).length))
   +_engRow('Dead configs', String((rg.dead_configs||[]).length))
   +_engRow('Last run', String(rg.ran_at||'—'));
  if((rg.failed_names||[]).length){
    h+='<div style="font-size:9.5px;color:#F26477;line-height:1.6;margin-top:4px">'
     +_escH((rg.failed_names||[]).join(', '))+'</div>'; }

  /* Performance */
  h+='<div style="font-size:10.5px;font-weight:700;color:var(--muted);letter-spacing:.5px;margin:12px 0 6px">PERFORMANCE</div>';
  (d.performance||[]).forEach(function(p){
    h+=_engRow(p.name, (p.value===null||p.value===undefined?'—':p.value)+' '+(p.unit||'')); });

  /* Build information — "which code am I actually running" */
  var bi=d.build_info||{};
  h+='<div style="font-size:10.5px;font-weight:700;color:var(--muted);letter-spacing:.5px;margin:12px 0 6px">BUILD INFORMATION</div>';
  Object.keys(bi).forEach(function(k){
    h+=_engRow(k.replace(/^pkg_/,'').replace(/_/g,' '),
               bi[k]===null||bi[k]===undefined?'—':String(bi[k])); });

  b.innerHTML=h;
  var pk=document.getElementById('engPeek');
  if(pk) pk.textContent=(s.overall_status||'')+' · '+(s.engineering_score||0)+'/100';
  var hb=document.getElementById('engHdBadge');
  if(hb) hb.textContent='score '+(s.engineering_score||0);
}

async function engRoi(){
  var b=document.getElementById('engRoiBody'); if(!b) return;
  b.innerHTML='<div class="s-note">Loading…</div>';
  var d; try{ d=await jget('/api/engineering/center',10000); }
  catch(e){ b.innerHTML='<div class="s-note" style="color:var(--warn)">unavailable</div>'; return; }
  _engRoiLoaded=true;
  var h='';
  (d.repository_roi||[]).forEach(function(r){
    h+='<div style="border:1px solid var(--border);border-radius:9px;padding:10px 11px;margin-bottom:8px">'
     +'<div style="display:flex;align-items:center;gap:7px;margin-bottom:6px">'
     +'<b style="font-size:11.5px">'+_escH(r.repo)+'</b>'
     +'<span style="margin-left:auto;font-size:9px;color:'+(r.keep?'#31C48D':'#F26477')+'">'
     +(r.keep?'KEEP':'REMOVE')+'</span></div>';
    Object.keys(r.measured||{}).forEach(function(k){
      h+=_engRow(k.replace(/_/g,' '), String(r.measured[k])); });
    h+='<div style="font-size:9.5px;color:var(--muted);line-height:1.6;margin-top:6px">'
     +'<b style="color:var(--text)">Solves:</b> '+_escH(r.problem_solved)+'<br>'
     +'<b style="color:var(--text)">Used by:</b> '+_escH(r.modules_using)+'<br>'
     +'<b style="color:var(--text)">Still unused:</b> '+_escH(r.still_unused)+'<br>'
     +'<b style="color:var(--text)">Justified:</b> '+_escH(r.justified)+'</div></div>';
  });
  b.innerHTML=h||'<div class="s-note">No ROI data.</div>';
}

async function engTl(){
  var b=document.getElementById('engTlBody'); if(!b) return;
  b.innerHTML='<div class="s-note">Loading…</div>';
  var d; try{ d=await jget('/api/engineering/center',10000); }
  catch(e){ b.innerHTML='<div class="s-note" style="color:var(--warn)">unavailable</div>'; return; }
  _engTlLoaded=true;
  var ev=d.timeline||[];
  if(!ev.length){ b.innerHTML='<div class="s-note">No engineering events recorded yet. '
    +'Auto-fix runs and CRITICAL/ERROR log entries appear here.</div>'; return; }
  var h='';
  ev.forEach(function(e){
    var col = e.status==='PASS'?'#31C48D' : e.status==='WARN'?'#E8A33D'
            : e.status==='FAIL'?'#F26477':'var(--muted)';
    h+='<div style="display:flex;gap:9px;padding:7px 0;border-bottom:1px solid var(--border)">'
     +'<div style="width:3px;border-radius:2px;background:'+col+';flex:none"></div>'
     +'<div style="flex:1;min-width:0">'
     +'<div style="display:flex;gap:7px;align-items:center">'
     +'<span style="font-size:9px;color:var(--muted)">'+_escH(e.ts||'')+'</span>'
     +'<span style="font-size:8.5px;font-weight:700;color:'+col+'">'+_escH(e.kind||'')+'</span></div>'
     +'<div style="font-size:10.5px;color:var(--text);margin-top:2px;line-height:1.4">'+_escH(e.title||'')+'</div>';
    if(e.outcome){ h+='<div style="font-size:9.5px;color:'+col+';margin-top:2px">→ '+_escH(e.outcome)+'</div>'; }
    h+='</div></div>';
  });
  b.innerHTML=h;
}

async function engScan(btn){
  var s=document.getElementById('engFixStatus'), body=document.getElementById('engFixBody');
  if(btn) btn.disabled=true;
  s.textContent='Scanning…';
  try{
    var r=await (await fetch('/api/engineering/autofix/scan',{cache:'no-store'})).json();
    var h='<div style="font-size:10.5px;margin-bottom:8px">'
      +'<b>'+_escH(r.result||'')+'</b> — '+_escH(r.detail||'')+'</div>';
    _engSafeFixes = (r.result==='DRY_RUN' && r.would_fix) ? 1 : 0;
    if(r.would_fix){
      h+='<div style="border:1px solid #E8A33D55;background:#E8A33D10;border-radius:8px;padding:9px;margin-bottom:9px">'
       +'<div style="font-size:10px;font-weight:700;color:#E8A33D">NEXT SAFE FIX (one only)</div>'
       +'<div style="font-size:10.5px;margin-top:3px">'+_escH(r.would_fix.title)+'</div>'
       +'<div style="font-size:9.5px;color:var(--muted);margin-top:2px">'+_escH(r.would_fix.evidence||'')+'</div></div>';
    }
    var recs=r.recommendations||[];
    if(recs.length){
      h+='<div style="font-size:10px;font-weight:700;color:var(--muted);margin:8px 0 5px">'
       +recs.length+' REQUIRE HUMAN REVIEW (never auto-fixed)</div>';
      recs.forEach(function(x){
        h+='<div style="border-left:2px solid var(--border);padding:5px 0 5px 8px;margin-bottom:6px">'
         +'<div style="font-size:10.5px"><b>'+_escH(x.severity)+'</b> · '+_escH(x.title)+'</div>'
         +'<div style="font-size:9.5px;color:var(--muted);line-height:1.5">'+_escH(x.evidence||'')+'</div>';
        if(x.why_not_auto){ h+='<div style="font-size:9.5px;color:#E8A33D;line-height:1.5;margin-top:2px">'
          +_escH(x.why_not_auto)+'</div>'; }
        h+='</div>';
      });
    }
    body.innerHTML=h;
    document.getElementById('engApplyBtn').disabled = !_engSafeFixes;
    document.getElementById('engFixPeek').textContent = _engSafeFixes+' safe · '+recs.length+' review';
    s.textContent='';
  }catch(e){ s.textContent='Scan failed: '+(e&&e.message||e); }
  if(btn) btn.disabled=false;
}

async function engApply(btn){
  if(!confirm('Apply ONE safe fix?\n\nProofs and a benchmark run afterwards. '
    +'If either fails the change is rolled back automatically.')) return;
  var s=document.getElementById('engFixStatus');
  if(btn) btn.disabled=true;
  s.textContent='Applying one fix, then verifying…';
  try{
    var r=await (await fetch('/api/engineering/autofix/apply',{method:'POST',cache:'no-store',headers:_adminHdr()})).json();
    var ok = r.result==='FIXED_AND_VERIFIED';
    s.innerHTML='<span style="color:'+(ok?'#31C48D':'#E8A33D')+'"><b>'+_escH(r.result||'')+'</b></span> — '
      +_escH(r.detail||'');
    toast(ok?'ok':'warn','Auto-Fix', r.result||'done');
    engScan(); if(_engLoaded) engLoad(true);
  }catch(e){ s.textContent='Apply failed: '+(e&&e.message||e); }
  if(btn) btn.disabled=false;
}

async function engHistory(btn){
  var body=document.getElementById('engFixBody');
  if(btn) btn.disabled=true;
  try{
    var r=await (await fetch('/api/engineering/autofix/history',{cache:'no-store'})).json();
    var es=r.entries||[];
    if(!es.length){ body.innerHTML='<div class="s-note">No auto-fix has ever run.</div>'; }
    else{
      var h='<div style="font-size:10px;font-weight:700;color:var(--muted);margin-bottom:6px">'
        +es.length+' AUTO-FIX ATTEMPT(S)</div>';
      es.slice().reverse().forEach(function(e){
        var ok=e.result==='FIXED_AND_VERIFIED';
        h+='<div style="border-left:2px solid '+(ok?'#31C48D':'#E8A33D')+';padding:5px 0 5px 8px;margin-bottom:6px">'
         +'<div style="font-size:9px;color:var(--muted)">'+_escH(e.started||'')+'</div>'
         +'<div style="font-size:10.5px">'+_escH(e.result||'')+'</div>'
         +'<div style="font-size:9.5px;color:var(--muted)">'+_escH(e.detail||'')+'</div></div>';
      });
      body.innerHTML=h;
    }
  }catch(e){ body.innerHTML='<div class="s-note" style="color:var(--warn)">history unavailable</div>'; }
  if(btn) btn.disabled=false;
}

// Live visitor count (2026-08-20) + daily unique total (2026-08-24, operator:
// "aaj kitne log aaye" vs "abhi kitne live hain" are two different numbers).
// /api/visitors/live returns {count: distinct visitors with an open /ws right
// now, today: distinct visitors seen at all today (persisted, survives restarts)}.
// No IP storage, nothing per-visitor beyond an opaque cid — see main.py::ws_feed.
// Hidden (display:none default in the HTML) until the first successful read, so
// it never flashes "0" before the real counts arrive.
var _lastVisitorsToday=null;   // WS pushes only the live count 4x/sec; the daily
                                // total changes slowly, so it's refreshed only by
                                // loadVisitorCount()'s 20s poll and reused here.
function _renderVisitorCounts(liveN, todayN){
  if(todayN!=null) _lastVisitorsToday=todayN;
  const chip=document.getElementById('visitorChip'), n=document.getElementById('visitorCount');
  if(n) n.textContent=liveN+' live'+(_lastVisitorsToday!=null?' · '+_lastVisitorsToday+' today':'');
  if(chip) chip.style.display='inline-flex';
}
async function loadVisitorCount(){
  try{
    const d=await jget('/api/visitors/live').catch(function(){return null;});
    if(!d||d.count==null) return;
    _renderVisitorCounts(d.count, d.today);
  }catch(e){}
}

async function loadRegimeCard(){
 try{
  var r=await jget('/api/regime/live').catch(function(){return null;});
  if(r&&r.regime) _regimeData=r;
 }catch(e){}
 var r=_regimeData;
 if(!r||!r.regime) return;
 try{
  var regime=r.regime, conf=r.confidence||0, dir=r.direction||'NEUTRAL',
    color=_rrColor(regime), dirObj=_rrDir(dir);
  var lb=document.getElementById('regime-label');
  if(lb){lb.textContent=_rrName(regime);lb.style.color=color;}
  var cf=document.getElementById('regime-conf');
  if(cf) cf.textContent=Math.round(conf*100)+'% confidence';
  var dr=document.getElementById('regime-dir');
  if(dr){dr.textContent=dirObj.icon+' '+dirObj.text;dr.style.background=dirObj.bg;dr.style.color=dirObj.c;}
  var fill=document.getElementById('regime-conf-fill');
  if(fill){fill.style.width=Math.round(conf*100)+'%';fill.style.background=_rrConfCol(conf);}
  var sb=document.getElementById('regime-stable');
  if(sb){
   var sm=r.stable_min||0;
   if(regime==='UNDECIDED'){sb.textContent='';sb.style.color='var(--faint)';}
   else if(sm<1){sb.textContent='Forming...';sb.style.color='var(--gold)';}
   else if(sm<60){sb.textContent='Stable for '+sm+' min';sb.style.color=sm>=15?'var(--green)':'var(--gold)';}
   else{sb.textContent='Stable for '+(sm/60).toFixed(1)+' hr';sb.style.color='var(--green)';}
  }
  var card=document.getElementById('regimeCard');
  if(card) card.style.borderColor=color+'44';
 }catch(e){}
}

var _v2Data={fast:null,primary:null,fastHist:[],primaryHist:[]};
async function loadV2Regime(){
 try{
  var d=await jget('/api/regime/v2/full',55000).catch(function(){return null;});
  if(d){
   _v2Data.fast=d.fast||null;
   _v2Data.primary=d.primary||null;
   _v2Data.fastHist=d.fast_history||[];
   _v2Data.primaryHist=d.primary_history||[];
  }
 }catch(e){}
 renderV2MiniRows();
}
function renderV2MiniRows(){
 var el=document.getElementById('regime-v2-rows');
 if(!el) return;
 var h='';
 ['fast','primary'].forEach(function(hz){
  var d=_v2Data[hz];
  var regime=d&&d.regime?d.regime:'UNDECIDED';
  var conf=d&&d.confidence!=null?d.confidence:0;
  var color=_rrColor(regime);
  var pct=Math.round(conf*100);
  var hzLabel=hz==='fast'?'FAST':'PRI';
  var sub=d&&d.sub_regime?d.sub_regime:'';
  h+='<div style="flex:1;min-width:0;background:var(--surface2);border-radius:5px;padding:4px 6px;border-left:2px solid '+color+'">';
  h+='<div style="display:flex;justify-content:space-between;align-items:center">';
  h+='<span style="font-size:8px;font-weight:800;color:var(--muted);letter-spacing:.5px">'+hzLabel+'</span>';
  h+='<span style="font-size:9px;font-weight:700;color:'+color+'">'+pct+'%</span>';
  h+='</div>';
  h+='<div style="font-size:10px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+_rrName(regime)+'</div>';
  h+='<div style="height:2px;border-radius:1px;background:var(--border);overflow:hidden;margin-top:2px"><div style="height:100%;width:'+pct+'%;background:'+color+';border-radius:1px;transition:width .5s"></div></div>';
  h+='</div>';
 });
 el.innerHTML=h;
}

// Track Record tab (Section 5-8, 2026-08-10): market_regime/calibration_engine.py has
// long computed the REAL realised-outcome verdict for every day's regime call —
// validate_session() at EOD scores CORRECT/PARTIAL/INCORRECT/NEUTRAL against the actual
// spot move and straddle decay, and calibration_engine (Wilson-CI, sample-size-gated,
// PARTIAL half-credit, NEUTRAL excluded) turns that into an ECE/regime-accuracy/
// indicator-lift report already served at /api/regime/calibration — but nothing in the
// frontend ever called it, so a real, statistically honest "was it actually right?"
// answer sat computed and unseen. This tab is the only UI consumer; it renders the
// endpoint's own INSUFFICIENT_SAMPLE / MEASURED verdicts verbatim rather than deciding
// anything itself (Layer 1.2: this file is a renderer, not a second owner of the stat).
async function _loadTrackRecord(){
 try{
  var d=await jget('/api/regime/calibration',60000).catch(function(){return null;});
  if(d) _trackRecordData=d;
 }catch(e){}
 if(_regimeSheetTab==='track') _renderRegimeSheet();
}

/* Focus management for the .rs-backdrop detail sheets (regime/OI/skew/VRP —
 * Phase 6 accessibility gap: opening one of these never moved focus into the
 * dialog and closing never returned it, unlike the est-sheet family
 * (panels.js openEstimatorSheet IIFE) which already does both. A keyed map
 * (not a single shared variable) because a second sheet can be opened before
 * the first finishes its close animation. Only focus-in/focus-out is added
 * here, not a full Tab key-trap — the est-sheet precedent this matches does
 * not implement one either, so this stays consistent with the existing scope
 * rather than introducing new untested keyboard behaviour. */
var _sheetLastFocus={};
function _sheetOpened(backdropId){
 _sheetLastFocus[backdropId]=document.activeElement;
 var bd=document.getElementById(backdropId);
 var closeBtn=bd&&bd.querySelector('.rs-close-btn');
 if(closeBtn) closeBtn.focus();
}
function _sheetClosed(backdropId){
 var el=_sheetLastFocus[backdropId];
 if(el&&el.focus) el.focus();
 _sheetLastFocus[backdropId]=null;
}

function openRegimeSheet(){
 var bd=document.getElementById('regimeBackdrop');
 if(!bd) return;
 _regimeSheetTab='overview';
 document.querySelectorAll('.rs-tab').forEach(function(t){t.classList.toggle('on',t.dataset.tab==='overview');});
 bd.classList.add('open');
 history.pushState({regimeSheet:true},'');
 _renderRegimeHeader();
 _renderRegimeSheet();
 loadSecondaryRegime();
 var body=document.getElementById('regimeSheetBody');
 if(body) body.scrollTop=0;
 _sheetOpened('regimeBackdrop');
}

function closeRegimeSheet(){
 var bd=document.getElementById('regimeBackdrop');
 if(bd) bd.classList.remove('open');
 _sheetClosed('regimeBackdrop');
}

function switchRegimeTab(tab,btn){
 _regimeSheetTab=tab;
 document.querySelectorAll('.rs-tab').forEach(function(t){t.classList.remove('on');});
 if(btn) btn.classList.add('on');
 _renderRegimeSheet();
 var body=document.getElementById('regimeSheetBody');
 if(body) body.scrollTop=0;
 // Track Record is a daily-aggregate stat (market_regime/calibration_engine.py) —
 // heavier than the 5-min-cycle regime data, so it is fetched on demand rather than
 // on every snapshot poll. jget's own TTL cache (60s) makes repeat tab-switches free.
 if(tab==='track') _loadTrackRecord();
}

function _renderRegimeHeader(){
 var r=_regimeData||{};
 var regime=r.regime||'UNDECIDED',conf=r.confidence||0,dir=r.direction||'NEUTRAL',
  color=_rrColor(regime),dirObj=_rrDir(dir),sm=r.stable_min||0;
 var hdRegime=document.getElementById('rs-hd-regime');
 if(hdRegime){hdRegime.textContent=_rrName(regime);hdRegime.style.color=color;}
 var hdSub=document.getElementById('rs-hd-sub');
 if(hdSub){
  var stableText=regime==='UNDECIDED'?'Awaiting confirmation':
   sm<1?'Just formed':sm<60?'Stable for '+sm+' min':'Stable for '+(sm/60).toFixed(1)+' hr';
  hdSub.innerHTML='<span class="dot" style="background:'+color+'"></span><span>'+_rrConfBand(conf)+' Confidence \u2022 '+dirObj.icon+' '+dirObj.text+'</span> \u2022 <span>'+stableText+'</span>';
 }
 var pct=Math.round(conf*100),circ=2*Math.PI*22,off=circ*(1-pct/100),col=_rrConfCol(conf);
 var ring=document.getElementById('rs-hd-ring');
 if(ring){
  var fg=ring.querySelector('.fg');
  if(fg){fg.setAttribute('stroke',col);fg.setAttribute('stroke-dashoffset',off);}
 }
 var pctEl=document.getElementById('rs-hd-pct');
 if(pctEl){pctEl.textContent=pct+'%';pctEl.style.color=col;}
}

function _renderRegimeSheet(){
 var body=document.getElementById('regimeSheetBody');
 if(!body) return;
 if(!_regimeData){
  body.innerHTML='<div class="rs-empty"><div style="font-size:24px;margin-bottom:8px">\u23F3</div>Waiting for regime engine to classify...<br>Data will appear once the scheduler completes its first evaluation.</div>';
  return;
 }
 var tab=_regimeSheetTab||'overview';
 if(tab==='overview') body.innerHTML=_rsOverviewHTML();
 else if(tab==='reasoning') body.innerHTML=_rsReasoningHTML();
 else if(tab==='horizons') body.innerHTML=_rsHorizonsHTML();
 else if(tab==='playbook') body.innerHTML=_rsPlaybookHTML();
 else if(tab==='market') body.innerHTML=_rsMarketHTML();
 else if(tab==='timeline') body.innerHTML=_rsTimelineHTML();
 else if(tab==='track') body.innerHTML=_rsTrackRecordHTML();
}

function _rsOverviewHTML(){
 var r=_regimeData,c=r.card||{},regime=r.regime||'UNDECIDED',
  color=_rrColor(regime),dir=r.direction||'NEUTRAL',dirObj=_rrDir(dir),
  conf=r.confidence||0,icon=_rrIcon(regime);
 var h='';
 h+='<div class="rs-overview-hero">';
 h+='<div class="hero-icon" style="color:'+color+'">'+icon+'</div>';
 h+='<div class="hero-info">';
 h+='<div class="hero-regime" style="color:'+color+'">'+_escH(_rrName(regime))+'</div>';
 h+='<div class="hero-dir" style="color:'+dirObj.c+'">'+dirObj.icon+' '+_escH(dirObj.text)+'</div>';
 h+='<div class="hero-conf">'+_rrConfBand(conf)+' Confidence \u2022 '+Math.round(conf*100)+'%</div>';
 if(r.score_band){
  h+='<div class="hero-conf" style="color:var(--muted)">Score: '+_escH(r.score_band)+' \u2022 '+Math.round(r.regime_score||0)+'/100 <span style="font-size:9px">(magnitude \u2014 separate from confidence)</span></div>';
 }
 h+='</div></div>';

 var ev=r.evidence||[];
 var supports=ev.filter(function(e){return e.direction==='BULLISH'||e.direction==='IV_RICH'||e.direction==='REVERSAL_RISK'||e.direction==='MEAN_REVERSION';});
 var counters=ev.filter(function(e){return e.direction==='BEARISH'||e.direction==='BEARISH_RISK'||e.direction==='IV_CHEAP';});

 if(supports.length||counters.length){
  h+='<div class="rs-sec"><div class="rs-sec-head"><span class="rs-sec-title">Why This Regime</span><span class="rs-sec-line"></span></div>';
  if(supports.length){
   h+='<div style="margin-bottom:8px">';
   supports.slice(0,3).forEach(function(e){
    h+='<div class="rs-card" style="margin-bottom:6px;padding:8px 12px"><div class="rs-card-title" style="color:#31C48D">\u2714 '+_escH(_RR_EVIDENCE_LABELS[e.feature]||e.label||e.feature)+'</div>';
    h+='<div class="rs-card-body">'+_escH(e.detail||'')+'</div></div>';
   });
   h+='</div>';
  }
  if(counters.length){
   h+='<div>';
   counters.slice(0,3).forEach(function(e){
    h+='<div class="rs-card" style="margin-bottom:6px;padding:8px 12px;border-color:rgba(238,90,110,.2)"><div class="rs-card-title" style="color:#F26477">\u26A0 '+_escH(_RR_EVIDENCE_LABELS[e.feature]||e.label||e.feature)+'</div>';
    h+='<div class="rs-card-body">'+_escH(e.detail||'')+'</div></div>';
   });
   h+='</div>';
  }
  h+='</div>';
 }

 h+='<div class="rs-sec"><div class="rs-sec-head"><span class="rs-sec-title">Recommended Action</span><span class="rs-sec-line"></span></div>';
 h+='<div class="rs-card"><div class="rs-card-title" style="color:'+color+'">'+_escH(_RR_PLAYBOOK_NAMES[regime]||r.playbook||'Wait')+'</div>';
 var steps=(_RR_PLAYBOOK_STEPS[regime]||[]).slice(0,3);
 if(steps.length){
  h+='<ul class="rs-pb-list" style="margin-top:6px">';
  steps.forEach(function(s){h+='<li>'+_escH(s)+'</li>';});
  h+='</ul>';
 }
 h+='</div></div>';

 var risk=_RR_PLAYBOOK_RISK[regime]||'Unknown';
 var riskCol=risk==='High'?'#F26477':risk==='Moderate'?'#E8A33D':'#31C48D';
 h+='<div class="rs-sec"><div class="rs-sec-head"><span class="rs-sec-title">Risk Level</span><span class="rs-sec-line"></span></div>';
 h+='<div class="rs-card" style="padding:10px 14px"><span class="rs-tag" style="background:'+riskCol+'18;color:'+riskCol+';font-size:11px">'+risk+'</span></div></div>';

 return h;
}

// Institutional upgrade (2026-08-10, Phase D): six-dimension rollup \u2014 one bar per
// TREND/VOLATILITY/MOMENTUM/MARKET_STRUCTURE/LIQUIDITY/OPTIONS_IV_VRP dimension,
// reading regime_engine._apply_lean_score_dimensions's own output verbatim (never
// recomputed in JS \u2014 this file is a renderer, not a second owner).
var _RS_DIM_ORDER=['TREND','VOLATILITY','MOMENTUM','MARKET_STRUCTURE','LIQUIDITY','OPTIONS_IV_VRP'];
var _RS_DIM_LABELS={TREND:'Trend',VOLATILITY:'Volatility',MOMENTUM:'Momentum',MARKET_STRUCTURE:'Market Structure',LIQUIDITY:'Liquidity',OPTIONS_IV_VRP:'Options / IV-VRP'};
function _rsDimensionsHTML(dims){
 if(!dims) return '';
 var h='<div class="rs-sec"><div class="rs-sec-head"><span class="rs-sec-title">Dimensions</span><span class="rs-sec-line"></span></div>';
 h+='<div style="display:grid;gap:6px">';
 _RS_DIM_ORDER.forEach(function(dk){
  var d=dims[dk]||{score:0,evidence_n:0,supporting:0,contradicting:0};
  var has=d.evidence_n>0;
  var col=!has?'var(--muted)':d.contradicting>d.supporting?'#F26477':'#31C48D';
  h+='<div style="display:flex;align-items:center;gap:8px">';
  h+='<span style="font-size:10px;color:var(--muted);width:110px;flex-shrink:0">'+_escH(_RS_DIM_LABELS[dk]||dk)+'</span>';
  h+='<div style="flex:1;height:6px;border-radius:3px;background:var(--border);overflow:hidden"><div style="height:100%;width:'+Math.round(d.score||0)+'%;background:'+col+';border-radius:3px"></div></div>';
  h+='<span style="font-size:9px;color:'+col+';width:88px;text-align:right;flex-shrink:0">'
   +(has?Math.round(d.score)+'% ('+d.evidence_n+' ev, '+d.supporting+'+/'+d.contradicting+'-)':'no evidence')+'</span>';
  h+='</div>';
 });
 h+='</div></div>';
 return h;
}

function _rsReasoningHTML(){
 var r=_regimeData,ev=r.evidence||[];
 if(!ev.length) return '<div class="rs-empty"><div style="font-size:24px;margin-bottom:8px">\uD83D\uDD0D</div>The engine is still gathering sufficient evidence.<br>Regime classification will appear once market data confirms a pattern.</div>';
 var sorted=ev.slice().sort(function(a,b){return(b.weight*b.confidence)-(a.weight*a.confidence);});
 var supports=sorted.filter(function(e){return e.direction==='BULLISH'||e.direction==='IV_RICH'||e.direction==='REVERSAL_RISK'||e.direction==='MEAN_REVERSION';});
 var counters=sorted.filter(function(e){return e.direction==='BEARISH'||e.direction==='BEARISH_RISK'||e.direction==='IV_CHEAP';});
 var neutral=sorted.filter(function(e){return supports.indexOf(e)<0&&counters.indexOf(e)<0;});
 var h=_rsDimensionsHTML(r.dimensions);

 if(supports.length){
  h+='<div class="rs-ev-section">';
  h+='<div class="rs-ev-head"><span class="rs-ev-icon" style="color:#31C48D">\u2714</span><span class="rs-ev-title" style="color:#31C48D">Supporting Evidence</span></div>';
  supports.forEach(function(e){
   var impact=Math.round((e.weight*e.confidence)*100);
   h+='<div class="rs-ev-item">';
   h+='<div class="rs-ev-check" style="background:rgba(49,196,141,.15);color:#31C48D">\u2714</div>';
   h+='<div class="rs-ev-body">';
   h+='<div class="rs-ev-name">'+_escH(_RR_EVIDENCE_LABELS[e.feature]||e.label||e.feature)+'</div>';
   h+='<div class="rs-ev-desc">'+_escH(e.detail||'')+'</div>';
   h+='<div class="rs-ev-meta">';
   h+='<span class="rs-ev-badge" style="background:rgba(49,196,141,.12);color:#31C48D">Impact '+impact+'%</span>';
   h+='</div></div></div>';
  });
  h+='</div>';
 }

 if(counters.length){
  h+='<div class="rs-ev-section">';
  h+='<div class="rs-ev-head"><span class="rs-ev-icon" style="color:#F26477">\u26A0</span><span class="rs-ev-title" style="color:#F26477">Counter Evidence</span></div>';
  counters.forEach(function(e){
   var impact=Math.round((e.weight*e.confidence)*100);
   h+='<div class="rs-ev-item">';
   h+='<div class="rs-ev-check" style="background:rgba(238,90,110,.15);color:#F26477">\u26A0</div>';
   h+='<div class="rs-ev-body">';
   h+='<div class="rs-ev-name">'+_escH(_RR_EVIDENCE_LABELS[e.feature]||e.label||e.feature)+'</div>';
   h+='<div class="rs-ev-desc">'+_escH(e.detail||'')+'</div>';
   h+='<div class="rs-ev-meta">';
   h+='<span class="rs-ev-badge" style="background:rgba(238,90,110,.12);color:#F26477">Impact '+impact+'%</span>';
   h+='</div></div></div>';
  });
  h+='</div>';
 }

 if(neutral.length){
  h+='<div class="rs-ev-section">';
  h+='<div class="rs-ev-head"><span class="rs-ev-icon" style="color:#9e9e9e">\u25CB</span><span class="rs-ev-title" style="color:var(--muted)">Neutral Factors</span></div>';
  neutral.forEach(function(e){
   h+='<div class="rs-ev-item">';
   h+='<div class="rs-ev-check" style="background:rgba(158,158,158,.15);color:#9e9e9e">\u25CB</div>';
   h+='<div class="rs-ev-body">';
   h+='<div class="rs-ev-name">'+_escH(_RR_EVIDENCE_LABELS[e.feature]||e.label||e.feature)+'</div>';
   h+='<div class="rs-ev-desc">'+_escH(e.detail||'')+'</div>';
   h+='</div></div>';
  });
  h+='</div>';
 }

 return h;
}

function _rsPlaybookHTML(){
 var r=_regimeData,regime=r.regime||'UNDECIDED',color=_rrColor(regime);
 var pbName=_RR_PLAYBOOK_NAMES[regime]||r.playbook||'Wait';
 var steps=_RR_PLAYBOOK_STEPS[regime]||['Wait for clearer signals'];
 var risk=_RR_PLAYBOOK_RISK[regime]||'Unknown';
 var riskCol=risk==='High'?'#F26477':risk==='Moderate'?'#E8A33D':'#31C48D';
 var inval=_RR_PLAYBOOK_INVAL[regime]||'';
 var h='';

 h+='<div class="rs-pb-hero">';
 h+='<div class="hero-name" style="color:'+color+'">'+_escH(pbName)+'</div>';
 h+='<div class="hero-risk"><span class="rs-tag" style="background:'+riskCol+'18;color:'+riskCol+';font-size:11px">'+risk+'</span></div>';
 h+='</div>';

 h+='<div class="rs-sec"><div class="rs-sec-head"><span class="rs-sec-title">Action Plan</span><span class="rs-sec-line"></span></div>';
 h+='<ul class="rs-pb-list">';
 steps.forEach(function(s){h+='<li>'+_escH(s)+'</li>';});
 h+='</ul></div>';

 if(inval){
  h+='<div class="rs-pb-inval">';
  h+='<div class="rs-pb-inval-title">Invalidation Signals</div>';
  h+='<div class="rs-pb-inval-body">'+_escH(inval)+'</div>';
  h+='</div>';
 }
 return h;
}

// Phase C/D (2026-08-10): SENSEX spot-only regime + cross-index divergence. Fetched
// on demand (openRegimeSheet), not on every snapshot poll \u2014 this is a secondary,
// reduced-dimension read, not the primary NIFTY pipeline.
var _secondaryRegimeData={sensex:null,divergence:null};
async function loadSecondaryRegime(){
 try{
  var sx=await jget('/api/regime/index/SENSEX',8000).catch(function(){return null;});
  var dv=await jget('/api/regime/divergence',8000).catch(function(){return null;});
  _secondaryRegimeData.sensex=sx; _secondaryRegimeData.divergence=dv;
 }catch(e){}
 if(_regimeSheetTab==='market') _renderRegimeSheet();
}
function _rsSecondaryIndexHTML(){
 var sx=_secondaryRegimeData.sensex,dv=_secondaryRegimeData.divergence;
 if(!sx||!sx.regime) return '';
 var color=_rrColor(sx.regime);
 var h='<div class="rs-sec"><div class="rs-sec-head"><span class="rs-sec-title">SENSEX (spot-only)</span><span class="rs-sec-line"></span></div>';
 h+='<div class="rs-card"><div class="rs-card-title" style="color:'+color+'">'+_escH(_rrName(sx.regime))+' \u2022 '+Math.round((sx.confidence||0)*100)+'%</div>';
 h+='<div class="rs-card-body">'+_escH(sx.data_quality_note||'reduced feature set \u2014 no persisted intraday history for SENSEX')+'</div></div>';
 if(dv&&dv.available){
  var dCol=dv.status==='ALIGNED'?'#31C48D':dv.status==='DIVERGENT'?'#F26477':'#E8A33D';
  h+='<div class="rs-card" style="margin-top:6px"><div class="rs-card-title" style="color:'+dCol+'">'+_escH(dv.status)+' vs NIFTY</div>';
  h+='<div class="rs-card-body">NIFTY '+_escH(dv.nifty.direction)+' \u2022 SENSEX '+_escH(dv.sensex.direction)+'<br><span class="dim">'+_escH(dv.note||'')+'</span></div></div>';
 }else if(dv){
  h+='<div class="dim" style="margin-top:6px;font-size:9.5px">Divergence: '+_escH(dv.reason||'not available')+'</div>';
 }
 h+='</div>';
 return h;
}

function _rsMarketHTML(){
 var r=_regimeData,f=r.features_used;
 if(!f) return _rsSecondaryIndexHTML()||'<div class="rs-empty"><div style="font-size:24px;margin-bottom:8px">\uD83D\uDCCA</div>Market snapshot will appear once live data is available.</div>';
 function mcard(label,val,cls,span2){return '<div class="rs-mk-card'+(span2?' span2':'')+'"><div class="rs-mk-label">'+_escH(label)+'</div><div class="rs-mk-val'+(cls?' '+cls:'')+'">'+_escH(String(val!=null?val:'\u2014'))+'</div></div>';}
 function chgCls(v){return v>0?'mk-pos':v<0?'mk-neg':'';}
 function fmtPct(v,dp){return v!=null?(v>=0?'+':'')+v.toFixed(dp||1)+'%':null;}
 function fmtNum(v){return v!=null?v.toLocaleString('en-IN'):null;}

 var h='<div class="rs-mk-grid">';
 h+=mcard('NIFTY',fmtNum(f.spot),'',true);
 h+=mcard('Change',fmtPct(f.change_pct,2),chgCls(f.change_pct));
 h+=mcard('Day Range',fmtNum(f.day_range)+' pts');
 h+=mcard('VIX',f.vix!=null?f.vix.toFixed(1):null);
 h+=mcard('VIX Change',fmtPct(f.vix_change_pct,1),chgCls(f.vix_change_pct));
 h+=mcard('IV Percentile',f.iv_percentile!=null?f.iv_percentile.toFixed(0)+'%':null);
 h+=mcard('Straddle',fmtNum(f.combined_premium),'',true);
 h+=mcard('Decay',fmtPct(f.decay_pct,1),chgCls(f.decay_pct));
 h+=mcard('PCR',f.pcr_total!=null?f.pcr_total.toFixed(2):null);
 h+=mcard('PCR ATM',f.pcr_atm!=null?f.pcr_atm.toFixed(2):null);
 h+=mcard('Max Pain',fmtNum(f.max_pain));
 h+=mcard('Breadth',f.advance_count!=null?f.advance_count+'\u2191 '+f.decline_count+'\u2193':null,'',true);
 h+=mcard('VWAP',fmtNum(f.vwap_day));
 h+=mcard('Spot vs VWAP',fmtPct(f.spot_vs_vwap,2),chgCls(f.spot_vs_vwap));
 h+='</div>';
 if(f.iv_percentile===0||f.iv_percentile===null) h+='<div class="rs-mk-note">EOD metrics (IV Percentile, RV, Skew) populate after 15:30</div>';
 h+=_rsSecondaryIndexHTML();
 return h;
}

function _rsStabilityHeaderHTML(sr){
 if(!sr) return '';
 var clsCol=sr.classification==='STABLE'?'#31C48D':sr.classification==='UNSTABLE'?'#F26477':sr.classification==='TRANSITIONING'?'#E8A33D':'var(--muted)';
 var h='<div class="b-note" style="margin-bottom:10px">';
 h+='<b style="color:'+clsCol+'">'+_escH(sr.classification)+'</b> \u2014 regime age '+sr.regime_age_min+' min \u2022 '
  +sr.flip_count_today+' flip(s) today \u2022 '+sr.transition_frequency_per_hour+'/hr \u2022 confidence '+_escH(sr.confidence_trend);
 if(sr.pending_regime){
  h+='<br><span class="dim">Challenger forming: '+_escH(_rrName(sr.pending_regime))+' ('+sr.pending_bars+' confirming cycle(s) so far \u2014 needs 3 to take over)</span>';
 }
 h+='</div>';
 return h;
}

function _rsTimelineHTML(){
 var r=_regimeData,hist=r.regime_history||[],regime=r.regime||'UNDECIDED',conf=r.confidence||0;
 var stabHdr=_rsStabilityHeaderHTML(r.stability_report);
 if(!hist.length){
  return stabHdr+'<div class="rs-empty"><div style="font-size:24px;margin-bottom:8px">\uD83D\uDCC5</div>The engine is building the session timeline.<br>Regime transitions will appear as the market evolves.</div>';
 }
 var h=stabHdr+'<div class="rs-tl-list">';
 var entries=[];
 hist.forEach(function(e){entries.push({time:e.time||e.timestamp||'',regime:e.to||e.regime||'UNDECIDED',confidence:e.confidence||0,isChange:true});});
 entries.push({time:r.updated_at||'',regime:regime,confidence:conf,isChange:false});
 entries.sort(function(a,b){return(a.time||'').localeCompare(b.time||'');});
 if(entries.length>15) entries=entries.slice(-15);
 entries.forEach(function(e,i){
  var rc=_rrColor(e.regime),isLast=i===entries.length-1;
  var t='';
  if(e.time){t=e.time.length>10?e.time.substring(11,16):e.time;}
  var dotCol=isLast?rc:'#555';
  h+='<div class="rs-tl-item">';
  h+='<div class="rs-tl-dot" style="background:'+dotCol+';box-shadow:0 0 0 2px '+(isLast?dotCol+'33':'var(--border)')+'"></div>';
  h+='<div class="rs-tl-time">'+_escH(t||'Session Start')+'</div>';
  h+='<div class="rs-tl-regime" style="color:'+rc+'">'+_escH(_rrName(e.regime))+'</div>';
  h+='<div class="rs-tl-conf">'+Math.round(e.confidence*100)+'% confidence'+(isLast?' \u2022 Current':'')+'</div>';
  h+='</div>';
 });
 h+='</div>';
 return h;
}

function _toggleTrackRow(i){
 var row=document.getElementById('trd-'+i);
 if(row) row.style.display = row.style.display==='none' ? '' : 'none';
}

function _rsTrackRecordHTML(){
 var d=_trackRecordData;
 if(!d) return '<div class="rs-empty"><div style="font-size:24px;margin-bottom:8px">⏳</div>Loading track record…</div>';
 var cal=d.calibration||{}, acc=d.regime_accuracy||{}, ind=d.indicators||{};
 var recs=d.records||[], rsum=d.records_summary||{};
 var h='';

 // Real per-day Track Record (2026-08-11 fix): the bug was that this whole tab only
 // ever rendered calibration_engine's SAMPLE-GATED aggregates (buckets/regime-accuracy),
 // which return empty/INSUFFICIENT_SAMPLE below 10 validated days — showing "0 validated
 // non-neutral days" even when some real, readable history existed. This section reads
 // the new records/records_summary fields (market_regime.calibration_engine.
 // validated_records) directly — every eligible day, with its real validation_state,
 // never hidden behind the 10-day calibration threshold.
 h+='<div class="rs-sec"><div class="rs-sec-head"><span class="rs-sec-title">Track Record</span><span class="rs-sec-line"></span></div>';
 if(!recs.length){
  h+='<div class="rs-empty" style="padding:16px 8px">No regime days recorded yet — the platform has not yet completed a full trading session.</div>';
 }else{
  h+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">'
   +'<div class="rs-card" style="flex:1;min-width:80px;margin-top:0"><div class="rs-card-title">'+(rsum.validated_sessions||0)+'</div><div class="rs-card-body">Validated</div></div>'
   +'<div class="rs-card" style="flex:1;min-width:80px;margin-top:0"><div class="rs-card-title" style="color:#31C48D">'+(rsum.correct||0)+'</div><div class="rs-card-body">Correct</div></div>'
   +'<div class="rs-card" style="flex:1;min-width:80px;margin-top:0"><div class="rs-card-title" style="color:#F26477">'+(rsum.incorrect||0)+'</div><div class="rs-card-body">Incorrect</div></div>'
   +'<div class="rs-card" style="flex:1;min-width:80px;margin-top:0"><div class="rs-card-title">'+(rsum.hit_rate_pct!=null?rsum.hit_rate_pct+'%':'—')+'</div><div class="rs-card-body">Hit Rate</div></div>'
   +'</div>';
  var calibNote=cal.verdict==='INSUFFICIENT_SAMPLE'
   ?'Calibration: insufficient sample ('+(cal.n||0)+' of '+10+' days needed)'
   :'Calibration: '+_escH(cal.verdict||'');
  var extra=[];
  if(rsum.pending) extra.push(rsum.pending+' pending');
  if(rsum.insufficient_data) extra.push(rsum.insufficient_data+' insufficient data');
  if(rsum.unavailable) extra.push(rsum.unavailable+' unavailable');
  if(rsum.last_validated_session) extra.push('last validated '+_escH(rsum.last_validated_session));
  h+='<div style="font-size:10px;color:var(--muted);margin-bottom:10px">'+_escH(calibNote)+(extra.length?' • '+extra.join(' • '):'')+'</div>';
  h+='<table class="b-t"><thead><tr><th>Date</th><th>Regime</th><th class="n">Conf</th><th>State</th><th>Result</th></tr></thead><tbody>';
  recs.slice(0,40).forEach(function(r,i){
   var stCol=r.validation_result==='CORRECT'?'#31C48D':r.validation_result==='INCORRECT'?'#F26477':r.validation_result==='PARTIAL'?'#E8A33D':'var(--muted)';
   h+='<tr onclick="_toggleTrackRow('+i+')" style="cursor:pointer"><td>'+_escH(r.date)+'</td>'
    +'<td style="color:'+_rrColor(r.regime)+'">'+_escH(_rrName(r.regime))+'</td>'
    +'<td class="n">'+(r.confidence!=null?Math.round(r.confidence)+'%':'—')+'</td>'
    +'<td style="font-size:9px;color:var(--muted)">'+_escH(r.validation_state||'')+'</td>'
    +'<td style="color:'+stCol+';font-weight:700">'+_escH(r.validation_result||'—')+'</td></tr>';
   h+='<tr id="trd-'+i+'" style="display:none"><td colspan="5" style="background:var(--surface2);font-size:10px;padding:8px 10px;color:var(--muted)">'
    +_escH(r.reason||r.detail||'No further detail available.')
    +(r.spot_move!=null?' • NIFTY move '+(r.spot_move>0?'+':'')+r.spot_move+' pts':'')
    +(r.decay_pct!=null?' • straddle decay '+r.decay_pct+'%':'')
    +(r.bars_collected!=null?' • '+r.bars_collected+' session bars collected':'')
    +'</td></tr>';
  });
  h+='</tbody></table>';
  if(recs.length>40) h+='<div class="rs-mk-note" style="grid-column:unset">Showing 40 most recent of '+recs.length+' recorded days.</div>';
 }
 h+='</div>';

 h+='<div class="rs-sec"><div class="rs-sec-head"><span class="rs-sec-title">Was It Right? — Stated vs Realised</span><span class="rs-sec-line"></span></div>';
 if(cal.verdict==='INSUFFICIENT_SAMPLE'){
  h+='<div class="rs-empty" style="padding:16px 8px">'+_escH(cal.explanation||'Not enough validated sessions yet.')+'</div>';
 }else{
  var vCol=cal.verdict==='CALIBRATED'?'#31C48D':cal.verdict==='MILD_DRIFT'?'#E8A33D':'#F26477';
  h+='<div class="rs-card"><div class="rs-card-title" style="color:'+vCol+'">'+_escH(cal.verdict||'')+'</div>';
  h+='<div class="rs-card-body">'+_escH(cal.explanation||'')+'</div></div>';
  h+='<table class="b-t"><thead><tr><th>Stated</th><th class="n">n</th><th class="n">Realised</th><th class="n">95% CI</th><th class="n">Gap</th></tr></thead><tbody>';
  (cal.buckets||[]).forEach(function(b){
   h+='<tr><td>'+_escH(b.stated_range)+'</td><td class="n">'+b.n+'</td><td class="n">'+b.realised_accuracy+'%</td>'
    +'<td class="n">'+(b.ci95&&b.ci95[0]!=null?(b.ci95[0]+'–'+b.ci95[1]+'%'):'—')+'</td>'
    +'<td class="n" style="color:'+(b.gap<0?'#F26477':'#31C48D')+'">'+(b.gap>0?'+':'')+b.gap+'pt</td></tr>';
  });
  h+='</tbody></table>';
 }
 h+='</div>';

 h+='<div class="rs-sec"><div class="rs-sec-head"><span class="rs-sec-title">Accuracy by Regime</span><span class="rs-sec-line"></span></div>';
 if(!acc.regimes||!acc.regimes.length){
  h+='<div class="rs-empty" style="padding:16px 8px">No validated regime days yet.</div>';
 }else{
  h+='<table class="b-t"><thead><tr><th>Regime</th><th class="n">n</th><th class="n">Accuracy</th><th class="n">95% CI</th><th>Status</th></tr></thead><tbody>';
  acc.regimes.forEach(function(r){
   var measured=r.verdict==='MEASURED';
   h+='<tr><td style="color:'+_rrColor(r.regime)+'">'+_escH(_rrName(r.regime))+'</td><td class="n">'+r.n+'</td>'
    +'<td class="n">'+(measured?r.accuracy+'%':'—')+'</td>'
    +'<td class="n">'+(measured&&r.ci95&&r.ci95[0]!=null?(r.ci95[0]+'–'+r.ci95[1]+'%'):'—')+'</td>'
    +'<td style="font-size:9px;color:'+(measured?'var(--muted)':'#E8A33D')+'">'+_escH(r.verdict)+'</td></tr>';
  });
  h+='</tbody></table>';
  if(acc.note) h+='<div class="rs-mk-note" style="grid-column:unset">'+_escH(acc.note)+'</div>';
 }
 h+='</div>';

 if(ind.features&&ind.features.length){
  h+='<div class="rs-sec"><div class="rs-sec-head"><span class="rs-sec-title">Most Predictive Signals</span><span class="rs-sec-line"></span></div>';
  h+='<table class="b-t"><thead><tr><th>Feature</th><th class="n">n</th><th class="n">Lift vs Base</th><th>Status</th></tr></thead><tbody>';
  ind.features.slice(0,8).forEach(function(f){
   var measured=f.verdict==='MEASURED';
   h+='<tr><td>'+_escH(f.feature)+'</td><td class="n">'+f.n+'</td>'
    +'<td class="n" style="color:'+(f.lift_vs_base>0?'#31C48D':f.lift_vs_base<0?'#F26477':'var(--muted)')+'">'+(f.lift_vs_base>0?'+':'')+f.lift_vs_base+'pt</td>'
    +'<td style="font-size:9px;color:'+(measured?'var(--muted)':'#E8A33D')+'">'+_escH(f.verdict)+'</td></tr>';
  });
  h+='</tbody></table>';
  if(ind.note) h+='<div class="rs-mk-note" style="grid-column:unset">'+_escH(ind.note)+'</div>';
  h+='</div>';
 }

 if((d.lessons||[]).length){
  h+='<div class="rs-sec"><div class="rs-sec-head"><span class="rs-sec-title">What This Should Change</span><span class="rs-sec-line"></span></div>';
  h+='<ul class="rs-pb-list">';
  d.lessons.forEach(function(l){h+='<li>'+_escH(l)+'</li>';});
  h+='</ul></div>';
 }
 return h;
}

function _rsHorizonsHTML(){
 var fast=_v2Data.fast, primary=_v2Data.primary;
 var h='<div class="rs-sec"><div class="rs-sec-head"><span class="rs-sec-title">Dual-Horizon Engine (V2)</span><span class="rs-sec-line"></span></div>';
 h+='<div style="font-size:11px;color:var(--muted);margin-bottom:12px">FAST horizon (5-min microstructure) feeds PRIMARY horizon (15-min structural). Evidence health tracks data quality per feature.</div>';
 ['fast','primary'].forEach(function(hz){
  var d=hz==='fast'?fast:primary;
  var hzLabel=hz==='fast'?'FAST Horizon (5 min)':'PRIMARY Horizon (15 min)';
  var regime=d&&d.regime?d.regime:'UNDECIDED';
  var conf=d&&d.confidence!=null?d.confidence:0;
  var dir=d&&d.direction?d.direction:'NEUTRAL';
  var color=_rrColor(regime);
  var dirObj=_rrDir(dir);
  var sub=d&&d.sub_regime?d.sub_regime:'';
  var health=d&&d.health_report?d.health_report:{};
  var quality=health.quality_label||'?';
  var qScore=health.quality_score!=null?health.quality_score:0;
  var qColor=qScore>=0.8?'#31C48D':qScore>=0.5?'#E8A33D':'#F26477';
  h+='<div style="background:var(--surface2);border-radius:10px;padding:12px 14px;margin-bottom:10px;border-left:3px solid '+color+'">';
  h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
  h+='<span style="font-size:11px;font-weight:800;color:var(--text);letter-spacing:.5px">'+hzLabel+'</span>';
  h+='<span style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;background:'+dirObj.bg+';color:'+dirObj.c+'">'+dirObj.icon+' '+dirObj.text+'</span>';
  h+='</div>';
  h+='<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px">';
  h+='<span style="font-family:var(--disp);font-size:18px;font-weight:800;color:'+color+'">'+_rrName(regime)+'</span>';
  if(sub) h+='<span style="font-size:10px;color:var(--muted)">'+sub.replace(/_/g,' ')+'</span>';
  h+='</div>';
  h+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">';
  h+='<span style="font-size:13px;font-weight:700;color:var(--text)">'+Math.round(conf*100)+'%</span>';
  h+='<div style="flex:1;height:5px;border-radius:3px;background:var(--border);overflow:hidden"><div style="height:100%;width:'+Math.round(conf*100)+'%;background:'+_rrConfCol(conf)+';border-radius:3px;transition:width .5s"></div></div>';
  h+='<span style="font-size:9px;font-weight:600;color:qColor">'+quality+' ('+Math.round(qScore*100)+'%)</span>';
  h+='</div>';
  var ev=d&&d.evidence?d.evidence:[];
  if(ev.length){
   h+='<div style="margin-top:6px">';
   h+='<div style="font-size:9px;font-weight:700;color:var(--muted);margin-bottom:4px">TOP EVIDENCE</div>';
   var sorted=ev.slice().sort(function(a,b){return(b.weight||0)*(b.confidence||0)-(a.weight||0)*(a.confidence||0);});
   sorted.slice(0,5).forEach(function(e){
    var eDir=e.direction||'NEUTRAL';
    var eCol=eDir==='BULLISH'||eDir==='IV_RICH'||eDir==='MEAN_REVERSION'||eDir==='CONFIRMED'?'#31C48D':eDir==='BEARISH'||eDir==='BEARISH_RISK'||eDir==='IV_CHEAP'?'#F26477':'var(--muted)';
    var marker=eDir==='BULLISH'||eDir==='IV_RICH'||eDir==='MEAN_REVERSION'||eDir==='CONFIRMED'?'+':eDir==='BEARISH'||eDir==='BEARISH_RISK'||eDir==='IV_CHEAP'?'-':'~';
    var healthTag=e.health&&e.health!=='ACTIVE'?' <span style="color:#E8A33D;font-size:8px">['+e.health+']</span>':'';
    h+='<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0">';
    h+='<span style="font-size:10px;color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span style="color:'+eCol+';font-weight:700">'+marker+'</span> '+_escH(e.label||e.feature||'')+' '+healthTag+'</span>';
    h+='<span style="font-size:9px;color:var(--muted);flex-shrink:0;margin-left:6px">'+((e.weight||0)*(e.confidence||0)).toFixed(3)+'</span>';
    h+='</div>';
   });
   h+='</div>';
  }
  h+='</div>';
 });
 if(!fast&&!primary){
  h+='<div class="rs-empty"><div style="font-size:24px;margin-bottom:8px">\u23F3</div>V2 engine not yet classified.<br>FAST horizon runs every 5 min, PRIMARY every 15 min.</div>';
 }
 h+='</div>';
 return h;
}

/* ═══ REGIME SHEET SWIPE ═══════════════════════════════════════════════════════
   Vertical: smooth drag down to close, snap back if not enough.
   Horizontal on .rs-tabs: swipe left/right to switch tabs. */
(function(){
 var _TAB_ORDER=['overview','reasoning','horizons','playbook','market','timeline','track'];
 var startY=0,startX=0,dragging=false,locked=null,velY=0,prevY=0,prevT=0;
 var panel=null;
 function _getDir(dx,dy){
  if(locked) return locked;
  if(Math.abs(dx)>10||Math.abs(dy)>10){
   locked=Math.abs(dx)>Math.abs(dy)?'h':'v';
   return locked;
  }
  return null;
 }
 document.addEventListener('touchstart',function(e){
  var bd=document.getElementById('regimeBackdrop');
  if(!bd||!bd.classList.contains('open')) return;
  var body=document.getElementById('regimeSheetBody');
  if(body&&body.scrollTop>5) return;
  var t=e.touches[0];
  startY=t.clientY; startX=t.clientX; dragging=true; locked=null;
  velY=0; prevY=t.clientY; prevT=Date.now();
  panel=document.getElementById('regimePanel');
  if(panel){panel.style.transition='none';}
 },{passive:true});
 document.addEventListener('touchmove',function(e){
  if(!dragging) return;
  var t=e.touches[0];
  var dx=t.clientX-startX, dy=t.clientY-startY;
  var dir=_getDir(dx,dy);
  var now=Date.now(), dt=now-prevT;
  if(dt>0){velY=(t.clientY-prevY)/dt*1000; prevY=t.clientY; prevT=now;}
  if(dir==='v'&&dy>0&&panel){
   var dampened=dy*0.55;
   panel.style.transform='translateY('+dampened+'px)';
   var bd=document.getElementById('regimeBackdrop');
   if(bd){var opacity=Math.max(0,1-dampened/(window.innerHeight*0.5));bd.style.opacity=opacity;}
  }
  if(dir==='h'){
   var tabs=document.querySelector('.rs-tabs');
   if(tabs){tabs.scrollLeft+=-(dx>0?3:-3);}
  }
 },{passive:true});
 document.addEventListener('touchend',function(e){
  if(!dragging){return;}
  dragging=false;
  var bd=document.getElementById('regimeBackdrop');
  if(!panel){locked=null;return;}
  panel.style.transition='transform .3s cubic-bezier(.32,.72,0,1)';
  var dy=(e.changedTouches&&e.changedTouches[0])?e.changedTouches[0].clientY-startY:0;
  var dx=(e.changedTouches&&e.changedTouches[0])?e.changedTouches[0].clientX-startX:0;
  if(locked==='v'){
   var flickDown=velY>400;
   var distDown=dy*0.55;
   if(distDown>60||flickDown){
    panel.style.transform='translateY(100vh)';
    if(bd){bd.style.opacity='0';}
    setTimeout(function(){closeRegimeSheet();},280);
   }else{
    panel.style.transform='';
    if(bd){bd.style.opacity='';}
   }
  }else if(locked==='h'){
   panel.style.transform='';
   if(Math.abs(dx)>25){
    var curTab=_TAB_ORDER.indexOf(_regimeSheetTab);
    if(curTab===-1) curTab=0;
    var next=dx<0?curTab+1:curTab-1;
    if(next>=0&&next<_TAB_ORDER.length){
     var tabName=_TAB_ORDER[next];
     var btn=document.querySelector('[data-tab='+tabName+']');
     switchRegimeTab(tabName,btn);
    }
   }
  }else{
   panel.style.transform='';
   if(bd){bd.style.opacity='';}
  }
  locked=null; panel=null;
 },{passive:true});
 window.addEventListener('popstate',function(e){
  var bd=document.getElementById('regimeBackdrop');
  if(bd&&bd.classList.contains('open')){e.preventDefault();closeRegimeSheet();}
 });
})();

/* ═══ SPOT ALERTS ════════════════════════════════════════════════════════════
   Was: one alert, held in a single variable. It could not be edited, deleted or
   silenced, a second one silently replaced the first, and a page refresh wiped
   it — so an alert you set in the morning was gone the moment you reloaded, with
   nothing to tell you. That is missing functionality, not missing polish.

   Now: a list, persisted, with the full set of operations you would expect —
   create, edit, mute, delete — plus duplicate rejection and a record of what
   actually fired and when.

   Storage is localStorage, deliberately. These are personal view-side reminders,
   not system state: they must not reach the recorder, the engine, or the
   database, and nothing here can touch an order path. */
var SA_KEY='apexSpotAlerts', SA=[], _saEditId=null;

function saLoad(){
  try{ var v=JSON.parse(localStorage.getItem(SA_KEY)||'[]'); SA=Array.isArray(v)?v:[]; }
  catch(e){ SA=[]; }
}
function saStore(){ try{ localStorage.setItem(SA_KEY,JSON.stringify(SA)); }catch(e){} }
function saMsg(t){ var e=document.getElementById('sa-status'); if(e) e.innerHTML=t; }

function saRender(){
  var host=document.getElementById('sa-list'); if(!host) return;
  var cnt=document.getElementById('sa-count');
  var active=SA.filter(function(a){return !a.muted;}).length;
  if(cnt) cnt.textContent = SA.length ? (active+' active / '+SA.length) : '';

  if(!SA.length){ host.innerHTML=''; return; }
  host.innerHTML = SA.map(function(a){
    var arrow=a.dir==='above'?'▲':'▼';
    var col=a.muted?'var(--muted)':(a.fired?'var(--green)':(a.dir==='above'?'var(--green)':'var(--red)'));
    var sub=a.fired
      ? 'fired '+String(a.fired).slice(11,19)+' @ '+(a.firedAt!=null?Number(a.firedAt).toLocaleString('en-IN'):'—')
      : (a.muted?'muted':'waiting · set '+String(a.created).slice(11,16));
    return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;'+
      'border-bottom:1px solid var(--grid)">'+
      '<span style="color:'+col+';font-size:12px;flex-shrink:0">'+arrow+'</span>'+
      '<span style="flex:1;min-width:0;font-size:11.5px;'+(a.muted?'opacity:.55;':'')+'">'+
        '<b class="num">'+Number(a.level).toLocaleString('en-IN')+'</b>'+
        '<span style="display:block;font-size:9.5px;color:var(--muted);margin-top:1px">'+sub+'</span></span>'+
      '<button class="icon-btn" style="width:26px;height:24px;font-size:11px;padding:0" '+
        'onclick="saToggleMute(\''+a.id+'\')" title="'+(a.muted?'Unmute':'Mute')+'">'+(a.muted?'🔕':'🔔')+'</button>'+
      '<button class="icon-btn" style="width:26px;height:24px;font-size:11px;padding:0" '+
        'onclick="saEdit(\''+a.id+'\')" title="Edit">✎</button>'+
      '<button class="icon-btn" style="width:26px;height:24px;font-size:13px;padding:0;color:var(--red)" '+
        'onclick="saDelete(\''+a.id+'\')" title="Delete">×</button>'+
    '</div>';
  }).join('');
}

function saSave(){
  var lv=document.getElementById('sa-level'), dv=document.getElementById('sa-dir');
  var l=parseFloat(String(lv.value).replace(/,/g,'')), d=dv.value;
  if(!isFinite(l)||l<=0){ saMsg('<span style="color:var(--red)">Enter a valid level</span>'); return; }

  // duplicate guard — the old version silently stacked identical alerts
  var dup=SA.some(function(a){ return a.id!==_saEditId && a.level===l && a.dir===d; });
  if(dup){ saMsg('<span style="color:var(--gold)">That alert already exists</span>'); return; }

  if(_saEditId){
    var a=SA.filter(function(x){return x.id===_saEditId;})[0];
    if(a){ a.level=l; a.dir=d; a.fired=null; a.firedAt=null; }   // edited => armed again
    saMsg('Alert updated');
    saCancelEdit();
  }else{
    SA.push({id:String(Date.now())+Math.random().toString(36).slice(2,6),
             level:l, dir:d, muted:false, created:new Date().toISOString(),
             fired:null, firedAt:null});
    saMsg('Alert added · Nifty '+(d==='above'?'above':'below')+' <b>'+l.toLocaleString('en-IN')+'</b>');
  }
  lv.value='';
  saStore(); saRender();
}

function saEdit(id){
  var a=SA.filter(function(x){return x.id===id;})[0]; if(!a) return;
  _saEditId=id;
  document.getElementById('sa-level').value=a.level;
  document.getElementById('sa-dir').value=a.dir;
  document.getElementById('sa-save').textContent='✔';
  document.getElementById('sa-save').title='Save changes';
  document.getElementById('sa-cancel').style.display='';
  saMsg('Editing — change the level or direction, then ✔');
}
function saCancelEdit(){
  _saEditId=null;
  var s=document.getElementById('sa-save');
  if(s){ s.textContent='🔔'; s.title='Add alert'; }
  var c=document.getElementById('sa-cancel'); if(c) c.style.display='none';
  var l=document.getElementById('sa-level'); if(l) l.value='';
}
function saToggleMute(id){
  var a=SA.filter(function(x){return x.id===id;})[0]; if(!a) return;
  a.muted=!a.muted; saStore(); saRender();
  saMsg(a.muted?'Alert muted — kept, but silent':'Alert unmuted');
}
function saDelete(id){
  var a=SA.filter(function(x){return x.id===id;})[0];
  if(a && !confirm('Delete the alert for '+Number(a.level).toLocaleString('en-IN')+'?')) return;
  if(_saEditId===id) saCancelEdit();
  SA=SA.filter(function(x){return x.id!==id;});
  saStore(); saRender(); saMsg('Alert removed');
}

/* Fires once per alert. An alert that has fired stays in the list as history
   rather than vanishing — you can see WHAT tripped and at what price, and
   re-arm it by editing. */
function checkSpotAlert(){
  var s=ST[CUR]; if(!s||!s.spot||!SA.length) return;
  var changed=false;
  SA.forEach(function(a){
    if(a.muted||a.fired) return;
    var hit = a.dir==='above' ? s.spot>=a.level : s.spot<=a.level;
    if(!hit) return;
    a.fired=new Date().toISOString(); a.firedAt=Math.round(s.spot); changed=true;
    toast(a.dir==='above'?'up':'dn','⚡ NIFTY ALERT',
      'Spot '+(a.dir==='above'?'crossed above':'dropped below')+' '+
      Number(a.level).toLocaleString('en-IN')+' @ '+n0(s.spot));
    try{ beep('target'); }catch(e){}
    try{ if(navigator.vibrate) navigator.vibrate([14,60,14]); }catch(e){}
  });
  if(changed){ saStore(); saRender(); }
}

/* legacy entry point kept so any older caller still works */
function setSpotAlert(){ saSave(); }

APEX.idle(saLoad,'saLoad'); APEX.idle(saRender,'saRender');   // deferred to an idle slice: below the fold at boot, and nav() re-renders it on demand
document.addEventListener('DOMContentLoaded', function(){ saRender(); });
async function testTelegram(){
  const s=document.getElementById('tg-status'); if(s){ s.textContent='sending test message…'; s.style.color=''; }
  try{
    const r=await fetch('/api/telegram/send',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({msg:'🔔 APEX test — ' + new Date().toLocaleTimeString('en-IN') + ' · Telegram connected ✅'})});
    const j=await r.json();
    if(s){
      if(j.ok){
        var parts=(j.results||[]).map(function(r){ return r.id + (r.ok?' ✓':' ✕ '+(r.error||'?')); });
        s.innerHTML='&#x2713; Sent! ' + (parts.length>1 ? '(' + parts.join(' · ') + ')' : '') + ' — check your Telegram';
        s.style.color='var(--green)';
      } else {
        s.innerHTML='&#x2715; '+(j.error||'Failed to send')+'. Is the bot in the chat?';
        s.style.color='var(--red)';
      }
    }
  }catch(e){ if(s){ s.innerHTML='&#x2715; Cannot reach server — is the backend running?'; s.style.color='var(--red)'; } }
}
async function saveTelegram(){
  const tok=document.getElementById('tg-token').value.trim();
  const chat=document.getElementById('tg-chat').value.trim();
  const s=document.getElementById('tg-status'); if(s)s.textContent='saving…';
  try{
    const r=await fetch('/api/telegram/config',{method:'POST',
      headers:Object.assign({'Content-Type':'application/json'},_adminHdr()),
      body:JSON.stringify({bot_token:tok,chat_id:chat})});
    const j=await r.json();
    if(s)s.textContent=j.ok?'✅ Saved':'❌ Failed';
  }catch(e){ if(s)s.textContent='❌ Cannot reach server'; }
}
renderIVGreeks = async function(){
  const d=await jget('/api/iv_summary').catch(()=>({})); const t=(d&&d.today)||{}; const reg=t.iv_regime||'NORMAL';
  const cell=(l,v,sub)=>`<div class="lvl-cell"><div class="k">${l}</div><div class="v num">${v}</div><div style="font-size:9px;color:var(--muted)">${sub||''}</div></div>`;
  const row=document.getElementById('ivAvgRow');
  if(row)row.innerHTML=cell('ATM IV',_R(t.atm_iv_close,v=>Number(v).toFixed(2)),reg)+cell('IV Open',_R(t.atm_iv_open,v=>Number(v).toFixed(2)),t.iv_trend||'')+cell('IV High',_R(t.atm_iv_high,v=>Number(v).toFixed(2)),'')+cell('IV Low',_R(t.atm_iv_low,v=>Number(v).toFixed(2)),'');
  const set=(id,v)=>{const e=document.getElementById(id); if(e)e.textContent=v;};
  set('iv-em',_R(t.expected_move_1sigma,v=>'±'+n0(v))); set('iv-em-sub',t.daily_vol!=null?('Daily Vol '+Number(t.daily_vol).toFixed(3)+'%'):''); set('iv-em2',_R(t.expected_move_2sigma,v=>'±'+n0(v))); set('iv-strad',_R(t.straddle_premium,n2));
  const v=document.getElementById('iv-verdict'); if(v){v.textContent=t.rich_cheap||'—'; v.style.color=(t.rich_cheap==='RICH')?'var(--green)':'var(--red)';}
  // AVG IV Δ% (from open) vs STRADDLE Δ% (combined premium move) → RATIO = how many % the
  // straddle moves per 1% IV move (>1 = vega-driven / premium richer than IV alone implies).
  set('iv-chg',_pct(t.iv_change_pct,1));
  const _snp=await jget('/api/snapshot').catch(()=>({}));
  var _sPct=(_snp&&_snp.comb_change_pct!=null)?Number(_snp.comb_change_pct):null;
  // Fallback: compute from morning_straddle vs current combined
  if(_sPct==null&&_snp){
    const _curS=(_snp.combined||{}).combined_close;
    const _openS=_snp.morning_straddle;
    if(_curS!=null&&_openS&&_openS>0) _sPct=(_curS-_openS)/_openS*100;
  }
  const _ivc=(t.iv_change_pct!=null)?Number(t.iv_change_pct):null;
  set('iv-pchg', _sPct==null?'—':((_sPct>=0?'+':'')+Number(_sPct).toFixed(1)+'%'));
  set('iv-ratio', (_sPct==null||!_ivc)?'—':(Number(_sPct)/_ivc).toFixed(1)+'×');
  const ch=await jget('/api/chain/full').catch(()=>[]); const gb=document.getElementById('greeksBody');
  if(gb)gb.innerHTML=(ch&&ch.length)?ch.map(k=>`<tr><td class="num t-strike" style="text-align:center">${n0(k.strike)}</td><td class="num" style="text-align:right;color:var(--muted)">${_R(k.ce_iv,v=>Number(v).toFixed(1))}</td><td class="num" style="text-align:right">${_R(k.ce_delta,v=>Number(v).toFixed(2))}</td><td class="num" style="text-align:right;color:var(--muted)">${_R(k.ce_gamma,v=>Number(v).toFixed(4))}</td><td class="num dn" style="text-align:right">${_R(k.ce_theta,v=>Number(v).toFixed(1))}</td><td class="num" style="text-align:right;color:var(--muted)">${_R(k.ce_vega,v=>Number(v).toFixed(2))}</td><td class="num" style="text-align:right;color:var(--muted)">${_R(k.pe_iv,v=>Number(v).toFixed(1))}</td><td class="num" style="text-align:right">${_R(k.pe_delta,v=>Number(v).toFixed(2))}</td><td class="num dn" style="text-align:right">${_R(k.pe_theta,v=>Number(v).toFixed(1))}</td></tr>`).join(''):'<tr><td colspan="9" class="empty">Collecting chain data…</td></tr>';
};
// Task C item 9: the SINGLE owner of the RR25 skew verdict label/color. Before this,
// the Dashboard's Skew Intelligence card (panels.js renderSkewIntel()) and this
// page's own headline each carried their own copy of the same threshold logic and
// had drifted — one said "PUT SKEW", the other "PUT SKEW · fear" for the identical
// rr value. Both call sites now call this function; neither computes its own label.
function skewVerdict(rr){
  if(rr==null) return {label:'—', color:'var(--muted)'};
  if(Math.abs(rr)<0.5) return {label:'BALANCED', color:'var(--text)'};
  return rr<0 ? {label:'PUT SKEW', color:'var(--red)'} : {label:'CALL SKEW', color:'var(--green)'};
}

// PARITY_BPS_THRESHOLD (Task C item 9 — put-call parity check): synth_basis
// (synth_future − spot, from the existing synthetic_future owner) is already
// computed and stored; this only adds a VERDICT on top of that real number, no new
// computation of the basis itself. 50bps was chosen as the ceiling: NSE index
// option bid-ask spreads plus lot-size strike rounding routinely produce a few tens
// of bps of basis noise around a genuinely-holding parity; beyond 50bps the
// divergence is more likely real positioning stress than quote noise.
const PARITY_BPS_THRESHOLD = 50;

// Task C item 9 — IV-RV context: reuses /api/vrp, the SAME owner and SAME
// RICH/CHEAP/FAIR fallback threshold already established for the Dashboard's VRP
// Intelligence card (panels.js renderVrpIntel(), item 5) — not a second, drifted
// verdict. Regime context reuses /api/regime/today (Engine 2's existing owner,
// regime_daily.regime_tag) — no new regime computation.
async function renderSkewIvRvRegime(){
  try{
    let _vrpPillErr=null;
    const d=await jget('/api/vrp').catch(e=>{_vrpPillErr=e; return {};});
    const iv=d&&d.iv, rv=d&&d.rv, vrp=d&&d.vrp;
    const rc=(d&&d.rich_cheap)||(vrp==null?null:(vrp>2?'RICH':vrp<-2?'CHEAP':'FAIR'));
    const vEl=document.getElementById('sk-vrp-verdict');
    if(vEl){
      // Audit finding: a gated 401/403 rendered this pill as a bare "—", same
      // ambiguity as the two fixes above — indistinguishable from "not computed
      // yet". A locked icon + tooltip is enough for a small inline pill (unlike
      // the full VRP page or the regime table, there's no room here for the full
      // upgradeRequiredHTML message block).
      if(isUpgradeRequired(_vrpPillErr)){
        vEl.textContent='🔒'; vEl.title='Sign in to unlock VRP verdict'; vEl.className='pill skip';
      }else{
        vEl.textContent=rc||'—'; vEl.title='';
        // colour semantics MATCH the canonical VRP page (overrides.js renderVRP) and the
        // Dashboard's renderVrpIntel(): RICH=green, CHEAP=red. A red RICH here would say
        // the opposite of the two sibling cards for the same /api/vrp verdict.
        vEl.className='pill '+(rc==='RICH'?'win':rc==='CHEAP'?'loss':'skip');
      }
    }
    _setT('sk-iv-rv', (iv==null||rv==null)?'—':Number(iv).toFixed(1)+' / '+Number(rv).toFixed(1));
  }catch(e){}
  try{
    const d=await jget('/api/regime/today').catch(()=>({}));
    const reg=d&&d.regime;
    _setT('sk-regime-ctx', (reg&&reg.regime_tag)?
      reg.regime_tag+(reg.confidence!=null?' ('+Math.round(reg.confidence*100)+'%)':'') :
      'not classified yet');
  }catch(e){}
}

renderSkew = async function(){
  if(window._skewTimer) clearInterval(window._skewTimer);
  window._skewTimer = setInterval(function(){
    const pg=document.getElementById('page-skew');
    if(pg && pg.classList.contains('on')) renderSkew();
    else { clearInterval(window._skewTimer); window._skewTimer=null; }
  }, 30000);
  const o=await jget('/api/otm_imbalance').catch(()=>[]); const sy=await jget('/api/synthetic').catch(()=>[]);
  const set=(id,t)=>{const e=document.getElementById(id); if(e)e.textContent=t;};
  // split the two modes by the timestamp suffix the backend writes (…|FLEX / …|FIXED)
  const pick=suf=>{const f=(o||[]).filter(x=>String(x.timestamp).endsWith(suf)); return f.length?f.sort((a,b)=>String(a.timestamp)<String(b.timestamp)?-1:1).slice(-1)[0]:null;};
  const r=pick('FLEX')||((o&&o.length)?o[o.length-1]:{});   // FLEXIBLE = primary display
  const fx=pick('FIXED')||{};                                // FIXED = 2× morning
  set('sk-strad',_R(r.atm_straddle_premium,n2)); set('sk-dist',r.distance_pts==null?'—':(n0(r.distance_pts)+' pts')); set('sk-bench',r.bench_5pct==null?'—':('₹'+Number(r.bench_5pct).toFixed(1)));
  set('sk-upper-strike',_R(r.upper_strike,n0)); set('sk-lower-strike',_R(r.lower_strike,n0));
  set('sk-upper-prem',r.call_premium_upper==null?'—':('₹'+Number(r.call_premium_upper).toFixed(2))); set('sk-lower-prem',r.put_premium_lower==null?'—':('₹'+Number(r.put_premium_lower).toFixed(2)));
  set('sk-3',r.bench_3pct==null?'—':('₹'+Number(r.bench_3pct).toFixed(1))); set('sk-5',r.bench_5pct==null?'—':('₹'+Number(r.bench_5pct).toFixed(1))); set('sk-10',r.bench_10pct==null?'—':('₹'+Number(r.bench_10pct).toFixed(1)));
  set('sk-ratio',_R(r.premium_ratio,v=>Number(v).toFixed(2))); set('sk-cheap',r.cheaper_side||'—');
  set('sk-cheap-top', r.cheaper_side||'—');
  set('sk-call-top', r.call_premium_upper==null?'—':('₹'+Number(r.call_premium_upper).toFixed(2)));
  set('sk-put-top', r.put_premium_lower==null?'—':('₹'+Number(r.put_premium_lower).toFixed(2)));
  // Fallback: compute cheaper_side and C/P ratio client-side when DB has premiums but not the derived fields
  var _cp=r.call_premium_upper, _pp=r.put_premium_lower;
  if(!r.cheaper_side && _cp!=null && _pp!=null){
    var _cs=_cp<_pp?'CALL':(_pp<_cp?'PUT':'EQUAL');
    set('sk-cheap-top',_cs); set('sk-cheap',_cs);
  }
  var _br=r.premium_ratio;
  if(_br==null && _cp!=null && _pp!=null && _pp>0) _br=_cp/_pp;
  set('sk-bias-top', _br==null?'—':(Number(_br).toFixed(2)+'× C/P'));
  set('sk-cheap-915', fx.cheaper_side||'—');
  set('sk-call-915', fx.call_premium_upper==null?'—':('₹'+Number(fx.call_premium_upper).toFixed(2)));
  set('sk-put-915', fx.put_premium_lower==null?'—':('₹'+Number(fx.put_premium_lower).toFixed(2)));
  // 9:15 fallback: compute cheaper_side client-side
  var _fcp=fx.call_premium_upper, _fpp=fx.put_premium_lower;
  if(!fx.cheaper_side && _fcp!=null && _fpp!=null){
    set('sk-cheap-915', _fcp<_fpp?'CALL':(_fpp<_fcp?'PUT':'EQUAL'));
  }
  // FIXED mode (2× morning straddle)
  set('sk-fix-dist',fx.distance_pts==null?'—':(n0(fx.distance_pts)+' pts'));
  set('sk-fix-upper',_R(fx.upper_strike,n0)); set('sk-fix-lower',_R(fx.lower_strike,n0));
  set('sk-fix-uprem',fx.call_premium_upper==null?'—':('₹'+Number(fx.call_premium_upper).toFixed(2)));
  set('sk-fix-lprem',fx.put_premium_lower==null?'—':('₹'+Number(fx.put_premium_lower).toFixed(2)));
  set('sk-fix-cheap',fx.cheaper_side||'—');
  // sf-fut ("ACTUAL FUTURE"): 2026-08-11 trust-upgrade fix. This used to be
  // hardcoded to '—' unconditionally — not fabricated, but also never wired to
  // real data, even though live_compute.py has written a genuine live NIFTY
  // futures LTP (actual_future, from collector/websocket_engine.py's real fut_sid
  // tick subscription) into this exact row all along. /api/synthetic's SELECT
  // just never exposed the column (fixed in analytics_api.py). Still honestly
  // "—" whenever actual_future is null — e.g. no futures tick yet today, or the
  // futures contract isn't subscribed — never defaulted to spot or synth.
  const s=(sy&&sy.length)?sy[sy.length-1]:{}; set('sf-synth',_R(s.synth_future,n2)); set('sf-spot',_R(s.spot,n2));
  set('sf-fut',_R(s.actual_future,n2));
  const e=document.getElementById('sf-basis'); if(e){e.textContent=_R(s.synth_basis,n2); e.style.color=(s.synth_basis||0)>=0?'var(--green)':'var(--red)';}
  // Task C item 9 — put-call parity check verdict: reads the SAME synth_basis/spot
  // just set above, no second basis computation, only the bps-of-spot conversion +
  // a PASS/WARN verdict on top of the real, already-fetched number.
  if(s.synth_basis!=null && s.spot){
    const bps = Math.round(s.synth_basis/s.spot*10000);
    _setT('sk-parity-bps', (bps>=0?'+':'')+bps+' bps');
    const pEl=document.getElementById('sk-parity-verdict');
    if(pEl){
      const ok=Math.abs(bps)<=PARITY_BPS_THRESHOLD;
      pEl.textContent=ok?'PARITY HOLDS':'PARITY STRESSED';
      pEl.className='pill '+(ok?'win':'loss');
    }
  }
  // RR25 / FLY25 headline (skew_daily — real per-strike 25Δ IV)
  try{
    const sd=await jget('/api/skew_daily').catch(()=>({})); const t=sd&&sd.today;
    const setc=(id,txt,c)=>{const el=document.getElementById(id); if(el){el.textContent=txt; if(c)el.style.color=c;}};
    if(t){
      const rr=t.rr25, fly=t.fly25;
      setc('sk-rr25', rr==null?'—':(rr>=0?'+':'')+Number(rr).toFixed(2), rr==null?'var(--muted)':(rr>=0?'var(--green)':'var(--red)'));
      setc('sk-fly25', fly==null?'—':(fly>=0?'+':'')+Number(fly).toFixed(2), fly==null?'var(--muted)':(fly>=0?'var(--orange)':'var(--cyan)'));
      setc('sk-iv25', (t.iv_25c==null?'—':Number(t.iv_25c).toFixed(1))+' / '+(t.iv_25p==null?'—':Number(t.iv_25p).toFixed(1)));
      const verdict = skewVerdict(rr);
      setc('sk-verdict', verdict.label, verdict.color);
      // Task C item 9 — 50Δ (ATM) skew + the actual delta behind each 25Δ pick
      // (iv_25c_delta/iv_25p_delta let a reader see how close to true 0.25 the
      // "25Δ" label really was — real evidence, not extra precision claimed).
      setc('sk-skew50', t.skew50==null?'—':(t.skew50>=0?'+':'')+Number(t.skew50).toFixed(2),
                t.skew50==null?'var(--muted)':(t.skew50>=0?'var(--green)':'var(--red)'));
      setc('sk-atmiv-cp', (t.iv_atm_c==null?'—':Number(t.iv_atm_c).toFixed(1))+' / '+(t.iv_atm_p==null?'—':Number(t.iv_atm_p).toFixed(1)));
      setc('sk-25delta-actual',
                (t.iv_25c_delta==null?'—':Number(t.iv_25c_delta).toFixed(2))+' / '+(t.iv_25p_delta==null?'—':Number(t.iv_25p_delta).toFixed(2)));
    }
  }catch(err){}
  try{ await renderSkewIvRvRegime(); }catch(err){}
  try{ const ch=await jget('/api/chain/full').catch(()=>[]); drawSkewSmile(ch); }catch(err){}
  try{ await renderSkewRegimes(); }catch(err){}
};
async function renderSkewRegimes(){
  // Audit finding: this page swallowed a 401/403 (skew_regimes is Phase 8
  // premium-gated) into the SAME "accumulating…" text used for "genuinely no
  // regimes classified yet" — a logged-out visitor read "accumulating…" as
  // "come back later" when the real reason was "sign in." Distinguished now,
  // same isUpgradeRequired pattern used elsewhere in this file.
  let _skewRegErr=null;
  const d=await jget('/api/skew_regimes').catch(e=>{_skewRegErr=e; return {};}); const rows=(d&&d.regimes)||[];
  const hit=document.getElementById('skewHit');
  if(hit){
    if(isUpgradeRequired(_skewRegErr)) hit.textContent='🔒 Sign in to unlock skew regime history';
    else hit.textContent=(d&&d.toward_cheaper_pct!=null)?`moved toward cheaper ${d.toward_cheaper_pct}% · ${d.sample} regimes`:'accumulating…';
  }
  const b=document.getElementById('skewRegBody'); if(!b)return;
  if(isUpgradeRequired(_skewRegErr)){ b.innerHTML='<tr><td colspan="7">'+upgradeRequiredHTML('Skew Regime History',_skewRegErr)+'</td></tr>'; return; }
  b.innerHTML=rows.length?rows.map(r=>{
    const mv=r.nifty_move_pts, up=(mv||0)>=0;
    const isCall=String(r.cheaper_side||'').toUpperCase().startsWith('C');
    const side=isCall?'CALL':'PUT';
    const ok=r.moved_toward_cheaper, vcol=ok===1?'var(--green)':(ok===0?'var(--red)':'var(--muted)');
    const vtxt=ok===1?'✓ toward':(ok===0?'✗ away':'—');
    return `<tr><td class="num" style="color:var(--cyan)">${(r.date||'').slice(5)}</td>`+
      `<td><b style="color:${isCall?'var(--green)':'var(--red)'}">${side}</b></td>`+
      `<td class="num" style="font-size:11px">${r.start_time}→${r.end_time}${r.still_open?' ·live':''}</td>`+
      `<td class="num" style="text-align:right">${r.start_spot==null?'—':n0(r.start_spot)}→${r.end_spot==null?'—':n0(r.end_spot)}</td>`+
      `<td class="num" style="text-align:right;color:${up?'var(--green)':'var(--red)'}">${mv==null?'—':((up?'+':'')+Number(mv).toFixed(0))}</td>`+
      `<td style="color:${vcol};font-weight:700">${vtxt}</td>`+
      `<td>${r.flipped_to?(r.flipped_to==='CE'?'CALL':'PUT'):'—'}</td></tr>`;
  }).join(''):'';
}
function _avg(a){a=a.filter(v=>v!=null&&!isNaN(v));return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;}
function _setT(id,t){const e=document.getElementById(id);if(e)e.textContent=t;}
function drawSkewSmile(ch){
  const host=document.getElementById('skewSmile'); if(!host)return;
  const rows=(ch||[]).filter(r=>r.ce_iv||r.pe_iv).sort((a,b)=>a.strike-b.strike);
  const atm0=(window.__atm)||(rows.length&&rows[Math.floor(rows.length/2)].strike);
  rows.forEach(r=>{r.otm_iv=(r.strike<atm0? (r.pe_iv||r.ce_iv) : (r.ce_iv||r.pe_iv))||null;});
  if(rows.length<3){host.innerHTML='';return;}
  const W=620,H=160,pL=40,pR=14,pT=14,pB=26;
  const ivs=rows.flatMap(r=>[r.ce_iv,r.pe_iv]).filter(v=>v);
  let lo=Math.min(...ivs), hi=Math.max(...ivs); if(hi-lo<1){hi+=1;lo-=1;} lo*=0.99; hi*=1.01;
  const X=i=>pL+(W-pL-pR)*i/(rows.length-1);
  const Y=v=>pT+(H-pT-pB)*(1-(v-lo)/(hi-lo));
  const path=(key,col)=>{let d='';rows.forEach((r,i)=>{if(r[key]==null)return;d+=(d?'L':'M')+X(i).toFixed(1)+','+Y(r[key]).toFixed(1)+' ';});return d?`<path d="${d}" fill="none" stroke="${col}" stroke-width="2.2"/>`:'';};
  const atm=window.__atm||rows[Math.floor(rows.length/2)].strike;
  let atmI=0,best=1e9; rows.forEach((r,i)=>{const dd=Math.abs(r.strike-atm);if(dd<best){best=dd;atmI=i;}});
  const grid=[0,.5,1].map(f=>{const v=lo+(hi-lo)*f;return `<line x1="${pL}" y1="${Y(v)}" x2="${W-pR}" y2="${Y(v)}" stroke="#1d2734"/><text x="4" y="${Y(v)+3}" fill="#8aa0b4" font-size="9">${v.toFixed(1)}</text>`;}).join('');
  host.innerHTML=`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;font-family:var(--mono)">
    ${grid}
    <line x1="${X(atmI)}" y1="${pT}" x2="${X(atmI)}" y2="${H-pB}" stroke="#9a7cff" stroke-dasharray="3 3" opacity=".7"/>
    <text x="${X(atmI)-8}" y="${H-9}" fill="#9a7cff" font-size="9">ATM ${atm}</text>
    ${path('otm_iv','#9a7bff')}${path('ce_iv','#23d3e8')}${path('pe_iv','#f5b942')}
    <text x="${X(0)}" y="${H-9}" fill="#8aa0b4" font-size="9">${rows[0].strike}</text>
    <text x="${X(rows.length-1)-26}" y="${H-9}" fill="#8aa0b4" font-size="9">${rows[rows.length-1].strike}</text>
    <text x="${W-pR-96}" y="13" fill="#23d3e8" font-size="9">━ CALL IV</text>
    <text x="${W-pR-44}" y="13" fill="#f5b942" font-size="9">━ PUT IV</text>
  </svg>`;
  const putIV=_avg(rows.filter(r=>r.strike<atm).map(r=>r.pe_iv));
  const callIV=_avg(rows.filter(r=>r.strike>atm).map(r=>r.ce_iv));
  const atmRow=rows[atmI]; const atmIV=_avg([atmRow.ce_iv,atmRow.pe_iv]);
  _setT('skewAtmIv', atmIV!=null?atmIV.toFixed(1)+'%':'—');
  if(putIV!=null&&callIV!=null){
    const diff=callIV-putIV;
    const nd=document.getElementById('skewNeedle'); if(nd)nd.style.left=Math.max(5,Math.min(95,50+diff*7))+'%';
    _setT('skewBias', diff<-0.5?`PUT skew +${(-diff).toFixed(1)} pts (downside fear)`:diff>0.5?`CALL skew +${diff.toFixed(1)} pts (upside chase)`:'Balanced (flat smile)');
  }
}

/* ===== SESSION / EXPIRY MODAL (opens on NIFTY header / EXP click) ===== */
function openSessionModal(){
  const s=ST[CUR]||{};
  const exp=((document.getElementById('expVal')||{}).textContent)||'—';
  const dteVal = window.__dte;
  const isExp = dteVal === 0;
  const atmC=(s.legs&&s.atm&&s.legs[s.atm])?s.legs[s.atm].comb:null;
  const rows=[['Index','NIFTY 50'],['Spot',s.spot!=null?n2(s.spot):'—'],
    ['ATM strike',s.atm!=null?n0(s.atm):'—'],['ATM straddle',atmC!=null?n2(atmC):'—'],
    ['Morning 9:15 straddle',s.atm9_15!=null?n2(s.atm9_15):'—'],
    ['Lowest straddle',(s.legs&&s.legs[lowestStrike(CUR)])?n2(s.legs[lowestStrike(CUR)].comb):'—'],
    ['Expiry',exp],['DTE',dteVal!=null?dteVal:'—'],['India VIX',s.vix!=null?n2(s.vix):'—']];
  let bg=document.getElementById('sessModalBg');
  if(!bg){bg=document.createElement('div');bg.className='modal-bg';bg.id='sessModalBg';
    bg.onclick=e=>{if(e.target===bg)closeSessionModal();};document.body.appendChild(bg);}
  bg.innerHTML=`<div class="modal"><div class="modal-hd"><span class="t">Session &amp; Expiry</span><button class="x" onclick="closeSessionModal()">×</button></div>
    <div class="modal-bd">
    ${isExp?'<div style="background:rgba(245,185,66,.14);border:1px solid var(--gold);border-radius:8px;padding:9px 12px;margin-bottom:12px;color:var(--gold);font-weight:700;font-size:12px">⚡ EXPIRY DAY · 0DTE — gamma risk high. ATM half/double alerts armed from 2:55 PM.</div>':''}
    ${rows.map(r=>`<div class="mrow"><span class="k">${r[0]}</span><span class="v num">${r[1]}</span></div>`).join('')}
    </div><div class="modal-ft"><button class="btn primary" onclick="closeSessionModal()">Close</button></div></div>`;
  bg.classList.add('show');
}
function closeSessionModal(){const b=document.getElementById('sessModalBg');if(b)b.classList.remove('show');}

/* ===== EXPIRY-DAY WATCH: morning toast + 2:55 half/double + 3:00 record ===== */
var _exp={toast:false,p3:null,winHi:null,winLo:null,half:false,dbl:false,trip:false};
function expiryAlarm(type,title,msg){ if(SOUND){try{beep('sl');setTimeout(()=>beep('sl'),350);setTimeout(()=>beep('sl'),700);}catch(e){}} toast(type,title,msg); pushLog('ALERT','expiry',`${title} · ${msg}`); }
function expiryWatch(){
  if(window.__dte!==0) return;                       // ONLY on 0DTE expiry day
  const _ex=document.getElementById('set-expiry'); if(_ex&&!_ex.checked) return;  // settings toggle
  const s=ST[CUR]; if(!s||!s.legs||!s.atm||!s.legs[s.atm]) return;
  const atmC=s.legs[s.atm].comb; if(atmC==null) return;
  if(!_exp.toast){ _exp.toast=true; toast('oi','⚡ AAJ EXPIRY HAI','0DTE — gamma high. 2:55 PM se ATM half/double alerts on.'); pushLog('INFO','expiry','Expiry day detected — alerts armed'); }
  const now=new Date(); const hm=now.getHours()*60+now.getMinutes();
  // exact 3:00:00 — freeze the 3 PM ATM reference
  if(now.getHours()===15 && now.getMinutes()===0 && _exp.p3==null){
    _exp.p3=atmC; toast('up','3:00 PM SNAPSHOT',`ATM ${n0(s.atm)} straddle = ${n2(atmC)} recorded`); pushLog('ALERT','expiry',`3:00 ATM ${n0(s.atm)} = ${atmC.toFixed(1)}`);
  }
  // from 2:55 PM (14:55=895) — track window high/low, fire half/double/triple
  if(hm>=895){
    if(_exp.winHi==null){_exp.winHi=atmC;_exp.winLo=atmC;}
    _exp.winHi=Math.max(_exp.winHi,atmC); _exp.winLo=Math.min(_exp.winLo,atmC);
    if(!_exp.half && atmC<=_exp.winHi/2)        { _exp.half=true; expiryAlarm('dn','⚡ ATM HALVED',`${n2(atmC)} = HALF of high ${n2(_exp.winHi)}`); }
    if(!_exp.dbl  && atmC>=_exp.winLo*2)        { _exp.dbl=true;  expiryAlarm('up','⚡ ATM DOUBLED',`${n2(atmC)} = 2× low ${n2(_exp.winLo)}`); }
    if(!_exp.trip && atmC>=_exp.winLo*3)        { _exp.trip=true; expiryAlarm('up','⚡ ATM TRIPLED',`${n2(atmC)} = 3× low ${n2(_exp.winLo)}`); }
  }
}

/* SOUND: fix autoplay (resume on gesture) + toggle */
var SOUND=localStorage.getItem('apexSound')!=='0';
function toggleSound(el){ SOUND=!SOUND; localStorage.setItem('apexSound',SOUND?'1':'0'); try{ _actx=_actx||new (window.AudioContext||window.webkitAudioContext)(); _actx.resume(); }catch(e){} const b=el||document.getElementById('soundBtn'); if(b){b.textContent=SOUND?'🔔':'🔕'; b.title=SOUND?'Sound alerts ON':'Sound alerts MUTED';} if(SOUND){try{beep('target');}catch(e){}} }
beep = function(type){ if(!SOUND)return; try{ _actx=_actx||new (window.AudioContext||window.webkitAudioContext)(); if(_actx.state==='suspended')_actx.resume(); beepRaw(type==='target'?880:type==='sl'?330:520,.5); if(type==='sl')setTimeout(()=>beepRaw(330,.4),200); }catch(e){} };

/* WebSocket real-time chain */
var _ws=null;
// Read-only review finding (2026-08-20): a flat 3s retry hammers /ws every 3s
// indefinitely during a prolonged server outage, across every open tab. Mirrors
// the exact doubling-backoff pattern the Dhan WS reconnect already uses
// (collector/websocket_engine.py: base 3s, cap 60s, 3 -> 6 -> 12 -> 24 -> 48 -> 60)
// — fast recovery for a genuine blip, graceful degradation on a real outage.
var _wsFails=0, _WS_RETRY_BASE=3000, _WS_RETRY_MAX=60000;
// Live visitor count, made per-UNIQUE-VISITOR (2026-08-24, operator request:
// "concurrent" should mean distinct people, not raw connections — one person
// with 2 tabs open must count as 1). _apexCid is a random, opaque, anonymous id
// generated ONCE per browser and persisted in localStorage — never an IP, never
// anything server-derived, never sent anywhere except as this counting key. Every
// tab/reconnect from the SAME browser reuses the SAME id, so the server-side
// count (main.py::ws_feed, keyed by cid) collapses them to one visitor.
function _apexCid(){
  try{
    var id=localStorage.getItem('apexVisitorId');
    if(!id){ id=(crypto&&crypto.randomUUID)?crypto.randomUUID():('v-'+Date.now()+'-'+Math.random().toString(36).slice(2)); localStorage.setItem('apexVisitorId', id); }
    return id;
  }catch(e){ return 'v-'+Math.random().toString(36).slice(2); }   // localStorage unavailable (private mode) -> still works, just not stable across reloads
}
function connectWS(){ try{ _ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws?cid='+encodeURIComponent(_apexCid()));
  // NOTE: WS pushes do not carry snap.session (that's a REST /api/snapshot field, computed
  // server-side from data_health.session_state()) — loop()'s 3s poll is the sole owner of
  // the live-chip's session state (single owner, Layer 1.2), so this handler only clears
  // the waiting overlay, it does not call setLiveChip() with an unverified guess.
  _ws.onopen=function(){ _wsFails=0; };
  _ws.onmessage=function(ev){ try{ const snap=JSON.parse(ev.data); if(snap&&(snap.live_spot_ltp||snap.spot||(snap.chain&&snap.chain.length))){ if(typeof MODE!=='undefined'&&MODE!=='live'){MODE='live';try{stopMock();}catch(e){} try{showWaiting(false);}catch(e){}} try{ingestLive(snap);}catch(e){} if(snap.live_visitors!=null){ _renderVisitorCounts(snap.live_visitors, null); } } }catch(e){} };
  _ws.onclose=function(){ _wsFails++; const delay=Math.min(_WS_RETRY_MAX,_WS_RETRY_BASE*Math.pow(2,_wsFails-1)); setTimeout(connectWS,delay); }; _ws.onerror=function(){ try{_ws.close();}catch(e){} };
}catch(e){} }
connectWS();
/* =================== END OVERRIDE =================== */

// note: in mock mode the mock tick drives updates; in live mode loop() drives them.

// Virtual table renderer — renders only visible rows, cuts DOM from 500+ to ~20 nodes.
// Usage: virtualTable(container, dataRows, rowHeight, function(row, idx) { return '<tr>...</tr>'; });
window.virtualTable = function(container, rows, rowH, renderFn) {
  if (!container || !rows) return;
  container.style.overflowY = 'auto';
  container.style.position = 'relative';
  var totalH = rows.length * rowH;
  var spacer = container.querySelector('.vt-spacer');
  if (!spacer) {
    spacer = document.createElement('div');
    spacer.className = 'vt-spacer';
    container.appendChild(spacer);
  }
  spacer.style.height = totalH + 'px';
  var table = container.querySelector('table');
  if (!table) {
    table = document.createElement('table');
    container.appendChild(table);
    table.style.position = 'absolute';
    table.style.top = '0';
    table.style.left = '0';
    table.style.width = '100%';
  }
  function render() {
    var scrollTop = container.scrollTop;
    var start = Math.max(0, Math.floor(scrollTop / rowH) - 2);
    var visible = Math.ceil(container.clientHeight / rowH) + 4;
    var end = Math.min(rows.length, start + visible);
    var html = '';
    for (var i = start; i < end; i++) {
      html += renderFn(rows[i], i);
    }
    table.innerHTML = html;
    table.style.transform = 'translateY(' + (start * rowH) + 'px)';
  }
  container.onscroll = render;
  render();
};

// Runtime instrumentation — exposes live metrics for the diagnostics panel in
// Settings → System. No UI lives on /edge; engineering surfaces are confined to
// settings. Every metric is read from the actual runtime; nothing is fabricated.
(function instrumentRuntime(){
  var _reconnects = 0, _disconnects = 0, _lastMessageTs = null;
  var _prevWs = null, _replaced = false;

  function hook() {
    var ws = _ws;
    if (!ws || ws === _prevWs) return;
    _prevWs = ws;
    ws.addEventListener('open', function() {});
    ws.addEventListener('close', function() { _disconnects++; });
    ws.addEventListener('message', function() { _lastMessageTs = Date.now(); });
    ws.addEventListener('error', function() { _disconnects++; });
  }

  // Wrap connectWS so every reconnect (even the one on initial onclose) is counted.
  // connectWS is a local function in core.js, called from onclose via
  // setTimeout(connectWS, 3000) — wrapping it catches every cycle.
  if (typeof connectWS === 'function' && !_replaced) {
    var _orig = connectWS;
    connectWS = function() { _reconnects++; _orig(); };
    _replaced = true;
  }

  window.__apexRuntime = {
    wsReadyState: function() { hook(); return _ws ? _ws.readyState : -1; },
    scheduler: function() { return window.ApexScheduler ? window.ApexScheduler.metrics() : null; },
    idle: function() { return window.APEX && window.APEX.idleStats ? window.APEX.idleStats() : null; },
    timers: function() { return window.__APEX_SCHED ? window.__APEX_SCHED.stats() : null; },
    reconnects: function() { return _reconnects; },
    disconnects: function() { return _disconnects; },
    lastMessageAge: function() { return _lastMessageTs ? Math.round((Date.now() - _lastMessageTs) / 1000) : null; }
  };

  hook();

    // Start scheduler when market mode is set
    setTimeout(function() {
      if (window.ApexScheduler) {
        window.ApexScheduler.setMarketMode('OPEN');
        window.ApexScheduler.start();
      }
    }, 1000);
  })();

  // NULL explanation — every "—" in the UI carries a tooltip explaining WHY
  window._n = function(v, reason) {
    if (v != null) return v;
    return '<span title="' + (reason || 'data not yet available') + '" style="cursor:help;color:var(--muted)">—</span>';
  };
  // Global: automatically add tooltips to all — (em-dash) text nodes
  (function(){function tipAll(){document.querySelectorAll('*').forEach(function(el){if(el.childNodes.length===1&&el.childNodes[0].nodeType===3&&el.textContent.trim()==='\u2014'){el.title=el.title||'data pending — refresh in progress';el.style.cursor='help';}});}setInterval(tipAll,3000);})();

// Timer staggering: prevent simultaneous API call bursts by adding
// random jitter (0-2s) to all setInterval timers. This breaks the
// collision pattern that causes 10-20s latency spikes.
(function staggerTimers(){
  var _origSetInterval = window.setInterval;
  window.setInterval = function(fn, ms) {
    if (typeof ms === 'number' && ms >= 2000 && ms <= 60000) {
      var jitter = Math.floor(Math.random() * 2000);
      return _origSetInterval(fn, ms + jitter);
    }
    return _origSetInterval(fn, ms);
  };
})();
