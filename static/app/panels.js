/* ============ StraddleEDGE · PANELS JS ============
   Extracted from core.js (implementation-only split, 2026-08-06).
   Below-the-fold panels that self-register via APEX.idle + setInterval.
   Loaded lazily AFTER core.js, so module-scope globals (jget, n2, APEX)
   are all in scope. Removing this file breaks exactly these panels and
   nothing else — every function here is referenced only by itself.
   ponytail: keeps core.js off the boot parse path; upgrade path is a
   proper ES module boundary if the panels ever grow a shared API. */

// Phase 8: shared "upgrade required" detector/renderer for premium-gated widgets.
// Two structured server signals, both from identity/entitlements.py::require_feature
// — 403 {error:'upgrade_required'} (logged in, wrong plan) and 401
// {error:'login_required'} (not logged in at all — premium features still require a
// real login; FREE features never do, see require_feature's own comment) — both
// distinct from a real "no data yet" state, so the UI can say so instead of a
// misleading "NO DATA" message or (renderVrpIntel's un-caught jget() before this fix)
// an infinite "Loading…" that never resolves. STRICT: "no misleading loading state",
// "no broken UI", "useful upgrade/access explanation".
function isUpgradeRequired(err){
  return !!(err && err.body && err.body.detail &&
    ((err.status===403 && err.body.detail.error==='upgrade_required') ||
     (err.status===401 && err.body.detail.error==='login_required')));
}
// Bug report (2026-08-15): this message rendered correctly ("Sign in to unlock") but
// was plain text with no click handler — a user reading "sign in" and clicking it got
// nothing. Every upgradeRequiredHTML() call site (dashboard cards + the VRP/Skew pages
// fixed the same day) gets the fix from this one shared function. 401 -> the real
// login modal (openLogin(), auth.js); 403 (logged in, wrong plan) -> Settings, since
// there is no billing/upgrade page in this app yet and a fabricated one would be worse
// than pointing at a real, existing destination.
function _upgradeRequiredGoto(status){
  if(status===401){ if(window.openLogin) openLogin(); return; }
  var el=document.querySelector('.sb-item[data-page="settings"]');
  if(el && window.nav) nav('settings', el);
}
function upgradeRequiredHTML(label, err){
  var status = err && err.status;
  var msg = (status===401) ? 'Sign in to unlock' : 'Upgrade your plan to unlock';
  return '<div style="color:var(--muted);font-size:11px;cursor:pointer" '+
    'onclick="_upgradeRequiredGoto('+(status===401?401:403)+')" '+
    'title="'+(status===401?'Click to sign in':'Click to open Settings')+'">'+
    '🔒 <b style="color:var(--gold)">'+label+'</b> is a Premium feature — <u>'+msg+'</u></div>';
}

// 15-min range series (index + straddle high/low/range per block)
async function renderRange15(){
  const tb=document.getElementById('range15Body'); if(!tb) return;
  const d=await jget('/api/range15').catch(()=>({})); const bl=(d&&d.blocks)||[];
  const n0=v=>v==null?'—':Number(v).toLocaleString('en-IN',{maximumFractionDigits:0});
  const n1=v=>v==null?'—':Number(v).toLocaleString('en-IN',{maximumFractionDigits:1});
  if(!bl.length){ tb.innerHTML='<tr><td colspan="7" style="color:var(--muted);padding:10px">No blocks yet</td></tr>'; return; }
  tb.innerHTML=bl.map(b=>`<tr>
    <td style="text-align:left;font-family:var(--mono)">${b.block_label}</td>
    <td style="text-align:right;font-family:var(--mono)">${n0(b.spot_high)}</td>
    <td style="text-align:right;font-family:var(--mono)">${n0(b.spot_low)}</td>
    <td style="text-align:right;font-family:var(--mono);color:var(--gold)">${n0(b.spot_range)}</td>
    <td style="text-align:right;font-family:var(--mono)">${n1(b.straddle_high)}</td>
    <td style="text-align:right;font-family:var(--mono)">${n1(b.straddle_low)}</td>
    <td style="text-align:right;font-family:var(--mono);color:var(--cyan)">${n1(b.straddle_range)}</td>
  </tr>`).join('');
}
APEX.idle(renderRange15,'renderRange15'); setInterval(renderRange15, 30000);   // deferred to an idle slice: below the fold at boot, and nav() re-renders it on demand
// Overnight straddle decay lab: aggregates strip + recent rows (records at EOD)
async function renderOvernightDecay(){
  const tb=document.getElementById('ovDecayBody'); if(!tb) return;
  const d=await jget('/api/overnight_decay').catch(()=>({}));
  const rows=(d&&d.rows)||[], a=(d&&d.aggregates)||{}, sp=(d&&d.next_day_split)||[];
  const p2=v=>v==null?window._n(null,'no overnight computation — expiry roll or data gap'):Number(v).toFixed(2)+'%';
  const nS=v=>window._n(v,'strike rolled — no like-for-like comparison');
  const nIV=v=>window._n(v,'source unavailable — IV data missing for this session');
  const agg=document.getElementById('ovDecayAgg');
  if(agg){
    const mx=(d&&d.max_decay_day)||{}, mn=(d&&d.min_decay_day)||{};
    const dd=sp.find(x=>x.is_decay_day===1)||{}, nd=sp.find(x=>x.is_decay_day===0)||{};
    agg.innerHTML=
      `<span>Days <b style="color:var(--text)">${a.n||0}</b></span>`+
      `<span>Avg overnight <b style="color:var(--gold)">${p2(a.avg_decay_pct)}</b></span>`+
      `<span>Avg CE <b>${p2(a.avg_ce_decay_pct)}</b> · PE <b>${p2(a.avg_pe_decay_pct)}</b></span>`+
      `<span>CE-led <b>${a.ce_led_days||0}</b> · PE-led <b>${a.pe_led_days||0}</b></span>`+
      `<span>Max <b style="color:var(--red)">${p2(mx.overnight_decay_pct)}</b> ${mx.date||''}</span>`+
      `<span>Min <b style="color:var(--green)">${p2(mn.overnight_decay_pct)}</b> ${mn.date||''}</span>`+
      `<span style="color:var(--cyan)">Next-day |Nifty|: decay-day ${p2(dd.avg_next_nifty_abs_move_pct)} vs quiet ${p2(nd.avg_next_nifty_abs_move_pct)}</span>`;
  }
  if(!rows.length){ tb.innerHTML='<tr><td colspan="12" style="color:var(--muted);padding:10px">No rows yet — records at EOD</td></tr>'; return; }
  const col=v=>v==null?'var(--muted)':(v>=0?'var(--green)':'var(--red)');
  tb.innerHTML=rows.map(r=>`<tr>
    <td style="text-align:left;font-family:var(--mono)">${r.date}</td>
    <td style="text-align:right;font-family:var(--mono);color:${col(r.overnight_decay_pct)}">${p2(r.overnight_decay_pct)}</td>
    <td style="text-align:right;font-family:var(--mono)">${p2(r.ce_decay_pct)}</td>
    <td style="text-align:right;font-family:var(--mono)">${p2(r.pe_decay_pct)}</td>
    <td style="text-align:center">${r.which_leg_decayed||nS(null)}</td>
    <td style="text-align:right;font-family:var(--mono);color:${col(r.ce_iv_change)}">${r.ce_iv_change==null?nIV(null):(r.ce_iv_change>=0?'+':'')+r.ce_iv_change}</td>
    <td style="text-align:right;font-family:var(--mono);color:${col(r.pe_iv_change)}">${r.pe_iv_change==null?nIV(null):(r.pe_iv_change>=0?'+':'')+r.pe_iv_change}</td>
    <td style="text-align:center;color:var(--violet);font-weight:700">${r.iv_decay_side||nIV(null)}</td>
    <td style="text-align:center">${r.is_decay_day==null?nS(null):(r.is_decay_day?'✓':'·')}</td>
    <td style="text-align:right;font-family:var(--mono)">${p2(r.next_day_nifty_move_pct)}</td>
    <td style="text-align:right;font-family:var(--mono)">${p2(r.next_day_straddle_decay_pct)}</td>
  </tr>`).join('');
  renderPrevDayCard(rows[0]||null);
}
APEX.idle(renderOvernightDecay,'renderOvernightDecay'); setInterval(renderOvernightDecay, 60000);   // deferred to an idle slice: below the fold at boot, and nav() re-renders it on demand
/* Previous Day Decay — Dashboard compact card, Spec B item 2 (added 2026-08-09).
   Fed by the SAME rows renderOvernightDecay() already fetched from
   /api/overnight_decay — no second request, no second owner. `r` is rows[0]
   (ORDER BY date DESC in main.py), i.e. the most recently completed session.

   2026-08-10 data-integrity incident fix: the card used to show a bare "—" any
   time overnight_decay_pct (Metric A, same-strike) was null, even on days
   where /api/overnight_decay's row ALSO carries reatm_change_pct (Metric B,
   re-ATM cross-strike) — a real, derivable number the card was silently
   discarding. Root cause of Metric A itself being null on 2026-08-07 was a
   backend bug (collector/overnight_decay.py v1.1, _same_strike_same_expiry
   NULL-propagation) — fixed there. This frontend change is the second half of
   "must not return NO DATA if derivation is possible": Metric A stays the
   primary, most-accurate number; when it's unavailable, Metric B is shown as
   an explicitly-labeled proxy (never silently substituted, never mixed into
   the same number) instead of a blank dash; only when NEITHER is derivable
   does the card fall back to NO DATA — and even then it now shows the real
   reason (decay_reason / validity_status) instead of nothing.

   Status vocabulary: VERIFIED (Metric A computed) / RE-ATM PROXY (Metric A
   unavailable, Metric B shown instead, clearly labeled) / NO DATA (row exists
   but neither metric is derivable, or no row at all — reason always shown). */
window._prevDecayDate = null;
function renderPrevDayCard(r){
  const pill=document.getElementById('pd-status-pill'), body=document.getElementById('pd-body');
  if(!pill||!body) return;
  if(!r){
    window._prevDecayDate=null;
    pill.innerHTML='<span class="pill loss">NO DATA</span>';
    body.innerHTML='<div style="color:var(--muted);font-size:11px">no overnight decay session recorded yet</div>';
    return;
  }
  window._prevDecayDate=r.date;
  const hasA=r.overnight_decay_pct!=null, hasB=(!hasA && r.reatm_change_pct!=null);
  const status=hasA?'VERIFIED':(hasB?'RE-ATM PROXY':'NO DATA');
  const statusCls=hasA?'win':hasB?'skip':'loss';
  const col=v=>v==null?'var(--muted)':(v>=0?'var(--green)':'var(--red)');
  const p2=v=>v==null?window._n(null,'no overnight computation'):(v>=0?'+':'')+Number(v).toFixed(2)+'%';
  pill.innerHTML=`<span class="pill ${statusCls}">${status}</span>`;
  if(hasA){
    body.innerHTML=
      `<div style="font-size:11px;color:var(--muted);margin-bottom:2px">${r.date}</div>`+
      `<div style="font-family:var(--disp);font-weight:800;font-size:19px;color:${col(r.overnight_decay_pct)}">${p2(r.overnight_decay_pct)}</div>`+
      `<div style="font-size:10px;color:var(--muted);margin-top:3px">CE ${p2(r.ce_decay_pct)} · PE ${p2(r.pe_decay_pct)}</div>`;
  } else if(hasB){
    // Metric B: today_straddle - prev_straddle (cross-strike, ATM rolled overnight).
    // Sign convention differs from Metric A (decay=premium LOST), so flip it here
    // to match — never display Metric B's raw sign as if it were Metric A's.
    const proxyPts = r.reatm_change_pct!=null ? -r.reatm_change_pct : null;
    body.innerHTML=
      `<div style="font-size:11px;color:var(--muted);margin-bottom:2px">${r.date}</div>`+
      `<div style="font-family:var(--disp);font-weight:800;font-size:19px;color:${col(proxyPts)}">${p2(proxyPts)}</div>`+
      `<div style="font-size:10px;color:var(--muted);margin-top:3px">re-ATM proxy — ATM strike rolled overnight, same-strike decay not available (${(r.decay_reason||r.validity_status||'').slice(0,90)})</div>`;
  } else {
    body.innerHTML=
      `<div style="font-size:11px;color:var(--muted);margin-bottom:2px">${r.date}</div>`+
      `<div style="font-family:var(--disp);font-weight:800;font-size:15px;color:var(--muted)">—</div>`+
      `<div style="font-size:10px;color:var(--muted);margin-top:3px">${(r.decay_reason||r.validity_status||'no overnight computation for this session').slice(0,110)}</div>`;
  }
}
// Navigates the Live dashboard's compact card into the History page, pre-selecting
// the exact same date — reuses nav() + selectHistoryDate(), item #55's own path,
// so this is wiring, not a new page or a new lookup.
function openPrevDecayHistory(){
  const el=document.querySelector('.sb-item[data-page="history"]');
  if(!el) return;
  nav('history', el);
  if(window._prevDecayDate){
    requestAnimationFrame(()=>setTimeout(()=>selectHistoryDate(window._prevDecayDate), 60));
  }
}

/* Generic vertical swipe-down-to-close + Escape + backdrop-tap + browser-back for a
 * bottom sheet, given its backdrop id, panel id, and close function. Extracted
 * 2026-08-11 when the Skew and VRP sheets needed the IDENTICAL mechanic the OI
 * sheet already has (see the OI-specific IIFE further down in this file) — with
 * three call sites the copy-paste would have been a real duplicate-code violation;
 * with one (OI, built alone on 2026-08-11) generalising early would have been
 * speculative. OI's own handler is left exactly as-is (no drive-by refactor of
 * already-tested code) — only the two NEW sheets use this. */
function _wireVerticalSwipeSheet(backdropId, panelId, closeFn){
  var startY=0, dragging=false, panel=null;
  document.addEventListener('touchstart',function(e){
    var bd=document.getElementById(backdropId);
    if(!bd||!bd.classList.contains('open')) return;
    if(!e.target.closest('#'+panelId)) return;
    startY=e.touches[0].clientY; dragging=true;
    panel=document.getElementById(panelId);
    if(panel) panel.style.transition='none';
  },{passive:true});
  document.addEventListener('touchmove',function(e){
    if(!dragging||!panel) return;
    var dy=e.touches[0].clientY-startY;
    if(dy>0){
      var dampened=dy*0.55;
      panel.style.transform='translateY('+dampened+'px)';
      var bd=document.getElementById(backdropId);
      if(bd) bd.style.opacity=String(Math.max(0,1-dampened/(window.innerHeight*0.5)));
    }
  },{passive:true});
  document.addEventListener('touchend',function(e){
    if(!dragging){return;}
    dragging=false;
    if(!panel){return;}
    panel.style.transition='transform .3s cubic-bezier(.32,.72,0,1)';
    var dy=(e.changedTouches&&e.changedTouches[0])?e.changedTouches[0].clientY-startY:0;
    var bd=document.getElementById(backdropId);
    if(dy*0.55>60){
      panel.style.transform='translateY(100vh)';
      if(bd) bd.style.opacity='0';
      setTimeout(function(){closeFn();panel.style.transform='';if(bd)bd.style.opacity='';},280);
    }else{
      panel.style.transform='';
      if(bd) bd.style.opacity='';
    }
    panel=null;
  },{passive:true});
  document.addEventListener('keydown',function(e){
    if(e.key!=='Escape') return;
    var bd=document.getElementById(backdropId);
    if(bd&&bd.classList.contains('open')) closeFn();
  });
  window.addEventListener('popstate',function(){
    var bd=document.getElementById(backdropId);
    if(bd&&bd.classList.contains('open')) closeFn();
  });
}

/* Skew Intelligence — Dashboard compact card + detail bottom-sheet (rebuilt
 * 2026-08-11, staleness-bug + trust-upgrade fix). Reuses the SAME two endpoints
 * — and the SAME verdict formula — the Skew page's renderSkew()/renderSkewRegimes()
 * already use: skew_daily (RR25/FLY25, the institutional skew headline,
 * EOD-computed by research_ext.build_skew_daily — this is a daily figure, not
 * an intraday tick series, so "freshness" here means "is this today's row",
 * not "how many seconds old") and skew_regimes (does the cheaper side predict
 * direction — the "moved toward cheaper" hit-rate, plus flipped_to for
 * put/call switch detection — both already computed server-side, not
 * re-derived here). renderSkew() itself only runs while the Skew page is
 * active, so this card cannot "hook into" that in-flight fetch the way item
 * #2's card rides renderOvernightDecay() — it makes its own small, cheap call
 * to the same two owner endpoints and mirrors the same verdict logic verbatim.
 *
 * Fixed alongside: openSkewIntel() used to call a nonexistent detail function —
 * the exact dead-click bug already found and fixed for OI Intelligence (see
 * prove_dashboard_skew_oi_intel.py) — so the card's click silently did nothing.
 * It now opens a compact detail sheet, matching the OI card's UX. */
function _skewFreshness(t){
  // No invented thresholds: skew_daily rows are one-per-day. "today" (this
  // process's local date) is the only freshness signal that exists for a daily
  // series — same "current vs previous session" vocabulary /api/vrp's own
  // provenance field already uses (core.js renderVRP, ~line 3881), not a new one.
  if(!t || !t.date) return {state:'UNAVAILABLE', label:'UNAVAILABLE'};
  const today=new Date().toLocaleDateString('en-CA'); // en-CA -> YYYY-MM-DD, local tz
  return t.date===today ? {state:'LIVE', label:'TODAY · '+t.date}
                         : {state:'STALE', label:'PREVIOUS SESSION · '+t.date};
}
function _skewFreshColor(state){ return state==='LIVE'?'var(--green)':state==='STALE'?'var(--gold)':'var(--muted)'; }
var _skewDailyCache=null, _skewRegimesCache=null, _skewFetchedAt=0, _skewErr=null;
async function _fetchSkew(force){
  const age=Date.now()-_skewFetchedAt;
  if(!force && _skewDailyCache && _skewDailyCache.today && age<5000) return {sd:_skewDailyCache, rd:_skewRegimesCache};
  _skewErr=null;
  const r=await Promise.all([
    jget('/api/skew_daily').catch(e=>{_skewErr=_skewErr||e; return {};}),
    jget('/api/skew_regimes').catch(e=>{_skewErr=_skewErr||e; return {};})]);
  if(r[0] && r[0].today){_skewDailyCache=r[0];_skewRegimesCache=r[1];_skewFetchedAt=Date.now()}
  return {sd:r[0], rd:r[1]};
}
async function renderSkewIntel(){
  const body=document.getElementById('si-body'), verdictEl=document.getElementById('si-verdict');
  if(!body) return;
  const c=await _fetchSkew(false); const sd=c.sd, rd=c.rd;
  const t=sd&&sd.today;
  if(!t){
    body.innerHTML=isUpgradeRequired(_skewErr)?upgradeRequiredHTML('Skew Intelligence',_skewErr)
      :'<div style="color:var(--muted);font-size:11px">NO DATA — skew not yet computed today</div>';
    if(verdictEl){ verdictEl.textContent=''; }
    return;
  }
  const rr=t.rr25, fly=t.fly25;
  // Task C item 9: skewVerdict() (core.js) is the ONE place this label/color is
  // decided — this card used to carry its own copy of the threshold logic that had
  // drifted from the Skew page's own copy ("PUT SKEW" vs "PUT SKEW · fear" for the
  // same rr). Both now call the same function; neither computes a label itself.
  const verdict=skewVerdict(rr);
  if(verdictEl){ verdictEl.textContent=verdict.label; verdictEl.style.color=verdict.color; }
  const hit=(rd&&rd.toward_cheaper_pct!=null)?rd.toward_cheaper_pct+'% ('+rd.sample+' regimes)':window._n(null,'accumulating regimes');
  const fresh=_skewFreshness(t);
  // Day-over-day change: real data already in sd.history — not a fabricated intraday delta.
  const prevRow=(sd.history||[]).find(x=>x.date!==t.date);
  const chg=(prevRow&&prevRow.rr25!=null&&rr!=null)?rr-prevRow.rr25:null;
  body.innerHTML=
    '<div style="width:100%;font-size:9px;color:'+_skewFreshColor(fresh.state)+';margin-bottom:2px">'+fresh.label+'</div>'+
    '<span style="font-size:11px;color:var(--muted)">RR25 <b style="color:'+(rr==null?'var(--muted)':(rr>=0?'var(--green)':'var(--red)'))+'">'+(rr==null?'—':(rr>=0?'+':'')+Number(rr).toFixed(2))+'</b></span>'+
    '<span style="font-size:11px;color:var(--muted)">FLY25 <b>'+(fly==null?'—':(fly>=0?'+':'')+Number(fly).toFixed(2))+'</b></span>'+
    '<span style="font-size:11px;color:var(--muted)">Cheaper <b>'+(t.cheaper_side||'—')+'</b></span>'+
    (chg!=null?'<span style="font-size:11px;color:var(--muted)">vs prev <b style="color:'+(chg>=0?'var(--green)':'var(--red)')+'">'+(chg>=0?'+':'')+chg.toFixed(2)+'</b></span>':'')+
    '<div style="width:100%;font-size:11px;color:var(--muted);margin-top:4px">Historically moved toward cheaper side: <b style="color:var(--text)">'+hit+'</b></div>';
}
APEX.idle(renderSkewIntel,'renderSkewIntel'); setInterval(renderSkewIntel, 60000);

/* Click behaviour: opens the compact sheet from whatever is cached (never blocks
 * on network), then refreshes once in the background — same pattern as the OI
 * sheet (openOiSheet). */
async function openSkewSheet(){
  var bd=document.getElementById('skewBackdrop'); if(!bd) return;
  bd.classList.add('open');
  history.pushState({skewSheet:true},'');
  var cached=await _fetchSkew(false);
  _renderSkewSheetBody(cached);
  var body=document.getElementById('skewSheetBody'); if(body) body.scrollTop=0;
  var fresh=await _fetchSkew(true);
  if(fresh && bd.classList.contains('open')) _renderSkewSheetBody(fresh);
  if(window._sheetOpened) _sheetOpened('skewBackdrop');
}
function closeSkewSheet(){ var bd=document.getElementById('skewBackdrop'); if(bd) bd.classList.remove('open'); if(window._sheetClosed) _sheetClosed('skewBackdrop'); }
function openSkewIntel(){ openSkewSheet(); }  // compat: old name, old bug (quickDetail) fixed
function _skewViewFullPage(){
  closeSkewSheet();
  var el=document.querySelector('.sb-item[data-page="skew"]');
  if(el) nav('skew',el);
}
function _renderSkewSheetBody(cache){
  var stateEl=document.getElementById('skew-sheet-state'), subEl=document.getElementById('skew-sheet-sub'),
      body=document.getElementById('skewSheetBody');
  if(!body) return;
  var sd=cache&&cache.sd, rd=cache&&cache.rd, t=sd&&sd.today;
  if(!t){
    if(stateEl){stateEl.textContent='NO DATA';stateEl.style.color='var(--muted)';}
    if(subEl) subEl.innerHTML='<span class="dot" style="background:var(--muted)"></span><span>skew not yet computed today</span>';
    body.innerHTML='<div class="rs-empty">No data available.</div>'+
      '<button class="btn ghost" style="width:100%;margin-top:14px" onclick="_skewViewFullPage()">View page →</button>';
    return;
  }
  var rr=t.rr25, verdict=skewVerdict(rr), fresh=_skewFreshness(t);
  if(stateEl){ stateEl.textContent=verdict.label; stateEl.style.color=verdict.color; }
  if(subEl) subEl.innerHTML='<span class="dot" style="background:'+_skewFreshColor(fresh.state)+'"></span><span>'+fresh.label+'</span>';
  var row=function(label,val,c){ return '<div class="c"><div class="k">'+label+'</div><div class="v num" style="color:'+(c||'var(--text)')+'">'+val+'</div></div>'; };
  var sect=function(title,html){ return '<div style="margin:14px 0 6px;font-size:9px;letter-spacing:1px;color:var(--muted);text-transform:uppercase">'+title+'</div>'+html; };
  var prevRow=(sd.history||[]).find(function(x){return x.date!==t.date;});
  var chg=(prevRow&&prevRow.rr25!=null&&rr!=null)?rr-prevRow.rr25:null;
  var html='';
  html+=sect('Current', '<div class="pos-grid">'+
    row('RR25', rr==null?'—':(rr>=0?'+':'')+Number(rr).toFixed(2), rr==null?'var(--muted)':(rr>=0?'var(--green)':'var(--red)'))+
    row('FLY25', t.fly25==null?'—':(t.fly25>=0?'+':'')+Number(t.fly25).toFixed(2))+
    row('ATM IV', t.atm_iv==null?'—':Number(t.atm_iv).toFixed(2)+'%')+
    row('Cheaper side', t.cheaper_side||'—')+
    '</div>');
  html+=sect('Change', '<div class="pos-grid">'+
    row('vs previous session', chg==null?'—':(chg>=0?'+':'')+chg.toFixed(2), chg==null?'var(--muted)':(chg>=0?'var(--green)':'var(--red)'))+
    (prevRow?row('Previous RR25', Number(prevRow.rr25).toFixed(2)+' ('+prevRow.date+')'):'')+
    '</div>');
  var regimes=(rd&&rd.regimes)||[];
  var latestRegime=regimes[0];
  html+=sect('Regime · directional signal', '<div class="pos-grid">'+
    row('Moved toward cheaper', (rd&&rd.toward_cheaper_pct!=null)?rd.toward_cheaper_pct+'%':window._n(null,'accumulating regimes'))+
    row('Sample', (rd&&rd.sample!=null)?rd.sample+' regimes':'0')+
    (latestRegime?row('Latest regime cheaper side', latestRegime.cheaper_side||'—'):'')+
    (latestRegime&&latestRegime.flipped_to?row('Flipped to', latestRegime.flipped_to, 'var(--gold)'):'')+
    (latestRegime?row('Still open', latestRegime.still_open?'yes':'no'):'')+
    '</div>');
  html+=sect('Data coverage', '<div class="pos-grid">'+
    row('Observation date', t.date||'—')+
    row('Freshness', fresh.state, _skewFreshColor(fresh.state))+
    '</div>');
  html+='<button class="btn ghost" style="width:100%;margin-top:16px" onclick="_skewViewFullPage()">View page →</button>';
  body.innerHTML=html;
}
_wireVerticalSwipeSheet('skewBackdrop','skewPanel',closeSkewSheet);

/* OI Intelligence — Dashboard compact card + detail bottom-sheet (rebuilt
 * 2026-08-11, dashboard UX upgrade). Reuses /api/oi-flow's own `pattern`,
 * `state_label`, `interpretation`, `data_quality`, `change_5m`, `change_15m`,
 * `range_5m`, `range_15m` fields verbatim — ALL computed once in main.py's
 * oi_flow() (single owner). Nothing here re-derives a signal from ce_chg/pe_chg;
 * the card used to carry its own copy of the 1.2x/10000 classification thresholds
 * (a real single-owner violation — see tools/proof for OI Intelligence upgrade),
 * which is why it could show a different label than the VRP page's OI Flow table
 * for the exact same numbers. Fixed by deleting that copy, not by tuning it.
 *
 * _oiFlowData / _oiFlowFetchedAt: the ONE cache both the card and the detail sheet
 * read from (Section 6 — "avoid duplicate API requests"). The card's own 60s poll
 * keeps it warm; opening the sheet renders instantly from this cache, then fires
 * a background refresh only if the cache is more than 5s old. */
var _oiFlowData = null, _oiFlowFetchedAt = 0, _oiFlowErr = null;
async function _fetchOiFlow(force){
  var age = Date.now() - _oiFlowFetchedAt;
  if(!force && _oiFlowData && age < 5000) return _oiFlowData;
  _oiFlowErr = null;
  var d = await jget('/api/oi-flow').catch(function(e){ _oiFlowErr=e; return null; });
  if(d){ _oiFlowData = d; _oiFlowFetchedAt = Date.now(); }
  return _oiFlowData;
}
// 3172000 -> "+31.72L", 0 -> "0", negative handled. Shared by the card and the sheet.
function _oiFmtL(v){ if(v==null) return '—'; var a=Math.abs(v);
  if(a>=100000) return (v>=0?'+':'−')+(a/100000).toFixed(2)+'L';
  if(a>=1000) return (v>=0?'+':'−')+(a/1000).toFixed(1)+'K';
  return (v>=0?'+':'−')+a; }
function _oiStateColor(state){ return state==='LIVE'?'var(--green)':state==='FRESH'?'var(--accent)':
  state==='STALE'?'var(--gold)':state==='ERROR'?'var(--red)':'var(--muted)'; }
function _oiPatternColor(p){ return p==='BEARISH_FLOW'?'var(--red)':p==='BULLISH_FLOW'?'var(--green)':
  p==='STRADDLE_BUILD'?'var(--gold)':p==='UNWIND'?'var(--violet)':'var(--muted)'; }

async function renderOiIntel(){
  const body=document.getElementById('oi-body'), tagEl=document.getElementById('oi-pattern');
  if(!body) return;
  const d=await _fetchOiFlow(false);
  if(!d){
    body.innerHTML=isUpgradeRequired(_oiFlowErr)?upgradeRequiredHTML('OI Intelligence',_oiFlowErr)
      :'<div style="color:var(--muted);font-size:11px">NO DATA — /api/oi-flow unreachable</div>';
    return;
  }
  const pattern=d.pattern, dq=d.data_quality||{state:'UNAVAILABLE'};
  if(tagEl){ tagEl.textContent=dq.state; tagEl.style.color=_oiStateColor(dq.state); }
  const snaps=d.snapshots||[];
  if(!d.latest || dq.state==='WAITING'){
    body.innerHTML='<div style="color:var(--muted);font-size:11px">'+(dq.state==='ERROR'?'ERROR — '+(d.error||'could not read OI data'):
      dq.state==='UNAVAILABLE'?'UNAVAILABLE — no OI data for today':'WAITING — no OI snapshots yet today')+'</div>';
    return;
  }
  const latest=d.latest, prev=d.previous;
  const ceD=latest.ce_chg>0?'↑':latest.ce_chg<0?'↓':'→', peD=latest.pe_chg>0?'↑':latest.pe_chg<0?'↓':'→';
  const ceCol=latest.ce_chg>0?'var(--red)':latest.ce_chg<0?'var(--green)':'var(--muted)';
  const peCol=latest.pe_chg>0?'var(--green)':latest.pe_chg<0?'var(--red)':'var(--muted)';
  const staleNote=dq.state==='STALE'?'<div style="font-size:9px;color:var(--gold);margin-bottom:3px">⚠ STALE data — last update '+(dq.last_updated||'—')+'</div>':'';
  body.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">'+
    '<span style="font-size:11px;font-weight:700;color:'+_oiPatternColor(pattern)+'">'+(d.state_label||'GATHERING DATA')+'</span>'+
    '<span style="font-size:8.5px;color:var(--muted)">'+latest.time+' · '+d.snapshot_count+' obs</span></div>'+
    staleNote+
    '<div style="display:flex;gap:16px;margin-bottom:5px">'+
    '<div style="flex:1"><div style="font-size:8px;color:var(--muted)">CE Δ (5m)</div><div style="font-size:14px;font-weight:700;color:'+ceCol+'">'+ceD+' '+_oiFmtL(latest.ce_chg)+'</div></div>'+
    '<div style="flex:1"><div style="font-size:8px;color:var(--muted)">PE Δ (5m)</div><div style="font-size:14px;font-weight:700;color:'+peCol+'">'+peD+' '+_oiFmtL(latest.pe_chg)+'</div></div></div>'+
    (d.interpretation?'<div style="font-size:9.5px;color:var(--muted);line-height:1.5">"'+d.interpretation+'"</div>':'');
}
APEX.idle(renderOiIntel,'renderOiIntel'); setInterval(renderOiIntel, 60000);

/* Click behaviour (Section 3): opens the compact detail sheet using whatever is
 * already cached — never blocks on a network round-trip — then refreshes once in
 * the background and re-renders if the refresh returns something newer. */
async function openOiSheet(){
  var bd=document.getElementById('oiBackdrop'); if(!bd) return;
  bd.classList.add('open');
  history.pushState({oiSheet:true},'');
  var cached=await _fetchOiFlow(false);
  _renderOiSheetBody(cached);
  var body=document.getElementById('oiSheetBody'); if(body) body.scrollTop=0;
  var fresh=await _fetchOiFlow(true);
  if(fresh && bd.classList.contains('open')) _renderOiSheetBody(fresh);
  if(window._sheetOpened) _sheetOpened('oiBackdrop');
}
function closeOiSheet(){ var bd=document.getElementById('oiBackdrop'); if(bd) bd.classList.remove('open'); if(window._sheetClosed) _sheetClosed('oiBackdrop'); }
// kept for compatibility: nothing else in the codebase calls this name after the
// rebuild, but a stale cached HTML/PWA bundle mid-rollout should degrade to the
// new sheet rather than throwing a ReferenceError (quickDetail never existed).
function openOiIntel(){ openOiSheet(); }
// Sheet's own nav-out button (Section 3: ONLY this may navigate to the VRP page).
// A plain named function instead of an inline handler with a nested selector
// string — three levels of quote-escaping inside one onclick attribute is exactly
// the kind of thing that silently breaks and is hard to eyeball-verify.
function _oiViewFullPage(){
  closeOiSheet();
  var el=document.querySelector('.sb-item[data-page="vrp"]');
  if(el) nav('vrp',el);
}

function _renderOiSheetBody(d){
  var stateEl=document.getElementById('oi-sheet-state'), subEl=document.getElementById('oi-sheet-sub'),
      body=document.getElementById('oiSheetBody');
  if(!body) return;
  if(!d){
    if(stateEl){stateEl.textContent='ERROR';stateEl.style.color='var(--red)';}
    if(subEl) subEl.innerHTML='<span class="dot" style="background:var(--red)"></span><span>could not reach /api/oi-flow</span>';
    body.innerHTML='<div class="rs-empty">No data available.</div>';
    return;
  }
  const dq=d.data_quality||{state:'UNAVAILABLE'}, col=_oiStateColor(dq.state);
  if(stateEl){ stateEl.textContent=d.state_label||'GATHERING DATA'; stateEl.style.color=_oiPatternColor(d.pattern); }
  if(subEl) subEl.innerHTML='<span class="dot" style="background:'+col+'"></span><span>'+dq.state+
    (dq.age_seconds!=null?' · updated '+Math.round(dq.age_seconds/60)+'m ago':'')+'</span>';
  if(!d.latest){
    body.innerHTML='<div class="rs-empty">'+(dq.state==='ERROR'?'ERROR — '+(d.error||'unknown error'):
      dq.state==='UNAVAILABLE'?'UNAVAILABLE — no OI data for today.':'WAITING — no OI snapshots yet today.')+'</div>'+
      '<button class="btn ghost" style="width:100%;margin-top:14px" onclick="_oiViewFullPage()">View page →</button>';
    return;
  }
  const latest=d.latest;
  const row=function(label,val,c){ return '<div class="c"><div class="k">'+label+'</div><div class="v num" style="color:'+(c||'var(--text)')+'">'+val+'</div></div>'; };
  const chg15=d.change_15m||{}, r5=d.range_5m, r15=d.range_15m;
  const sect=function(title,html){ return '<div style="margin:14px 0 6px;font-size:9px;letter-spacing:1px;color:var(--muted);text-transform:uppercase">'+title+'</div>'+html; };
  var html='';
  html += sect('Current', '<div class="pos-grid">'+
    row('CE OI', _oiFmtL(latest.ce_oi))+
    row('PE OI', _oiFmtL(latest.pe_oi))+
    row('Net State', d.state_label||'—', _oiPatternColor(d.pattern))+
    '</div>');
  html += sect('Intraday · 5 MIN', '<div class="pos-grid">'+
    row('CE Δ', _oiFmtL(latest.ce_chg), latest.ce_chg>0?'var(--red)':latest.ce_chg<0?'var(--green)':'var(--muted)')+
    row('PE Δ', _oiFmtL(latest.pe_chg), latest.pe_chg>0?'var(--green)':latest.pe_chg<0?'var(--red)':'var(--muted)')+
    (r5?row('CE range', _oiFmtL(r5.ce_low)+' .. '+_oiFmtL(r5.ce_high)):'')+
    (r5?row('PE range', _oiFmtL(r5.pe_low)+' .. '+_oiFmtL(r5.pe_high)):'')+
    '</div>');
  html += sect('Intraday · 15 MIN', chg15.available ?
    '<div class="pos-grid">'+
    row('CE Δ', _oiFmtL(chg15.ce), chg15.ce>0?'var(--red)':chg15.ce<0?'var(--green)':'var(--muted)')+
    row('PE Δ', _oiFmtL(chg15.pe), chg15.pe>0?'var(--green)':chg15.pe<0?'var(--red)':'var(--muted)')+
    (r15?row('CE range', _oiFmtL(r15.ce_low)+' .. '+_oiFmtL(r15.ce_high)):'')+
    (r15?row('PE range', _oiFmtL(r15.pe_low)+' .. '+_oiFmtL(r15.pe_high)):'')+
    '</div>' :
    '<div class="rs-empty" style="font-size:11px;padding:8px 0">UNAVAILABLE — '+(chg15.reason||'not enough snapshots yet')+'</div>');
  html += sect('Snapshots', '<div class="pos-grid">'+
    row('Latest', latest.time)+
    row('Previous', d.previous?d.previous.time:'—')+
    row('Count today', d.snapshot_count)+
    row('Freshness', dq.state, col)+
    '</div>');
  if(d.interpretation) html += sect('Interpretation', '<div style="font-size:12.5px;color:var(--text2);line-height:1.5">'+d.interpretation+'</div>');
  html += '<button class="btn ghost" style="width:100%;margin-top:16px" onclick="_oiViewFullPage()">View page →</button>';
  body.innerHTML=html;
}

/* Mobile UX (Section 4): swipe-DOWN-to-close on #oiPanel, ESC on desktop, browser
 * back closes it too (history.pushState in openOiSheet). Deliberately a small,
 * self-contained, VERTICAL-ONLY handler rather than reusing core.js's regime-sheet
 * drag handler: that one also drives horizontal tab-swiping the OI sheet has no
 * tabs for, and it is hardcoded to #regimePanel/#regimeBackdrop/_regimeSheetTab —
 * generalising it would be a drive-by refactor of already-tested Phase C/D code
 * for a feature this sheet doesn't need. Backdrop-tap-to-close is the onclick on
 * #oiBackdrop in the HTML (same pattern as #ixDetailModalBg). */
(function(){
  var startY=0, dragging=false, panel=null;
  document.addEventListener('touchstart',function(e){
    var bd=document.getElementById('oiBackdrop');
    if(!bd||!bd.classList.contains('open')) return;
    if(!e.target.closest('#oiPanel')) return;
    startY=e.touches[0].clientY; dragging=true;
    panel=document.getElementById('oiPanel');
    if(panel) panel.style.transition='none';
  },{passive:true});
  document.addEventListener('touchmove',function(e){
    if(!dragging||!panel) return;
    var dy=e.touches[0].clientY-startY;
    if(dy>0){
      var dampened=dy*0.55;
      panel.style.transform='translateY('+dampened+'px)';
      var bd=document.getElementById('oiBackdrop');
      if(bd) bd.style.opacity=String(Math.max(0,1-dampened/(window.innerHeight*0.5)));
    }
  },{passive:true});
  document.addEventListener('touchend',function(e){
    if(!dragging){return;}
    dragging=false;
    if(!panel){return;}
    panel.style.transition='transform .3s cubic-bezier(.32,.72,0,1)';
    var dy=(e.changedTouches&&e.changedTouches[0])?e.changedTouches[0].clientY-startY:0;
    var bd=document.getElementById('oiBackdrop');
    if(dy*0.55>60){
      panel.style.transform='translateY(100vh)';
      if(bd) bd.style.opacity='0';
      setTimeout(function(){closeOiSheet();panel.style.transform='';if(bd)bd.style.opacity='';},280);
    }else{
      panel.style.transform='';
      if(bd) bd.style.opacity='';
    }
    panel=null;
  },{passive:true});
  document.addEventListener('keydown',function(e){
    if(e.key!=='Escape') return;
    var bd=document.getElementById('oiBackdrop');
    if(bd&&bd.classList.contains('open')) closeOiSheet();
  });
  window.addEventListener('popstate',function(){
    var bd=document.getElementById('oiBackdrop');
    if(bd&&bd.classList.contains('open')) closeOiSheet();
  });
})();

/* VRP Intelligence — Dashboard compact card + detail bottom-sheet (rebuilt
 * 2026-08-11, staleness-bug + trust-upgrade fix, Task C item 5 base 2026-08-09):
 * "wire Dashboard cards to show summary data from existing owners/pages ...
 * without duplicating computation." Reuses /api/vrp verbatim — the SAME
 * endpoint, the SAME `verdict`/`rich_cheap` field, and the SAME `provenance`/
 * `session_date` freshness fields the VRP page's own renderVRP() (overrides.js)
 * and core.js's own provenance banner (~line 3881) already use — this card
 * only renders them, never recomputes a second RICH/CHEAP/FAIR threshold or a
 * second freshness rule. main.py's vrp() computes iv/rv live per request (no
 * server-side cache) — provenance is "current" while today has a live
 * iv_summary row and >=5 spot bars, and honestly falls back to "previous"
 * (labelled with the real prior session_date) only when today has neither, per
 * its own docstring. */
function _vrpFreshColor(prov){ return prov==='current'?'var(--green)':prov==='previous'?'var(--gold)':'var(--muted)'; }
function _vrpFreshLabel(d){
  if(d.provenance==='current') return 'LIVE · '+(d.session_date||'today');
  if(d.provenance==='previous') return 'PREVIOUS SESSION · '+(d.session_date||'—');
  return 'UNAVAILABLE';
}
var _vrpCache=null, _vrpFetchedAt=0, _vrpErr=null;
async function _fetchVrp(force){
  const age=Date.now()-_vrpFetchedAt;
  if(!force && _vrpCache && age<5000) return _vrpCache;
  _vrpErr=null;
  const d=await jget('/api/vrp').catch(e=>{_vrpErr=e; return null;});
  if(d){ _vrpCache=d; _vrpFetchedAt=Date.now(); }
  return _vrpCache;
}
async function renderVrpIntel(){
  const body=document.getElementById('vi-body'), verdictEl=document.getElementById('vi-verdict');
  if(!body) return;
  // Was a direct, un-caught jget('/api/vrp') before this fix: any thrown error (a 403
  // upgrade_required among them) left body.innerHTML stuck on its static "Loading…"
  // placeholder forever, with no way for the caller to ever know why. Routed through
  // the same cache-and-catch path as the other two panels now.
  const d=await _fetchVrp(false)||{};
  const iv=d.iv, rv=d.rv, vrp=d.vrp;
  if(iv==null && rv==null){
    body.innerHTML=isUpgradeRequired(_vrpErr)?upgradeRequiredHTML('VRP Intelligence',_vrpErr)
      :'<div style="color:var(--muted);font-size:11px">NO DATA — IV/RV not yet computed today</div>';
    if(verdictEl) verdictEl.textContent='';
    return;
  }
   const rc=(vrp!=null?(vrp>2?'RICH':vrp<-2?'CHEAP':'FAIR'):d.rich_cheap)||'—';
  if(verdictEl){
    verdictEl.textContent=rc||'—';
    verdictEl.style.color=rc==='RICH'?'var(--green)':rc==='CHEAP'?'var(--red)':rc==='FAIR'?'var(--gold)':'var(--muted)';
  }
  const vcol=vrp==null?'var(--muted)':(vrp>=0?'var(--green)':'var(--red)');
  // Day-over-day change: real data already in d.history (no fabricated intraday delta —
  // main.py's vrp() only persists one VRP figure per day via the EOD job).
  const hist=d.history||[];
  const prevRow=hist.find(x=>x.date!==d.session_date);
  const chg=(prevRow&&prevRow.vrp!=null&&vrp!=null)?vrp-prevRow.vrp:null;
  body.innerHTML=
    '<div style="width:100%;font-size:9px;color:'+_vrpFreshColor(d.provenance)+';margin-bottom:2px">'+_vrpFreshLabel(d)+'</div>'+
    '<span style="font-size:11px;color:var(--muted)">IV <b style="color:var(--accent)">'+(iv==null?'—':Number(iv).toFixed(2)+'%')+'</b></span>'+
    '<span style="font-size:11px;color:var(--muted)">RV <b style="color:var(--violet)">'+(rv==null?'—':Number(rv).toFixed(2)+'%')+'</b></span>'+
    '<span style="font-size:11px;color:var(--muted)">VRP <b style="color:'+vcol+'">'+(vrp==null?'—':(vrp>=0?'+':'')+Number(vrp).toFixed(2))+'</b></span>'+
    (chg!=null?'<span style="font-size:11px;color:var(--muted)">vs prev <b style="color:'+(chg>=0?'var(--green)':'var(--red)')+'">'+(chg>=0?'+':'')+chg.toFixed(2)+'</b></span>':'');
}
APEX.idle(renderVrpIntel,'renderVrpIntel'); setInterval(renderVrpIntel, 60000);

async function openVrpSheet(){
  var bd=document.getElementById('vrpBackdrop'); if(!bd) return;
  bd.classList.add('open');
  history.pushState({vrpSheet:true},'');
  var cached=await _fetchVrp(false);
  _renderVrpSheetBody(cached);
  var body=document.getElementById('vrpSheetBody'); if(body) body.scrollTop=0;
  var fresh=await _fetchVrp(true);
  if(fresh && bd.classList.contains('open')) _renderVrpSheetBody(fresh);
  if(window._sheetOpened) _sheetOpened('vrpBackdrop');
}
function closeVrpSheet(){ var bd=document.getElementById('vrpBackdrop'); if(bd) bd.classList.remove('open'); if(window._sheetClosed) _sheetClosed('vrpBackdrop'); }
function openVrpIntel(){ openVrpSheet(); }  // compat: old name now opens the sheet, matches Skew/OI UX
function _vrpViewFullPage(){
  closeVrpSheet();
  var el=document.querySelector('.sb-item[data-page="vrp"]');
  if(el) nav('vrp', el);
}
function _renderVrpSheetBody(d){
  var stateEl=document.getElementById('vrp-sheet-state'), subEl=document.getElementById('vrp-sheet-sub'),
      body=document.getElementById('vrpSheetBody');
  if(!body) return;
  if(!d || (d.iv==null && d.rv==null)){
    if(stateEl){stateEl.textContent='NO DATA';stateEl.style.color='var(--muted)';}
    if(subEl) subEl.innerHTML='<span class="dot" style="background:var(--muted)"></span><span>IV/RV not yet computed today</span>';
    body.innerHTML='<div class="rs-empty">No data available.</div>'+
      '<button class="btn ghost" style="width:100%;margin-top:14px" onclick="_vrpViewFullPage()">View page →</button>';
    return;
  }
   var _vrp=d.vrp, rc=(_vrp!=null?(_vrp>2?'RICH':_vrp<-2?'CHEAP':'FAIR'):d.rich_cheap)||'—';
  if(stateEl){ stateEl.textContent=rc||'—'; stateEl.style.color=rc==='RICH'?'var(--green)':rc==='CHEAP'?'var(--red)':rc==='FAIR'?'var(--gold)':'var(--muted)'; }
  if(subEl) subEl.innerHTML='<span class="dot" style="background:'+_vrpFreshColor(d.provenance)+'"></span><span>'+_vrpFreshLabel(d)+'</span>';
  var row=function(label,val,c){ return '<div class="c"><div class="k">'+label+'</div><div class="v num" style="color:'+(c||'var(--text)')+'">'+val+'</div></div>'; };
  var sect=function(title,html){ return '<div style="margin:14px 0 6px;font-size:9px;letter-spacing:1px;color:var(--muted);text-transform:uppercase">'+title+'</div>'+html; };
  var hist=d.history||[];
  var prevRow=hist.find(function(x){return x.date!==d.session_date;});
  /* `_vrp` (bound above) must be used everywhere in this body — bare `vrp` was an
     undefined identifier here and threw ReferenceError, so the sheet's body never
     rendered (reported 2026-08-13, reproduced 10/10). `_vrp` and `prevRow.vrp` are
     the same scale, so the delta and labels stay consistent. */
  var chg=(prevRow&&prevRow.vrp!=null&&_vrp!=null)?_vrp-prevRow.vrp:null;
  var html='';
  html+=sect('Current', '<div class="pos-grid">'+
    row('IV', d.iv==null?'—':Number(d.iv).toFixed(2)+'%')+
    row('RV', d.rv==null?(d.bars?'building… ('+d.bars+' bars)':'building…'):Number(d.rv).toFixed(2)+'%')+
    row('VRP (IV−RV)', _vrp==null?'—':(_vrp>=0?'+':'')+Number(_vrp).toFixed(2), _vrp==null?'var(--muted)':(_vrp>=0?'var(--green)':'var(--red)'))+
    row('Verdict', rc||'—', rc==='RICH'?'var(--green)':rc==='CHEAP'?'var(--red)':'var(--gold)')+
    '</div>');
  html+=sect('Change', '<div class="pos-grid">'+
    row('vs previous session', chg==null?'—':(chg>=0?'+':'')+chg.toFixed(2), chg==null?'var(--muted)':(chg>=0?'var(--green)':'var(--red)'))+
    (prevRow?row('Previous VRP', (prevRow.vrp>=0?'+':'')+Number(prevRow.vrp).toFixed(2)+' ('+prevRow.date+')'):'')+
    '</div>');
  // Percentile: real once the DB has 60+ days (main.py's vrp_percentile), else the
  // SAME provisional heuristic the VRP page itself already shows (overrides.js
  // renderVRP) — reused verbatim, not a second invented formula.
  var pctlReal=d.vrp_percentile!=null;
  var pctl=pctlReal?Number(d.vrp_percentile).toFixed(0)+'th':(_vrp==null?'—':'≈'+(Math.max(5,Math.min(95,50+_vrp*4)))+' (provisional)');
  html+=sect('Historical context', '<div class="pos-grid">'+
    row('Percentile', pctl)+
    row('RV 20d', d.rv_20d==null?'—':Number(d.rv_20d).toFixed(2)+'%')+
    row('RV forecast', d.rv_forecast==null?'—':Number(d.rv_forecast).toFixed(2)+'%')+
    row('Lookback', hist.length+' sessions')+
    '</div>');
  html+=sect('Data coverage', '<div class="pos-grid">'+
    row('Session date', d.session_date||'—')+
    row('Freshness', d.provenance||'unavailable', _vrpFreshColor(d.provenance))+
    row('Sample (today)', (d.bars||0)+' 1-min bars')+
    '</div>');
  html+='<button class="btn ghost" style="width:100%;margin-top:16px" onclick="_vrpViewFullPage()">View page →</button>';
  body.innerHTML=html;
}
_wireVerticalSwipeSheet('vrpBackdrop','vrpPanel',closeVrpSheet);

/* Settlement guide on the Live page.
   TODAY section polls /api/settlement/today (20s / 5s during settlement window).
   CUMULATIVE section reads /api/settlement/cumulative once per session (cached, EOD-built). */
async function renderSettleGuide(){
  const host=document.getElementById('settleGuideCard'); if(!host) return;
  let v={}; try{ v=await jget('/api/settlement/today'); }catch(e){ return; }
  const set=(id,txt,col)=>{const e=document.getElementById(id); if(!e)return;
    e.textContent=txt; if(col!==undefined) e.style.color=col;};
  if(v.vwap_15==null){ set('sg-read','Waiting for enough 1-min bars today.'); return; }
  const sgs=document.getElementById('sg-spot');
  if(sgs && (!sgs.textContent || sgs.textContent==='—')) sgs.textContent=n2(v.spot_now);
  set('sg-15',  n2(v.vwap_15));
  set('sg-30',  n2(v.vwap_30));
  set('sg-day', n2(v.vwap_day));
  window.__sgAvg={a15:v.vwap_15, a30:v.vwap_30, aday:v.vwap_day};
  const dv=(id,x)=>{ if(x==null){ set(id,'—','var(--muted)'); return; }
    set(id,(x>=0?'+':'')+Number(x).toFixed(2), x>=0?'var(--green)':'var(--red)'); };
  const d15 = v.spot_now!=null&&v.vwap_15!=null ? v.spot_now-v.vwap_15 : null;
  const d30 = v.spot_now!=null&&v.vwap_30!=null ? v.spot_now-v.vwap_30 : null;
  const dday= v.spot_now!=null&&v.vwap_day!=null ? v.spot_now-v.vwap_day : null;
  dv('sg-d15',d15); dv('sg-d30',d30); dv('sg-dday',dday);
  const parts=[];
  if(d30!=null){
    const dir = d30>0 ? 'above' : 'below';
    parts.push(`Spot is <b style="color:${d30>0?'var(--green)':'var(--red)'}">`+
      `${Math.abs(d30).toFixed(1)} pts ${dir}</b> the 30-min average — `+
      (d30>0 ? 'settlement would print BELOW spot' : 'settlement would print ABOVE spot')+
      ' if the average holds.');
  }
  if(v.stack) parts.push(`Average stack <b>${v.stack}</b>.`);
  if(v.best_estimator) parts.push(`Closest to spot: <b>${String(v.best_estimator).replace('vwap_','')}</b>.`);
  const te=v.today_estimators||{};
  if(te.forecast&&te.forecast.vwap_30!=null){
    parts.push(`Today's 30m est: <b>${te.forecast.vwap_30.toFixed(1)}</b>`+
      ` (hindsight: ${te.hindsight.vwap_30?te.hindsight.vwap_30.toFixed(1):'—'} pts).`);
  }
  set('sg-read',''); const r=document.getElementById('sg-read');
  if(r) r.innerHTML = parts.join(' ') || '—';
}
/* CUMULATIVE rankings — reads from EOD-persisted settlement_cumulative table.
   Cached 5 min server-side; fetched once per session client-side. */
async function renderSettleRank(){
  const tb=document.getElementById('sg-rank'); if(!tb) return;
  /* Never leave the panel on "loading". The old code did `return` when BOTH endpoints
     failed, so the table kept its initial loading markup forever and the failure was
     invisible — indistinguishable from a slow request. Show what actually went wrong. */
  let r={}, _err=null;
  try{ r=await jget('/api/settlement/cumulative'); }
  catch(e){
    try{ r=await jget('/api/settlement/lab'); }
    catch(e2){ _err = (e && e.message) || String(e); }
  }
  const cmp=document.getElementById('sg-cmp');
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const nm=s=>esc(String(s||'').replace('vwap_','').toUpperCase());
  const setTxt=(id,t)=>{const e=document.getElementById(id); if(e) e.textContent=t;};
  const fail=msg=>{
    tb.innerHTML='<div class="est-empty" style="color:var(--warn)">'+esc(msg)+'</div>';
    if(cmp) cmp.innerHTML='<tr><td colspan="7" class="est-empty">—</td></tr>';
    setTxt('sg-best-name','Unavailable');
  };
  if(_err!=null){
    fail('Cumulative rankings unavailable — /api/settlement/cumulative returned an error ('
      +_err+'). These rankings are built at EOD; if this persists, check the server log.');
    return;
  }
  if(r && r.error){ fail('Cumulative rankings error: '+String(r.error).slice(0,160)); return; }

  const v=document.getElementById('sg-verdict');
  if(v && r.verdict){
    v.innerHTML=esc(r.verdict.text).replace(/\*\*(.+?)\*\*/g,'<b style="color:var(--accent)">$1</b>');
    v.style.color = r.verdict.ready ? 'var(--text)' : 'var(--warn)';
  }
  const badge=document.getElementById('sg-best-badge');
  const rows=(r.forecast)||[];
  if(!rows.length){
    tb.innerHTML='<div class="est-empty">No expiry sessions persisted yet. Runs at EOD.</div>';
    if(cmp) cmp.innerHTML='<tr><td colspan="7" class="est-empty">No sessions yet</td></tr>';
    if(badge) badge.hidden=true;
    setTxt('sg-best-name','Pending'); setTxt('sg-best-acc','—');
    setTxt('sg-best-rmse','—'); setTxt('sg-best-upd','Awaiting first EOD');
    return;
  }

  const best=rows[0];
  const maxMAE=Math.max(...rows.map(x=>x.mae),1);
  const biasHi=x=>Math.abs(x.bias)>0.6*x.mae;

  /* ── SUMMARY CARD ── five facts, all already in this payload. "Accuracy" is the
     best estimator's win_pct — the share of sessions it was nearest to settlement.
     No new calculation, no new endpoint: the same number the table has always shown. */
  if(badge){ badge.hidden=false; badge.textContent='RANK 1'; }
  setTxt('sg-best-name', nm(best.estimator));
  setTxt('sg-best-acc', (best.win_pct!=null? best.win_pct+'%' : '—'));
  setTxt('sg-best-rmse', (best.rmse!=null? best.rmse.toFixed(1) : '—'));
  setTxt('sg-best-upd', r.last_updated || r.as_of || r.date ||
        (best.n!=null? best.n+' sessions' : '—'));

  /* ── CHIPS ── */
  const chips=document.getElementById('est-chips');
  if(chips){
    const c=[];
    if(best.n!=null) c.push('n = '+best.n+' sessions');
    if(r.today_session && r.today_session.fc_best)
      c.push('Today: '+nm(r.today_session.fc_best));
    c.push(rows.length+' estimators compared');
    if(r.verdict && r.verdict.ready===false) c.push('Provisional');
    chips.innerHTML=c.map(x=>'<span class="est-chip">'+esc(x)+'</span>').join('');
  }

  /* ── RANKINGS ── grid rows. The MAE bar is its OWN grid track, so it can never
     draw over the label and the label can never be clipped by it. */
  tb.innerHTML=rows.map((x,i)=>{
    const isBest=i===0, warn=!isBest&&biasHi(x);
    const barW=Math.max(2,Math.round(x.mae/maxMAE*100));
    return '<div class="est-row'+(isBest?' is-best':'')+(warn?' is-warn':'')+'">'
      +'<div class="est-row-rank">'+(i+1)+'</div>'
      +'<div class="est-row-name">'+nm(x.estimator)+'</div>'
      +'<div class="est-bar-wrap"><div class="est-bar" style="width:'+barW+'%"></div></div>'
      +'<div class="est-row-val">'+x.mae.toFixed(1)+'</div>'
      +'<div class="est-row-sub">'
        +'<span>MAE '+x.mae.toFixed(1)+'</span>'
        +'<span>RMSE '+x.rmse.toFixed(1)+'</span>'
        +'<span>Bias '+(x.bias>=0?'+':'')+x.bias.toFixed(1)+'</span>'
        +'<span>Win '+x.win_pct+'%</span>'
        +'<span>n '+x.n+'</span>'
      +'</div></div>';
  }).join('');

  /* ── COMPARISON TABLE ── */
  if(cmp){
    cmp.innerHTML=rows.map((x,i)=>{
      const isBest=i===0, warn=biasHi(x);
      return '<tr class="'+(isBest?'is-best':'')+'">'
        +'<td class="c-rank" style="color:'+(isBest?'var(--accent)':'var(--muted)')+'">'+(i+1)+'</td>'
        +'<td class="c-name" style="color:'+(isBest?'var(--accent)':'var(--text)')+';font-weight:'+(isBest?'700':'400')+'">'+nm(x.estimator)+'</td>'
        +'<td class="c-num">'+x.mae.toFixed(1)+'</td>'
        +'<td class="c-num">'+x.rmse.toFixed(1)+'</td>'
        +'<td class="c-num" style="color:'+(warn?'var(--warn)':x.bias>0?'var(--green)':'var(--red)')+'">'+(x.bias>=0?'+':'')+x.bias.toFixed(1)+'</td>'
        +'<td class="c-num" style="color:'+(x.win_pct>=50?'var(--green)':'var(--muted)')+'">'+x.win_pct+'%</td>'
        +'<td class="c-num" style="color:var(--muted)">'+x.n+'</td>'
        +'</tr>';
    }).join('');
  }

  /* ── HISTORICAL / TREND ── from the same payload; no extra request. */
  const hist=document.getElementById('sg-hist');
  if(hist){
    const h=[
      ['Sessions measured', best.n!=null? best.n : '—'],
      ['Best MAE', best.mae.toFixed(1)+' pts'],
      ['Best RMSE', best.rmse.toFixed(1)+' pts'],
      ['Best bias', (best.bias>=0?'+':'')+best.bias.toFixed(1)+' pts'],
      ['Spread (worst−best MAE)', (rows[rows.length-1].mae-best.mae).toFixed(1)+' pts'],
      ['Confidence', (best.n>=30?'ESTABLISHED':best.n>=12?'EMERGING':'PROVISIONAL')]
    ];
    hist.innerHTML=h.map(([k,val])=>'<div class="est-hist-cell"><div class="est-k">'
      +esc(k)+'</div><div class="est-v num">'+esc(val)+'</div></div>').join('');
  }

  const c=document.getElementById('sg-caveat');
  if(c) c.textContent=[r.method_note, r.truth_caveat].filter(Boolean).join(' ');
}

/* ── Estimator sheet open/close. Uses the existing overlay conventions: Escape to
   close, scrim click to close, focus returned to the card, body scroll locked while
   open so the sheet does not scroll the page behind it on iOS. */
(function(){
  const sheet=document.getElementById('estimatorSheet');
  const card=document.getElementById('sg-est-card');
  if(!sheet||!card) return;
  let lastFocus=null;
  const open=()=>{
    lastFocus=document.activeElement;
    sheet.hidden=false;
    document.body.style.overflow='hidden';
    const cl=sheet.querySelector('.est-close'); if(cl) cl.focus();
  };
  const close=()=>{
    sheet.hidden=true;
    document.body.style.overflow='';
    if(lastFocus&&lastFocus.focus) lastFocus.focus();
  };
  card.addEventListener('click',open);
  card.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '){ e.preventDefault(); open(); }
  });
  sheet.addEventListener('click',e=>{ if(e.target.closest('[data-est-close]')) close(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&!sheet.hidden) close(); });
})();
APEX.idle(renderSettleGuide,'renderSettleGuide'); APEX.idle(renderSettleRank,'renderSettleRank');   // deferred to an idle slice: below the fold at boot, and nav() re-renders it on demand
(function(){
  // 20s normally, 5s from 15:00 - the window where the settlement average is forming
  let fast=null, slow=setInterval(renderSettleGuide, 20000);
  // Cumulative rankings: retry every 5 min until data arrives (it's built EOD, may not exist early)
  setInterval(function(){
    const el=document.getElementById('sg-rank');
    if(el && el.querySelector('td[colspan]')) renderSettleRank();
  }, 300000);
  setInterval(function(){
    const h=new Date().getHours(), m=new Date().getMinutes();
    const inWin = (h===15) || (h===14 && m>=55);
    if(inWin && !fast){ fast=setInterval(renderSettleGuide, 5000); }
    if(!inWin && fast){ clearInterval(fast); fast=null; }
  }, 30000);
})();
// The always-visible health footer (feed/db/risk internals) was removed from the
// user-facing frontend (2026-08-08) — it exposed internal infrastructure status
// (raw DB size, internal gate names) with no customer value. /api/status itself is
// untouched: it is real backend infrastructure, still served, still consumed by the
// Settings > System Health dev panel (straddleedge.html, .dev-only, opt-in).

/* ── APEX Corporate Actions — INTERNAL page (2026-08-12) ────────────────────────
   BUG FIXED: the Products card did `location.href='/corporate-actions'`, a full
   document navigation OUT of the SPA into the standalone dashboard/corporate_actions.html
   document. In a browser that merely loses the APEX shell; inside the installed
   PWA / Capacitor WebView it is a dead end — the app shell, sidebar, clock and
   theme are gone, and the standalone page's only way back was history.back(),
   which in a WebView opened with no prior entry does nothing at all.

   FIX: render the same events inside the EXISTING SPA page architecture — a
   `.page` div switched by the existing nav(), so the shell/header/clock/theme/
   mobile layout are the app's own, not a second copy.

   NOT a second data owner: this reads the exact same corporate_actions API the
   standalone page reads (/api/corporate-actions/upcoming, /api/corporate-actions),
   with the same fallback order and the same four summary figures. No new
   endpoint, no new table, no changed business logic. The standalone
   /corporate-actions route is deliberately left in place and untouched —
   mcwm_calendar.html still links to it, and deleting a served route is outside
   this fix's scope.

   Reads go through jget (the app's shared fetch helper) at a 5-minute TTL, which
   is the same refresh cadence the standalone page used (setInterval(load,300000)),
   but demand-driven: no background poller running on every other page. */
var _caEvents = [], _caAll = null, _caError = null;
var _caReturnPage = 'live', _caPushedState = false;

/* Entry point from the Products card. Records where the user came FROM so Back
   returns there (previous page state is preserved because SPA pages are only
   hidden, never destroyed), then pushes one history entry so device/browser Back
   is caught by the popstate handler below — the same pattern the OI/Skew/VRP
   sheets already use. */
function openCorpActions(){
  var cur = document.querySelector('.page.on');
  if(cur && cur.id && cur.id.indexOf('page-') === 0) _caReturnPage = cur.id.slice(5);
  // nav() marks its second argument as the active nav item. A detached element is
  // passed deliberately: Corporate Actions has no sidebar row of its own, and this
  // way nav() cannot leave a stray .on class on the Products card that opened it.
  nav('corpactions', document.createElement('div'));
  try{
    if(window.history && window.history.pushState){
      window.history.pushState({caPage:true}, '');
      _caPushedState = true;
    }
  }catch(e){ _caPushedState = false; }
}

/* The visible ← Back button. Prefers history.back() so the entry this page pushed
   is consumed rather than orphaned (otherwise the NEXT device-back would land on
   a stale entry); popstate then performs the actual page switch. */
function corpActionsBack(){
  if(_caPushedState){ _caPushedState = false; try{ history.back(); return; }catch(e){} }
  _caGoBack();
}
function _caGoBack(){
  var side = document.querySelector('.sb-item[data-page="' + _caReturnPage + '"]');
  if(side){ nav(_caReturnPage, side); return; }
  var live = document.querySelector('.sb-item[data-page="live"]');
  if(live) nav('live', live);
}
/* Device / browser / Android back. Only acts while Corporate Actions is the page
   on screen, so it cannot interfere with the sidebar and sheet popstate handlers
   that already exist. */
window.addEventListener('popstate', function(){
  var p = document.getElementById('page-corpactions');
  if(p && p.classList.contains('on')){ _caPushedState = false; _caGoBack(); }
});

/* Fetch + summary. Same call order as the standalone page: upcoming first, and
   only if that is empty fall back to the unfiltered list. A failed fetch is
   reported as a FAILURE, never rendered as "no corporate actions" — an empty
   result and an unreachable API are different facts and must not look alike. */
async function renderCorpActions(){
  var host = document.getElementById('caList'); if(!host) return;
  host.innerHTML = '<div class="ca-empty">Loading corporate actions…</div>';
  _caError = null;
  try{
    _caEvents = await jget('/api/corporate-actions/upcoming?limit=300', 300000) || [];
    if(!_caEvents.length) _caEvents = await jget('/api/corporate-actions?limit=300', 300000) || [];
  }catch(e){
    _caError = 'Could not reach the Corporate Actions service.';
    _caEvents = [];
  }
  try{
    _caAll = await jget('/api/corporate-actions?limit=10000', 300000) || [];
  }catch(e){ _caAll = null; }
  var today = new Date().toISOString().slice(0,10);
  var set = function(id,v){ var el=document.getElementById(id); if(el) el.textContent=v; };
  if(_caAll){
    set('caTotal', _caAll.length);
    set('caToday', _caAll.filter(function(e){ return e.event_date===today; }).length);
    set('caUpcoming', _caAll.filter(function(e){ return e.event_date>=today; }).length);
    var syms={}; _caAll.forEach(function(e){ if(e.symbol) syms[e.symbol]=1; });
    set('caCompanies', Object.keys(syms).length);
  }else{
    // Not measured — say so rather than showing 0, which reads as a real count.
    set('caTotal','—'); set('caToday','—'); set('caUpcoming','—'); set('caCompanies','—');
  }
  renderCorpActionsList();
}

/* Client-side filtering only — identical filter semantics to the standalone page
   (view window, free-text on symbol/company, type, status). No refetch per
   keystroke. */
function renderCorpActionsList(){
  var host = document.getElementById('caList'); if(!host) return;
  var cnt = document.getElementById('caCount');
  if(_caError){
    host.innerHTML = '<div class="ca-empty" style="color:var(--gold)">' + _caError +
      ' <span style="color:var(--muted)">This is a load failure, not an empty calendar.</span></div>';
    if(cnt) cnt.textContent = 'UNAVAILABLE';
    return;
  }
  var today = new Date().toISOString().slice(0,10);
  var val = function(id){ var el=document.getElementById(id); return el ? el.value : ''; };
  var rows = _caEvents.slice();
  var view = val('caView');
  if(view === 'today') rows = rows.filter(function(e){ return e.event_date===today; });
  else if(view === 'upcoming') rows = rows.filter(function(e){ return e.event_date>=today; });
  var q = (val('caSearch')||'').toLowerCase();
  if(q) rows = rows.filter(function(e){
    return (e.symbol||'').toLowerCase().indexOf(q)>=0 || (e.company_name||'').toLowerCase().indexOf(q)>=0; });
  var tp = val('caType'); if(tp) rows = rows.filter(function(e){ return e.event_type===tp; });
  var st = val('caStatus'); if(st) rows = rows.filter(function(e){ return e.status===st; });
  if(cnt) cnt.textContent = rows.length + (rows.length===1?' event':' events');
  if(!rows.length){ host.innerHTML = '<div class="ca-empty">No corporate actions match these filters</div>'; return; }
  var SHORT = {DIVIDEND:'DIV',BONUS:'BON',SPLIT:'SPL',RIGHTS:'RGT',BUYBACK:'BBK',
               BOARD_MEETING:'BOD',MERGER:'M&A',RESULTS:'RES',AGM:'AGM',EGM:'EGM'};
  var esc = function(s){ return String(s==null?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
  host.innerHTML = rows.map(function(e){
    var id = esc(e.event_id), isToday = e.event_date===today;
    var short = SHORT[e.event_type] || String(e.event_type||'').slice(0,4);
    return '<div class="ca-row' + (isToday?' today':'') + '" onclick="caToggleDetail(\'' + id + '\')">' +
        '<span class="ca-date">' + esc(e.event_date) + '</span>' +
        '<span class="ca-sym">' + esc(e.symbol) + '</span>' +
        '<div class="ca-info"><div class="ca-title">' + esc(e.title) + '</div>' +
          '<div class="ca-sub">' + esc(e.company_name) + (e.purpose||e.description ? ' · ' + esc(e.purpose||e.description) : '') + '</div></div>' +
        '<span class="ca-type type-' + esc(e.event_type) + '">' + esc(short) + '</span>' +
        (e.ex_date && e.ex_date!==e.event_date ? '<span class="ca-ex">Ex ' + esc(String(e.ex_date).slice(5)) + '</span>' : '') +
      '</div>' +
      '<div class="ca-detail" id="ca-dt-' + id + '">' +
        '<div class="ca-d-row">' +
          '<div class="ca-d-item"><div class="ca-d-label">Company</div><div class="ca-d-val">' + esc(e.company_name) + '</div></div>' +
          '<div class="ca-d-item"><div class="ca-d-label">Symbol</div><div class="ca-d-val">' + esc(e.symbol) + '</div></div>' +
          '<div class="ca-d-item"><div class="ca-d-label">ISIN</div><div class="ca-d-val">' + esc(e.isin||'—') + '</div></div>' +
          '<div class="ca-d-item"><div class="ca-d-label">Status</div><div class="ca-d-val">' + esc(e.status) + '</div></div>' +
        '</div>' +
        (e.record_date ? '<div class="ca-d-row">' +
          '<div class="ca-d-item"><div class="ca-d-label">Record Date</div><div class="ca-d-val">' + esc(e.record_date) + '</div></div>' +
          (e.ex_date ? '<div class="ca-d-item"><div class="ca-d-label">Ex-Date</div><div class="ca-d-val" style="color:var(--orange)">' + esc(e.ex_date) + '</div></div>' : '') +
          (e.ratio ? '<div class="ca-d-item"><div class="ca-d-label">Ratio</div><div class="ca-d-val">' + esc(e.ratio) + '</div></div>' : '') +
          (e.dividend_per_share ? '<div class="ca-d-item"><div class="ca-d-label">DPS</div><div class="ca-d-val">&#8377;' + esc(e.dividend_per_share) + '</div></div>' : '') +
        '</div>' : '') +
        (e.detail||e.description ? '<div class="ca-d-note">' + esc(e.detail||e.description) + '</div>' : '') +
        '<div class="ca-d-src">Source: ' + esc(e.source) + (e.source_timestamp ? ' · Updated: ' + esc(e.source_timestamp) : '') + '</div>' +
      '</div>';
  }).join('');
}

/* Inline expander, not a sheet — so there is no overlay for Back to close first;
   Back always means "leave the page", which is what the requirement asks for when
   no sheet is open. */
function caToggleDetail(id){
  var el = document.getElementById('ca-dt-' + id);
  if(el) el.classList.toggle('open');
}

/* ══════════════════════════════════════════════════════════════════════════════
   MCWM CALENDAR — in-SPA page (2026-08-16)

   Was dashboard/mcwm_calendar.html, a standalone document opened via
   window.open('/calendar','_blank'). Inside the installed PWA/WebView that leaves
   the app shell and dead-ends with no way back — the same defect the Corporate
   Actions page above was built to fix, so this reuses that pattern exactly rather
   than adding a second navigation model.

   Data owner is unchanged: /api/calendar/events, the same endpoint the standalone
   page reads. This is a second VIEW, never a second source of truth.

   The standalone page's honest-cache behaviour (Layer 1.3, ISS-2026-08-15-09) is
   preserved verbatim: on fetch failure fall back to the last cached events and say
   so, with age — never silently blank, never stale-data-labelled-live.
   ══════════════════════════════════════════════════════════════════════════════ */
var _mcEvents = [], _mcQuick = 'all', _mcError = null;
var _mcIsCached = false, _mcCachedAt = null;
var _mcReturnPage = 'live', _mcPushedState = false;
var _mcCdTimer = null;
var MC_CACHE_KEY = 'mcwm_calendar_cache';   // same key the standalone page used

function openMcwmCal(){
  var cur = document.querySelector('.page.on');
  if(cur && cur.id && cur.id.indexOf('page-') === 0) _mcReturnPage = cur.id.slice(5);
  // Detached element for the same reason openCorpActions passes one: this page has
  // no sidebar row, so nav() must not leave a stray .on class on whatever opened it.
  nav('mcwmcal', document.createElement('div'));
  try{
    if(window.history && window.history.pushState){
      window.history.pushState({mcPage:true}, '');
      _mcPushedState = true;
    }
  }catch(e){ _mcPushedState = false; }
}

function mcwmCalBack(){
  if(_mcPushedState){ _mcPushedState = false; try{ history.back(); return; }catch(e){} }
  _mcGoBack();
}
function _mcGoBack(){
  var side = document.querySelector('.sb-item[data-page="' + _mcReturnPage + '"]');
  if(side){ nav(_mcReturnPage, side); return; }
  var live = document.querySelector('.sb-item[data-page="live"]');
  if(live) nav('live', live);
}
window.addEventListener('popstate', function(){
  var p = document.getElementById('page-mcwmcal');
  if(p && p.classList.contains('on')){ _mcPushedState = false; _mcGoBack(); }
});

async function renderMcwmCal(){
  var host = document.getElementById('mcList'); if(!host) return;
  host.innerHTML = '<div class="mc-empty">Loading calendar…</div>';
  _mcError = null;
  try{
    // from_date=today (2026-08-18 fix): this used to fetch with NO date floor, so
    // every past event the calendar has ever seen came back too. Object.keys(days)
    // sorts date strings ascending, so the OLDEST day in that unfiltered set —
    // sometimes weeks in the past — rendered first, pushing today/upcoming off the
    // top. Scoping the fetch to today-forward makes "today is the first day shown"
    // true by construction rather than by sort-order luck, and halves the payload.
    var _mcToday = new Date().toISOString().slice(0,10);
    _mcEvents = await jget('/api/calendar/events?from_date='+_mcToday+'&limit=500', 120000) || [];
    _mcIsCached = false; _mcCachedAt = null;
    try{ localStorage.setItem(MC_CACHE_KEY, JSON.stringify({events:_mcEvents, ts:Date.now()})); }catch(e){}
  }catch(e){
    // Fetch failed: fall back to the last known real events, labelled as cached with
    // its true age. An unreachable API and an empty calendar are different facts and
    // must never look alike (Layer 1.3).
    var cached = null;
    try{ cached = JSON.parse(localStorage.getItem(MC_CACHE_KEY)||'null'); }catch(e2){}
    if(cached && cached.events && cached.events.length){
      _mcEvents = cached.events; _mcIsCached = true; _mcCachedAt = cached.ts;
    }else{
      _mcEvents = []; _mcIsCached = false;
      _mcError = 'Could not reach the calendar service.';
    }
  }
  var today = new Date().toISOString().slice(0,10);
  var set = function(id,v){ var el=document.getElementById(id); if(el) el.textContent=v; };
  if(_mcEvents.length){
    set('mcTotal', _mcEvents.length);
    set('mcToday', _mcEvents.filter(function(e){ return e.event_date===today; }).length);
    set('mcHigh',  _mcEvents.filter(function(e){ return e.impact==='HIGH'; }).length);
    var cs={}; _mcEvents.forEach(function(e){ if(e.country) cs[e.country]=1; });
    set('mcCountries', Object.keys(cs).length);
  }else{
    // Not measured — "—", never 0, which would read as a real counted zero.
    set('mcTotal','—'); set('mcToday','—'); set('mcHigh','—'); set('mcCountries','—');
  }
  var note = document.getElementById('mcCachedNote');
  if(note){
    if(_mcIsCached){
      var mins = Math.max(0, Math.round((Date.now()-_mcCachedAt)/60000));
      note.style.display='block';
      note.textContent = '⚠ Cached — server unreachable. Showing last known events from '
        + new Date(_mcCachedAt).toLocaleTimeString() + ' (' + mins + 'm ago).';
    }else{
      note.style.display='none'; note.textContent='';
    }
  }
  renderMcwmCalList();
  if(_mcCdTimer) clearInterval(_mcCdTimer);
  _mcCdTimer = setInterval(mcTickCountdowns, 15000);
}

function mcSetQuick(q){
  _mcQuick = q;
  var btns = document.querySelectorAll('#mcQuick button');
  for(var i=0;i<btns.length;i++) btns[i].classList.toggle('on', btns[i].getAttribute('data-q')===q);
  renderMcwmCalList();
}

function _mcCountdown(dt, tm){
  var t = new Date(dt+'T'+(tm||'00:00:00')+'+05:30'), diff = t - Date.now();
  if(diff<=0) return {t:'NOW', live:true};
  var d=Math.floor(diff/864e5), h=Math.floor((diff%864e5)/36e5), m=Math.floor((diff%36e5)/6e4);
  if(d>0) return {t:d+'d '+h+'h', live:false};
  if(h>0) return {t:h+'h '+m+'m', live:false};
  return {t:m+'m', live:false};
}

function renderMcwmCalList(){
  var host = document.getElementById('mcList'); if(!host) return;
  var cnt = document.getElementById('mcCount');
  if(_mcError){
    host.innerHTML = '<div class="mc-empty" style="color:var(--gold)">' + _mcError +
      ' <span style="color:var(--muted)">This is a load failure, not an empty calendar.</span></div>';
    if(cnt) cnt.textContent = 'UNAVAILABLE';
    return;
  }
  var today = new Date().toISOString().slice(0,10);
  var tomorrow = new Date(Date.now()+864e5).toISOString().slice(0,10);
  var val = function(id){ var el=document.getElementById(id); return el ? el.value : ''; };
  var rows = _mcEvents.slice();

  if(_mcQuick==='today') rows = rows.filter(function(e){ return e.event_date===today; });
  else if(_mcQuick==='tomorrow') rows = rows.filter(function(e){ return e.event_date===tomorrow; });
  else if(_mcQuick==='week'){
    var d=new Date(), dow=d.getDay();
    var mon=new Date(d.getFullYear(), d.getMonth(), d.getDate()-dow+(dow===0?-6:1));
    var sun=new Date(+mon+6*864e5);
    var ms=mon.toISOString().slice(0,10), ss=sun.toISOString().slice(0,10);
    rows = rows.filter(function(e){ return e.event_date>=ms && e.event_date<=ss; });
  }
  else if(_mcQuick==='high') rows = rows.filter(function(e){ return e.impact==='HIGH'; });
  else if(_mcQuick==='expiry') rows = rows.filter(function(e){ return e.category==='EXPIRY'; });
  else if(_mcQuick==='cb') rows = rows.filter(function(e){ return e.category==='MONETARY_POLICY'; });
  else if(_mcQuick==='india') rows = rows.filter(function(e){ return e.country==='IN' || e.india_relevance; });
  else if(_mcQuick==='us') rows = rows.filter(function(e){ return e.country==='US'; });

  var q = (val('mcSearch')||'').toLowerCase();
  if(q) rows = rows.filter(function(e){
    return [e.title,e.description,e.symbol,e.institution,e.country].some(function(f){
      return f && String(f).toLowerCase().indexOf(q)>=0; }); });
  var ct = val('mcCountry'); if(ct) rows = rows.filter(function(e){ return e.country===ct; });
  var im = val('mcImpact');  if(im) rows = rows.filter(function(e){ return e.impact===im; });
  var cg = val('mcCat');     if(cg) rows = rows.filter(function(e){ return e.category===cg; });

  if(cnt) cnt.textContent = rows.length + (rows.length===1?' event':' events');
  if(!rows.length){ host.innerHTML = '<div class="mc-empty">No events match these filters</div>'; return; }

  var FLAGS = {IN:'🇮🇳',US:'🇺🇸',EU:'🇪🇺',
               JP:'🇯🇵',CN:'🇨🇳',GB:'🇬🇧'};
  var BADGE = {EXPIRY:['EXP','#E8843A'],MARKET_HOLIDAY:['HLD','#E8B830'],MONETARY_POLICY:['CB','#8A6FEE'],
               ECONOMIC_DATA:['ECO','#1AB8A8'],INDEX_REVIEW:['IDX','#E86290']};
  var DN=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  // Every interpolated field below is server data rendered into innerHTML — escape
  // all of it. The standalone page interpolated e.title/e.description/e.institution
  // raw; that risk does not get carried into the SPA shell.
  var esc = function(s){ return String(s==null?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };

  var days = {};
  rows.forEach(function(e){ var d=e.event_date||''; if(!days[d]) days[d]=[]; days[d].push(e); });

  host.innerHTML = Object.keys(days).sort().map(function(dt){
    var d = new Date(dt+'T00:00:00+05:30');
    var isToday = dt===today, isPast = dt<today;
    var head = '<div class="mc-daysec"><div class="mc-dayhd">' +
      '<span class="d">' + DN[d.getDay()] + '</span>' +
      '<span class="ds">' + d.getDate() + ' ' + MN[d.getMonth()] + ' ' + d.getFullYear() + '</span>' +
      (isToday ? '<span class="tg tg-today">Today</span>'
               : isPast ? '<span class="tg tg-past">Past</span>' : '') +
      '</div>';
    var body = days[dt].map(function(e){
      var id = esc(e.event_id);
      var c = _mcCountdown(e.event_date, e.event_time);
      var b = BADGE[e.category] || ['', ''];
      return '<div class="mc-row' + (isToday?' today':'') + '" onclick="mcToggleDetail(\'' + id + '\')">' +
          '<span class="mc-time">' + esc(e.event_time||'') + '</span>' +
          '<span class="mc-flag">' + (FLAGS[e.country]||esc(e.country||'')) + '</span>' +
          '<div class="mc-main"><div class="mc-title">' +
            (b[0] ? '<span class="mc-badge" style="background:' + b[1] + '">' + b[0] + '</span>' : '') +
            esc(e.title) + '</div>' +
            '<div class="mc-sub">' + esc(e.institution||'') +
              (e.country ? ' · ' + esc(e.country) : '') + '</div></div>' +
          '<span class="mc-imp ' + esc(e.impact||'LOW') + '">' + esc(e.impact||'') + '</span>' +
          '<span class="mc-cd' + (c.live?' now':'') + '" id="mc-cd-' + id + '">' + c.t + '</span>' +
        '</div>' +
        '<div class="mc-detail" id="mc-dt-' + id + '">' +
          '<div class="mc-d-row">' +
            '<div class="mc-d-item"><div class="mc-d-label">Institution</div><div class="mc-d-val">' + esc(e.institution||'—') + '</div></div>' +
            '<div class="mc-d-item"><div class="mc-d-label">Category</div><div class="mc-d-val">' + esc(String(e.category||'').replace(/_/g,' ')) + '</div></div>' +
            '<div class="mc-d-item"><div class="mc-d-label">Country</div><div class="mc-d-val">' + (FLAGS[e.country]||'') + ' ' + esc(e.country||'—') + '</div></div>' +
            '<div class="mc-d-item"><div class="mc-d-label">Status</div><div class="mc-d-val">' + esc(e.status||'—') + '</div></div>' +
          '</div>' +
          '<div class="mc-d-row">' +
            '<div class="mc-d-item"><div class="mc-d-label">Date</div><div class="mc-d-val">' + esc(e.event_date) + ' ' + esc(e.event_time||'') + '</div></div>' +
            '<div class="mc-d-item"><div class="mc-d-label">Impact</div><div class="mc-d-val">' + esc(e.impact||'—') + '</div></div>' +
            '<div class="mc-d-item"><div class="mc-d-label">India Relevance</div><div class="mc-d-val">' + (e.india_relevance?'Yes':'No') + '</div></div>' +
          '</div>' +
          ((e.forecast||e.previous||e.actual) ? '<div class="mc-d-row">' +
            '<div class="mc-d-item"><div class="mc-d-label">Forecast</div><div class="mc-d-val">' + esc(e.forecast||'—') + '</div></div>' +
            '<div class="mc-d-item"><div class="mc-d-label">Previous</div><div class="mc-d-val">' + esc(e.previous||'—') + '</div></div>' +
            '<div class="mc-d-item"><div class="mc-d-label">Actual</div><div class="mc-d-val">' + esc(e.actual||'Pending') + '</div></div>' +
          '</div>' : '') +
          (e.description ? '<div class="mc-d-note">' + esc(e.description) + '</div>' : '') +
          (e.source ? '<div class="mc-d-src">Source: ' + esc(e.source) + '</div>' : '') +
        '</div>';
    }).join('');
    return head + body + '</div>';
  }).join('');
}

function mcToggleDetail(id){
  var el = document.getElementById('mc-dt-' + id);
  if(el) el.classList.toggle('open');
}

/* Countdowns tick only while the page is actually on screen — a background timer
   mutating a hidden page is wasted work (and the interval is cleared on the next
   renderMcwmCal anyway, so it can never stack up). */
function mcTickCountdowns(){
  var p = document.getElementById('page-mcwmcal');
  if(!p || !p.classList.contains('on')){
    if(_mcCdTimer){ clearInterval(_mcCdTimer); _mcCdTimer = null; }
    return;
  }
  _mcEvents.forEach(function(e){
    var el = document.getElementById('mc-cd-' + e.event_id);
    if(!el) return;
    var c = _mcCountdown(e.event_date, e.event_time);
    el.textContent = c.t;
    el.classList.toggle('now', c.live);
  });
}
