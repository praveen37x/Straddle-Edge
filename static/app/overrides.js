
/* ===== APEX overrides: emergency buzzer + LIVE VRP (v2 math, per-minute) ===== */
function beepRaw(f,d,w){try{_actx=_actx||new (window.AudioContext||window.webkitAudioContext)();
  const o=_actx.createOscillator(),g=_actx.createGain();o.connect(g);g.connect(_actx.destination);
  o.frequency.value=f;o.type=w||'square';g.gain.setValueAtTime(.6,_actx.currentTime);
  g.gain.exponentialRampToValueAtTime(.001,_actx.currentTime+(d||.3));
  o.start();o.stop(_actx.currentTime+(d||.3));}catch(e){}}
function beep(type){ if(typeof SOUND!=='undefined'&&!SOUND)return;
  try{_actx=_actx||new (window.AudioContext||window.webkitAudioContext)();_actx.resume();}catch(e){}
  if(type==='sl'){ for(let i=0;i<10;i++){ setTimeout(()=>beepRaw(i%2?988:622,.22,'square'),i*230);} navigator.vibrate&&navigator.vibrate([300,100,300,100,300]); }
  else if(type==='target'){ [523,659,784].forEach((f,i)=>setTimeout(()=>beepRaw(f,.18,'sine'),i*170)); }
  else beepRaw(740,.2,'sine'); }
renderVRP = async function(){
  try{
    const d = await jget('/api/vrp').catch(()=>({}));
    const set=(id,v)=>{const e=document.getElementById(id); if(!e)return;if(v===null||v==='—'){e.innerHTML='<span title="data not yet available — WebSocket feed pending" style="cursor:help;color:var(--muted)">—</span>';return;}e.textContent=v;};
    const iv = d.iv==null?null:Number(d.iv), rv = d.rv==null?null:Number(d.rv);
    const vrp = d.vrp==null?null:Number(d.vrp);
    set('vrp-iv', iv==null?'—':iv.toFixed(2)+'%');
    set('vrp-rv', rv==null?(d.bars?`building… (${d.bars} bars)`:'building…'):rv.toFixed(2)+'%');
    set('vrp-spread', vrp==null?'—':((vrp>=0?'+':'')+vrp.toFixed(2)+' pts'));
    set('vrp-val', vrp==null?'—':((vrp>=0?'+':'')+vrp.toFixed(2)));
    const rc = (vrp!=null?(vrp>2?'RICH':vrp<-2?'CHEAP':'FAIR'):d.rich_cheap)||'—';
    const rg=document.getElementById('vrp-regime');
    if(rg){ rg.textContent = rc||'—';
      rg.style.color = rc==='RICH'?'var(--green)':rc==='CHEAP'?'var(--red)':'var(--gold)'; }
    if(d.expected_move_1sigma!=null) set('vrp-em1','±'+Math.round(d.expected_move_1sigma));
    if(d.expected_move_2sigma!=null) set('vrp-em2','±'+Math.round(d.expected_move_2sigma));
    if(d.straddle_premium!=null) set('vrp-rich','₹'+Number(d.straddle_premium).toFixed(0)+' straddle');
    // VRP forward + HAR + RV 20d + forecast (missing from second definition — first had these)
    const fwd=d.vrp_forward, har=d.vrp_har;
    const setf=(id,v)=>{const e=document.getElementById(id); if(!e)return; if(v==null){e.textContent='—';e.style.color='var(--muted)';return;} e.textContent=(v>=0?'+':'')+Number(v).toFixed(2); e.style.color=v>0?'var(--green)':'var(--red)';};
    setf('vrp-fwd-val',fwd); setf('vrp-har-val',har);
    set('vrp-rv20d', d.rv_20d==null?'—':Number(d.rv_20d).toFixed(2)+'%');
    // VRP percentile — show real percentile when available, provisional when estimated
    set('vrp-pctl-val', d.vrp_percentile!=null ? Number(d.vrp_percentile).toFixed(0)+'th'
       : (vrp!=null ? 'building — insufficient history' : '—'));
    // Expected Move methodology
    const emM=document.getElementById('vrp-em-method');
    if(emM){
      const emInfo=d.expected_move_session||{};
      emM.textContent='EM: IV-derived 1σ (±68%) · '+emInfo.provenance==='previous'?('prior session '+emInfo.session_date):(emInfo.provenance||'today')+' · scaled by √(DTE/365)';
    }
    set('vrp-rvfc', d.rv_forecast==null?'—':Number(d.rv_forecast).toFixed(2)+'%');
    // percentile bar: real once 60 days accumulate, else provisional by VRP sign
    const pctl = (d.vrp_percentile!=null) ? Number(d.vrp_percentile)
               : (vrp==null?null:Math.max(5,Math.min(95,50+vrp*4)));
    const dot=document.getElementById('vrp-dot'), fill=document.getElementById('vrp-fill');
    if(dot&&pctl!=null)dot.style.left=pctl+'%'; if(fill&&pctl!=null)fill.style.width=pctl+'%';
    const lad=document.getElementById('vrp-ladder');
    if(lad){
      const H=d.history||[];
      const badge = v => v==='RICH'?'<span style="display:inline-block;padding:2px 10px;border-radius:4px;font-size:10px;font-weight:700;border:1px solid rgba(49,196,141,.4);background:rgba(49,196,141,.1);color:var(--green)">RICH</span>'
        : v==='CHEAP'?'<span style="display:inline-block;padding:2px 10px;border-radius:4px;font-size:10px;font-weight:700;border:1px solid rgba(238,90,110,.4);background:rgba(238,90,110,.1);color:var(--red)">CHEAP</span>'
        : v==='FAIR'?'<span style="display:inline-block;padding:2px 10px;border-radius:4px;font-size:10px;font-weight:700;border:1px solid rgba(232,163,61,.4);background:rgba(232,163,61,.1);color:var(--gold)">FAIR</span>'
        : v||'—';
      const cellStyle = 'padding:6px 10px;border-right:1px solid var(--grid);text-align:right';
      const cellFirst = 'padding:6px 10px;text-align:left';
      const cellLast = 'padding:6px 10px;text-align:center;border-right:none';
      const th = (l,w,al)=>`<span style="font-size:9px;letter-spacing:.8px;color:var(--muted);text-transform:uppercase;min-width:${w}px;text-align:${al||'right'};padding:6px 10px;border-right:1px solid var(--border)">${l}</span>`;
      const liveId = `vrp-live-${Date.now()}`;
      const liveHtml = `<div class="vrp-now" id="${liveId}" style="display:grid;grid-template-columns:55px 1fr 1fr 1fr 80px;gap:0;align-items:center;padding:0;margin:6px 0 10px;background:rgba(45,212,132,.06);border:1px solid rgba(45,212,132,.18);border-radius:8px;overflow:hidden">
        <span style="${cellFirst};font-size:9.5px;font-weight:700;letter-spacing:.5px;color:var(--cyan);border-right:1px solid rgba(45,212,132,.18)">NOW</span>
        <span style="${cellStyle}"><span style="font-size:8.5px;display:block;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">IV</span><span style="font-size:14px;font-weight:700;color:var(--accent)">${iv==null?'—':iv.toFixed(2)+'%'}</span></span>
        <span style="${cellStyle}"><span style="font-size:8.5px;display:block;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">RV</span><span style="font-size:14px;font-weight:700;color:var(--violet)">${rv==null?'—':rv.toFixed(2)+'%'}</span></span>
        <span style="${cellStyle}"><span style="font-size:8.5px;display:block;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">VRP</span><span style="font-size:14px;font-weight:700;color:${vrp>=0?'var(--green)':'var(--red)'}">${vrp==null?'—':(vrp>=0?'+':'')+vrp.toFixed(2)}</span></span>
        <span style="${cellLast}">${iv||vrp?badge(d.rich_cheap||(vrp>2?'RICH':vrp<-2?'CHEAP':'FAIR')):'—'}</span>
      </div>`;
      const histHtml = H.length ? '<div style="display:grid;grid-template-columns:55px 1fr 1fr 1fr 80px;gap:0;font-size:11px;border:1px solid var(--border);border-radius:6px;overflow:hidden">'
        + '<div style="display:contents"><span style="font-size:9px;letter-spacing:.8px;color:var(--muted);text-transform:uppercase;padding:8px 10px;background:rgba(120,150,255,.06);border-bottom:1px solid var(--border);border-right:1px solid var(--border);text-align:left">Date</span>'
        + '<span style="font-size:9px;letter-spacing:.8px;color:var(--muted);text-transform:uppercase;padding:8px 10px;background:rgba(120,150,255,.06);border-bottom:1px solid var(--border);border-right:1px solid var(--border);text-align:right">RV</span>'
        + '<span style="font-size:9px;letter-spacing:.8px;color:var(--muted);text-transform:uppercase;padding:8px 10px;background:rgba(120,150,255,.06);border-bottom:1px solid var(--border);border-right:1px solid var(--border);text-align:right">IV</span>'
        + '<span style="font-size:9px;letter-spacing:.8px;color:var(--muted);text-transform:uppercase;padding:8px 10px;background:rgba(120,150,255,.06);border-bottom:1px solid var(--border);border-right:1px solid var(--border);text-align:right">VRP</span>'
        + '<span style="font-size:9px;letter-spacing:.8px;color:var(--muted);text-transform:uppercase;padding:8px 10px;background:rgba(120,150,255,.06);border-bottom:1px solid var(--border);text-align:center">Status</span></div>'
        + H.map((x,i)=>`<div style="display:contents"><span style="${cellFirst};font-size:11px;color:var(--muted);${i%2?'background:var(--surface2)':''};border-bottom:1px solid var(--grid)">${(x.date||'').slice(5)}</span>
          <span style="${cellStyle};font-size:12px;color:var(--violet);${i%2?'background:var(--surface2)':''};border-bottom:1px solid var(--grid)">${x.rv==null?'—':Number(x.rv).toFixed(1)+'%'}</span>
          <span style="${cellStyle};font-size:12px;color:var(--accent);${i%2?'background:var(--surface2)':''};border-bottom:1px solid var(--grid)">${x.iv==null?'—':Number(x.iv).toFixed(1)+'%'}</span>
          <span style="${cellStyle};font-size:12px;color:${x.vrp>=0?'var(--green)':'var(--red)'};${i%2?'background:var(--surface2)':''};border-bottom:1px solid var(--grid)">${x.vrp==null?'—':(x.vrp>=0?'+':'')+Number(x.vrp).toFixed(2)}</span>
          <span style="${cellLast};${i%2?'background:var(--surface2)':''};border-bottom:1px solid var(--grid)">${badge(x.rich_cheap)}</span></div>`).join('')
        + '</div>'
        : '<div class="empty" style="margin:10px 0">fills daily at 15:50</div>';
      lad.innerHTML = '<div style="color:var(--cyan);font-size:9.5px;letter-spacing:1px;margin-bottom:4px">LIVE</div>'
        + liveHtml
        + '<div style="color:var(--cyan);font-size:9.5px;letter-spacing:1px;margin:10px 0 6px">HISTORY</div>'
        + histHtml;
    }
    // ═══ Settlement Engine (VWAP + OI + Synthetic + Accuracy) ═══
    try {
      const v = await jget('/api/settlement').catch(()=>({}));
      if(v.vwap_15!=null){
        const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
        const col=(id,c)=>{const e=document.getElementById(id);if(e)e.style.color=c;};
        set('se-spot',n2(v.spot_now));
        set('se-15',n2(v.vwap_15));
        set('se-30',n2(v.vwap_30));
        set('se-day',n2(v.vwap_day));
        set('se-synth',n2(v.synthetic));
        // Best estimator tag
        const bestTag=document.getElementById('seBestTag');
        if(bestTag&&v.best_estimator){
          bestTag.textContent=v.best_estimator.toUpperCase()+' ← CLOSEST';
          bestTag.style.color='var(--green)';
        }
        // Deltas
        if(v.convergence){
          const d=v.convergence;
          const fmt=x=>(x>=0?'+':'')+x.toFixed(2);
          const d15=document.getElementById('se-d15'),d30=document.getElementById('se-d30'),dda=document.getElementById('se-dday');
          if(d15){d15.textContent=fmt(d.spot_vs_15);d15.style.color=d.spot_vs_15>=0?'var(--green)':'var(--red)';}
          if(d30){d30.textContent=fmt(d.spot_vs_30);d30.style.color=d.spot_vs_30>=0?'var(--green)':'var(--red)';}
          if(dda){dda.textContent=fmt(d.spot_vs_day);dda.style.color=d.spot_vs_day>=0?'var(--green)':'var(--red)';}
        }
        // OI Pattern
        const oiTag=document.getElementById('se-oi');
        if(oiTag&&v.oi_pattern){
          oiTag.textContent=v.oi_pattern;
          oiTag.style.color=v.oi_pattern==='BEARISH_FLOW'?'var(--red)':v.oi_pattern==='BULLISH_FLOW'?'var(--green)':v.oi_pattern==='STRADDLE_BUILD'?'var(--gold)':'var(--muted)';
        }
        // Stack
        const stk=document.getElementById('se-stack');
        if(stk&&v.dimensions){
          stk.textContent=v.dimensions.stack;
          stk.style.color=v.dimensions.stack==='BULLISH'?'var(--green)':v.dimensions.stack==='BEARISH'?'var(--red)':'var(--muted)';
        }
        // Accuracy wins
        if(v.accuracy&&v.accuracy.wins){
          set('se-w15',v.accuracy.wins.vwap_15+'/'+v.accuracy.wins.total);
          set('se-w30',v.accuracy.wins.vwap_30+'/'+v.accuracy.wins.total);
          set('se-wday',v.accuracy.wins.vwap_day+'/'+v.accuracy.wins.total);
          const bh=v.accuracy.best_historical;
          if(bh){
            const bhEl=document.getElementById('seBestTag');
            if(bhEl)bhEl.textContent+=(' · 10d WINNER: '+bh.toUpperCase());
          }
        }
        // Expiry settlement card
        const sec=document.getElementById('expirySettleCard');
        if(sec&&window.__dte===0){
          sec.style.display='';
          set('set-curspot',n2(v.spot_now));
          set('set-vsavg',(v.convergence&&v.convergence.spot_vs_day>=0?'+':'')+(v.convergence?v.convergence.spot_vs_day.toFixed(2):''));
          const vs=document.getElementById('set-vsavg');
          if(vs&&v.convergence)vs.style.color=v.convergence.spot_vs_day>=0?'var(--green)':'var(--red)';
          set('set-vssynth',(v.synthetic?(v.spot_now-v.synthetic>=0?'+':'')+(v.spot_now-v.synthetic).toFixed(2):''));
          const vss=document.getElementById('set-vssynth');
          if(vss&&v.synthetic)vss.style.color=v.spot_now>=v.synthetic?'var(--green)':'var(--red)';
          const bias=v.convergence&&v.convergence.spot_vs_day>15?'CALL BIAS':v.convergence&&v.convergence.spot_vs_day<-15?'PUT BIAS':'NEUTRAL';
          const be=document.getElementById('set-bias');
          if(be){be.textContent=bias;be.style.color=bias==='CALL BIAS'?'var(--gold)':bias==='PUT BIAS'?'var(--violet)':'var(--accent)';}
          if(window.__expP3!=null)set('set-p3',n2(window.__expP3));
          if(window.__expP3spot!=null)set('set-p3spot',n2(window.__expP3spot));
        }else if(sec){sec.style.display='none';}
        // OI Flow table
        const oiGrid=document.getElementById('oiGrid');
        if(oiGrid){
          const oi = await jget('/api/oi-flow').catch(()=>({}));
          const tag=document.getElementById('oiPatternTag');
          if(tag&&oi.pattern){
            tag.textContent=oi.pattern;
            tag.style.color=oi.pattern==='BEARISH_FLOW'?'var(--red)':oi.pattern==='BULLISH_FLOW'?'var(--green)':oi.pattern==='STRADDLE_BUILD'?'var(--gold)':'var(--muted)';
          }
          if(oi.snapshots&&oi.snapshots.length){
            const isMobile=window.innerWidth<768;
            const rows=oi.snapshots.slice(-15).map((s,i)=>{
              const ceDir=s.ce_chg>0?'↑':s.ce_chg<0?'↓':'→',peDir=s.pe_chg>0?'↑':s.pe_chg<0?'↓':'→';
              const ceCol=s.ce_chg>0?'var(--red)':s.ce_chg<0?'var(--green)':'var(--muted)';
              const peCol=s.pe_chg>0?'var(--green)':s.pe_chg<0?'var(--red)':'var(--muted)';
              if(isMobile){
                // mobile: stacked card per time slot — CE row + PE row, readable
                return `<div style="padding:6px 0;border-bottom:1px solid var(--border);${i%2?'background:var(--surface2)':''}">
                  <div style="font-size:9px;color:var(--muted);margin-bottom:3px">${s.time}</div>
                  <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;gap:8px">
                    <span style="color:var(--cyan);font-weight:600">CE</span>
                    <span style="color:${ceCol};font-weight:700">${ceDir} ${n0(s.ce_chg)}</span>
                    <span style="text-align:right;color:var(--text2)">OI ${n0(s.ce_oi)}</span>
                  </div>
                  <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;gap:8px;margin-top:2px">
                    <span style="color:var(--violet);font-weight:600">PE</span>
                    <span style="color:${peCol};font-weight:700">${peDir} ${n0(s.pe_chg)}</span>
                    <span style="text-align:right;color:var(--text2)">OI ${n0(s.pe_oi)}</span>
                  </div>
                </div>`;
              }
              // desktop: compact grid row
              return `<div style="display:grid;grid-template-columns:50px 1fr 1fr 1fr 1fr;gap:3px;padding:4px 6px;${i%2?'background:var(--surface2)':''};border-bottom:1px solid var(--grid);font-size:10.5px">
                <span style="color:var(--muted)">${s.time}</span>
                <span style="color:${ceCol};font-weight:600">${ceDir} ${n0(s.ce_chg)}</span>
                <span style="text-align:right;color:var(--text2)">${n0(s.ce_oi)}</span>
                <span style="color:${peCol};font-weight:600">${peDir} ${n0(s.pe_chg)}</span>
                <span style="text-align:right;color:var(--text2)">${n0(s.pe_oi)}</span>
              </div>`;
            }).join('');
            oiGrid.innerHTML=isMobile
              ? `<div style="font-size:8.5px;letter-spacing:.8px;color:var(--muted);text-transform:uppercase;border-bottom:1px solid var(--border);padding:5px 6px;display:flex;justify-content:space-between">LATEST ${oi.snapshots.length} SNAPSHOTS · OI FLOW</div>`+rows
              : '<div style="display:grid;grid-template-columns:50px 1fr 1fr 1fr 1fr;gap:3px;padding:5px 6px;font-size:8.5px;letter-spacing:.8px;color:var(--muted);text-transform:uppercase;border-bottom:1px solid var(--border)">'
                +'<span>TIME</span><span>CE Δ</span><span style="text-align:right">CE OI</span><span>PE Δ</span><span style="text-align:right">PE OI</span></div>'
                +rows;
          }
        }
      }
    } catch(_){}
    // ═══ Float bar: key metrics at a glance (web-only) ═══
    try {
      const sf=(id,v,c)=>{const e=document.getElementById(id);if(e){e.textContent=v;if(c)e.style.color=c;}};
      sf('vf-vrp', vrp==null?'—':(vrp>=0?'+':'')+vrp.toFixed(1), vrp>=0?'var(--green)':'var(--red)');
      sf('vf-iv', iv==null?'—':iv.toFixed(1)+'%', 'var(--accent)');
      sf('vf-rv', rv==null?'—':rv.toFixed(1)+'%', 'var(--violet)');
      const s=ST[CUR]||{};
      const atmP=(s.legs&&s.atm&&s.legs[s.atm])?s.legs[s.atm].comb:null;
      sf('vf-strad', atmP!=null?'₹'+n2(atmP):'—', 'var(--gold)');
      sf('vf-vwap', (window.__sgAvg&&window.__sgAvg.a15!=null)?n2(window.__sgAvg.a15):'—');
      // Strategy P&L from lab summary
      try {
        const lab=await jget('/api/lab-summary').catch(()=>({}));
        const rows=(lab&&lab.strategies)?lab.strategies:[];
        const total=rows.reduce((a,r)=>a+(Number(r.total_pnl)||0),0);
        sf('vf-spn', total>=0?'+₹'+n2(total):'-₹'+n2(Math.abs(total)), total>=0?'var(--green)':'var(--red)');
      } catch(_){ sf('vf-spn','—'); }
      // Tracker P&L from local positions
      try {
        const tp=(typeof myPositions!=='undefined')?myPositions.reduce((a,p)=>{
          const cur=(s.legs&&p.strike&&s.legs[p.strike])?s.legs[p.strike].comb:null;
          const isB=p.side==='B';
          return a+(cur!=null&&p.entry?(isB?(cur-p.entry):(p.entry-cur))*65*(p.lots||1):0);
        },0):null;
        if(tp!=null)sf('vf-tpn', tp>=0?'+₹'+n2(tp):'-₹'+n2(Math.abs(tp)), tp>=0?'var(--green)':'var(--red)');
        else sf('vf-tpn','—');
      } catch(_){ sf('vf-tpn','—'); }
    } catch(_){}
  }catch(e){}
};
setInterval(()=>{const pg=document.getElementById('page-vrp'); if(pg&&pg.classList.contains('on'))renderVRP();},30000);

// Store expiry 3pm snapshot from main loop for settlement card
//
// BUG FOUND LIVE 2026-08-20 (documented since 2026-08-16 as ISS-2026-08-16-05,
// never fixed until now): this used to read the global `expiryWatch` at MODULE-
// EVAL time, synchronously. core.js defines expiryWatch and loads via `defer`;
// this file is lazy-loaded via requestIdleCallback, normally AFTER core.js has
// already run — but on the FIRST load after any deploy that changes core.js's
// content hash (a cache MISS on core.js, cache HIT on this file), this file can
// execute before core.js finishes fetching, `expiryWatch` does not exist yet at
// the true global scope, and the bare reference throws `ReferenceError:
// expiryWatch is not defined` — uncaught, so every line below it in this file
// silently never runs (including whatever else this file wires up). Reproduced
// live today: 15+ redeploys in one session repeatedly hit exactly this window,
// confirmed via a real ReferenceError in the browser console (overrides.js:236)
// and a real, resulting broken symptom (the top-bar index price element,
// #idxPx, stayed on its "—" placeholder forever — later renderers built ON TOP
// of the intended expiryWatch wrapper never got the chance to attach either).
//
// Fix: wait for core.js's expiryWatch to actually exist before wrapping it,
// instead of assuming the load-order race never loses. Bounded retry (100ms x
// 50 = 5s) so a genuinely broken core.js load fails loud (console warning) in
// under a page-load's worth of time, rather than polling forever.
var __expP3=null, __expP3spot=null;
(function _installExpiryWatchWrapper(attemptsLeft){
  if(typeof expiryWatch==='undefined'){
    if(attemptsLeft<=0){
      console.warn('overrides.js: expiryWatch never became available — 3pm settlement snapshot wrapper not installed');
      return;
    }
    setTimeout(function(){ _installExpiryWatchWrapper(attemptsLeft-1); }, 100);
    return;
  }
  var _origExpiryWatch=expiryWatch;
  expiryWatch=function(){
    _origExpiryWatch.call(this);
    if(window.__dte===0){
      const now=new Date(), s=ST[CUR];
      if(now.getHours()===15&&now.getMinutes()===0&&s&&s.spot!=null){
        if(__expP3==null)__expP3=s.legs&&s.atm&&s.legs[s.atm]?s.legs[s.atm].comb:null;
        if(__expP3spot==null)__expP3spot=s.spot;
      }
    }
  };
})(50);
