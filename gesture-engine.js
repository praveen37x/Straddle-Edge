/**
 * APEX GestureEngine — Hands-free camera gesture control
 *
 * Privacy-first: all recognition runs locally via MediaPipe WASM.
 * No frames are stored, uploaded, or transmitted.
 *
 * Requires: @mediapipe/hands, @mediapipe/camera_utils (loaded via CDN in the HTML).
 */
(function () {
  'use strict';

  var GE = {};
  window.GestureEngine = GE;

  /* ── State ──────────────────────────────────────────────────────────────── */
  var _stream = null;
  var _hands = null;
  var _camera = null;
  var _running = false;
  var _paused = false;
  var _lastGesture = null;
  var _lastGestureTime = 0;
  var _holdStart = 0;
  var _holdGesture = null;
  var _wristHistory = [];
  var _cooldown = 800;
  var _confidence = 0.7;
  var _frameCount = 0;
  var _fps = 0;
  var _fpsTimer = Date.now();
  var _lastActionLabel = '';
  var _lastActionTime = 0;
  var _typingActive = false;
  var _marketClosed = false;
  var _overlayEl = null;
  var _previewEl = null;
  var _gestureCallbacks = {};

  /* ── Default settings ───────────────────────────────────────────────────── */
  var DEFAULTS = {
    enabled: false,
    showOverlay: true,
    showPreview: true,
    confidence: 0.7,
    cooldown: 800,
    dominantHand: 'right',
    dashboardGestures: true,
    trackerGestures: true,
    chartGestures: true,
    navGestures: true,
    quickActionsGestures: true,
    autoPauseTyping: true,
    autoPauseMarketClosed: true,
    sensitivity: 0.7,
    holdDuration: 1500,
    swipeThreshold: 0.15,
    swipeTimeWindow: 400,
    cameraFacing: 'user'
  };

  var _settings = {};

  function loadSettings() {
    try {
      var raw = localStorage.getItem('apexGestureSettings');
      _settings = raw ? JSON.parse(raw) : {};
    } catch (e) { _settings = {}; }
    for (var k in DEFAULTS) {
      if (_settings[k] === undefined) _settings[k] = DEFAULTS[k];
    }
    _cooldown = _settings.cooldown;
    _confidence = _settings.confidence;
  }

  function saveSettings() {
    try { localStorage.setItem('apexGestureSettings', JSON.stringify(_settings)); } catch (e) {}
  }

  GE.getSettings = function () { loadSettings(); return JSON.parse(JSON.stringify(_settings)); };
  GE.setSettings = function (patch) {
    for (var k in patch) _settings[k] = patch[k];
    saveSettings();
    if (patch.cooldown !== undefined) _cooldown = patch.cooldown;
    if (patch.confidence !== undefined) _confidence = patch.confidence;
  };

  /* ── Gesture definitions ─────────────────────────────────────────────────── */
  var GESTURES = {
    OPEN_PALM:    { label: 'Open Palm',   icon: '\u270B', desc: 'Pause/Resume live updates' },
    CLOSED_FIST:  { label: 'Fist',        icon: '\u270A', desc: 'Lock / Unlock interface' },
    THUMBS_UP:    { label: 'Thumbs Up',   icon: '\uD83D\uDC4D', desc: 'Bookmark current view' },
    THUMBS_DOWN:  { label: 'Thumbs Down', icon: '\uD83D\uDC4E', desc: 'Remove bookmark' },
    POINT_LEFT:   { label: 'Point Left',  icon: '\u2B05\uFE0F', desc: 'Previous strike' },
    POINT_RIGHT:  { label: 'Point Right', icon: '\u27A1\uFE0F', desc: 'Next strike' },
    TWO_FINGERS:  { label: 'V Sign',      icon: '\u270C\uFE0F', desc: 'Toggle fullscreen chart' },
    OK_GESTURE:   { label: 'OK',          icon: '\uD83D\uDC4C', desc: 'Refresh data' },
    SWIPE_LEFT:   { label: 'Swipe Left',  icon: '\u2B05\uFE0F', desc: 'Previous trading day' },
    SWIPE_RIGHT:  { label: 'Swipe Right', icon: '\u27A1\uFE0F', desc: 'Next trading day' },
    LONG_PALM:    { label: 'Hold Palm',   icon: '\u23F8\uFE0F', desc: 'Open Quick Menu' }
  };
  GE.GESTURES = GESTURES;

  /* ── Landmark indices ────────────────────────────────────────────────────── */
  var WRIST = 0;
  var THUMB_TIP = 4, THUMB_IP = 3, THUMB_MCP = 2;
  var INDEX_TIP = 8, INDEX_PIP = 6, INDEX_MCP = 5;
  var MIDDLE_TIP = 12, MIDDLE_PIP = 10, MIDDLE_MCP = 9;
  var RING_TIP = 16, RING_PIP = 14, RING_MCP = 13;
  var PINKY_TIP = 20, PINKY_PIP = 18, PINKY_MCP = 17;

  /* ── Finger extension check ──────────────────────────────────────────────── */
  function isFingerExtended(lm, tip, pip) {
    return lm[tip].y < lm[pip].y;
  }

  function isThumbExtended(lm, handedness) {
    var tipX = lm[THUMB_TIP].x;
    var ipX = lm[THUMB_IP].x;
    var mcpX = lm[THUMB_MCP].x;
    var wristX = lm[WRIST].x;
    var isRight = (handedness === 'Right');
    if (isRight) {
      return tipX < mcpX;
    } else {
      return tipX > mcpX;
    }
  }

  function getFingerStates(lm, handedness) {
    return {
      thumb:  isThumbExtended(lm, handedness),
      index:  isFingerExtended(lm, INDEX_TIP, INDEX_PIP),
      middle: isFingerExtended(lm, MIDDLE_TIP, MIDDLE_PIP),
      ring:   isFingerExtended(lm, RING_TIP, RING_PIP),
      pinky:  isFingerExtended(lm, PINKY_TIP, PINKY_PIP)
    };
  }

  /* ── Gesture classifier ──────────────────────────────────────────────────── */
  function classifyStatic(lm, handedness) {
    var f = getFingerStates(lm, handedness);
    var count = [f.thumb, f.index, f.middle, f.ring, f.pinky].filter(Boolean).length;

    // OK gesture: thumb tip near index tip, others curled
    var okDist = Math.hypot(
      lm[THUMB_TIP].x - lm[INDEX_TIP].x,
      lm[THUMB_TIP].y - lm[INDEX_TIP].y
    );
    if (okDist < 0.06 && !f.middle && !f.ring && !f.pinky) {
      return { gesture: 'OK_GESTURE', confidence: 0.85 };
    }

    // All five extended = open palm
    if (count === 5) {
      return { gesture: 'OPEN_PALM', confidence: 0.9 };
    }

    // All curled = fist
    if (count === 0) {
      return { gesture: 'CLOSED_FIST', confidence: 0.85 };
    }

    // Thumb extended + exactly 1 finger extended
    if (f.thumb && count === 1) {
      // Check if thumb is pointing up or down
      var thumbUp = lm[THUMB_TIP].y < lm[THUMB_IP].y;
      var thumbDown = lm[THUMB_TIP].y > lm[THUMB_IP].y + 0.04;
      if (thumbUp) return { gesture: 'THUMBS_UP', confidence: 0.85 };
      if (thumbDown) return { gesture: 'THUMBS_DOWN', confidence: 0.8 };
    }

    // Index only: point left or right
    if (!f.thumb && f.index && !f.middle && !f.ring && !f.pinky) {
      var dirX = lm[INDEX_TIP].x - lm[INDEX_MCP].x;
      if (dirX < -0.04) return { gesture: 'POINT_LEFT', confidence: 0.8 };
      if (dirX > 0.04)  return { gesture: 'POINT_RIGHT', confidence: 0.8 };
    }

    // Two fingers (index + middle): V sign
    if (f.index && f.middle && !f.ring && !f.pinky) {
      return { gesture: 'TWO_FINGERS', confidence: 0.8 };
    }

    return null;
  }

  /* ── Swipe detection ─────────────────────────────────────────────────────── */
  function detectSwipe(lm) {
    var now = Date.now();
    var wx = lm[WRIST].x;
    _wristHistory.push({ x: wx, t: now });

    // Keep only recent samples
    while (_wristHistory.length > 0 && now - _wristHistory[0].t > _settings.swipeTimeWindow) {
      _wristHistory.shift();
    }
    if (_wristHistory.length < 5) return null;

    var first = _wristHistory[0];
    var last = _wristHistory[_wristHistory.length - 1];
    var dx = last.x - first.x;
    var dt = last.t - first.t;

    if (Math.abs(dx) > _settings.swipeThreshold && dt > 80 && dt < _settings.swipeTimeWindow) {
      _wristHistory = [];
      // Camera is mirrored, so dx < 0 means user moved hand to their right (screen left)
      return dx < 0 ? 'SWIPE_RIGHT' : 'SWIPE_LEFT';
    }

    return null;
  }

  /* ── Hold detection ──────────────────────────────────────────────────────── */
  function detectHold(staticResult, now) {
    if (!staticResult) {
      _holdStart = 0;
      _holdGesture = null;
      return null;
    }
    if (staticResult.gesture !== _holdGesture) {
      _holdGesture = staticResult.gesture;
      _holdStart = now;
      return null;
    }
    if (staticResult.gesture === 'OPEN_PALM' && (now - _holdStart) > _settings.holdDuration) {
      _holdStart = now + 5000; // prevent re-trigger for 5s
      return 'LONG_PALM';
    }
    return null;
  }

  /* ── Page context ────────────────────────────────────────────────────────── */
  function getCurrentPage() {
    var on = document.querySelector('.page.on');
    if (on) return on.id.replace('page-', '');
    return 'live';
  }

  function isTrackerPage() { return getCurrentPage() === 'tracker'; }
  function isChartVisible() {
    var c = document.getElementById('intraChart') || document.querySelector('canvas');
    return c && c.offsetParent !== null;
  }

  /* ── Action registry ─────────────────────────────────────────────────────── */
  var _actions = {};

  function registerAction(gesture, handler, label) {
    _actions[gesture] = { handler: handler, label: label || (GESTURES[gesture] || {}).label || gesture };
  }

  function fireAction(gesture) {
    var a = _actions[gesture];
    if (!a) return;
    var now = Date.now();
    if (now - _lastActionTime < _cooldown) return;
    _lastActionTime = now;
    _lastActionLabel = a.label;
    try { a.handler(); } catch (e) { console.warn('[GestureEngine] action error', gesture, e); }
    updateOverlayGesture(gesture, a.label);
    flashActionFeedback(a.label);
  }

  /* ── Built-in actions ────────────────────────────────────────────────────── */

  // Pause / Resume live data refresh
  registerAction('OPEN_PALM', function () {
    window._GE_PAUSED = !window._GE_PAUSED;
    toast('Live updates ' + (window._GE_PAUSED ? 'PAUSED' : 'RESUMED'), 2000);
  }, 'Pause/Resume');

  // Lock / Unlock interface
  registerAction('CLOSED_FIST', function () {
    window._GE_LOCKED = !window._GE_LOCKED;
    document.body.classList.toggle('gesture-locked', !!window._GE_LOCKED);
    toast('Interface ' + (window._GE_LOCKED ? 'LOCKED' : 'UNLOCKED'), 2000);
  }, 'Lock/Unlock');

  // Bookmark
  registerAction('THUMBS_UP', function () {
    var page = getCurrentPage();
    var bookmarks = JSON.parse(localStorage.getItem('apexBookmarks') || '[]');
    if (bookmarks.indexOf(page) === -1) {
      bookmarks.push(page);
      localStorage.setItem('apexBookmarks', JSON.stringify(bookmarks));
      toast('Bookmarked: ' + page, 2000);
    } else {
      toast('Already bookmarked', 1500);
    }
  }, 'Bookmark');

  // Remove bookmark
  registerAction('THUMBS_DOWN', function () {
    var page = getCurrentPage();
    var bookmarks = JSON.parse(localStorage.getItem('apexBookmarks') || '[]');
    var idx = bookmarks.indexOf(page);
    if (idx !== -1) {
      bookmarks.splice(idx, 1);
      localStorage.setItem('apexBookmarks', JSON.stringify(bookmarks));
      toast('Bookmark removed', 2000);
    }
  }, 'Remove Bookmark');

  // Navigate day (previous)
  registerAction('SWIPE_LEFT', function () {
    if (typeof window._geNavigateDay === 'function') window._geNavigateDay(-1);
    else toast('Previous day', 1200);
  }, 'Previous Day');

  // Navigate day (next)
  registerAction('SWIPE_RIGHT', function () {
    if (typeof window._geNavigateDay === 'function') window._geNavigateDay(1);
    else toast('Next day', 1200);
  }, 'Next Day');

  // Navigate strike (previous)
  registerAction('POINT_LEFT', function () {
    if (typeof window._geNavigateStrike === 'function') window._geNavigateStrike(-1);
    else toast('Previous strike', 1200);
  }, 'Previous Strike');

  // Navigate strike (next)
  registerAction('POINT_RIGHT', function () {
    if (typeof window._geNavigateStrike === 'function') window._geNavigateStrike(1);
    else toast('Next strike', 1200);
  }, 'Next Strike');

  // Toggle fullscreen chart
  registerAction('TWO_FINGERS', function () {
    var chartEl = document.getElementById('intraChart');
    if (!chartEl) { toast('No chart visible', 1200); return; }
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      (chartEl.closest('.card') || chartEl.parentElement).requestFullscreen().catch(function () {});
    }
  }, 'Fullscreen');

  // Refresh data
  registerAction('OK_GESTURE', function () {
    if (typeof window.loop === 'function') { window.loop(); toast('Data refreshed', 1200); }
    else toast('Refresh', 1200);
  }, 'Refresh');

  // Quick menu
  registerAction('LONG_PALM', function () {
    if (typeof window.openSheet === 'function') window.openSheet();
    else toast('Quick Menu', 1200);
  }, 'Quick Menu');

  GE.registerAction = registerAction;

  /* ── Toast helper ────────────────────────────────────────────────────────── */
  function toast(msg, dur) {
    if (typeof window.showToast === 'function') { window.showToast(msg, dur || 2000); return; }
    var el = document.createElement('div');
    el.className = 'ge-toast';
    el.textContent = msg;
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
      'background:var(--surface2,#1a1f2e);color:var(--text,#e0e0e0);padding:8px 18px;' +
      'border-radius:10px;font-size:12px;font-weight:600;z-index:100001;pointer-events:none;' +
      'box-shadow:0 4px 12px rgba(0,0,0,.4);transition:opacity .4s;border:1px solid var(--border2,#2a2f3e)';
    document.body.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; setTimeout(function () { el.remove(); }, 500); }, dur || 2000);
  }
  GE.toast = toast;

  /* ── Action feedback flash ───────────────────────────────────────────────── */
  function flashActionFeedback(label) {
    var fb = document.getElementById('ge-action-flash');
    if (!fb) return;
    fb.textContent = label;
    fb.classList.add('show');
    clearTimeout(fb._t);
    fb._t = setTimeout(function () { fb.classList.remove('show'); }, 1200);
  }

  /* ── Overlay ─────────────────────────────────────────────────────────────── */
  function createOverlay() {
    if (_overlayEl) return;
    var el = document.createElement('div');
    el.id = 'gesture-overlay';
    el.innerHTML =
      '<div class="ge-bar">' +
        '<div class="ge-status-row">' +
          '<span class="ge-cam-dot" id="ge-cam-dot"></span>' +
          '<span id="ge-status-label" style="font-size:10px;font-weight:600">Gesture</span>' +
          '<span id="ge-fps" style="margin-left:auto;font-size:9px;color:var(--muted)">0 FPS</span>' +
          '<button id="ge-close-btn" title="Close overlay" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;padding:2px 6px">&times;</button>' +
        '</div>' +
        '<div class="ge-gesture-row" id="ge-gesture-row">' +
          '<span id="ge-gesture-icon" style="font-size:20px">&nbsp;</span>' +
          '<span id="ge-gesture-name" style="font-size:10px;color:var(--muted)">No gesture</span>' +
        '</div>' +
        '<div class="ge-action-flash" id="ge-action-flash"></div>' +
      '</div>';
    document.body.appendChild(el);
    _overlayEl = el;

    el.querySelector('#ge-close-btn').addEventListener('click', function () {
      GE.setSettings({ showOverlay: false });
      el.style.display = 'none';
    });

    // Inject overlay CSS if not already present
    if (!document.getElementById('ge-overlay-css')) {
      var style = document.createElement('style');
      style.id = 'ge-overlay-css';
      style.textContent =
        '#gesture-overlay{position:fixed;top:70px;right:12px;z-index:100000;pointer-events:auto;' +
          'font-family:var(--mono,monospace);user-select:none;-webkit-user-select:none}' +
        '#gesture-overlay .ge-bar{background:rgba(15,18,25,.92);backdrop-filter:blur(8px);' +
          '-webkit-backdrop-filter:blur(8px);border:1px solid rgba(88,166,255,.2);border-radius:12px;' +
          'padding:10px 14px;min-width:160px;box-shadow:0 4px 20px rgba(0,0,0,.5)}' +
        '#gesture-overlay .ge-status-row{display:flex;align-items:center;gap:7px}' +
        '#gesture-overlay .ge-cam-dot{width:7px;height:7px;border-radius:50%;background:#666;' +
          'flex-shrink:0;transition:background .3s}' +
        '#gesture-overlay .ge-cam-dot.on{background:#31C48D;box-shadow:0 0 6px rgba(49,196,141,.6)}' +
        '#gesture-overlay .ge-cam-dot.err{background:#EE5A6E}' +
        '#gesture-overlay .ge-gesture-row{display:flex;align-items:center;gap:10px;' +
          'margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.06);min-height:28px}' +
        '#gesture-overlay .ge-action-flash{position:absolute;bottom:0;left:50%;transform:translateX(-50%);' +
          'background:var(--accent,#58A6FF);color:#000;font-size:10px;font-weight:700;padding:4px 14px;' +
          'border-radius:0 0 12px 12px;opacity:0;transition:opacity .2s;white-space:nowrap}' +
        '#gesture-overlay .ge-action-flash.show{opacity:1}' +
        '#gesture-overlay .ge-conf-bar{height:3px;border-radius:2px;background:rgba(255,255,255,.08);' +
          'margin-top:6px;overflow:hidden}' +
        '#gesture-overlay .ge-conf-fill{height:100%;background:var(--accent,#58A6FF);border-radius:2px;' +
          'transition:width .15s;width:0}';
      document.head.appendChild(style);
    }
  }

  function updateOverlayGesture(gesture, label) {
    var icon = document.getElementById('ge-gesture-icon');
    var name = document.getElementById('ge-gesture-name');
    var dot = document.getElementById('ge-cam-dot');
    if (icon) icon.textContent = (GESTURES[gesture] || {}).icon || '?';
    if (name) name.textContent = label || gesture || 'Tracking...';
    if (dot) dot.className = 'ge-cam-dot on';
  }

  function updateOverlayFPS(fps) {
    var el = document.getElementById('ge-fps');
    if (el) el.textContent = fps + ' FPS';
  }

  function updateOverlayStatus(text) {
    var el = document.getElementById('ge-status-label');
    if (el) el.textContent = text;
  }

  function destroyOverlay() {
    if (_overlayEl) { _overlayEl.remove(); _overlayEl = null; }
  }

  /* ── Camera preview (small thumbnail) ────────────────────────────────────── */
  function createPreview(videoEl) {
    if (_previewEl) return;
    var wrap = document.createElement('div');
    wrap.id = 'ge-preview';
    wrap.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:100000;border-radius:10px;' +
      'overflow:hidden;border:1px solid rgba(88,166,255,.25);box-shadow:0 4px 16px rgba(0,0,0,.5);' +
      'background:#000;cursor:pointer';
    videoEl.style.cssText = 'display:block;width:120px;height:90px;object-fit:cover;transform:scaleX(-1)';
    wrap.appendChild(videoEl);
    document.body.appendChild(wrap);
    _previewEl = wrap;
    wrap.addEventListener('click', function () {
      _settings.showPreview = !_settings.showPreview;
      videoEl.style.display = _settings.showPreview ? 'block' : 'none';
      wrap.style.display = _settings.showPreview ? 'block' : 'none';
      saveSettings();
    });
  }

  function destroyPreview() {
    if (_previewEl) { _previewEl.remove(); _previewEl = null; }
  }

  /* ── Keyboard/typing detection ───────────────────────────────────────────── */
  var _typingGuardRegistered = false;
  function setupTypingGuard() {
    if (_typingGuardRegistered) return;
    _typingGuardRegistered = true;
    document.addEventListener('keydown', function () {
      _typingActive = true;
      clearTimeout(setupTypingGuard._t);
      setupTypingGuard._t = setTimeout(function () { _typingActive = false; }, 2000);
    }, true);
  }

  /* ── Market hours check ──────────────────────────────────────────────────── */
  function isMarketOpenNow() {
    // Rough check: Mon-Fri, 9:15 AM - 3:30 PM IST
    var now = new Date();
    var day = now.getDay();
    if (day === 0 || day === 6) return false;
    var h = now.getHours(), m = now.getMinutes();
    var mins = h * 60 + m;
    // 9:15 = 555, 15:30 = 930 (IST approximation)
    // This is approximate — actual market calendar is server-side
    return mins >= 555 && mins <= 930;
  }

  /* ── Core: on hand results from MediaPipe ────────────────────────────────── */
  function onResults(results) {
    _frameCount++;
    var now = Date.now();
    if (now - _fpsTimer >= 1000) {
      _fps = _frameCount;
      _frameCount = 0;
      _fpsTimer = now;
      updateOverlayFPS(_fps);
    }

    if (_paused) return;
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      _wristHistory = [];
      _holdStart = 0;
      _holdGesture = null;
      updateOverlayGesture(null, 'No hand detected');
      return;
    }

    var lm = results.multiHandLandmarks[0];
    var handedness = (results.multiHandedness && results.multiHandedness[0])
      ? results.multiHandedness[0].label : _settings.dominantHand;

    // Check page context
    var page = getCurrentPage();
    var allowNav = _settings.navGestures;
    var allowTracker = _settings.trackerGestures && page === 'tracker';
    var allowChart = _settings.chartGestures;
    var allowDash = _settings.dashboardGestures;
    var allowQuick = _settings.quickActionsGestures;

    // Typing guard
    if (_settings.autoPauseTyping && _typingActive) return;

    // Market closed guard
    if (_settings.autoPauseMarketClosed && !isMarketOpenNow()) {
      _marketClosed = true;
      // Still allow basic gestures like bookmarks and refresh
    } else {
      _marketClosed = false;
    }

    // Try swipe first (motion-based)
    var swipe = detectSwipe(lm);
    if (swipe && allowNav) {
      fireAction(swipe);
      return;
    }

    // Static gesture classification
    var result = classifyStatic(lm, handedness);

    // Hold detection (OPEN_PALM held for duration)
    var holdGesture = detectHold(result, now);
    if (holdGesture && allowQuick) {
      fireAction(holdGesture);
      return;
    }

    if (result && result.confidence >= _confidence) {
      var gesture = result.gesture;

      // Context filtering
      if (gesture === 'POINT_LEFT' || gesture === 'POINT_RIGHT') {
        if (!allowTracker && !allowDash) return;
      }
      if (gesture === 'TWO_FINGERS') {
        if (!allowChart) return;
      }

      // Debounce: same gesture within cooldown
      if (gesture === _lastGesture && (now - _lastGestureTime) < _cooldown) return;

      _lastGesture = gesture;
      _lastGestureTime = now;

      // Only fire non-motion gestures here (swipe already handled above)
      if (gesture !== 'OPEN_PALM') {
        fireAction(gesture);
      } else {
        // OPEN_PALM fires on hold (LONG_PALM), not on appearance
        updateOverlayGesture(gesture, 'Hold for Quick Menu...');
      }
    }
  }

  /* ── Init & start ────────────────────────────────────────────────────────── */
  GE.init = async function () {
    loadSettings();
    setupTypingGuard();
  };

  GE.start = async function () {
    if (_running) return;
    loadSettings();

    // Check MediaPipe availability
    if (typeof Hands === 'undefined') {
      toast('MediaPipe not loaded. Check your internet connection.', 4000);
      updateOverlayStatus('MediaPipe missing');
      return;
    }
    if (typeof Camera === 'undefined') {
      toast('MediaPipe Camera utils not loaded. Check your internet connection.', 4000);
      updateOverlayStatus('Camera utils missing');
      return;
    }

    // HTTPS check
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      toast('Camera requires HTTPS or localhost', 4000);
      updateOverlayStatus('HTTPS required');
      return;
    }

    createOverlay();
    updateOverlayStatus('Starting camera...');

    try {
      // Get camera stream
      _stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: _settings.cameraFacing,
          width: { ideal: 320 },
          height: { ideal: 240 }
        },
        audio: false
      });

      // Create hidden video element
      var videoEl = document.createElement('video');
      videoEl.setAttribute('playsinline', '');
      videoEl.muted = true;
      videoEl.srcObject = _stream;
      await videoEl.play();

      // Show preview if enabled
      if (_settings.showPreview) {
        createPreview(videoEl);
      }

      // Camera disconnect: stop engine when track ends (USB unplug, permission revoked, etc.)
      _stream.getTracks().forEach(function (t) {
        t.addEventListener('ended', function () {
          if (_running) {
            console.warn('[GestureEngine] camera track ended — stopping');
            GE.stop();
            toast('Camera disconnected', 3000);
          }
        });
      });

      // Page unload: release camera + MediaPipe
      if (!GE._unloadRegistered) {
        GE._unloadRegistered = true;
        var _unloadStop = function () { if (_running) { try { GE.stop(); } catch (e) {} } };
        window.addEventListener('beforeunload', _unloadStop);
        window.addEventListener('pagehide', _unloadStop);
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'hidden' && _running) { try { GE.stop(); } catch (e) {} }
        });
      }

      // Init MediaPipe Hands
      _hands = new Hands({
        locateFile: function (file) {
          return 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/' + file;
        }
      });

      _hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 0,  // 0 = lite model (fastest)
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.5
      });

      _hands.onResults(onResults);

      // Start camera loop
      _camera = new Camera(videoEl, {
        onFrame: async function () {
          if (_hands && _running) {
            await _hands.send({ image: videoEl });
          }
        },
        width: 320,
        height: 240
      });

      await _camera.start();
      _running = true;
      _paused = false;

      updateOverlayStatus('Tracking');
      var dot = document.getElementById('ge-cam-dot');
      if (dot) dot.className = 'ge-cam-dot on';
      toast('Gesture control ON', 2000);

    } catch (err) {
      console.error('[GestureEngine] start failed:', err);
      updateOverlayStatus('Error: ' + (err.message || err.name));
      var dot = document.getElementById('ge-cam-dot');
      if (dot) dot.className = 'ge-cam-dot err';
      toast('Camera error: ' + (err.message || 'Permission denied'), 4000);
    }
  };

  GE.stop = function () {
    if (_camera) { try { _camera.stop(); } catch (e) {} _camera = null; }
    if (_stream) {
      _stream.getTracks().forEach(function (t) { t.stop(); });
      _stream = null;
    }
    _hands = null;
    _running = false;
    _paused = false;
    destroyOverlay();
    destroyPreview();
    toast('Gesture control OFF', 1500);
  };

  GE.pause = function () { _paused = true; updateOverlayStatus('Paused'); };
  GE.resume = function () { _paused = false; updateOverlayStatus('Tracking'); };
  GE.isRunning = function () { return _running; };
  GE.isPaused = function () { return _paused; };

  /* ── Calibration (minimal, practical) ────────────────────────────────────── */
  GE.calibrate = async function () {
    if (!_running) { toast('Start gesture control first', 2000); return; }
    toast('Hold your hand at comfortable distance for 3 seconds...', 3000);
    updateOverlayStatus('Calibrating...');
    // Simple calibration: just measure wrist Y stability over 3 seconds
    var samples = [];
    var origHandler = _hands.onResults;
    _hands.onResults = function (results) {
      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        samples.push(results.multiHandLandmarks[0][WRIST].y);
      }
    };
    await new Promise(function (r) { setTimeout(r, 3000); });
    _hands.onResults = origHandler;
    if (samples.length > 10) {
      var avg = samples.reduce(function (a, b) { return a + b; }, 0) / samples.length;
      var stddev = Math.sqrt(samples.reduce(function (s, v) { return s + (v - avg) * (v - avg); }, 0) / samples.length);
      _settings.sensitivity = stddev < 0.02 ? 0.8 : stddev < 0.05 ? 0.7 : 0.6;
      _confidence = _settings.sensitivity;
      saveSettings();
      toast('Calibrated. Sensitivity: ' + (_settings.sensitivity * 100).toFixed(0) + '%', 2500);
    } else {
      toast('Calibration failed - not enough data. Try again.', 3000);
    }
    updateOverlayStatus('Tracking');
  };

  GE.resetCalibration = function () {
    _settings.sensitivity = DEFAULTS.sensitivity;
    _confidence = DEFAULTS.confidence;
    saveSettings();
    toast('Calibration reset to defaults', 2000);
  };

  /* ── Keyboard shortcuts for gesture control ──────────────────────────────── */
  (function setupKeyboardShortcuts() {
    if (typeof document === 'undefined') return;
    document.addEventListener('keydown', function (e) {
      // Ctrl+Shift+G: Toggle gesture engine on/off
      if (e.ctrlKey && e.shiftKey && e.key === 'G') {
        e.preventDefault();
        if (_running) GE.stop(); else GE.start();
        return;
      }
      // Ctrl+G: Pause/Resume gesture (if running)
      if (e.ctrlKey && !e.shiftKey && e.key === 'g') {
        e.preventDefault();
        if (!_running) return;
        if (_paused) GE.resume(); else GE.pause();
        return;
      }
      // Arrow keys: navigate days/strikes when gesture is primary input
      if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        var tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        if (e.key === 'ArrowLeft') {
          if (typeof window._geNavigateDay === 'function') { e.preventDefault(); window._geNavigateDay(-1); }
          else if (typeof window._geNavigateStrike === 'function') { e.preventDefault(); window._geNavigateStrike(-1); }
        }
        if (e.key === 'ArrowRight') {
          if (typeof window._geNavigateDay === 'function') { e.preventDefault(); window._geNavigateDay(1); }
          else if (typeof window._geNavigateStrike === 'function') { e.preventDefault(); window._geNavigateStrike(1); }
        }
        // R: refresh
        if (e.key === 'r' || e.key === 'R') {
          if (typeof window.loop === 'function') { e.preventDefault(); window.loop(); }
        }
      }
    });
  })();

  /* ── Inject CSS for gesture-locked state ─────────────────────────────────── */
  (function injectCSS() {
    var s = document.createElement('style');
    s.textContent =
      'body.gesture-locked .page:not(.on){pointer-events:none}' +
      'body.gesture-locked .sb-nav{pointer-events:none}';
    document.head.appendChild(s);
  })();

})();
