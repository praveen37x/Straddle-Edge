/* APEX StraddleEDGE - service worker.

   Goal: the FULL dashboard (/edge) installs and behaves like a native app, with every page,
   feature and visual unchanged. Caching strategy per request type:

     documents (/edge, /m)   -> stale-while-revalidate
                                (the cached shell paints INSTANTLY, then the newest
                                 build is fetched underneath for the next launch;
                                 offline you still get the last-loaded dashboard
                                 instead of a browser error page)
     /api/*                  -> network-first, cache fallback (last-known data offline)
     own static (/pwa, etc.) -> cache-first
     CDN (fonts, Chart.js)   -> cache-first, so fonts + charts still render offline

   Bump CACHE to force a clean refresh of the cached shell. */
/* v87 — JS extracted from the HTML into content-hashed, immutable bundles under /app/.
   Two consequences the worker has to handle:
     1. PRECACHE can no longer be just '/edge' — the shell without its 460 KB of JS is a
        blank page offline. The bundle URLs carry a content hash, so they are read from
        /app/manifest.json at install time rather than hardcoded here (a hardcoded list
        would go stale on the next code change and silently precache the wrong build).
     2. Hashed URLs are immutable, so old builds accumulate. `activate` now prunes any
        cached /app/ entry that is not in the current manifest, which keeps the cache
        bounded at exactly one build.
   v86 — estimator analytics sheet + secondary index strip (BANKNIFTY/FINNIFTY/
   MIDCPNIFTY/SENSEX/BANKEX). Bumped because straddleedge.html changed materially;
   without a bump a cached shell would render the old estimator table.
   v85 — non-blocking font load + mobile-web-app-capable meta.
   v84 — HTML-first shell (2026-08-02): the app body is now server-rendered
   directly into #APP_ROOT instead of being injected from a JS template literal,
   so the cached shell changed shape and must be re-fetched.
   v83 — frontend performance pass (2026-08-02).
   The shell changed: Chart.js is now deferred and the MediaPipe gesture stack (~1 MB) is
   loaded on first use instead of on every page load. PRECACHE deliberately does NOT list
   the gesture scripts — precaching them would re-introduce the exact ~1 MB cost on the
   PWA that the lazy loader removes on the web. cdn.jsdelivr.net stays in CDN below, so
   they are still cached AFTER a user actually enables gestures. */
const CACHE = 'apex-pwa-v93';
const PRECACHE = ['/edge', '/manifest.json', '/pwa/icon-192.png', '/pwa/icon-512.png',
                  '/pwa/icon-maskable-512.png', '/pwa/apple-touch-180.png', '/pwa/mark.png'];

/* The hashed bundle URLs for the CURRENT build, e.g. /app/core.js?v=7025fb33f3.
   Derived from the manifest the extractor writes, so this worker cannot precache a
   build that no longer exists. Returns [] on any failure — a missing manifest must
   degrade to "no bundle precache", never to a failed install. */
function bundleUrls() {
  return fetch('/app/manifest.json', {cache: 'no-store'})
    .then((r) => (r.ok ? r.json() : {}))
    .then((m) => Object.keys(m).map((n) => '/app/' + n + '.js?v=' + m[n]))
    .catch(() => []);
}
const CDN = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];

/* Whether the page explicitly asked this worker to take over (SKIP_WAITING).
   Guards the activate takeover below: on a FIRST install no controller exists and
   no page ever requested takeover, so claim()/FORCE_RELOAD must be skipped —
   otherwise the very first load would force a self-reload once (the browser
   activates the new worker, claim() takes control, the page reloads). That
   reload restarts performance clocks under an automated harness (LCP/TTI were
   reading ~4s on a page that paints in ~0.2s) and costs a real user a pointless
   flash on their first visit. Update flows always send SKIP_WAITING first, so
   instant takeover is preserved. */
let takeoverRequested = false;

/* Auto-update: the new SW installs and parks in "waiting". The page detects
   reg.waiting and shows an UPDATE/Later toast. Only when the user taps
   UPDATE does the page send SKIP_WAITING, activating the new SW. */
self.addEventListener('install', (e) => {
  e.waitUntil(
    Promise.all([caches.open(CACHE), bundleUrls()])
      .then(([c, urls]) =>
        // addAll is atomic-or-nothing; the bundles are added separately so one
        // unreachable asset cannot abort the whole precache and leave the app with
        // no offline shell at all.
        c.addAll(PRECACHE).catch(() => {})
          .then(() => Promise.all(urls.map((u) => c.add(u).catch(() => {})))))
      .catch(() => {})
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      // Prune superseded builds. Hashed URLs never change content, so without this the
      // cache would keep every bundle of every build ever installed.
      .then(() => Promise.all([caches.open(CACHE), bundleUrls()]))
      .then(([c, urls]) => c.keys().then((reqs) => Promise.all(reqs.map((rq) => {
        const u = new URL(rq.url);
        if (u.origin !== self.location.origin || !u.pathname.startsWith('/app/')) return null;
        return urls.indexOf(u.pathname + u.search) === -1 ? c.delete(rq) : null;
      }))))
      .catch(() => {})
      .then(() => {
        if (!takeoverRequested) return null;
        return self.clients.matchAll()
          .then((list) => { for (const c of list) c.postMessage({type: 'FORCE_RELOAD'}); })
          .then(() => self.clients.claim());
      })
  );
});

function put(req, res) {
  // Only ever cache a real success. Caching a 401 or a 503 makes the failure outlive
  // the cause: the server recovers, or the user signs in, and the worker keeps
  // serving the old refusal from disk with nothing to indicate why.
  if (!res || !res.ok) return res;
  const copy = res.clone();
  caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  return res;
}

function networkFirst(req) {
  return fetch(req).then((r) => put(req, r)).catch(() => caches.match(req));
}

/* Stale-while-revalidate: hand back the cached copy IMMEDIATELY, then refresh the
   cache in the background for next time. For the ~260 KB dashboard shell this is
   the difference between a visible load and an instant one. Safe here precisely
   because the shell is markup: all live numbers arrive separately from /api/*,
   which stays network-first. Worst case the user sees the previous build's
   layout for one launch. */
function staleWhileRevalidate(req) {
  return caches.match(req).then((hit) => {
    const net = fetch(req).then((r) => put(req, r)).catch(() => hit);
    return hit || net;
  });
}

function cacheFirst(req) {
  return caches.match(req).then((hit) => hit || fetch(req).then((r) => put(req, r)));
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // CDN assets (fonts + Chart.js): cache-first so the dashboard looks right offline too.
  if (CDN.indexOf(url.hostname) !== -1) {
    e.respondWith(cacheFirst(e.request));
    return;
  }
  if (url.origin !== self.location.origin) return;      // anything else cross-origin: untouched

  // the self-test must ALWAYS be live - a cached copy would report stale results
  if (url.pathname === '/pwa-check') return;

  // live data: always the newest when reachable, last-known when not
  if (url.pathname.startsWith('/api/')) { e.respondWith(networkFirst(e.request)); return; }

  /* the dashboard shell: NETWORK-FIRST, cache only as the offline fallback.
     stale-while-revalidate returned the CACHED shell whenever the PC was reachable and
     only refreshed the cache for the NEXT launch. Combined with the fact that a hard
     refresh does NOT bypass a service worker, that made the app effectively
     un-updatable: fixed files sat on disk while the browser kept serving an old build,
     so every backend fix looked like it had failed. Offline still works — the cache is
     the fallback — but when the server is up you always get the current build. */
  if (e.request.mode === 'navigate' || url.pathname === '/edge' || url.pathname === '/m') {
    e.respondWith(networkFirst(e.request));
    return;
  }
  e.respondWith(cacheFirst(e.request));
});

/* Tapping an alert notification must land on the Alerts page of an ALREADY OPEN
   app if there is one, rather than spawning a second copy. Without this handler
   the notification is inert — nothing happens on tap, which reads as a bug. */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/edge?go=logs';
  e.waitUntil(
    clients.matchAll({type: 'window', includeUncontrolled: true}).then((list) => {
      for (const c of list) {
        if (c.url.indexOf('/edge') !== -1 && 'focus' in c) {
          c.postMessage({type: 'nav', page: 'logs'});
          return c.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});

/* Lets the page ask a freshly installed worker to take over at once, so
   "Update app" in Settings does not require two reloads. */
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    takeoverRequested = true;
    self.skipWaiting();
  }
});
