
/* ═══ APEX mobile behaviour ═══════════════════════════════════════════════════
   Deliberately additive: it drives the EXISTING nav()/applyTheme()/loop()
   functions rather than duplicating them, so the phone and the desktop can
   never drift out of sync. */
(function () {
  /* ══ OFF BY DEFAULT — back to the original, fast PWA ══════════════════════
     Everything in this block was added AFTER the PWA was working. Each piece was
     small; together they became a permanent background load on the phone:

       a MutationObserver watching the content area
       table wrapping and tile sizing re-running on every render
       touch handlers on document for swipe and pull-to-refresh
       a bottom tab bar, a sheet, an alert poller

     The first PWA had none of it and was quick. So the default is now that state:
     manifest, service worker, install button, and the dashboard - nothing else.

     The CSS below still applies, because stylesheet rules cost nothing to leave in
     place. Only the JavaScript is off. To try the extras again, set this to true. */
  var MOBILE_EXTRAS = true;
  if (!MOBILE_EXTRAS) return;

  var MOBILE = function () { return window.innerWidth <= 900; };
  function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 8); } catch (e) {} }

  /* ---- tab bar drives the real nav() so the sidebar stays in sync ---- */
  window.mgo = function (page, el) {
    buzz(8);
    var side = document.querySelector('.sb-item[data-page="' + page + '"]');
    if (side && typeof nav === 'function') nav(page, side);
    syncTabs(page);
    var c = document.querySelector('.content');
    if (c) c.scrollTop = 0;
  };

  function syncTabs(page) {
    document.querySelectorAll('.mtab[data-tab]').forEach(function (t) {
      t.classList.toggle('on', t.dataset.tab === page);
    });
  }

  // whichever route the user takes (drawer, tab bar, sheet), the tab bar follows
  if (typeof window.nav === 'function') {
    var _nav = window.nav;
    window.nav = function (page, el) { var r = _nav(page, el); syncTabs(page); return r; };
  }
  syncTabs('live');

  /* ---- table scroll-boxing ------------------------------------------------
     The pages build their tables with innerHTML, so a table can appear at any
     time. Every table that is not already inside a horizontal scroller gets
     wrapped in one. This is what stops a wide table from stretching the whole
     document (the cause of the misaligned columns + the white gap on the right
     and bottom). data-mwrapped guards against the observer re-entering. */
  var STACK_FROM = 5;          // more columns than this and the table becomes cards

  /* Decide, per table, between two mobile treatments:
       <= STACK_FROM columns  -> leave it as a table, it fits across the screen
       >  STACK_FROM columns  -> .mstack: every row becomes a card, no sideways scroll
     Grouped/two-tier headers (any colspan) are left alone and merely scroll-boxed,
     because a card built from a merged header would mislabel its own values. */
  function treat(t) {
    var heads = t.querySelectorAll('thead tr');
    if (!heads.length) return null;
    var last = heads[heads.length - 1];
    var ths = last.querySelectorAll('th');
    if (!ths.length) return null;
    for (var i = 0; i < ths.length; i++) {
      if ((parseInt(ths[i].getAttribute('colspan'), 10) || 1) > 1) return null;   // grouped
    }
    if (ths.length <= STACK_FROM) return null;
    var labels = [];
    ths.forEach(function (th) { labels.push((th.textContent || '').trim()); });
    return labels;
  }

  function stack(t, labels) {
    t.classList.add('mstack');
    t.querySelectorAll('tbody tr').forEach(function (tr) {
      tr.querySelectorAll('td').forEach(function (td, i) {
        if (labels[i] && !td.hasAttribute('data-l')) td.setAttribute('data-l', labels[i]);
      });
    });
  }

  function boxTables() {
    if (!MOBILE()) return;
    document.querySelectorAll('table').forEach(function (t) {
      if (t.dataset.mwrapped) {
        // rows are re-rendered constantly; keep the labels current on a stacked table
        if (t.classList.contains('mstack')) {
          var l = (t.dataset.mlabels || '').split('~|~');
          if (l.length > 1) stack(t, l);
        }
        return;
      }
      t.dataset.mwrapped = '1';

      var labels = treat(t);
      if (labels) {
        t.dataset.mlabels = labels.join('~|~');
        stack(t, labels);
        return;                                  // cards do not need a scroll box
      }

      var p = t.parentElement;
      if (!p) return;
      if (p.classList.contains('mscroll') || p.classList.contains('tbl-scroll')) return;
      var ov = getComputedStyle(p).overflowX;
      if (ov === 'auto' || ov === 'scroll') return;

      var box = document.createElement('div');
      box.className = 'mscroll';
      p.insertBefore(box, t);
      box.appendChild(t);
    });
  }

  /* ---- flex tiles: wrap, never compress -----------------------------------
     MY OWN EARLIER FIX CAUSED THIS ONE. To stop hard-coded desktop widths from
     making the document wider than the screen, I zeroed every inline min-width
     inside .content. That killed the overflow - and also killed the floor that
     was making these tiles WRAP. A row of `flex:1 1 120px; min-width:118px`
     KPI tiles is designed to break onto a second line once it runs out of room;
     with the floor gone they just squeeze together instead, and the content
     inside gets clipped. That is the cut-off KPI row on the home page.

     So rather than deleting the intent, read it: the authored min-width tells us
     how much room the tile actually needs. Wide tiles (>=180px) take a full row,
     narrower ones pair up, and everything goes single-column on a small phone.
     min-width still becomes 0, so the overflow fix stays intact. */
  /* PERFORMANCE NOTE - this function was a disaster and has been rewritten.

     The first version did this, on every DOM mutation:

         document.querySelectorAll('.content div').forEach(el => {
           var cs = getComputedStyle(el);      // <-- forced style recalculation
           ...

     getComputedStyle() flushes pending style and layout work before it can answer.
     Calling it on EVERY div in the content area, every time any table re-rendered -
     which is several times a second while the feed is live - meant hundreds of
     forced reflows per second. On a desktop that is merely wasteful. On a phone it
     is the whole frame budget, which is why the app crawled and would not install:
     the browser never got an idle moment.

     Two changes fix it:
       1. query only the elements that can possibly matter - the handful with an
          inline min-width - instead of every div. That is ~10 nodes, not ~800.
       2. mark each one done. The authored min-width never changes, so the answer
          never changes; recomputing it on every mutation was pure waste.

     Result: getComputedStyle is not called at all, and the whole pass is a no-op
     after the first run for any given element. */
  function fitTiles() {
    if (!MOBILE()) return;
    var solo = window.innerWidth < 560;
    var want = solo ? '100%' : 'calc(50% - 6px)';
    document.querySelectorAll('.content [style*="min-width"]').forEach(function (ch) {
      if (ch.dataset.mfit === want) return;            // already sized for this width
      var st = ch.getAttribute('style') || '';
      var m = st.match(/min-width:\s*(\d+)px/);
      if (!m) { ch.dataset.mfit = want; return; }
      var need = +m[1];
      ch.style.minWidth = '0';
      ch.style.flexGrow = '1';
      ch.style.flexBasis = (need >= 180 || solo) ? '100%' : want;
      ch.dataset.mfit = want;
    });
  }

  /* Debounced by a TIMER, not requestAnimationFrame.
     rAF fires up to 60 times a second, and the observer that calls this triggers on
     every table re-render - so the "debounce" was still running the whole pass 60x
     a second while the feed was live. A table that has just been rebuilt does not
     need wrapping within 16ms; a quarter of a second is imperceptible and costs
     roughly 1/15th as much work. */
  var boxTimer = null;
  function scheduleBox() {
    if (boxTimer) return;
    boxTimer = setTimeout(function () {
      boxTimer = null;
      boxTables();
      fitTiles();
    }, 250);
  }

  boxTables(); fitTiles();
  try {
    // Scoped to .content, not document.body. The observer used to fire on every
    // mutation anywhere in the page - including the clock ticking once a second and
    // every toast - when the only thing it cares about is tables appearing inside
    // the content area.
    var _obsRoot = document.querySelector('.content') || document.body;
    new MutationObserver(scheduleBox).observe(_obsRoot, {childList: true, subtree: true});
  } catch (e) {}
  window.addEventListener('resize', scheduleBox);
  window.addEventListener('orientationchange', function () { setTimeout(scheduleBox, 250); });

  /* ---- theme picker: uses the dashboard's own applyTheme() + localStorage ---- */
  /* reuse the dashboard's own THEMES list so names + swatches can never drift */
  function themeList() {
    try { if (Array.isArray(THEMES) && THEMES.length) return THEMES; } catch (e) {}
    return [{id: 'dark', name: 'Carbon', c: ['#070A0F', '#36D6E7', '#A98BFF']},
            {id: 'light', name: 'Daylight', c: ['#F4F6FA', '#0A93A3', '#6E4DD6']}];
  }
  function paintThemes() {
    var cur = document.documentElement.getAttribute('data-theme') || 'dark';
    document.getElementById('thGrid').innerHTML = themeList().map(function (t) {
      return '<div class="th-sw' + (t.id === cur ? ' on' : '') + '" data-th="' + t.id + '">' +
             '<div class="th-dot" style="background:' + t.c[0] +
             ';box-shadow:inset -14px 0 0 ' + t.c[1] + ', inset -7px 0 0 ' + t.c[2] + '"></div>' +
             t.name + '</div>';
    }).join('');
    document.querySelectorAll('.th-sw').forEach(function (s) {
      s.onclick = function () {
        buzz(10);
        var id = this.dataset.th;
        if (typeof applyTheme === 'function') applyTheme(id);
        else document.documentElement.setAttribute('data-theme', id);
        try { localStorage.setItem('apexTheme', id); } catch (e) {}
        // repaint the browser/OS status bar to match
        var m = document.querySelector('meta[name="theme-color"]');
        if (m) m.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--bg2').trim() || '#070A0F');
        paintThemes();
      };
    });
  }

  /* ---- notifications: alerts already exist in /api/alerts; we just surface the
     NEW ones as OS notifications. Shown through the service worker so Android
     still delivers them when the app is only backgrounded (not force-closed). ---- */
  /* ── notification categories ───────────────────────────────────────────
     The alert engine emits sixteen alert_types. Pushing all of them to a phone
     would be the fastest possible way to make you stop reading them - on a
     trending day the level-cross family alone fires repeatedly, and once a
     person learns to swipe a notification away without reading it, the ONE that
     mattered gets swiped away too.

     So: notifications are off until you turn them on, and when you do, only the
     two genuinely urgent families are enabled. The rest are opt-in per category.
     Matching is by prefix against alert_type, so a new alert name joins its
     family automatically instead of silently escaping the filter. */
  var NOTIF_CATS = [
    {id: 'spike', n: 'Straddle spike / 50% move',
     d: 'Sharp premium moves — the ones that change a position',
     px: ['STRADDLE_SPIKE', 'STRADDLE_DROP', 'STRADDLE_RISE', 'VELOCITY'], def: true},
    {id: 'vix', n: 'VIX spike',
     d: 'Volatility regime shifting under you', px: ['VIX_SPIKE'], def: true},
    {id: 'nifty', n: 'Nifty level breaks',
     d: 'Previous day / week / month highs and lows',
     px: ['NIFTY_P'], def: false},
    {id: 'strd', n: 'Straddle level breaks',
     d: 'Straddle premium crossing its own prior levels',
     px: ['STRADDLE_PD', 'STRADDLE_PW', 'STRADDLE_PM'], def: false},
    {id: 'decay', n: 'Low decay warning',
     d: 'Theta not behaving as expected for the day', px: ['LOW_DECAY'], def: false},
    {id: 'sys', n: 'System warnings',
     d: 'Feed, engine and data problems', px: ['WARN', 'ERROR'], def: false}
  ];
  var NF_KEY = 'apexNotifCats';

  function notifCats() {
    try {
      var v = JSON.parse(localStorage.getItem(NF_KEY) || 'null');
      if (Array.isArray(v)) return v;
    } catch (e) {}
    return NOTIF_CATS.filter(function (c) { return c.def; }).map(function (c) { return c.id; });
  }
  function setNotifCats(ids) {
    try { localStorage.setItem(NF_KEY, JSON.stringify(ids)); } catch (e) {}
  }
  function catAllows(atype) {
    var t = String(atype || '').toUpperCase();
    var on = notifCats();
    for (var i = 0; i < NOTIF_CATS.length; i++) {
      var c = NOTIF_CATS[i];
      for (var j = 0; j < c.px.length; j++) {
        if (t.indexOf(c.px[j]) === 0) return on.indexOf(c.id) !== -1;
      }
    }
    return false;             // unknown type: stay quiet rather than surprise you
  }
  window.__apexNotif = {cats: NOTIF_CATS, get: notifCats, set: setNotifCats, allows: catAllows};

  var SEEN_KEY = 'apexSeenAlerts';
  function seen() { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch (e) { return []; } }
  function markSeen(ids) { try { localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-300))); } catch (e) {} }

  function notifyState() {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;             // 'granted' | 'denied' | 'default'
  }

  async function askNotify() {
    if (!('Notification' in window)) { alert('This browser cannot show notifications.'); return; }
    var p = await Notification.requestPermission();
    buzz(12);
    if (p === 'granted') {
      show('StraddleEDGE alerts ON', 'You will get a notification the moment a new alert fires.');
      markSeen(await currentIds());               // do not replay history on first enable
    }
    paintRows();
  }

  async function show(title, body) {
    try {
      var reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) {
        reg.showNotification(title, {body: body, icon: '/pwa/icon-192.png',
                                     badge: '/pwa/icon-192.png', tag: 'apex', renotify: true,
                                     data: {url: '/edge?go=logs'}});
      } else { new Notification(title, {body: body, icon: '/pwa/icon-192.png'}); }
    } catch (e) {}
  }

  async function currentIds() {
    try {
      var r = await fetch('/api/alerts', {cache: 'no-store'});
      var a = await r.json();
      return (a || []).map(function (x) { return x.id; }).filter(function (x) { return x != null; });
    } catch (e) { return seen(); }
  }

  async function pollAlerts() {
    try {
      var r = await fetch('/api/alerts', {cache: 'no-store'});
      var list = (await r.json()) || [];
      window.__alerts = list;  // shared cache for renderLogs/trkAlerts
      if (notifyState() !== 'granted') return;
      var known = seen(), fresh = [], all = [];
      list.forEach(function (a) {
        if (a.id == null) return;
        all.push(a.id);
        // Unsubscribed categories are marked seen WITHOUT notifying, so switching
        // a category on later does not replay everything it missed.
        if (known.indexOf(a.id) === -1 && catAllows(a.alert_type)) fresh.push(a);
      });
      if (fresh.length) {
        if (fresh.length === 1) show('StraddleEDGE · ' + (fresh[0].alert_type || 'alert'), fresh[0].message || '');
        else show('StraddleEDGE · ' + fresh.length + ' new alerts', (fresh[0].message || '').slice(0, 90));
        buzz([12, 60, 12]);
      }
      markSeen(known.concat(all));
    } catch (e) {}
  }
  setInterval(pollAlerts, 20000);
  pollAlerts();  // initial fetch immediately

  /* ---- the More sheet ---- */
  /* 'intelligence' (Intelligence Centre) added 2026-08-08 — it existed in the desktop
     sidebar (straddleedge.html, data-page="intelligence") with its own 59KB bundle and
     17 API endpoints, but was never added here, so mobile users had no menu path to it
     at all. Ordered to match the desktop sidebar exactly (Research Lab -> Intelligence
     Centre -> Option Chain). */
  // 'decaylab' (Overnight Decay Lab) added 2026-08-09, Task C item 4 — same class of
  // gap the 'intelligence' comment above documents: a new desktop sidebar entry
  // (data-page="decaylab") with no mobile menu path unless added here too.
  var PAGES = [['live', 'Live Straddle'], ['strategies', 'Strategy Lab'], ['lab', 'Decision Board'],
               ['research', 'Research Lab'], ['intelligence', 'Intelligence Centre'],
               ['chain', 'Option Chain'], ['tracker', 'My Tracker'],
               ['flow', 'Market Pulse'], ['vrp', 'VRP · IV/RV'], ['ivgreeks', 'IV & Greeks'],
               ['skew', 'Skew & Synthetic'], ['decaylab', 'Overnight Decay Lab'],
               ['history', 'History'], ['logs', 'Alerts'],
               ['settings', 'Settings']];
  /* Strip pages this instance keeps private BEFORE publishing. auth.js sets
     window.__apexHiddenPages from /api/auth/config; it runs in the critical defer
     bundle while this file is lazy (requestIdleCallback), so by the time we get here
     the list is already there. Filtering on THIS side is what makes it reliable —
     auth.js splicing __apexPages could not work, because this assignment replaces
     whatever it spliced. Empty/undefined list (the local machine) = no filtering. */
  var _hidden = window.__apexHiddenPages || [];
  if (_hidden.length) PAGES = PAGES.filter(function (p) { return _hidden.indexOf(p[0]) === -1; });
  window.__apexPages = PAGES;      // same object, mutated in place by mergeIntel()
  // RACE FIX 2026-08-25 (cloud review bug_003). The read above is SYNCHRONOUS, but
  // auth.js only assigns __apexHiddenPages inside _authConfig().then() — i.e. after
  // fetch('/api/auth/config') resolves. auth.js merely STARTING first is not the same
  // as its fetch having COMPLETED, so on a cold/slow load this lazily-scheduled file
  // can run first, read undefined, and publish the UNFILTERED list; opening the More
  // sheet in that window shows the private entries until a later render converges.
  // (Cosmetic only — those routes are 404'd server-side by _PrivatePagesMiddleware and
  // the routers are not mounted, so nothing leaks — but the point of hiding them is
  // that they never appear.) Re-filter IN PLACE once the real list lands: splice, not
  // reassign, because window.__apexPages must stay the same object mergeIntel() holds.
  if (typeof window._authConfig === 'function') {
    window._authConfig().then(function (cfg) {
      var hp = (cfg && cfg.hidden_pages) || [];
      if (!hp.length) return;
      for (var i = PAGES.length - 1; i >= 0; i--) {
        if (hp.indexOf(PAGES[i][0]) !== -1) PAGES.splice(i, 1);
      }
    }).catch(function () {});
  }

  function paintRows() {
    var ns = notifyState();
    var installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    var rows = [
      {ico: '🔔', t: 'Alert notifications',
       st: ns === 'granted' ? 'ON' : ns === 'denied' ? 'BLOCKED' : 'OFF',
       cls: ns === 'granted' ? 'ok' : ns === 'denied' ? 'off' : '', fn: 'notify'},
      {ico: '↻', t: 'Refresh now', st: '', cls: '', fn: 'refresh'},
      {ico: '📲', t: 'Install as app', st: installed ? 'INSTALLED' : 'TAP', cls: installed ? 'ok' : '', fn: 'install'},
      {ico: '⌘', t: 'Search & commands', st: 'Ctrl+K', cls: '', fn: 'cmdk'},
      {ico: '🩺', t: 'PWA self-test', st: '/pwa-check', cls: '', fn: 'check'}
    ];
    document.getElementById('shRows').innerHTML = rows.map(function (r) {
      return '<div class="sh-row" data-fn="' + r.fn + '"><span class="ico">' + r.ico + '</span>' +
             '<span>' + r.t + '</span><span class="st ' + r.cls + '">' + r.st + '</span></div>';
    }).join('');
    document.querySelectorAll('#shRows .sh-row').forEach(function (el) {
      el.onclick = function () {
        var f = this.dataset.fn;
        buzz(8);
        if (f === 'notify') askNotify();
        else if (f === 'refresh') { if (typeof loop === 'function') loop(); closeSheet(); }
        else if (f === 'install') { var b = document.getElementById('pwaInstall'); if (b) { closeSheet(); b.click(); } }
        else if (f === 'cmdk') { closeSheet(); setTimeout(function () { if (window.openCommandPalette) openCommandPalette(); }, 120); }
        else if (f === 'check') location.href = '/pwa-check';
      };
    });
    document.getElementById('shPages').innerHTML = PAGES.map(function (p) {
      return '<div class="sh-row" data-pg="' + p[0] + '"><span class="ico">›</span><span>' + p[1] + '</span></div>';
    }).join('');
    document.querySelectorAll('#shPages .sh-row').forEach(function (el) {
      el.onclick = function () { mgo(this.dataset.pg); closeSheet(); };
    });
  }

  window.openSheet = function () { buzz(8); paintThemes(); paintRows(); document.getElementById('msheet').classList.add('show'); };
  window.closeSheet = function () { document.getElementById('msheet').classList.remove('show'); };

  /* ---- swipe to open the drawer -------------------------------------------
     MY FIRST VERSION ONLY ACCEPTED A SWIPE STARTING IN THE LEFT 22px, AND THAT
     COULD NOT WORK. On Android, the left screen edge belongs to the OPERATING
     SYSTEM: in a standalone PWA an edge swipe is the system BACK gesture, and the
     OS claims it before the page ever sees a touchstart. A web app cannot opt out
     of that. So the gesture was competing for a strip it was never going to win.

     The fix is to stop using the edge at all. The swipe may begin ANYWHERE, and
     the conflict with horizontal content is solved by looking at WHAT was touched
     instead of WHERE: if the finger landed inside anything that scrolls sideways -
     the wrapped tables, the chain, a chart canvas - the gesture is that element's
     and we never claim it. Everywhere else, a rightward drag opens the drawer.

     Direction is decided once, in the first few pixels, then locked. Judging it
     per-frame is what makes home-made gestures feel unsteady: a slightly diagonal
     swipe flickers between opening the drawer and scrolling the page. */
  (function () {
    var OPEN_AT = 14;   // short swipe: 14px opens
    var sb = document.getElementById('sidebar');
    if (!sb) return;
    var x0 = null, y0 = null, axis = null, armed = false;

    function ownsHorizontal(el) {
      for (var n = el; n && n !== document.body; n = n.parentElement) {
        if (!n.classList) continue;
        if (n.classList.contains('mscroll') || n.classList.contains('tbl-scroll') ||
            n.classList.contains('statbar') || n.classList.contains('ix-strip') ||
            n.classList.contains('ov-strip') ||
            n.tagName === 'CANVAS' || n.tagName === 'INPUT' || n.tagName === 'SELECT') return true;
        try {
          var ov = getComputedStyle(n).overflowX;
          if ((ov === 'auto' || ov === 'scroll') && n.scrollWidth > n.clientWidth + 4) return true;
        } catch (e) {}
      }
      return false;
    }

    document.addEventListener('touchstart', function (e) {
      armed = false; x0 = null;
      if (!MOBILE() || e.touches.length !== 1) return;
      var isOpen = sb.classList.contains('mobile-open');
      if (isOpen) {
        var t = e.touches[0];
        x0 = t.clientX; y0 = t.clientY; axis = null; armed = true;
        return;
      }
      if (ownsHorizontal(e.target)) return;
      var t2 = e.touches[0];
      x0 = t2.clientX; y0 = t2.clientY; axis = null; armed = true;
    }, {passive: true});

    document.addEventListener('touchmove', function (e) {
      if (!armed || x0 === null) return;
      var t = e.touches[0], dx = t.clientX - x0, dy = t.clientY - y0;
      if (axis === null) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
        if (axis === 'y') { armed = false; x0 = null; return; }
      }
    }, {passive: true});

    document.addEventListener('touchend', function (e) {
      if (armed && x0 !== null && axis === 'x') {
        var t = (e.changedTouches && e.changedTouches[0]) || null;
        if (t) {
          var dx = t.clientX - x0;
          if (sb.classList.contains('mobile-open') && dx < -OPEN_AT) {
            if (typeof closeMobileSidebar === 'function') closeMobileSidebar();
            try { if (navigator.vibrate) navigator.vibrate(6); } catch (err) {}
          } else if (!sb.classList.contains('mobile-open') && dx > OPEN_AT) {
            if (typeof toggleSidebar === 'function') toggleSidebar();
            try { if (navigator.vibrate) navigator.vibrate(8); } catch (err) {}
          }
        }
      }
      x0 = null; y0 = null; axis = null; armed = false;
    }, {passive: true});

    /* Swipe left ON the open drawer closes it. Tap-outside already closes it via
       the existing backdrop, so that is left alone rather than duplicated. */
    var sx = null;
    sb.addEventListener('touchstart', function (e) {
      sx = (e.touches.length === 1) ? e.touches[0].clientX : null;
    }, {passive: true});
    sb.addEventListener('touchend', function (e) {
      if (sx === null) return;
      var t = (e.changedTouches && e.changedTouches[0]) || null;
      if (t && (sx - t.clientX) > OPEN_AT && typeof closeMobileSidebar === 'function') {
        closeMobileSidebar();
        try { if (navigator.vibrate) navigator.vibrate(6); } catch (err) {}
      }
      sx = null;
    }, {passive: true});
  })();

  /* ---- pull to refresh (only at the very top of the scroller) ---- */
  (function () {
    var c = document.querySelector('.content');
    if (!c) return;
    var y0 = null, pull = 0, ptr = document.getElementById('ptr');
    var LIMIT = 70;
    c.addEventListener('touchstart', function (e) {
      y0 = (c.scrollTop <= 0 && e.touches.length === 1) ? e.touches[0].clientY : null;
      pull = 0;
    }, {passive: true});
    c.addEventListener('touchmove', function (e) {
      if (y0 === null) return;
      pull = e.touches[0].clientY - y0;
      if (pull <= 0) { ptr.classList.remove('show'); return; }
      var d = Math.min(pull, LIMIT * 1.6);
      // position is fixed in CSS; only the glyph changes as the threshold is crossed
      ptr.classList.add('show');
      ptr.textContent = d >= LIMIT ? '↻' : '↓';
    }, {passive: true});
    c.addEventListener('touchend', function () {
      if (y0 !== null && pull >= LIMIT) {
        buzz(14);
        ptr.textContent = '↻'; ptr.classList.add('spin');
        Promise.resolve()
          .then(function () { if (typeof loop === 'function') return loop(); })
          .then(function () { if (typeof refreshSidePages === 'function') return refreshSidePages(); })
          .catch(function () {})
          .then(function () {
            setTimeout(function () { ptr.classList.remove('spin', 'show'); }, 350);
          });
      } else { ptr.classList.remove('show'); }
      y0 = null; pull = 0;
    }, {passive: true});
  })();

  /* keep the OS status-bar colour matched to the active theme on first paint */
  setTimeout(function () {
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--bg2').trim() || '#070A0F');
  }, 200);
})();
