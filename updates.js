/* ============================================================================================================
   updates.js
   What it does:    Offline use and updates: Fixframe only looks for a new version when someone taps 'Check for
                   updates'.
   Change here:     Nothing.
   Engine room: better leave it as it is.
   Technical note:  Offline install + user-controlled updates through the service worker. Nothing is checked
                   automatically.
   ============================================================================================================ */
const PWA = {
  reg: null, applying: false, waitingVersion: null,
  supported() {
    return 'serviceWorker' in navigator && !IS_FRAMED
      && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  },
  async init() {
    if (!this.supported()) return;
    try { this.reg = await navigator.serviceWorker.register('./sw.js'); } catch (e) { this.reg = null; return; }
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (this.applying) location.reload(); });
    if (this.reg.waiting && navigator.serviceWorker.controller) this.onWaiting(this.reg.waiting);
    this.reg.addEventListener('updatefound', () => {
      const w = this.reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) this.onWaiting(w); });
    });
    // No automatic update check: Fixframe looks for a new version only when the user taps "Check for updates".
  },
  async check() {
    if (!this.reg) return 'unsupported';
    if (navigator.onLine === false) return 'offline';
    // Tell the service worker that this update was asked for (it refuses updates the browser starts on its own).
    try { const c = await caches.open('fixframe-flags'); await c.put('./update-ok', new Response(String(Date.now()))); } catch (e) { /* older browsers: still try */ }
    try { await this.reg.update(); } catch (e) { return 'offline'; }
    const inst = this.reg.installing;
    if (inst) {
      await new Promise((res) => {
        const f = () => { if (inst.state !== 'installing') { inst.removeEventListener('statechange', f); res(); } };
        inst.addEventListener('statechange', f);
        setTimeout(res, 20000);
      });
    }
    if (this.reg.waiting) { await this.onWaiting(this.reg.waiting); return 'available'; }
    return 'current';
  },
  async onWaiting(w) {
    this.waitingVersion = await swVersion(w);
    $('#update-ver').textContent = this.waitingVersion || '';
    $('#update-banner').hidden = false;
    document.documentElement.classList.add('has-update');
  },
  apply() {
    const w = this.reg && this.reg.waiting;
    if (!w) { location.reload(); return; }
    this.applying = true;
    w.postMessage({ type: 'SKIP_WAITING' });
    setTimeout(() => location.reload(), 4000);
  },
};
function swVersion(w) {
  return new Promise((res) => {
    try {
      const ch = new MessageChannel();
      const t = setTimeout(() => res(null), 2000);
      ch.port1.onmessage = (e) => { clearTimeout(t); res(e.data && e.data.version); };
      w.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
    } catch (e) { res(null); }
  });
}
