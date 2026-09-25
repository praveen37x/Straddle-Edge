/* ═══ APEX timer scheduler ══════════════════════════════════════════════════════
   ONE owner for every repeating timer in the dashboard.

   THE PROBLEM, measured: 19 of the 31 setInterval() call sites discard their handle,
   so they can never be cleared. Several run at 1000ms (clock, flash, tickStatus) and
   several poll the network at 3-30s. Nothing stops them when the tab is hidden, so a
   backgrounded terminal kept doing ~20 network round-trips a minute and waking the main
   thread every second, indefinitely — on a laptop that is measurable battery drain, and
   on a phone it is the difference between a PWA you leave open and one you close.

   THE FIX, and why it is done HERE rather than at the call sites: wrapping the primitive
   means all 19 sites are covered without editing one of them. Rewriting them by hand
   would have been 19 chances to introduce a regression in code that is otherwise working
   and proven. The wrapper is ~60 lines and behaviourally identical to the native pair.

   CONTRACT — this must remain a drop-in replacement:
     * setInterval returns a handle that clearInterval accepts.
     * Handles are namespaced above 1e9 so a native id passed to our clearInterval
       (from any code that ran before this file) is still forwarded to the native one.
     * Extra arguments (setInterval(fn, ms, a, b)) are preserved.
     * On resume, a timer whose period elapsed while hidden fires ONCE immediately, so
       returning to the tab shows fresh data instead of waiting a full period.

   Loaded first (defer preserves document order), so every later timer is registered. */
(function () {
  "use strict";
  if (window.__APEX_SCHED) { return; }

  var _si = window.setInterval, _ci = window.clearInterval;
  var reg = new Map(), seq = 1000000000, hidden = false;

  window.setInterval = function (fn, ms) {
    var extra = Array.prototype.slice.call(arguments, 2);
    var vid = ++seq;
    var rec = { fn: fn, ms: ms, extra: extra, nid: null, last: Date.now() };
    reg.set(vid, rec);
    if (!hidden) { rec.nid = _si.apply(window, [tick(rec), ms].concat(extra)); }
    return vid;
  };

  // Wrapping the callback lets `last` track real firings, which is what makes the
  // catch-up-on-resume decision honest rather than a guess.
  function tick(rec) {
    return function () {
      rec.last = Date.now();
      return rec.fn.apply(this, arguments);
    };
  }

  window.clearInterval = function (vid) {
    var rec = reg.get(vid);
    if (!rec) { return _ci(vid); }          // not ours — forward untouched
    if (rec.nid != null) { _ci(rec.nid); }
    reg.delete(vid);
  };

  function pause() {
    if (hidden) { return; }
    hidden = true;
    reg.forEach(function (rec) {
      if (rec.nid != null) { _ci(rec.nid); rec.nid = null; }
    });
  }

  function resume() {
    if (!hidden) { return; }
    hidden = false;
    var now = Date.now();
    reg.forEach(function (rec) {
      if (rec.nid == null) {
        rec.nid = _si.apply(window, [tick(rec), rec.ms].concat(rec.extra));
        // Overdue while hidden -> refresh now. Scheduled on a macrotask so a burst of
        // catch-ups cannot become one long task on the frame the user just came back to.
        if (now - rec.last >= rec.ms) {
          setTimeout(function () {
            // .apply with rec.extra — a bare rec.fn() would drop the arguments passed to
            // setInterval(fn, ms, ...args) and hand the callback `undefined` on exactly
            // the firing the user is waiting for. Caught by the scheduler proof.
            try { rec.last = Date.now(); rec.fn.apply(window, rec.extra); }
            catch (e) { /* a stale catch-up poll must never throw into the page */ }
          }, 0);
        }
      }
    });
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { pause(); } else { resume(); }
  }, { passive: true });
  window.addEventListener("pagehide", pause, { passive: true });
  window.addEventListener("pageshow", resume, { passive: true });

  /* ── IDLE BOOT QUEUE ────────────────────────────────────────────────────────
     MEASURED: 15 functions run at top level during boot, and several of them build a
     whole panel — Chart.js constructing a 376-point dataset, three table renders, the
     settings health footer. Executed back-to-back in the same task they are exactly
     what Lighthouse reports as Total Blocking Time (1990ms) and "20 long tasks".

     APEX.idle(fn) defers work to an idle slice while PRESERVING SUBMISSION ORDER —
     order matters because several of these renders depend on state the earlier ones
     set. One item runs per slice and the queue yields between items, so a slow panel
     cannot merge with the next one into a single long task.

     The 1500ms timeout is a deliberate ceiling: on a busy main thread requestIdleCallback
     can be starved indefinitely, and a panel that never renders is a bug, not an
     optimisation. Falls back to setTimeout where rIC is unavailable (Safari < 16.4). */
  var q = [], draining = false;
  var ric = window.requestIdleCallback || function (cb) {
    return setTimeout(function () { cb({ didTimeout: true, timeRemaining: function () { return 8; } }); }, 1);
  };

  function drain(deadline) {
    // Run at most one unit per slice unless there is genuine time left; that keeps each
    // task short instead of trading many small tasks for one long one.
    do {
      var job = q.shift();
      if (!job) { draining = false; return; }
      try { job.fn(); } catch (e) { if (window.console) { console.error("APEX idle:" + job.name, e); } }
    } while (q.length && deadline && deadline.timeRemaining && deadline.timeRemaining() > 8);
    if (q.length) { ric(drain, { timeout: 1500 }); } else { draining = false; }
  }

  window.APEX = window.APEX || {};
  window.APEX.idle = function (fn, name) {
    if (typeof fn !== "function") { return; }
    q.push({ fn: fn, name: name || fn.name || "anon" });
    if (!draining) { draining = true; ric(drain, { timeout: 1500 }); }
  };
  window.APEX.idleStats = function () { return { queued: q.length, draining: draining }; };

  window.__APEX_SCHED = {
    /* Introspection for the Engineering Center / console — how many timers exist, how
       often they fire, and whether they are currently suspended. */
    stats: function () {
      var out = [], now = Date.now();
      reg.forEach(function (rec, vid) {
        out.push({ id: vid, ms: rec.ms, running: rec.nid != null,
                   idle_ms: now - rec.last,
                   fn: (rec.fn.name || "anonymous") });
      });
      return { hidden: hidden, count: reg.size,
               wakeups_per_min: out.reduce(function (a, r) { return a + 60000 / r.ms; }, 0),
               timers: out.sort(function (a, b) { return a.ms - b.ms; }) };
    },
    pause: pause,
    resume: resume,
    /* Full teardown — used by the rollback path and by leak tests. */
    clearAll: function () {
      var n = reg.size;
      reg.forEach(function (rec) { if (rec.nid != null) { _ci(rec.nid); } });
      reg.clear();
      return n;
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // CENTRALIZED RUNTIME SCHEDULER — replaces scattered timers with priority queue
  // ═══════════════════════════════════════════════════════════════════════════
  var _tasks = {};                          // name -> {fn, interval, priority, marketMode}
  var _marketMode = 'OPEN';                  // OPEN | BUSY | NORMAL | IDLE | CLOSED | BACKGROUND
  var _dedupeStore = {};                    // key -> {ts, promise}
  var _coalesceStore = {};                  // key -> promise (one producer, many consumers)
  var _metrics = { executed: 0, deduped: 0, coalesced: 0, skipped: 0, blocked: 0 };
  var _masterTimer = null;
  var _tickSeq = 0;

  // Adaptive polling intervals per market mode (in ms)
  var MODE_INTERVALS = {
    OPEN:       { CRITICAL:1000, HIGH:2000, MEDIUM:3000, LOW:5000 },
    BUSY:       { CRITICAL:1500, HIGH:3000, MEDIUM:5000, LOW:8000 },
    NORMAL:     { CRITICAL:2000, HIGH:5000, MEDIUM:8000, LOW:15000 },
    IDLE:       { CRITICAL:3000, HIGH:8000, MEDIUM:15000, LOW:30000 },
    CLOSED:     { CRITICAL:5000, HIGH:15000, MEDIUM:30000, LOW:60000 },
    BACKGROUND: { CRITICAL:10000, HIGH:30000, MEDIUM:60000, LOW:120000 }
  };

  // Priority ordering
  var PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

  window.ApexScheduler = {
    // Register a periodic task. fn returns a Promise for async tasks.
    register: function(name, fn, opts) {
      opts = opts || {};
      _tasks[name] = {
        fn: fn, name: name,
        interval: opts.interval || 5000,
        priority: opts.priority || 'MEDIUM',
        marketMode: opts.marketMode || 'always',
        lastRun: 0,
        running: false,
        errors: 0
      };
    },

    setMarketMode: function(mode) {
      if (MODE_INTERVALS[mode]) { _marketMode = mode; }
    },

    start: function() {
      if (_masterTimer) return;
      _masterTimer = setInterval(function() {
        _tickSeq++;
        var now = Date.now();
        var intervals = MODE_INTERVALS[_marketMode] || MODE_INTERVALS.NORMAL;

        // Execute tasks in priority order with adaptive intervals
        for (var pi = 0; pi < PRIORITIES.length; pi++) {
          var priority = PRIORITIES[pi];
          var adaptiveMs = intervals[priority] || 5000;
          var keys = Object.keys(_tasks);
          for (var i = 0; i < keys.length; i++) {
            var t = _tasks[keys[i]];
            if (t.priority !== priority) continue;
            if (t.running) { _metrics.blocked++; continue; }
            if (now - t.lastRun < adaptiveMs) continue;

            t.lastRun = now;
            t.running = true;
            _metrics.executed++;
            try {
              var result = t.fn();
              if (result && typeof result.then === 'function') {
                result.then(function() { t.running = false; }).catch(function(e) {
                  t.errors++; t.running = false;
                });
              } else {
                t.running = false;
              }
            } catch(e) {
              t.errors++; t.running = false;
            }
          }
        }
      }, 1000); // master tick at 1s — actual execution gated by adaptive intervals
    },

    stop: function() {
      if (_masterTimer) { clearInterval(_masterTimer); _masterTimer = null; }
    },

    // Request deduplication — returns cached promise if same key is in-flight
    dedupe: function(key, fetchFn, ttl) {
      ttl = ttl || 3000;
      var cached = _dedupeStore[key];
      if (cached && (Date.now() - cached.ts) < ttl) {
        _metrics.deduped++;
        return cached.promise;
      }
      var promise = fetchFn();
      _dedupeStore[key] = { ts: Date.now(), promise: promise };
      return promise;
    },

    // Request coalescing — ONE producer, many consumers get same result
    coalesce: function(key, computeFn, ttl) {
      ttl = ttl || 2000;
      var cached = _coalesceStore[key];
      if (cached && (Date.now() - cached.ts) < ttl) {
        _metrics.coalesced++;
        return cached.promise;
      }
      var promise = computeFn();
      _coalesceStore[key] = { ts: Date.now(), promise: promise };
      return promise;
    },

    metrics: function() {
      var taskList = [];
      Object.keys(_tasks).forEach(function(k) {
        var t = _tasks[k];
        taskList.push({
          name: k, priority: t.priority, interval: t.interval,
          lastRun: t.lastRun, running: t.running, errors: t.errors,
          age: t.lastRun ? Math.round((Date.now() - t.lastRun) / 1000) + 's' : 'never'
        });
      });
      return {
        mode: _marketMode, tasks: taskList.length, tick: _tickSeq,
        executed: _metrics.executed, deduped: _metrics.deduped,
        coalesced: _metrics.coalesced, skipped: _metrics.skipped, blocked: _metrics.blocked,
        taskDetails: taskList.sort(function(a,b) {
          var pa = PRIORITIES.indexOf(a.priority), pb = PRIORITIES.indexOf(b.priority);
          return pa - pb || a.name.localeCompare(b.name);
        })
      };
    }
  };
})();
