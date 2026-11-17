/* ============================================================================================================
   video-render.js
   What it does:    Paints every frame of the exported video: title card, safety card, step cards, captions, speed
                   badge, pictures, logo.
   Change here:     Sizes, margins and the 70/30 split are in settings.js (XV), colours in XT. The layout of a step
                   is in stepLayout, stepPanelItems and drawStepFrame, the opening title in drawIntroCard, safety in drawSafetyCard.
   Edit with care: change texts and values, not the structure.
   Technical note:  Video composition in the export look (settings.js and export-look.js): title, safety and step cards,
                   captions, pictures.
   ============================================================================================================ */
const xf = (weight, size) => `${weight} ${Math.max(1, Math.round(size * 10) / 10)}px ${XF_STACK}`;

function setLetterSpacing(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`; }

function wrapLines(ctx, text, maxW, maxLines = 99) {
  const out = [];
  const paras = String(text == null ? '' : text).replace(/\r/g, '').split('\n');
  for (const para of paras) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = '';
    for (let w of words) {
      while (ctx.measureText(w).width > maxW && w.length > 1) {
        let k = w.length - 1;
        while (k > 1 && ctx.measureText(w.slice(0, k)).width > maxW) k--;
        if (line) { out.push(line); line = ''; }
        out.push(w.slice(0, k));
        w = w.slice(k);
      }
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width <= maxW) line = test;
      else { if (line) out.push(line); line = w; }
    }
    if (line) out.push(line);
  }
  while (out.length > 1 && out[out.length - 1] === '') out.pop();
  while (out.length > 1 && out[0] === '') out.shift();
  if (out.length > maxLines) {
    const cut = out.slice(0, maxLines);
    let last = cut[maxLines - 1];
    while (last && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
    cut[maxLines - 1] = `${(last || '').replace(/\s+$/, '')}…`;
    return cut;
  }
  return out;
}
function ellipsize(ctx, text, maxW) {
  let t = String(text || '');
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t.replace(/\s+$/, '')}…`;
}
/* Baseline that centres capitals in a line box of fs * lh. */
const baseOf = (fs, lh) => (fs * lh) / 2 + fs * 0.36;

function paintCardBg(ctx, W, H) {
  ctx.fillStyle = XT.black;
  ctx.fillRect(0, 0, W, H);
  if (Brand.cfg.cardBg !== 'picture' || !Brand.bg) return;
  const bw = Brand.bg.width;
  const bh = Brand.bg.height;
  const k = Math.max(W / bw, H / bh);
  ctx.drawImage(Brand.bg, (W - bw * k) / 2, (H - bh * k) / 2, bw * k, bh * k);
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(13,13,13,0.62)');
  g.addColorStop(1, 'rgba(13,13,13,0.25)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}
/* Small upper-case label with wide tracking, as above the headlines on the product pages. */
function drawEyebrow(ctx, text, x, baseline, fs, color) {
  ctx.save();
  ctx.font = xf(700, fs);
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  setLetterSpacing(ctx, fs * 0.14);
  ctx.fillText(String(text).toUpperCase(), x, baseline);
  ctx.restore();
}
function eyebrowWidth(ctx, text, fs) {
  ctx.save();
  ctx.font = xf(700, fs);
  setLetterSpacing(ctx, fs * 0.14);
  const w = ctx.measureText(String(text).toUpperCase()).width;
  ctx.restore();
  return w;
}
/* A column of text items (label, headline, paragraph, caution box, list), shrunk together until it fits. */
function measureItems(ctx, items, maxW, k) {
  const out = [];
  let h = 0;
  for (const it of items) {
    const fs = it.size * k;
    const gap = out.length ? (it.gap || 0) * k : 0;
    let o;
    if (it.kind === 'eyebrow' || it.kind === 'speed') o = { lines: [it.text], h: fs * 1.2 };
    else if (it.kind === 'caution') {
      const pad = fs * 0.8;
      const bar = Math.max(3, fs * 0.18);
      const lfs = it.labelSize ? it.labelSize * k : fs * 0.66;
      ctx.font = xf(400, fs);
      const ls = wrapLines(ctx, it.text, maxW - pad * 2 - bar, it.maxLines || 3);
      const tw = Math.max(eyebrowWidth(ctx, it.label, lfs), ...ls.map((l) => { ctx.font = xf(400, fs); return ctx.measureText(l).width; }));
      o = { lines: ls, pad, bar, lfs, w: Math.min(maxW, tw + pad * 2 + bar), h: pad * 2 + lfs * 1.6 + ls.length * fs * it.lh };
    } else if (it.kind === 'list') {
      ctx.font = xf(it.weight, fs);
      const rows = it.items.map((t) => wrapLines(ctx, t, maxW - fs * 1.4, it.maxLines || 3));
      const rowGap = fs * 0.5;
      o = { rows, rowGap, h: rows.reduce((a, r) => a + r.length * fs * it.lh, 0) + rowGap * Math.max(0, rows.length - 1) };
    } else {
      ctx.font = xf(it.weight, fs);
      setLetterSpacing(ctx, it.track ? fs * it.track : 0);
      const ls = wrapLines(ctx, it.text, maxW, it.maxLines || 4);
      setLetterSpacing(ctx, 0);
      o = { lines: ls, h: ls.length * fs * it.lh };
    }
    Object.assign(o, { it, fs, gap });
    out.push(o);
    h += gap + o.h;
  }
  return { out, h };
}
function fitItems(ctx, items, maxW, maxH, minK = 0.5) {
  let k = 1;
  let r = measureItems(ctx, items, maxW, k);
  while (r.h > maxH && k > minK) { k = Math.max(minK, k * 0.96); r = measureItems(ctx, items, maxW, k); }
  return r;
}
function drawItems(ctx, r, x, y) {
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (const o of r.out) {
    y += o.gap;
    const it = o.it;
    const fs = o.fs;
    if (it.kind === 'eyebrow') drawEyebrow(ctx, it.text, x, y + baseOf(fs, 1.2), fs, it.color);
    else if (it.kind === 'speed') {
      // two small triangles, then the label
      const tri = fs * 0.62;
      const cy = y + (fs * 1.2) / 2;
      ctx.fillStyle = it.color;
      for (let q = 0; q < 2; q++) {
        const tx = x + q * tri * 1.08;
        ctx.beginPath(); ctx.moveTo(tx, cy - tri * 0.5); ctx.lineTo(tx + tri, cy); ctx.lineTo(tx, cy + tri * 0.5); ctx.closePath(); ctx.fill();
      }
      drawEyebrow(ctx, it.text, x + tri * 2.2 + fs * 0.5, y + baseOf(fs, 1.2), fs, it.color);
    } else if (it.kind === 'caution') {
      ctx.fillStyle = 'rgba(219,8,18,0.16)';
      ctx.fillRect(x, y, o.w, o.h);
      ctx.fillStyle = XT.caution;
      ctx.fillRect(x, y, o.bar, o.h);
      const tx = x + o.bar + o.pad;
      drawEyebrow(ctx, it.label, tx, y + o.pad + baseOf(o.lfs, 1.2), o.lfs, XT.caution);
      ctx.font = xf(400, fs);
      ctx.fillStyle = XT.white;
      o.lines.forEach((ln, i) => ctx.fillText(ln, tx, y + o.pad + o.lfs * 1.6 + i * fs * it.lh + baseOf(fs, it.lh)));
    } else if (it.kind === 'list') {
      let yy = y;
      for (const rowLines of o.rows) {
        const b = fs * 0.32;
        ctx.fillStyle = it.bullet;
        ctx.fillRect(x, yy + (fs * it.lh) / 2 - b / 2, b, b);
        ctx.fillStyle = it.color;
        ctx.font = xf(it.weight, fs);
        rowLines.forEach((ln, i) => ctx.fillText(ln, x + fs * 1.4, yy + i * fs * it.lh + baseOf(fs, it.lh)));
        yy += rowLines.length * fs * it.lh + o.rowGap;
      }
    } else {
      ctx.font = xf(it.weight, fs);
      ctx.fillStyle = it.color;
      setLetterSpacing(ctx, it.track ? fs * it.track : 0);
      o.lines.forEach((ln, i) => ctx.fillText(ln, x, y + i * fs * it.lh + baseOf(fs, it.lh)));
      setLetterSpacing(ctx, 0);
    }
    y += o.h;
  }
  ctx.restore();
}

function drawWatermark(ctx, W, H) {
  const img = Brand.logo;
  if (!img || !img.width || !img.height) return;
  const k = vk(W, H);
  const maxW = [0, 150, 210, 280][Brand.cfg.wmSize || 2] * k;
  const s = Math.min(maxW / img.width, (90 * k) / img.height);
  const w = img.width * s;
  const hh = img.height * s;
  const pos = Brand.cfg.wmPos || 'tl';
  const x = pos[1] === 'l' ? XV.side * k : W - XV.side * k - w;
  const y = pos[0] === 't' ? XV.bottom * k : H - XV.bottom * k - hh;
  ctx.save();
  ctx.globalAlpha = Brand.cfg.wmOpacity || 0.85;
  ctx.drawImage(img, x, y, w, hh);
  ctx.restore();
}

/* ---- Brand layout (sizes in settings.js, XV) ------------------------------------------------------------------
   Pixel sizes of the brand sheet are for 1920 x 1080; vk() scales them to the video size. */
function vk(W, H) { return Math.min(W, H) / 1080; }

/* Where the step text and the machine go: landscape = text panel on the left (30 %), picture on the right (70 %);
   portrait and square = picture on top (70 %), text below (30 %). Margins: XV.side left and right, XV.bottom. */
function stepLayout(W, H) {
  const k = vk(W, H);
  const mx = XV.side * k;
  const my = XV.bottom * k;
  const gap = 48 * k;
  if (W / H >= 1.25) {
    const split = Math.round(W * XV.panel);
    return { k, side: true,
      text: { x: mx, y: my, w: split - mx - gap, h: H - my * 2 },
      media: { x: split, y: my, w: W - split - mx, h: H - my * 2 } };
  }
  const split = Math.round(H * (1 - XV.panel));
  return { k, side: false,
    media: { x: mx, y: my, w: W - mx * 2, h: split - my },
    text: { x: mx, y: split + gap * 0.6, w: W - mx * 2, h: H - split - gap * 0.6 - my } };
}

/* The machine: a video frame or picture fitted into its area, nothing drawn over it. Returns the picture's box. */
function drawMedia(ctx, src, r) {
  const sw = src ? src.videoWidth || src.width : 0;
  const sh = src ? src.videoHeight || src.height : 0;
  if (!sw || !sh) {
    ctx.fillStyle = XT.stage;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    return r;
  }
  const f = fitRect(sw, sh, r.w, r.h);
  const box = { x: r.x + f.x, y: r.y + f.y, w: f.w, h: f.h };
  if (src.drawTo) src.drawTo(ctx, box.x, box.y, box.w, box.h);
  else ctx.drawImage(src, box.x, box.y, box.w, box.h);
  return box;
}

/* The speed of a step as a short line in the panel: "▶▶ 2× FASTER". */
function speedItem(speed, k) {
  const L = xl();
  return { kind: 'speed', text: speed < 1 ? L.slow(speedLabel(speed)) : L.fast(speedLabel(speed)), size: XV.caption * k, color: XT.grey1, gap: 34 * k };
}

/* The step text: label (brown), title, instruction, caution (red), speed. Max XV.maxLines lines per block. */
function stepPanelItems(ctx, lay, seg, opts, maxH, extraText) {
  const L = xl();
  const k = lay.k;
  const st = seg.step;
  const n = seg.index + 1;
  const ml = XV.maxLines;
  const items = [
    { kind: 'eyebrow', text: xStepLabel(n, opts.nSteps), size: XV.caption * k, color: XT.brown },
    { kind: 'text', text: st.title || `${L.step} ${n}`, weight: 700, size: XV.stepTitle * k, lh: 1.15, color: XT.white, maxLines: ml, gap: 22 * k },
    extraText ? { kind: 'text', text: extraText, weight: 400, size: XV.text * k, lh: 1.38, color: XT.white, maxLines: ml, gap: 22 * k } : null,
    !extraText && st.desc ? { kind: 'text', text: st.desc, weight: 400, size: XV.text * k, lh: 1.38, color: XT.grey1, maxLines: ml, gap: 22 * k } : null,
    st.caution ? { kind: 'caution', label: L.caution, labelSize: XV.caption * k, text: st.caution, size: XV.text * k, lh: 1.32, maxLines: ml, gap: 34 * k } : null,
    seg.speed && seg.speed !== 1 ? speedItem(seg.speed, k) : null,
  ].filter(Boolean);
  // never smaller than the brand minimum (28 px for 30 px text)
  return fitItems(ctx, items, lay.text.w, maxH, XV.caption / XV.text);
}
function panelLogoHeight(lay) {
  const img = Brand.logo;
  const maxW = Math.min(lay.text.w, [0, 150, 210, 280][Brand.cfg.wmSize || 2] * lay.k);
  return Math.min(img.height * (maxW / img.width), 90 * lay.k);
}
function drawPanelLogo(ctx, lay) {
  const img = Brand.logo;
  const hh = panelLogoHeight(lay);
  const w = img.width * (hh / img.height);
  ctx.save();
  ctx.globalAlpha = Brand.cfg.wmOpacity || 0.85;
  ctx.drawImage(img, lay.text.x, lay.text.y + lay.text.h - hh, w, hh);
  ctx.restore();
}

/* A step moment (clip, the short pause before it, a picture): machine in its 70 %, text in its 30 %. */
function drawStepFrame(ctx, W, H, src, seg, opts, extraText) {
  ctx.fillStyle = XT.black;
  ctx.fillRect(0, 0, W, H);
  const sw = src ? src.videoWidth || src.width : 0;
  const sh = src ? src.videoHeight || src.height : 0;
  if (!opts.captions) {
    // without the text panel: the picture fills the frame, as before
    const r = fitRect(sw || W, sh || H, W, H);
    if (sw) { if (src.drawTo) src.drawTo(ctx, r.x, r.y, r.w, r.h); else ctx.drawImage(src, r.x, r.y, r.w, r.h); }
    if (opts.watermark) drawWatermark(ctx, W, H);
    return;
  }
  const lay = stepLayout(W, H);
  const k = lay.k;
  const logoH = opts.watermark && Brand.logo ? panelLogoHeight(lay) : 0;
  const logoRoom = logoH ? logoH + 40 * k : 0;
  if (lay.side) {
    // landscape: picture centred in the right 70 %, text top-aligned with the picture
    const box = drawMedia(ctx, src, lay.media);
    const r = stepPanelItems(ctx, lay, seg, opts, lay.text.h - logoRoom, extraText);
    const y = Math.max(lay.text.y, Math.min(box.y, lay.text.y + lay.text.h - logoRoom - r.h));
    drawItems(ctx, r, lay.text.x, y);
  } else {
    // portrait and square: picture and text as one block, centred; the text directly under the picture
    const gap = 40 * k;
    const r = stepPanelItems(ctx, lay, seg, opts, lay.text.h - logoRoom, extraText);
    const f = fitRect(sw || 16, sh || 9, lay.media.w, lay.media.h);
    const free = H - XV.bottom * k * 2 - logoRoom;
    const y0 = XV.bottom * k + Math.max(0, (free - (f.h + gap + r.h)) / 2);
    const box = drawMedia(ctx, src, { x: lay.media.x, y: y0, w: lay.media.w, h: f.h });
    drawItems(ctx, r, lay.text.x, box.y + box.h + gap);
  }
  if (logoH) drawPanelLogo(ctx, lay);
}

/* Centred block of lines (opening title). */
function drawCentered(ctx, r, cx, y) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (const o of r.out) {
    y += o.gap;
    const it = o.it;
    const fs = o.fs;
    if (it.kind === 'eyebrow') {
      const w = eyebrowWidth(ctx, it.text, fs);
      drawEyebrow(ctx, it.text, cx - w / 2, y + baseOf(fs, 1.2), fs, it.color);
    } else {
      ctx.font = xf(it.weight, fs);
      ctx.fillStyle = it.color;
      setLetterSpacing(ctx, it.track ? fs * it.track : 0);
      o.lines.forEach((ln, i) => ctx.fillText(ln, cx, y + i * fs * it.lh + baseOf(fs, it.lh)));
      setLetterSpacing(ctx, 0);
    }
    if (it.rule) {
      ctx.fillStyle = XT.brown;
      ctx.fillRect(cx - it.rule / 2, y + o.h + o.fs * 0.9, it.rule, Math.max(2, o.fs * 0.06));
    }
    y += o.h;
  }
  ctx.restore();
}

/* Opening title: centred, title in white, the label in brown, details in grey. */
function drawIntroCard(ctx, W, H, info) {
  paintCardBg(ctx, W, H);
  const L = xl();
  const k = vk(W, H);
  const w = Math.min(W - XV.side * k * 2, 1500 * k);
  const sub = xClaim() || xFirstSentence(info.intro, 110);
  const meta = [L.steps(info.nSteps), fmtTime(Math.round(info.total), false)].concat(info.author ? [info.author] : []).join('   ·   ');
  const r = fitItems(ctx, [
    { kind: 'eyebrow', text: L.guide, size: XV.caption * k, color: XT.brown },
    { kind: 'text', text: info.title || L.guide, weight: 700, size: XV.title * k, lh: 1.1, color: XT.white, maxLines: XV.maxLines, gap: 26 * k, track: -0.01 },
    sub ? { kind: 'text', text: sub, weight: 400, size: XV.text * k, lh: 1.38, color: XT.grey1, maxLines: XV.maxLines, gap: 30 * k } : null,
    { kind: 'text', text: meta, weight: 400, size: XV.caption * k, lh: 1.3, color: XT.grey2, maxLines: 1, gap: 44 * k },
    info.tools.length ? { kind: 'text', text: `${L.tools}: ${info.tools.join(' · ')}`, weight: 400, size: XV.caption * k, lh: 1.35, color: XT.grey2, maxLines: XV.maxLines, gap: 12 * k } : null,
  ].filter(Boolean), w, H - XV.bottom * k * 2, XV.caption / XV.text);
  drawCentered(ctx, r, W / 2, Math.max(XV.bottom * k, (H - r.h) / 2));
}

/* Safety: label and heading, then the notes with red markers, left-aligned. */
function drawSafetyCard(ctx, W, H, items) {
  paintCardBg(ctx, W, H);
  const L = xl();
  const k = vk(W, H);
  const w = Math.min(W - XV.side * k * 2, 1300 * k);
  const r = fitItems(ctx, [
    { kind: 'eyebrow', text: L.safetyKicker, size: XV.caption * k, color: XT.hot },
    { kind: 'text', text: L.safety, weight: 700, size: XV.title * k * 0.85, lh: 1.1, color: XT.white, maxLines: 2, gap: 22 * k, track: -0.01 },
    { kind: 'list', items, weight: 400, size: XV.text * k, lh: 1.35, color: XT.white, bullet: XT.hot, gap: 48 * k, maxLines: XV.maxLines },
  ], w, H - XV.bottom * k * 2, XV.caption / XV.text);
  drawItems(ctx, r, XV.side * k, Math.max(XV.bottom * k, (H - r.h) / 2));
}

/* Brand videos fill the frame untouched; step clips get the brand layout. */
function drawClipFrame(ctx, v, seg, W, H, opts) {
  if (seg.kind !== 'clip') {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    const r = fitRect(v.videoWidth || W, v.videoHeight || H, W, H);
    if (v.drawTo) v.drawTo(ctx, r.x, r.y, r.w, r.h);
    else ctx.drawImage(v, r.x, r.y, r.w, r.h);
    return;
  }
  drawStepFrame(ctx, W, H, v, seg, opts);
}

function applyFade(ctx, W, H, u, dur) {
  const F = Math.min(0.3, dur / 3);
  let a = 0;
  if (u < F) a = Math.max(a, 1 - u / F);
  if (dur - u < F) a = Math.max(a, 1 - (dur - u) / F);
  if (a <= 0.001) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, a);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/* Steps that have footage, clamped to the length of their own source video. */
function usableSteps(P) {
  const dur = {};
  for (const v of P.videos || []) dur[v.id] = v.duration || 0;
  return P.steps
    .map((s) => ({ s, start: clamp(s.start, 0, dur[s.src] || 0), end: clamp(s.end, 0, dur[s.src] || 0) }))
    .filter((o) => o.end - o.start >= 0.05);
}

function extSeg(slot) {
  const c = Brand.cfg.clips[slot];
  if (c.kind === 'image') return { kind: 'extimg', slot, img: Brand.imgs[slot], dur: c.duration || 5 };
  return { kind: 'ext', slot, url: Brand.urls[slot], start: 0, end: c.duration, speed: 1, dur: c.duration };
}
/* A brand picture fills the frame on black, like a brand video. */
function drawBrandPicture(ctx, W, H, img) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  if (!img) return;
  const r = fitRect(img.width, img.height, W, H);
  ctx.drawImage(img, r.x, r.y, r.w, r.h);
}
function buildSegments(P, opts, urls) {
  const segs = [];
  const steps = usableSteps(P);
  if (opts.brandIntro && Brand.has('intro')) segs.push(extSeg('intro'));
  if (opts.intro) segs.push({ kind: 'intro', dur: 2.6 });
  if (opts.safety) {
    const n = lines(Brand.cfg.safetyText).length;
    if (n) segs.push({ kind: 'safety', dur: clamp(2.5 + 1.3 * n, 4, 12) });
    if (Brand.has('safetyVideo')) segs.push(extSeg('safetyVideo'));
  }
  steps.forEach((o, i) => {
    const st = o.s;
    if (opts.stepCards) segs.push({ kind: 'stepcard', step: st, index: i, dur: st.caution ? 2.6 : 2 });
    if (opts.pictures) for (const pic of st.pictures) segs.push({ kind: 'pic', step: st, index: i, pic, dur: opts.picDur || 3 });
    const speed = st.speed || 1;
    segs.push({ kind: 'clip', step: st, index: i, url: urls ? urls[st.src] : '', start: o.start, end: o.end, speed, dur: (o.end - o.start) / speed });
  });
  if (opts.brandOutro && Brand.has('outro')) segs.push(extSeg('outro'));
  let t = 0;
  for (const s of segs) { s.t0 = t; t += s.dur; s.t1 = t; }
  return { segs, total: t, nSteps: steps.length };
}

function outputSize(srcW, srcH, aspect, short) {
  let ratio = srcW / srcH;
  if (aspect === '16:9') ratio = 16 / 9;
  else if (aspect === '9:16') ratio = 9 / 16;
  else if (aspect === '1:1') ratio = 1;
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  if (ratio >= 1) return { W: even(short * ratio), H: even(short) };
  return { W: even(short), H: even(short / ratio) };
}

const isVideoSeg = (s) => s.kind === 'clip' || s.kind === 'ext';
/* Which videos may use the fast frame reader on this device (checked once per video and session). */
const FastFrames = { verified: new Map(), note: '', used: 0 };
function countFrames(total, fps) {
  return Math.max(1, Math.round(total * fps));
}

/* Render the whole timeline into a sink (MP4 encoder or recorder). */
async function renderTimeline({ P, segs, total, nSteps, W, H, fps, sink, opts: baseOpts, onProgress, signal }) {
  await XFont.ensure();
  const opts = Object.assign({}, baseOpts, { nSteps });
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d', { alpha: false });
  // One hidden decoder at a time: phones run out of video decoders quickly when a guide uses several videos.
  let cur = null;
  let curUrl = '';
  const getVideo = async (seg) => {
    const u = seg.url;
    if (!u) throw new Error(seg.kind === 'ext' ? 'A brand video is missing. Open the brand settings and choose it again.' : 'A video of this guide is missing.');
    if (u !== curUrl) {
      if (cur) disposeVideo(cur);
      cur = createVideo(u);
      curUrl = u;
      await videoReady(cur);
      await ensureFrameData(cur);
    }
    return cur;
  };
  // Fast path: decode the clip's file in order with WebCodecs (one reader at a time, like the decoders above).
  // It is used for a video only after its pictures were compared with the <video> element on this device
  // (FastFrames.verified): a decoder that gives black, wrong or no pictures sends the export the careful way.
  let reader = null;
  let readerUrl = '';
  const fastOff = (u, why) => {
    FastFrames.verified.set(u, false);
    FastFrames.note = why;
    if (reader && readerUrl === u) { reader.close(); reader = null; }
    if (window.__ffLog) window.__ffLog('fast frames off: ' + why);
  };
  const sameAsVideo = async (r, seg, t) => {
    const v = await getVideo(seg);
    const f = await r.frameAt(t);
    await seekTo(v, t);
    if (!v.videoWidth || !f.videoWidth) return 'no picture';
    if (Math.abs(f.videoWidth / f.videoHeight - v.videoWidth / v.videoHeight) > 0.03) return 'shape differs';
    const N = 48;
    const ca = makeCanvas(N, N);
    const cb = makeCanvas(N, N);
    const xa = ca.getContext('2d', { alpha: false, willReadFrequently: true });
    const xb = cb.getContext('2d', { alpha: false, willReadFrequently: true });
    f.drawTo(xa, 0, 0, N, N);
    xb.drawImage(v, 0, 0, N, N);
    const A = xa.getImageData(0, 0, N, N).data;
    const B = xb.getImageData(0, 0, N, N).data;
    freeCanvas(ca);
    freeCanvas(cb);
    let sum = 0;
    for (let i = 0; i < A.length; i += 4) sum += Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
    const diff = sum / (N * N * 3);
    return diff > 28 ? `pictures differ (${Math.round(diff)})` : '';
  };
  const getReader = async (seg, st) => {
    const u = seg.url;
    if (!baseOpts.fast || window.__ffNoFastFrames || FastFrames.verified.get(u) === false) return null;
    if (u === readerUrl) return reader;
    if (reader) { reader.close(); reader = null; }
    readerUrl = u;
    try {
      const blob = await (await fetch(u)).blob();
      reader = await FrameReader.open(blob);
    } catch (e) { reader = null; }
    if (!reader) { FastFrames.verified.set(u, false); return null; }
    if (!FastFrames.verified.get(u)) {
      let bad = '';
      try {
        const end = isFinite(seg.end) ? seg.end : st + 1;
        bad = await sameAsVideo(reader, seg, reader.midFrame(Math.min(st + 0.7, Math.max(st, end - 0.1))));
        if (!bad) bad = await sameAsVideo(reader, seg, reader.midFrame(st));
      } catch (e) { bad = (e && e.message) || 'decoder error'; }
      if (window.__ffFastTest) bad = window.__ffFastTest(u, bad) || '';
      if (bad) { fastOff(u, bad); return null; }
      FastFrames.verified.set(u, true);
    }
    return reader;
  };
  /* The picture of a clip at source time st: from the reader, or by seeking the <video> element. */
  const clipFrame = async (seg, st) => {
    const r = await getReader(seg, st);
    if (r) {
      try { FastFrames.used++; return await r.frameAt(st); } catch (e) { fastOff(seg.url, (e && e.message) || 'decoder error'); }
    }
    const v = await getVideo(seg);
    await seekTo(v, st);
    return v;
  };
  const info = { title: P.title, author: P.author, intro: P.intro, tools: lines(P.tools), nSteps, total, safety: lines(Brand.cfg.safetyText) };
  // A still of the step's own video for the stage on the title and step cards (the clip plays right after anyway).
  const stillOf = async (cs, frac) => {
    if (!cs || !cs.url) return null;
    try {
      const v = await getVideo(cs);
      await seekTo(v, Math.min(cs.end - 0.05, cs.start + (cs.end - cs.start) * frac));
      return v.videoWidth ? { src: v, fit: 'cover' } : null;
    } catch (e) { return null; }
  };
  const clipOf = (i) => segs.find((s) => s.kind === 'clip' && s.index === i);
  const statics = new Map();
  const staticCanvas = async (seg) => {
    if (statics.has(seg)) return statics.get(seg);
    const c = makeCanvas(W, H);
    const x = c.getContext('2d', { alpha: false });
    if (seg.kind === 'intro') drawIntroCard(x, W, H, info);
    else if (seg.kind === 'safety') drawSafetyCard(x, W, H, info.safety);
    else if (seg.kind === 'stepcard') {
      // the short pause: the first picture of the step's clip with its text, so the viewer can read before it moves
      const cs = clipOf(seg.index);
      const still = await stillOf(cs, 0);
      drawStepFrame(x, W, H, still ? still.src : null, Object.assign({}, seg, { speed: cs ? cs.speed : 1 }), Object.assign({}, opts, { captions: true }));
    } else if (seg.kind === 'extimg') drawBrandPicture(x, W, H, seg.img);
    else {
      const comp = await picComposite(seg.pic, Math.max(W, H));
      drawStepFrame(x, W, H, comp, seg, opts, seg.pic.caption || '');
      freeCanvas(comp);
    }
    if (opts.watermark && (seg.kind === 'intro' || seg.kind === 'safety')) drawWatermark(x, W, H);
    statics.set(seg, c);
    return c;
  };
  const dropStatic = (seg) => { const c = statics.get(seg); if (c) { freeCanvas(c); statics.delete(seg); } };
  const checkAbort = () => { if (signal && signal.aborted) throw new DOMException('Export cancelled', 'AbortError'); };
  try {
    const totalFrames = countFrames(total, fps);
    let done = 0;
    const t0 = performance.now();
    const report = () => { if (onProgress) onProgress(done, totalFrames, performance.now() - t0); };
    await sink.init(W, H, fps, canvas);
    // one frame after the other: find the part of the guide at this moment and paint it
    let si = 0;
    let lastSt = -1;
    let lastSeg = null;
    let lastFrame = null;
    const keyEvery = Math.max(1, Math.round(fps * 2));
    for (let i = 0; i < totalFrames; i++) {
      checkAbort();
      const T = i / fps;
      while (si < segs.length - 1 && T >= segs[si].t1 - 1e-9) { dropStatic(segs[si]); si++; }
      const seg = segs[si];
      const u = T - seg.t0;
      if (isVideoSeg(seg)) {
        const st = Math.min(seg.start + u * seg.speed, seg.end - 0.001);
        if (seg !== lastSeg || Math.abs(st - lastSt) > 1e-5) { lastFrame = await clipFrame(seg, st); lastSt = st; lastSeg = seg; }
        drawClipFrame(ctx, lastFrame, seg, W, H, opts);
      } else {
        ctx.drawImage(await staticCanvas(seg), 0, 0);
      }
      if (opts.fades) applyFade(ctx, W, H, u, seg.dur);
      await sink.addFrame(canvas, T, 1 / fps, i % keyEvery === 0);
      done++;
      if (i % 3 === 0 || i === totalFrames - 1) report();
    }
    return await sink.finish();
  } catch (e) {
    if (sink.abort) sink.abort();
    throw e;
  } finally {
    statics.forEach((c) => freeCanvas(c));
    if (cur) disposeVideo(cur);
    if (reader) reader.close();
    freeCanvas(canvas);
  }
}
