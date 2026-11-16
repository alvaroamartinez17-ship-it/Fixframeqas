/* ============================================================================================================
   qr-transfer.js
   What it does:    Edit data by QR code: the screen that shows the codes and the camera screen that reads them.
                   Speed and size are in settings.js.
   Change here:     Texts on those screens; timing and code size in settings.js.
   Edit with care: change texts and values, not the structure.
   Technical note:  Edit data by QR code: one device shows the codes, the other reads them with its camera (phone
                   or laptop, either way). The codes carry the edit file without its preview pictures, compressed.
                   The videos do not fit into QR codes and are chosen on the receiving device as with an edit file.
                   The camera picture is read in this browser to find the code.
   ============================================================================================================ */
const QRX = {
  PART_BYTES: QR_SETTINGS.bytesPerCode,
  PREFIX: 'FX1:',
  async compress(u8) {
    if (typeof CompressionStream === 'undefined') return null;
    try { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); } catch (e) { return null; }
  },
  async inflate(u8) {
    return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  },
  /* The texts of all codes for a guide: "FX1:<Z|R><id>:<n>:<total>:<base45 data>". */
  async pack(P) {
    const ef = buildEditFile(P);
    delete ef.note;
    for (const v of ef.guide.videos) v.preview = '';
    const raw = new TextEncoder().encode(JSON.stringify(ef));
    const z = await this.compress(raw);
    const flag = z && z.length < raw.length ? 'Z' : 'R';
    const bytes = flag === 'Z' ? z : raw;
    const id = Math.floor(Math.random() * 36 ** 4).toString(36).toUpperCase().padStart(4, '0');
    const n = Math.max(1, Math.ceil(bytes.length / this.PART_BYTES));
    const parts = [];
    for (let i = 0; i < n; i++) parts.push(`${this.PREFIX}${flag}${id}:${i + 1}:${n}:${base45Encode(bytes.subarray(i * this.PART_BYTES, (i + 1) * this.PART_BYTES))}`);
    return { parts, bytes: bytes.length, raw: raw.length };
  },
  parse(text) {
    const m = /^FX1:([ZR])([0-9A-Z]{4}):(\d{1,3}):(\d{1,3}):([0-9A-Z $%*+\-./:]*)$/.exec(text || '');
    if (!m) return null;
    const i = +m[3];
    const n = +m[4];
    if (!n || i < 1 || i > n) return null;
    try { return { flag: m[1], id: m[2], i, n, data: base45Decode(m[5]) }; } catch (e) { return null; }
  },
  async unpack(flag, chunks) {
    const len = chunks.reduce((a, c) => a + c.length, 0);
    const all = new Uint8Array(len);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    const bytes = flag === 'Z' ? await this.inflate(all) : all;
    return new TextDecoder().decode(bytes);
  },
};

/* Shows the codes one after another (a short guide needs one code). */
async function showEditQr() {
  const P = E.P;
  if (!P) return;
  let pack;
  try { pack = await QRX.pack(P); } catch (e) { toast('The QR code could not be made.', 'err'); return; }
  window.__ffQrParts = pack.parts;
  const codes = pack.parts.map((t) => QR.encode(t, 'M'));
  const canvas = h('canvas', { class: 'qr-canvas', id: 'qr-canvas', 'aria-label': 'QR code with the edit data' });
  const label = h('div', { class: 'qr-count', id: 'qr-count' });
  const dots = h('div', { class: 'qr-dots', 'aria-hidden': 'true' }, codes.map(() => h('span')));
  let i = 0;
  let paused = false;
  let timer = 0;
  const draw = () => {
    const q = codes[i];
    QR.toCanvas(q, Math.max(4, Math.floor(720 / (q.size + 8))), canvas);
    label.textContent = codes.length > 1 ? `Code ${i + 1} of ${codes.length}` : 'One code';
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
    canvas.dataset.part = String(i + 1);
  };
  const tick = () => {
    clearTimeout(timer);
    if (!paused && codes.length > 1) timer = setTimeout(() => { i = (i + 1) % codes.length; draw(); tick(); }, QR_SETTINGS.secondsPerCode * 1000);
  };
  const pauseBtn = h('button', { class: 'btn small', type: 'button', id: 'qr-pause', onClick: () => {
    paused = !paused;
    pauseBtn.replaceChildren(icon(paused ? 'play' : 'pause'), paused ? 'Play' : 'Pause');
    tick();
  } }, icon('pause'), 'Pause');
  const step = (d) => { paused = true; pauseBtn.replaceChildren(icon('play'), 'Play'); i = (i + d + codes.length) % codes.length; draw(); tick(); };
  let wake = null;
  try { if (navigator.wakeLock && navigator.wakeLock.request) wake = await navigator.wakeLock.request('screen'); } catch (e) { /* optional */ }
  const body = h('div', { class: 'dlg qr-show' },
    h('div', { class: 'qr-frame' }, canvas),
    h('div', { class: 'qr-nav' },
      codes.length > 1 ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous code', onClick: () => step(-1) }, icon('back')) : null,
      label,
      codes.length > 1 ? h('button', { class: 'icon-btn flip', type: 'button', 'aria-label': 'Next code', onClick: () => step(1) }, icon('back')) : null),
    codes.length > 1 ? dots : null,
    codes.length > 1 ? h('div', { class: 'row center' }, pauseBtn) : null,
    h('ol', { class: 'qr-steps' },
      h('li', null, 'On the other device, open Fixframe and tap ', h('b', null, 'Scan QR code'), ' on the start screen.'),
      h('li', null, 'Hold its camera 20–40 cm in front of this screen until all codes are read.'),
      h('li', null, P.videos.length > 1 ? 'Send the videos separately (AirDrop, cable or a cloud folder). The other device asks for them: ' : 'Send the video separately (AirDrop, cable or a cloud folder). The other device asks for it: ',
        P.videos.map((v, k) => h('b', null, (k ? ', ' : '') + v.name)), '.')),
    h('p', { class: 'hint' }, `${plural(P.steps.length, 'step')} · ${codes.length > 1 ? `${codes.length} codes` : 'one code'} · ${fmtBytes(pack.bytes)}. The codes hold the cuts, texts and picture markup, not the video.`));
  draw();
  tick();
  const mm = Modal.open(body, { full: true, title: 'Edit data as QR code', onClose: () => { clearTimeout(timer); if (wake) wake.release().catch(() => {}); } });
  mm.sheet.classList.add('qr-sheet');
}

/* Reads the codes with the camera and opens the edit data like an edit file. */
async function scanEditQr() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast(window.isSecureContext === false ? 'The camera works only when Fixframe is opened from its https address.' : 'This browser cannot use the camera.', 'err', 7000);
    return;
  }
  const video = h('video', { class: 'qr-video', id: 'qr-video', playsinline: true, muted: true, autoplay: true });
  video.muted = true;
  video.setAttribute('playsinline', '');
  const status = h('p', { class: 'qr-status', id: 'qr-status' }, 'Starting the camera…');
  const got = h('div', { class: 'qr-got', id: 'qr-got' });
  const switchBtn = h('button', { class: 'btn small', type: 'button', id: 'qr-switch', hidden: true }, icon('refresh'), 'Switch camera');
  const body = h('div', { class: 'dlg qr-scan' },
    h('div', { class: 'qr-view' }, video, h('div', { class: 'qr-aim', 'aria-hidden': 'true' })),
    status, got,
    h('div', { class: 'row center' }, switchBtn),
    h('p', { class: 'hint' }, 'On the other device: open the guide, tap Export, then Edit file and “Show as QR code”. The camera picture is read in this browser to find the code.'));
  let stream = null;
  let stopped = false;
  let timer = 0;
  let cams = [];
  let camIdx = -1;
  const sess = { id: '', flag: '', n: 0, parts: new Map() };
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
  };
  const m = Modal.open(body, { full: true, title: 'Scan QR code', onClose: stop });
  m.sheet.classList.add('qr-sheet');
  const drawGot = () => {
    if (!sess.n) { got.replaceChildren(); return; }
    got.replaceChildren(
      h('div', { class: 'qr-dots big' }, Array.from({ length: sess.n }, (_, k) => h('span', { class: sess.parts.has(k + 1) ? 'on' : '' }))),
      h('span', null, sess.n > 1 ? `${sess.parts.size} of ${sess.n} codes read` : 'Code read'));
  };
  const start = async (deviceId) => {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    const video0 = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } };
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: Object.assign(video0, { width: { ideal: 1280 }, height: { ideal: 720 } }) });
    if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
    video.srcObject = stream;
    await video.play().catch(() => {});
    const track = stream.getVideoTracks()[0];
    const set = track && track.getSettings ? track.getSettings() : {};
    // a laptop's front camera is shown like a mirror, so moving the code feels natural
    video.classList.toggle('mirror', set.facingMode === 'user' || (!set.facingMode && !IS_IOS && !IS_ANDROID));
    try {
      cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      camIdx = Math.max(0, cams.findIndex((d) => d.deviceId === set.deviceId));
    } catch (e) { cams = []; }
    switchBtn.hidden = cams.length < 2;
    status.textContent = 'Point the camera at the QR code on the other device.';
  };
  switchBtn.addEventListener('click', () => {
    if (cams.length < 2) return;
    camIdx = (camIdx + 1) % cams.length;
    start(cams[camIdx].deviceId).catch(() => toast('This camera cannot be used.', 'err'));
  });
  try { await start(); } catch (e) {
    const name = e && e.name;
    status.textContent = name === 'NotAllowedError' || name === 'SecurityError'
      ? 'Fixframe may not use the camera. Allow the camera for this app in the browser or phone settings, then try again.'
      : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'No camera was found on this device.' : 'The camera could not be started.';
    status.classList.add('err');
    return;
  }
  let detector = null;
  try {
    if ('BarcodeDetector' in window && !window.__ffNoNativeQr) {
      const fmts = await window.BarcodeDetector.getSupportedFormats();
      if (fmts.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    }
  } catch (e) { detector = null; }
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  let foreign = 0;
  const handle = async (text) => {
    const p = QRX.parse(text);
    if (!p) {
      if (text && ++foreign > 2) status.textContent = 'This QR code is not from Fixframe. Show “Edit data as QR code” on the other device.';
      return false;
    }
    if (p.id !== sess.id) { sess.id = p.id; sess.flag = p.flag; sess.n = p.n; sess.parts = new Map(); }
    if (!sess.parts.has(p.i)) {
      sess.parts.set(p.i, p.data);
      if (navigator.vibrate) { try { navigator.vibrate(30); } catch (e) { /* optional */ } }
    }
    drawGot();
    status.textContent = sess.parts.size < sess.n ? 'Keep the camera on the codes…' : 'All codes read.';
    if (sess.parts.size < sess.n) return false;
    const chunks = [];
    for (let k = 1; k <= sess.n; k++) chunks.push(sess.parts.get(k));
    let json;
    try { json = await QRX.unpack(sess.flag, chunks); } catch (e) {
      sess.id = ''; sess.parts = new Map();
      status.textContent = 'The codes could not be put together. Scanning again…';
      return false;
    }
    stop();
    m.close();
    window.__ffLastQrJson = json;
    const file = new File([json], 'qr-code.fixframe.json', { type: 'application/json' });
    openEditFileFlow(file);
    return true;
  };
  const loop = async () => {
    if (stopped) return;
    let t0 = performance.now();
    try {
      if (video.readyState >= 2 && video.videoWidth) {
        const texts = [];
        if (detector) {
          const res = await detector.detect(video).catch(() => []);
          for (const r of res) texts.push(r.rawValue);
        }
        if (!texts.length) {
          const k = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
          const w = Math.round(video.videoWidth * k);
          const hh = Math.round(video.videoHeight * k);
          if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; }
          ctx.drawImage(video, 0, 0, w, hh);
          const d = ctx.getImageData(0, 0, w, hh).data;
          const g = new Uint8Array(w * hh);
          for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
          const t = QR.decode(g, w, hh);
          if (t) texts.push(t);
        }
        for (const t of texts) if (await handle(t)) return;
      }
    } catch (e) { /* next frame */ }
    if (!stopped) timer = setTimeout(loop, Math.max(30, 140 - (performance.now() - t0)));
  };
  loop();
}
