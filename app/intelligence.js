/* intelligence.js — THE BRAIN.
 *
 * DECISION-CENTRIC, NOT PROVIDER-CENTRIC
 * ---------------------------------------
 * This screen is not a page of API outputs. It is one argument: the Brain states a
 * decision, then justifies it. Backend modules are never named as sections — they
 * appear only as the SOURCE line under the fact they produced. A reader should be
 * able to understand the whole system without knowing a single module exists.
 *
 * EVERY FACT ANSWERS FIVE QUESTIONS
 * ----------------------------------
 *   what     the value
 *   why      the mechanism that produced it, in the provider's own words
 *   sure     reliability from the evidence contract — measured, never assumed
 *   changed  delta against the previous decision, or NOT TRACKED. Never invented.
 *   next     what would have to change for this fact to change the decision
 *
 * SINGLE OWNER
 * ------------
 * Every endpoint is fetched EXACTLY once per cycle into IC.d and then distributed.
 * The market section reads the Brain's OWN signal array — not per-provider calls —
 * so the screen cannot disagree with the decision it is explaining.
 */
'use strict';

const IC = {
  d: {}, err: {}, ts: null, timer: null, open: null,
  EP: ['', 'evidence', 'execution', 'portfolio', 'risk', 'timeframes',
    'execution_quality', 'physics', 'competition', 'dna', 'memory', 'lifecycle',
    'metalearn', 'evolution', 'calibration', 'replay', 'daily_health', 'regime_conviction']
};

/* ── primitives ─────────────────────────────────────────────────────────────── */
function ie(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function inum(v, d) {
  if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return null;
  return Number(v).toFixed(d === undefined ? 2 : d);
}
const NA = '<span class="b-na">NO DATA</span>';
const NT = '<span class="b-nt">NOT TRACKED</span>';
function has(v) { return v !== null && v !== undefined && v !== ''; }

function fmtTransition(tr) {
  // transition comes from intelligence.transition(): {first_observation, changes[],
  // since, material}. Renders the changes[] array as one readable sentence instead
  // of a raw JSON dump (BUG 2026-08-07: bConfidence showed verbatim JSON).
  if (typeof tr === 'string') return tr;
  if (!tr || typeof tr !== 'object') return '';
  const ch = Array.isArray(tr.changes) ? tr.changes : [];
  if (tr.first_observation && !ch.length) return 'first observation of the day — baseline set';
  if (!ch.length) return 'no material change' + (tr.since ? ' since ' + String(tr.since) : '');
  return ch.map(c => {
    const from = has(c.from) ? String(c.from) : null;
    const to = has(c.to) ? String(c.to) : null;
    let s = (c.what || 'signal') + ': ';
    if (from && to) s += from + ' → ' + to;
    else if (to) s += to;
    else if (from) s += from;
    else s += 'changed';
    if (has(c.delta)) s += ' (' + (Number(c.delta) > 0 ? '+' : '') + inum(c.delta) + ')';
    if (has(c.why)) s += ' — ' + c.why;
    return s;
  }).join('; ');
}

function tn(k) {
  const s = String(k || '').toUpperCase();
  if (/^(BULL|UP|OK|CLEAR|ALLOWED|GOOD|TRADEABLE|EXECUTE|ENTER|ACT|FLAT|COLD|NORMAL)/.test(s)) return 'g';
  if (/^(BEAR|DOWN|BAD|STOP|BLOCKED|BREACH|NO_TRADE|EXIT|AVOID|HOT|UNKNOWN|FAILED)/.test(s)) return 'r';
  if (/^(MIXED|WARN|THROTTLED|WATCH|PREPARE|WARM|DEGRADED|REDUCE)/.test(s)) return 'a';
  return '';
}
function ago(ts) {
  if (!ts) return null;
  const t = Date.parse(String(ts).replace(' ', 'T'));
  if (Number.isNaN(t)) return null;
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 90) return Math.round(s) + 's';
  if (s < 5400) return Math.round(s / 60) + 'm';
  if (s < 172800) return Math.round(s / 3600) + 'h';
  return Math.round(s / 86400) + 'd';
}

/* Reliability bar — the "how sure" column. 5 segments, filled from the measured
 * reliability of the provider that produced the fact. Never a guess. */
function sure(r) {
  if (!has(r)) return '<span class="b-sure none" title="reliability not measured">·····</span>';
  const n = Math.round(Math.max(0, Math.min(1, Number(r))) * 5);
  let h = '<span class="b-sure ' + (n >= 4 ? 'g' : n >= 2 ? 'a' : 'r')
    + '" title="reliability ' + inum(r) + '">';
  for (let i = 0; i < 5; i++) h += (i < n ? '▮' : '▯');
  return h + '</span>';
}

/* THE FACT ROW — the atom this whole screen is built from. */
function FACT(o) {
  const t = o.tone || tn(o.value);
  return '<div class="b-f' + (t ? ' t-' + t : '') + '" data-drill="' + ie(o.drill || '') + '"'
    + ' tabindex="0" role="button">'
    + '<div class="b-f-k">' + ie(o.what) + '</div>'
    + '<div class="b-f-v">' + (has(o.value) ? ie(o.value) : NA) + '</div>'
    + '<div class="b-f-s">' + sure(o.sure) + '</div>'
    + '<div class="b-f-d">' + (has(o.changed) ? ie(o.changed) : NT) + '</div>'
    + '<div class="b-f-w">' + ie(o.why || '') + '</div>'
    + '</div>';
}
function FACTHEAD() {
  return '<div class="b-f b-f-h"><div class="b-f-k">what</div><div class="b-f-v">value</div>'
    + '<div class="b-f-s">how sure</div><div class="b-f-d">changed</div>'
    + '<div class="b-f-w">why</div></div>';
}

function pill(t, k) { return '<span class="b-p' + (k ? ' t-' + k : '') + '">' + ie(t) + '</span>'; }

function gone(att, why) {
  const a = att || {};
  const r = [['reason', a.reason || why || 'no reason supplied'],
    ['last update', a.last_update || 'never'],
    ['reliability', has(a.reliability) ? inum(a.reliability) : 'n/a'],
    ['coverage', has(a.coverage_pct) ? inum(a.coverage_pct, 1) + '%' : 'n/a'],
    ['sample', has(a.sample_size) ? a.sample_size + ' sessions' : 'n/a']];
  return '<div class="b-gone"><div class="b-gone-h">CANNOT SEE THIS SIGNAL'
    + (a.status ? ' · ' + ie(a.status) : '') + '</div>'
    + r.map(x => '<div class="b-kv"><span>' + x[0] + '</span><b>' + ie(x[1]) + '</b></div>').join('')
    + '<div class="b-gone-f">Excluded from the decision. Confidence was lowered rather '
    + 'than a value substituted.</div></div>';
}

/* ═══════════════════════════════════════════════════════════════════════════════
   VERDICT — premium header, institutional density
   ═══════════════════════════════════════════════════════════════════════════════ */
function bVerdict() {
  const el = document.getElementById('bVerdict');
  if (!el) return;
  const b = IC.d[''] || {}, ex = IC.d.execution || {}, rk = IC.d.risk || {},
    ev = IC.d.evidence || {};
  if (!b.confidence) { el.innerHTML = '<div class="b-e" style="padding:18px">NO DECISION AVAILABLE</div>'; return; }
  const cf = b.confidence, al = b.allocation || {}, rd = b.readiness || {};
  const sm = ev.summary || {};
  const conf = Number(cf.confidence || 0), ceil = Number(cf.ceiling || 1);
  const act = ex.action || rd.state || 'NO DECISION';
  const perm = (ex.qty_lots || 0) > 0 && act !== 'NO_TRADE';
  const rm = has(rk.multiplier) ? Number(rk.multiplier) : null;
  const tone = conf >= 0.5 ? 'g' : conf > 0.2 ? 'a' : 'r';
  const pct = Math.round(Math.min(1, conf / Math.max(ceil, 0.01)) * 100);
  const sig = b.signals || [];
  const regime = sig.find(s => s.name === 'regime') || {};

  // Regime badge
  const regBadge = has(regime.stance) ? '<span class="b-regime ' + tn(regime.stance)
    + '">' + ie(regime.stance) + ' · ' + ie(LBL[regime.name] || regime.name) + '</span>' : '';

  // Confidence ring
  const ringSize = 80, stroke = 5, r = (ringSize - stroke) / 2, circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);
  const ringColor = tone === 'g' ? 'var(--green)' : tone === 'a' ? 'var(--accent)' : 'var(--red)';
  const ring = '<svg width="' + ringSize + '" height="' + ringSize + '" viewBox="0 0 ' + ringSize + ' ' + ringSize + '">'
    + '<circle cx="' + (ringSize/2) + '" cy="' + (ringSize/2) + '" r="' + r + '" fill="none"'
    + ' stroke="var(--grid)" stroke-width="' + stroke + '"/>'
    + '<circle cx="' + (ringSize/2) + '" cy="' + (ringSize/2) + '" r="' + r + '" fill="none"'
    + ' stroke="' + ringColor + '" stroke-width="' + stroke + '" stroke-linecap="round"'
    + ' stroke-dasharray="' + circ + '" stroke-dashoffset="' + offset + '"'
    + ' transform="rotate(-90 ' + (ringSize/2) + ' ' + (ringSize/2) + ')"/></svg>';

  const fails = Object.keys(IC.err).length;

  // The five top-line questions, one cell each — one owner for the verdict row.
  const vcells = [
    { k: 'DECISION', v: ie(act), tone: tn(act),
      s: ie(al.selected ? String(al.selected).slice(0, 36) : 'no strategy'), drill: 'decision' },
    { k: 'CONFIDENCE', v: inum(conf), tone: tone,
      s: cf.tier + ' · ceiling ' + inum(ceil), drill: 'confidence' },
    { k: 'TRADING', v: perm ? 'PERMITTED' : 'BLOCKED', tone: perm ? 'g' : 'r',
      s: ie((rk.hardest ? 'lock: ' + rk.hardest : (ex.reason || '')).slice(0, 32)), drill: 'permission' },
    { k: 'CAPITAL', v: has(ex.risk_budget) ? '₹' + Number(ex.risk_budget).toLocaleString('en-IN') : '—', tone: 'g',
      s: (ex.qty_lots || 0) + ' lot(s) · weight ' + (has(al.weight) ? inum(al.weight, 3) : '?'), drill: 'capital' },
    { k: 'RISK', v: rm === 0 ? 'STOP' : rm !== null && rm < 1 ? 'THROTTLED' : rm !== null ? 'CLEAR' : '—',
      tone: rm === 0 ? 'r' : rm !== null && rm < 1 ? 'a' : 'g',
      s: rm !== null ? '×' + inum(rm) : '', drill: 'risk' },
  ];

  el.innerHTML =
    '<div class="bv-top">'
    + '<div class="bv-conf">'
    + '<div class="bv-ring" data-drill="confidence" tabindex="0" role="button">'
    + ring
    + '<div class="bv-ring-val ' + tone + '">' + inum(conf) + '</div>'
    + '</div>'
    + '<div class="bv-meta">'
    + '<div class="bv-tier">' + cf.tier + '</div>'
    + '<div class="bv-ceil">ceiling ' + inum(ceil) + ' · ' + (cf.sessions || 0) + ' sessions</div>'
    + '</div>'
    + '</div>'
    + '<div class="bv-cards">'
    + vcells.map(c => '<div class="bv-card ' + c.tone + '" data-drill="' + c.drill + '" tabindex="0" role="button">'
      + '<div class="bv-ck">' + c.k + '</div>'
      + '<div class="bv-cv">' + c.v + '</div>'
      + '<div class="bv-cs">' + c.s + '</div>'
      + '</div>').join('')
    + '</div>'
    + '</div>'
    + '<div class="bv-bar">'
    + regBadge
    + '<span style="font-size:10px;color:var(--muted)">'
    + (sm.available || 0) + '/' + (sm.total || 0) + ' evidence · '
    + (IC.ts ? IC.ts.toLocaleTimeString() : '') + ' · ' + (b.date || '')
    + (fails ? ' · <b class="t-r">' + fails + ' down</b>' : '')
    + '</span></div>';

  const st = document.getElementById('bStamp');
  if (st) {
    st.innerHTML = '<span class="b-live"></span> session ' + (b.date || 'unknown')
      + ' · refreshed ' + (IC.ts ? IC.ts.toLocaleTimeString() : '—');
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   CONFIDENCE — gauge + decomposition + trend
   ═══════════════════════════════════════════════════════════════════════════════ */
function bConfidence() {
  const el = document.getElementById('bConfidence');
  if (!el) return;
  const b = IC.d[''] || {}, ev = IC.d.evidence || {};
  const cf = b.confidence || {}, sm = ev.summary || {};
  if (!has(cf.confidence)) { el.innerHTML = '<div class="b-e">no confidence computed</div>'; return; }
  const conf = Number(cf.confidence), ceil = Number(cf.ceiling || 0);
  const gaugeTone = conf >= 0.5 ? 'g' : conf > 0.2 ? 'a' : 'r';
  const pct = Math.round(Math.min(1, conf / Math.max(ceil, 0.01)) * 100);

  let h = '<div style="display:flex;gap:12px;align-items:stretch">'
    // Gauge column
    + '<div style="display:flex;flex-direction:column;align-items:center;min-width:72px">'
    + '<div class="b-gauge-v" style="background:var(--grid);border-radius:6px;width:12px;flex:1;position:relative;overflow:hidden">'
    + '<div class="b-gauge-fill ' + gaugeTone + '" style="position:absolute;bottom:0;width:100%;height:' + pct + '%;border-radius:6px;transition:height .6s"></div>'
    + '</div>'
    + '<div style="font-size:18px;font-weight:800;color:var(--' + (gaugeTone === 'g' ? 'green' : gaugeTone === 'a' ? 'accent' : 'red') + ');margin:6px 0 2px;font-family:var(--mono),monospace">' + inum(conf) + '</div>'
    + '<div style="font-size:8px;color:var(--muted);text-align:center">' + cf.tier + '</div>'
    + '</div>'
    // Decomposition cards
    + '<div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:6px;min-width:0">'
    + '<div class="b-trust-c" style="margin:0"><div class="h">Agreement</div>'
    + '<div class="v t-g">' + (has(cf.base) ? inum(cf.base) : NA) + '</div>'
    + '<div class="sub">supporting evidence weight</div></div>'
    + '<div class="b-trust-c" style="margin:0"><div class="h">Contradictions</div>'
    + '<div class="v t-r">' + (cf.contradictions || 0) + '</div>'
    + '<div class="sub">penalty −' + (has(cf.penalty) ? inum(cf.penalty) : NA) + '</div></div>'
    + '<div class="b-trust-c" style="margin:0"><div class="h">Availability</div>'
    + '<div class="v t-a">' + (sm.available || 0) + '/' + (sm.total || 0) + '</div>'
    + '<div class="sub">×' + (has(cf.availability) ? inum(cf.availability) : NA) + ' factor</div></div>'
    + '<div class="b-trust-c" style="margin:0"><div class="h">Ceiling</div>'
    + '<div class="v">' + (cf.sessions || 0) + '</div>'
    + '<div class="sub">sessions · 1-σ</div></div>'
    + '</div>'
    + '</div>'
    + (b.transition ? '<div class="b-chg" style="margin-top:8px"><b>WHAT CHANGED</b> '
      + ie(fmtTransition(b.transition)) + '</div>' : '')
    + obsStrip(cf.observatory);

  el.innerHTML = h;
}

/* The Confidence Observatory readout — every value is rendered straight from the
   observatory object the Brain produced. The browser NEVER recomputes any of these:
   it displays what intelligence.confidence() emitted, so Browser = API = Database. */
function obsStrip(obs) {
  if (!obs || typeof obs !== 'object') return '';
  const cell = (k, v, cl) => '<div class="b-trust-c" style="margin:0"><div class="h">' + k
    + '</div><div class="v ' + (cl || '') + '">' + v + '</div><div class="sub">&nbsp;</div></div>';
  const agm = has(obs.agreement_count) && has(obs.opposition_count)
    ? obs.agreement_count + ' : ' + obs.opposition_count : NA;
  return '<div style="margin-top:8px;border-top:1px solid var(--grid);padding-top:8px">'
    + '<div style="font-size:9px;letter-spacing:.14em;color:var(--muted);margin-bottom:6px">'
    + 'CONFIDENCE OBSERVATORY · <span class="t-g">' + ie(obs.model || '') + '</span>'
    + ' · read-only diagnostic — never feeds the decision</div>'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(86px,1fr));gap:6px">'
    + cell('Agreement', agm)
    + cell('Agreement ratio', has(obs.agreement_ratio) ? inum(obs.agreement_ratio) : NA)
    + cell('Evidence', has(obs.evidence_coverage) ? inum(obs.evidence_coverage) : NA, 't-a')
    + cell('History cap', has(obs.historical_reliability) ? inum(obs.historical_reliability) : NA)
    + cell('Calibration adj.', has(obs.calibration_adjustment) ? inum(obs.calibration_adjustment) : NA, 't-a')
    + cell('Final confidence', has(obs.final_confidence) ? inum(obs.final_confidence) : NA, 't-g')
    + '</div>'
    + '<div style="font-size:9px;color:var(--muted);margin-top:6px">' + ie(obs.reason || '') + '</div>'
    + '</div>';
}

/* ═══════════════════════════════════════════════════════════════════════════════
   WHY — signal agreement matrix, visual instead of text
   ═══════════════════════════════════════════════════════════════════════════════ */
function bWhy() {
  const el = document.getElementById('bWhy');
  if (!el) return;
  const b = IC.d[''] || {}, ev = IC.d.evidence || {};
  const att = ev.providers || {}, cf = b.confidence || {};
  const dom = cf.dominant_stance;
  const all = b.signals || [];
  if (!all.length) { el.innerHTML = '<div class="b-e">no signals read this cycle</div>'; return; }

  const sup = all.filter(s => s.stance === dom && dom && dom !== 'NEUTRAL');
  const con = b.contradictions || [];
  const missing = b.unavailable_evidence || [];
  const other = all.filter(s => !sup.includes(s) && !missing.find(m => m.name === s.name));

  // Signal card
  function sCard(s, cls) {
    const a = att[s.name] || {};
    const tone = tn(s.stance);
    const bars = ['','','','',''];
    const rel = Math.min(1, Math.max(0, Number(a.reliability || 0)));
    const filled = Math.round(rel * 5);
    for (let i = 0; i < 5; i++) bars[i] = i < filled ? '▮' : '▯';
    return '<div class="sg-card ' + (cls || '') + ' ' + (tone || '') + '" data-drill="sig:' + ie(s.name) + '" tabindex="0" role="button">'
      + '<div class="sg-name">' + ie(LBL[s.name] || s.name) + '</div>'
      + '<div class="sg-val">' + (has(s.value) ? ie(String(s.value).slice(0, 22)) : ie(s.stance || '')) + '</div>'
      + '<div class="sg-bars">' + bars.map(b => '<span>' + b + '</span>').join('') + '</div>'
      + '<div class="sg-why">' + ie((s.why || '').slice(0, 60)) + '</div>'
      + '</div>';
  }

  let h = '<div class="sg-grid">'
    // Supporting
    + (sup.length ? sup.map(s => sCard(s, 'sup')).join('') : '')
    // Other (neutral/remaining)
    + (other.length ? other.map(s => sCard(s, '')).join('') : '')
    // Missing
    + (missing.length ? missing.map(m => '<div class="sg-card missing" data-drill="sig:' + ie(m.name) + '" tabindex="0" role="button">'
      + '<div class="sg-name">' + ie(LBL[m.name] || m.name) + '</div>'
      + '<div class="sg-val" style="color:var(--red)">MISSING</div>'
      + '<div class="sg-bars"><span style="color:var(--red)">▯▯▯▯▯</span></div>'
      + '<div class="sg-why">' + ie(m.reason || '') + '</div>'
      + '</div>').join('') : '')
    // Contradiction axis
    + (con.length ? con.map(c => '<div class="sg-card con" data-drill="contradictions" tabindex="0" role="button">'
      + '<div class="sg-name">⚠ ' + ie(c.axis) + '</div>'
      + '<div class="sg-val" style="color:var(--warn)">' + ie((c.between || []).join(' vs ').slice(0, 22)) + '</div>'
      + '<div class="sg-bars"><span style="color:var(--warn)">▮▮▯▯▯</span></div>'
      + '<div class="sg-why">' + ie(c.detail || '') + '</div>'
      + '</div>').join('') : '')
    + '</div>'
    + '<div class="sg-legend"><span class="sg-ld g">■</span> supporting '
    + '<span class="sg-ld" style="margin-left:8px">■</span> neutral '
    + '<span class="sg-ld r" style="margin-left:8px">■</span> contradicting/missing</div>';

  el.innerHTML = h;
}

/* ═══════════════════════════════════════════════════════════════════════════
   WHAT THE BRAIN UNDERSTANDS ABOUT THE MARKET
   ═══════════════════════════════════════════════════════════════════════════ */
const LBL = {
  regime: 'Regime', intraday_state: 'Market Pulse', auction_state: 'Market Physics',
  dealer_gamma: 'Dealer Gamma', oi_shift: 'OI Positioning', positioning: 'OI Build-up',
  pcr: 'Put/Call Ratio', iv_percentile: 'Implied Volatility', vrp_pct: 'Volatility Premium',
  skew: 'Skew', em_realisation: 'Expected Move', mtf_agreement: 'Momentum · multi-timeframe',
  execution_quality: 'Liquidity', historical_analogue: 'Historical Similarity',
  pattern_health: 'Pattern Health', dna_coverage: 'Strategy DNA',
  strategy_pool: 'Strategy Pool', portfolio_heat: 'Book Heat', risk_lock: 'Risk Lock'
};
/* What would have to change for this fact to move the decision. Declared, because a
 * generated sentence would be a guess about the Brain's own thresholds. */
const NEXT = {
  regime: 'a regime flip, or confidence below 0.30, engages the regime lock',
  intraday_state: 'a state change re-reads every intraday entry rule',
  auction_state: 'a new primary auction state changes the volatility stance',
  dealer_gamma: 'crossing the gamma flip inverts how dealers hedge the move',
  oi_shift: 'OI moving the other way flips the positioning read',
  pcr: 'PCR is read directly; no threshold gate',
  iv_percentile: 'below 5th percentile engages the volatility lock',
  vrp_pct: 'a negative VRP removes the edge premium-selling depends on',
  skew: 'the cheaper side switching flips the directional-fear read',
  em_realisation: 'realising more than the expected move hurts sellers',
  mtf_agreement: 'timeframes disagreeing collapses the momentum stance',
  execution_quality: 'median spread above 3% marks the book untradeable',
  portfolio_heat: 'heat above 0.70 throttles, above 0.90 blocks new risk',
  risk_lock: 'any lock engaging can only reduce or block — never enlarge'
};

function bMarket() {
  const el = document.getElementById('bMarket');
  if (!el) return;
  const b = IC.d[''] || {}, ev = IC.d.evidence || {};
  const att = ev.providers || {};
  const sig = {}; (b.signals || []).forEach(s => { sig[s.name] = s; });
  const ORDER = ['regime', 'intraday_state', 'auction_state', 'dealer_gamma', 'oi_shift',
    'positioning', 'pcr', 'iv_percentile', 'vrp_pct', 'skew', 'em_realisation',
    'mtf_agreement', 'execution_quality', 'historical_analogue'];

  el.innerHTML = FACTHEAD() + ORDER.map(k => {
    const s = sig[k], a = att[k] || {};
    if (!s) {
      return FACT({ what: LBL[k] || k, value: null, sure: a.reliability, tone: 'r',
        why: a.reason || 'no reading produced', drill: 'sig:' + k });
    }
    return FACT({
      what: LBL[k] || k,
      value: has(s.value) ? String(s.value).slice(0, 26) : s.stance,
      sure: a.reliability,
      changed: null,
      why: s.why, tone: tn(s.stance), drill: 'sig:' + k
    });
  }).join('');
}

/* ═══════════════════════════════════════════════════════════════════════════════
   STRATEGY — card-based competition display
   ═══════════════════════════════════════════════════════════════════════════════ */
function bStrategy() {
  const el = document.getElementById('bStrategy');
  if (!el) return;
  const c = IC.d.competition || {}, b = IC.d[''] || {}, mem = IC.d.memory || {},
    dna = IC.d.dna || {};
  const list = c.ranked || c.strategies || c.profiles || [];
  const win = (b.allocation || {}).selected;
  if (!list.length) { el.innerHTML = '<div class="b-e">no strategy ranking produced</div>'; return; }

  const act = list.filter(s => /^(ACT|TRADE)/.test(String(s.verdict || '').toUpperCase()));
  const rej = list.filter(s => act.indexOf(s) < 0);
  const cl = mem.closest || {};

  let h = '<div class="str-summary">'
    + '<span class="str-stat g">' + act.length + '<small> survived</small></span>'
    + '<span class="str-stat r">' + rej.length + '<small> rejected</small></span>'
    + (cl.date ? '<span class="str-stat">' + ie(cl.date) + '<small> analogue</small></span>' : '')
    + (has(dna.reliable_cells) ? '<span class="str-stat">' + dna.reliable_cells
      + '/' + (dna.total_cells||'?') + '<small> DNA cells</small></span>' : '')
    + '</div>';

  h += '<div class="str-cards">';
  list.slice(0, 12).forEach((s, i) => {
    const isW = win && s.strategy === win;
    const vd = String(s.verdict || '').toUpperCase();
    const scoreBar = has(s.score) ? Math.round(Math.min(1, Number(s.score)) * 100) : 0;
    const scoreCol = Number(s.score) >= 0.6 ? 'var(--green)' : Number(s.score) >= 0.3 ? 'var(--accent)' : 'var(--red)';

    h += '<div class="str-card' + (isW ? ' win' : '') + '" data-drill="strat:' + ie(s.strategy) + '" tabindex="0" role="button">'
      + '<div class="str-rank">#' + (i + 1) + '</div>'
      + '<div class="str-body">'
      + '<div class="str-name">' + ie(String(s.strategy || '').slice(0, 40))
      + (isW ? ' <span class="str-chosen">CHOSEN</span>' : '') + '</div>'
      + '<div class="str-meta">'
      + '<span class="str-pill ' + tn(vd) + '">' + ie(s.verdict || 'n/a') + '</span>'
      + (has(s.expectancy) ? ' · E[x] ' + inum(s.expectancy, 1) : '')
      + (has(s.trades !== undefined ? s.trades : s.n) ? ' · n=' + (s.trades !== undefined ? s.trades : s.n) : '')
      + (has(s.stability) ? ' · stab ' + inum(s.stability) : '')
      + '</div>'
      + '<div class="str-score">'
      + '<div class="str-bar" style="width:' + scoreBar + '%;background:' + scoreCol + '"></div>'
      + (has(s.score) ? '<span style="font-size:9px;color:var(--muted);margin-left:6px">' + inum(s.score, 3) + '</span>' : '')
      + '</div>'
      + (s.reason || s.why ? '<div class="str-reason">' + ie((s.reason || s.why || '').slice(0, 80)) + '</div>' : '')
      + '</div>'
      + '</div>';
  });
  h += '</div>'
    + (list.length > 12 ? '<div class="b-note">' + (list.length - 12) + ' more strategies not shown. Expand evidence to see full field.</div>' : '')
    + '<div class="b-note">' + rej.length + ' rejected. Every rejection states its reason.</div>';

  el.innerHTML = h;
}

/* ═══════════════════════════════════════════════════════════════════════════
   WHAT THE BOOK IS ALREADY CARRYING
   ═══════════════════════════════════════════════════════════════════════════ */
function bPortfolio() {
  const el = document.getElementById('bPortfolio');
  if (!el) return;
  const p = IC.d.portfolio, ex = IC.d.execution || {}, rk = IC.d.risk || {};
  const att = ((IC.d.evidence || {}).providers || {}).portfolio_heat;
  if (!p || p.error || !p.greeks) { el.innerHTML = gone(att, IC.err.portfolio); return; }
  const g = p.greeks, h = p.heat, v = p.view || {};
  if (v.available === false) { el.innerHTML = gone(att, v.detail); return; }
  const dd = rk.locks || {};
  const cap = rk.capital;

  el.innerHTML = '<div class="b-facts">' + FACTHEAD()
    + FACT({ what: 'Heat', value: inum(h.heat) + ' · ' + h.state, sure: g.coverage_pct / 100,
      tone: tn(h.state), why: 'how much of the risk budget is live right now', drill: 'portfolio' })
    + FACT({ what: 'Net delta', value: inum(g.net_delta, 1), sure: g.coverage_pct / 100,
      why: 'per lot ' + (has(h.delta_per_lot) ? inum(h.delta_per_lot) : 'n/a')
        + (h.delta_neutral ? ' — inside the neutral band' : ' — directional'), drill: 'portfolio' })
    + FACT({ what: 'Net gamma', value: inum(g.net_gamma, 4), sure: g.coverage_pct / 100,
      why: Number(g.net_gamma) < 0 ? 'short gamma — losses accelerate with the move'
        : 'long gamma — the book is hedged against the move', drill: 'portfolio' })
    + FACT({ what: 'Net vega', value: inum(g.net_vega, 1), sure: g.coverage_pct / 100,
      why: Number(g.net_vega) < 0 ? 'short volatility — a vol spike hurts'
        : 'long volatility', drill: 'portfolio' })
    + FACT({ what: 'Net theta', value: inum(g.net_theta, 1), sure: g.coverage_pct / 100,
      why: Number(g.net_theta) > 0 ? 'time decay works for the book' : 'time decay works against it',
      drill: 'portfolio' })
    + FACT({ what: 'Concentration', value: inum(h.concentration), sure: g.coverage_pct / 100,
      tone: h.concentration > 0.4 ? 'a' : '',
      why: (h.largest_strategy || 'no single strategy') + ' holds the largest share of exposure',
      drill: 'portfolio' })
    + FACT({ what: 'Exposure', value: has(g.lots) ? inum(g.lots, 1) + ' lot(s)' : null,
      sure: g.coverage_pct / 100, why: g.priced_legs + ' of ' + g.legs + ' legs priced ('
        + inum(g.coverage_pct, 1) + '% Greek coverage)', drill: 'portfolio' })
    + FACT({ what: 'Capital at risk', value: has(ex.risk_budget) ? '₹' + Number(ex.risk_budget).toLocaleString('en-IN') : null,
      why: cap ? 'against ₹' + Number(cap).toLocaleString('en-IN') + ' deployed base' : 'no capital base declared',
      drill: 'capital' })
    + FACT({ what: 'Drawdown', value: has((dd.DD_DAILY || {}).value) ? inum((dd.DD_DAILY || {}).value * 100, 2) + '%' : null,
      tone: (dd.DD_DAILY || {}).active ? 'r' : 'g',
      why: (dd.DD_DAILY || {}).reason || 'daily realised drawdown against its limit', drill: 'risk' })
    + '</div>'
    + ((h.breaches || []).length ? '<div class="b-alert">' + h.breaches.map(ie).join(' · ') + '</div>' : '')
    + ((g.missing_detail || []).length ? '<div class="b-note">excluded, no stored Greeks: '
      + g.missing_detail.map(ie).join(', ') + '</div>' : '');
}

/* ═══════════════════════════════════════════════════════════════════════════
   WHAT WOULD ACTUALLY BE DONE
   ═══════════════════════════════════════════════════════════════════════════ */
function bExec() {
  const el = document.getElementById('bExec');
  if (!el) return;
  const ex = IC.d.execution, q = IC.d.execution_quality || {}, rk = IC.d.risk || {};
  if (!ex || ex.error) { el.innerHTML = gone(null, IC.err.execution); return; }

  let h = '<div class="b-facts">' + FACTHEAD()
    + FACT({ what: 'Plan', value: ex.action, tone: tn(ex.action),
      why: ex.reason || 'the planner executes only what the system approved', drill: 'execution' })
    + FACT({ what: 'Position size', value: has(ex.qty_lots) ? ex.qty_lots + ' lot(s)' : null,
      why: 'risk budget ÷ stop distance, then hard-capped at '
        + ((ex.caps || {}).max_qty_lots || '?') + ' lots', drill: 'execution' })
    + FACT({ what: 'Risk multiplier', value: has(rk.multiplier) ? '×' + inum(rk.multiplier) : null,
      tone: rk.multiplier === 0 ? 'r' : rk.multiplier < 1 ? 'a' : 'g',
      why: rk.hardest ? ('hardest lock: ' + rk.hardest) : 'no lock is active', drill: 'risk' })
    + FACT({ what: 'Stop', value: ex.stop_loss,
      why: has(ex.stop_distance) ? ('distance ' + ex.stop_distance + ' — from the strategy definition, never invented')
        : 'no stop distance available', drill: 'execution' })
    + FACT({ what: 'Hedge', value: ex.hedge, tone: ex.hedge === 'REQUIRED' ? 'a' : '',
      why: ex.hedge_reason || '', drill: 'execution' })
    + FACT({ what: 'Liquidity', value: has(q.liquidity_score) ? inum(q.liquidity_score) : null,
      tone: q.tradeable ? 'g' : 'r',
      why: has(q.spread_pct_median) ? ('median spread ' + inum(q.spread_pct_median) + '%, quoted '
        + inum(q.quoted_coverage * 100, 0) + '%') : ((q.reasons || []).join('; ')), drill: 'execution_quality' })
    + FACT({ what: 'Expected slippage', value: has(q.slippage_bps_est) ? inum(q.slippage_bps_est, 0) + ' bps' : null,
      why: 'half the quoted spread — theoretical cost of crossing, not a measured fill',
      drill: 'execution_quality' })
    + FACT({ what: 'Mode', value: ex.mode || 'SHADOW', tone: 'a',
      why: 'a plan, never an order — no broker order path exists in this platform',
      drill: 'execution' })
    + '</div>';

  const p = IC.d.portfolio || {};
  if (p && !p.error && p.greeks) {
    const g = p.greeks, pheat = p.heat || {};
    h += '<div class="b-s-h" style="font-size:10px;margin-top:12px;padding:8px 0 4px">PORTFOLIO</div>';
    h += '<div class="b-facts">' + FACTHEAD()
      + FACT({ what: 'Heat', value: inum(pheat.heat) + ' · ' + pheat.state, sure: g.coverage_pct / 100,
        tone: tn(pheat.state), why: 'how much of the risk budget is live right now', drill: 'portfolio' })
      + FACT({ what: 'Net delta', value: inum(g.net_delta, 1), sure: g.coverage_pct / 100,
        why: 'per lot ' + (has(pheat.delta_per_lot) ? inum(pheat.delta_per_lot) : 'n/a')
          + (pheat.delta_neutral ? ' — inside the neutral band' : ''), drill: 'portfolio' })
      + FACT({ what: 'Net gamma', value: inum(g.net_gamma, 4), sure: g.coverage_pct / 100,
        why: Number(g.net_gamma) < 0 ? 'short gamma — losses accelerate' : 'long gamma — hedged',
        drill: 'portfolio' })
      + FACT({ what: 'Net vega', value: inum(g.net_vega, 1), sure: g.coverage_pct / 100,
        why: Number(g.net_vega) < 0 ? 'short volatility' : 'long volatility', drill: 'portfolio' })
      + '</div>'
      + ((pheat.breaches || []).length ? '<div class="b-alert">' + pheat.breaches.map(ie).join(' · ') + '</div>' : '');
  }

  if (q.not_provided) {
    h += '<div class="b-note gap"><b>DELIBERATELY NOT MEASURED — no estimate substituted:</b><br>'
      + Object.keys(q.not_provided).map(k => '· <b>' + ie(k) + '</b> — ' + ie(q.not_provided[k])).join('<br>')
      + '</div>';
  }
  el.innerHTML = h;
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIDENCE OBSERVATORY — live claim-frame telemetry (Phase 2B)
   Session level is the independent unit: 345 decisions share a handful of session
   outcomes, so per-decision calibration is descriptive only. The note warns when
   the emitted series is not reproducible from archives.
   ═══════════════════════════════════════════════════════════════════════════ */
function OBSERVATORY(obs, ob) {
  const rows = [['Sessions', obs.n_sessions, null],
    ['Right decisions', obs.correct + '/' + obs.n_sessions, null],
    ['Tradeable claims', obs.tradeable_claims, null],
    ['Brier (claim)', inum(obs.brier_claim, 4), null],
    ['BSS', inum(obs.bss_claim, 4), (has(obs.bss_claim) && obs.bss_claim <= 0) ? 'a' : 'g'],
    ['ECE', inum(obs.ece_claim, 4), null]];
  return '<div class="b-s-h obs">CONFIDENCE OBSERVATORY '
    + '<span>session-level · claim frame · diagnostic</span></div>'
    + '<table class="b-t"><thead><tr><th>metric</th><th class="n">value</th></tr></thead><tbody>'
    + rows.map(r => '<tr><td>' + r[0] + '</td><td class="n"><b class="' + (r[2] || '') + '">' + r[1]
      + '</b></td></tr>').join('') + '</tbody></table>'
    + '<table class="b-t"><thead><tr><th>confidence bucket</th><th class="n">n</th>'
    + '<th class="n">predicted</th><th class="n">actual</th></tr></thead><tbody>'
    + (obs.buckets || []).map(bk => '<tr><td>' + ie(bk.bucket) + '</td><td class="n">' + bk.n
      + '</td><td class="n">' + (has(bk.predicted) ? inum(bk.predicted, 3) : NA)
      + '</td><td class="n">' + (has(bk.actual) ? inum(bk.actual, 3) : NA) + '</td></tr>').join('')
    + '</tbody></table>'
    + (ob.note ? '<div class="b-note">' + ie(ob.note) + '</div>' : '');
}

/* ═══════════════════════════════════════════════════════════════════════════
   WHAT THE BRAIN HAS LEARNED
   ═══════════════════════════════════════════════════════════════════════════ */
function bLearning() {
  const el = document.getElementById('bLearning');
  if (!el) return;
  const mem = IC.d.memory || {}, lf = IC.d.lifecycle || {}, ml = IC.d.metalearn || {},
    evo = IC.d.evolution || {}, cal = IC.d.calibration || {}, b = IC.d[''] || {};
  const cl = mem.closest || {};
  const stages = lf.by_state || lf.stages || lf.counts || {};
  const muted = evo.muted || [];
  const ob = cal.observatory || {}, obs = ob.session_level || {}, opd = ob.per_decision || {};

  el.innerHTML = '<div class="b-facts">' + FACTHEAD()
     + FACT({ what: 'Closest historical day', value: cl.date || null, sure: mem.reliable ? 0.8 : 0.2,
      tone: mem.reliable ? 'g' : 'a',
      why: has(cl.distance) ? ('distance ' + inum(cl.distance) + (mem.reliable ? ' — usable as a prior'
        : ' — ' + (mem.why_not_reliable || 'too far to trust'))) : 'no analogue within range',
      drill: 'memory' })
    + FACT({ what: 'Pattern lifecycle', value: has(lf.total || lf.patterns) ? (lf.total || lf.patterns) : null,
      why: Object.keys(stages).map(k => k + ' ' + stages[k]).join(' · ') || 'no stage counts published',
      drill: 'lifecycle' })
    + FACT({ what: 'Calibration', value: has(obs.brier_claim) ? inum(obs.brier_claim, 4) : null,
      tone: (has(obs.bss_claim) && obs.bss_claim <= 0) ? 'a' : 'g',
      why: has(obs.n_sessions)
        ? ('session-level ' + obs.correct + '/' + obs.n_sessions + ' right, ' + obs.tradeable_claims
          + ' tradeable claim(s), ECE ' + inum(obs.ece_claim, 3) + ', BSS ' + inum(obs.bss_claim, 3)
          + ' — claim-frame telemetry, diagnostic')
        : 'stated confidence scored against realised outcome', drill: 'calibration' })
    + FACT({ what: 'Meta-learning', value: has(ml.resolved) ? ml.resolved : (ml.n || null),
      why: 'resolved decisions feeding the signal-weight multipliers', drill: 'metalearn' })
    + FACT({ what: 'Self-evolution', value: muted.length + ' muted', tone: muted.length ? 'a' : 'g',
      why: muted.length ? ('silenced for measured harm: ' + muted.join(', '))
        : 'no signal has demonstrated sustained harm', drill: 'evolution' })
    + FACT({ what: 'Today’s change', value: b.transition ? 'yes' : null,
      why: b.transition ? (typeof b.transition === 'string' ? b.transition
        : (b.transition.summary || JSON.stringify(b.transition)))
        : 'no transition recorded against the previous decision', drill: 'replay' })
    + '</div>'
    + (obs.n_sessions ? OBSERVATORY(obs, ob) : '')
    + (ml.multipliers || ml.learned
      ? '<table class="b-t"><thead><tr><th>learned parameter</th><th class="n">multiplier</th>'
        + '<th>direction</th></tr></thead><tbody>'
        + Object.entries(ml.multipliers || ml.learned).map(([k, v]) => {
          const m = (v && v.multiplier !== undefined) ? v.multiplier : v;
          return '<tr><td>' + ie(k) + '</td><td class="n"><b>' + (has(m) ? inum(m, 3) : NA) + '</b></td>'
            + '<td class="dim">' + (m > 1 ? 'trusted more than before' : m < 1
              ? 'trusted less than before' : 'unchanged') + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<div class="b-note">no learned multiplier yet — meta-learning needs resolved decisions.</div>');
}

/* ═══════════════════════════════════════════════════════════════════════════
   HOW MANY DAYS OF REAL DATA DOES THE BRAIN ACTUALLY UNDERSTAND?
   Spec (2026-08-09): "Never display intelligence without showing its evidence depth."
   Reads evidence.platform_date_range() (platform-wide span) and the per-provider
   first_seen/kind fields added to evidence.check() the same day — both computed by
   evidence.py, the single owner of provider attestation. This function only renders.
   ═══════════════════════════════════════════════════════════════════════════ */
function bCoverage() {
  const el = document.getElementById('bCoverage');
  if (!el) return;
  const ev = IC.d.evidence;
  if (!ev || !ev.providers) { el.innerHTML = gone(null, IC.err.evidence); return; }
  const P = ev.providers, s = ev.summary || {}, plat = ev.platform || {};
  const degraded = ['DEGRADED', 'STALE', 'EMPTY', 'ABSENT', 'ERROR']
    .reduce((n, k) => n + ((s.by_status || {})[k] || 0), 0);
  const today = (IC.d[''] || {}).date;
  const names = Object.keys(P).sort((a, b) => (P[a].available === P[b].available)
    ? (P[b].reliability - P[a].reliability) : (P[a].available ? 1 : -1));

  let h = '<div class="b-facts">' + FACTHEAD()
    + FACT({ what: 'Sessions the Brain has seen', value: has(plat.sessions) ? plat.sessions : null,
      tone: plat.sessions >= 60 ? 'g' : plat.sessions >= 20 ? 'a' : 'r',
      why: 'distinct trading sessions with any collected data, platform-wide — this is ' +
        'the denominator every coverage % below is measured against', drill: 'evidence' })
    + FACT({ what: 'Earliest data', value: plat.earliest || null,
      why: 'first session any provider on the platform has recorded', drill: 'evidence' })
    + FACT({ what: 'Latest data', value: plat.latest || null,
      tone: has(plat.latest) ? (plat.latest === today ? 'g' : 'a') : undefined,
      why: has(today) ? 'most recent session with any collected data — decision date is ' + today
        : 'most recent session with any collected data', drill: 'evidence' })
    + FACT({ what: 'Degraded / missing sources', value: degraded + ' of ' + (s.total || 0),
      tone: degraded ? (degraded > (s.total || 0) / 2 ? 'r' : 'a') : 'g',
      why: 'sources not fully OK this cycle — see table below and Evidence for detail',
      drill: 'evidence' })
    + '</div>';

  h += '<table class="b-t"><thead><tr><th>source</th><th>kind</th><th>first seen</th>'
    + '<th class="n">sessions</th><th class="n">of platform sessions</th><th>freshness</th>'
    + '</tr></thead><tbody>';
  names.forEach(n => {
    const p = P[n];
    const ofPlat = (has(p.sample_size) && plat.sessions)
      ? inum(p.sample_size / plat.sessions * 100, 0) + '%' : NA;
    h += '<tr class="' + (p.available ? '' : 'bad') + '" data-drill="sig:' + ie(n) + '" tabindex="0">'
      + '<td><b>' + ie(LBL[n] || n) + '</b></td>'
      + '<td class="dim">' + ie(p.kind || 'n/a') + '</td>'
      + '<td class="dim">' + ie(p.first_seen || (has(p.sample_size) && p.sample_size > 0 ? 'unknown' : '—')) + '</td>'
      + '<td class="n">' + (has(p.sample_size) ? p.sample_size : NA) + '</td>'
      + '<td class="n">' + ofPlat + '</td>'
      + '<td class="dim">' + (p.last_update ? ie(p.last_update) + ' · ' + (ago(p.last_update) || '') : 'never') + '</td>'
      + '</tr>';
  });
  h += '</tbody></table>'
    + '<div class="b-note">"sessions" is how many of the source\'s own rows are distinct '
    + 'trading dates (a SNAPSHOT source — one current-state row by design, e.g. Regime — '
    + 'is measured against the platform total instead, since it holds no history of its '
    + 'own). "of platform sessions" is that number against every session the whole '
    + 'platform has ever collected data for, which is the figure that answers "how many '
    + 'days does the Brain actually understand."</div>';

  el.innerHTML = h;
}

/* ═══════════════════════════════════════════════════════════════════════════
   DAILY HEALTH — did the batch that feeds most of the Brain actually run today,
   and for the sources it CAN'T reach, why not?
   Reads /api/intelligence/daily_health, which composes ops_center.eod_status()
   (did collector/eod_jobs.py's daily run complete — read from the same
   reports/.eod_done_<date> marker tools/run_eod.py itself writes) with evidence.py's
   pipeline classification (EOD_BATCH vs LIVE_PROCESS) already computed for bCoverage().
   ═══════════════════════════════════════════════════════════════════════════ */
function bDailyHealthTrace() {
  const el = document.getElementById('bDailyHealthTrace');
  if (!el) return;
  const dh = IC.d.daily_health;
  if (!dh || dh.error) { el.innerHTML = gone(null, dh ? dh.error : IC.err.daily_health); return; }
  const eod = dh.eod_batch || {}, byPipe = dh.providers_by_pipeline || {}, detail = dh.live_process_detail || {};
  const eodTone = eod.status === 'DONE' ? 'g' : eod.status === 'NOT_YET_RUN' ? 'a' : 'r';

  let h = '<div class="b-facts">' + FACTHEAD()
    + FACT({ what: 'EOD batch (' + (eod.session || '?') + ')', value: eod.status || null, tone: eodTone,
      why: eod.marker_present
        ? 'completed at ' + (eod.marker_written_at || eod.session)
        : (eod.last_error ? 'last error: ' + (eod.last_error.message || '').slice(0, 80)
          : 'no completion marker for this session yet'),
      drill: 'daily_health' })
    + FACT({ what: 'Sources fed by the daily batch', value: (byPipe.EOD_BATCH || []).length,
      why: 'written by collector/eod_jobs.py — fresh iff the EOD batch above is DONE',
      drill: 'daily_health' })
    + FACT({ what: 'Sources fed by a live process', value: (byPipe.LIVE_PROCESS || []).length,
      tone: (byPipe.LIVE_PROCESS || []).length ? 'a' : undefined,
      why: 'no EOD backfill exists for these — freshness depends on the live app/collector having been running',
      drill: 'daily_health' })
    + '</div>';

  if ((byPipe.LIVE_PROCESS || []).length) {
    h += '<table class="b-t"><thead><tr><th>source</th><th>why not EOD-batch</th></tr></thead><tbody>';
    byPipe.LIVE_PROCESS.forEach(n => {
      h += '<tr><td><b>' + ie(LBL[n] || n) + '</b></td><td class="dim wrap">'
        + ie(detail[n] || 'written by a live process, not the daily batch') + '</td></tr>';
    });
    h += '</tbody></table>';
  }

  if (eod.recent_log && eod.recent_log.length && !eod.recent_log[0].error) {
    h += '<div class="b-note">most recent EOD log entries — '
      + eod.recent_log.slice(0, 5).map(r => ie(r.level) + ' ' + ie((r.message || '').slice(0, 90))).join(' · ')
      + '</div>';
  }

  el.innerHTML = h;
}

/* ═══════════════════════════════════════════════════════════════════════════
   REGIME CONVICTION — a number SEPARATE from regime's own confidence: does the
   evidence actually back the call, corroborated by history and other signals?
   Reads /api/intelligence/regime_conviction (market_regime/conviction.py).
   ═══════════════════════════════════════════════════════════════════════════ */
function bRegimeConviction() {
  const el = document.getElementById('bRegimeConviction');
  if (!el) return;
  const rc = IC.d.regime_conviction;
  if (!rc || rc.error) { el.innerHTML = gone(null, rc ? rc.error : IC.err.regime_conviction); return; }
  if (!rc.available) { el.innerHTML = '<div class="b-note">' + ie(rc.reason || 'no regime call to assess') + '</div>'; return; }

  const ec = rc.evidence_counts || {}, cv = rc.conviction || {}, hist = rc.historical_analogues || {},
    stab = rc.regime_stability || {}, strat = rc.strategy_implications || {};
  const cvTone = cv.level === 'HIGH' ? 'g' : cv.level === 'MEDIUM' ? 'a' : 'r';

  let h = '<div class="b-facts">' + FACTHEAD()
    + FACT({ what: 'Regime', value: rc.regime + (rc.sub_regime ? ' · ' + rc.sub_regime : ''),
      tone: tn(rc.direction), why: rc.reasoning_summary || rc.playbook, drill: 'sig:regime' })
    + FACT({ what: 'Confidence (regime engine’s own)', value: inum(rc.confidence), sure: rc.confidence,
      why: 'how cleanly the engine’s own evidence clustered around this label', drill: 'sig:regime' })
    + (rc.score_band ? FACT({ what: 'Regime score', value: rc.score_band + ' (' + Math.round(rc.regime_score || 0) + '/100)',
      why: 'how EXTREME the winning characteristic is — a DIFFERENT number from confidence, which measures how SURE the engine is',
      drill: 'sig:regime' }) : '')
    + FACT({ what: 'Conviction', value: cv.level + (has(cv.score) ? ' (' + inum(cv.score) + ')' : ''), tone: cvTone,
      why: cv.note || 'confidence weighted by how much the evidence agrees, penalised for what’s missing',
      drill: 'sig:regime' })
    + FACT({ what: 'Evidence', value: ec.supporting + ' supporting / ' + ec.contradicting + ' contradicting / '
      + ec.missing_providers + ' missing',
      tone: ec.contradicting ? 'r' : (ec.missing_providers ? 'a' : 'g'),
      why: ec.missing_provider_names && ec.missing_provider_names.length
        ? 'missing: ' + ec.missing_provider_names.map(n => LBL[n] || n).join(', ')
        : (ec.unrelated ? ec.unrelated + ' evidence item(s) unrelated to this regime call' : 'all evidence accounted for'),
      drill: 'sig:regime' })
    + '</div>';

  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px">';

  // Historical analogues
  h += '<div>';
  if (hist.available) {
    h += '<div class="b-note"><b style="color:var(--text)">HISTORICAL</b> — ' + hist.n + ' comparable session(s)'
      + (has(hist.matched_family) ? ', ' + hist.matched_family + ' ' + ie(hist.family)
        + ', ' + hist.alternative + ' alternative' : '')
      + '<br><span class="dim">' + ie(hist.note || '') + '</span></div>';
  } else {
    h += '<div class="b-note"><b style="color:var(--text)">HISTORICAL</b> — ' + NA
      + '<br><span class="dim">' + ie(hist.reason || 'not available') + '</span></div>';
  }
  h += '</div>';

  // Regime stability — sequence of last N sessions
  h += '<div>';
  if (stab.sessions && stab.sessions.length) {
    h += '<div class="b-note"><b style="color:var(--text)">REGIME STABILITY</b> — last '
      + stab.sessions.length + ' session(s), ' + stab.changes + ' change(s)<br>'
      + stab.sessions.map(s => '<span class="b-p' + (tn(s.regime) ? ' t-' + tn(s.regime) : '') + '" title="'
        + ie(s.date) + '">' + ie(s.regime) + '</span>').join(' → ') + '</div>';
  } else {
    h += '<div class="b-note"><b style="color:var(--text)">REGIME STABILITY</b> — ' + NA + '</div>';
  }
  h += '</div></div>';

  // Strategy implications
  if (strat.available) {
    h += '<div class="b-note" style="margin-top:8px"><b style="color:var(--text)">STRATEGY IMPLICATION</b> — '
      + (strat.preferred.length ? 'preferred: ' + strat.preferred.map(ie).join(', ') : 'no strategy traded today')
      + (strat.rejected_for_regime.length
        ? '<br>rejected for regime: ' + strat.rejected_for_regime.map(r => ie(r.strategy) + ' (' + ie(r.reason) + ')').join('; ')
        : '')
      + (strat.other_rejected_count ? '<br><span class="dim">' + strat.other_rejected_count
        + ' other rejection(s) for non-regime reasons</span>' : '')
      + '</div>';
  } else {
    h += '<div class="b-note" style="margin-top:8px"><b style="color:var(--text)">STRATEGY IMPLICATION</b> — '
      + ie(strat.reason || 'not available') + '</div>';
  }

  h += '<div class="dim" style="margin-top:6px;font-size:9.5px">DATA FRESHNESS: '
    + ie(rc.data_freshness || 'unknown') + (ago(rc.data_freshness) ? ' · ' + ago(rc.data_freshness) : '') + '</div>';

  el.innerHTML = h;
}

/* ═══════════════════════════════════════════════════════════════════════════
   CAN THE BRAIN BE TRUSTED RIGHT NOW?
   ═══════════════════════════════════════════════════════════════════════════ */
function bHealth() {
  const el = document.getElementById('bHealth');
  if (!el) return;
  const ev = IC.d.evidence;
  if (!ev || !ev.providers) { el.innerHTML = gone(null, IC.err.evidence); return; }
  const P = ev.providers, s = ev.summary || {}, af = ev.availability || {};
  const names = Object.keys(P).sort((a, b) => (P[a].available === P[b].available)
    ? (P[b].reliability - P[a].reliability) : (P[a].available ? 1 : -1));

  let h = '<div class="b-facts">' + FACTHEAD()
    + FACT({ what: 'Evidence coverage', value: (s.available || 0) + ' of ' + (s.total || 0),
      sure: af.factor, tone: s.available === s.total ? 'g' : 'a',
      why: 'sources the system could actually read this cycle', drill: 'evidence' })
    + FACT({ what: 'Mean reliability', value: inum(s.mean_reliability), sure: s.mean_reliability,
      why: 'coverage × recency × sufficiency, averaged over every registered source',
      drill: 'evidence' })
    + FACT({ what: 'Confidence scaling', value: inum(af.factor), sure: af.factor,
      why: 'missing evidence multiplies confidence down — it can never raise it',
      drill: 'confidence' })
    + FACT({ what: 'Dead sources', value: ((s.by_status || {}).EMPTY || 0) + ((s.by_status || {}).ABSENT || 0),
      tone: (((s.by_status || {}).EMPTY || 0) + ((s.by_status || {}).ABSENT || 0)) ? 'r' : 'g',
      why: 'producers registered but holding no usable data', drill: 'evidence' })
    + '</div>';

  h += '<table class="b-t"><thead><tr><th>source</th><th>status</th><th class="n">coverage</th>'
    + '<th class="n">sessions</th><th>reliability</th><th>freshness</th><th>why</th>'
    + '</tr></thead><tbody>';
  names.forEach(n => {
    const p = P[n];
    h += '<tr class="' + (p.available ? '' : 'bad') + '" data-drill="sig:' + ie(n) + '" tabindex="0">'
      + '<td><b>' + ie(LBL[n] || n) + '</b></td>'
      + '<td>' + pill(p.available ? p.status : 'UNAVAILABLE', p.available
        ? (p.status === 'OK' ? 'g' : 'a') : 'r') + '</td>'
      + '<td class="n">' + (has(p.coverage_pct) ? inum(p.coverage_pct, 1) + '%' : NA) + '</td>'
      + '<td class="n">' + (has(p.sample_size) ? p.sample_size : NA) + '</td>'
      + '<td>' + sure(p.reliability) + '</td>'
      + '<td class="dim">' + (p.last_update ? ie(p.last_update) + ' · ' + (ago(p.last_update) || '') : 'never') + '</td>'
      + '<td class="dim wrap">' + ie(p.reason) + '</td></tr>';
  });
  el.innerHTML = h + '</tbody></table>';
}

/* ═══════════════════════════════════════════════════════════════════════════════
   RISK LOCKS — timeline cards with triggers and unlock conditions
   ═══════════════════════════════════════════════════════════════════════════════ */
function bRisk() {
  const el = document.getElementById('bRisk');
  if (!el) return;
  const rk = IC.d.risk || {}, ex = IC.d.execution || {};
  const locks = rk.locks || {};
  if (!Object.keys(locks).length) {
    el.innerHTML = '<div class="b-e">no risk locks defined — the system has no blocking conditions set</div>'; return;
  }
  let h = '<div class="b-facts">' + FACTHEAD()
    + FACT({ what: 'Risk Mode', value: has(rk.multiplier) ? (rk.multiplier === 0 ? 'STOP'
      : rk.multiplier < 1 ? 'THROTTLED ' + inum(rk.multiplier) + '×' : 'CLEAR') : null,
      tone: rk.multiplier === 0 ? 'r' : rk.multiplier < 1 ? 'a' : 'g',
      why: rk.hardest ? 'hardest lock: ' + rk.hardest : 'no lock is active', drill: 'risk' })
    + FACT({ what: 'Active Locks', value: Object.values(locks).filter(l => l.active).length
      + ' of ' + Object.keys(locks).length,
      tone: Object.values(locks).some(l => l.active) ? 'r' : 'g', drill: 'risk' })
    + '</div>';

  h += '<div class="b-lock-tl">';
  Object.keys(locks).forEach(k => {
    const l = locks[k];
    h += '<div class="b-lock-card' + (l.active ? ' active' : '') + '" data-drill="risk" tabindex="0">'
      + '<div class="lc-dot"></div>'
      + '<div class="lc-body">'
      + '<div class="lc-name">' + ie(k) + (l.active ? pill('ACTIVE', 'r') : pill('idle', ''))
      + '</div>'
      + '<div class="lc-meta">threshold: ' + (has(l.threshold) ? ie(l.threshold) : 'not set')
      + (has(l.since) ? ' · since ' + ie(l.since) : '')
      + (has(l.duration) ? ' · ' + ie(l.duration) : '') + '</div>'
      + '<div class="lc-reason">' + ie(l.reason || 'no detail') + '</div>'
      + (has(l.unlock) ? '<div style="font-size:10px;color:var(--accent);margin-top:3px">unlock: '
        + ie(l.unlock) + '</div>' : '')
      + '</div></div>';
  });
  h += '</div>'
    + '<div class="b-note gap">Any active lock can only <b>REDUCE or BLOCK</b>. It can never enlarge or approve what the system did not approve.</div>';

  el.innerHTML = h;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   EVIDENCE — market signals + provider health table
   ═══════════════════════════════════════════════════════════════════════════════ */
function bEvidence() {
  const el = document.getElementById('bEvidence');
  if (!el) return;
  const b = IC.d[''] || {}, ev = IC.d.evidence || {};
  const sig = {}, att = ev.providers || {};
  (b.signals || []).forEach(s => { sig[s.name] = s; });
  const ORDER = ['regime', 'intraday_state', 'auction_state', 'dealer_gamma', 'oi_shift',
    'positioning', 'pcr', 'iv_percentile', 'vrp_pct', 'skew', 'em_realisation',
    'mtf_agreement', 'execution_quality', 'historical_analogue'];

  let h = '<div class="b-facts">' + FACTHEAD()
    + ORDER.map(k => {
      const s = sig[k], a = att[k] || {};
      if (!s) {
        return FACT({ what: LBL[k] || k, value: null, sure: a.reliability, tone: 'r',
          why: a.reason || 'no reading produced', drill: 'sig:' + k });
      }
      return FACT({
        what: LBL[k] || k, value: has(s.value) ? String(s.value).slice(0, 26) : s.stance,
        sure: a.reliability, changed: null,
        why: s.why, tone: tn(s.stance), drill: 'sig:' + k
      });
    }).join('')
    + '</div>';

  const P = ev.providers;
  if (P) {
    const s = ev.summary || {}, names = Object.keys(P).sort((a, b) =>
      (P[a].available === P[b].available) ? (P[b].reliability - P[a].reliability)
        : (P[a].available ? 1 : -1));

    h += '<div style="display:flex;gap:12px;align-items:center;margin:12px 0 4px;font-size:10px;color:var(--muted)">'
      + '<span>' + (s.available || 0) + '/' + (s.total || 0) + ' sources · mean reliability '
      + inum(s.mean_reliability) + '</span></div>';

    h += '<table class="b-t"><thead><tr><th>source</th><th>status</th><th class="n">coverage</th>'
      + '<th class="n">sessions</th><th>reliability</th><th>freshness</th></tr></thead><tbody>';
    names.forEach(n => {
      const p = P[n];
      h += '<tr class="b-exp-row ' + (p.available ? '' : 'bad') + '" data-drill="sig:' + ie(n) + '" tabindex="0">'
        + '<td><b>' + ie(LBL[n] || n) + '</b></td>'
        + '<td>' + pill(p.available ? p.status : 'UNAVAILABLE', p.available
          ? (p.status === 'OK' ? 'g' : 'a') : 'r') + '</td>'
        + '<td class="n">' + (has(p.coverage_pct) ? inum(p.coverage_pct, 1) + '%' : NA) + '</td>'
        + '<td class="n">' + (has(p.sample_size) ? p.sample_size : NA) + '</td>'
        + '<td>' + sure(p.reliability) + '</td>'
        + '<td class="dim">' + (ago(p.last_update) || 'never') + '</td></tr>'
        + '<tr class="b-exp-detail" data-drill="sig:' + ie(n) + '">'
        + '<td colspan="6"><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">'
        + '<div><b style="color:var(--text)">Status</b><br>' + ie(p.status || 'n/a')
        + (p.available ? '' : ' — ' + ie(p.reason)) + '</div>'
        + '<div><b style="color:var(--text)">Coverage</b><br>' + (has(p.coverage_pct) ? inum(p.coverage_pct, 1) + '%' : 'n/a')
        + ' · ' + (has(p.sample_size) ? p.sample_size + ' sessions' : '') + '</div>'
        + '<div><b style="color:var(--text)">Last Updated</b><br>' + ie(p.last_update || 'never')
        + (p.last_update ? ' (' + (ago(p.last_update) || '') + ')' : '') + '</div>'
        + (has(p.reason) ? '<div style="grid-column:1/-1"><b style="color:var(--text)">Detail</b><br>' + ie(p.reason) + '</div>' : '')
        + '</div></td></tr>';
    });
    h += '</tbody></table>';
  }
  el.innerHTML = h;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   DECISION HISTORY — timeline from replay data
   ═══════════════════════════════════════════════════════════════════════════════ */
function bHistory() {
  const el = document.getElementById('bHistory');
  if (!el) return;
  const rp = IC.d.replay || {}, b = IC.d[''] || {};
  const events = rp.history || rp.events || rp.decisions || [];

  if (!events.length) {
    const mem = IC.d.memory || {};
    const cl = mem.closest || {};
    let h = '<div class="b-facts">' + FACTHEAD()
      + FACT({ what: 'Closest historical day', value: cl.date || null, sure: mem.reliable ? 0.8 : 0.2,
        tone: mem.reliable ? 'g' : 'a',
        why: has(cl.distance) ? ('distance ' + inum(cl.distance) + (mem.reliable ? ' — usable'
          : ' — ' + (mem.why_not_reliable || 'too far'))) : 'no analogue within range',
        drill: 'memory' })
      + FACT({ what: 'Today\'s change', value: b.transition ? 'transition recorded' : 'no change',
        tone: b.transition ? 'a' : 'g',
        why: b.transition ? (typeof b.transition === 'string' ? b.transition
          : (b.transition.summary || JSON.stringify(b.transition)))
          : 'no transition recorded against the previous decision', drill: 'replay' })
      + '</div>'
      + '<div class="b-note">Decision history is built session-by-session. '
      + (rp.history === undefined ? 'No replay data available yet — the engine records decisions over time.' : 'No decisions recorded yet.') + '</div>';
    el.innerHTML = h; return;
  }

  let h = '<div class="b-timeline">';
  events.slice(0, 30).forEach(e => {
    const tone = tn(e.decision || e.action || '');
    h += '<div class="b-tl-entry ' + tone + '" data-drill="replay" tabindex="0">'
      + '<div class="ts">' + ie(e.date || e.ts || '') + '</div>'
      + '<div class="txt"><b>' + ie(e.decision || e.action || e.verdict || '')
      + '</b>' + (e.confidence ? ' · ' + inum(e.confidence) : '')
      + (e.strategy ? ' · ' + ie(String(e.strategy).slice(0, 30)) : '')
      + '</div>'
      + (e.reason ? '<div style="font-size:10px;color:var(--muted)">' + ie(e.reason) + '</div>' : '')
      + '</div>';
  });
  h += '</div>';
  if (events.length > 30) h += '<div class="b-note">' + (events.length - 30) + ' more entries not shown.</div>';
  el.innerHTML = h;
}

/* ═══════════════════════════════════════════════════════════════════════════
   INSPECTOR — what / why / how sure / what changed / what next
   ═══════════════════════════════════════════════════════════════════════════ */
function bDrill(key) {
  if (!key) return;
  const dr = document.getElementById('bDrill'), bd = document.getElementById('bDrillBody'),
    ti = document.getElementById('bDrillTitle');
  if (!dr || !bd) return;
  const b = IC.d[''] || {};
  let title = key, payload = null, five = {};

  if (key.indexOf('sig:') === 0) {
    const n = key.slice(4);
    const s = (b.signals || []).find(x => x.name === n);
    const a = ((IC.d.evidence || {}).providers || {})[n] || {};
    title = LBL[n] || n;
    payload = { signal: s || null, evidence_contract: a };
    five = {
      what: s ? String(s.value) : 'no reading',
      why: s ? s.why : (a.reason || 'unavailable'),
      sure: has(a.reliability) ? inum(a.reliability) + ' reliability, ' + (a.sample_size || 0)
        + ' sessions, ' + (has(a.coverage_pct) ? inum(a.coverage_pct, 1) + '% coverage' : 'coverage n/a') : 'not measured',
      changed: 'not tracked per-signal — see the decision transition',
      next: NEXT[n] || 'this fact feeds the system directly; no separate threshold'
    };
  } else if (key.indexOf('strat:') === 0) {
    const n = key.slice(6);
    const list = (IC.d.competition || {}).ranked || (IC.d.competition || {}).strategies || [];
    const s = list.find(x => x.strategy === n) || {};
    title = n;
    payload = s;
    five = { what: s.verdict || 'no verdict', why: s.reason || s.why || '',
      sure: has(s.trades) ? s.trades + ' resolved trades' : 'sample not published',
      changed: 'not tracked per-strategy',
      next: 'reaching the minimum trade count moves a WATCH strategy to actionable' };
  } else if (key === 'decision' || key === 'permission' || key === 'capital') {
    title = { decision: 'The decision', permission: 'Trading permission',
      capital: 'Capital allocation' }[key];
    payload = { allocation: b.allocation, readiness: b.readiness, plan: IC.d.execution };
    five = { what: (IC.d.execution || {}).action || (b.readiness || {}).state,
      why: (IC.d.execution || {}).reason || (b.readiness || {}).reason || '',
      sure: inum((b.confidence || {}).confidence) + ' confidence',
      changed: b.transition ? JSON.stringify(b.transition) : 'no transition recorded',
      next: 'confidence above the sizing floor with no active hard lock permits a position' };
  } else if (key === 'confidence') {
    title = 'Confidence'; payload = b.confidence;
    five = { what: inum((b.confidence || {}).confidence),
      why: 'ceiling × agreement strength × dominant-axis majority ratio × availability',
      sure: (b.confidence || {}).tier + ' · ' + (b.confidence || {}).sessions + ' sessions',
      changed: 'recomputed every cycle from live evidence',
      next: 'more sessions raise the ceiling; more available evidence raises the scaling' };
  } else if (key === 'contradictions') {
    title = 'Contradictions'; payload = b.contradictions;
    five = { what: (b.contradictions || []).length + ' unresolved',
      why: 'direction and volatility are tested on separate axes and never conflated',
      sure: 'derived from the signals themselves', changed: '—',
      next: 'dissent scales confidence by how lopsided the dominant-axis split is — it cannot zero out a majority' };
  } else {
    title = LBL[key] || key;
    payload = IC.d[key] !== undefined ? IC.d[key] : null;
    if (payload === null && IC.err[key]) five = { what: 'unavailable', why: IC.err[key] };
  }

  ti.textContent = title;
  const rows = [['WHAT', five.what], ['WHY', five.why], ['HOW SURE', five.sure],
    ['WHAT CHANGED', five.changed], ['WHAT NEXT', five.next]]
    .filter(r => has(r[1]));
  bd.innerHTML = (rows.length ? '<div class="b-five">' + rows.map(r =>
    '<div><span>' + r[0] + '</span><p>' + ie(r[1]) + '</p></div>').join('') + '</div>' : '')
    + '<div class="b-json-wrap"><button class="b-json-tog" onclick="this.parentElement.classList.toggle(\'on\')">'
    + '\u25B8 Advanced · Raw Runtime Data</button>'
    + '<pre class="b-json">' + ie(JSON.stringify(payload, null, 2) || 'no payload') + '</pre></div>';
  dr.classList.add('on');
  IC.open = key;
}
function bCloseDrill() {
  const dr = document.getElementById('bDrill');
  if (dr) dr.classList.remove('on');
  IC.open = null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   CYCLE
   ═══════════════════════════════════════════════════════════════════════════ */
async function bFetch() {
  await Promise.all(IC.EP.map(async k => {
    const url = '/api/intelligence' + (k ? '/' + k : '');
    try {
      const r = await jget(url, 8000);
      if (r && r.error) { IC.err[k] = r.error; } else { IC.d[k] = r; delete IC.err[k]; }
    } catch (e) { IC.err[k] = 'HTTP ' + (e && e.message ? e.message : e); }
  }));
  IC.ts = new Date();
}

function bRender() {
  bVerdict(); bCoverage(); bDailyHealthTrace(); bConfidence(); bRegimeConviction(); bWhy(); bMarket(); bRisk(); bStrategy();
  bEvidence(); bPortfolio(); bExec(); bHistory(); bLearning(); bHealth();
  if (IC.open) bDrill(IC.open);
}

async function renderIntelligence() {
  const h = document.getElementById('bVerdict');
  if (h && !h.innerHTML.trim()) h.innerHTML = '<div class="b-e">Reading signals…</div>';
  await bFetch();
  bRender();
  bStopLive();
  IC.timer = setInterval(async () => {
    const p = document.getElementById('page-intelligence');
    if (!p || !p.classList.contains('on') || document.hidden) return;
    await bFetch(); bRender();
  }, 15000);
}
function bStopLive() { if (IC.timer) { clearInterval(IC.timer); IC.timer = null; } }

document.addEventListener('click', e => {
  if (!e.target.closest) return;
  if (e.target.closest('#bDrillClose')) { bCloseDrill(); return; }
  if (e.target.closest('.b-json-tog')) return;
  const er = e.target.closest('.b-exp-row');
  if (er) { er.classList.toggle('on'); e.stopPropagation(); return; }
  const d = e.target.closest('[data-drill]');
  if (d && d.closest('#page-intelligence')) { e.stopPropagation(); bDrill(d.getAttribute('data-drill')); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') bCloseDrill();
  else if (e.key === 'Enter') {
    const a = document.activeElement;
    if (a && a.getAttribute && a.getAttribute('data-drill')) bDrill(a.getAttribute('data-drill'));
  }
});

/* bottom sheet: swipe down on the open inspector closes it (mobile only) */
(function () {
  const dr = document.getElementById('bDrill');
  if (!dr) return;
  let y0 = null;
  dr.addEventListener('touchstart', e => {
    y0 = (window.innerWidth <= 900 && e.touches.length === 1) ? e.touches[0].clientY : null;
  }, { passive: true });
  dr.addEventListener('touchend', e => {
    if (y0 === null) return;
    const t = (e.changedTouches && e.changedTouches[0]) || null;
    if (t && (t.clientY - y0) > 60) bCloseDrill();
    y0 = null;
  }, { passive: true });
})();

window.renderIntelligence = renderIntelligence;
window.bCloseDrill = bCloseDrill;
