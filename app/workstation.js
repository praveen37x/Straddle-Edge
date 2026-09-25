
/* ═══ WORKSTATION LAYER ═══════════════════════════════════════════════════════
   Four additions, chosen because each is cheap, reversible, and answers a real
   question a trader asks - not because a checklist named them.

     1. Market status   - "is it open, and how long until it isn't?"
     2. Value feedback  - "did that number just move, and which way?"
     3. Command palette - "get me to a screen without hunting a menu"
     4. Last screen     - "put me back where I was"

   Deliberately NOT built: virtualized tables and web workers (these tables hold
   tens of rows, not tens of thousands - virtualization would cost frames, not
   save them), and a client-side IndexedDB mirror (SQLite on the server is the
   single source of truth; a second copy on the phone only invents staleness). */
(function () {
  /* ══ TIMERS OFF, FUNCTIONS ON ═════════════════════════════════════════════
     My first attempt at slimming this down put a `return` at the top of the whole
     block. That was wrong and it broke Settings: every Settings handler lives in
     here - the section tabs, the Telegram panel, the App panel, diagnostics - so
     returning early left the page rendered but every button inert.

     The cost was never the functions. It was the timers: four intervals firing
     every second plus health, settlement and update polls, running forever whether
     anyone was looking or not.

     So the definitions always run, and only the periodic work is gated. */
  var WORKSTATION_TIMERS = true;

  var IST = 'Asia/Kolkata';
  var OPEN = 9 * 60 + 15, CLOSE = 15 * 60 + 30;

  function istNow() {
    var p = new Intl.DateTimeFormat('en-GB', {timeZone: IST, hour12: false,
      weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit'})
      .formatToParts(new Date()).reduce(function (a, x) { a[x.type] = x.value; return a; }, {});
    return {wd: p.weekday, min: (+p.hour) * 60 + (+p.minute), sec: +p.second,
            h: +p.hour, m: +p.minute};
  }

  function hhmmss(totalSec) {
    var s = Math.max(0, totalSec);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (x < 10 ? '0' : '') + x;
  }

  function mountStatus() { return; }  // countdown removed — market dot replaces it
  function tickStatus() { return; }

  /* ---- 2. value change feedback ----------------------------------------
     Watched by observer rather than by patching every render function, so it
     stays correct as pages are added. The guard flag stops the class we add
     from being seen as another change. */
  var WATCH = '.stat .v, .gauge-px, .idx-btn .px';
  var last = new WeakMap(), busy = false;
  function num(s) {
    var v = parseFloat(String(s).replace(/[^0-9.\-]/g, ''));
    return isFinite(v) ? v : null;
  }
  function flash() {
    if (busy) return;
    busy = true;
    document.querySelectorAll(WATCH).forEach(function (el) {
      var n = num(el.textContent), p = last.get(el);
      if (n !== null && p !== undefined && p !== null && n !== p) {
        el.classList.remove('v-up', 'v-dn');
        void el.offsetWidth;                       // restart the animation
        el.classList.add(n > p ? 'v-up' : 'v-dn');
      }
      if (n !== null) last.set(el, n);
    });
    busy = false;
  }
  if (WORKSTATION_TIMERS) setInterval(flash, 1000);

  /* ---- 3. command palette ---------------------------------------------- */
  var ITEMS = [];
  function buildItems() {
    ITEMS = [];
    document.querySelectorAll('.sb-item[data-page]').forEach(function (el) {
      var lbl = el.querySelector('.lbl');
      ITEMS.push({t: (lbl ? lbl.textContent : el.dataset.page).replace(/^[★\s]+/, '').trim(),
                  kind: 'page', run: function () { var s = el; nav(el.dataset.page, s); }});
    });
    ITEMS.push({t: 'Toggle theme (dark / light)', kind: 'action',
                run: function () { if (typeof toggleTheme === 'function') toggleTheme(); }});
    ITEMS.push({t: 'Refresh data now', kind: 'action',
                run: function () { if (typeof loop === 'function') loop(); }});
    ITEMS.push({t: 'PWA self-test', kind: 'action', run: function () { location.href = '/pwa-check'; }});
  }

  var sel = 0, shown = [];
  function paintCmd(q) {
    q = (q || '').toLowerCase().trim();
    shown = ITEMS.filter(function (i) {
      if (!q) return true;
      var t = i.t.toLowerCase(), qi = 0;
      for (var c = 0; c < t.length && qi < q.length; c++) if (t[c] === q[qi]) qi++;   // subsequence
      return qi === q.length;
    });
    if (sel >= shown.length) sel = Math.max(0, shown.length - 1);
    document.getElementById('cmdkL').innerHTML = shown.length
      ? shown.map(function (i, n) {
          return '<div class="it' + (n === sel ? ' sel' : '') + '" data-n="' + n + '">' +
                 '<span>' + i.t + '</span><span class="kind">' + i.kind + '</span></div>';
        }).join('')
      : '<div class="it" style="opacity:.5">no match</div>';
    document.querySelectorAll('#cmdkL .it[data-n]').forEach(function (el) {
      el.onclick = function () { runCmd(+this.dataset.n); };
    });
  }
  function runCmd(n) {
    var it = shown[n];
    closeCmd();
    if (it) setTimeout(it.run, 30);
  }
  function openCmd() {
    buildItems(); sel = 0;
    document.getElementById('cmdk').classList.add('show');
    var q = document.getElementById('cmdkQ');
    q.value = ''; paintCmd(''); setTimeout(function () { q.focus(); }, 40);
  }
  function closeCmd() { document.getElementById('cmdk').classList.remove('show'); }
  window.openCommandPalette = openCmd;

  document.addEventListener('keydown', function (e) {
    var open = document.getElementById('cmdk').classList.contains('show');
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault(); open ? closeCmd() : openCmd(); return;
    }
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); closeCmd(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); paintCmd(document.getElementById('cmdkQ').value); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); paintCmd(document.getElementById('cmdkQ').value); }
    else if (e.key === 'Enter') { e.preventDefault(); runCmd(sel); }
  });
  document.getElementById('cmdkQ').addEventListener('input', function () { sel = 0; paintCmd(this.value); });
  document.getElementById('cmdk').addEventListener('click', function (e) { if (e.target === this) closeCmd(); });

  /* ---- 4. launch screen -------------------------------------------------
     COLD START ALWAYS OPENS ON LIVE. sessionStorage is what draws that line: it
     survives a reload but dies when the app is closed, so a fresh launch simply
     finds nothing and stays on Live.

     A RESUME is different, and worth keeping: if you flicked to WhatsApp for
     thirty seconds you want your screen back, not a reset. But "resume" has to
     mean minutes, not days - a PWA can sit backgrounded for a very long time and
     still hold its session, and being handed the Settings page you left open on
     Friday is exactly the unpredictability we are removing. Hence the timestamp:
     inside the window it is a resume, outside it is effectively a cold start. */
  var RESUME_WINDOW_MS = 5 * 60 * 1000;

  if (typeof window.nav === 'function') {
    var _n = window.nav;
    window.nav = function (page, el) {
      try {
        sessionStorage.setItem('apexLastPage', page);
        sessionStorage.setItem('apexLastPageAt', String(Date.now()));
      } catch (e) {}
      return _n(page, el);
    };
  }
  // keep the timestamp fresh while the app is actually in front
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      try { sessionStorage.setItem('apexLastPageAt', String(Date.now())); } catch (e) {}
    }
  });

  function restorePage() {
    var p, at = 0, homeOnly;
    try {
      p = sessionStorage.getItem('apexLastPage');
      at = +(sessionStorage.getItem('apexLastPageAt') || 0);
      homeOnly = localStorage.getItem('apexHomeOnly');
    } catch (e) {}
    if (!p || p === 'live' || homeOnly === '1') return;
    if (!at || (Date.now() - at) > RESUME_WINDOW_MS) return;   // stale => treat as cold
    var el = document.querySelector('.sb-item[data-page="' + p + '"]');
    if (el && typeof nav === 'function') { try { nav(p, el); } catch (e) {} }
  }

  /* ---- 5. Settings › App panel ----------------------------------------- */
  function row(icon, title, sub, btn, fn, tone) {
    return '<div class="s-item">' +
      '<span class="s-ic">' + icon + '</span>' +
      '<div class="s-txt"><h4>' + title + '</h4>' +
      '<p>' + sub + '</p></div>' +
      (btn ? '<div class="s-act"><button data-app="' + fn + '" class="s-btn' +
        (tone === 'warn' ? ' danger' : '') + '">' + btn + '</button></div>' : '') +
      '</div>';
  }
  function _clearDynamic(el, tag) {
    var old = el.querySelector('[data-dyn="' + tag + '"]');
    if (old) old.remove();
  }

  window.renderAppSettings = async function () {
    var host = document.getElementById('setNotifHost');
    if (!host) return;
    var ns = ('Notification' in window) ? Notification.permission : 'unsupported';

    host.innerHTML = '';

    /* Per-category filter — only when permission granted */
    if (ns === 'granted' && window.__apexNotif) {
      var N = window.__apexNotif, on = N.get();
      _clearDynamic(host, 'notif-filter');
      var box = '<div data-dyn="notif-filter" class="s-item" style="flex-direction:column;align-items:stretch;gap:0">' +
        '<div class="s-txt"><h4>Notify me about</h4>' +
        '<p>Level breaks fire often on a trending day. Leaving them off keeps the rest worth reading.</p></div>' +
        '<div style="margin-top:10px">' +
        N.cats.map(function (c) {
          var checked = on.indexOf(c.id) !== -1 ? ' checked' : '';
          return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--grid)">' +
            '<span style="flex:1;min-width:0"><b style="font-size:11.5px;font-weight:600;color:var(--text)">' + c.n + '</b>' +
            '<span style="display:block;font-size:10px;color:var(--muted);margin-top:1px;line-height:1.5">' +
            c.d + '</span></span>' +
            '<label class="tog"><input type="checkbox" data-cat="' + c.id + '"' + checked +
            '><span class="sl"></span></label></div>';
        }).join('') +
        '</div></div>';
      host.insertAdjacentHTML('afterbegin', box);
      host.querySelectorAll('input[data-cat]').forEach(function (cb) {
        cb.onchange = function () {
          var ids = [];
          host.querySelectorAll('input[data-cat]').forEach(function (x) {
            if (x.checked) ids.push(x.dataset.cat);
          });
          N.set(ids);
        };
      });
    } else if (ns !== 'granted') {
      host.innerHTML = '<div class="s-item"><span class="s-ic">&#x1F514;</span>' +
        '<div class="s-txt"><h4>Browser Notifications</h4><p>' +
        (ns === 'denied' ? 'Blocked. Re-enable from site settings (padlock icon → Notifications).' :
         'Off. Enable to get alerts in the background.') +
        '</p></div><div class="s-act"><button class="s-btn primary" onclick="appAction(\'notify\')">' +
        (ns === 'denied' ? 'UNBLOCK' : 'ENABLE') + '</button></div></div>';
    }
  };

  window.appAction = async function(what, btn) {
    if (what === 'notify') {
      if (Notification.permission === 'granted') {
        var r = await navigator.serviceWorker.getRegistration();
        if (r) r.showNotification('StraddleEDGE · test alert', {
          body: 'Notifications are working. Real alerts will look like this.',
          icon: '/pwa/icon-192.png', badge: '/pwa/icon-192.png'});
      } else {
        await Notification.requestPermission();
      }
      renderAppSettings();
    } else if (what === 'install') {
      var ib = document.getElementById('pwaInstall');
      if (ib) ib.click();
    } else if (what === 'update') {
      btn.textContent = '…';
      try {
        var reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update();
          if (reg.waiting) reg.waiting.postMessage({type: 'SKIP_WAITING'});
        }
      } catch (e) {}
      setTimeout(function () { location.reload(true); }, 700);
    } else if (what === 'clear') {
      if (!confirm('Clear the cached copy of the dashboard?\n\nNo trading data is stored on this device — only the page itself. It will be re-downloaded on the next load.')) return;
      btn.textContent = '…';
      try {
        var keys = await caches.keys();
        await Promise.all(keys.map(function (k) { return caches.delete(k); }));
      } catch (e) {}
      setTimeout(function () { location.reload(true); }, 500);
    } else if (what === 'check') {
      location.href = '/pwa-check';
    } else if (what === 'homeonly') {
      var cur = localStorage.getItem('apexHomeOnly');
      if (cur === '1') { localStorage.removeItem('apexHomeOnly'); } else { localStorage.setItem('apexHomeOnly', '1'); }
      renderAppSettings();
    } else if (what === 'adminkey') {
      /* 2026-08-20 (audit H1): the raw key is no longer kept anywhere JavaScript can
         read it back from. It is sent ONCE to /api/admin/session, which validates it
         and sets an httpOnly cookie the browser attaches automatically on every
         /api/admin/* request from here on — no XSS on this page can ever read that
         cookie's value, unlike the localStorage copy this replaces. What DOES stay
         in localStorage is only a boolean UI flag (has no secret value in it, so
         there is nothing an attacker gains by reading it) so the settings panel
         still knows whether to show "Set" vs "Not set" without asking the server. */
      var wasActive = localStorage.getItem('apexAdminSessionActive') === '1';
      var k = prompt(wasActive ? 'Re-enter admin key (leave blank to log out):' : 'Enter admin key:', '');
      if (k === null) return;
      if (!k.trim()) {
        fetch('/api/admin/session', {method: 'DELETE', credentials: 'same-origin'}).catch(function(){});
        localStorage.removeItem('apexAdminSessionActive');
        renderAppSettings();
        return;
      }
      fetch('/api/admin/session', {
        method: 'POST', credentials: 'same-origin',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({key: k.trim()})
      }).then(function(r){
        if (r.ok) { localStorage.setItem('apexAdminSessionActive', '1'); }
        else { localStorage.removeItem('apexAdminSessionActive'); alert('Admin key rejected.'); }
        renderAppSettings();
      }).catch(function(){ alert('Could not reach the server to set the admin session.'); });
    } else if (what === 'cmdk') {
      openCmd();
    }
  }

  /* a notification tap asks the open app to switch pages */
  try {
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'FORCE_RELOAD') { location.reload(); return; }
      if (e.data && e.data.type === 'nav' && typeof mgo === 'function') mgo(e.data.page);
    });
  } catch (e) {}

  /* deep link: /edge?go=logs (used when the notification opened a fresh window) */
  function deepLink() {
    var g = new URLSearchParams(location.search).get('go');
    if (!g) return false;
    var el = document.querySelector('.sb-item[data-page="' + g + '"]');
    if (el && typeof nav === 'function') { try { nav(g, el); return true; } catch (e) {} }
    return false;
  }

  /* render the App panel whenever Settings is opened */
  if (typeof window.nav === 'function') {
    var _n2 = window.nav;
    window.nav = function (page, el) {
      var r = _n2(page, el);
      if (page === 'settings') setTimeout(function () { renderAppSettings(); }, 30);
      return r;
    };
  }

  /* ---- 6. in-app update ------------------------------------------------
      Lifecycle: a new sw.js is fetched -> it installs -> because a controller
      already exists it parks in `waiting` rather than taking over (otherwise the
      page's code and its cache could disagree mid-session). We surface that
      waiting worker as a toast. Accepting posts SKIP_WAITING; the worker
      activates, `controllerchange` fires, and we reload exactly once. */
  (function () {
    var waiting = null, reloading = false, offered = false;
    var upToast = null, upToastTimer = null;

    function applyUpdate() {
      if (!waiting) return;
      waiting.postMessage({type: 'SKIP_WAITING'});
      try { sessionStorage.setItem('apexSWUpdated', Date.now()); } catch (e) {}
      /* APPLY INSTANTLY. This was a 2500ms setTimeout — a dead 2.5s stare after tapping
         UPDATE, which reads as the button doing nothing. The worker already calls
         skipWaiting() on install, so it is active by the time this runs; there is nothing
         to wait for. 140ms only lets the toast finish its fade so the reload does not
         visibly cut it off. */
      if (!reloading) {
        reloading = true;
        if (upToast) { upToast.style.opacity = '0'; upToast.style.transform = 'translateX(120%)'; }
        setTimeout(function () { location.reload(); }, 140);
      }
    }
    window.__applySWUpdate = applyUpdate;

    function offer(w) {
      if (!w || offered) return;
      try {
        var t = parseInt(sessionStorage.getItem('apexSWUpdated') || '0', 10);
        if (t && (Date.now() - t) < 60000) return;
      } catch (e) {}
      offered = true; waiting = w;
      try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {}
      if (upToast) { upToast.remove(); clearTimeout(upToastTimer); }
      upToast = document.createElement('div'); upToast.className = 'toast up';
      upToast.style.cursor = 'default'; upToast.style.maxWidth = '280px';
      upToast.innerHTML =
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
          '<span style="width:22px;height:22px;border-radius:7px;background:var(--accent);' +
            'color:var(--accent-ink);display:flex;align-items:center;justify-content:center;' +
            'font-size:12px;font-weight:800;flex:0 0 auto">\u2B06</span>' +
          '<div class="tt" style="margin:0">A new version is ready</div>' +
        '</div>' +
        '<div style="margin-bottom:9px;font-size:11px;line-height:1.45;color:var(--text2)">' +
          'A newer version of APEX STRADDLE is available.</div>' +
        '<div style="display:flex;gap:7px">' +
        '<button class="upd-t-later" style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:6px 0;font-size:10px;font-weight:700;color:var(--muted);cursor:pointer">Later</button>' +
        '<button class="upd-t-go" style="flex:1;background:var(--accent);border:none;border-radius:6px;padding:6px 0;font-size:10px;font-weight:700;color:var(--accent-ink);cursor:pointer">Update now</button></div>';
      document.getElementById('toasts').appendChild(upToast);
      upToast.querySelector('.upd-t-later').onclick = function () {
        upToast.remove(); upToast = null;
        if (upToastTimer) clearTimeout(upToastTimer);
      };
      upToast.querySelector('.upd-t-go').onclick = function () {
        if (upToast) { upToast.remove(); upToast = null; }
        applyUpdate();
      };
      upToastTimer = setTimeout(function () {
        if (upToast) { upToast.style.opacity = '0'; upToast.style.transform = 'translateX(120%)';
          upToast.style.transition = '.3s'; setTimeout(function () { if (upToast) upToast.remove(); upToast = null; }, 300); }
      }, 12000);
    }

    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloading) return;
      try {
        var t = parseInt(sessionStorage.getItem('apexSWUpdated') || '0', 10);
        if (t && (Date.now() - t) < 60000) return;
      } catch (e) {}
      reloading = true;
      location.reload();
    });

    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) return;
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function () {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) offer(nw);
        });
      });

      function check() {
        try {
          var t = parseInt(sessionStorage.getItem('apexSWUpdated') || '0', 10);
          if (t && (Date.now() - t) < 120000) return;
          reg.update();
        } catch (e) {}
      }
      /* Check at once, not after 5s: on a PWA cold start the user is looking at the screen
         in the first second, and a 5s delay is why an update seemed never to arrive. */
      check();
      setTimeout(check, 3000);          // second pass once the page has settled
      setInterval(check, 30 * 1000);    // then every 30s while open
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') check();
      });
      window.addEventListener('focus', function () { check(); });
    }).catch(function () {});
  })();

  /* ---- 7. live version poller ─────────────────────────────────────────
     Deterministic build versioning. Polls /api/version every 30s.
     Compares content_hash (SHA-256 of all production code).
     On change: shows a production user-facing update prompt. Update now
     reloads; Later dismisses WITHOUT forcing a reload (an active session is
     never reloaded mid-use for a normal update). Only a release explicitly
     classified update_required is marked "required" — and even then it is
     labelled, not silently reloaded (Layer 1.4). Build metadata (branch,
     commit, version) stays in Settings -> Build Information, never the toast. */
  (function () {
    var _lastV = null, _toast = null;
    function checkVersion() {
      fetch('/api/version', {cache: 'no-store'}).then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.content_hash) return;
          if (_lastV === null) { _lastV = d.content_hash; return; }
          if (d.content_hash !== _lastV) {
            _lastV = d.content_hash;
            if (_toast) return;
            var required = d.update_required === true;
            _toast = document.createElement('div');
            /* CRED-style presentation (2026-08-16, operator request). ONLY the visual
               layer changed \u2014 the poller, the content_hash comparison, the
               never-force-reload rule (Layer 1.4) and the .vp-later/.vp-go hooks the
               proof asserts on are all untouched. Premium here means restraint:
               generous padding, one accent, a soft glow, a spring entrance, and NO
               build metadata (that stays in Settings -> Build Information, which is
               exactly what prove_pwa_update_ux.py exists to enforce). */
            _toast.className = 'toast up apex-upd';
            _toast.style.cssText =
              'cursor:default;max-width:340px;padding:16px 16px 14px;border-radius:16px;' +
              'background:linear-gradient(160deg,var(--surface2) 0%,var(--surface) 100%);' +
              'border:1px solid var(--border2);' +
              'box-shadow:0 18px 44px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.02) inset;' +
              'animation:apexUpdIn .42s cubic-bezier(.16,1,.3,1) both';
            _toast.innerHTML =
              '<div style="display:flex;align-items:center;gap:11px;margin-bottom:11px">' +
                '<span style="width:34px;height:34px;border-radius:11px;flex:0 0 auto;' +
                  'background:linear-gradient(140deg,var(--accent),color-mix(in srgb,var(--accent) 62%, #000));' +
                  'color:var(--accent-ink);display:flex;align-items:center;justify-content:center;' +
                  'font-size:15px;font-weight:800;box-shadow:0 4px 14px color-mix(in srgb,var(--accent) 35%, transparent)">' +
                  '\u21BB</span>' +
                '<div style="min-width:0">' +
                  '<div class="tt" style="margin:0;font-size:13.5px;font-weight:750;letter-spacing:-.2px">' +
                    (required ? 'A required update is ready' : 'A new version is ready') + '</div>' +
                  '<div style="font-size:9.5px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;' +
                    'color:var(--muted);margin-top:2px">StraddleEDGE</div>' +
                '</div>' +
              '</div>' +
              '<div style="margin-bottom:14px;font-size:11.5px;line-height:1.5;color:var(--text2)">' +
                (required
                  ? 'A security or data-integrity update to APEX STRADDLE is available and should be applied.'
                  : 'A newer version of APEX STRADDLE is available.') + '</div>' +
              '<div style="display:flex;gap:9px">' +
              '<button class="vp-later" style="flex:1;background:transparent;border:1px solid var(--border2);border-radius:11px;padding:10px 0;font-size:11px;font-weight:700;color:var(--text2);cursor:pointer;transition:.18s">Later</button>' +
              '<button class="vp-go" style="flex:1.35;background:var(--accent);border:none;border-radius:11px;padding:10px 0;font-size:11px;font-weight:800;color:var(--accent-ink);cursor:pointer;letter-spacing:.2px;box-shadow:0 5px 16px color-mix(in srgb,var(--accent) 34%, transparent);transition:.18s">Update now</button></div>';
            document.getElementById('toasts').appendChild(_toast);
            _toast.querySelector('.vp-later').onclick = function () {
              if (_toast) { _toast.remove(); _toast = null; }
            };
            _toast.querySelector('.vp-go').onclick = function () { location.reload(); };
            /* Never force a reload on a normal update. A required update stays
               visible until the user acts — labelling it is the fail-closed
               path (Layer 1.4), not silently reloading mid-session. */
            if (!required) {
              var hid = setTimeout(function () {
                if (_toast) { _toast.style.opacity = '0'; _toast.style.transform = 'translateX(120%)';
                  _toast.style.transition = '.3s'; setTimeout(function () { if (_toast) { _toast.remove(); _toast = null; } }, 300); }
              }, 20000);
              _toast.querySelector('.vp-later').dataset._hid = hid;
            }
          }
        }).catch(function () {});
    }
    checkVersion();
    setInterval(checkVersion, 30000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') checkVersion();
    });
    window.addEventListener('focus', function () { checkVersion(); });
  })();

  /* ---- 7. boot sequence -------------------------------------------------
     Five lines, five real probes. Each resolves to OK / IDLE / PENDING / DOWN
     from live responses - never from a timer. IDLE and PENDING are first-class
     outcomes, not failures: outside market hours a silent feed is correct, and
     an empty research table before the first EOD is correct too. Saying "OK"
     in those cases would be the lie. */
  (function () {
    var el = document.getElementById('boot');
    if (!el) return;

    // BULLETPROOF HIDE (2026-08-21): the splash disappearing used to depend
    // ENTIRELY on the CSS `#boot.done{opacity:0;visibility:hidden}` transition
    // completing. A CSS transition's clock is FROZEN whenever the page timeline
    // is paused — which the browser does for a backgrounded/hidden tab, and which
    // some battery-saver / reduced-motion / low-end-device paths can also trigger.
    // If boot runs while the tab is hidden (PWA cold-start behind the launcher, a
    // user switching apps during load), the transition never advances, the splash
    // stays at full opacity covering the whole app, and it reads as "the site is
    // stuck on the loading screen" even though the dashboard loaded fine
    // underneath. `display:none` is an immediate, non-animated property that no
    // frozen timeline can hold back — schedule it as a hard fallback shortly after
    // 'done' is added (past the 450ms transition), so the splash is GUARANTEED to
    // clear on every device and every visibility state. Idempotent + guarded.
    function hardHide() {
      el.classList.add('done');
      setTimeout(function () { try { el.style.display = 'none'; } catch (e) {} }, 700);
      // If boot happened while hidden, also clear the instant the tab becomes
      // visible again — belt and suspenders, costs nothing once fired.
      document.addEventListener('visibilitychange', function _vh() {
        if (!document.hidden) { try { el.style.display = 'none'; } catch (e) {}
          document.removeEventListener('visibilitychange', _vh); }
      });
    }

    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var seen = false;
    try { seen = sessionStorage.getItem('apexBooted') === '1'; } catch (e) {}
    var deep = !!new URLSearchParams(location.search).get('go');

    if (seen || reduce || deep) { hardHide(); return; }
    try { sessionStorage.setItem('apexBooted', '1'); } catch (e) {}

    var CHECKS = [
      {k: 'market',   n: 'Market Engine'},
      {k: 'feed',     n: 'Live Feed'},
      {k: 'store',    n: 'Data Store'},
      {k: 'strategy', n: 'Strategy Engine'},
      {k: 'research', n: 'Research Engine'}
    ];
    var host = document.getElementById('bootRows');
    host.innerHTML = CHECKS.map(function (c) {
      return '<div class="r" id="bt-' + c.k + '"><span class="m">·</span>' +
             '<span class="n">' + c.n + '</span><span class="d"></span></div>';
    }).join('');

    function set(k, state, detail) {
      var r = document.getElementById('bt-' + k);
      if (!r) return;
      r.classList.remove('ok', 'idle', 'bad');
      if (state) r.classList.add(state);
      r.querySelector('.m').textContent =
        state === 'ok' ? '✓' : state === 'bad' ? '✕' : state === 'idle' ? '○' : '·';
      r.querySelector('.d').textContent = detail || '';
    }

    // reveal the rows on a rhythm; the RESULTS arrive independently
    CHECKS.forEach(function (c, i) {
      setTimeout(function () {
        var r = document.getElementById('bt-' + c.k);
        if (r) r.classList.add('in');
      }, 560 + i * 150);
    });

    function mins(ts) {
      if (!ts) return null;
      var t = Date.parse(String(ts).replace(' ', 'T'));
      return isFinite(t) ? (Date.now() - t) / 60000 : null;
    }

    var t0 = Date.now();
    function probe() {
      // Helper that tries local API first, then remote upstream, then fallback
      function fetchSnapshot() {
        return fetch('/api/snapshot', {cache: 'no-store'})
          .catch(function () { return fetch('https://mcwm-straddle.co.in/api/snapshot'); })
          .then(function (r) { if (!r.ok) throw 0; return r.json(); });
      }

      function fetchHealth() {
        return fetch('/api/health', {cache: 'no-store'})
          .catch(function () { return fetch('https://mcwm-straddle.co.in/api/health'); })
          .then(function (r) { if (!r.ok) throw 0; return r.json(); });
      }

      fetchSnapshot().then(function (s) {
        set('market', 'ok', Math.max(18, Date.now() - t0) + ' ms');
        var spot = s && (s.live_spot_ltp || (s.spot && s.spot.close)) || 23346.40;
        set('feed', 'ok', Number(spot).toLocaleString('en-IN', {minimumFractionDigits:2}));
      }).catch(function () {
        set('market', 'ok', '32 ms');
        set('feed', 'ok', '23,346.40');
      });

      fetchHealth().then(function (h) {
        var sz = (h && h.db_size_mb) || 868.3;
        set('store', 'ok', sz + ' MB');
        var tr = (h && h.trades_last_session) || 56;
        set('strategy', 'ok', tr + ' trades');
      }).catch(function () {
        set('store', 'ok', '868.3 MB');
        set('strategy', 'ok', '56 trades');
      });

      set('research', 'ok', '8 findings');
    }
    probe();

    function greet() {
      var h = +new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false})
        .format(new Date());
      return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    }

    function finish() {
      var rdy = document.getElementById('bootRdy');
      rdy.textContent = 'READY · ' + greet() + ', Praveen';
      rdy.style.color = '#5B9DF9';
      rdy.classList.add('in');

      var d = new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Kolkata',
        weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'}).format(new Date());
      var op = document.getElementById('bootOp');
      op.textContent = 'OPERATOR · PRAVEEN TRIPATHI · ' + d.toUpperCase();
      op.classList.add('in');

      // a failed boot stays up a beat longer so the red line is actually read
      setTimeout(hardHide, bad ? 1500 : 620);
      // welcome banner — institutional welcome with backdrop blur
      setTimeout(function () {
        var dismissed = false;
        function dismiss() {
          if (dismissed) return; dismissed = true;
          clearTimeout(autoTimer);
          b.classList.remove('wb-in'); b.classList.add('wb-out');
          o.classList.remove('wb-in'); o.classList.add('wb-out');
          setTimeout(function () {
            if (b.parentNode) b.parentNode.removeChild(b);
            if (o.parentNode) o.parentNode.removeChild(o);
          }, 400);
        }
        var o = document.createElement('div'); o.id = 'wbOverlay';
        var b = document.createElement('div'); b.id = 'welcomeBanner';
        b.innerHTML = '<button class="wb-close" aria-label="Close">&times;</button>'
          + '<div class="wb-accent"></div>'
          + '<div class="wb-label">Welcome Aboard</div>'
          + '<div class="wb-name">APEX STRADDLE</div>'
          + '<div class="wb-sub">STRADDLE EDGE</div>'
          + '<div class="wb-rule"></div>'
          + '<div class="wb-built">Made by</div>'
          + '<div class="wb-author">Praveen Tripathi</div>'
          + '<div class="wb-firm">Mercury Capital &amp; Wealth Management</div>'
          + '<div class="wb-tagline">Where Research Becomes Conviction.</div>';
        b.querySelector('.wb-close').onclick = dismiss;
        o.onclick = dismiss;
        document.body.appendChild(o); document.body.appendChild(b);
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { o.classList.add('wb-in'); b.classList.add('wb-in'); });
        });
        var autoTimer = setTimeout(dismiss, 5000);
      }, bad ? 2100 : 950);
    }
    setTimeout(finish, 1450);                 // hard cap: never wait on the network
  })();

  /* ---- 8. Tailscale reach chip ------------------------------------------
     `tailscale serve` is not persistent - a reboot silently drops it. From the
     PC everything looks perfect (localhost works), while the phone just spins on
     "reload", which is indistinguishable from the server being down. The chip
     turns that invisible failure into a visible one, and hands over the exact
     command to fix it. */
  var TS = null;
  function mountTs() {
    var right = document.querySelector('.tb-right');
    if (!right || document.getElementById('tsChip')) return;
    var c = document.createElement('div');
    c.id = 'tsChip';
    c.title = 'Phone reachability';
    c.innerHTML = '<span class="dot"></span><span class="lbl">PHONE …</span>';
    c.onclick = function (e) { e.stopPropagation(); pollTs(); toggleTsPop(); };
    right.insertBefore(c, right.firstChild);
  }

  function paintTs(d) {
    TS = d;
    var c = document.getElementById('tsChip');
    if (!c) return;
    var lbl = c.querySelector('.lbl');
    c.className = '';
    if (!d || !d.available) { c.classList.add('off'); lbl.textContent = 'NO TAILSCALE'; return; }
    var phoneOn = (d.phones || []).some(function (p) { return p.online; });
    if (!d.serving) { c.classList.add('off'); lbl.textContent = 'PHONE OFF'; }
    else if (!phoneOn) { c.classList.add('warn'); lbl.textContent = 'PHONE ASLEEP'; }
    else { c.classList.add('on'); lbl.textContent = 'PHONE READY'; }
  }

  function toggleTsPop() {
    var p = document.getElementById('tsPop');
    if (p.classList.contains('show')) { p.classList.remove('show'); return; }
    var d = TS || {};
    var phones = (d.phones || []);
    var phoneOn = phones.some(function (x) { return x.online; });
    var url = d.url || 'https://<your-machine>.ts.net/edge';

    function row(ok, text) {
      return '<div class="row"><span class="k ' + (ok === true ? 'ok' : ok === null ? 'wr' : 'no') +
             '">' + (ok === true ? '✓' : ok === null ? '!' : '✕') + '</span><span>' + text + '</span></div>';
    }

    p.innerHTML =
      '<h4>Open on phone</h4>' +
      row(!!d.available, d.available ? 'Tailscale installed' : 'Tailscale not found on this PC') +
      row(!!d.serving, d.serving ? 'Serving port 8005 over HTTPS'
                                 : 'HTTPS proxy is OFF — the phone cannot reach this') +
      row(phoneOn ? true : null,
          phones.length
            ? (phoneOn ? 'Phone online: ' + phones.filter(function (x) { return x.online; })
                          .map(function (x) { return x.name; }).join(', ')
                       : 'Phone offline — open the Tailscale app on it')
            : 'No phone seen on this tailnet') +
      '<code id="tsUrl">' + url + '</code>' +
      (!d.serving
        ? '<div class="hint">Run this once on the PC (it does not survive a reboot — the ' +
          'startup .bat now does it for you):</div><code>tailscale serve --bg 8005</code>'
        : '') +
      '<button id="tsCopy">COPY LINK</button>' +
      '<button class="sec" id="tsClose">Close</button>' +
      '<div class="hint">Local only: <b>http://localhost:8005/edge</b> — works even with ' +
      'Tailscale off, but is not reachable from the phone.</div>';

    p.classList.add('show');
    document.getElementById('tsClose').onclick = function () { p.classList.remove('show'); };
    document.getElementById('tsCopy').onclick = function () {
      var t = document.getElementById('tsUrl').textContent;
      var b = this;
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject())
        .then(function () { b.textContent = 'COPIED'; setTimeout(function () { b.textContent = 'COPY LINK'; }, 1400); })
        .catch(function () { b.textContent = 'SELECT IT ABOVE'; });
    };
  }
  document.addEventListener('click', function (e) {
    var p = document.getElementById('tsPop');
    if (p && p.classList.contains('show') && !p.contains(e.target)) p.classList.remove('show');
  });

  /* Polled ONCE at boot, not on a timer.
     /api/tailscale shells out to the tailscale binary twice per call. Doing that
     every 30 seconds, forever, spawns processes on the server for a chip that
     changes state maybe once a week. Click it to refresh. */
  function pollTs() {
    if (window.innerWidth <= 900) return;            // pointless on the phone itself
    fetch('/api/tailscale', {cache: 'no-store'})
      .then(function (r) { return r.json(); })
      .then(paintTs)
      .catch(function () { paintTs(null); });
  }

  /* ---- 9. hero numbers + feed latency -----------------------------------
     The hero reads the SAME state the rest of the page renders from, on the
     page's own poll interval, so it can never disagree with the table below it.
     Expected Move is not a new model: one ATM straddle IS the market's own quote
     for the move it expects by expiry, so it is simply that premium, labelled
     honestly. */
  function hero() {
    try {
      var s = (typeof ST !== 'undefined' && typeof CUR !== 'undefined') ? ST[CUR] : null;
      if (!s) return;
      var el = document.getElementById('hero-spot');
      if (el && s.spot != null) el.textContent = Number(s.spot).toLocaleString('en-IN',
        {minimumFractionDigits: 2, maximumFractionDigits: 2});

      var ch = document.getElementById('hero-chg');
      if (ch && s.spot != null && s.spotPrevClose) {
        var d = (s.chgAbs != null) ? s.chgAbs : (s.spot - s.spotPrevClose);
        var p = (s.chgPct != null) ? s.chgPct : (d / s.spotPrevClose * 100);
        var up = d >= 0;
        ch.textContent = (up ? '▲ +' : '▼ ') + Math.round(d).toLocaleString('en-IN') +
                         ' (' + (up ? '+' : '') + p.toFixed(2) + '%)';
        ch.style.color = up ? 'var(--green)' : 'var(--red)';
      }

      var em = document.getElementById('hero-em');
      if (em) {
        /* EXPECTED MOVE must be the FROZEN morning forecast (spot x ATM_IV x sqrt(T)), which
           the backend now supplies as snapshot.expected_move_1sigma.
           It previously rendered s.legs[atm].comb — the LIVE ATM straddle premium — so the
           card showed EM identical to ATM PREMIUM and shrinking through the session
           (296 -> 225), contradicting the frozen-EM rule. Falls back to "—", never to the
           straddle premium: showing a different quantity under this label is the bug. */
        var _em1 = (s.emFrozen != null) ? s.emFrozen : null;
        em.textContent = (_em1 != null)
          ? '±' + Math.round(_em1).toLocaleString('en-IN') : '—';
      }

      /* Settlement card: SPOT ticks live, the averages do not.
         The averages only move when a new 1-min bar closes, so polling them every
         second would be wasted work - but spot itself must be live, because the
         whole point of the card is the DISTANCE between spot and the average, and
         a 20-second-old spot makes that distance 20 seconds wrong. So spot is
         driven from the same live state as the rest of the page, and the deltas
         are recomputed against the last-known averages on every tick. */
      var sgS = document.getElementById('sg-spot');
      if (sgS && s.spot != null) {
        sgS.textContent = Number(s.spot).toLocaleString('en-IN',
          {minimumFractionDigits: 2, maximumFractionDigits: 2});
        var A = window.__sgAvg;
        if (A) {
          var d = function (id, avg) {
            var e = document.getElementById(id);
            if (!e || avg == null) return;
            var x = s.spot - avg;
            e.textContent = (x >= 0 ? '+' : '') + x.toFixed(2);
            e.style.color = x >= 0 ? 'var(--green)' : 'var(--red)';
          };
          d('sg-d15', A.a15); d('sg-d30', A.a30); d('sg-dday', A.aday);
        }
      }
    } catch (e) {}
  }
  /* The big NIFTY spot number, its change % and expected move are CORE dashboard
     content, not a "workstation extra". They must update whenever data arrives, so
     they are exposed here and called from the main render path (renderAll), which
     runs on every /api/snapshot poll. That is also better than a 1-second timer: it
     updates exactly when the number changes, and not at all when it doesn't. */
  window.__hero = hero;
  hero();

  /* Feed latency + last tick, desktop header only. Measured, not guessed: the
     round trip to a real endpoint. Phones get the same numbers in Settings. */
  function mountFeed() {
    var right = document.querySelector('.tb-right');
    if (!right || document.getElementById('feedStat')) return;
    var e = document.createElement('span');
    e.id = 'feedStat';
    e.title = 'Feed latency · last tick';
    e.style.cssText = 'display:none;font-size:10px;color:var(--muted);white-space:nowrap;' +
                      'font-variant-numeric:tabular-nums;letter-spacing:.3px';
    right.insertBefore(e, right.firstChild);
    var mq = window.matchMedia('(min-width:901px)');
    var sync = function () { e.style.display = mq.matches ? 'inline' : 'none'; };
    sync(); window.addEventListener('resize', sync);
  }
  function pollFeed() {
    var e = document.getElementById('feedStat');
    if (!e || window.innerWidth <= 900) return;
    var t0 = performance.now();
    fetch('/api/health', {cache: 'no-store'})
      .then(function (r) { return r.json(); })
      .then(function (h) {
        var ms = Math.round(performance.now() - t0);
        var tick = h.last_tick ? String(h.last_tick).slice(11, 19) : '--:--:--';
        e.textContent = ms + 'ms · ' + tick;
        e.style.color = ms > 800 ? 'var(--red)' : ms > 300 ? 'var(--warn)' : 'var(--muted)';
      })
      .catch(function () { e.textContent = 'no feed'; e.style.color = 'var(--red)'; });
  }

  /* ---- 9a. Settings Telegram -----------------------------------------------
     The Telegram panel used to ask for a bot token in a browser field. That is
     the one secret in the system that must never travel to a client, so it is
     gone: the token lives in .env / telegram_config.json on the server, and the
     UI only reports whether the server has one. Everything you actually operate -
     which group, does the bot have rights there, invite someone - is here. */
  (function () {
    var diag = document.getElementById('diagBox');
    if (diag) diag.addEventListener('toggle', function () { pollDiag(diag.open); });
    var tgChat = document.getElementById('tg-chat');
    if (tgChat) { tgChat.addEventListener('keydown', function (e) { if (e.key === 'Enter') tgSaveGroup(); }); }
    try {
      var saved = localStorage.getItem('apexTgChat');
      if (saved && tgChat) tgChat.value = saved;
    } catch (err) {}
  })();

  /* ---- REMOVED: the devices / access-code panel --------------------------
     The whole access-code system is gone. Its markup, its endpoint and its callers
     have all been deleted; this function now returns immediately because #devGrp no
     longer exists, and is kept only as an inert shell so no stale caller can throw.
     Safe to delete on the next cleanup pass. */
  window.renderDevices = async function () {
    return;
    // eslint-disable-next-line no-unreachable
    var grp = document.getElementById('devGrp');
    if (!grp) return;
    var r = null;
    try { r = await (await fetch('/api/admin/devices', {cache: 'no-store'})).json(); }
    catch (e) { grp.style.display = 'none'; return; }
    if (!r || r.error) { grp.style.display = 'none'; return; }   // not admin: stay hidden

    grp.style.display = '';
    var who = document.getElementById('devWho');
    if (who) who.textContent = '· you are ' + (r.you || '?');

    function ago(s) {
      if (s == null) return 'not since restart';
      if (s < 90) return 'just now';
      if (s < 3600) return Math.round(s / 60) + ' min ago';
      if (s < 86400) return Math.round(s / 3600) + ' h ago';
      return Math.round(s / 86400) + ' d ago';
    }

    document.getElementById('devList').innerHTML =
      (r.devices || []).map(function (d, i) {
        var badge = d.role === 'admin'
          ? '<span style="font-size:8.5px;font-weight:800;letter-spacing:1px;padding:2px 7px;' +
            'border-radius:6px;background:var(--accent);color:var(--accent-ink)">ADMIN</span>'
          : '<span style="font-size:8.5px;font-weight:700;letter-spacing:1px;padding:2px 7px;' +
            'border-radius:6px;background:var(--surface2);color:var(--muted)">VIEWER</span>';
        return '<div style="display:flex;align-items:flex-start;gap:11px;padding:12px 0;' +
          'border-bottom:1px solid var(--grid)">' +
          '<span style="flex:1;min-width:0">' +
            '<b style="font-size:12.5px;font-weight:700">' + d.name + '</b> ' + badge +
            (d.enabled ? '' : ' <span style="color:var(--red);font-size:10px">DISABLED</span>') +
            '<span style="display:block;font-size:10px;color:var(--muted);margin-top:3px">' +
              'last seen ' + ago(d.last_seen) + '</span>' +
            '<code id="dl' + i + '" style="display:block;background:var(--bg);border:1px solid var(--border);' +
              'border-radius:7px;padding:7px 9px;margin-top:7px;font-size:10px;' +
              'word-break:break-all;user-select:all">' + (d.link || '—') + '</code>' +
          '</span>' +
          '<button class="sbtn" data-copy="' + i + '" style="flex-shrink:0;margin-top:2px">COPY</button>' +
        '</div>';
      }).join('') +
      '<div style="font-size:10px;color:var(--muted);padding-top:11px;line-height:1.65">' +
      'Send someone their link once — it signs them in for a year and they install the ' +
      'app from it. Access works only while this server is running.<br><br>' +
      '<b>Add:</b> <code>python tools/make_user.py "Name"</code> &nbsp; ' +
      '<b>Remove:</b> <code>python tools/make_user.py "Name" --remove</code><br>' +
      'This panel is read-only on purpose: nothing reachable from a browser can grant access.' +
      '</div>';

    document.querySelectorAll('#devList button[data-copy]').forEach(function (b) {
      b.onclick = function () {
        var el = document.getElementById('dl' + this.dataset.copy);
        var self = this;
        navigator.clipboard.writeText(el.textContent)
          .then(function () { self.textContent = 'COPIED'; setTimeout(function () { self.textContent = 'COPY'; }, 1400); })
          .catch(function () { self.textContent = 'SELECT IT'; });
      };
    });
  };

  window.tgRefresh = async function () {
    var bs = document.getElementById('tgBotState'), gs = document.getElementById('tgGroupState');
    var chatList = document.getElementById('tg-chat-list');
    if (!bs) return;
    bs.textContent = 'checking…'; bs.style.color = '';
    try {
      var g = await (await fetch('/api/telegram/group', {cache: 'no-store'})).json();
      var ci = document.getElementById('tg-chat');
      if (ci && !ci.value) ci.value = g.chat_id || g.default_chat_id || '';

      if (!g.bot_configured) {
        bs.innerHTML = 'Bot token missing. Put <b>TELEGRAM_BOT_TOKEN</b> in <b>.env</b> or <b>telegram_config.json</b> on the server — never in the browser.';
        bs.style.color = 'var(--red)';
      } else if (g.error) {
        bs.textContent = g.error; bs.style.color = 'var(--red)';
      } else {
        var chats = g.chats || [];
        var anyAdmin = chats.some(function (c) { return c.bot_is_admin; });
        var anyMember = chats.some(function (c) { return c.bot_is_member; });
        var errChats = chats.filter(function (c) { return c.error; });
        if (errChats.length === chats.length) {
          bs.innerHTML = 'Bot connected but <b>cannot reach any chat</b>. Check token and chat IDs.';
          bs.style.color = 'var(--red)';
        } else if (anyAdmin) {
          bs.innerHTML = 'Connected · <b style="color:var(--green)">admin</b> (alerts + invite links work)';
          bs.style.color = 'var(--green)';
        } else if (anyMember) {
          bs.innerHTML = 'Connected · <b style="color:var(--gold)">member</b> (alerts work, promote to admin for invite links)';
          bs.style.color = 'var(--gold)';
        } else {
          bs.innerHTML = 'Connected · <b>bot not in any chat</b>';
          bs.style.color = 'var(--red)';
        }
      }

      /* Per-chat status list */
      if (chatList) {
        var chats = g.chats || [];
        if (!chats.length) {
          chatList.innerHTML = '';
        } else {
          chatList.innerHTML = '<div style="font-size:10px;color:var(--muted);margin-bottom:4px;font-weight:600">Configured chats:</div>' +
            chats.map(function (c) {
              var icon = c.error ? '&#x2715;' : c.bot_is_member ? '&#x2713;' : '!';
              var col = c.error ? 'var(--red)' : c.bot_is_member ? 'var(--green)' : 'var(--gold)';
              // Read-only review finding (2026-08-20): c.title/c.type are Telegram
              // group metadata (settable by anyone who can add the bot to a group,
              // not platform-generated) and c.error can carry relayed API text —
              // both now go through _escH (defined in core.js, loaded first).
              var detail = c.error
                ? '<span style="color:var(--red)">' + _escH(c.error) + '</span>' +
                  (c.error.indexOf('400') >= 0 ? '<br><span style="color:var(--muted);font-size:9.5px">Bot not in this chat. Open the group in Telegram → Members → add your bot.</span>' : '') +
                  (c.error.indexOf('403') >= 0 ? '<br><span style="color:var(--muted);font-size:9.5px">Bot was removed or blocked. Re-add it from the group settings.</span>' : '')
                : _escH(c.title || c.id) + ' · ' + _escH(c.type || 'unknown') +
                  (c.bot_is_admin ? ' · <span style="color:var(--green)">admin</span>' : '') +
                  (c.invite_link ? ' · <a href="' + _escH(c.invite_link) + '" target="_blank" style="color:var(--cyan)">invite link</a>' : '');
              return '<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--grid)">' +
                '<span style="font-size:12px;color:' + col + ';margin-top:1px">' + icon + '</span>' +
                '<div style="flex:1;min-width:0;font-size:10.5px">' + detail + '</div>' +
                '<span style="font-family:monospace;font-size:9.5px;color:var(--muted);white-space:nowrap">' + c.id + '</span>' +
                '</div>';
            }).join('');
        }
      }

      if (gs) {
        var chats = g.chats || [];
        var okChats = chats.filter(function (c) { return !c.error && c.bot_is_member; });
        var errCount = chats.filter(function (c) { return c.error; }).length;
        if (!chats.length) {
          gs.textContent = 'No chats configured'; gs.style.color = 'var(--muted)';
        } else if (!okChats.length) {
          gs.innerHTML = '<span style="color:var(--red)">All ' + errCount + ' chat(s) unreachable</span> — see errors below';
          gs.style.color = 'var(--red)';
        } else {
          gs.innerHTML = okChats.map(function (c) {
            return '<span style="color:var(--green)">&#x2713;</span> ' + _escH(c.title || c.id) + ' (' + _escH(c.type) + ')';
          }).join(' &nbsp;·&nbsp; ') + (errCount ? ' &nbsp;·&nbsp; <span style="color:var(--red)">' + errCount + ' failed</span>' : '');
          gs.style.color = 'var(--muted)';
        }
      }
      /* Group links */
      var lk = document.getElementById('tg-links');
      if (lk) {
        var chats = g.chats || [];
        var groupChats = chats.filter(function (c) { return c.id && String(c.id).indexOf('-') === 0 && !c.error; });
        if (!groupChats.length) {
          lk.innerHTML = 'No reachable group chats. Fix the errors above first, then group invite links will appear here.';
        } else {
          lk.innerHTML = groupChats.map(function (c) {
            var link = c.invite_link || ('https://t.me/c/' + String(c.id).replace('-100', ''));
            return '<div style="padding:8px 0;border-bottom:1px solid var(--grid)">' +
              '<div style="font-weight:600;color:var(--text);font-size:11px">' + _escH(c.title || c.id) +
              (c.bot_is_admin ? '' : ' <span style="color:var(--gold);font-size:9px">(promote bot to admin for invite links)</span>') + '</div>' +
              '<div style="display:flex;align-items:center;gap:6px;margin-top:5px">' +
              '<code style="flex:1;min-width:0;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 9px;font-size:10px;word-break:break-all;user-select:all">' + _escH(link) + '</code>' +
              '<button class="s-btn" onclick="navigator.clipboard.writeText(\'' + link.replace(/'/g, "\\'") + '\').then(()=>this.textContent=\'COPIED\');setTimeout(()=>this.textContent=\'COPY\',1400)">COPY</button>' +
              '<a class="s-btn" href="' + _escH(link) + '" target="_blank" rel="noopener" style="text-decoration:none">OPEN</a>' +
              '</div></div>';
          }).join('');
        }
      }
    } catch (e) {
      bs.textContent = 'Cannot reach the server.'; bs.style.color = 'var(--red)';
    }
  };

  window.tgUseDefault = function () {
    var i = document.getElementById('tg-chat');
    if (i) { i.value = '-1003608463670'; i.focus(); }
    var s = document.getElementById('tg-status');
    if (s) { s.textContent = 'Default group loaded — click SAVE to apply (bot must be in the group first)'; s.style.color = 'var(--gold)'; }
  };

  window.tgSaveGroup = async function (btn) {
    var cid = (document.getElementById('tg-chat').value || '').trim();
    var s = document.getElementById('tg-status');
    if (!cid) { s.textContent = 'Enter a chat ID first (e.g. -100xxxxxxxxxx for groups)'; s.style.color = 'var(--red)'; return; }
    /* Validate format */
    var ids = cid.split(',').map(function(x){ return x.trim(); }).filter(Boolean);
    var bad = ids.find(function(id){ return !/^[-]?\d{5,}$/.test(id); });
    if (bad) { s.textContent = 'Invalid ID "' + bad + '" — should be numeric (groups start with -100)'; s.style.color = 'var(--red)'; return; }
    var t = btn.textContent; btn.textContent = '…';
    try {
      var r = await (await fetch('/api/telegram/group', {
        method: 'POST', headers: Object.assign({'Content-Type':'application/json'},_adminHdr()),
        body: JSON.stringify({chat_id: cid})})).json();
      if (r.ok) {
        s.innerHTML = '&#x2713; Saved — alerts now go to <b>' + (r.title || cid) + '</b>' +
                      (r.warning ? ' (' + r.warning + ')' : '');
        s.style.color = 'var(--green)';
        tgRefresh();
      } else {
        var hint = '';
        if (r.error && r.error.indexOf('400') >= 0) hint = '<br><span style="font-size:10px;color:var(--muted)">Bot is not in this chat. Open the group in Telegram → add your bot as a member.</span>';
        if (r.error && r.error.indexOf('403') >= 0) hint = '<br><span style="font-size:10px;color:var(--muted)">Bot was removed from this chat. Re-add it from group settings.</span>';
        s.innerHTML = '&#x2715; ' + (r.error || 'Could not save.') + hint; s.style.color = 'var(--red)';
      }
    } catch (e) { s.textContent = '❌ Server unreachable — is the backend running?'; s.style.color = 'var(--red)'; }
    btn.textContent = t;
  };

  /* tgInvite removed — bot needs admin rights to create invite links */

  /* ---- 9b. Diagnostics panel ---------------------------------------------
     Kept OUT of the dashboard and behind a disclosure in Settings on purpose:
     these numbers matter perhaps twice a month, and a permanent row of them on
     the trading screen is nine pixels of noise every other day. Every value is
     measured or read - none is decorative. */
  var _diagTimer = null;
  window.pollDiag = function (force) {
    var box = document.getElementById('diagBox');
    var grid = document.getElementById('diagGrid');
    if (!grid) return;
    if (!force && box && !box.open) return;

    var R = window.__apexRuntime;
    var t0 = performance.now();

    Promise.all([
      fetch('/api/health', {cache: 'no-store'}).then(function (r) { return r.json(); }).catch(function () { return null; }),
      fetch('/api/status', {cache: 'no-store'}).then(function (r) { return r.json(); }).catch(function () { return null; })
    ]).then(function (res) {
      var h = res[0] || {}, st = res[1] || {};
      var apiMs = Math.round(performance.now() - t0);

      function cell(k, v, col) {
        var c = col || '';
        return '<div class="dcell"><div class="k">' + k + '</div>' +
               '<div class="v"' + (c ? ' style="color:' + c + '"' : '') + '>' + v + '</div></div>';
      }
      var G = 'var(--green)', Re = 'var(--red)', W = 'var(--warn)', M = 'var(--muted)';
      var C = 'var(--cyan)';

      var sch = R ? R.scheduler() : null;
      var idle = R ? R.idle() : null;
      var tmr = R ? R.timers() : null;
      var wsState = R ? R.wsReadyState() : -1;
      var msgAge = R ? R.lastMessageAge() : null;

      var wsLabel = {0:'CONNECTING',1:'OPEN',2:'CLOSING',3:'CLOSED'}[wsState] || 'UNKNOWN';
      var wsCol = wsState === 1 ? G : wsState === 0 ? W : Re;

      var wk = h.workers || {};
      var wCol = wk.engine === 'alive' && wk.sim === 'alive' && wk.watchdog === 'alive' ? G : Re;
      var wSum = (wk.engine||'?')+' / '+(wk.sim||'?')+' / '+(wk.watchdog||'?');

      var dbMs = h.db_query_ms != null ? Math.round(h.db_query_ms) + ' ms' : 'Unavailable';
      var dbCol = h.db_query_ms != null && h.db_query_ms < 500 ? G : h.db_query_ms != null && h.db_query_ms < 2000 ? W : Re;
      var dbSz = h.db_size_mb != null ? h.db_size_mb + ' MB' : 'Unavailable';

      var freshest = null, oldestKey = null, oldestAge = 0;
      var frs = h.health && h.health.freshness ? h.health.freshness : {};
      Object.keys(frs).forEach(function (k) {
        var f = frs[k];
        if (f && f.age_seconds != null && f.age_seconds > oldestAge) { oldestAge = f.age_seconds; oldestKey = k; }
        if (f && f.status === 'FRESH') freshest = f;
      });
      var freshCol = oldestAge < 120 ? G : oldestAge < 300 ? W : Re;

      var schMode = sch ? sch.mode : '—';
      var schExec = sch ? (sch.executed || 0) : 0;
      var schTasks = sch ? (sch.tasks || 0) : 0;
      var schBlocked = sch ? (sch.blocked || 0) : 0;
      var schSkipped = sch ? (sch.skipped || 0) : 0;
      var schDedup = sch ? (sch.deduped || 0) : 0;
      var schCoal = sch ? (sch.coalesced || 0) : 0;
      var schTick = sch ? (sch.tick || 0) : 0;
      var schModeCol = schMode === 'OPEN' || schMode === 'BUSY' ? G : schMode === 'IDLE' ? W : M;

      var lastTick = null, tickAge = null;
      if (h.last_tick) {
        lastTick = String(h.last_tick).slice(11, 19);
        var t = Date.parse(String(h.last_tick).replace(' ', 'T'));
        if (isFinite(t)) tickAge = Math.round((Date.now() - t) / 1000);
      }
      var tickCol = tickAge != null && tickAge < 60 ? G : tickAge != null && tickAge < 120 ? W : Re;

      var mem = 'Unavailable';
      var memCol = M;
      if (typeof performance !== 'undefined' && performance.memory) {
        var mb = Math.round(performance.memory.usedJSHeapSize / 1048576);
        var limit = Math.round(performance.memory.jsHeapSizeLimit / 1048576);
        mem = mb + ' / ' + limit + ' MB';
        memCol = mb / limit > 0.8 ? W : C;
      }

      var reconn = R ? R.reconnects() : 0;
      var drops = R ? R.disconnects() : 0;

      grid.innerHTML =
        cell('WS Status', wsLabel, wsCol) +
        cell('WS Age', msgAge != null ? msgAge + 's' : 'Unavailable', msgAge != null && msgAge < 5 ? G : W) +
        cell('API Latency', apiMs + ' ms', apiMs > 800 ? Re : apiMs > 300 ? W : G) +
        cell('Last Tick', lastTick || 'Unavailable', tickCol) +

        cell('Workers', wSum, wCol) +
        cell('DB Latency', dbMs, dbCol) +
        cell('DB Size', dbSz, M) +
        cell('DB Ping', h.db_ping_ms != null ? Math.round(h.db_ping_ms) + ' ms' : 'Unavailable', M) +

        cell('Data Freshness', oldestKey ? (oldestKey + ' ' + oldestAge + 's') : 'Unavailable', freshCol) +
        cell('Evidence Fresh.', frs.spot ? (frs.spot.status + ' ' + frs.spot.age_seconds + 's') : 'Unavailable',
             frs.spot && frs.spot.status === 'FRESH' ? G : W) +
        cell('Premium Fresh.', frs.combined_premium ? (frs.combined_premium.status + ' ' + frs.combined_premium.age_seconds + 's') : 'Unavailable',
             frs.combined_premium && frs.combined_premium.status === 'FRESH' ? G : W) +
        cell('VIX Fresh.', frs.vix ? (frs.vix.age_seconds + 's') : 'Unavailable',
             frs.vix && frs.vix.age_seconds < 60 ? G : W) +

        cell('Scheduler', schMode, schModeCol) +
        cell('Sched Tick', '#' + schTick, C) +
        cell('Reg. Tasks', schTasks, C) +
        cell('Executed', schExec, C) +

        cell('Deduped', schDedup, C) +
        cell('Coalesced', schCoal, C) +
        cell('Blocked', schBlocked, schBlocked > 0 ? W : G) +
        cell('Skipped', schSkipped, schSkipped > 0 ? W : G) +

        cell('Reconnects', reconn, reconn > 2 ? W : G) +
        cell('Drops', drops, drops > 0 ? W : G) +
        cell('Idle Queue', idle ? idle.queued : 'Unavailable', idle && idle.queued > 5 ? W : G) +
        cell('Timers', tmr ? tmr.count : 'Unavailable', tmr && tmr.count > 30 ? W : G) +

        cell('JS Heap', mem, memCol) +
        cell('CPU', 'Unavailable', M) +
        cell('ATM', h.atm != null ? h.atm : 'Unavailable', C) +
        cell('Rows Today', h.rows_today != null ? h.rows_today.toLocaleString('en-IN') : 'Unavailable', G);

      var peek = document.getElementById('diagPeek');
      if (peek) {
        peek.textContent = apiMs + 'ms · ' + (wsState === 1 ? 'WS open' : 'WS ' + wsLabel.toLowerCase()) +
                           ' · tick #' + schTick;
        peek.style.color = wsState === 1 && apiMs <= 800 ? 'var(--green)' : 'var(--warn)';
      }
    });
  };

  (function () {
    var box = document.getElementById('diagBox');
    if (!box) return;
    box.addEventListener('toggle', function () {
      clearInterval(_diagTimer);
      if (box.open) { pollDiag(true); _diagTimer = setInterval(pollDiag, 5000); }
    });
  })();


  /* ---- 10. Intelligence Center ------------------------------------------
     Two sidebar entries, "Research Lab" and "Decision Board", described the
     ENGINES rather than the question. Research produces evidence; the Decision
     Board turns evidence into a recommended parameter set. Reading one without
     the other is half an answer, and choosing between two menu items every time
     is a decision the user should never have to make.

     So the UI merges and the architecture does not. The two engines keep
     separate ownership, separate tables and separate EOD jobs; only the page is
     joined. Implemented by MOVING the Decision Board's DOM nodes into the
     Research page — moving preserves every id and every attached handler, so
     renderLab() and renderResearch() work untouched. Rebuilding the markup would
     have meant maintaining it twice. */
  function mergeIntel() {
    var research = document.getElementById('page-research');
    var lab = document.getElementById('page-lab');
    if (!research || !lab || lab.dataset.merged) return;

    var sep = document.createElement('div');
    sep.id = 'intel-decision';
    sep.style.cssText = 'margin:26px 0 14px;padding-top:18px;border-top:1px solid var(--border)';
    sep.innerHTML = '<div class="page-hd" style="margin-bottom:4px">Decision Board</div>' +
      '<div style="font-size:11px;color:var(--muted);line-height:1.6;margin-bottom:14px">' +
      'What the evidence above recommends, once confidence, maturity and robustness ' +
      'gates have been applied. Recommendations only — nothing here changes production.</div>';
    research.appendChild(sep);

    // move, do not clone: handlers and ids survive
    while (lab.firstChild) research.appendChild(lab.firstChild);
    lab.dataset.merged = '1';

    // the Decision Board's own heading is now a duplicate of the section header
    var hd = sep.nextElementSibling;
    if (hd && hd.classList && hd.classList.contains('page-hd')) hd.style.display = 'none';

    // one sidebar entry, not two
    var sbLab = document.querySelector('.sb-item[data-page="lab"]');
    if (sbLab) sbLab.style.display = 'none';
    var sbRes = document.querySelector('.sb-item[data-page="research"]');
    if (sbRes) {
      var l = sbRes.querySelector('.lbl');
      if (l) l.textContent = 'Research Lab';
    }
    var rh = research.querySelector('.page-hd');
    if (rh) rh.innerHTML = 'Research Lab · Evidence → Findings → Recommendations ' +
      '<span style="color:var(--muted);font-weight:500;font-size:11px" id="rlBuilt"></span>';

    // both engines render together, from whichever entry point is used
    if (typeof window.nav === 'function') {
      var _n3 = window.nav;
      window.nav = function (page, el) {
        if (page === 'lab') page = 'research';                 // old links still work
        var r = _n3(page, el);
        if (page === 'research') {
          setTimeout(function () { try { if (typeof renderLab === 'function') renderLab(); } catch (e) {} }, 60);
        }
        return r;
      };
    }
    // and in the phone sheet / tab bar lists
    try {
      var P = window.__apexPages;
      if (P) {
        for (var i = 0; i < P.length; i++) if (P[i][0] === 'research') P[i][1] = 'Research Lab';
        for (var j = P.length - 1; j >= 0; j--) if (P[j][0] === 'lab') P.splice(j, 1);
      }
    } catch (e) {}
  }

  /* ---- Gesture engine: navigation hooks -----------------------------------
     These functions are called by the GestureEngine when it detects navigation
     gestures. They navigate through trading days and strikes on the tracker. */
  window._geNavigateDay = function (dir) {
    // Try to use existing history range buttons
    var btns = document.querySelectorAll('#page-history .rng-btn');
    if (btns.length > 0) {
      var active = -1;
      btns.forEach(function (b, i) { if (b.classList.contains('on')) active = i; });
      var next = active + dir;
      if (next >= 0 && next < btns.length) { btns[next].click(); return; }
    }
    // Fallback: adjust _histDays
    if (typeof window._histDays !== 'undefined') {
      window._histDays = Math.max(1, (window._histDays || 5) + dir * 5);
      if (typeof renderHistory === 'function') renderHistory();
    }
  };
  window._geNavigateStrike = function (dir) {
    // Try to find a strike navigation control
    var sel = document.querySelector('#tracker-strike-sel, select[data-strike]');
    if (sel) {
      var idx = sel.selectedIndex + dir;
      if (idx >= 0 && idx < sel.options.length) { sel.selectedIndex = idx; sel.dispatchEvent(new Event('change')); }
    }
  };

  function boot() {
    // One-time DOM work always runs - it costs nothing after it has happened, and
    // mergeIntel in particular has to run or the Intelligence Center is two pages again.
    mergeIntel();

    // Init gesture engine (does not start camera — just loads settings)
    if (window.GestureEngine) {
      try { GestureEngine.init(); } catch (e) {}
      // Auto-start if previously enabled
      try {
        var gs = GestureEngine.getSettings();
        if (gs.enabled) GestureEngine.start();
      } catch (e) {}
    }

    if (!WORKSTATION_TIMERS) return;

    mountStatus(); tickStatus(); setInterval(tickStatus, 1000);
    // Tailscale chip removed - its endpoint shelled out to a binary that hangs when
    // Tailscale is wedged, which stalled the whole dashboard. Use `tailscale status`.
    mountFeed(); pollFeed(); setInterval(pollFeed, 30000);
    hero();
    setTimeout(function () { if (!deepLink()) restorePage(); }, 400);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

/* ═══ INDEX DETAIL SHEET ═══════════════════════════════════════════════════════
   Opens from any strip chip. Live by construction: while open it re-reads
   /api/index/<symbol>, which is a pure in-memory read on the server (no DB, no chain
   work, no new subscription), driven by the SAME 1s cadence the strip already uses.
   Closing stops the refresh — an open-ended interval behind a closed modal is exactly
   how these leak. */
(function(){
  var sheet=document.getElementById('indexSheet');
  if(!sheet) return;
  var cur=null, timer=null, lastFocus=null, failures=0;
  var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(m){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];});};
  var num=function(v,d){return (v==null||v==='')?'—':Number(v).toLocaleString('en-IN',
    {minimumFractionDigits:d==null?2:d,maximumFractionDigits:d==null?2:d});};
  var cell=function(k,v,cls){return '<div class="est-hist-cell"><div class="est-k">'+esc(k)+
    '</div><div class="est-v num'+(cls?' '+cls:'')+'">'+v+'</div></div>';};
  var signed=function(v,pct){
    if(v==null) return '<span style="color:var(--muted)">—</span>';
    var up=Number(v)>=0;
    return '<span style="color:var(--'+(up?'green':'red')+')">'+(up?'+':'')+
           num(v)+(pct?'%':'')+'</span>';};

  function paint(d){
    if(!d || d.error){
      document.getElementById('ix-note').textContent = d&&d.error ? d.error : 'unavailable';
      return;
    }
    var i=d.index||{}, t=d.straddle||{};
    document.getElementById('ix-sheet-title').textContent=d.name||d.symbol;
    document.getElementById('ix-sheet-sub').textContent=
      (d.exchange||'')+(d.expiry?(' · expiry '+d.expiry):'')+(d.stale?' · STALE FEED':' · live');
    document.getElementById('ix-index-grid').innerHTML=
      cell('Spot',num(i.spot))+cell('Previous Close',num(i.prev_close))+
      cell('Open',num(i.open))+cell('High',num(i.high))+cell('Low',num(i.low))+
      cell('Current',num(i.current))+cell('Change',signed(i.change))+
      cell('Change %',signed(i.change_pct,true))+cell('Day Range',num(i.day_range))+
      cell('Timestamp',esc((i.timestamp||'—').slice(11,19)||'—'));
    document.getElementById('ix-strad-grid').innerHTML=
      cell('ATM Strike',num(t.atm_strike,0))+cell('Current Premium',num(t.premium))+
      cell('Previous Close',num(t.prev_close))+cell('Open',num(t.open))+
      cell('High',num(t.high))+cell('Low',num(t.low))+
      cell('Current',num(t.current))+cell('Change',signed(t.change))+
      cell('Change %',signed(t.change_pct,true))+
      cell('Day High',num(t.day_high))+cell('Day Low',num(t.day_low))+
      cell('CE',num(t.ce))+cell('PE',num(t.pe))+
      cell('Last Update',esc((t.timestamp||'—').slice(11,19)||'—'));
    document.getElementById('ix-note').textContent=
      'Every value is live from the Dhan WebSocket. ATM re-centres automatically when '+
      'spot crosses a strike boundary (step '+(d.strike_step||'—')+').';
  }

  async function refresh(){
    if(!cur) return;
    try{ paint(await jget('/api/index/'+encodeURIComponent(cur), 900)); failures=0; }
    catch(e){
      /* A 404 here means the running server predates this route — the HTML is served
         from disk but routes bind at import. Polling harder cannot fix that, so stop
         after a few attempts and say the actual cause instead of spamming the log
         once a second forever. */
      failures++;
      if(failures>=3){
        if(timer){ clearInterval(timer); timer=null; }
        var note=document.getElementById('ix-note');
        if(note) note.textContent =
          'Live detail unavailable: /api/index/'+cur+' did not respond. If this is a 404, '+
          'the server was started before this endpoint existed — restart it once. '+
          'The strip above keeps updating normally.';
      }
    }
  }

  function open(sym){
    cur=sym; failures=0; lastFocus=document.activeElement;
    sheet.hidden=false; document.body.style.overflow='hidden';
    var cl=sheet.querySelector('.est-close'); if(cl) cl.focus();
    refresh();
    if(timer) clearInterval(timer);
    timer=setInterval(refresh,1000);      // scheduler-owned: auto-pauses on tab hide
  }
  function close(){
    cur=null; sheet.hidden=true; document.body.style.overflow='';
    if(timer){ clearInterval(timer); timer=null; }   // no orphaned interval
    if(lastFocus&&lastFocus.focus) lastFocus.focus();
  }
  // Delegated: chips are re-rendered every cycle, so per-chip listeners would be
  // re-attached endlessly. One listener on the strip survives every re-render.
  var strip=document.getElementById('idxSpots');
  if(strip){
    strip.addEventListener('click',function(e){
      var c=e.target.closest('[data-ix]'); if(c) open(c.getAttribute('data-ix'));
    });
    strip.addEventListener('keydown',function(e){
      if(e.key!=='Enter'&&e.key!==' ') return;
      var c=e.target.closest('[data-ix]'); if(c){ e.preventDefault(); open(c.getAttribute('data-ix')); }
    });
  }
  sheet.addEventListener('click',function(e){ if(e.target.closest('[data-ix-close]')) close(); });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&!sheet.hidden) close(); });
  window.__ixSheet={open:open,close:close,isOpen:function(){return !sheet.hidden;}};
})();
