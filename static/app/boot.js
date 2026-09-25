/* Replays anything the user clicked before the app finished loading.
   Runs LAST among the critical-path defer bundles, then exposes __apexFlush so the
   lazy-bundle loader can flush AGAIN once panels/mobile/workstation/strip etc. finish
   loading. Without that second flush an early click on a lazy-bundle control was
   queued by the inline stub, replayed against a stub (no-op), then wiped here —
   the click was silently LOST and boot warned "handler never defined" for handlers
   that were about to exist. Reported 2026-08-13 (reproduced via init-script click:
   queue stayed length 1, sheet never opened). */
(function(){
  var Q=window.__APEXQ||[],S=window.__APEXSTUBS||{},n=0;
  function flush(final){
    // Replay every queued call whose REAL handler is now defined. Entries whose
    // handler is still a stub STAY in the queue — they may resolve on a later flush.
    for(var i=0;i<Q.length;){
      var name=Q[i][0],fn=window[name];
      if(typeof fn==="function"&&fn!==S[name]&&!fn.__stub){
        try{fn.apply(Q[i][1],Q[i][2]);n++;}catch(e){console.warn("replay "+name,e);}
        Q.splice(i,1);
      } else {
        i++;
      }
    }
    // Only the FINAL flush (after lazy bundles loaded) reports stubs that are still
    // installed — that is when "never defined" actually means never defined — and
    // drops the undeliverable remainder so the queue cannot grow unbounded.
    if(final){
      for(var k in S){ if(window[k]===S[k]) console.warn("APEX: handler never defined: "+k); }
      Q.length=0;
    }
  }
  window.__apexFlush=flush;
  flush(false);   // parse-end flush: replay whatever critical-path handlers are ready
  window.__APEX_READY=1;
  document.dispatchEvent(new Event("apex:ready"));
})();
