/* ============================================================================================================
   video-render.js
   What it does:    Paints every frame of the exported video: title card, safety card, step cards, captions, speed
                   badge, pictures, logo.
   Change here:     Sizes and positions of texts on the cards (look for the card functions: drawIntroCard,
                   drawStepCard …).
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
/* Grey stage behind a video frame or picture: the repair is presented like the products on the website. */
function drawStage(ctx, r, src, fit) {
  ctx.save();
  ctx.fillStyle = XT.stage;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  const sw = src ? src.videoWidth || src.width : 0;
  const sh = src ? src.videoHeight || src.height : 0;
  if (sw && sh) {
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    if (fit === 'cover') {
      const k = Math.max(r.w / sw, r.h / sh);
      ctx.drawImage(src, r.x + (r.w - sw * k) / 2, r.y + (r.h - sh * k) / 2, sw * k, sh * k);
    } else {
      const pad = Math.min(r.w, r.h) * 0.045;
      const f = fitRect(sw, sh, r.w - pad * 2, r.h - pad * 2);
      ctx.drawImage(src, r.x + pad + f.x, r.y + pad + f.y, f.w, f.h);
    }
  }
  ctx.restore();
}
/* Text on the left, stage on the right in landscape; stage on top, text below in square and portrait frames. */
function cardLayout(W, H, withStage) {
  const S = Math.min(W, H);
  const side = W / H >= 1.25;
  const m = Math.round(side ? W * 0.07 : W * 0.08);
  if (!withStage) return { S, side, m, stage: null, text: { x: m, y: m, w: W - m * 2, h: H - m * 2 } };
  if (side) {
    let sw = W - m - Math.round(W * 0.52);
    let sh = (sw * 2) / 3;
    if (sh > H - m * 2) { sh = H - m * 2; sw = sh * 1.5; }
    const stage = { x: W - m - sw, y: (H - sh) / 2, w: sw, h: sh };
    return { S, side, m, stage, text: { x: m, y: m, w: stage.x - m - W * 0.05, h: H - m * 2 } };
  }
  const sw = W - m * 2;
  const sh = Math.min((sw * 2) / 3, H * 0.42);
  const top = Math.round(H / W > 1.4 ? H * 0.09 : m);
  const ty = top + sh + S * 0.06;
  return { S, side, m, stage: { x: m, y: top, w: sw, h: sh }, text: { x: m, y: ty, w: sw, h: H - m - ty } };
}

/* Portrait and square frames: centre stage and text together instead of leaving the bottom empty. */
function stackCenter(lay, r, H) {
  if (lay.side || !lay.stage) return lay.text.y;
  const gap = lay.text.y - (lay.stage.y + lay.stage.h);
  const total = lay.stage.h + gap + r.h;
  const top = Math.max(lay.stage.y, (H - total) / 2);
  lay.stage.y = top;
  return top + lay.stage.h + gap;
}

/* A column of text items (label, headline, paragraph, caution box, list), shrunk together until it fits. */
function measureItems(ctx, items, maxW, k) {
  const out = [];
  let h = 0;
  for (const it of items) {
    const fs = it.size * k;
    const gap = out.length ? (it.gap || 0) * k : 0;
    let o;
    if (it.kind === 'eyebrow') o = { lines: [it.text], h: fs * 1.2 };
    else if (it.kind === 'caution') {
      const pad = fs * 0.8;
      const bar = Math.max(3, fs * 0.18);
      const lfs = fs * 0.66;
      ctx.font = xf(400, fs);
      const ls = wrapLines(ctx, it.text, maxW - pad * 2 - bar, it.maxLines || 3);
      const tw = Math.max(eyebrowWidth(ctx, it.label, lfs), ...ls.map((l) => { ctx.font = xf(400, fs); return ctx.measureText(l).width; }));
      o = { lines: ls, pad, bar, lfs, w: Math.min(maxW, tw + pad * 2 + bar), h: pad * 2 + lfs * 1.6 + ls.length * fs * it.lh };
    } else if (it.kind === 'list') {
      ctx.font = xf(it.weight, fs);
      const rows = it.items.map((t) => wrapLines(ctx, t, maxW - fs * 1.4, 3));
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
function fitItems(ctx, items, maxW, maxH) {
  let k = 1;
  let r = measureItems(ctx, items, maxW, k);
  while (r.h > maxH && k > 0.5) { k *= 0.92; r = measureItems(ctx, items, maxW, k); }
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
    else if (it.kind === 'caution') {
      ctx.fillStyle = 'rgba(255,200,61,0.12)';
      ctx.fillRect(x, y, o.w, o.h);
      ctx.fillStyle = XT.caution;
      ctx.fillRect(x, y, o.bar, o.h);
      const tx = x + o.bar + o.pad;
      drawEyebrow(ctx, it.label, tx, y + o.pad + baseOf(o.lfs, 1.2), o.lfs, XT.caution);
      ctx.font = xf(400, fs);
      ctx.fillStyle = '#FFE9B0';
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

function drawWatermark(ctx, W, H, o) {
  const img = Brand.logo;
  if (!img || !img.width || !img.height) return;
  const S = Math.min(W, H);
  const m = S * 0.04;
  const maxW = S * [0, 0.16, 0.24, 0.34][Brand.cfg.wmSize || 2];
  const k = Math.min(maxW / img.width, (maxW * 0.6) / img.height);
  const w = img.width * k;
  const hh = img.height * k;
  const pos = Brand.cfg.wmPos || 'tl';
  const x = pos[1] === 'l' ? m : W - m - w;
  let y = pos[0] === 't' ? m : H - m - hh;
  if (o && o.liftBottom && pos === 'bl') y -= lowerThirdHeight(S) + m * 0.5;
  ctx.save();
  ctx.globalAlpha = Brand.cfg.wmOpacity || 0.85;
  ctx.drawImage(img, x, y, w, hh);
  ctx.restore();
}

function drawIntroCard(ctx, W, H, info, hero) {
  paintCardBg(ctx, W, H);
  const L = xl();
  const lay = cardLayout(W, H, !!hero);
  const S = lay.S;
  const sub = xClaim() || xFirstSentence(info.intro, 110);
  const meta = [L.steps(info.nSteps), fmtTime(Math.round(info.total), false)].concat(info.author ? [info.author] : []).join('   ·   ');
  const r = fitItems(ctx, [
    { kind: 'eyebrow', text: L.guide, size: S * 0.022, color: XT.grey2 },
    { kind: 'text', text: info.title || L.guide, weight: 700, size: S * (lay.side ? 0.076 : 0.068), lh: 1.08, color: XT.white, maxLines: 3, gap: S * 0.026, track: -0.012 },
    sub ? { kind: 'text', text: sub, weight: 400, size: S * 0.032, lh: 1.38, color: XT.grey1, maxLines: 3, gap: S * 0.026 } : null,
    { kind: 'text', text: meta, weight: 400, size: S * 0.022, lh: 1.3, color: XT.grey2, maxLines: 1, gap: S * 0.042 },
    info.tools.length ? { kind: 'text', text: `${L.tools}: ${info.tools.join(' · ')}`, weight: 400, size: S * 0.022, lh: 1.4, color: XT.grey2, maxLines: 2, gap: S * 0.012 } : null,
  ].filter(Boolean), lay.text.w, lay.text.h);
  const y = lay.side || !hero ? lay.text.y + Math.max(0, (lay.text.h - r.h) / 2) : stackCenter(lay, r, H);
  drawItems(ctx, r, lay.text.x, y);
  if (hero) drawStage(ctx, lay.stage, hero.src, hero.fit);
}

function drawSafetyCard(ctx, W, H, items) {
  paintCardBg(ctx, W, H);
  const L = xl();
  const lay = cardLayout(W, H, false);
  const S = lay.S;
  const r = fitItems(ctx, [
    { kind: 'eyebrow', text: L.safetyKicker, size: S * 0.024, color: XT.caution },
    { kind: 'text', text: L.safety, weight: 700, size: S * 0.07, lh: 1.08, color: XT.white, maxLines: 2, gap: S * 0.022, track: -0.012 },
    { kind: 'list', items, weight: 400, size: S * 0.036, lh: 1.32, color: XT.white, bullet: XT.caution, gap: S * 0.05 },
  ], Math.min(lay.text.w, W * 0.8), lay.text.h);
  drawItems(ctx, r, lay.text.x, lay.text.y + Math.max(0, (lay.text.h - r.h) / 2));
}

function drawStepCard(ctx, W, H, seg, info, still) {
  paintCardBg(ctx, W, H);
  const L = xl();
  const n = seg.index + 1;
  const st = seg.step;
  const lay = cardLayout(W, H, true);
  const S = lay.S;
  const r = fitItems(ctx, [
    { kind: 'eyebrow', text: xStepLabel(n, info.nSteps), size: S * 0.022, color: XT.grey2 },
    { kind: 'text', text: st.title || `${L.step} ${n}`, weight: 700, size: S * (lay.side ? 0.066 : 0.06), lh: 1.1, color: XT.white, maxLines: 3, gap: S * 0.024, track: -0.01 },
    st.desc ? { kind: 'text', text: st.desc, weight: 400, size: S * 0.03, lh: 1.42, color: XT.grey1, maxLines: lay.side ? 5 : 4, gap: S * 0.026 } : null,
    st.caution ? { kind: 'caution', label: L.caution, text: st.caution, size: S * 0.027, lh: 1.36, maxLines: 3, gap: S * 0.036 } : null,
  ].filter(Boolean), lay.text.w, lay.text.h);
  drawItems(ctx, r, lay.text.x, lay.side ? lay.text.y + Math.max(0, (lay.text.h - r.h) / 2) : stackCenter(lay, r, H));
  drawStage(ctx, lay.stage, still ? still.src : null, still ? still.fit : 'cover');
  if (!still) {
    ctx.save();
    ctx.fillStyle = XT.grey3;
    ctx.font = xf(700, lay.stage.h * 0.46);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), lay.stage.x + lay.stage.w / 2, lay.stage.y + lay.stage.h / 2);
    ctx.restore();
  }
}

/* Caption on clips and pictures: a black block at the bottom left with the step label above the title. */
function lowerThirdBox(S) { return { m: S * 0.04, pad: S * 0.024, efs: S * 0.018, tfs: S * 0.032, gap: S * 0.008 }; }
function lowerThirdHeight(S) { const b = lowerThirdBox(S); return b.pad * 2 + b.efs * 1.2 + b.gap + b.tfs * 1.2; }
function drawLowerThird(ctx, W, H, label, text) {
  const S = Math.min(W, H);
  const b = lowerThirdBox(S);
  ctx.save();
  ctx.font = xf(700, b.tfs);
  const t = ellipsize(ctx, text, W - b.m * 2 - b.pad * 2);
  const w = Math.min(W - b.m * 2, Math.max(ctx.measureText(t).width, eyebrowWidth(ctx, label, b.efs)) + b.pad * 2);
  const hh = lowerThirdHeight(S);
  const x = b.m;
  const y = H - b.m - hh;
  ctx.fillStyle = 'rgba(13,13,13,0.86)';
  ctx.fillRect(x, y, w, hh);
  drawEyebrow(ctx, label, x + b.pad, y + b.pad + baseOf(b.efs, 1.2), b.efs, XT.grey1);
  ctx.font = xf(700, b.tfs);
  ctx.fillStyle = XT.white;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(t, x + b.pad, y + b.pad + b.efs * 1.2 + b.gap + baseOf(b.tfs, 1.2));
  ctx.restore();
}

function drawSpeedBadge(ctx, W, H, speed, left) {
  const S = Math.min(W, H);
  const m = S * 0.04;
  const fs = S * 0.019;
  const L = xl();
  const label = speed < 1 ? L.slow(speedLabel(speed)) : L.fast(speedLabel(speed));
  const tri = fs * 0.8;
  const pad = fs * 1.1;
  const hh = fs * 2.7;
  const w = pad + tri * 2.15 + fs * 0.8 + eyebrowWidth(ctx, label, fs) + pad * 0.85;
  const x = left ? m : W - m - w;
  const y = m;
  ctx.save();
  ctx.fillStyle = 'rgba(13,13,13,0.86)';
  ctx.fillRect(x, y, w, hh);
  ctx.fillStyle = XT.white;
  let tx = x + pad;
  const cy = y + hh / 2;
  for (let k = 0; k < 2; k++) {
    ctx.beginPath();
    ctx.moveTo(tx, cy - tri * 0.5);
    ctx.lineTo(tx + tri, cy);
    ctx.lineTo(tx, cy + tri * 0.5);
    ctx.closePath();
    ctx.fill();
    tx += tri * 1.08;
  }
  drawEyebrow(ctx, label, tx + fs * 0.8, cy + fs * 0.36, fs, XT.white);
  ctx.restore();
}

function drawClipFrame(ctx, v, seg, W, H, opts) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  const r = fitRect(v.videoWidth || W, v.videoHeight || H, W, H);
  if (v.drawTo) v.drawTo(ctx, r.x, r.y, r.w, r.h);
  else ctx.drawImage(v, r.x, r.y, r.w, r.h);
  if (seg.kind !== 'clip') return; // brand videos stay untouched
  if (opts.captions) drawLowerThird(ctx, W, H, xStepLabel(seg.index + 1, opts.nSteps), seg.step.title || `${xl().step} ${seg.index + 1}`);
  if ((opts.captions || opts.badge) && seg.speed !== 1) drawSpeedBadge(ctx, W, H, seg.speed, !!(opts.watermark && Brand.logo && Brand.cfg.wmPos === 'tr'));
  if (opts.watermark) drawWatermark(ctx, W, H, { liftBottom: opts.captions });
}

function drawPicFrame(ctx, W, H, comp, seg, opts) {
  ctx.fillStyle = XT.black;
  ctx.fillRect(0, 0, W, H);
  const S = Math.min(W, H);
  const m = S * 0.03;
  if (comp) {
    const r = fitRect(comp.width, comp.height, W - m * 2, H - m * 2);
    ctx.drawImage(comp, m + r.x, m + r.y, r.w, r.h);
  }
  if (opts.captions) drawLowerThird(ctx, W, H, xStepLabel(seg.index + 1, opts.nSteps), seg.pic.caption || seg.step.title || `${xl().step} ${seg.index + 1}`);
  if (opts.watermark) drawWatermark(ctx, W, H, { liftBottom: opts.captions });
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
    if (seg.kind === 'intro') drawIntroCard(x, W, H, info, await stillOf(clipOf(0), 0.35));
    else if (seg.kind === 'safety') drawSafetyCard(x, W, H, info.safety);
    else if (seg.kind === 'stepcard') drawStepCard(x, W, H, seg, info, await stillOf(clipOf(seg.index), 0.15));
    else if (seg.kind === 'extimg') drawBrandPicture(x, W, H, seg.img);
    else {
      const comp = await picComposite(seg.pic, Math.max(W, H));
      drawPicFrame(x, W, H, comp, seg, opts);
      freeCanvas(comp);
    }
    if (opts.watermark && seg.kind !== 'pic' && seg.kind !== 'extimg') drawWatermark(x, W, H);
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
