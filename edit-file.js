/* ============================================================================================================
   edit-file.js
   What it does:    Makes and reads the edit file (.fixframe.json) that lets someone else continue a guide.
   Change here:     Nothing; the format must stay the same so older edit files still open.
   Engine room: better leave it as it is.
   Technical note:  Edit file: everything about a guide except the video itself (cuts, speeds, texts, picture
                   markup). Sent together with the video file(s) so that someone else can continue editing in
                   Fixframe.
   ============================================================================================================ */
const EDIT_FORMAT = 'fixframe-edit';
const EDIT_VERSION = 1;
// The speeds offered for a step (SPEEDS) are in settings.js.

function buildEditFile(P) {
  const r3 = (x) => Math.round((x || 0) * 1000) / 1000;
  const iso = (ms) => { try { return new Date(ms || Date.now()).toISOString(); } catch (e) { return new Date().toISOString(); } };
  return {
    format: EDIT_FORMAT,
    version: EDIT_VERSION,
    app: APP_VERSION,
    note: `Fixframe edit file. ${TEXTS.editFile} Open it in Fixframe together with the video file(s) listed under "videos".`,
    exportedBy: App.cfg.userName || '',
    exportedAt: iso(Date.now()),
    guide: {
      uid: P.uid,
      title: P.title || '',
      author: P.author || '',
      intro: P.intro || '',
      tools: P.tools || '',
      createdBy: P.createdBy || '',
      createdAt: iso(P.createdAt),
      history: (P.history || []).slice(-40).map((e) => Object.assign({ name: e.name || '', at: iso(e.at), what: e.what }, e.from ? { from: e.from } : {})),
      // "preview" is one tiny frame, only so the receiver can tell the videos apart when choosing the files
      videos: P.videos.map((v) => ({
        id: v.id, name: v.name, type: v.type, size: v.size, duration: r3(v.duration), width: v.width, height: v.height,
        preview: v.thumbs && v.thumbs.length ? v.thumbs[Math.floor(v.thumbs.length / 3)].src : (v.preview || ''),
      })),
      steps: P.steps.map((s) => ({
        video: s.src,
        title: s.title || '',
        desc: s.desc || '',
        caution: s.caution || '',
        start: r3(s.start),
        end: r3(s.end),
        speed: s.speed || 1,
        pictures: s.pictures.map((p) => ({ t: r3(p.t), caption: p.caption || '', shapes: p.shapes || [] })),
      })),
      export: P.ex || null,
    },
  };
}

/* The edit file promises one small preview frame per source video; make one where the preview strip is not built yet. */
async function ensurePreviews(P, urls) {
  for (const v of P.videos) {
    if ((v.thumbs && v.thumbs.length) || v.preview || !urls[v.id]) continue;
    const hv = createVideo(urls[v.id]);
    try {
      await videoReady(hv);
      await ensureFrameData(hv);
      await seekTo(hv, (v.duration || 0) / 3);
      const th = 72;
      const c = makeCanvas(Math.max(32, Math.round(th * ((hv.videoWidth / hv.videoHeight) || 16 / 9))), th);
      c.getContext('2d').drawImage(hv, 0, 0, c.width, c.height);
      v.preview = c.toDataURL('image/jpeg', 0.62);
      freeCanvas(c);
    } catch (e) { /* the hand-over still works without the preview */ } finally { disposeVideo(hv); }
  }
}

function editFileError(msg) {
  const e = new Error(msg);
  e.userMsg = msg;
  return e;
}

function sanitizeShapes(list) {
  const u = (v) => clamp(typeof v === 'number' && isFinite(v) ? v : 0.5, 0, 1);
  const out = [];
  for (const s of (Array.isArray(list) ? list : []).slice(0, 200)) {
    if (!s || typeof s !== 'object') continue;
    const base = {
      id: uid('a'), type: s.type,
      color: typeof s.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color.toUpperCase() : '#FF3B30',
      size: [1, 2, 3].includes(s.size) ? s.size : 2,
    };
    if (s.type === 'arrow' || s.type === 'rect' || s.type === 'ellipse') out.push(Object.assign(base, { x1: u(s.x1), y1: u(s.y1), x2: u(s.x2), y2: u(s.y2) }));
    else if (s.type === 'num') out.push(Object.assign(base, { x: u(s.x), y: u(s.y), n: clamp(Math.round(typeof s.n === 'number' && isFinite(s.n) ? s.n : 1), 0, 999) }));
    else if (s.type === 'box') {
      const b = Object.assign(base, { x: u(s.x), y: u(s.y), text: (typeof s.text === 'string' ? s.text.slice(0, 200) : '') || ' ' });
      if (typeof s.tx === 'number' && typeof s.ty === 'number') { b.tx = u(s.tx); b.ty = u(s.ty); }
      out.push(b);
    }
  }
  return out;
}

function sanitizeExportOptions(ex) {
  if (!ex || typeof ex !== 'object') return null;
  const out = { fmt: FORMATS.some((f) => f.id === ex.fmt && f.id !== 'edit') ? ex.fmt : 'mp4' };
  for (const fmt of Object.keys(EX_DEFAULTS)) {
    if (fmt === 'fmt') continue;
    const src = ex[fmt] && typeof ex[fmt] === 'object' ? ex[fmt] : {};
    const o = {};
    for (const [k, def] of Object.entries(EX_DEFAULTS[fmt])) {
      const row = (EX_SCHEMA[fmt] || []).find((r) => r.k === k);
      const v = src[k];
      if (typeof def === 'boolean') { o[k] = typeof v === 'boolean' ? v : def; continue; }
      const choices = row && row.seg ? (typeof row.seg === 'function' ? row.seg() : row.seg) : [];
      // a sound pack from another device may not be on this one: its id is kept, the export then uses Standard
      const packId = k === 'soundStyle' && typeof v === 'string' && /^pack:[a-z0-9]{1,40}$/.test(v);
      o[k] = choices.some(([val]) => val === String(v)) || packId ? String(v) : def;
    }
    out[fmt] = o;
  }
  return out;
}

/* Parse and check an edit file. Everything is copied field by field: the file comes from someone else. */
function parseEditFile(text) {
  let j;
  try { j = JSON.parse(text); } catch (e) { throw editFileError('This is not a Fixframe edit file.'); }
  if (!j || typeof j !== 'object' || j.format !== EDIT_FORMAT || !j.guide || typeof j.guide !== 'object') throw editFileError('This is not a Fixframe edit file.');
  if (typeof j.version === 'number' && j.version > EDIT_VERSION) throw editFileError('This edit file was made with a newer Fixframe. Update the app first: Settings, then “Check for updates”.');
  const g = j.guide;
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
  const when = (v) => { const t = typeof v === 'number' ? v : Date.parse(v); return isFinite(t) && t > 0 ? t : 0; };

  const videos = [];
  const dur = {};
  for (const v of (Array.isArray(g.videos) ? g.videos : []).slice(0, 40)) {
    if (!v || typeof v !== 'object') continue;
    const id = str(v.id, 48);
    const duration = num(v.duration);
    if (!id || duration <= 0 || dur[id] != null) continue;
    dur[id] = duration;
    videos.push({
      id, name: str(v.name, 200) || 'video', type: str(v.type, 80), size: Math.max(0, num(v.size)), duration,
      width: Math.max(0, num(v.width)), height: Math.max(0, num(v.height)),
      preview: typeof v.preview === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]{100,60000}$/.test(v.preview) ? v.preview : '',
    });
  }
  if (!videos.length) throw editFileError('This edit file does not list a video.');

  const steps = [];
  for (const s of (Array.isArray(g.steps) ? g.steps : []).slice(0, 500)) {
    if (!s || typeof s !== 'object' || dur[s.video] == null) continue;
    const d = dur[s.video];
    const end = clamp(num(s.end, d), 0, d);
    const start = clamp(num(s.start), 0, end);
    const pictures = [];
    for (const p of (Array.isArray(s.pictures) ? s.pictures : []).slice(0, 100)) {
      if (!p || typeof p !== 'object') continue;
      pictures.push({ t: clamp(num(p.t), 0, d), caption: str(p.caption, 200), shapes: sanitizeShapes(p.shapes) });
    }
    steps.push({
      video: s.video, title: str(s.title, 120), desc: str(s.desc, 4000), caution: str(s.caution, 1000),
      start, end, speed: SPEEDS.includes(s.speed) ? s.speed : 1, pictures,
    });
  }

  const history = [];
  for (const e of (Array.isArray(g.history) ? g.history : []).slice(-40)) {
    if (!e || typeof e !== 'object' || !['created', 'exported', 'imported'].includes(e.what)) continue;
    const item = { name: str(e.name, 80), at: when(e.at) || Date.now(), what: e.what };
    if (str(e.from, 80)) item.from = str(e.from, 80);
    history.push(item);
  }

  return {
    exportedBy: str(j.exportedBy, 80),
    exportedAt: when(j.exportedAt),
    app: str(j.app, 20),
    guide: {
      uid: str(g.uid, 64) || uid('G'),
      title: str(g.title, 120) || 'Untitled guide',
      author: str(g.author, 120),
      intro: str(g.intro, 4000),
      tools: str(g.tools, 4000),
      createdBy: str(g.createdBy, 80),
      createdAt: when(g.createdAt) || Date.now(),
      history, videos, steps,
      ex: sanitizeExportOptions(g.export),
    },
  };
}
