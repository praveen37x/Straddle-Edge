
/* APEX PWA install helper.
   Chrome fires `beforeinstallprompt` only when EVERY install criterion is met
   (HTTPS + manifest + 192/512 icons + display:standalone + a service worker with a
   fetch handler). We capture that event instead of letting the browser bury the
   option in a menu, and surface an explicit button. On iOS - which never fires the
   event - we show the manual Add-to-Home-Screen instructions instead. */
(function () {
  var deferred = null;

  function standalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function hint(html) {
    var h = document.getElementById('pwaHint');
    if (!h) return;
    h.innerHTML = html + '<br><button onclick="document.getElementById(\'pwaHint\').classList.remove(\'show\')">Got it</button>';
    h.classList.add('show');
  }

  function mount() {
    var right = document.querySelector('.tb-right');
    if (!right || document.getElementById('pwaInstall')) return;
    var b = document.createElement('button');
    b.id = 'pwaInstall';
    b.title = 'Install APEX as an app';
    b.innerHTML = '<span style="font-size:13px;line-height:1">⬇</span><span>INSTALL</span>';
    b.onclick = function () {
      if (deferred) {
        deferred.prompt();
        deferred.userChoice.then(function () { deferred = null; b.classList.remove('show'); });
        return;
      }
      var ua = navigator.userAgent;
      if (/iPhone|iPad|iPod/i.test(ua)) {
        hint('<b>iPhone / iPad:</b> tap the <b>Share</b> icon at the bottom of Safari, scroll down and choose <b>Add to Home Screen</b>. (Safari only - Chrome on iOS cannot install apps.)');
      } else {
        hint('<b>Android / Chrome:</b> open the <b>⋮</b> menu (top-right) and tap <b>Install app</b> or <b>Add to Home screen</b>.<br>Not there? Open <b>/pwa-check</b> on this phone - it will tell you exactly what is missing.');
      }
    };
    right.insertBefore(b, right.firstChild);
    // Always visible on a phone that has not installed yet, even before the event fires,
    // so the user is never stuck with no way in.
    if (!standalone()) b.classList.add('show');
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    mount();
    var b = document.getElementById('pwaInstall');
    if (b) b.classList.add('show');
  });

  window.addEventListener('appinstalled', function () {
    deferred = null;
    var b = document.getElementById('pwaInstall');
    if (b) b.classList.remove('show');
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  if (standalone()) document.body.classList.add('pwa-mode');
})();
