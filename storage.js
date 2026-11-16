/* ============================================================================================================
   storage.js
   What it does:    Saves guides, videos and pictures in the browser's own storage on this device (IndexedDB).
   Change here:     Nothing. Changes here can lose people's guides.
   Engine room: better leave it as it is.
   Technical note:  On-device storage: IndexedDB with an in-memory fallback when the browser refuses storage.
   ============================================================================================================ */
const Store = (() => {
  const DB_NAME = 'fixframe';
  let dbp = null;
  let mem = null;
  let db = null;

  function memory() {
    if (!mem) mem = { projects: new Map(), blobs: new Map() };
    return null;
  }
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      let req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { finish(memory()); return; }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
      };
      req.onsuccess = () => {
        db = req.result;
        db.onversionchange = () => { try { db.close(); } catch (e) { /* ignore */ } };
        finish(db);
      };
      req.onerror = () => finish(memory());
      req.onblocked = () => { /* another tab holds an old version; wait */ };
      setTimeout(() => finish(memory()), 9000);
    });
    return dbp;
  }
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const txDone = (tx) => new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('Storage write was cancelled'));
  });

  async function get(store, key) {
    const d = await open();
    if (!d) return mem[store].get(key);
    return reqP(d.transaction(store, 'readonly').objectStore(store).get(key));
  }
  async function put(store, value, key) {
    const d = await open();
    if (!d) { mem[store].set(key !== undefined ? key : value.id, value); return; }
    const tx = d.transaction(store, 'readwrite');
    if (key !== undefined) tx.objectStore(store).put(value, key); else tx.objectStore(store).put(value);
    await txDone(tx);
  }
  async function del(store, keys) {
    const d = await open();
    if (!d) { keys.forEach((k) => mem[store].delete(k)); return; }
    const tx = d.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    keys.forEach((k) => os.delete(k));
    await txDone(tx);
  }
  async function all(store) {
    const d = await open();
    if (!d) return Array.from(mem[store].values());
    return reqP(d.transaction(store, 'readonly').objectStore(store).getAll());
  }

  return {
    async isPersistent() { return !!(await open()); },
    listProjects: () => all('projects'),
    getProject: (id) => get('projects', id),
    saveProject: (p) => put('projects', p),
    async putBlob(key, blob) {
      try { await put('blobs', blob, key); }
      catch (e) {
        if (e && e.name === 'QuotaExceededError') throw e;
        // Some older WebKit builds refuse Blob values; store the raw bytes instead.
        await put('blobs', { __bytes: await blob.arrayBuffer(), type: blob.type }, key);
      }
    },
    async getBlob(key) {
      const v = await get('blobs', key);
      if (v && v.__bytes) return new Blob([v.__bytes], { type: v.type || '' });
      return v || null;
    },
    delBlobs: (keys) => (keys.length ? del('blobs', keys) : Promise.resolve()),
    async deleteProject(p) {
      const keys = ['v:' + p.id];
      (p.videos || []).forEach((v) => { if (v && v.key) keys.push(v.key); });
      (p.picIds || []).forEach((id) => keys.push('p:' + id));
      p.steps.forEach((s) => s.pictures.forEach((pic) => keys.push('p:' + pic.id)));
      await del('blobs', Array.from(new Set(keys)));
      await del('projects', [p.id]);
    },
    async wipe() {
      if (db) { try { db.close(); } catch (e) { /* ignore */ } }
      db = null; dbp = null; mem = null;
      await new Promise((res) => {
        try {
          const r = indexedDB.deleteDatabase(DB_NAME);
          r.onsuccess = r.onerror = r.onblocked = () => res();
        } catch (e) { res(); }
      });
    },
  };
})();

async function storageEstimate() {
  try { if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate(); } catch (e) { /* ignore */ }
  return null;
}
async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persisted && (await navigator.storage.persisted())) return true;
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch (e) { /* ignore */ }
  return false;
}
function storageErrorText(e) {
  if (e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''))) {
    return 'Not enough free storage for this video. Free up space on the phone or delete an old guide, then try again.';
  }
  return `Saving failed: ${(e && e.message) || e}`;
}
