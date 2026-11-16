/* ============================================================================================================
   document-data.js
   What it does:    Collects what PDF and Word need: the marked-up pictures of each step, a cover picture, company
                   and contact.
   Change here:     Rarely.
   Edit with care: change texts and values, not the structure.
   Technical note:  Shared document data: marked-up pictures per step, an automatic frame for steps without
                   pictures, and a clean still of the first step for the cover (the "product as hero" of the export
                   design).
   ============================================================================================================ */
async function collectDocData(P, urls, opts, onProgress, signal) {
  const steps = usableSteps(P);
  const total = steps.reduce((a, o) => a + Math.max(1, o.s.pictures.length), 0) + 1 || 1;
  const maxSide = opts.maxSide || 1600;
  const L = xl();
  let done = 0;
  let hv = null;
  let hvUrl = '';
  const tick = () => { done++; if (onProgress) onProgress(done, total); };
  const out = {
    title: P.title || L.guide,
    author: P.author || '',
    intro: P.intro || '',
    tools: lines(P.tools),
    date: new Date(),
    safety: opts.safety ? lines(Brand.cfg.safetyText) : [],
    steps: [],
    hero: null,
    company: xCompany(), claim: xClaim(), contact: xContactLines(),
  };
  const frameAt = async (url, t) => {
    if (url !== hvUrl) {
      if (hv) disposeVideo(hv);
      hvUrl = url;
      hv = createVideo(hvUrl);
      await videoReady(hv);
      await ensureFrameData(hv);
    }
    await seekTo(hv, t);
    return frameCanvas(hv, maxSide);
  };
  try {
    if (steps.length && urls[steps[0].s.src]) {
      try {
        const o = steps[0];
        const c = await frameAt(urls[o.s.src], o.start + (o.end - o.start) * 0.35);
        out.hero = { blob: await canvasToBlob(c, 'image/jpeg', 0.86), w: c.width, h: c.height };
        freeCanvas(c);
      } catch (e) { out.hero = null; }
    }
    tick();
    for (let i = 0; i < steps.length; i++) {
      if (signal && signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const o = steps[i];
      const st = o.s;
      const images = [];
      for (const pic of st.pictures) {
        const c = await picComposite(pic, maxSide);
        if (c) {
          if (opts.watermark) drawWatermark(c.getContext('2d'), c.width, c.height);
          const blob = await canvasToBlob(c, 'image/jpeg', 0.86);
          images.push({ blob, w: c.width, h: c.height, caption: pic.caption || '' });
          freeCanvas(c);
        }
        tick();
      }
      if (!images.length) {
        if (opts.autoPictures && urls[st.src]) {
          const c = await frameAt(urls[st.src], (o.start + o.end) / 2);
          if (opts.watermark) drawWatermark(c.getContext('2d'), c.width, c.height);
          const blob = await canvasToBlob(c, 'image/jpeg', 0.86);
          images.push({ blob, w: c.width, h: c.height, caption: '', auto: true });
          freeCanvas(c);
        }
        tick();
      }
      out.steps.push({
        n: i + 1, title: st.title || `${L.step} ${i + 1}`, desc: st.desc || '', caution: st.caution || '',
        images, start: o.start, end: o.end, speed: st.speed || 1, src: st,
      });
    }
  } finally { if (hv) disposeVideo(hv); }
  return out;
}
function longDate(d) { return xDate(d); }
/* The brand logo as a canvas (for PDF and Word headers), or null. */
function logoCanvas(maxSide = 480) {
  const img = Brand.logo;
  if (!img || !img.width || !img.height) return null;
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  const c = makeCanvas(Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k)));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}
