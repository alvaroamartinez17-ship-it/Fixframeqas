/* ============================================================================================================
   guide-data.js
   What it does:    What a guide consists of (videos, steps, pictures, texts), creating new guides, your name, the
                   history.
   Change here:     Rarely. Careful: older guides on phones must still open.
   Edit with care: change texts and values, not the structure.
   Technical note:  Guide data model (v2: several source videos per guide), the editor's name, and the edit
                   history.
   ============================================================================================================ */
const App = {
  cfg: { userName: '' },
  async load() {
    try {
      const c = await Store.getBlob('cfg:app');
      if (c && typeof c === 'object' && !(c instanceof Blob)) Object.assign(this.cfg, c);
    } catch (e) { /* defaults */ }
    if (typeof this.cfg.userName !== 'string') this.cfg.userName = '';
  },
  save() { return Store.putBlob('cfg:app', this.cfg).catch(() => {}); },
};

function newProject(fields) {
  const now = Date.now();
  return Object.assign({
    id: uid('g'), uid: uid('G'), v: 2, title: 'New repair guide', author: '', intro: '', tools: '',
    createdAt: now, updatedAt: now, sample: false, createdBy: App.cfg.userName || '', from: '', history: [],
    videos: [], steps: [], picIds: [], ex: null, lastT: 0, lastSrc: null,
  }, fields || {});
}
function newSource(P, meta) {
  return {
    id: uid('v'), key: `v:${P.id}:${uid('k')}`, name: meta.name || 'video', type: meta.type || 'video/mp4', size: meta.size || 0,
    duration: meta.duration || 0, width: meta.width || 0, height: meta.height || 0, thumbs: [],
  };
}
function newStep(start, end, extra) {
  return Object.assign({ id: uid('s'), src: '', title: '', desc: '', caution: '', start, end, speed: 1, pictures: [] }, extra || {});
}
function srcOf(P, id) { return (P.videos || []).find((v) => v.id === id) || null; }
function totalVideoDur(P) { return (P.videos || []).reduce((a, v) => a + (v.duration || 0), 0); }

/* Guides made before version 1.2 had exactly one video; bring them to the current shape. */
function migrateProject(P) {
  if (!P || typeof P !== 'object') return P;
  if (!Array.isArray(P.steps)) P.steps = [];
  if (!Array.isArray(P.videos)) {
    const old = P.video || {};
    P.videos = [{
      id: 'v1', key: 'v:' + P.id, name: old.name || 'video', type: old.type || 'video/mp4', size: old.size || 0,
      duration: old.duration || 0, width: old.width || 0, height: old.height || 0, thumbs: Array.isArray(P.thumbs) ? P.thumbs : [],
    }];
    delete P.video;
    delete P.thumbs;
  }
  const first = P.videos[0] ? P.videos[0].id : '';
  for (const s of P.steps) {
    if (!srcOf(P, s.src)) s.src = first;
    if (!Array.isArray(s.pictures)) s.pictures = [];
  }
  for (const v of P.videos) if (!Array.isArray(v.thumbs)) v.thumbs = [];
  if (!P.uid) P.uid = uid('G');
  if (!Array.isArray(P.history)) P.history = [];
  if (typeof P.createdBy !== 'string') P.createdBy = '';
  if (typeof P.from !== 'string') P.from = '';
  if (!Array.isArray(P.picIds)) P.picIds = [];
  P.v = 2;
  return P;
}

function addHistory(P, what, extra) {
  if (!Array.isArray(P.history)) P.history = [];
  const name = App.cfg.userName || '';
  const now = Date.now();
  if (name) {
    for (let i = P.history.length - 1; i >= 0 && !P.history[i].name; i--) P.history[i].name = name;
    if (!P.createdBy && !P.from) P.createdBy = name; // started on this phone before the name was entered
  }
  const last = P.history[P.history.length - 1];
  // the same person doing the same thing again on the same day stays one line
  if (last && last.what === what && last.name === name && now - last.at < 12 * 3600e3 && !extra) last.at = now;
  else P.history.push(Object.assign({ name, at: now, what }, extra || {}));
  if (P.history.length > 40) P.history.splice(0, P.history.length - 40);
}
function historyText(e) {
  const who = e.name || 'Someone';
  if (e.what === 'created') return `${who} started this guide`;
  if (e.what === 'exported') return `${who} made an edit file`;
  if (e.what === 'imported') return `${who} opened an edit file${e.from && e.from !== e.name ? ` from ${e.from}` : ''}`;
  return `${who} edited this guide`;
}

/* Probe a video file and keep it on the device as a new source of guide P. */
async function ingestVideo(P, original, onStatus) {
  // old formats (3GP with H.263 or MPEG-4, AVI, Motion JPEG) are converted to MP4 on the device first
  const { file, url, meta } = await playableVideo(original, onStatus);
  const src = newSource(P, { name: file.name, type: file.type, size: file.size, duration: meta.duration, width: meta.width, height: meta.height });
  try { await Store.putBlob(src.key, file); } catch (e) { URL.revokeObjectURL(url); throw e; }
  return { src, url };
}
function videoFileName(s) {
  let name = String(s.name || 'video').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim() || 'video';
  if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += /quicktime/.test(s.type || '') ? '.mov' : /webm/.test(s.type || '') ? '.webm' : '.mp4';
  return name;
}
