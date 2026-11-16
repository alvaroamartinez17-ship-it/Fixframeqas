/* ============================================================================================================
   editor.js
   What it does:    The editor: the video player, the steps with their buttons, guide info, several videos per
                   guide, undo/redo.
   Change here:     Texts and hints in the editor.
   Edit with care: change texts and values, not the structure.
   Technical note:  Guide editor: video player, source videos, steps (split / trim / speed), pictures, guide info.
   ============================================================================================================ */
const E = { P: null, urls: {}, src: null, thumbs: [], sel: null, t: 0, dur: 0, fps: 30, undo: [], redo: [], thumbJob: 0, loadJob: 0 };
const vid = () => $('#vid');
const selStep = () => (E.P ? E.P.steps.find((s) => s.id === E.sel) || null : null);
const stepIndex = (id) => E.P.steps.findIndex((s) => s.id === id);
const activeSrc = () => (E.P ? srcOf(E.P, E.src) : null);
const srcNo = (id) => E.P.videos.findIndex((v) => v.id === id) + 1;
const inActive = (s) => s.src === E.src;

async function openEditor(P, preUrls) {
  migrateProject(P);
  if (!P.videos.length) { toast('This guide has no video.', 'err', 5000); return false; }
  const urls = Object.assign({}, preUrls || {});
  for (const s of P.videos) {
    if (urls[s.id]) continue;
    let blob = null;
    try { blob = await Store.getBlob(s.key); } catch (e) { /* reported below */ }
    if (!blob) {
      Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
      toast(`The video “${s.name}” of this guide is missing from storage.`, 'err', 6000);
      return false;
    }
    urls[s.id] = URL.createObjectURL(blob);
  }
  E.P = P;
  E.urls = urls;
  E.undo = [];
  E.redo = [];
  const start = srcOf(P, P.lastSrc) || (P.steps[0] && srcOf(P, P.steps[0].src)) || P.videos[0];
  const first = P.steps.find((s) => s.src === start.id);
  E.sel = first ? first.id : null;
  E.src = start.id;
  E.thumbs = start.thumbs || [];
  showView('editor');
  Nav.push('editor', () => closeEditor(true));
  $('#ed-title').textContent = P.title || 'Untitled guide';
  fillGuideFields();
  renderHandover();
  selectTab('steps');
  renderSources();
  renderSteps();
  updateUndoButtons();
  await loadSource(start.id, { t: !P.lastSrc || P.lastSrc === start.id ? P.lastT : 0 });
  if (!E.P) return false;
  updateStageHeight();
  buildAllThumbs();
  return true;
}

/* Put one of the guide's videos into the player and timeline. */
async function loadSource(id, o = {}) {
  const job = ++E.loadJob;
  const s = srcOf(E.P, id);
  const v = vid();
  E.src = id;
  E.thumbs = s.thumbs || [];
  Scrub.target = null;
  v.muted = false;
  v.src = E.urls[id];
  try { await videoReady(v); } catch (e) { if (E.P && job === E.loadJob) toast('This video cannot be played on this device.', 'err', 5000); }
  if (!E.P || job !== E.loadJob) return false;
  E.dur = isFinite(v.duration) && v.duration > 0 ? v.duration : s.duration || 0;
  if (!s.duration) s.duration = E.dur;
  $('#player').style.setProperty('--ar', String((v.videoWidth || s.width || 16) / (v.videoHeight || s.height || 9)));
  $('#tc-dur').textContent = `/ ${fmtTime(E.dur, false)}`;
  if (!o.playing) {
    try { v.muted = true; await v.play(); v.pause(); } catch (e) { /* Low Power Mode etc.: frames still appear after the first tap */ } finally { v.muted = false; }
    if (!E.P || job !== E.loadJob) return false;
  }
  const st = selStep();
  E.t = clamp(o.t || (st && st.src === id ? st.start : 0), 0, E.dur);
  v.currentTime = E.t;
  TL.setup(E.dur);
  TL.setTime(E.t);
  updateTimeUI();
  return true;
}

/* Show another video of the guide. The selected step always belongs to the video on screen. */
async function switchSource(id, o = {}) {
  if (!E.P || !srcOf(E.P, id)) return false;
  if (o.sel && E.P.steps.some((s) => s.id === o.sel && s.src === id)) E.sel = o.sel;
  const cur = selStep();
  if (!cur || cur.src !== id) {
    const first = E.P.steps.find((s) => s.src === id);
    E.sel = first ? first.id : null;
  }
  if (id !== E.src) {
    if (!o.playing) Play.stop();
    E.thumbJob++;
    E.src = id;
    E.thumbs = srcOf(E.P, id).thumbs || [];
    renderSources();
    renderSteps();
    const ok = await loadSource(id, o);
    if (!ok) return false;
  } else {
    renderSources();
    renderSteps();
    TL.renderSteps();
  }
  updatePlayerTag();
  buildAllThumbs();
  return true;
}

async function closeEditor(fromHistory) {
  if (!E.P) return;
  if (!fromHistory) Nav.pop('editor');
  Play.stop();
  const P = E.P;
  P.lastT = E.t;
  P.lastSrc = E.src;
  E.thumbJob++;
  E.loadJob++;
  try {
    const first = P.steps.find((s) => s.pictures.length);
    if (first) P.cover = await PicThumbs.get(first.pictures[0]);
    else delete P.cover;
  } catch (e) { /* cover is optional */ }
  await saveNow();
  await gcPictures(P);
  const v = vid();
  try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { /* ignore */ }
  Object.values(E.urls).forEach((u) => URL.revokeObjectURL(u));
  E.P = null; E.urls = {}; E.src = null; E.thumbs = [];
  PicThumbs.cache.clear();
  $('#editor').classList.remove('typing');
  showView('home');
  renderHome();
}

async function gcPictures(P) {
  const used = new Set();
  P.steps.forEach((s) => s.pictures.forEach((p) => used.add(p.id)));
  const unused = (P.picIds || []).filter((id) => !used.has(id));
  if (unused.length) { try { await Store.delBlobs(unused.map((id) => 'p:' + id)); } catch (e) { /* retry next time */ } }
  P.picIds = Array.from(used);
  try { await Store.saveProject(P); } catch (e) { /* ignore */ }
}

const saveSoon = debounce(() => saveNow(), 600);
async function saveNow() {
  saveSoon.cancel();
  if (!E.P) return;
  E.P.updatedAt = Date.now();
  try { await Store.saveProject(E.P); } catch (e) { toast(storageErrorText(e), 'err', 5000); }
}

/* ---------- undo ---------- */
function snap() { return JSON.stringify(E.P.steps); }
function pushUndo(s) {
  E.undo.push(s || snap());
  if (E.undo.length > 80) E.undo.shift();
  E.redo.length = 0;
  updateUndoButtons();
}
function undo() {
  if (!E.undo.length) return;
  E.redo.push(snap());
  E.P.steps = JSON.parse(E.undo.pop());
  changed();
  toast('Undone', '', 1400);
}
function redo() {
  if (!E.redo.length) return;
  E.undo.push(snap());
  E.P.steps = JSON.parse(E.redo.pop());
  changed();
}
function clearUndo() {
  E.undo = [];
  E.redo = [];
  updateUndoButtons();
}
function updateUndoButtons() {
  $('#ed-undo').disabled = !E.undo.length;
  $('#ed-redo').disabled = !E.redo.length;
}
function changed() {
  const cur = selStep();
  if (!cur || !inActive(cur)) {
    const first = E.P.steps.find(inActive);
    E.sel = first ? first.id : null;
  }
  renderSteps();
  TL.renderSteps();
  updateUndoButtons();
  updatePlayerTag();
  saveSoon();
}

/* ---------- time + playback ---------- */
function updateTimeUI() {
  $('#tc-cur').textContent = fmtTime(E.t);
  updatePlayerTag();
}
function updatePlayerTag() {
  if (!E.P) return;
  const t = E.t;
  const sel = selStep();
  const st = sel && inActive(sel) && t >= sel.start && t <= sel.end ? sel : E.P.steps.find((s) => inActive(s) && t >= s.start && t < s.end);
  const tag = $('#player-tag');
  const sp = $('#player-speed');
  const pre = E.P.videos.length > 1 ? `V${srcNo(E.src)} · ` : '';
  tag.hidden = false;
  if (st) {
    const i = stepIndex(st.id);
    tag.textContent = `${pre}Step ${i + 1}${st.title ? ` · ${st.title}` : ''}`;
    sp.hidden = st.speed === 1;
    sp.textContent = speedLabel(st.speed);
  } else {
    tag.textContent = `${pre}Not in a step · left out of exports`;
    sp.hidden = true;
  }
}

const Play = {
  ranges: null, i: 0, raf: 0, hold: false, token: 0,
  start(ranges) {
    const v = vid();
    this.stop(false);
    const token = this.token;
    this.ranges = ranges && ranges.length ? ranges : null;
    this.i = 0;
    if (this.ranges) this.enter(this.ranges[0], token, true);
    else {
      v.playbackRate = 1;
      if (E.t >= E.dur - 0.05) v.currentTime = 0;
      else if (Math.abs(v.currentTime - E.t) > 0.02) v.currentTime = E.t;
      this.go(v);
    }
    this.loop();
  },
  go(v) {
    const p = v.play();
    if (p && p.catch) p.catch((e) => { if (E.P && e && e.name === 'NotAllowedError') toast('Tap play to start the video.'); });
    this.measureFps();
  },
  /* Start playing one range; loads its video first when the range belongs to another video of the guide. */
  async enter(r, token, first) {
    const v = vid();
    if (r.src && r.src !== E.src) {
      this.hold = true;
      // Calling play() inside the tap keeps the permission to play once the other video has loaded.
      if (first) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
      const ok = await switchSource(r.src, { playing: true, t: r.start, sel: r.id });
      if (token !== this.token) return;
      this.hold = false;
      if (!ok) { this.stop(); return; }
    }
    v.currentTime = r.start;
    v.playbackRate = clamp(r.speed, 0.25, 16);
    E.t = r.start;
    this.go(v);
  },
  loop() {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      const v = vid();
      if (!E.P) return;
      if (this.hold) { this.raf = requestAnimationFrame(tick); return; }
      E.t = v.currentTime;
      if (this.ranges) {
        const r = this.ranges[this.i];
        if (E.t >= r.end - 0.02) {
          this.i++;
          if (this.i < this.ranges.length) this.enter(this.ranges[this.i], this.token, false);
          else {
            this.ranges = null;
            v.pause();
            v.currentTime = r.end;
            E.t = r.end;
          }
        }
      }
      if (!this.hold) {
        TL.setTime(E.t);
        updateTimeUI();
      }
      if (v.paused && !this.ranges) { this.raf = 0; return; }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  },
  stop(pause = true) {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ranges = null;
    this.hold = false;
    this.token++;
    const v = vid();
    if (pause && !v.paused) v.pause();
    v.playbackRate = 1;
  },
  measureFps() {
    const v = vid();
    if (typeof v.requestVideoFrameCallback !== 'function') return;
    let last = -1;
    let n = 0;
    let best = 1;
    const cb = (now, md) => {
      if (last >= 0) { const d = md.mediaTime - last; if (d > 0.004 && d < best) best = d; }
      last = md.mediaTime;
      if (++n < 24 && !v.paused) v.requestVideoFrameCallback(cb);
      else if (best < 0.2) E.fps = clamp(Math.round(1 / best), 10, 120);
    };
    v.requestVideoFrameCallback(cb);
  },
};
function togglePlay() {
  if (!vid().paused || Play.hold) { Play.stop(); return; }
  Play.start(null);
}
const playRange = (s) => ({ id: s.id, src: s.src, start: s.start, end: s.end, speed: s.speed });
function playStep(st) { Play.start([playRange(st)]); }
function playAll() {
  const r = E.P.steps.filter((s) => s.end - s.start > 0.05).map(playRange);
  if (!r.length) { toast('There are no steps to play.'); return; }
  Play.start(r);
}

const Scrub = {
  target: null, busy: false, timer: 0, usedFast: false,
  request(t) {
    this.target = t;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.settle(), 150);
    this.kick(true);
  },
  kick(fast) {
    if (this.busy || this.target == null) return;
    const v = vid();
    const t = this.target;
    this.target = null;
    this.busy = true;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(guard);
      v.removeEventListener('seeked', done);
      this.busy = false;
      this.kick(this.lastFast);
    };
    const guard = setTimeout(done, 900);
    v.addEventListener('seeked', done);
    this.lastFast = fast;
    if (fast && typeof v.fastSeek === 'function') { this.usedFast = true; v.fastSeek(t); } else v.currentTime = t;
  },
  settle() {
    const v = vid();
    if (this.usedFast || Math.abs(v.currentTime - E.t) > 0.002) {
      this.usedFast = false;
      this.target = E.t;
      this.lastFast = false;
      this.kick(false);
    }
  },
};
function onScrub(t) {
  if (!vid().paused) Play.stop();
  E.t = t;
  updateTimeUI();
  Scrub.request(t);
}
function seekPrecise(t, smooth) {
  if (!vid().paused) Play.stop();
  E.t = clamp(t, 0, E.dur);
  TL.setTime(E.t, smooth);
  updateTimeUI();
  Scrub.target = E.t;
  Scrub.lastFast = false;
  Scrub.kick(false);
}
function nudge(seconds) { seekPrecise(E.t + seconds); }

/* ---------- source videos ---------- */
function renderSources() {
  if (!E.P) return;
  const box = $('#sources');
  setKids(box,
    E.P.videos.map((s, i) => {
      const on = s.id === E.src;
      return h('button', {
        type: 'button', class: 'src-chip', 'aria-pressed': String(on), title: s.name,
        'aria-label': on ? `Video ${i + 1}, ${s.name}, shown now. Open details` : `Show video ${i + 1}, ${s.name}`,
        onClick: () => (s.id === E.src ? openSourceSheet(s) : switchSource(s.id)),
      }, h('b', null, String(i + 1)), h('span', null, s.name), h('small', null, fmtTime(Math.round(s.duration), false)), on ? icon('more') : null);
    }),
    h('button', { type: 'button', class: 'src-chip src-add', id: 'btn-add-video', onClick: () => addVideosFlow() }, icon('plus'), 'Add video'));
}

async function addVideosFlow() {
  const files = (await pickFiles(VIDEO_ACCEPT, true)).filter(isVideoFile);
  if (!files.length || !E.P) return;
  Play.stop();
  const P = E.P;
  const b = busy('Reading video…');
  const added = [];
  let unreadable = 0;
  let why = '';
  try {
    for (let i = 0; i < files.length; i++) {
      b.set(files.length > 1 ? `Saving video ${i + 1} of ${files.length} in the app…` : `Saving video in the app (${fmtBytes(files[i].size)})…`);
      try {
        const r = await ingestVideo(P, files[i], (t) => b.set(files.length > 1 ? `Video ${i + 1} of ${files.length}: ${t}` : t));
        P.videos.push(r.src);
        E.urls[r.src.id] = r.url;
        const st = newStep(0, r.src.duration, { src: r.src.id });
        P.steps.push(st);
        added.push({ src: r.src, step: st });
      } catch (e) {
        if (!(e && e.unplayable)) throw e;
        unreadable++;
        why = e.userMsg || why;
      }
    }
  } catch (e) { toast(storageErrorText(e), 'err', 7000); }
  b.close();
  if (unreadable) toast((unreadable === 1 ? 'One video was left out. ' : `${unreadable} videos were left out. `) + (why || 'They cannot be played in this browser.'), 'err', 9000);
  if (!added.length || !E.P) return;
  clearUndo();
  await saveNow();
  await switchSource(added[0].src.id, { sel: added[0].step.id });
  const n = srcNo(added[0].src.id);
  const k = stepIndex(added[0].step.id) + 1;
  toast(added.length === 1 ? `Video ${n} added as step ${k}. Split it where each step begins.` : `${added.length} videos added, each as one step. Split them where each step begins.`, '', 4200);
}

function openSourceSheet(s) {
  const P = E.P;
  const mine = P.steps.filter((x) => x.src === s.id);
  const nums = mine.map((x) => stepIndex(x.id) + 1);
  let m = null;
  const save = h('button', { class: 'btn', type: 'button' }, icon('download'), 'Save a copy of this video');
  save.addEventListener('click', async () => {
    const blob = await Store.getBlob(s.key).catch(() => null);
    if (!blob) { toast('This video is missing from storage.', 'err'); return; }
    saveFile(blob, videoFileName(s), P.title);
  });
  const remove = P.videos.length > 1
    ? h('button', { class: 'btn danger-ghost', type: 'button', onClick: () => { m.close(); removeSourceFlow(s); } }, icon('trash'), 'Remove video from guide')
    : null;
  m = Modal.open(h('div', { class: 'dlg' },
    h('h3', { class: 'dlg-title' }, `Video ${srcNo(s.id)}`),
    h('p', { class: 'dlg-msg' }, s.name),
    h('p', { class: 'dlg-msg mono' }, `${fmtDur(s.duration)} · ${s.width} × ${s.height} · ${fmtBytes(s.size)}`),
    h('p', { class: 'dlg-msg' }, mine.length ? `Used by ${mine.length === 1 ? 'step' : 'steps'} ${nums.join(', ')}.` : 'No step uses this video yet.'),
    save, remove,
    h('button', { class: 'btn ghost', type: 'button', onClick: () => m.close() }, 'Close')));
}

async function removeSourceFlow(s) {
  const P = E.P;
  if (!P || P.videos.length < 2) return;
  const mine = P.steps.filter((x) => x.src === s.id);
  const nPics = mine.reduce((a, x) => a + x.pictures.length, 0);
  const ok = await ask({
    title: `Remove “${s.name}” from this guide?`,
    message: mine.length
      ? `Its ${plural(mine.length, 'step')}${nPics ? ` and ${plural(nPics, 'picture')}` : ''} are removed too. This cannot be undone.`
      : 'No step uses this video. This cannot be undone.',
    ok: 'Remove video', danger: true,
  });
  if (!ok || !E.P) return;
  Play.stop();
  P.steps = P.steps.filter((x) => x.src !== s.id);
  P.videos = P.videos.filter((x) => x.id !== s.id);
  clearUndo();
  if (E.src === s.id) await switchSource(P.videos[0].id, {});
  else { renderSources(); changed(); buildAllThumbs(); }
  if (E.urls[s.id]) { URL.revokeObjectURL(E.urls[s.id]); delete E.urls[s.id]; }
  try { await Store.delBlobs([s.key]); } catch (e) { /* the entry is gone from the guide either way */ }
  await saveNow();
  toast('Video removed from the guide');
}

/* ---------- steps ---------- */
function stepSummary(st) {
  const len = Math.max(0, st.end - st.start);
  let s = `${fmtTenths(st.start)}–${fmtTenths(st.end)} · ${fmtDur(len)}`;
  if (st.speed !== 1) s += ` → ${fmtDur(len / st.speed)}`;
  return s;
}
function speedNote(st) {
  const len = Math.max(0, st.end - st.start);
  if (st.speed === 1) return `Plays at normal speed · ${fmtDur(len)}`;
  return `${fmtDur(len)} of footage plays in ${fmtDur(len / st.speed)}`;
}
function stepThumb(st) {
  if (!E.P) return '';
  const s = srcOf(E.P, st.src);
  const th = st.src === E.src ? E.thumbs : s && s.thumbs;
  if (!th || !th.length) return '';
  const t = st.start + Math.min(0.5, (st.end - st.start) / 2);
  let best = th[0];
  for (const x of th) if (Math.abs(x.t - t) < Math.abs(best.t - t)) best = x;
  return `url("${best.src}")`;
}
function refreshStepThumbs() {
  $$('#steps .step').forEach((li) => {
    const st = E.P.steps.find((s) => s.id === li.dataset.id);
    const el = li.querySelector('.step-thumb');
    if (st && el) el.style.backgroundImage = stepThumb(st);
  });
}
function renderSteps() {
  const ol = $('#steps');
  ol.textContent = '';
  $('#steps-count').textContent = String(E.P.steps.length);
  if (!E.P.steps.length) {
    ol.append(h('li', { class: 'steps-empty' }, 'No steps yet. Move the playhead to where a step begins and tap ', h('b', null, 'Add step here'), '.'));
    return;
  }
  if (!E.P.steps.some(inActive)) {
    ol.append(h('li', { class: 'steps-empty' }, `No step uses video ${srcNo(E.src)} yet. Move the playhead and tap `, h('b', null, 'Add step here'), '.'));
  }
  E.P.steps.forEach((st, i) => ol.append(stepItem(st, i)));
}
function stepItem(st, i) {
  const sel = st.id === E.sel;
  const many = E.P.videos.length > 1;
  const li = h('li', { class: `step${sel ? ' is-sel' : ''}`, 'data-id': st.id });
  li.append(h('button', { class: 'step-row', type: 'button', 'aria-expanded': String(sel), onClick: () => selectStep(st.id, true, false) },
    h('span', { class: 'step-num' }, String(i + 1)),
    h('span', { class: 'step-thumb', style: { backgroundImage: stepThumb(st) } }, many ? h('span', { class: 'src-badge' }, `V${srcNo(st.src)}`) : null),
    h('span', { class: 'step-meta' },
      h('span', { class: `step-title${st.title ? '' : ' placeholder'}` }, st.title || 'Untitled step'),
      h('span', { class: 'step-sub' }, stepSummary(st))),
    st.pictures.length ? h('span', { class: 'step-pics', 'aria-label': plural(st.pictures.length, 'picture') }, icon('camera'), String(st.pictures.length)) : null));
  if (sel) li.append(stepBody(st, i));
  return li;
}
function stepBody(st, i) {
  const title = h('input', { type: 'text', id: 'st-title', maxlength: '120', placeholder: `What happens in step ${i + 1}?`, autocomplete: 'off', enterkeyhint: 'done' });
  title.value = st.title;
  title.addEventListener('input', () => {
    st.title = title.value;
    const row = $(`.step[data-id="${st.id}"] .step-title`);
    if (row) { row.textContent = st.title || 'Untitled step'; row.classList.toggle('placeholder', !st.title); }
    updatePlayerTag();
    saveSoon();
  });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  const desc = h('textarea', { id: 'st-desc', rows: '3', placeholder: 'What to do, and what to look out for' });
  desc.value = st.desc;
  desc.addEventListener('input', () => { st.desc = desc.value; saveSoon(); });
  const cau = h('textarea', { id: 'st-caution', rows: '2', placeholder: 'Optional, e.g. Unplug the machine first' });
  cau.value = st.caution;
  cau.addEventListener('input', () => { st.caution = cau.value; saveSoon(); });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Playback speed' },
    SPEEDS.map((sp) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(st.speed === sp), onClick: () => setSpeed(st, sp) }, speedLabel(sp))));
  const pics = h('div', { class: 'pics' });
  st.pictures.forEach((pic, k) => {
    const b = h('button', { type: 'button', class: 'pic-tile', 'aria-label': `Edit picture ${k + 1}`, onClick: () => openPicEditor(st, pic) });
    PicThumbs.get(pic).then((u) => { if (u) b.style.backgroundImage = `url("${u}")`; }).catch(() => {});
    pics.append(b);
  });
  pics.append(h('button', { type: 'button', class: 'pic-tile pic-add', onClick: () => capturePicture() }, icon('camera'), 'Capture frame'));
  return h('div', { class: 'step-body' },
    h('label', { class: 'field' }, h('span', null, 'Step title'), title),
    h('label', { class: 'field' }, h('span', null, 'Instructions'), desc),
    h('label', { class: 'field caution' }, h('span', null, 'Caution note'), cau),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Speed in the video'), chips, h('div', { class: 'speed-note' }, speedNote(st))),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, `Pictures · ${st.pictures.length}`), pics),
    h('div', { class: 'step-actions' },
      h('button', { type: 'button', class: 'btn small', onClick: () => playStep(st) }, icon('play'), 'Play step'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Move step up', disabled: i === 0, onClick: () => moveStep(st, -1) }, icon('up')),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Move step down', disabled: i === E.P.steps.length - 1, onClick: () => moveStep(st, 1) }, icon('down')),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Delete step', onClick: () => deleteStep(st) }, icon('trash'))));
}
async function selectStep(id, seek = true, scroll = false) {
  const st = E.P.steps.find((s) => s.id === id);
  if (!st) return;
  if (st.src !== E.src) {
    // the step was cut from another video of this guide: show that video
    await switchSource(st.src, { sel: id, t: st.start + 0.001 });
    if (!E.P) return;
  } else {
    if (E.sel !== id) {
      E.sel = id;
      renderSteps();
      TL.renderSteps();
    }
    if (seek) seekPrecise(st.start + 0.001, true);
  }
  if (scroll) {
    const li = $(`.step[data-id="${id}"]`);
    if (li) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  updatePlayerTag();
}
function setSpeed(st, sp) {
  if (st.speed === sp) return;
  pushUndo();
  st.speed = sp;
  changed();
}
function moveStep(st, dir) {
  const i = stepIndex(st.id);
  const j = i + dir;
  if (j < 0 || j >= E.P.steps.length) return;
  pushUndo();
  E.P.steps.splice(i, 1);
  E.P.steps.splice(j, 0, st);
  changed();
}
async function deleteStep(st) {
  if (st.pictures.length) {
    const ok = await ask({ title: 'Delete this step?', message: `Its ${plural(st.pictures.length, 'picture')} will be removed too. You can undo this.`, ok: 'Delete step', danger: true });
    if (!ok) return;
  }
  pushUndo();
  E.P.steps.splice(stepIndex(st.id), 1);
  changed();
  toast('Step deleted · Undo brings it back', '', 2400);
}
function stepAt(t) {
  const sel = selStep();
  if (sel && inActive(sel) && t > sel.start && t < sel.end) return sel;
  return E.P.steps.find((s) => inActive(s) && t > s.start && t < s.end) || null;
}
function splitHere() {
  const t = E.t;
  const st = stepAt(t);
  if (!st) { toast('Move the playhead inside a step to split it.'); return; }
  if (t - st.start < 0.1 || st.end - t < 0.1) { toast('Too close to the start or end of the step.'); return; }
  pushUndo();
  const i = stepIndex(st.id);
  const ns = newStep(t, st.end, { speed: st.speed, src: st.src });
  ns.pictures = st.pictures.filter((p) => p.t >= t);
  st.pictures = st.pictures.filter((p) => p.t < t);
  st.end = t;
  E.P.steps.splice(i + 1, 0, ns);
  E.sel = ns.id;
  changed();
  toast(`Split into steps ${i + 1} and ${i + 2}`, '', 1800);
}
function setEdge(which) {
  const st = selStep();
  if (!st || !inActive(st)) { toast('Select a step first.'); return; }
  const t = E.t;
  if (which === 'start') {
    if (t >= st.end - 0.1) { toast('The start has to be before the end of the step.'); return; }
    pushUndo();
    st.start = t;
  } else {
    if (t <= st.start + 0.1) { toast('The end has to be after the start of the step.'); return; }
    pushUndo();
    st.end = t;
  }
  changed();
  toast(which === 'start' ? `Step starts at ${fmtTime(t)}` : `Step ends at ${fmtTime(t)}`, '', 1600);
}
function addStepHere() {
  const t = E.t;
  if (t >= E.dur - 0.15) { toast('Move the playhead back a little to add a step.'); return; }
  const mine = E.P.steps.filter(inActive);
  const later = mine.filter((s) => s.start > t + 0.05).map((s) => s.start);
  const end = Math.min(E.dur, t + 5, later.length ? Math.min(...later) : E.dur);
  pushUndo();
  const ns = newStep(t, Math.max(end, Math.min(E.dur, t + 0.2)), { src: E.src });
  // keep the steps of one video together: before its next step, else after its last one
  const next = mine.find((s) => s.start > t);
  let at = E.P.steps.length;
  if (next) at = stepIndex(next.id);
  else if (mine.length) at = stepIndex(mine[mine.length - 1].id) + 1;
  E.P.steps.splice(at, 0, ns);
  E.sel = ns.id;
  changed();
  toast(`Step ${at + 1} added · drag its handles to trim`, '', 2600);
}

/* ---------- pictures ---------- */
async function capturePicture() {
  const v = vid();
  if (!vid().paused) Play.stop();
  const t = E.t;
  let st = selStep();
  if (st && !inActive(st)) st = null;
  if (!st || t < st.start - 0.05 || t > st.end + 0.05) st = E.P.steps.find((s) => inActive(s) && t >= s.start && t <= s.end) || st;
  if (!st) { toast('Add a step first, then capture its pictures.'); return; }
  if (Math.abs(v.currentTime - t) > 0.01) { v.currentTime = t; await waitFor(v, 'seeked', null, 3000).catch(() => {}); }
  await ensureFrameData(v);
  if (!v.videoWidth) { toast('The video frame is not ready yet. Try again.'); return; }
  let blob;
  let w;
  let hh;
  try {
    const c = frameCanvas(v, 1920);
    w = c.width; hh = c.height;
    blob = await canvasToBlob(c, 'image/jpeg', 0.92);
    freeCanvas(c);
  } catch (e) { toast(`Could not capture the frame: ${e.message || e}`, 'err'); return; }
  const pic = { id: uid('i'), t, w, h: hh, caption: '', shapes: [], rev: uid('r') };
  try { await Store.putBlob('p:' + pic.id, blob); } catch (e) { toast(storageErrorText(e), 'err'); return; }
  E.P.picIds.push(pic.id);
  pushUndo();
  st.pictures.push(pic);
  st.pictures.sort((a, b) => a.t - b.t);
  E.sel = st.id;
  changed();
  openPicEditor(st, pic, true);
}
function openPicEditor(st, pic, fresh) {
  const i = stepIndex(st.id);
  const k = st.pictures.indexOf(pic);
  PicEditor.open(pic, {
    title: `Step ${i + 1} · picture ${k + 1}`,
    fresh,
    onDone(res) {
      if (!res) return;
      pushUndo();
      pic.shapes = res.shapes;
      pic.caption = res.caption;
      pic.rev = uid('r');
      changed();
    },
    onDelete() {
      pushUndo();
      st.pictures = st.pictures.filter((p) => p !== pic);
      changed();
      toast('Picture deleted · Undo brings it back', '', 2400);
    },
  });
}

/* ---------- guide info, hand-over + misc ---------- */
function fillGuideFields() {
  $('#g-title').value = E.P.title || '';
  $('#g-author').value = E.P.author || '';
  $('#g-intro').value = E.P.intro || '';
  $('#g-tools').value = E.P.tools || '';
}
function renderHandover() {
  if (!E.P) return;
  const hist = (E.P.history || []).slice(-8).reverse();
  setKids($('#handover'),
    h('h3', { class: 'label' }, 'Hand over'),
    h('p', { class: 'hint' }, `With an edit file someone else can continue editing this guide in Fixframe. ${TEXTS.editFile} Send the video along with it.`),
    h('button', { class: 'btn', type: 'button', id: 'btn-edit-file', onClick: () => Exporter.open('edit') }, icon('editfile'), 'Create edit file'),
    hist.length ? h('h3', { class: 'label' }, 'History') : null,
    hist.length ? h('ul', { class: 'history' }, hist.map((e) => h('li', null, h('span', null, historyText(e)), h('small', null, fmtDate(e.at))))) : null);
}
function selectTab(name) {
  $('#tab-steps').setAttribute('aria-selected', String(name === 'steps'));
  $('#tab-guide').setAttribute('aria-selected', String(name === 'guide'));
  $('#panel-steps').hidden = name !== 'steps';
  $('#panel-guide').hidden = name !== 'guide';
}
async function renameGuide() {
  const v = await askText({ title: 'Guide title', value: E.P.title || '', placeholder: 'e.g. Replace the brake pads' });
  if (v == null) return;
  E.P.title = v.trim() || 'Untitled guide';
  $('#ed-title').textContent = E.P.title;
  $('#g-title').value = E.P.title;
  saveSoon();
}
/* Preview strips: the video on screen first (shown while it builds), then the guide's other videos. */
async function buildAllThumbs() {
  const job = ++E.thumbJob;
  const P = E.P;
  const strip = $('#tl-thumbs');
  const active = activeSrc();
  if (!active) return;
  strip.classList.toggle('loading', !(active.thumbs && active.thumbs.length));
  const order = [active].concat(P.videos.filter((v) => v.id !== active.id));
  for (const s of order) {
    if (s.thumbs && s.thumbs.length) continue;
    const live = s.id === E.src;
    const list = [];
    let finished = false;
    try {
      const out = await makeThumbs(E.urls[s.id], s.duration, (item, i, n) => {
        if (job !== E.thumbJob) return;
        item.span = s.duration / n;
        list.push(item);
        if (live) {
          E.thumbs = list.slice();
          if (i === 0) strip.classList.remove('loading');
          TL.renderThumbs();
        }
      }, () => job !== E.thumbJob);
      finished = !!out;
    } catch (e) { /* the preview strip is optional */ }
    if (job !== E.thumbJob || E.P !== P) return;
    if (live) strip.classList.remove('loading');
    if (finished && list.length) {
      s.thumbs = list;
      if (live) { E.thumbs = list; TL.renderThumbs(); }
      refreshStepThumbs();
      saveSoon();
    }
  }
}
function updateStageHeight() {
  const s = $('#stage');
  if (s) document.documentElement.style.setProperty('--stage-h', `${s.offsetHeight}px`);
}
