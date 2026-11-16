/* ============================================================================================================
   export-font.js
   What it does:    The font of the exports (Inter, or your own font files) and how it is put into PDF and Word
                   files.
   Change here:     Nothing; choose fonts in the app under Brand & safety.
   Engine room: better leave it as it is.
   Technical note:  Export font: the bundled Inter (fx-font-regular.ttf, fx-font-bold.ttf) or the user's own font
                   files. The same files are drawn on video cards and embedded in PDF files and Word
                   files, so every export uses one typeface. Only the export uses it; the app's own screens keep
                   the system font.
   ============================================================================================================ */
const XF_FAMILY = 'FX Export';
const XF_STACK = `"${XF_FAMILY}", "Helvetica Neue", Helvetica, Arial, sans-serif`;
const XF_FILES = { r: 'fx-font-regular.ttf', b: 'fx-font-bold.ttf' };

function fontError(msg) { const e = new Error(msg); e.userMsg = msg; return e; }

/* ---------- reading font files ---------- */
async function inflateZlib(u8) {
  const ds = new DecompressionStream('deflate');
  const out = await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);
}
/* WOFF 1.0 holds the same tables as a .ttf/.otf, each zlib-compressed: unpack it into a plain font file. */
async function woffToSfnt(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = dv.getUint16(12);
  const recs = [];
  for (let i = 0; i < n; i++) {
    const r = 44 + i * 20;
    const off = dv.getUint32(r + 4);
    const comp = dv.getUint32(r + 8);
    const orig = dv.getUint32(r + 12);
    let data = u8.subarray(off, off + comp);
    if (comp < orig) data = await inflateZlib(data);
    if (data.length !== orig) throw fontError('This WOFF font file is damaged.');
    recs.push({ tag: u8.subarray(r, r + 4), data, sum: dv.getUint32(r + 16) });
  }
  return sfntAssemble(dv.getUint32(4), recs.map((t) => ({ tag: String.fromCharCode(...t.tag), data: t.data })));
}
async function toSfnt(u8) {
  if (u8.length < 12) throw fontError('This is not a font file.');
  const sig = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
  if (sig === 'wOFF') return woffToSfnt(u8);
  if (sig === 'wOF2') throw fontError('WOFF2 fonts cannot be used here. Choose the .ttf or .otf version of the font.');
  return u8;
}
function sfntChecksum(b) {
  let sum = 0;
  for (let i = 0; i < b.length; i += 4) {
    const w = ((b[i] << 24) >>> 0) + ((b[i + 1] || 0) << 16) + ((b[i + 2] || 0) << 8) + (b[i + 3] || 0);
    sum = (sum + w) >>> 0;
  }
  return sum;
}
/* Write a font file from tables: directory sorted by tag, tables 4-byte aligned, checksums filled in. */
function sfntAssemble(version, tables) {
  const list = tables.slice().sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const n = list.length;
  let size = 12 + n * 16;
  for (const t of list) size += (t.data.length + 3) & ~3;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let es = 0;
  while ((1 << (es + 1)) <= n) es++;
  dv.setUint32(0, version);
  dv.setUint16(4, n);
  dv.setUint16(6, (1 << es) * 16);
  dv.setUint16(8, es);
  dv.setUint16(10, n * 16 - (1 << es) * 16);
  let off = 12 + n * 16;
  list.forEach((t, i) => {
    const r = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[r + k] = t.tag.charCodeAt(k);
    dv.setUint32(r + 4, sfntChecksum(t.data));
    dv.setUint32(r + 8, off);
    dv.setUint32(r + 12, t.data.length);
    out.set(t.data, off);
    off += (t.data.length + 3) & ~3;
  });
  return out;
}
function parseCmap(dv, off, end) {
  const map = new Map();
  const n = dv.getUint16(off + 2);
  let best = -1;
  let score = -1;
  for (let i = 0; i < n; i++) {
    const r = off + 4 + i * 8;
    const pid = dv.getUint16(r);
    const eid = dv.getUint16(r + 2);
    const so = off + dv.getUint32(r + 4);
    if (so + 4 > end) continue;
    const fmt = dv.getUint16(so);
    let s = -1;
    if (fmt === 12 && ((pid === 3 && eid === 10) || (pid === 0 && (eid === 4 || eid === 6)))) s = 5;
    else if (fmt === 4 && pid === 3 && eid === 1) s = 4;
    else if (fmt === 4 && pid === 0) s = 3;
    else if (fmt === 4 && pid === 3 && eid === 0) s = 1;
    if (s > score) { score = s; best = so; }
  }
  if (best < 0) return map;
  const fmt = dv.getUint16(best);
  if (fmt === 4) {
    const segX2 = dv.getUint16(best + 6);
    const ends = best + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    for (let i = 0; i < segX2; i += 2) {
      const e = dv.getUint16(ends + i);
      const s = dv.getUint16(starts + i);
      const delta = dv.getInt16(deltas + i);
      const ro = dv.getUint16(ranges + i);
      for (let c = s; c <= e && c !== 0xffff; c++) {
        let g = 0;
        if (ro === 0) g = (c + delta) & 0xffff;
        else {
          const gi = ranges + i + ro + (c - s) * 2;
          if (gi + 2 <= end) { g = dv.getUint16(gi); if (g) g = (g + delta) & 0xffff; }
        }
        if (g) map.set(score === 1 && c >= 0xf000 ? c - 0xf000 : c, g);
      }
    }
  } else if (fmt === 12) {
    const groups = dv.getUint32(best + 12);
    for (let i = 0; i < groups && best + 16 + i * 12 + 12 <= end; i++) {
      const r = best + 16 + i * 12;
      const s = dv.getUint32(r);
      const e = Math.min(dv.getUint32(r + 4), s + 70000);
      const g0 = dv.getUint32(r + 8);
      for (let c = s; c <= e; c++) map.set(c, g0 + (c - s));
    }
  }
  return map;
}
function parseNames(dv, off) {
  const count = dv.getUint16(off + 2);
  const strs = off + dv.getUint16(off + 4);
  const out = {};
  const rank = {};
  for (let i = 0; i < count; i++) {
    const r = off + 6 + i * 12;
    const pid = dv.getUint16(r);
    const eid = dv.getUint16(r + 2);
    const lang = dv.getUint16(r + 4);
    const nid = dv.getUint16(r + 6);
    const len = dv.getUint16(r + 8);
    const so = strs + dv.getUint16(r + 10);
    let p = -1;
    let s = '';
    if ((pid === 3 && (eid === 1 || eid === 10)) || pid === 0) {
      p = pid === 3 && lang === 0x409 ? 3 : 2;
      for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(dv.getUint16(so + k));
    } else if (pid === 1 && eid === 0) {
      p = 1;
      for (let k = 0; k < len; k++) s += String.fromCharCode(dv.getUint8(so + k));
    }
    if (p > (rank[nid] == null ? -1 : rank[nid])) { rank[nid] = p; out[nid] = s; }
  }
  return out;
}
/* Read what the exports need from a .ttf/.otf: metrics, character map, names and the embedding permission. */
function parseSfnt(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const ver = dv.getUint32(0);
  if (ver !== 0x00010000 && ver !== 0x4f54544f && ver !== 0x74727565) throw fontError('This is not a font file (.ttf or .otf).');
  const tables = {};
  const n = dv.getUint16(4);
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    const tag = String.fromCharCode(u8[r], u8[r + 1], u8[r + 2], u8[r + 3]);
    const off = dv.getUint32(r + 8);
    const len = dv.getUint32(r + 12);
    if (off + len > u8.length) throw fontError('This font file is damaged.');
    tables[tag] = { off, len };
  }
  for (const t of ['head', 'hhea', 'hmtx', 'maxp', 'cmap', 'name']) if (!tables[t]) throw fontError('This font file is incomplete.');
  if (!tables.glyf && !tables['CFF ']) throw fontError('This font has no outlines that can be used.');
  const T = (t) => tables[t].off;
  const head = T('head');
  const numGlyphs = dv.getUint16(T('maxp') + 4);
  const hhea = T('hhea');
  const numHM = Math.max(1, Math.min(numGlyphs, dv.getUint16(hhea + 34)));
  const advances = new Uint16Array(numGlyphs);
  let last = 0;
  for (let g = 0; g < numGlyphs; g++) {
    if (g < numHM) last = dv.getUint16(T('hmtx') + g * 4);
    advances[g] = last;
  }
  const f = {
    u8, dv, tables, numGlyphs, advances,
    unitsPerEm: dv.getUint16(head + 18) || 1000,
    bbox: [dv.getInt16(head + 36), dv.getInt16(head + 38), dv.getInt16(head + 40), dv.getInt16(head + 42)],
    longLoca: dv.getInt16(head + 50) === 1,
    ascender: dv.getInt16(hhea + 4),
    descender: dv.getInt16(hhea + 6),
    capHeight: 0, weight: 400, fsType: 0, fsSelection: 0, italicAngle: 0, panose: '',
    isCFF: !tables.glyf,
    cmap: parseCmap(dv, T('cmap'), T('cmap') + tables.cmap.len),
  };
  if (tables['OS/2'] && tables['OS/2'].len >= 78) {
    const o = T('OS/2');
    f.weight = dv.getUint16(o + 4);
    f.fsType = dv.getUint16(o + 8);
    f.fsSelection = dv.getUint16(o + 62);
    f.panose = Array.from(u8.subarray(o + 32, o + 42), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    if (dv.getUint16(o) >= 2 && tables['OS/2'].len >= 90) f.capHeight = dv.getInt16(o + 88);
  }
  if (!f.capHeight) f.capHeight = Math.round(f.ascender * 0.72);
  if (tables.post) f.italicAngle = dv.getInt32(T('post') + 4) / 65536;
  const names = parseNames(dv, T('name'));
  f.family = (names[1] || names[16] || 'Brand font').trim();
  f.style = (names[2] || '').trim();
  f.fullName = (names[4] || f.family).trim();
  f.psName = (names[6] || f.fullName).replace(/[^A-Za-z0-9\-]/g, '').slice(0, 60) || 'BrandFont';
  f.bold = f.weight >= 600 || !!(f.fsSelection & 0x20);
  f.italic = !!(f.fsSelection & 1) || f.italicAngle !== 0;
  // fsType 2 = "restricted license embedding", 0x200 = only bitmaps may be embedded
  f.embeddable = (f.fsType & 0x0f) !== 2 && !(f.fsType & 0x200);
  return f;
}

/* ---------- smaller copies for embedding ---------- */
/* Keep the outlines of the used glyphs (and the parts of composite glyphs); the others become empty.
   Glyph numbers stay the same, so no table has to be renumbered. TrueType outlines only. */
function subsetTrueType(face, used) {
  const { dv, u8, tables, numGlyphs } = face;
  const glyf = tables.glyf.off;
  const locaOff = tables.loca.off;
  const loca = (g) => (face.longLoca ? dv.getUint32(locaOff + g * 4) : dv.getUint16(locaOff + g * 2) * 2);
  const keep = new Set([0]);
  for (const g of used) if (g < numGlyphs) keep.add(g);
  const stack = [...keep];
  while (stack.length) {
    const g = stack.pop();
    const s = loca(g);
    const e = loca(g + 1);
    if (e - s < 10 || dv.getInt16(glyf + s) >= 0) continue;
    let q = glyf + s + 10;
    for (let guard = 0; guard < 64; guard++) {
      const flags = dv.getUint16(q);
      const gi = dv.getUint16(q + 2);
      if (gi < numGlyphs && !keep.has(gi)) { keep.add(gi); stack.push(gi); }
      q += 4 + (flags & 1 ? 4 : 2);
      if (flags & 8) q += 2; else if (flags & 0x40) q += 4; else if (flags & 0x80) q += 8;
      if (!(flags & 0x20)) break;
    }
  }
  const parts = [];
  let total = 0;
  const newLoca = new Uint8Array((numGlyphs + 1) * 4);
  const lv = new DataView(newLoca.buffer);
  for (let g = 0; g < numGlyphs; g++) {
    lv.setUint32(g * 4, total);
    if (!keep.has(g)) continue;
    const s = loca(g);
    const len = loca(g + 1) - s;
    if (len > 0) { parts.push([s, len]); total += (len + 3) & ~3; }
  }
  lv.setUint32(numGlyphs * 4, total);
  const newGlyf = new Uint8Array(total);
  let o = 0;
  for (const [s, len] of parts) { newGlyf.set(u8.subarray(glyf + s, glyf + s + len), o); o += (len + 3) & ~3; }
  const tbl = (t) => u8.slice(tables[t].off, tables[t].off + tables[t].len);
  const head = tbl('head');
  const hv = new DataView(head.buffer);
  hv.setUint32(8, 0);
  hv.setInt16(50, 1);
  const out = [{ tag: 'head', data: head }, { tag: 'loca', data: newLoca }, { tag: 'glyf', data: newGlyf }];
  for (const t of ['hhea', 'maxp', 'hmtx', 'cvt ', 'fpgm', 'prep', 'cmap', 'OS/2', 'name', 'post']) if (tables[t]) out.push({ tag: t, data: tbl(t) });
  return sfntAssemble(0x00010000, out);
}

/* ---------- the export font ---------- */
const XFont = {
  std: { r: null, b: null },
  faces: { r: null, b: null },
  name: 'Inter',
  custom: false,
  note: '',
  ready: null,
  added: [],
  load() { this.ready = this.loadNow().catch(() => {}); return this.ready; },
  async loadNow() {
    for (const k of ['r', 'b']) {
      if (this.std[k]) continue;
      try {
        const r = await fetch(XF_FILES[k]);
        if (r.ok) this.std[k] = parseSfnt(new Uint8Array(await r.arrayBuffer()));
      } catch (e) { this.std[k] = null; }
    }
    const own = {};
    const c = Brand.cfg.font;
    if (c && c.on) {
      for (const k of ['r', 'b']) {
        try {
          const blob = await Store.getBlob('b:font:' + k);
          if (blob) own[k] = parseSfnt(new Uint8Array(await blob.arrayBuffer()));
        } catch (e) { /* this file is skipped */ }
      }
    }
    this.custom = !!own.r;
    this.faces = this.custom ? { r: own.r, b: own.b || null } : { r: this.std.r, b: this.std.b };
    this.name = this.custom ? own.r.family : 'Inter';
    this.note = this.custom && !own.r.embeddable
      ? 'The licence of this font does not allow embedding it in files. Videos use it; PDF and Word guides use Inter instead.' : '';
    await this.register();
  },
  /* FontFace for the canvas: the regular file as weight 400, the bold file as 700 (a missing bold is synthesised). */
  async register() {
    if (typeof FontFace === 'undefined' || !document.fonts) return;
    for (const f of this.added) { try { document.fonts.delete(f); } catch (e) { /* gone */ } }
    this.added = [];
    const add = async (face, weight) => {
      if (!face) return;
      try {
        const buf = face.u8.slice().buffer;
        const ff = new FontFace(XF_FAMILY, buf, { weight: String(weight), style: 'normal' });
        await ff.load();
        document.fonts.add(ff);
        this.added.push(ff);
      } catch (e) { /* the system font stack takes over */ }
    };
    await add(this.faces.r, 400);
    await add(this.faces.b, 700);
  },
  async ensure() {
    if (this.ready) await this.ready;
    try { await Promise.all([document.fonts.load(`400 24px "${XF_FAMILY}"`), document.fonts.load(`700 24px "${XF_FAMILY}"`)]); } catch (e) { /* fallback fonts */ }
  },
  /* The faces that may go into files: the user's font when its licence allows it, otherwise Inter. */
  fileFaces() {
    const own = this.custom && this.faces.r && this.faces.r.embeddable;
    const r = own ? this.faces.r : this.std.r;
    let b = own ? this.faces.b : this.std.b;
    if (b && !b.embeddable) b = null;
    return { r, b, name: own ? this.faces.r.family : 'Inter', own };
  },
  css() { return XF_STACK; },
  /* Choose font files: the lightest upright file becomes regular, the boldest upright one bold. */
  async choose(files) {
    const faces = [];
    for (const file of files) {
      const u8 = await toSfnt(new Uint8Array(await file.arrayBuffer()));
      const face = parseSfnt(u8);
      faces.push({ face, u8, name: file.name });
    }
    const upright = faces.filter((x) => !x.face.italic);
    const pool = upright.length ? upright : faces;
    pool.sort((a, b) => a.face.weight - b.face.weight);
    const regs = pool.filter((x) => !x.face.bold);
    const r = (regs.length ? regs.find((x) => x.face.weight >= 400) || regs[regs.length - 1] : pool[0]);
    const bolds = pool.filter((x) => x !== r && x.face.bold);
    const b = bolds.find((x) => x.face.weight >= 600 && x.face.weight <= 700) || bolds[0] || null;
    await Store.putBlob('b:font:r', new Blob([r.u8], { type: 'font/sfnt' }));
    if (b) await Store.putBlob('b:font:b', new Blob([b.u8], { type: 'font/sfnt' }));
    else await Store.delBlobs(['b:font:b']);
    Brand.cfg.font = { on: true, name: r.face.family, files: [r.name].concat(b ? [b.name] : []), embeddable: r.face.embeddable, cff: r.face.isCFF };
    await Brand.save();
    await this.loadNow();
  },
  async useStandard() {
    await Store.delBlobs(['b:font:r', 'b:font:b']);
    Brand.cfg.font = null;
    await Brand.save();
    await this.loadNow();
  },
};
