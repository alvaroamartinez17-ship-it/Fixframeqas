/* ============================================================================================================
   markup-shapes.js
   What it does:    Draws the marks on pictures: arrows, info boxes, circles, frames, numbers. Also the 7 colours
                   to choose from (ANN_COLORS).
   Change here:     The colours in ANN_COLORS (#RRGGBB), the line thickness.
   Edit with care: change texts and values, not the structure.
   Technical note:  Picture markup: arrows, info boxes (with optional pointer), circles, frames, numbers.
                   Coordinates are stored 0..1 relative to the picture; sizes scale with the picture.
   ============================================================================================================ */
// Brand colours only: white, brown, red (hot), blue (cold), light / medium / dark grey (see XT in settings.js).
const ANN_COLORS = ['#FFFFFF', '#996E4E', '#DB0812', '#008AC3', '#D9D9D6', '#75787B', '#53565A'];
// Colours of older versions are shown in the nearest brand colour.
const ANN_OLD_COLORS = { '#FF3B30': '#DB0812', '#FFCC00': '#FFFFFF', '#E75B12': '#996E4E', '#34C759': '#FFFFFF', '#0A84FF': '#008AC3', '#111111': '#53565A' };
function annColor(c) { const u = String(c || '').toUpperCase(); return ANN_COLORS.includes(u) ? u : ANN_OLD_COLORS[u] || '#FFFFFF'; }
const ANN_FONT = '"FX Export", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'; // export font first: markup is part of the exports
const ANN_SIZE = { stroke: [0, 4.2, 7, 10.5], font: [0, 24, 32, 44], num: [0, 19, 26, 35] };

function annUnit(W, H) { return Math.max(W, H) / 1000; }
function hexLum(hex) {
  const v = parseInt(String(hex).replace('#', ''), 16);
  const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function inkOn(hex) { return hexLum(hex) > 0.45 ? '#111111' : '#FFFFFF'; }

function roundRectPath(ctx, x, y, w, hh, r) {
  r = Math.max(0, Math.min(r, w / 2, hh / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + hh - r);
  ctx.arcTo(x + w, y + hh, x + w - r, y + hh, r);
  ctx.lineTo(x + r, y + hh);
  ctx.arcTo(x, y + hh, x, y + hh - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawArrowGeom(ctx, x1, y1, x2, y2, w, color) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len;
  const uy = dy / len;
  const head = Math.min(len * 0.6, Math.max(w * 3.4, w + 10));
  const hw = head * 0.62;
  const bx = x2 - ux * head;
  const by = y2 - uy * head;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(bx + ux * w * 0.6, by + uy * w * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(bx - uy * hw, by + ux * hw);
  ctx.lineTo(bx + uy * hw, by - ux * hw);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = Math.max(1, w * 0.35);
  ctx.stroke();
}

function boxLayout(ctx, s, W, H) {
  const u = annUnit(W, H);
  const fs = ANN_SIZE.font[s.size || 2] * u;
  ctx.save();
  ctx.font = `650 ${fs}px ${ANN_FONT}`;
  const maxW = Math.max(fs * 5, W * (W >= H ? 0.42 : 0.66));
  const ls = wrapLines(ctx, s.text || ' ', maxW, 8);
  let tw = 0;
  for (const l of ls) tw = Math.max(tw, ctx.measureText(l).width);
  ctx.restore();
  const padX = fs * 0.55;
  const padY = fs * 0.42;
  const lh = fs * 1.22;
  const w = tw + padX * 2;
  const hh = padY * 2 + fs + (ls.length - 1) * lh;
  const x = clamp(s.x * W, 0, Math.max(0, W - w));
  const y = clamp(s.y * H, 0, Math.max(0, H - hh));
  return { x, y, w, h: hh, fs, lines: ls, padX, padY, lh };
}

function drawBox(ctx, s, W, H) {
  const L = boxLayout(ctx, s, W, H);
  const u = annUnit(W, H);
  const color = annColor(s.color);
  if (s.tx != null && s.ty != null) {
    const tx = s.tx * W;
    const ty = s.ty * H;
    if (!(tx >= L.x && tx <= L.x + L.w && ty >= L.y && ty <= L.y + L.h)) {
      // a thin connecting line from the box to the part, ending in a small dot (brand: thin lines identify parts)
      const lw = Math.max(1.5, u * 1.6);
      const cx = clamp(tx, L.x, L.x + L.w);
      const cy = clamp(ty, L.y, L.y + L.h);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(tx, ty, Math.max(lw * 2.2, u * 4), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  roundRectPath(ctx, L.x, L.y, L.w, L.h, L.fs * 0.18);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = Math.max(1, u * 1.2);
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.stroke();
  ctx.fillStyle = inkOn(color);
  ctx.font = `650 ${L.fs}px ${ANN_FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  L.lines.forEach((ln, i) => ctx.fillText(ln, L.x + L.padX, L.y + L.padY + L.fs * 0.53 + i * L.lh));
}

function drawShape(ctx, s0, W, H) {
  const s = Object.assign({}, s0, { color: annColor(s0.color) });
  const u = annUnit(W, H);
  const sw = ANN_SIZE.stroke[s.size || 2] * u;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 5 * u;
  ctx.shadowOffsetY = 1.5 * u;
  if (s.type === 'arrow') {
    drawArrowGeom(ctx, s.x1 * W, s.y1 * H, s.x2 * W, s.y2 * H, sw, s.color);
  } else if (s.type === 'rect' || s.type === 'ellipse') {
    const x = Math.min(s.x1, s.x2) * W;
    const y = Math.min(s.y1, s.y2) * H;
    const w = Math.abs(s.x2 - s.x1) * W;
    const hh = Math.abs(s.y2 - s.y1) * H;
    ctx.lineWidth = sw;
    ctx.strokeStyle = s.color;
    if (s.type === 'rect') roundRectPath(ctx, x, y, w, hh, Math.min(sw * 1.4, w / 2, hh / 2));
    else { ctx.beginPath(); ctx.ellipse(x + w / 2, y + hh / 2, Math.max(1, w / 2), Math.max(1, hh / 2), 0, 0, Math.PI * 2); }
    ctx.stroke();
  } else if (s.type === 'num') {
    const r = ANN_SIZE.num[s.size || 2] * u;
    const cx = s.x * W;
    const cy = s.y * H;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = s.color;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = r * 0.14;
    ctx.strokeStyle = hexLum(s.color) > 0.75 ? '#111111' : '#FFFFFF';
    ctx.stroke();
    ctx.fillStyle = inkOn(s.color);
    ctx.font = `800 ${r * 1.1}px ${ANN_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(s.n), cx, cy + r * 0.06);
  } else if (s.type === 'box') {
    drawBox(ctx, s, W, H);
  }
  ctx.restore();
}

function drawAnnotations(ctx, shapes, W, H) {
  for (const s of shapes || []) drawShape(ctx, s, W, H);
}

function shapeBounds(ctx, s, W, H) {
  const u = annUnit(W, H);
  if ('x1' in s) {
    return { x: Math.min(s.x1, s.x2) * W, y: Math.min(s.y1, s.y2) * H, w: Math.abs(s.x2 - s.x1) * W, h: Math.abs(s.y2 - s.y1) * H };
  }
  if (s.type === 'num') {
    const r = ANN_SIZE.num[s.size || 2] * u;
    return { x: s.x * W - r, y: s.y * H - r, w: r * 2, h: r * 2 };
  }
  const L = boxLayout(ctx, s, W, H);
  return { x: L.x, y: L.y, w: L.w, h: L.h };
}

function shapeHandles(ctx, s, W, H) {
  if (s.type === 'arrow' || s.type === 'rect' || s.type === 'ellipse') {
    return [{ id: 'p1', x: s.x1 * W, y: s.y1 * H }, { id: 'p2', x: s.x2 * W, y: s.y2 * H }];
  }
  if (s.type === 'box') {
    if (s.tx != null) return [{ id: 'tip', x: s.tx * W, y: s.ty * H }];
    const L = boxLayout(ctx, s, W, H);
    let y = L.y + L.h + L.fs * 1.4;
    if (y > H - L.fs * 0.7) y = L.y - L.fs * 1.4;
    return [{ id: 'tip', x: L.x + L.w / 2, y: clamp(y, 0, H), ghost: true }];
  }
  return [];
}

function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function hitShape(ctx, s, W, H, px, py, tol) {
  const u = annUnit(W, H);
  if (s.type === 'arrow') return distToSeg(px, py, s.x1 * W, s.y1 * H, s.x2 * W, s.y2 * H) <= tol + (ANN_SIZE.stroke[s.size || 2] * u) / 2;
  if (s.type === 'rect' || s.type === 'ellipse' || s.type === 'num') {
    const b = shapeBounds(ctx, s, W, H);
    return px >= b.x - tol && px <= b.x + b.w + tol && py >= b.y - tol && py <= b.y + b.h + tol;
  }
  if (s.type === 'box') {
    const L = boxLayout(ctx, s, W, H);
    if (px >= L.x - tol && px <= L.x + L.w + tol && py >= L.y - tol && py <= L.y + L.h + tol) return true;
    if (s.tx != null) return distToSeg(px, py, L.x + L.w / 2, L.y + L.h / 2, s.tx * W, s.ty * H) <= tol;
  }
  return false;
}

function moveShape(s, dx, dy) {
  if ('x1' in s) {
    const minX = Math.min(s.x1, s.x2);
    const maxX = Math.max(s.x1, s.x2);
    const minY = Math.min(s.y1, s.y2);
    const maxY = Math.max(s.y1, s.y2);
    dx = clamp(dx, -minX, 1 - maxX);
    dy = clamp(dy, -minY, 1 - maxY);
    s.x1 += dx; s.x2 += dx; s.y1 += dy; s.y2 += dy;
  } else {
    s.x = clamp(s.x + dx, 0, 1);
    s.y = clamp(s.y + dy, 0, 1);
  }
}

function drawSelection(ctx, s, W, H, scale, handles) {
  ctx.save();
  if (s.type !== 'arrow') {
    const b = shapeBounds(ctx, s, W, H);
    const pad = 5 * scale;
    ctx.setLineDash([6 * scale, 5 * scale]);
    ctx.lineWidth = 1.6 * scale;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
    ctx.lineDashOffset = 6 * scale;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
    ctx.setLineDash([]);
  }
  const r = 10 * scale;
  for (const hd of handles) {
    ctx.beginPath();
    ctx.arc(hd.x, hd.y, r, 0, Math.PI * 2);
    if (hd.ghost) {
      ctx.fillStyle = 'rgba(231,91,18,0.3)';
      ctx.fill();
      ctx.setLineDash([4 * scale, 3 * scale]);
      ctx.lineWidth = 2 * scale;
      ctx.strokeStyle = '#E75B12';
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(hd.x - r * 0.45, hd.y); ctx.lineTo(hd.x + r * 0.45, hd.y);
      ctx.moveTo(hd.x, hd.y - r * 0.45); ctx.lineTo(hd.x, hd.y + r * 0.45);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.lineWidth = 2.2 * scale;
      ctx.strokeStyle = '#100E0D';
      ctx.stroke();
    }
  }
  ctx.restore();
}

async function picComposite(pic, maxSide) {
  const blob = await Store.getBlob('p:' + pic.id);
  if (!blob) return null;
  const img = await loadImageFromBlob(blob);
  const iw = img.width || pic.w;
  const ih = img.height || pic.h;
  const s = Math.min(1, maxSide / Math.max(iw, ih));
  const c = makeCanvas(iw * s, ih * s);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, c.width, c.height);
  closeImage(img);
  drawAnnotations(ctx, pic.shapes, c.width, c.height);
  return c;
}

const PicThumbs = {
  cache: new Map(),
  key(pic) { return `${pic.id}:${pic.rev || 0}`; },
  async get(pic) {
    const k = this.key(pic);
    if (this.cache.has(k)) return this.cache.get(k);
    const c = await picComposite(pic, 360);
    if (!c) return '';
    const url = c.toDataURL('image/jpeg', 0.75);
    freeCanvas(c);
    this.cache.set(k, url);
    return url;
  },
};
