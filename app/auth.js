/* ── Auth (Phase 7 — real Keycloak identity, Authorization Code + PKCE) ──
   Externalised 2026-08-14, then rewritten 2026-08-14 for Phase 7: replaces the old
   email/password fetch()-based login/signup (auth_jwt.py, retired — see
   MCWM_APEX_Production_Phase_Roadmap.md) with a real OIDC redirect flow against
   Keycloak. This app never sees a password — Keycloak's own hosted login/registration
   page does; FastAPI only ever verifies the resulting token
   (identity/keycloak_verify.py).

   Function names below (openLogin/closeLogin/showSignup/showLogin/doLogin/doSignup/
   doLogout) are unchanged from the original file on purpose: straddleedge.html's
   inline __APEXQ shim pre-binds queueing stubs to these exact names so an early click
   before this bundle loads is honoured, not lost (see that shim's own comment), and
   this bundle still loads AFTER scheduler.js as a lazy bundle, same as before.

   Tokens live in sessionStorage, not localStorage: per-tab, cleared when the tab
   closes — a smaller XSS persistence window than the old flow, and it naturally
   matches "each tab gets its own access token, refreshed independently" rather than
   one shared value every tab fights over. A hidden iframe silent-SSO check
   (dashboard/silent-check-sso.html) covers reload / new tab / browser restart while
   Keycloak's own SSO cookie is still valid, without ever showing a login prompt or
   looping — the exact failure mode main.py:841-847 documents from the PREVIOUS access
   gate (cached PWA shell + broken redirect = "looks fine, every call 401s") is why
   this stays a redirect-based flow with graceful fallback, never a blocking gate. */

var AUTH_STORE_KEYS = {
  access: 'apex_access_token', id: 'apex_id_token', refresh: 'apex_refresh_token',
  expiresAt: 'apex_token_expires_at', user: 'apex_user',
  verifier: 'apex_pkce_verifier', state: 'apex_pkce_state', redirectUri: 'apex_pkce_redirect_uri',
};
var _authConfigPromise = null;

function _authConfig() {
  if (!_authConfigPromise) _authConfigPromise = fetch('/api/auth/config').then(function (r) { return r.json(); });
  return _authConfigPromise;
}

function _b64urlFromBytes(bytes) {
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _randomToken() {
  var bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return _b64urlFromBytes(bytes);
}
async function _pkceChallenge(verifier) {
  var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return _b64urlFromBytes(new Uint8Array(digest));
}
function _redirectUri() { return location.origin + location.pathname; }

async function _buildAuthUrl(opts) {
  opts = opts || {};
  var cfg = await _authConfig();
  var verifier = _randomToken(), state = _randomToken();
  var redirectUri = opts.silent ? (location.origin + '/silent-check-sso.html') : _redirectUri();
  sessionStorage.setItem(AUTH_STORE_KEYS.verifier, verifier);
  sessionStorage.setItem(AUTH_STORE_KEYS.state, state);
  sessionStorage.setItem(AUTH_STORE_KEYS.redirectUri, redirectUri);
  var challenge = await _pkceChallenge(verifier);
  var endpoint = opts.register ? cfg.authorization_endpoint.replace('/auth', '/registrations') : cfg.authorization_endpoint;
  var params = new URLSearchParams({
    client_id: cfg.client_id, response_type: 'code', scope: cfg.scope,
    redirect_uri: redirectUri, state: state,
    code_challenge: challenge, code_challenge_method: 'S256',
  });
  if (opts.silent) params.set('prompt', 'none');
  return endpoint + '?' + params.toString();
}

async function beginAuthRedirect(opts) {
  var cfg = await _authConfig();
  if (cfg.idp_available === false) {
    if (typeof updateAuthUI === 'function') updateAuthUI();
    return;
  }
  location.href = await _buildAuthUrl(opts);
}
async function doLogin() { closeLogin(); await beginAuthRedirect({}); }
async function doSignup() { closeLogin(); await beginAuthRedirect({ register: true }); }

async function _exchangeCode(code, verifier, redirectUri) {
  var cfg = await _authConfig();
  var body = new URLSearchParams({
    grant_type: 'authorization_code', client_id: cfg.client_id,
    code: code, redirect_uri: redirectUri, code_verifier: verifier,
  });
  try {
    var r = await fetch(cfg.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    return r.ok ? r.json() : null;
  } catch (e) { return null; }
}

function _storeTokens(tokens) {
  sessionStorage.setItem(AUTH_STORE_KEYS.access, tokens.access_token);
  if (tokens.id_token) sessionStorage.setItem(AUTH_STORE_KEYS.id, tokens.id_token);
  if (tokens.refresh_token) sessionStorage.setItem(AUTH_STORE_KEYS.refresh, tokens.refresh_token);
  sessionStorage.setItem(AUTH_STORE_KEYS.expiresAt, String(Date.now() + (tokens.expires_in || 300) * 1000));
}
function _clearTokens() {
  Object.keys(AUTH_STORE_KEYS).forEach(function (k) { sessionStorage.removeItem(AUTH_STORE_KEYS[k]); });
}

async function _completeCodeExchange(code, expectedState, actualState) {
  var verifier = sessionStorage.getItem(AUTH_STORE_KEYS.verifier);
  var redirectUri = sessionStorage.getItem(AUTH_STORE_KEYS.redirectUri);
  sessionStorage.removeItem(AUTH_STORE_KEYS.verifier);
  sessionStorage.removeItem(AUTH_STORE_KEYS.state);
  sessionStorage.removeItem(AUTH_STORE_KEYS.redirectUri);
  if (!expectedState || expectedState !== actualState) return false;   // CSRF/state-mismatch guard
  var tokens = await _exchangeCode(code, verifier, redirectUri);
  if (!tokens) return false;
  _storeTokens(tokens);
  await _fetchMe();
  return true;
}

// Refresh-token rotation (KC realm: revokeRefreshToken=true) — proactive, 30s before
// the access token's own expiry, so a page that's been open a while doesn't discover
// it's unauthenticated only when an API call already 401'd.
async function _refreshToken() {
  var refresh = sessionStorage.getItem(AUTH_STORE_KEYS.refresh);
  if (!refresh) return false;
  var cfg = await _authConfig();
  var body = new URLSearchParams({ grant_type: 'refresh_token', client_id: cfg.client_id, refresh_token: refresh });
  try {
    var r = await fetch(cfg.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    if (!r.ok) return false;
    _storeTokens(await r.json());
    return true;
  } catch (e) { return false; }
}

async function getValidAccessToken() {
  var token = sessionStorage.getItem(AUTH_STORE_KEYS.access);
  if (!token) return null;
  var expiresAt = Number(sessionStorage.getItem(AUTH_STORE_KEYS.expiresAt) || 0);
  if (Date.now() > expiresAt - 30000) {
    if (!(await _refreshToken())) { _clearTokens(); return null; }
    token = sessionStorage.getItem(AUTH_STORE_KEYS.access);
  }
  return token;
}

async function _fetchMe() {
  var token = await getValidAccessToken();
  if (!token) return null;
  try {
    var r = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) { _clearTokens(); return null; }
    var user = await r.json();
    sessionStorage.setItem(AUTH_STORE_KEYS.user, JSON.stringify(user));
    return user;
  } catch (e) { return null; }
}

// Silent SSO check: a hidden prompt=none redirect. If Keycloak's own SSO cookie is
// still valid (same browser, different tab, or this tab reloaded/reopened) it
// answers instantly with a fresh code and the login UI never has to appear at all;
// if there is no SSO session it answers with an error just as fast. Either way this
// never blocks page load beyond a short timeout (network interruption / Keycloak
// down -> resolves to "not logged in", never a stuck spinner).
function _silentCheckSso() {
  return new Promise(function (resolve) {
    var settled = false, iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    function finish(result) {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMsg);
      clearTimeout(timer);
      try { document.body.removeChild(iframe); } catch (e) {}
      resolve(result);
    }
    function onMsg(ev) {
      if (ev.origin !== location.origin || !ev.data) return;
      try {
        var url = new URL(ev.data);
        var code = url.searchParams.get('code'), state = url.searchParams.get('state');
        finish(code ? { code: code, state: state } : null);
      } catch (e) { finish(null); }
    }
    var timer = setTimeout(function () { finish(null); }, 4000);
    window.addEventListener('message', onMsg);
    _buildAuthUrl({ silent: true }).then(function (url) {
      iframe.src = url;
      document.body.appendChild(iframe);
    }).catch(function () { finish(null); });
  });
}

async function initAuth() {
  var params = new URLSearchParams(location.search);
  var code = params.get('code'), state = params.get('state');
  if (code && state) {
    await _completeCodeExchange(code, sessionStorage.getItem(AUTH_STORE_KEYS.state), state);
    history.replaceState({}, '', location.pathname + location.hash);
  } else if (sessionStorage.getItem(AUTH_STORE_KEYS.access)) {
    await _fetchMe();
  } else {
    var cfg = await _authConfig();
    if (cfg.idp_available !== false) {
      var silent = await _silentCheckSso();
      if (silent) await _completeCodeExchange(silent.code, sessionStorage.getItem(AUTH_STORE_KEYS.state), silent.state);
    }
  }
  updateAuthUI();
}

function openLogin(){
  /* Pilot guard: the deferred-handler shim at the top of straddleedge.html replays
     clicks made before scripts finished loading, so a tap on a sign-in control can
     reach here AFTER updateAuthUI has hidden it. Re-check the server flag rather than
     trusting DOM state. Fails OPEN to the modal if the config call fails - a broken
     config request must not lock a real (non-pilot) user out of signing in. */
  _authConfig().then(function(cfg){
    if (cfg && cfg.pilot_open_access) return;
    document.getElementById('loginModalBg').style.display='flex';
  }).catch(function(){
    document.getElementById('loginModalBg').style.display='flex';
  });
}
function closeLogin(){ document.getElementById('loginModalBg').style.display='none'; }
function showSignup(){
  var m=document.getElementById('loginModalBg'), h=m.querySelector('.modal-hd .t');
  h.textContent='Create Account';
  m.querySelector('.modal-bd button').textContent='Continue to Sign Up';
  m.querySelector('.modal-bd button').onclick=doSignup;
  m.querySelector('.modal-bd div:last-child').innerHTML='<span style="font-size:10.5px;color:var(--muted)">Already registered? <a href="#" onclick="event.preventDefault();showLogin()" style="color:var(--cyan)">Sign in</a></span>';
}
function showLogin(){
  var m=document.getElementById('loginModalBg'), h=m.querySelector('.modal-hd .t');
  h.textContent='Sign In';
  m.querySelector('.modal-bd button').textContent='Continue to Sign In';
  m.querySelector('.modal-bd button').onclick=doLogin;
  m.querySelector('.modal-bd div:last-child').innerHTML='<span style="font-size:10.5px;color:var(--muted)">Don&apos;t have an account? <a href="#" onclick="event.preventDefault();showSignup()" style="color:var(--cyan)">Sign up</a></span>';
}

async function doLogout(){
  var token = sessionStorage.getItem(AUTH_STORE_KEYS.access);
  var idToken = sessionStorage.getItem(AUTH_STORE_KEYS.id);
  var endSessionEndpoint = null;
  try {
    if (token) {
      var r = await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
      if (r.ok) endSessionEndpoint = (await r.json()).end_session_endpoint;
    }
  } catch (e) {}
  _clearTokens();
  updateAuthUI();
  setTimeout(function(){ if(window.renderSettings) renderSettings(); }, 100);
  // RP-initiated logout: kills the Keycloak SSO cookie too, not just the local
  // token — without this a silent-SSO check on the next page load would just log
  // the user straight back in, and "sign out" would never actually stick.
  if (endSessionEndpoint) {
    var params = new URLSearchParams({ post_logout_redirect_uri: _redirectUri() });
    if (idToken) params.set('id_token_hint', idToken);
    location.href = endSessionEndpoint + '?' + params.toString();
  }
}

if(navigator.serviceWorker){navigator.serviceWorker.getRegistrations().then(function(regs){regs.forEach(function(r){r.unregister()})})};

function _displayRoles(roles){
  var internal={'default-roles-apex-straddle':1,'offline_access':1,'uma_authorization':1};
  return (roles||[]).filter(function(r){return !internal[r];});
}
function updateAuthUI(){
  /* PILOT PHASE (2026-08-18): the server may declare open access, in which case every
     feature is already entitled without a login and a sign-in control achieves
     nothing - worse, it invites a pilot tester into a Keycloak redirect that grants
     no capability they do not already have, and which currently points at an
     unreachable IdP. Hide every auth affordance when the flag is set.

     The flag is READ FROM THE SERVER (/api/auth/config), never hardcoded here, so the
     UI cannot drift out of sync with what the API actually enforces - the server
     stays the single owner of access policy (identity/entitlements.py). _authConfig()
     is memoised, so this costs no extra request. Fails CLOSED: if the config call
     fails we fall through to the normal signed-out UI rather than assuming a pilot. */
  _authConfig().then(function(cfg){
    if (cfg && cfg.pilot_open_access) {
      ['userChip','s-login-item','s-account-item'].forEach(function(id){
        var el=document.getElementById(id); if(el) el.style.display='none';
      });
      var modal=document.getElementById('loginModalBg'); if(modal) modal.style.display='none';
    }
    /* Private pages (owner's own research/findings) - the server names them, this
       removes every route INTO them: desktop sidebar entry, the page node itself, and
       the mobile menu list (window.__apexPages, which mobile.js mutates in place and
       repaints from). Removing the page node too means a hand-typed #page-research
       hash cannot reveal it either. The API is already unmounted server-side, so this
       is the cosmetic half of a real block, never the block itself. */
    var hp = (cfg && cfg.hidden_pages) || [];
    /* Published BEFORE any DOM work so mobile.js can read it whenever it loads.
       mobile.js is lazy (requestIdleCallback) while this runs in the critical defer
       bundle, so __apexPages is normally undefined here - splicing it did nothing and
       mobile.js then published the FULL list, leaking hidden entries into the More
       sheet. mobile.js now filters against this instead. */
    window.__apexHiddenPages = hp;
    if (hp.length) {
      hp.forEach(function (pg_) {
        var items = document.querySelectorAll('.sb-item[data-page="' + pg_ + '"]');
        for (var i = 0; i < items.length; i++) items[i].style.display = 'none';
        /* HIDDEN, not removed: removing made nav() throw TypeError at core.js:165
           for any path that still reached it (the leaked mobile entry did), aborting
           navigation with every .page.on cleared - a blank app. Data is unreachable
           regardless: router unmounted + middleware 404s the API. */
        var pg = document.getElementById('page-' + pg_);
        if (pg) { pg.style.display = 'none'; pg.classList.remove('on'); }
      });
      var P = window.__apexPages;
      if (P && P.length) {
        for (var j = P.length - 1; j >= 0; j--) if (hp.indexOf(P[j][0]) !== -1) P.splice(j, 1);
      }
    }
  }).catch(function(){});

  var u=sessionStorage.getItem(AUTH_STORE_KEYS.user);
  var user=u?JSON.parse(u):null;
  var userChip=document.getElementById('userChip');
  var loginItem=document.getElementById('s-login-item');
  var accItem=document.getElementById('s-account-item');
  if(user){
    if(userChip){ userChip.style.display='flex'; userChip.querySelector('#userEmail').textContent=user.email||user.keycloak_sub; }
    var init=document.getElementById('userInitials'); if(init) init.textContent=((user.email||'?')[0]||'?').toUpperCase();
    if(accItem) accItem.style.display='flex';
    if(loginItem) loginItem.style.display='none';
    var an=document.getElementById('s-account-name'); if(an) an.textContent=user.email||user.keycloak_sub;
    var ae=document.getElementById('s-account-email'); if(ae) ae.textContent='Signed in · '+(_displayRoles(user.roles).join(', ')||'user');
  } else {
    if(userChip) userChip.style.display='none';
    if(accItem) accItem.style.display='none';
    if(loginItem) loginItem.style.display='flex';
  }
}
function updateMCWMProductCard(){
  try{
    fetch('/api/calendar/events?limit=1&from_date='+new Date().toISOString().slice(0,10)).then(function(r){return r.json()}).then(function(events){
      var el=document.getElementById('mcwmNextEvent');
      if(!el||!events.length) return;
      var e=events[0];
      var dt=e.event_date||'';
      var d=new Date(dt+'T'+(e.event_time||'00:00:00')+'+05:30');
      var diff=d-Date.now();
      var countdown='';
      if(diff<=0) countdown=' · NOW';
      else{var days=Math.floor(diff/864e5);var hrs=Math.floor((diff%864e5)/36e5);countdown=' in '+(days>0?days+'d ':'')+hrs+'h';}
      el.innerHTML='<b style="color:var(--gold)">'+e.title+'</b> — '+e.event_date+' '+e.event_time+' · '+countdown;
    });
  }catch(e){}
}
function updateEventPill(){
  try{
    fetch('/api/calendar/events?from_date='+new Date().toISOString().slice(0,10)+'&to_date='+new Date().toISOString().slice(0,10)+'&limit=10').then(function(r){return r.json()}).then(function(events){
      var p=document.getElementById('eventPill');
      if(!p) return;
      var hi=events.filter(function(e){return e.impact==='HIGH'});
      if(!hi.length){p.style.display='none';return;}
      p.style.display='inline-block';
      var labels={'MONETARY_POLICY':'RBI TODAY','EXPIRY':'EXPIRY TODAY','MARKET_HOLIDAY':'HOLIDAY','ECONOMIC_DATA':'DATA TODAY'};
      var label=labels[hi[0].category]||(hi[0].title.slice(0,22).toUpperCase());
      p.style.background='rgba(229,72,77,.15)';p.style.color='var(--red)';p.style.border='1px solid rgba(229,72,77,.3)';
      p.textContent=label;
      p.title=hi[0].title+' · '+hi[0].institution;
    });
  }catch(e){}
}
setTimeout(updateMCWMProductCard,1200);
setTimeout(updateEventPill,1500);
var _mcwmInterval=setInterval(updateMCWMProductCard,60000);
var _eventPillInterval=setInterval(updateEventPill,60000);
initAuth();
