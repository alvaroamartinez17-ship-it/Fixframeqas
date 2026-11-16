/* ============================================================================================================
   export-screen.js
   What it does:    The export screen: format buttons, options, progress with the animation, result with
                   Save/Share. Formats and options themselves are in settings.js.
   Change here:     Texts on that screen; the options are in settings.js.
   Safe to edit texts here.
   Technical note:  Export screen: format choice, options, progress, and saving or sharing the result.
   ============================================================================================================ */
// The formats (FORMATS), their starting options (EX_DEFAULTS) and the choices offered (EX_SCHEMA) are in settings.js.

const Exporter = {
  cur: 'mp4',
  init() {
    $('#ex-close').addEventListener('click', () => this.close());
    $('#ex-go').addEventListener('click', () => this.run());
    $('#ex-cancel').addEventListener('click', () => { if (this.ac) this.ac.abort(); });
    $('#ex-save').addEventListener('click', () => { if (this.result) saveFile(this.result.blob, this.result.name, E.P ? E.P.title : ''); });
    $('#ex-share').addEventListener('click', () => { if (this.result) shareFile(this.result.blob, this.result.name, E.P ? E.P.title : ''); });
    $('#ex-again').addEventListener('click', () => this.showForm());
    $('#ex-edit').addEventListener('click', () => { this.cur = 'edit'; this.run(); });
    $('#ex-brand').addEventListener('click', () => openBrandSettings(() => { if (!$('#ex-body').hidden) this.renderForm(); }));
  },
  opts() {
    // Fill missing defaults in place: option buttons keep references to these objects.
    const P = E.P;
    if (!P.ex) P.ex = { fmt: 'mp4' };
    for (const k of Object.keys(EX_DEFAULTS)) {
      if (k === 'fmt') continue;
      if (!P.ex[k] || typeof P.ex[k] !== 'object') P.ex[k] = {};
      for (const [kk, vv] of Object.entries(EX_DEFAULTS[k])) if (!(kk in P.ex[k])) P.ex[k][kk] = vv;
    }
    if (!P.ex.fmt || !EX_DEFAULTS[P.ex.fmt] || !FORMATS.some((f) => f.id === P.ex.fmt)) P.ex.fmt = 'mp4'; // older guides may still say GIF or HTML (removed in 1.5.7)
    return P.ex;
  },
  open(fmt) {
    if (!E.P) return;
    Play.stop();
    if (!usableSteps(E.P).length) { toast('Add at least one step before exporting.'); return; }
    const ex = this.opts();
    this.cur = fmt && FORMATS.some((f) => f.id === fmt) ? fmt : ex.fmt; // the edit file is never remembered as the usual format
    $('#exporter').hidden = false;
    document.body.style.overflow = 'hidden';
    Nav.push('exporter', () => this.close(true));
    this.showForm();
    loadSoundPacks().then(() => { if (!$('#exporter').hidden && !$('#ex-body').hidden && !this.running) this.renderForm(); });
  },
  close(fromHistory) {
    if (this.running) {
      ask({ title: 'Stop the export?', message: 'The file is not finished yet.', ok: 'Stop export', danger: true, cancel: 'Keep going' })
        .then((ok) => { if (ok && this.ac) { this.ac.abort(); this.pendingClose = true; } else if (fromHistory) Nav.push('exporter', () => this.close(true)); });
      return;
    }
    if (!fromHistory) Nav.pop('exporter');
    this.clearResult();
    $('#exporter').hidden = true;
    document.body.style.overflow = '';
    saveSoon();
  },
  showForm() {
    this.clearResult();
    $('#ex-body').hidden = false;
    $('#ex-progress').hidden = true;
    $('#ex-result').hidden = true;
    this.renderForm();
  },
  renderForm() {
    const ex = this.opts();
    const fmt = this.cur;
    const grid = $('#fmt-grid');
    grid.textContent = '';
    FORMATS.forEach((f) => grid.append(h('button', {
      type: 'button', class: 'fmt', role: 'radio', 'aria-checked': String(fmt === f.id), 'data-fmt': f.id,
      onClick: () => { this.cur = f.id; if (f.id !== 'edit') ex.fmt = f.id; this.renderForm(); },
    }, icon(f.icon), h('b', null, f.name), h('small', null, f.desc))));
    const o = ex[fmt] || {};
    const box = $('#ex-opts');
    box.textContent = '';
    for (const row of EX_SCHEMA[fmt]) {
      if (row.need && !Brand.has(row.need)) continue;
      const off = row.dep && !o[row.dep];
      let ctl;
      if (row.seg) {
        ctl = h('div', { class: 'seg', role: 'group', 'aria-label': row.label },
          (typeof row.seg === 'function' ? row.seg() : row.seg).map(([v, l]) => h('button', {
            type: 'button', 'aria-pressed': String(String(o[row.k]) === v), disabled: off,
            onClick: () => { o[row.k] = v; this.renderForm(); },
          }, l)));
      } else {
        ctl = h('input', { type: 'checkbox', class: 'toggle', role: 'switch', id: `ex-${fmt}-${row.k}`, 'aria-label': row.label, checked: !!o[row.k] });
        ctl.addEventListener('change', () => { o[row.k] = ctl.checked; this.renderForm(); });
      }
      box.append(h('div', { class: `opt${off ? ' is-off' : ''}` }, h('span', null, row.label), ctl));
    }
    box.hidden = !box.children.length;
    $('#ex-brand').hidden = fmt === 'edit';
    $('#ex-summary').textContent = this.summary();
    $('#ex-go').textContent = fmt === 'edit' ? 'Create edit file' : `Create ${FORMATS.find((f) => f.id === fmt).name.replace(' (MP4)', '')}`;
  },
  segOpts(o) {
    return { intro: o.intro, stepCards: o.stepCards, pictures: o.pictures, picDur: +o.picDur, brandIntro: o.brandIntro, safety: o.safety, brandOutro: o.brandOutro };
  },
  /* "Original" frame means the shape of the guide's first video; other videos are fitted into it. */
  videoSize(o) {
    const first = E.P.videos[0] || {};
    const sw = first.width || vid().videoWidth || 1280;
    const sh = first.height || vid().videoHeight || 720;
    return outputSize(sw, sh, o.aspect, +o.res);
  },
  summary() {
    const ex = this.opts();
    const fmt = this.cur;
    const o = ex[fmt] || {};
    const steps = usableSteps(E.P);
    const nPics = steps.reduce((a, s) => a + s.s.pictures.length, 0);
    if (fmt === 'mp4') {
      const { total } = buildSegments(E.P, this.segOpts(o), E.urls);
      const { W, H } = this.videoSize(o);
      return `Length ${fmtTime(Math.round(total), false)} · ${W} × ${H} · ${o.fps} fps${o.sound ? ' · with sound' : ''}` + Access.exportNote();
    }
    if (fmt === 'edit') {
      const all = E.P.steps;
      const pics = all.reduce((a, s) => a + s.pictures.length, 0);
      return `${plural(all.length, 'step')} · ${plural(pics, 'picture')} · ${plural(E.P.videos.length, 'video')} to send along${App.cfg.userName ? ` · by ${App.cfg.userName}` : ''}`;
    }
    const base = `${plural(steps.length, 'step')} · ${plural(nPics, 'marked-up picture')}`;
    return `${base} · ${o.paper === 'letter' ? 'Letter' : 'A4'}`;
  },
  progress(title, sub, frac) {
    $('#ex-prog-title').textContent = title;
    $('#ex-prog-sub').textContent = sub || '';
    const pct = Math.round(clamp(frac || 0, 0, 1) * 100);
    $('#ex-bar').style.width = `${pct}%`;
    $('#ex-bar-wrap').setAttribute('aria-valuenow', String(pct));
  },
  progressFn(title, unit) {
    return (done, total, ms) => {
      let eta = '';
      if (ms != null && done > 4 && done < total) {
        const left = ((ms / done) * (total - done)) / 1000;
        eta = ` · about ${left < 60 ? `${Math.max(1, Math.round(left))} s` : `${Math.round(left / 60)} min`} left`;
      }
      this.progress(title, `${unit} ${fmtCount(Math.min(done, total))} of ${fmtCount(total)}${eta}`, total ? done / total : 0);
    };
  },
  /* The edit file: all cuts, texts and markup as JSON, with the name of who made it. */
  async runEdit() {
    if (this.running) return;
    if (!(await ensureUserName())) return;
    const P = E.P;
    await ensurePreviews(P, E.urls);
    addHistory(P, 'exported');
    await saveNow();
    const blob = new Blob([JSON.stringify(buildEditFile(P), null, 2)], { type: 'application/json' });
    renderHandover();
    this.showResult(blob, safeFileName(P.title, 'fixframe.json'), 'edit');
  },
  async run() {
    if (this.running) return;
    const ex = this.opts();
    const fmt = this.cur;
    if (fmt === 'edit') { await this.runEdit(); return; }
    if (Access.isVideo(fmt) && !(await Access.allowVideoExport())) { this.renderForm(); return; }
    const o = ex[fmt];
    saveSoon();
    this.running = true;
    this.pendingClose = false;
    this.ac = new AbortController();
    const signal = this.ac.signal;
    $('#ex-body').hidden = true;
    $('#ex-result').hidden = true;
    $('#ex-progress').hidden = false;
    this.progress('Getting ready…', '', 0);
    await Brand.prepareClips();
    const wm = !!o.watermark && Brand.has('logo');
    this.wm = wm;
    this.fast = o.fast !== false;
    FastFrames.note = '';
    FastFrames.used = 0;
    let wake = null;
    try { if (navigator.wakeLock && navigator.wakeLock.request) wake = await navigator.wakeLock.request('screen'); } catch (e) { /* optional */ }
    try {
      let blob;
      let ext = fmt;
      if (fmt === 'mp4') {
        const { W, H } = this.videoSize(o);
        const fps = +o.fps;
        const { segs, total, nSteps } = buildSegments(E.P, this.segOpts(o), E.urls);
        const pick = await pickVideoSink(W, H, fps, Math.round(W * H * fps * (+o.res >= 1080 ? 0.11 : 0.13)));
        if (!pick) throw new Error('This browser cannot create video files. Try the latest Safari or Chrome.');
        if (pick.note) toast(pick.note, '', 6000);
        ext = pick.ext;
        blob = await renderTimeline({
          P: E.P, segs, total, nSteps, W, H, fps, sink: pick.sink,
          opts: { captions: o.captions, fades: o.fades, watermark: wm, fast: o.fast !== false },
          onProgress: this.progressFn('Rendering video…', 'Frame'),
          signal,
        });
        // "Add sound": music under the finished video (only for the MP4 writer, not for real-time recordings)
        if (o.sound && ext === 'mp4' && pick.sink instanceof Mp4Sink) {
          try {
            blob = await addSoundToVideo(blob, soundPlan(segs, total, o), (frac, text) => this.progress(text, '', frac), signal);
          } catch (e) {
            if (e && e.name === 'AbortError') throw e;
            console.error(e);
            toast(`The video is ready, but without sound: ${(e && e.message) || e}.`, 'err', 9000);
          }
        } else if (o.sound) {
          toast('This browser cannot add sound to the video, so it is ready without sound.', '', 7000);
        }
      } else {
        const data = await collectDocData(E.P, E.urls, { autoPictures: o.autoPictures, maxSide: 1600, watermark: wm, safety: o.safety },
          this.progressFn('Preparing pictures…', 'Picture'), signal);
        if (fmt === 'pdf') { this.progress('Writing PDF…', '', 1); blob = await buildPdf(data, { paper: o.paper }); }
        else { this.progress('Writing Word file…', '', 1); blob = await buildDocx(data, { paper: o.paper }); }
      }
      this.running = false;
      if (Access.isVideo(fmt)) await Access.countVideoExport();
      if (this.pendingClose) { this.close(); return; }
      this.showResult(blob, safeFileName(E.P.title, ext), fmt);
      if (FastFrames.note) toast('Fast rendering did not give the right pictures for a video on this device, so Fixframe read it the careful way. That takes longer.', '', 9000);
    } catch (e) {
      this.running = false;
      if (e && e.name === 'AbortError') {
        toast('Export stopped');
        if (this.pendingClose) { this.close(); return; }
      } else {
        console.error(e);
        toast(`Export failed: ${(e && e.message) || e}`, 'err', 7000);
      }
      this.showForm();
    } finally {
      this.running = false;
      try { if (wake) await wake.release(); } catch (e) { /* ignore */ }
    }
  },
  clearResult() {
    if (this.previewUrl) { URL.revokeObjectURL(this.previewUrl); this.previewUrl = null; }
    $('#ex-preview').textContent = '';
    $('#ex-extra').textContent = '';
    $('#ex-extra').hidden = true;
  },
  showResult(blob, name, fmt) {
    this.clearResult();
    this.result = { blob, name, fmt };
    window.__ffLastExport = this.result;
    $('#ex-progress').hidden = true;
    $('#ex-body').hidden = true;
    $('#ex-result').hidden = false;
    const pv = $('#ex-preview');
    if (fmt === 'mp4') {
      this.previewUrl = URL.createObjectURL(blob);
      pv.append(h('video', { src: this.previewUrl, controls: true, playsinline: true }));
    } else {
      const f = FORMATS.find((x) => x.id === fmt);
      pv.append(h('div', { class: 'ex-doc' }, icon(f.icon), h('span', null, `${f.name} ready`)));
    }
    $('#ex-file').replaceChildren(h('b', null, name), h('span', null, `${fmtBytes(blob.size)} · created locally`));
    $('#ex-edit').hidden = fmt === 'edit';
    if (fmt === 'edit') this.showVideosToSend();
    const share = $('#ex-share');
    const save = $('#ex-save');
    const canShare = !IS_FRAMED && canShareFile(blob, name);
    DownloadsCap.get().then((dl) => {
      if (dl) setSaveLabel('Save file');
      else if (IS_IOS && canShare) setSaveLabel('Save or share…');
      else setSaveLabel(IS_ANDROID ? 'Save to phone' : 'Download');
      share.hidden = !canShare || (IS_IOS && !dl);
    });
    function setSaveLabel(t) {
      const ico = save.querySelector('.ico');
      save.replaceChildren(...(ico ? [ico] : []), document.createTextNode(t));
    }
  },
  /* The edit file is only useful together with the video(s): list them, with a way to get each file out. */
  showVideosToSend() {
    const P = E.P;
    const box = $('#ex-extra');
    box.hidden = false;
    setKids(box,
      h('button', { class: 'btn wide', type: 'button', id: 'ex-qr', onClick: () => showEditQr() }, icon('qr'), 'Show as QR code'),
      h('p', { class: 'hint' }, 'For a phone or laptop with a camera nearby: the other device scans the code instead of receiving the file.'),
      h('p', { class: 'hint' }, TEXTS.editFile.replace(/^It /, 'The edit file ')),
      h('h3', { class: 'label' }, P.videos.length > 1 ? 'Send these videos with it' : 'Send this video with it'),
      P.videos.map((s, i) => {
        const b = h('button', { class: 'btn small', type: 'button', 'aria-label': `Save video ${i + 1}` }, icon('download'), 'Save');
        b.addEventListener('click', async () => {
          const blob = await Store.getBlob(s.key).catch(() => null);
          if (!blob) { toast('This video is missing from storage.', 'err'); return; }
          saveFile(blob, videoFileName(s), P.title);
        });
        return h('div', { class: 'ex-vid' },
          h('b', null, String(i + 1)),
          h('span', { class: 'ex-vid-meta' }, h('span', null, s.name), h('small', null, `${fmtDur(s.duration)} · ${fmtBytes(s.size)}`)),
          b);
      }),
      h('p', { class: 'hint' }, 'The other person taps “Open an edit file” on the Fixframe start screen, picks this file and then the video.'));
  },
};
