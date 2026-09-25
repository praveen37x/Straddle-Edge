/* jget lives in core.js and is loaded first, so this is satisfied in every normal
   load. The guard exists because routing this file's reads through jget (2026-08-02)
   created a cross-bundle dependency that did not exist before: if core.js ever fails,
   strip.js would throw ReferenceError instead of merely showing stale panels. Degrading
   to a plain fetch keeps the failure contained to the bundle that actually broke. */
if (typeof jget !== 'function') {
  window.jget = function (p) {
    return fetch(p, {cache: 'no-store'}).then(function (r) {
      if (!r.ok) { throw new Error(r.status); }
      return r.json();
    });
  };
}

async function apexStrip(){
  try{
    const el=(id)=>document.getElementById(id);
    const fmt=(n,d)=>n!=null?Number(n).toFixed(d||0):'—';
    const fmtK=(n)=>n!=null?Math.round(n).toLocaleString('en-IN'):'—';
    const pnlFmt=(n)=>{if(n==null)return'—';const v=Math.round(n);return(v>=0?'+':'')+v.toLocaleString('en-IN');};
    const [vw,sts]=await Promise.all([
      jget('/api/vwap').catch(()=>({})),
      jget('/api/strategies/today').catch(()=>[])]);
    // VWAP 15m
    if(vw.vwap_15!=null){el('st-vwap').textContent=fmt(vw.vwap_15,1);
      const diff=vw.spot_now!=null?vw.spot_now-vw.vwap_15:null;
      if(diff!=null){const cls=diff>=0?'g':'r';el('st-vwap').className='sv '+cls;}}
    // Strategy PnL (today) — API returns {date,strategies,count} wrapper
    const stratRows=(sts&&Array.isArray(sts.strategies))?sts.strategies:Array.isArray(sts)?sts:[];
    if(stratRows.length){const total=stratRows.reduce((a,r)=>a+(Number(r.net_pnl)||0),0);
      const e=el('st-spnl');e.textContent=pnlFmt(total);e.className='sv '+(total>=0?'g':'r');}
    // Tracker PnL — compute from LIVE in-memory myPositions, not from DB (pnl is NULL for OPEN)
    try{const openPos=(typeof myPositions!=='undefined')?myPositions.filter(p=>p.status==='OPEN'):[];
      if(openPos.length){const total=openPos.reduce((a,p)=>{const q=p.qty||2210;const cur=p.cur!=null?p.cur:p.entry;const isB=p.side==='B';return a+((isB?(cur-p.entry):(p.entry-cur))*q);},0);
        const e=el('st-tpnl');e.textContent=pnlFmt(total);e.className='sv '+(total>=0?'g':'r');}
    }catch(e){}
    // Show strip
    const strip=el('apexStrip');if(strip&&!strip.classList.contains('vis'))strip.classList.add('vis');
  }catch(e){}
}
apexStrip();setInterval(apexStrip,3000);
function __lowSafe(n){ try{ const k=lowestStrike(n); return (k&&isFinite(k))?k:null; }catch(e){ return null; } }
function megaToast(title, sub, kind){
  if(!title||!sub)return;  // don't show empty floater
  try{ beep(kind==='sl'?'sl':'target'); }catch(e){}
  let el=document.getElementById('megaToast');
  if(!el){ el=document.createElement('div'); el.id='megaToast';
    el.style.cssText='position:fixed;top:18%;left:50%;transform:translateX(-50%);z-index:99999;'+
    'padding:22px 38px;border-radius:18px;text-align:center;font-family:var(--disp,sans-serif);'+
    'box-shadow:0 20px 80px rgba(0,0,0,.8);backdrop-filter:blur(8px);min-width:320px';
    document.body.appendChild(el); }
  el.style.background = kind==='sl' ? 'linear-gradient(135deg,#3d0f14,#7a1622)' : 'linear-gradient(135deg,#0f3d1e,#16683a)';
  el.style.border = '2px solid ' + (kind==='sl' ? '#f85149' : '#3fb950');
  el.innerHTML = '<div style="font-size:24px;font-weight:900;color:#fff;letter-spacing:1px">'+title+
                 '</div><div style="font-size:15px;color:#e6edf3;margin-top:8px" class="num">'+sub+
                 '</div><div style="font-size:10px;color:#8b949e;margin-top:10px">click to dismiss</div>';
  el.style.display='block'; el.onclick=()=>el.style.display='none';
  clearTimeout(el._t); el._t=setTimeout(()=>el.style.display='none', 9000);
}
let STRAT_DETAIL=[];
renderPnl = async function(){
  let r={}; try{ r=await jget('/api/strategies/today'); }catch(e){}
  let d=(r&&r.strategies)||[];
  const b=document.getElementById('pnlBody'); if(!b)return;
  if(!d.length){ b.innerHTML=''; return; }
  // PROFIT PRIORITY: TRADED first, sorted highest P&L → lowest; CONDITIONS_NOT_MET last.
  d=d.slice().sort((a,b)=>{
    const at=a.status==='TRADED', bt=b.status==='TRADED';
    if(at!==bt) return at?-1:1;                 // traded strategies above CNM
    return (b.net_pnl||0)-(a.net_pnl||0);       // then max → min P&L (profit on top)
  });
  STRAT_DETAIL=d;
  const traded=d.filter(x=>x.status==='TRADED');
  const _tot=traded.reduce((s,x)=>s+(x.net_pnl||0),0);
  const _w=traded.filter(x=>(x.net_pnl||0)>0).length, _l=traded.filter(x=>(x.net_pnl||0)<0).length;
  const _cnm=d.length-traded.length;
  const _tt=document.getElementById('stratTot');
  if(_tt)_tt.innerHTML=`Total <b style="color:${_tot>=0?'var(--green)':'var(--red)'}">${_tot>=0?'+':''}₹${Math.round(_tot).toLocaleString('en-IN')}</b> · W/L <b>${_w}/${_l}</b> · ${_cnm} skipped · ${d.length} strategies · 1 lot=65`;
  b.innerHTML=d.map((x,i)=>{
    const cnm=x.status!=='TRADED';
    const pnl=Math.round(x.net_pnl||0); const pr=pnl>=0;
    const pnlCell=cnm
      ? `<td style="text-align:right;color:var(--muted);font-size:11px" title="${x.reason||''}">— ${(x.reason||'no trade').slice(0,28)}</td>`
      : `<td class="num" style="text-align:right;color:${pr?'var(--green)':'var(--red)'}">${pr?'+':''}₹${pnl.toLocaleString('en-IN')}</td>`;
    const stPill=cnm?'<span class="pill" style="opacity:.55">SKIP</span>'
                    :(pr?'<span class="pill win">PROFIT</span>':'<span class="pill loss">LOSS</span>');
    const et=x.entry_time?x.entry_time.slice(0,8):'—';
    const ext=x.exit_time?x.exit_time.slice(0,8):'—';
    return `<tr style="cursor:pointer${cnm?';opacity:.7':''}" onclick="openStratModal('${(x.scenario_id||'').replace(/'/g,"\\'")}','${(x.strategy||'').replace(/'/g,"\\'")}')" title="Tap for rules + trade detail">`+
      `<td>${i+1}</td><td><b style="color:var(--cyan)">${x.scenario_id||''}</b> ${x.strategy}`+
      `<div style="font-size:9px;color:var(--muted)">${x.group_tag||''} · ${x.maturity||''} · ${x.side||''}</div></td>`+
      `<td class="num" style="font-size:10px;text-align:right">${et}</td>`+
      `<td class="num" style="font-size:10px;text-align:right">${ext}</td>`+
      pnlCell+`<td>${stPill}</td>`+
      `<td class="num" style="text-align:right">${x.win_rate!=null?x.win_rate+'%':'—'}</td></tr>`;
  }).join('');
};
let __stratPoll=null;
function _stratTab(k){
  ['intraday','past','rules'].forEach(t=>{
    const el=document.getElementById('ztab-'+t); if(el)el.style.display=(t===k?'block':'none');
    const b=document.getElementById('zbtn-'+t); if(b)b.classList.toggle('on',t===k);
  });
  if(k==='past')_loadPast();
}
async function _loadPast(){
  const x=window.__stratX, host=document.getElementById('ztab-past'); if(!x||!host)return;
  if(host.dataset.loaded)return; host.dataset.loaded='1';
  let d={}; try{ d=await (await fetch('/api/strategies/'+encodeURIComponent(x.scenario_id))).json(); }catch(_){}
  const c=d.cumulative||{}, h=d.history||[];
  const low=(c.sample_days!=null&&c.sample_days<30);
  const kv=(k,v,col)=>`<div class="zkv"><div class="zlbl">${k}</div><div class="zval" style="color:${col||'var(--text)'}">${v==null?'—':v}</div></div>`;
  host.innerHTML=`<div class="zsect">Cumulative ${low?'· <span style="color:var(--gold)">LOW CONFIDENCE (N&lt;30)</span>':'· '+(c.sample_days||0)+' days'}</div>`+
    `<div class="zgrid">${kv('Win rate',c.win_rate!=null?c.win_rate+'%':'—')+kv('Expectancy',c.expectancy!=null?'₹'+Math.round(c.expectancy):'—')+kv('Profit factor',c.profit_factor)+kv('Sharpe',c.sharpe)+kv('Sortino',c.sortino)+kv('Max DD',c.max_drawdown!=null?'₹'+Math.round(c.max_drawdown):'—','var(--red)')+kv('CVaR 95',c.cvar_95!=null?'₹'+Math.round(c.cvar_95):'—','var(--red)')+kv('Trades',c.trades)}</div>`+
    `<div class="zsect">Daily history</div><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th class="zth">DATE</th><th class="zth">STATUS</th><th class="zth" style="text-align:right">NET ₹</th><th class="zth">EXIT</th></tr></thead><tbody>`+
    (h.map(r=>`<tr><td class="ztd">${r.date}</td><td class="ztd">${r.status==='TRADED'?'<span style="color:var(--green)">TRADED</span>':'<span style="color:var(--muted)">SKIP</span>'}</td><td class="ztd num" style="text-align:right;color:${(r.net_pnl||0)>=0?'var(--green)':'var(--red)'}">${r.net_pnl!=null?((r.net_pnl>=0?'+':'')+'₹'+Math.round(r.net_pnl)):'—'}</td><td class="ztd">${r.exit_reason||'—'}</td></tr>`).join('')||'<tr><td colspan="4" class="ztd" style="color:var(--muted)">no history yet</td></tr>')+
    `</tbody></table></div>`;
}
async function fillLegAudit(x){
  const box=document.getElementById('legAuditBox'); if(!box)return;
  let d={}; try{ d=await (await fetch('/api/strategies/'+encodeURIComponent(x.scenario_id))).json(); }catch(_){}
  const leg=(d.legs&&d.legs[x.date])||{};
  const h=(d.history||[]).find(r=>r.date===x.date)||{};
  const n2=v=>v==null?'—':Number(v).toFixed(2);
  const pick=(a,b)=>a!=null?a:b;
  const ceFired = leg.ce_sl_triggered? leg.ce_sl_time : (x.exit_time||h.exit_time);
  const peFired = leg.pe_sl_triggered? leg.pe_sl_time : (x.exit_time||h.exit_time);
  const entT=(pick(x.entry_time,h.entry_time)||'').slice(0,8)||'—';
  const row=(nm,strike,entT,entry,slp,fired,exit,pnl,trig)=>`<tr>`+
    `<td class="ztd" style="font-weight:700;color:${nm==='CE'?'var(--green)':'var(--red)'}">${nm}</td>`+
    `<td class="ztd num">${strike==null?'—':n0(strike)}</td>`+
    `<td class="ztd num" style="text-align:right;font-size:10px">${entT||'—'}</td>`+
    `<td class="ztd num" style="text-align:right">${n2(entry)}</td>`+
    `<td class="ztd num" style="text-align:right;color:var(--red)">${n2(slp)}</td>`+
    `<td class="ztd num" style="text-align:right;font-size:10px">${(fired||'—')}${trig?' <span style="color:var(--red);font-weight:700">SL</span>':''}</td>`+
    `<td class="ztd num" style="text-align:right">${n2(exit)}</td>`+
    `<td class="ztd num" style="text-align:right;color:${(pnl||0)>=0?'var(--green)':'var(--red)'}">${pnl==null?'—':((pnl>=0?'+':'')+n0(pnl))}</td></tr>`;
  box.innerHTML=`<table style="width:100%;border-collapse:collapse"><thead><tr>`+
    `<th class="zth">LEG</th><th class="zth">STRIKE</th><th class="zth" style="text-align:right">ENTRY TIME</th><th class="zth" style="text-align:right">ENTRY ₹</th>`+
    `<th class="zth" style="text-align:right">SL PLACED</th><th class="zth" style="text-align:right">EXIT TIME</th>`+
    `<th class="zth" style="text-align:right">EXIT ₹</th><th class="zth" style="text-align:right">P&amp;L</th></tr></thead><tbody>`+
    row('CE',pick(x.entry_ce_strike,pick(h.entry_ce_strike,leg.entry_ce_strike)),entT,pick(x.entry_ce,h.entry_ce),leg.ce_sl_price,(ceFired||'').slice(0,8),pick(x.exit_ce,h.exit_ce),pick(x.ce_pnl,h.ce_pnl),leg.ce_sl_triggered)+
    row('PE',pick(x.entry_pe_strike,pick(h.entry_pe_strike,leg.entry_pe_strike)),entT,pick(x.entry_pe,h.entry_pe),leg.pe_sl_price,(peFired||'').slice(0,8),pick(x.exit_pe,h.exit_pe),pick(x.pe_pnl,h.pe_pnl),leg.pe_sl_triggered)+
    `</tbody></table>`;
}
function openStratModal(sid,stratName){
  const x=STRAT_DETAIL.find(r=>r.scenario_id===sid&&r.strategy===stratName)||STRAT_DETAIL.find(r=>r.scenario_id===sid)||null;
  if(!x)return; window.__stratX=x;
  const f2=v=>v==null?'—':Number(v).toFixed(2), f1=v=>v==null?'—':Number(v).toFixed(1);
  const cnm=x.status!=='TRADED';
  const pnl=Math.round(x.net_pnl||0), pr=pnl>=0;
  const rsn=x.exit_reason||'—', rc=rsn==='SL'?'var(--red)':(rsn==='TARGET'?'var(--green)':'var(--cyan)');
  const dot=c=>`<span style="width:11px;height:11px;border-radius:50%;background:${c};display:inline-block;box-shadow:0 0 0 3px ${c}33"></span>`;
  const kv=(k,v,c)=>`<div class="zkv"><div class="zlbl">${k}</div><div class="zval" style="color:${c||'var(--text)'};font-size:13px">${v}</div></div>`;
  const kvSm=(k,v,c)=>`<div style="display:flex;justify-content:space-between;font-size:11.5px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04)"><span style="color:var(--muted)">${k}</span><span style="font-weight:600;color:${c||'var(--text)'}">${v}</span></div>`;
  document.getElementById('stratModalName').textContent=`${x.scenario_id||''} · ${x.strategy}`;
  document.getElementById('stratModalPnl').textContent='';

  // ── HERO: P&L / Status ──
  const hero = cnm
   ? `<div class="zhero" style="background:linear-gradient(135deg,#3a2f10,var(--surface2))"><div><div class="zlbl">Status</div><div style="font-weight:800;font-size:20px;color:var(--gold)">CONDITIONS NOT MET</div><div style="font-size:12px;color:var(--text2);margin-top:3px">${x.reason||''}</div></div></div>`
   : `<div class="zhero" style="background:linear-gradient(135deg,${pr?'rgba(43,182,115,.16)':'rgba(229,72,77,.16)'},var(--surface2))"><div><div class="zlbl">Net P&L · 1 lot (65)</div><div id="zpnl" class="num" style="font-family:var(--disp);font-weight:800;font-size:34px;color:${pr?'var(--green)':'var(--red)'}">${pr?'+':''}₹${pnl.toLocaleString('en-IN')}</div></div><div style="margin-left:auto;text-align:right"><span class="pill ${pr?'win':'loss'}">${pr?'PROFIT':'LOSS'}</span></div></div>`;

  if(cnm){
    document.getElementById('stratModalBody').innerHTML=
      `<style>.ztabs{display:flex;gap:6px;margin-bottom:14px;border-bottom:1px solid var(--border)}.ztab{background:none;border:none;color:var(--muted);font-weight:700;font-size:12px;padding:8px 12px;cursor:pointer;border-bottom:2px solid transparent}.ztab.on{color:var(--text);border-bottom-color:var(--accent)}.zhero{display:flex;align-items:center;gap:14px;border:1px solid var(--border2);border-radius:16px;padding:18px}.zsect{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--accent);font-weight:800;margin:16px 0 10px}.zgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.zkv{background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:11px 13px}.zlbl{font-size:9px;letter-spacing:.6px;text-transform:uppercase;color:var(--muted)}.zval{font-weight:700;font-size:14px;margin-top:3px}.znote{margin-top:10px;font-size:12px;color:var(--text2);background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:11px 13px;line-height:1.55}</style>`+
      `<div class="ztabs"><button class="ztab on" id="zbtn-intraday" onclick="_stratTab('intraday')">Intraday</button><button class="ztab" id="zbtn-rules" onclick="_stratTab('rules')">Rules &amp; Logic</button></div>`+
      `<div id="ztab-intraday">${hero}<div class="zgrid" style="margin-top:14px">${kv('Structure',x.structure||'—')+kv('Side',x.side||'—')+kv('Entry time',x.entry_time||'—')+kv('Spot @ entry',x.entry_spot!=null?n0(x.entry_spot):'—')}</div></div>`+
      `<div id="ztab-rules" style="display:none">${_buildRulesTab(x)}</div>`;
    const m=document.getElementById('stratModalBg'); m.classList.add('show'); m.style.display='flex';
    return;
  }

  // ── TRADE DATA (OHOL-style) ──
  const entry=x.entry_combined, exit=x.exit_combined;
  const mfe=x.mfe, mae=x.mae;
  const entrySpot=x.entry_spot, entryAtm=x.entry_atm;
  // Lowest reached = entry - MAE (MAE is adverse move for short straddle = entry went UP = loss)
  const lowestReached=entry!=null&&mae!=null?entry+mae:null;  // MAE is already the adverse value
  const highestReached=entry!=null&&mfe!=null?entry-mfe:null; // MFE is the favorable move
  // % from open and entry
  const lowFromOpen=lowestReached!=null&&entry!=null?((lowestReached-entry)/entry*100):null;
  // Target calc: SL = entry + abs(mae) threshold, Target = entry - entry*0.30 (30% target)
  const slPrice=x.exit_reason==='SL'?exit:null;  // if SL hit, exit is the SL level
  const targetPrice=entry!=null?entry*0.70:null; // 30% target = 70% of entry
  const fromTarget=targetPrice!=null&&exit!=null?Math.abs(exit-targetPrice):null;
  const rrRatio=(slPrice!=null&&targetPrice!=null&&entry!=null)?Math.abs(entry-targetPrice)/Math.abs(slPrice-entry):null;

  // ── OPENING CANDLE (9:15) ──
  const openPrice=entry; // entry IS the 9:15 combined
  const sessionHigh=entry!=null&&mfe!=null?entry-mfe:null; // MFE favorable
  const sessionLow=entry!=null&&mae!=null?entry+mae:null;  // MAE adverse
  const openIsHigh=openPrice!=null&&sessionHigh!=null&&Math.abs(openPrice-sessionHigh)<0.01;

  // ── EXCURSION ANALYTICS ──
  const mfePct=mfe!=null&&entry!=null?(mfe/entry*100):null;
  const maePct=mae!=null&&entry!=null?(mae/entry*100):null;
  const missedTarget=fromTarget;

  // ── META ──
  const capEntry=entry!=null?Math.round(entry*65):null; // 1 lot = 65 qty
  const paperPnl=pnl;

  // ── VISUAL: Entry → SL / Target bar ──
  const barMin=entry!=null&&mae!=null?Math.min(entry,entry+mae,entry-mfe||entry)-5:0;
  const barMax=entry!=null&&mfe!=null?Math.max(entry,entry+mae||entry,entry-mfe)+5:100;
  const barRange=barMax-barMin||1;
  const barPos=(v)=>Math.max(0,Math.min(100,((v-barMin)/barRange)*100));
  const visualBar=entry!=null?`<div style="position:relative;height:32px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;margin:8px 0">
    <div style="position:absolute;left:${barPos(entry)}%;top:0;bottom:0;width:2px;background:var(--cyan)" title="Entry ₹${f2(entry)}"></div>
    <div style="position:absolute;left:${barPos(entry)}%;top:-2px;font-size:8px;color:var(--cyan);transform:translateX(-50%)">E ₹${f2(entry)}</div>
    ${mfe!=null?`<div style="position:absolute;left:${barPos(entry-mfe)}%;top:0;bottom:0;width:2px;background:var(--green);opacity:.6" title="MFE ₹${f2(entry-mfe)}"></div>
    <div style="position:absolute;left:${barPos(entry-mfe)}%;bottom:-2px;font-size:8px;color:var(--green);transform:translateX(-50%)">T ₹${f2(entry-mfe)}</div>`:''}
    ${mae!=null?`<div style="position:absolute;left:${barPos(entry+mae)}%;top:0;bottom:0;width:2px;background:var(--red);opacity:.6" title="MAE ₹${f2(entry+mae)}"></div>
    <div style="position:absolute;left:${barPos(entry+mae)}%;bottom:-2px;font-size:8px;color:var(--red);transform:translateX(-50%)">SL ₹${f2(entry+mae)}</div>`:''}
    ${exit!=null?`<div style="position:absolute;left:${barPos(exit)}%;top:4px;width:8px;height:8px;border-radius:50%;background:${rc};transform:translateX(-50%)" title="Exit ₹${f2(exit)}"></div>`:''}
  </div>`:'';

  // ── INTRADAY TAB ──
  const intraday = hero +
    // Trade Levels card
    `<div class="zsect">Trade Levels</div><div class="zgrid">
      ${kv('Entry',f2(entry),'var(--cyan)')}
      ${kv('Stop Loss',slPrice!=null?f2(slPrice):x.sl_rule||'—','var(--red)')}
      ${kv('Target (+30%)',targetPrice!=null?f2(targetPrice):'—','var(--green)')}
      ${kv('R:R · Potential',rrRatio!=null?'1:'+rrRatio.toFixed(1)+' · 30.0%':'—','var(--gold)')}
    </div>`+
    visualBar+
    // Opening Candle card
    `<div class="zsect">Opening Candle (9:15)</div><div class="zgrid">
      ${kv('Open',f2(openPrice),'var(--cyan)')}
      ${kv('Session High',sessionHigh!=null?f2(sessionHigh):'—','var(--green)')}
      ${kv('Session Low',sessionLow!=null?f2(sessionLow):'—','var(--red)')}
      ${kv('Open = High?',openIsHigh?'<b style="color:var(--green)">YES ✓</b>':'<span style="color:var(--muted)">No</span>')}
    </div>`+
    // Excursion Analytics card
    `<div class="zsect">Excursion Analytics</div><div class="zgrid">
      ${kv('Max Favourable',mfe!=null?f2(mfe)+' <span style="font-size:10px;color:var(--green)">'+(mfePct!=null?f1(mfePct)+'%':'')+'</span>':'—','var(--green)')}
      ${kv('Max Adverse',mae!=null?f2(mae)+' <span style="font-size:10px;color:var(--red)">'+(maePct!=null?f1(maePct)+'%':'')+'</span>':'—','var(--red)')}
      ${kv('Missed Target by',missedTarget!=null?f2(missedTarget)+' away':'—')}
      ${kv('Reentries',x.reentry_count!=null?x.reentry_count:'0')}
    </div>`+
    // Context card
    `<div class="zsect">Context</div><div class="zgrid">
      ${kv('VIX @ entry',x.vix_at_entry!=null?f2(x.vix_at_entry):'—')}
      ${kv('ATM IV',x.atm_iv_at_entry!=null?f1(x.atm_iv_at_entry)+'%':'—')}
      ${kv('VRP',x.vrp_at_entry!=null?f2(x.vrp_at_entry):'—')}
      ${kv('DTE · Phase',x.dte!=null?x.dte+'d':'—')}
    </div>`+
    // Meta card
    `<div class="zsect">Meta</div><div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:11px 13px">
      ${kvSm('Paper P&L','₹'+pnl.toLocaleString('en-IN'),pr?'var(--green)':'var(--red)')}
      ${kvSm('Capital (entry × lot)',capEntry!=null?'₹'+capEntry.toLocaleString('en-IN'):'—')}
      ${kvSm('Side',x.side||'—')}
      ${kvSm('Detected',x.entry_time||'—')}
      ${kvSm('Confirmed',x.exit_time&&rsn==='TARGET'?'Yes':'—')}
      ${kvSm('Day',x.day_of_week||'—')}
      ${kvSm('Regime',x.regime_tag||'—')}
      ${kvSm('Maturity',x.maturity||'—')}
    </div>`+
    // Trade timeline
    `<div class="zsect">Tick Path (intraday)</div><div class="ztl">`+
      `<div class="ztlrow"><div class="ztldot">${dot('var(--cyan)')}<div class="ztlline"></div></div><div><div class="ztlh">DETECTED · ${x.side||''}</div><div class="ztls">${x.entry_time||'—'} · open ₹${f2(entry)}${entrySpot!=null?' · Spot '+n0(entrySpot):''}</div></div></div>`+
      `<div class="ztlrow"><div class="ztldot">${dot('var(--green)')}<div class="ztlline"></div></div><div><div class="ztlh">MAX FAVOURABLE</div><div class="ztls">low ₹${f2(sessionLow)} <span style="color:var(--green)">${mfePct!=null?f1(mfePct)+'% open':''}</span></div></div></div>`+
      `<div class="ztlrow"><div class="ztldot">${dot('var(--red)')}<div class="ztlline"></div></div><div><div class="ztlh">MAX ADVERSE</div><div class="ztls">₹${f2(sessionHigh)}</div></div></div>`+
      `<div class="ztlrow"><div class="ztldot">${dot(rc)}</div><div><div class="ztlh">EXIT · ${rsn}</div><div class="ztls">${x.exit_time||'—'} · <b>₹${f2(exit)}</b></div></div></div></div>`+
    // Leg PnL
    (x.ce_pnl!=null||x.pe_pnl!=null?`<div style="font-size:10px;color:var(--text2);margin-top:8px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 12px">CE PnL ${x.ce_pnl!=null?((x.ce_pnl>=0?'+':'')+n0(x.ce_pnl)):'—'} · PE PnL ${x.pe_pnl!=null?((x.pe_pnl>=0?'+':'')+n0(x.pe_pnl)):'—'} · Gross ₹${x.pnl_gross!=null?n0(x.pnl_gross):'—'}</div>`:'')+
    // Per-leg audit
    `<div class="zsect">Per-leg Audit</div><div id="legAuditBox" style="overflow-x:auto"><div style="color:var(--muted);font-size:11px">loading legs…</div></div>`;

  // ── RULES TAB ──
  const rules = _buildRulesTab(x);

  document.getElementById('stratModalBody').innerHTML=
    `<style>.ztabs{display:flex;gap:6px;margin-bottom:14px;border-bottom:1px solid var(--border)}`+
    `.ztab{background:none;border:none;color:var(--muted);font-weight:700;font-size:12px;padding:8px 12px;cursor:pointer;border-bottom:2px solid transparent}`+
    `.ztab.on{color:var(--text);border-bottom-color:var(--accent)}`+
    `.zhero{display:flex;align-items:center;gap:14px;border:1px solid var(--border2);border-radius:16px;padding:18px}`+
    `.zsect{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--accent);font-weight:800;margin:16px 0 10px}`+
    `.zgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}`+
    `.zkv{background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:11px 13px}`+
    `.zlbl{font-size:9px;letter-spacing:.6px;text-transform:uppercase;color:var(--muted)}`+
    `.zval{font-weight:700;font-size:14px;margin-top:3px}`+
    `.znote{margin-top:10px;font-size:12px;color:var(--text2);background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:11px 13px;line-height:1.55}`+
    `.ztl .ztlrow{display:flex;gap:12px;align-items:flex-start}.ztldot{display:flex;flex-direction:column;align-items:center}.ztlline{width:2px;flex:1;min-height:30px;background:var(--border)}`+
    `.ztlh{font-weight:700;font-size:13px}.ztls{font-size:12px;color:var(--text2)}.zth{font-size:11px;color:var(--muted);text-align:left;padding:4px}.ztd{font-size:12px;padding:4px}</style>`+
    `<div class="ztabs"><button class="ztab on" id="zbtn-intraday" onclick="_stratTab('intraday')">Intraday</button><button class="ztab" id="zbtn-past" onclick="_stratTab('past')">Past</button><button class="ztab" id="zbtn-rules" onclick="_stratTab('rules')">Rules &amp; Logic</button></div>`+
    `<div id="ztab-intraday">${intraday}</div><div id="ztab-past" style="display:none"></div><div id="ztab-rules" style="display:none">${rules}</div>`;
  const m=document.getElementById('stratModalBg'); m.classList.add('show'); m.style.display='flex';
  if(!cnm)fillLegAudit(x);
  if(__stratPoll)clearInterval(__stratPoll);
  if(!cnm)__stratPoll=setInterval(async()=>{
    try{ const r=await jget('/api/strategies/today');
      const row=(r.strategies||[]).find(s=>s.scenario_id===x.scenario_id&&s.strategy===x.strategy);
      const el=document.getElementById('zpnl');
      if(row&&el){ const np=Math.round(row.net_pnl||0), nu=(np>=0?'+':'')+'₹'+np.toLocaleString('en-IN');
        if(nu!==el.textContent){ el.textContent=nu; el.style.color=np>=0?'var(--green)':'var(--red)';
          el.style.opacity='.4'; setTimeout(()=>{el.style.transition='opacity .45s';el.style.opacity='1';},40);} }
    }catch(_){}
  },5000);
}
function _buildRulesTab(x){
  const kv=(k,v,c)=>`<div class="zkv"><div class="zlbl">${k}</div><div class="zval" style="color:${c||'var(--text)'};font-size:13px">${v}</div></div>`;
  return `<div class="zgrid">${kv('Structure',x.structure||'—')+kv('Side',x.side||'—')+kv('Entry',x.entry_rule||'—')+kv('Exit',x.exit_rule||'—')+kv('Stop-loss',x.sl_rule||'—','var(--red)')+kv('Target',x.target_rule||'none','var(--green)')}</div>`+
    (x.logic?`<div class="znote">${x.logic}</div>`:'')+
    (x.activation?`<div class="znote" style="border-left:3px solid var(--gold)">Gate (must be true to trade): ${JSON.stringify(x.activation)}</div>`:'<div class="znote">No gate — runs every day.</div>');
}
function closeStratModal(){const m=document.getElementById('stratModalBg');if(m){m.classList.remove('show');m.style.display='';}if(typeof __stratPoll!=='undefined'&&__stratPoll){clearInterval(__stratPoll);__stratPoll=null;}}
// universal ESC → close ANY open modal (strat modal had no ESC/backdrop = felt stuck)
// FIX (2026-08-09): this used to blindly hide every .modal-bg via style.display='' —
// fine for modals whose own close button does the same, but #pnlModalBg
// (dashboard/app/core.js's openPnlModal(), Spec B item #57) BORROWS the live
// #posDashboard node from the Tracker page and must move it back on close via
// closePnlModal(). A bare hide left it trapped inside an orphaned, invisible
// #pnlModalBg forever — the Tracker page's inline dashboard was gone until reload,
// and window._pnlModalHome stayed stale. ESC must go through the SAME close path
// the × button and backdrop-click already use, not a second, incomplete one.
// #ixDetailModalBg (Task C item 6) added to the same special-case list before it
// ever shipped without one: openIndexDetail() insertAdjacentHTML's a FRESH node on
// every open rather than reusing a static one, so a generic hide-only ESC would
// leave it attached to the DOM forever — the next open's getElementById('ixDetail
// ModalBg') would find the stale hidden one instead of the new one. closeIxDetail
// Modal() actually .remove()s the node, so ESC must call it, not the generic loop.
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'||e.keyCode===27){
    if(document.getElementById('pnlModalBg') && typeof closePnlModal==='function'){ closePnlModal(); }
    if(document.getElementById('ixDetailModalBg') && typeof closeIxDetailModal==='function'){ closeIxDetailModal(); }
    document.querySelectorAll('.modal-bg').forEach(m=>{m.classList.remove('show');m.style.display='';});
  }
});
async function sendEodTelegram(btn){
  const orig = btn ? btn.textContent : '';
  if(btn){ btn.disabled=true; btn.textContent='Sending…'; }
  let j={};
  try{
    const r=await fetch('/api/telegram/eod',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    j=await r.json();
  }catch(e){ j={ok:false,error:'network'}; }
  if(btn){
    btn.textContent = j.ok ? ('✓ Sent '+(j.date||'')) : '✗ Failed';
    btn.style.color = j.ok ? 'var(--green)' : 'var(--red)';
    setTimeout(()=>{ btn.disabled=false; btn.textContent=orig; btn.style.color='var(--cyan)'; }, 5000);
  }
}
let _stratView = 'cards';
function setStratView(v){ _stratView = v; renderStrategyLab(); }
function _stratListRow(m){
  const pnl=m.net_pnl,pcol=pnl==null?'var(--muted)':(pnl>=0?'var(--green)':'var(--red)');
  const sig=pnl!=null?(pnl>=0?'+'+n0(pnl):n0(pnl)):'—';
  const st=m.status==='TRADED'?'🟢':(m.status==='CONDITIONS_NOT_MET'?'⏸️':'⚪');
  return `<tr><td class="num" style="color:var(--cyan)">${m.scenario_id||''}</td>`+
    `<td>${st} ${m.strategy||''}</td>`+
    `<td class="num" style="text-align:right;font-size:10px">${m.entry_time?m.entry_time.slice(0,8):'—'}</td>`+
    `<td class="num" style="text-align:right">${m.entry_combined!=null?'₹'+n0(m.entry_combined):'—'}</td>`+
    `<td class="num" style="text-align:right;font-size:10px">${m.exit_time?m.exit_time.slice(0,8):'—'}</td>`+
    `<td class="num" style="text-align:right">${m.exit_combined!=null?'₹'+n0(m.exit_combined):'—'}</td>`+
    `<td class="num" style="text-align:right;font-weight:800;color:${pcol}">${sig}</td>`+
    `<td class="num" style="text-align:right">${m.win_rate==null?'—':Number(m.win_rate).toFixed(0)+'%'}</td>`+
    `<td class="num" style="text-align:right">${m.profit_factor==null?'—':Number(m.profit_factor).toFixed(2)}</td>`+
    `<td style="font-size:10px;color:var(--muted);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.status==='TRADED'?m.exit_reason||'':(m.reason||'')}</td></tr>`;
}
function _stratListTable(arr){
  return `<div style="overflow-x:auto"><table class="simple-tbl" style="width:100%">`+
    `<thead><tr style="color:var(--muted);font-size:10px"><th style="text-align:left">ID</th><th style="text-align:left">Strategy</th><th style="text-align:right">Entry⏱</th><th style="text-align:right">Entry₹</th><th style="text-align:right">Exit⏱</th><th style="text-align:right">Exit₹</th><th style="text-align:right">P&L</th><th style="text-align:right">Win%</th><th style="text-align:right">PF</th><th style="text-align:left">Note</th></tr></thead>`+
    `<tbody>${arr.map(_stratListRow).join('')}</tbody></table></div>`;
}
async function renderStrategyLab(){
  const d=await jget('/api/strategies/today').catch(()=>({}));
  const host=document.getElementById('stratLabBody'); if(!host)return;
  const rows=d.strategies||[];
  if(!rows.length){ host.innerHTML=''; return; }
  STRAT_DETAIL=rows;
  const traded=rows.filter(m=>m.status==='TRADED');
  const cnm=rows.filter(m=>m.status==='CONDITIONS_NOT_MET');
  const other=rows.filter(m=>m.status!=='TRADED'&&m.status!=='CONDITIONS_NOT_MET');
  const pnls=traded.map(m=>m.net_pnl).filter(v=>v!=null);
  const tot=pnls.reduce((a,b)=>a+b,0), wins=pnls.filter(v=>v>0).length;
  const wr=pnls.length?Math.round(wins/pnls.length*100):null;
  const byPnl=(a,b)=>(b.net_pnl==null?-1e15:b.net_pnl)-(a.net_pnl==null?-1e15:a.net_pnl);
  const best=traded.filter(m=>m.net_pnl!=null).sort(byPnl)[0];
  const worst=traded.filter(m=>m.net_pnl!=null).sort((a,b)=>-byPnl(a,b))[0];
  // ---- KPI header ----
  const losses=pnls.filter(v=>v<0).length;
  const exp=pnls.length?Math.round(tot/pnls.length):null;
  const tcol=tot>=0?'var(--green)':'var(--red)';
  const winPct=pnls.length?Math.round(wins/pnls.length*100):0;
  const kpi=(label,val,col,note)=>`<div style="flex:1 1 120px;min-width:118px;box-sizing:border-box;background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:11px 13px">`+
    `<div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">${label}</div>`+
    `<div class="num" style="font-weight:800;font-size:19px;color:${col||'var(--text)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${val}</div>`+
    (note?`<div style="font-size:9px;color:var(--muted);margin-top:1px">${note}</div>`:'')+`</div>`;
  const hero=`<div style="flex:2 1 220px;min-width:200px;box-sizing:border-box;background:linear-gradient(135deg,var(--surface2),var(--surface));border:1px solid var(--border);border-left:3px solid ${tcol};border-radius:12px;padding:12px 15px">`+
    `<div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px">Net P&L · today${d.date?' · '+d.date:''}</div>`+
    `<div class="num" style="font-weight:800;font-size:29px;line-height:1.1;color:${tcol}">${(tot>=0?'+':'')+n0(tot)}</div>`+
    `<div style="font-size:10px;color:var(--muted);margin-top:3px">${pnls.length} traded · ${wins}W / ${losses}L · avg/trade ${exp==null?'—':(exp>=0?'+':'')+n0(exp)}</div>`+
    `<div style="display:flex;height:6px;border-radius:4px;overflow:hidden;margin-top:7px;background:var(--border)">`+
      `<div style="width:${winPct}%;background:var(--green)"></div><div style="width:${100-winPct}%;background:var(--red)"></div></div></div>`;
  const kpis=`<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">`+
    hero+
    kpi('Win rate',wr==null?'—':wr+'%','var(--cyan)',wr==null?'':wins+'W / '+losses+'L')+
    kpi('Expectancy',exp==null?'—':(exp>=0?'+':'')+n0(exp),exp==null?'var(--muted)':(exp>=0?'var(--green)':'var(--red)'),'per trade')+
    kpi('Best',best?(best.net_pnl>=0?'+':'')+n0(best.net_pnl):'—','var(--green)',best?best.scenario_id:'')+
    kpi('Worst',worst?n0(worst.net_pnl):'—','var(--red)',worst?worst.scenario_id:'')+
    kpi('Stood aside',cnm.length,'var(--muted)','conditions not met')+
  `</div>`;
  // ---- per-strategy card (unchanged detail, factored out) ----
  const card=(m)=>{
    const st=m.status||'—';
    const stIcon=st==='TRADED'?'🟢':(st==='CONDITIONS_NOT_MET'?'⏸️':'⚪');
    const pnl=m.net_pnl,pcol=pnl==null?'var(--muted)':(pnl>=0?'var(--green)':'var(--red)');
    const sig=pnl!=null?(pnl>=0?'+'+n0(pnl):n0(pnl)):'—';
    const e=m.expectancy,ecol=e==null?'var(--muted)':(e>=0?'var(--green)':'var(--red)');
    const et=m.entry_time?m.entry_time.slice(0,8):'—';
    const accent=st==='TRADED'?(pnl>=0?'var(--green)':'var(--red)'):'var(--muted)';
    const nm=(m.strategy||'').split(' · ');
    const codename=nm.length>1?nm[0]:'';
    const fullname=nm.length>1?nm.slice(1).join(' · '):m.strategy;
    const tile=(lbl,val,col)=>`<div style="flex:1;min-width:52px"><div style="font-size:8.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">${lbl}</div><div class="num" style="font-weight:700;font-size:13px;color:${col||'var(--text)'}">${val}</div></div>`;
    return `<div onclick="openStratModal('${(m.scenario_id||'').replace(/'/g,"\\'")}','${(m.strategy||'').replace(/'/g,"\\'")}')" style="cursor:pointer;box-sizing:border-box;background:var(--surface2);border:1px solid var(--border);border-top:3px solid ${accent};border-radius:16px;padding:18px 20px;overflow-wrap:anywhere;box-shadow:0 1px 3px rgba(0,0,0,.25)">`+
      // header: codename + P&L
      `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:3px">`+
        `<div style="min-width:0">`+
          `<div style="display:flex;align-items:center;gap:7px;margin-bottom:3px">`+
            `<span style="font-size:9.5px;font-weight:800;color:var(--cyan);background:var(--surface);border:1px solid var(--border);padding:2px 7px;border-radius:6px">${m.scenario_id||''}</span>`+
            `<span style="font-size:9px;color:var(--muted)">${stIcon} ${st==='TRADED'?'traded':(st==='CONDITIONS_NOT_MET'?'stood aside':st.toLowerCase())}</span></div>`+
          `<div style="font-weight:800;font-size:16px;line-height:1.15;letter-spacing:.2px">${codename||fullname}</div>`+
          (codename?`<div style="font-size:10.5px;color:var(--muted);margin-top:1px">${fullname}</div>`:'')+
        `</div>`+
        `<div style="text-align:right;flex-shrink:0"><div class="num" style="font-weight:800;font-size:22px;line-height:1;color:${pcol}">${sig}</div><div style="font-size:9px;color:var(--muted);margin-top:2px">net P&L</div></div>`+
      `</div>`+
      `<div style="height:1px;background:var(--border);margin:12px 0"></div>`+
      // execution timeline
      `<div style="display:flex;justify-content:space-between;font-size:11px;line-height:1.7">`+
        `<span style="color:var(--muted)">Entry</span><span style="font-weight:600">${et} · ${m.entry_combined!=null?'₹'+n0(m.entry_combined):'—'}</span></div>`+
      `<div style="display:flex;justify-content:space-between;font-size:11px;line-height:1.7">`+
        `<span style="color:var(--muted)">Exit</span><span style="font-weight:600">${m.exit_time?m.exit_time.slice(0,8):'—'} · ${m.exit_combined!=null?'₹'+n0(m.exit_combined):'—'} ${m.exit_reason?'<span style="color:var(--muted);font-size:10px">('+m.exit_reason+')</span>':''}</span></div>`+
      (m.entry_ce!=null?`<div style="display:flex;justify-content:space-between;font-size:10.5px;line-height:1.7;color:var(--text2)"><span style="color:var(--muted)">Legs</span><span>CE ₹${n0(m.entry_ce)}${m.ce_pnl!=null?' ('+(m.ce_pnl>=0?'+':'')+n0(m.ce_pnl)+')':''} · PE ₹${n0(m.entry_pe)}${m.pe_pnl!=null?' ('+(m.pe_pnl>=0?'+':'')+n0(m.pe_pnl)+')':''}</span></div>`:'')+
      `<div style="height:1px;background:var(--border);margin:12px 0"></div>`+
      // metric strip
      `<div style="display:flex;gap:10px">`+
        tile('EXP',e==null?'—':(e>=0?'+':'')+Number(e).toFixed(0),ecol)+
        tile('WIN%',m.win_rate==null?'—':Number(m.win_rate).toFixed(0)+'%')+
        tile('PF',m.profit_factor==null?'—':Number(m.profit_factor).toFixed(2))+
        tile('DAYS',m.sample_days||'—')+
      `</div>`+
      (st==='CONDITIONS_NOT_MET'&&m.reason?`<div style="font-size:10px;color:var(--orange);margin-top:10px;line-height:1.4">⏸️ ${m.reason}</div>`:'')+
      (m.logic?`<div style="font-size:10px;color:var(--muted);margin-top:10px;line-height:1.5">${m.logic}</div>`:'')+`</div>`;
  };
  const grid=(arr)=>`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px">${arr.map(card).join('')}</div>`;
  const sub=(t)=>`<div style="margin:14px 0 8px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px">${t}</div>`;
  const tb=(v,lbl)=>`<button onclick="setStratView('${v}')" style="cursor:pointer;border:1px solid var(--border);background:${_stratView===v?'var(--cyan)':'var(--surface2)'};color:${_stratView===v?'#03121a':'var(--muted)'};font-weight:700;font-size:11px;padding:6px 14px;border-radius:8px">${lbl}</button>`;
  const toggle=`<div style="display:flex;gap:6px;margin-bottom:12px">${tb('cards','▦ Cards')}${tb('list','☰ List')}</div>`;
  let body;
  if(_stratView==='list'){
    body=_stratListTable(traded.slice().sort(byPnl).concat(cnm).concat(other));
  }else{
    body=(traded.length?sub('🟢 Traded ('+traded.length+') · highest P&L first')+grid(traded.slice().sort(byPnl)):'')+
         (cnm.length?sub('⏸️ Stood aside — conditions not met ('+cnm.length+')')+grid(cnm):'')+
         (other.length?grid(other):'');
  }
  host.innerHTML=kpis+toggle+body;
}
// ---- the two 0DTE expiry strategies (LIVE: LTP + running low/high + trigger) ----
async function renderExpiryStrats(){
  const host=document.getElementById('expiryStratBody'); if(!host) return;
  let d, lv;
  try{ d=await jget('/api/expiry_strategies'); }catch(_){ return; }
  try{ lv=await jget('/api/expiry_live'); }catch(_){ lv={}; }
  const dte=document.getElementById('expiryStratDte');
  if(dte) dte.textContent = (d.is_expiry?'⚡ EXPIRY TODAY · armed':'DTE '+(d.dte==null?'—':d.dte)+' · expire '+d.expiry)+((lv&&lv.now)?(' · '+lv.now):'');
  const fmt=v=>(v==null)?'—':Number(v).toFixed(2);
  function liveTbl(legs,mom){
    if(!legs||!legs.length) return '';
    const started=legs[0].started;
    const hdr=mom?'<tr style="color:var(--muted);font-size:10px"><th style="text-align:left">LEG</th><th style="text-align:right">LTP</th><th style="text-align:right">LOW</th><th style="text-align:right">2× TRIG</th><th style="text-align:right">→TRIG</th><th>STATUS</th></tr>'
                 :'<tr style="color:var(--muted);font-size:10px"><th style="text-align:left">LEG</th><th style="text-align:right">LTP</th><th style="text-align:right">HIGH</th><th style="text-align:right">½ SELL</th><th style="text-align:right">↓FROM HI</th><th>STATUS</th></tr>';
    const rows=legs.map(l=>{
      const st=l.fired?'<span class="pill win">⚡</span>':(started?'<span class="pill" style="font-size:10px;color:var(--muted)">⋯</span>':'');
      return mom
        ? `<tr><td style="text-align:left">${l.leg}</td><td class="num" style="text-align:right;font-weight:700">${fmt(l.ltp)}</td><td class="num" style="text-align:right">${fmt(l.low)}</td><td class="num" style="text-align:right;color:var(--green)">${fmt(l.trigger)}</td><td class="num" style="text-align:right">${l.pct_to_trigger==null?'—':l.pct_to_trigger+'%'}</td><td>${st}</td></tr>`
        : `<tr><td style="text-align:left">${l.leg}</td><td class="num" style="text-align:right;font-weight:700">${fmt(l.ltp)}</td><td class="num" style="text-align:right">${fmt(l.high)}</td><td class="num" style="text-align:right;color:var(--red)">${fmt(l.half)}</td><td class="num" style="text-align:right">${l.pct_from_high==null?'—':l.pct_from_high+'%'}</td><td>${st}</td></tr>`;
    }).join('');
    return `<div style="overflow-x:auto"><table class="simple-tbl" style="width:100%;margin-top:8px;white-space:nowrap"><thead>${hdr}</thead><tbody>${rows}</tbody></table></div>`;
  }
  function settleTbl(legs){
    if(!legs||!legs.length) return '';
    const rows=legs.map(l=>{
      const st=l.fired?'<span class="pill lose">SL HIT</span>':(l.started?'<span class="pill" style="font-size:10px;color:var(--muted)">⋯</span>':'');
      if(!l.started&&!l.fired) return '';
      const pnl=l.ltp!=null&&l.entry!=null?(((l.entry-l.ltp)/l.entry*100)).toFixed(1):'—';
      return `<tr><td style="text-align:left">${l.leg}</td>`
        +`<td class="num" style="font-weight:700">${fmt(l.ltp)}</td>`
        +`<td class="num" style="color:var(--cyan)">${fmt(l.entry)}</td>`
        +`<td class="num" style="color:var(--red)">${fmt(l.sl)}</td>`
        +`<td class="num">${pnl}%</td>`
        +`<td>${st}</td></tr>`;
    }).join('');
    if(!rows) return '';
    return `<div style="overflow-x:auto"><table class="simple-tbl" style="width:100%;margin-top:8px;white-space:nowrap"><thead>
      <tr style="color:var(--muted);font-size:10px"><th>LEG</th><th style="text-align:right">LTP</th><th style="text-align:right;color:var(--cyan)">ENTRY</th><th style="text-align:right;color:var(--red)">SL×1.5</th><th style="text-align:right">P&L%</th><th>STATUS</th></tr>
    </thead><tbody>${rows}</tbody></table></div>`;
  }
  const cards=(d.strategies||[]).map(s=>{
    const isMom=s.side==='LONG', sideCol=isMom?'var(--green)':'var(--red)';
    const isSettle=s.id==='S09';
    const slTxt = isSettle?'1.5× entry (50% loss)':(s.sl==='AT_HIGH'?'back to the HIGH':s.sl==='AT_LOW'?'the LOW (≈50% of entry)':(s.sl_level!=null?s.sl_level+'% of entry':'—'));
    const tgtTxt = isSettle?'NONE (ride theta)':(s.target==='TO_ZERO'?('~0 ('+s.target_level+')'):s.target==='MULT'?((s.target_level/100)+'× entry'):(s.target_level!=null?s.target_level+'% of entry':'—'));
    const trig = isSettle?'sell at 3:00 LTP, SL ×1.5 each leg':(isMom?('doubles (×'+s.trigger_mult+') off low'+(s.premium_floor?(' · floor ₹'+s.premium_floor):'')):('collapses to ½ of high'));
    const live = isSettle?(lv&&lv.settlement):(isMom?(lv&&lv.momentum):(lv&&lv.decay));
    return `<div style="box-sizing:border-box;background:var(--surface2);border:1px solid var(--border);border-left:3px solid ${sideCol};border-radius:12px;padding:12px 14px;min-width:300px;flex:1 1 320px;overflow:hidden">
      <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap"><b style="font-size:15px">${s.name}</b><span style="font-size:10px;font-weight:700;color:${sideCol}">SELL</span></div>
      <div style="font-size:11px;color:var(--muted);margin:5px 0 2px">${s.window} · ${trig}</div>
      <div style="font-size:11px;color:var(--muted)">SL <span style="color:var(--red)">${slTxt}</span> · TGT <span style="color:var(--green)">${tgtTxt}</span></div>
      ${isSettle?settleTbl(live):liveTbl(live,isMom)}</div>`;
  }).join('');
  host.innerHTML = cards ? `<div style="display:flex;gap:12px;flex-wrap:wrap">${cards}</div>` : '';
}
APEX.idle(renderExpiryStrats,'renderExpiryStrats'); setInterval(renderExpiryStrats, 30000);   // deferred to an idle slice: below the fold at boot, and nav() re-renders it on demand

/* ===== DECISION BOARD (LAB) ===== */
const _SWLBL={S21:'Entry time',S22:'Stop-loss',S23:'Exit time',S24:'Target',S25:'Hedge width',S26:'Re-entry'};
function _pShort(p){return String(p).replace(/sl_level=/,'SL ').replace(/,?sl_type=/,' · ')
  .replace(/PER_LEG_PCT/,'per-leg').replace(/COMBINED_PCT/,'combined').replace(/entry=/,'')
  .replace(/exit=/,'').replace(/target_level=/,'').replace(/hedge=/,'');}
function _inr(n){return n==null?'—':(n<0?'-':'')+'₹'+Math.abs(Math.round(n)).toLocaleString('en-IN');}
function _cc(n){return n>0?'var(--green)':n<0?'var(--red)':'var(--muted)';}
async function renderLab(){
  let sw,dw;
  try{sw=await (await fetch('/api/sweep_scoreboard')).json();}catch(e){sw=null;}
  try{dw=await (await fetch('/api/dow_scoreboard')).json();}catch(e){dw=null;}
  const W=document.getElementById('labWinners');
  if(sw&&sw.built)document.getElementById('labBuilt').textContent='· rebuilt '+sw.built;
  if(!sw||!sw.winners||!sw.winners.length){W.innerHTML='<div style="color:var(--muted)">No sweep data yet — run <b>tools\\sweep_scoreboard.py</b> or wait for EOD.</div>';}
  else{W.innerHTML=sw.winners.map(w=>`
    <div style="background:var(--surface2,#0d131c);border:1px solid var(--border);border-radius:12px;padding:13px;border-top:3px solid var(--green)">
      <div style="font-size:10px;font-weight:700;letter-spacing:.6px;color:var(--muted);text-transform:uppercase">${_SWLBL[w.scenario_id]||w.scenario_id}</div>
      <div style="font-size:19px;font-weight:800;color:var(--green);margin:5px 0 1px">${_pShort(w.params)}</div>
      <div style="font-size:10px;color:var(--muted);margin-bottom:8px">${w.n} trades · score ${(+w.score).toFixed(2)}</div>
      <div style="display:flex;gap:12px;font-size:11px;flex-wrap:wrap">
        <span>Exp <b style="color:${_cc(w.expectancy)}">${_inr(w.expectancy)}</b></span>
        <span>PF <b>${(+w.profit_factor).toFixed(2)}</b></span>
        <span>Win <b>${Math.round(w.win_rate*100)}%</b></span>
        <span>DD <b style="color:var(--red)">${_inr(w.max_dd)}</b></span>
      </div></div>`).join('');}
  const S=document.getElementById('labSweeps');
  if(sw&&sw.sweeps){
    S.innerHTML=Object.entries(sw.sweeps).map(([sid,g])=>`
      <div style="margin:14px 0 4px;font-weight:700;font-size:12px"><span style="color:var(--violet,#a78bfa)">${sid}</span> · ${_SWLBL[sid]||g.name} <span style="color:var(--muted);font-weight:500;font-size:10px">(${g.cells.length} cells)</span></div>
      <div style="overflow-x:auto"><table class="simple-tbl" style="width:100%"><thead><tr>
        <th style="text-align:left">Parameter</th><th>n</th><th>Total</th><th>Exp</th><th>PF</th><th>Win%</th><th>MaxDD</th><th>Score</th></tr></thead>
        <tbody>${g.cells.map(c=>`<tr style="${c.is_best?'background:rgba(38,208,124,.08)':''};${c.thin_sample?'opacity:.5':''}">
          <td style="text-align:left;font-weight:600">${c.is_best?'★ ':''}${_pShort(c.params)}${c.thin_sample?' <span style="font-size:9px;color:var(--muted)">thin</span>':''}</td>
          <td>${c.n}</td><td style="color:${_cc(c.total_net)}">${_inr(c.total_net)}</td>
          <td style="color:${_cc(c.expectancy)}">${_inr(c.expectancy)}</td>
          <td>${(+c.profit_factor).toFixed(2)}</td><td>${Math.round(c.win_rate*100)}%</td>
          <td style="color:var(--red)">${_inr(c.max_dd)}</td><td style="font-weight:700">${(+c.score).toFixed(2)}</td></tr>`).join('')}</tbody>
      </table></div>`).join('');
  }
  const D=document.getElementById('labDow');
  if(dw&&dw.rows&&dw.rows.length){
    const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday'];
    const by={};dw.rows.forEach(r=>{(by[r.strategy]=by[r.strategy]||{d:{}}).d[r.day_of_week]={e:r.expectancy,b:r.best_day};});
    const mx=Math.max(1,...dw.rows.map(r=>Math.abs(r.expectancy||0)));
    const heat=e=>{if(e==null)return'background:var(--surface2,#0d131c);color:var(--muted)';const a=Math.min(.75,Math.abs(e)/mx*.7+.08);
      return e>=0?`background:rgba(38,208,124,${a});color:#dfffe9`:`background:rgba(255,92,108,${a});color:#ffe4e7`;};
    let h='<table class="simple-tbl" style="width:100%;min-width:640px"><thead><tr><th style="text-align:left">Strategy</th>'+DAYS.map(d=>`<th>${d.slice(0,3)}</th>`).join('')+'</tr></thead><tbody>';
    Object.entries(by).sort().forEach(([name,s])=>{h+=`<tr><td style="text-align:left;font-weight:600">${name.split(' · ')[0]}</td>`+DAYS.map(d=>{const c=s.d[d];
      return c?`<td><span style="display:inline-block;padding:4px 6px;border-radius:6px;font-weight:700;${heat(c.e)}">${_inr(c.e)}${c.b?' ★':''}</span></td>`:'<td><span style="color:var(--muted)">—</span></td>';}).join('')+'</tr>';});
    D.innerHTML=h+'</tbody></table>';
  } else {D.innerHTML='<div style="color:var(--muted)">No day-of-week data yet.</div>';}
}
APEX.idle(renderStrategyLab,'renderStrategyLab'); setInterval(renderStrategyLab, 60000);   // deferred to an idle slice: below the fold at boot, and nav() re-renders it on demand
// The unconditional bottom-right "system health" pill was removed from the
// user-facing frontend (2026-08-08). It was appended to document.body with no
// media-query gate — visible on every viewport, desktop and mobile — and its
// expanded state printed raw backend check names/details straight from
// /api/status ("Database", "DB size: NNN MB", "Risk gate", ...): internal
// infrastructure state with no customer value, permanently on screen and
// undismissable. /api/status is untouched — it remains real backend
// infrastructure, still served, and still consumed by the opt-in
// Settings > Developer diagnostics panel (workstation.js pollDiag, .dev-only).
