/* ============================================================================================================
   hand-over.js
   What it does:    Saving and sharing files, asking for your name, opening an edit file (choosing the videos,
                   update or keep both).
   Change here:     Texts of those dialogs.
   Edit with care: change texts and values, not the structure.
   Technical note:  Hand-over: saving and sharing files, the editor's name, and opening an edit file from someone
                   else.
   ============================================================================================================ */
const DownloadsCap = {
  p: null,
  get() {
    if (!this.p) {
      this.p = window.claude && typeof window.claude.use === 'function'
        ? Promise.resolve(window.claude.use('downloads')).catch(() => null)
        : Promise.resolve(null);
    }
    return this.p;
  },
};

function canShareFile(blob, name) {
  try {
    if (!navigator.canShare) return false;
    return navigator.canShare({ files: [new File([blob], name, { type: blob.type || 'application/octet-stream' })] });
  } catch (e) { return false; }
}
async function shareFile(blob, name, title) {
  try {
    await navigator.share({ files: [new File([blob], name, { type: blob.type || 'application/octet-stream' })], title: title || name });
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    toast('Sharing is not available here. Use Download instead.', 'err');
  }
}
async function saveFile(blob, name, title) {
  const dl = await DownloadsCap.get();
  if (dl) {
    try { await dl.save({ filename: name, data: blob }); toast('Saved'); } catch (e) {
      const code = e && e.code;
      if (code === 'declined') return;
      if (code === 'rate_limited') toast('Another save is still open. Try again in a moment.');
      else if (code === 'not_signed' || code === 'rejected_extension') toast('This preview cannot save that file type. It works in the installed app.', 'err', 5000);
      else toast(`Could not save the file here (${code || 'unavailable'}).`, 'err', 5000);
    }
    return;
  }
  if (IS_IOS && !IS_FRAMED && canShareFile(blob, name)) { await shareFile(blob, name, title); return; }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast(IS_ANDROID ? 'Saved to Downloads' : 'Download started');
}

/* Edit files carry the name of the person who made them; ask once if it is not set yet. */
async function ensureUserName() {
  if (App.cfg.userName) return true;
  for (;;) {
    const v = await askText({
      title: 'Your name',
      message: 'It is written into the edit file so others can see who made it. You can change it in Settings.',
      placeholder: 'Your name', ok: 'Continue', maxlength: 60,
    });
    if (v == null) return false;
    if (v.trim()) {
      App.cfg.userName = v.trim();
      await App.save();
      return true;
    }
    toast('Enter a name to continue.');
  }
}

async function openEditFileFlow(dropped) {
  const f = dropped || await pickFile('.json,application/json');
  if (!f) return;
  let data;
  try {
    if (f.size > 8 * 1048576) throw editFileError('This file is too large to be a Fixframe edit file.');
    data = parseEditFile(await readText(f));
  } catch (e) {
    toast(e.userMsg || 'This is not a Fixframe edit file.', 'err', 6000);
    return;
  }
  let list = [];
  try { list = await loadProjects(); } catch (e) { /* treated as: nothing on this phone yet */ }
  showImportSheet(data, list.find((p) => p.uid === data.guide.uid) || null);
}

function showImportSheet(data, local) {
  const g = data.guide;
  const picked = {}; // video id → { file, url, meta }
  const have = {};   // video id → the same video already stored in the guide on this phone
  if (local) {
    for (const v of g.videos) {
      const s = local.videos.find((x) => x.id === v.id);
      if (s && Math.abs(s.duration - v.duration) < 1) have[v.id] = s;
    }
  }
  const nPics = g.steps.reduce((a, s) => a + s.pictures.length, 0);
  const body = h('div', { class: 'dlg' });
  let m = null;
  let started = false;
  const ready = () => g.videos.every((v) => picked[v.id] || have[v.id]);
  const choose = async (v) => {
    const f0 = await pickFile(VIDEO_ACCEPT);
    if (!f0) return;
    const bz = busy('Reading video…');
    let r;
    try { r = await playableVideo(f0, (t) => bz.set(t)); } catch (e) {
      bz.close();
      toast(e.userMsg || 'This video cannot be played in this browser. MP4 or MOV works best.', 'err', 9000);
      return;
    }
    bz.close();
    const { file: f, url, meta } = r;
    if (picked[v.id]) URL.revokeObjectURL(picked[v.id].url);
    picked[v.id] = { file: f, url, meta };
    draw();
  };
  const go = (mode) => {
    started = true;
    m.close();
    runImport(data, { local, mode, picked, have });
  };
  const row = (v, i) => {
    const pk = picked[v.id];
    const warn = pk && Math.abs(pk.meta.duration - v.duration) > 0.5
      ? `This video is ${fmtDur(pk.meta.duration)} long, the edit file expects ${fmtDur(v.duration)}. The cuts may not line up.` : '';
    let action;
    if (pk) action = h('button', { class: 'btn small', type: 'button', onClick: () => choose(v) }, icon('check'), 'Change');
    else if (have[v.id]) action = h('span', { class: 'imp-ok' }, icon('check'), 'On this phone');
    else action = h('button', { class: 'btn small accent', type: 'button', onClick: () => choose(v) }, 'Choose video');
    return h('div', { class: 'imp-video' },
      h('span', { class: 'imp-thumb', style: { backgroundImage: v.preview ? `url("${v.preview}")` : '' } }, h('b', null, String(i + 1))),
      h('span', { class: 'imp-meta' },
        h('span', null, pk ? (pk.file.name || v.name) : v.name),
        h('small', null, `${fmtDur(v.duration)} · ${fmtBytes(v.size)}`),
        warn ? h('small', { class: 'imp-warn' }, warn) : null),
      action);
  };
  function draw() {
    const ok = ready();
    const by = [data.exportedBy ? `Edit file from ${data.exportedBy}` : 'Edit file', data.exportedAt ? fmtDate(data.exportedAt) : '',
      plural(g.steps.length, 'step'), plural(nPics, 'picture')].filter(Boolean).join(' · ');
    setKids(body,
      h('h3', { class: 'dlg-title' }, g.title),
      h('p', { class: 'dlg-msg' }, by),
      g.createdBy && g.createdBy !== data.exportedBy ? h('p', { class: 'dlg-msg' }, `Guide started by ${g.createdBy}.`) : null,
      h('div', { class: 'set-section' },
        h('h4', null, g.videos.length > 1 ? 'Videos this guide uses' : 'Video this guide uses'),
        g.videos.map(row),
        h('p', null, 'The edit file does not contain the full video, so choose the video here. The step pictures are rebuilt from it.')),
      local ? h('p', { class: 'dlg-msg' }, `“${local.title || 'This guide'}” is already on this phone. Updating replaces its steps, texts and pictures with the ones from the edit file.`) : null,
      h('div', { class: 'dlg-actions col' },
        local
          ? h('button', { class: 'btn primary', type: 'button', id: 'imp-update', disabled: !ok, onClick: () => go('update') }, 'Update the guide on this phone')
          : h('button', { class: 'btn primary', type: 'button', id: 'imp-create', disabled: !ok, onClick: () => go('new') }, 'Create guide'),
        local ? h('button', { class: 'btn', type: 'button', id: 'imp-copy', disabled: !ok, onClick: () => go('copy') }, 'Keep both: add as a separate guide') : null,
        h('button', { class: 'btn ghost', type: 'button', onClick: () => m.close() }, 'Cancel')));
  }
  draw();
  m = Modal.open(body, { dismissable: false, onClose: () => { if (!started) Object.values(picked).forEach((p) => URL.revokeObjectURL(p.url)); } });
}

/* Build (or update) a guide from an edit file plus its videos. Pictures are captured again from the video. */
async function runImport(data, { local, mode, picked, have }) {
  const g = data.guide;
  const update = mode === 'update' && !!local;
  const b = busy(update ? 'Updating guide…' : 'Creating guide…');
  const written = [];
  const urls = {};
  for (const [id, p] of Object.entries(picked)) urls[id] = p.url;
  try {
    const P = update ? local : newProject({ uid: mode === 'copy' ? uid('G') : g.uid });
    const videos = [];
    for (let i = 0; i < g.videos.length; i++) {
      const v = g.videos[i];
      const pk = picked[v.id];
      const old = have[v.id];
      if (pk) {
        b.set(g.videos.length > 1 ? `Saving video ${i + 1} of ${g.videos.length} in the app…` : `Saving video in the app (${fmtBytes(pk.file.size)})…`);
        const src = newSource(P, { name: pk.file.name || v.name, type: pk.file.type || v.type, size: pk.file.size, duration: pk.meta.duration, width: pk.meta.width, height: pk.meta.height });
        src.id = v.id;
        await Store.putBlob(src.key, pk.file);
        written.push(src.key);
        videos.push(src);
      } else if (update) {
        videos.push(old); // the stored video stays as it is
      } else {
        const blob = await Store.getBlob(old.key);
        if (!blob) throw editFileError(`The video “${old.name}” is missing from storage. Choose the file again.`);
        const src = newSource(P, old);
        src.id = v.id;
        src.thumbs = old.thumbs || [];
        await Store.putBlob(src.key, blob);
        written.push(src.key);
        videos.push(src);
      }
    }
    for (const src of videos) {
      if (urls[src.id]) continue;
      const blob = await Store.getBlob(src.key);
      if (!blob) throw editFileError(`The video “${src.name}” is missing from storage. Choose the file again.`);
      urls[src.id] = URL.createObjectURL(blob);
    }
    const durOf = {};
    for (const src of videos) durOf[src.id] = src.duration || 0;
    const steps = g.steps.map((s) => {
      const d = durOf[s.video];
      const end = clamp(s.end, 0, d);
      const start = clamp(Math.min(s.start, end - 0.1), 0, d);
      return newStep(start, end, { src: s.video, title: s.title, desc: s.desc, caution: s.caution, speed: s.speed });
    });
    const total = g.steps.reduce((a, s) => a + s.pictures.length, 0);
    const picIds = [];
    let k = 0;
    for (const src of videos) {
      const idx = g.steps.map((s, i) => i).filter((i) => g.steps[i].video === src.id && g.steps[i].pictures.length);
      if (!idx.length) continue;
      const hv = createVideo(urls[src.id]);
      try {
        await videoReady(hv);
        await ensureFrameData(hv);
        for (const i of idx) {
          for (const p of g.steps[i].pictures) {
            k++;
            b.set(`Rebuilding picture ${k} of ${total} from the video…`);
            const t = clamp(p.t, 0, Math.max(0, src.duration - 0.03));
            const fr = await grabFrameBlob(hv, t);
            const pic = { id: uid('i'), t, w: fr.w, h: fr.h, caption: p.caption, shapes: p.shapes, rev: uid('r') };
            await Store.putBlob('p:' + pic.id, fr.blob);
            written.push('p:' + pic.id);
            picIds.push(pic.id);
            steps[i].pictures.push(pic);
          }
        }
      } finally { disposeVideo(hv); }
    }
    const oldPics = [];
    const oldKeys = [];
    if (update) {
      (local.picIds || []).forEach((id) => oldPics.push('p:' + id));
      local.steps.forEach((s) => s.pictures.forEach((p) => oldPics.push('p:' + p.id)));
      local.videos.forEach((s) => { if (!videos.includes(s)) oldKeys.push(s.key); });
    }
    Object.assign(P, {
      v: 2, title: mode === 'copy' ? `${g.title} (copy)`.slice(0, 120) : g.title, author: g.author, intro: g.intro, tools: g.tools, sample: false,
      createdBy: g.createdBy, createdAt: g.createdAt || P.createdAt, from: data.exportedBy || '', history: g.history.slice(),
      videos, steps, picIds, ex: g.ex || P.ex || null, updatedAt: Date.now(), lastT: 0, lastSrc: null,
    });
    delete P.cover;
    addHistory(P, 'imported', data.exportedBy ? { from: data.exportedBy } : null);
    await Store.saveProject(P);
    const stale = Array.from(new Set(oldPics.concat(oldKeys)));
    if (stale.length) { try { await Store.delBlobs(stale); } catch (e) { /* left for the next clean-up */ } }
    requestPersist();
    b.close();
    await openEditor(P, urls);
    toast(update ? `Guide updated from ${data.exportedBy ? `${data.exportedBy}’s` : 'the'} edit file.` : `Guide created from ${data.exportedBy ? `${data.exportedBy}’s` : 'the'} edit file.`, '', 3600);
  } catch (e) {
    b.close();
    Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
    if (written.length) Store.delBlobs(written).catch(() => {});
    console.error(e);
    toast(e && e.userMsg ? e.userMsg : storageErrorText(e), 'err', 7000);
    renderHome();
  }
}
