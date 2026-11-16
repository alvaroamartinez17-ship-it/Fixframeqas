/* ============================================================================================================
   video-files.js
   What it does:    Opens a video in the background, jumps to an exact frame, takes a still picture, makes the
                   small preview strip.
   Change here:     Nothing.
   Engine room: better leave it as it is.
   Technical note:  Video helpers: hidden decoders, frame-accurate seeking, frame capture, preview strip.
   ============================================================================================================ */
function createVideo(src) {
  const v = document.createElement('video');
  v.muted = true;
  v.defaultMuted = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  v.setAttribute('muted', '');
  v.preload = 'auto';
  v.className = 'offscreen-video';
  document.body.appendChild(v);
  v.src = src;
  return v;
}
function disposeVideo(v) {
  if (!v) return;
  try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { /* ignore */ }
  v.remove();
}
function waitFor(target, okEvent, badEvent, ms) {
  return new Promise((resolve, reject) => {
    let timer = 0;
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(okEvent, onOk);
      if (badEvent) target.removeEventListener(badEvent, onBad);
    };
    const onOk = () => { cleanup(); resolve(); };
    const onBad = () => { cleanup(); reject(target.error || new Error(badEvent)); };
    target.addEventListener(okEvent, onOk);
    if (badEvent) target.addEventListener(badEvent, onBad);
    if (ms) timer = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for ' + okEvent)); }, ms);
  });
}
async function videoReady(v, ms = 20000) {
  if (v.error) throw v.error;
  if (!(v.readyState >= 1)) await waitFor(v, 'loadedmetadata', 'error', ms);
  if (!isFinite(v.duration) || !v.duration) {
    // Some recordings report an unknown duration until the end has been read.
    const p = waitFor(v, 'durationchange', null, 6000).catch(() => {});
    v.currentTime = 1e7;
    await p;
    v.currentTime = 0;
    await waitFor(v, 'seeked', null, 6000).catch(() => {});
  }
  if (!v.videoWidth) await waitFor(v, 'resize', null, 3000).catch(() => {});
}
async function ensureFrameData(v) {
  if (v.readyState >= 2) return;
  await waitFor(v, 'loadeddata', 'error', 10000).catch(() => {});
}
async function probeVideo(url) {
  const v = createVideo(url);
  try {
    await videoReady(v);
    if (!v.videoWidth || !isFinite(v.duration) || v.duration <= 0) throw new Error('No playable video track');
    return { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
  } finally { disposeVideo(v); }
}

const SeekTuning = { useRVFC: true, misses: 0 };
function seekTo(v, t) {
  const dur = isFinite(v.duration) ? v.duration : t + 1;
  t = clamp(t, 0, Math.max(0, dur - 0.001));
  return new Promise((resolve) => {
    let finished = false;
    let guard = 0;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(guard);
      v.removeEventListener('seeked', onSeeked);
      resolve();
    };
    const onSeeked = () => {
      // Wait until the new frame is actually presented, so drawImage() does not grab the old one.
      if (SeekTuning.useRVFC && typeof v.requestVideoFrameCallback === 'function') {
        let got = false;
        const tm = setTimeout(() => {
          if (got) return;
          if (++SeekTuning.misses >= 3) SeekTuning.useRVFC = false;
          done();
        }, 120);
        v.requestVideoFrameCallback(() => { got = true; SeekTuning.misses = 0; clearTimeout(tm); done(); });
      } else done();
    };
    guard = setTimeout(done, 6000);
    v.addEventListener('seeked', onSeeked);
    v.currentTime = t;
  });
}
function fitRect(sw, sh, W, H) {
  const s = Math.min(W / sw, H / sh);
  const w = sw * s;
  const hh = sh * s;
  return { x: (W - w) / 2, y: (H - hh) / 2, w, h: hh };
}
function frameCanvas(v, maxSide) {
  const vw = v.videoWidth || 640;
  const vh = v.videoHeight || 360;
  const s = Math.min(1, maxSide / Math.max(vw, vh));
  const c = makeCanvas(vw * s, vh * s);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  return c;
}
async function grabFrameBlob(v, t, maxSide = 1920) {
  await seekTo(v, t);
  const c = frameCanvas(v, maxSide);
  const blob = await canvasToBlob(c, 'image/jpeg', 0.92);
  const out = { blob, w: c.width, h: c.height };
  freeCanvas(c);
  return out;
}
async function makeThumbs(url, duration, onThumb, isCancelled) {
  const v = createVideo(url);
  try {
    await videoReady(v);
    await ensureFrameData(v);
    const n = clamp(Math.round(duration / 2), 8, 48);
    const th = 72;
    const tw = Math.max(32, Math.round(th * (v.videoWidth / v.videoHeight || 16 / 9)));
    const c = makeCanvas(tw, th);
    const ctx = c.getContext('2d');
    const out = [];
    for (let i = 0; i < n; i++) {
      if (isCancelled && isCancelled()) return null;
      const t = ((i + 0.5) * duration) / n;
      await seekTo(v, t);
      ctx.drawImage(v, 0, 0, tw, th);
      const item = { t, src: c.toDataURL('image/jpeg', 0.62) };
      out.push(item);
      if (onThumb) onThumb(item, i, n);
    }
    freeCanvas(c);
    return out;
  } finally { disposeVideo(v); }
}
