/* ============================================================================================================
   pdf-export.js
   What it does:    Writes the PDF guide: black cover, pages with header band, 'All steps' overview, steps with
                   pictures, contact block, page numbers.
   Change here:     Sizes, margins and order of the parts (look for buildPdf).
   Edit with care: change texts and values, not the structure.
   Technical note:  PDF writer: the export font embedded as a TrueType/OpenType CID font (Helvetica when no font
                   file is at hand), JPEG pictures, PNG-like pictures with transparency (the logo), internal links,
                   compressed streams.
   ============================================================================================================ */
const UNI2WIN = new Map([[0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
  [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a],
  [0x203a, 0x9b], [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f]]);
const PDF_TRANSLIT = new Map([[0x2192, '->'], [0x2190, '<-'], [0x2264, '<='], [0x2265, '>='], [0x2212, '-'], [0x2010, '-'],
  [0x2011, '-'], [0x2009, ' '], [0x202f, ' '], [0x200b, ''], [0x2713, 'v'], [0x2715, 'x'], [0x2248, '~']]);

function winAnsi(str) {
  let out = '';
  for (const ch of String(str == null ? '' : str).normalize('NFC')) {
    const cp = ch.codePointAt(0);
    if (cp === 9) out += ' ';
    else if (cp >= 32 && cp <= 126) out += ch;
    else if (cp >= 160 && cp <= 255) out += String.fromCharCode(cp);
    else if (UNI2WIN.has(cp)) out += String.fromCharCode(UNI2WIN.get(cp));
    else if (PDF_TRANSLIT.has(cp)) out += PDF_TRANSLIT.get(cp);
    else if (cp < 32) continue;
    else out += '?';
  }
  return out;
}
function pdfW(s, font, size) {
  const tbl = font === 'B' ? PDF_W_B : PDF_W_R;
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    w += (c >= 32 && c <= 255 ? tbl[c - 32] : 0) || 500;
  }
  return (w * size) / 1000;
}
function latin1(str) {
  const u = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) u[i] = str.charCodeAt(i) & 255;
  return u;
}
function pdfUtf16(str) {
  let hex = 'FEFF';
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}
async function deflateBytes(u8) {
  if (typeof CompressionStream === 'undefined') return { data: u8, filter: '' };
  try {
    const out = await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer();
    return { data: new Uint8Array(out), filter: ' /Filter /FlateDecode' };
  } catch (e) { return { data: u8, filter: '' }; }
}
function utf16Hex(cp) {
  if (cp < 0x10000) return cp.toString(16).padStart(4, '0').toUpperCase();
  const v = cp - 0x10000;
  return ((0xd800 + (v >> 10)).toString(16) + (0xdc00 + (v & 0x3ff)).toString(16)).toUpperCase();
}

class PdfDoc {
  /* faces: { R, B } parsed font files (export-font.js), or null for Helvetica */
  constructor(paper, faces) {
    [this.W, this.H] = paper === 'letter' ? [612, 792] : [595.28, 841.89];
    this.pages = [];
    this.images = [];
    this.cur = null;
    this.fonts = {};
    for (const k of ['R', 'B']) this.fonts[k] = faces && faces[k] ? { face: faces[k], used: new Map() } : null;
  }
  page() { this.cur = { ops: [], links: [] }; this.pages.push(this.cur); return this.cur; }
  n(v) { return String(Math.round(v * 100) / 100); }
  col(hex) {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => this.n(c / 255)).join(' ');
  }
  rect(x, y, w, h, fill) { this.cur.ops.push(`${this.col(fill)} rg ${this.n(x)} ${this.n(this.H - y - h)} ${this.n(w)} ${this.n(h)} re f`); }
  strokeRect(x, y, w, h, color, lw) { this.cur.ops.push(`${this.col(color)} RG ${this.n(lw)} w ${this.n(x)} ${this.n(this.H - y - h)} ${this.n(w)} ${this.n(h)} re S`); }
  /* 'I' (captions) uses the regular face; without a bold file, bold text uses the regular one too. */
  fontOf(key) {
    if (!this.fonts.R) return null;
    return key === 'B' ? this.fonts.B || this.fonts.R : this.fonts.R;
  }
  glyphs(str, f) {
    const out = [];
    for (const ch of String(str == null ? '' : str).normalize('NFC')) {
      let cp = ch.codePointAt(0);
      if (cp === 9 || cp === 0x2009 || cp === 0x202f || cp === 0x200a) cp = 32;
      if (cp < 32 || cp === 0x200b) continue;
      let g = f.face.cmap.get(cp);
      if (!g && PDF_TRANSLIT.has(cp)) {
        for (const c2 of PDF_TRANSLIT.get(cp)) { const g2 = f.face.cmap.get(c2.charCodeAt(0)); if (g2) out.push([g2, c2.charCodeAt(0)]); }
        continue;
      }
      if (!g) { cp = 63; g = f.face.cmap.get(63) || 0; }
      out.push([g, cp]);
    }
    return out;
  }
  measure(str, key, size, tc = 0) {
    const f = this.fontOf(key);
    if (!f) { const s = winAnsi(str); return pdfW(s, key, size) + tc * Math.max(0, s.length - 1); }
    const gl = this.glyphs(str, f);
    let w = 0;
    for (const [g] of gl) w += f.face.advances[g] || 0;
    return (w * size) / f.face.unitsPerEm + tc * Math.max(0, gl.length - 1);
  }
  wrap(raw, key, size, maxW) {
    const out = [];
    for (const para of String(raw == null ? '' : raw).replace(/\r/g, '').split('\n')) {
      const words = para.split(/[ \t]+/).filter(Boolean);
      if (!words.length) { out.push(''); continue; }
      let line = '';
      for (let w of words) {
        while (this.measure(w, key, size) > maxW && w.length > 1) {
          let k = w.length - 1;
          while (k > 1 && this.measure(w.slice(0, k), key, size) > maxW) k--;
          if (line) { out.push(line); line = ''; }
          out.push(w.slice(0, k));
          w = w.slice(k);
        }
        const test = line ? `${line} ${w}` : w;
        if (this.measure(test, key, size) <= maxW) line = test;
        else { if (line) out.push(line); line = w; }
      }
      if (line) out.push(line);
    }
    while (out.length > 1 && out[out.length - 1] === '') out.pop();
    return out;
  }
  text(x, y, str, key, size, color, tc) {
    const f = this.fontOf(key);
    let show;
    let res;
    if (!f) {
      const s = winAnsi(str);
      show = `(${s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')}) Tj`;
      res = `H${key}`;
    } else {
      let hex = '';
      for (const [g, cp] of this.glyphs(str, f)) { hex += g.toString(16).padStart(4, '0'); if (!f.used.has(g)) f.used.set(g, cp); }
      show = `<${hex}> Tj`;
      res = f === this.fonts.B ? 'FB' : 'FR';
    }
    this.cur.ops.push(`BT /${res} ${this.n(size)} Tf ${this.n(tc || 0)} Tc ${this.col(color)} rg ${this.n(x)} ${this.n(this.H - y)} Td ${show} ET`);
  }
  addImage(bytes, w, h) { this.images.push({ bytes, w, h }); return this.images.length - 1; }
  /* A canvas with transparency (the logo): RGB plus an alpha mask, both compressed. */
  async addCanvas(c) {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const n = c.width * c.height;
    const rgb = new Uint8Array(n * 3);
    const a = new Uint8Array(n);
    let alpha = false;
    for (let i = 0; i < n; i++) {
      rgb[i * 3] = d[i * 4]; rgb[i * 3 + 1] = d[i * 4 + 1]; rgb[i * 3 + 2] = d[i * 4 + 2];
      a[i] = d[i * 4 + 3];
      if (a[i] !== 255) alpha = true;
    }
    this.images.push({ raw: await deflateBytes(rgb), mask: alpha ? await deflateBytes(a) : null, w: c.width, h: c.height });
    return this.images.length - 1;
  }
  image(i, x, y, w, h) { this.cur.ops.push(`q ${this.n(w)} 0 0 ${this.n(h)} ${this.n(x)} ${this.n(this.H - y - h)} cm /Im${i} Do Q`); }
  clip(x, y, w, h) { this.cur.ops.push(`q ${this.n(x)} ${this.n(this.H - y - h)} ${this.n(w)} ${this.n(h)} re W n`); }
  unclip() { this.cur.ops.push('Q'); }
  link(x, y, w, h, page, top) { this.cur.links.push({ x, y, w, h, page, top }); }
  async build(meta) {
    const objs = [null, null];
    const add = (o) => { objs.push(o); return objs.length; };
    let v16 = false;
    const res = [];
    if (!this.fonts.R) { // no font file at hand: the standard PDF fonts
      for (const d of ['HR:Helvetica', 'HB:Helvetica-Bold', 'HI:Helvetica-Oblique']) {
        const [k, name] = d.split(':');
        res.push(`/${k} ${add(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`)} 0 R`);
      }
    }
    for (const [key, f] of Object.entries(this.fonts)) {
      if (!f || !f.used.size) continue;
      const face = f.face;
      const gids = [...f.used.keys()].sort((a, b) => a - b);
      const file = face.isCFF ? face.u8 : subsetTrueType(face, gids);
      const z = await deflateBytes(file);
      if (face.isCFF) v16 = true;
      const fileObj = add({ dict: `<< /Length ${z.data.length}${z.filter}${face.isCFF ? ' /Subtype /OpenType' : ` /Length1 ${file.length}`} >>`, stream: z.data });
      const k = 1000 / face.unitsPerEm;
      const name = `${key === 'R' ? 'FXREGA' : 'FXBOLB'}+${face.psName}`;
      const bb = face.bbox.map((v) => Math.round(v * k)).join(' ');
      const desc = add(`<< /Type /FontDescriptor /FontName /${name} /Flags ${face.italic ? 96 : 32} /FontBBox [${bb}] /ItalicAngle ${this.n(face.italicAngle)} /Ascent ${Math.round(face.ascender * k)} /Descent ${Math.round(face.descender * k)} /CapHeight ${Math.round(face.capHeight * k)} /StemV ${face.bold ? 120 : 80} /${face.isCFF ? 'FontFile3' : 'FontFile2'} ${fileObj} 0 R >>`);
      const widths = gids.map((g) => `${g} [${Math.round((face.advances[g] || 0) * k)}]`).join(' ');
      const cid = add(`<< /Type /Font /Subtype /${face.isCFF ? 'CIDFontType0' : 'CIDFontType2'} /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /DW 1000 /W [${widths}]${face.isCFF ? '' : ' /CIDToGIDMap /Identity'} >>`);
      let cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
      for (let i = 0; i < gids.length; i += 100) {
        const chunk = gids.slice(i, i + 100);
        cmap += `${chunk.length} beginbfchar\n${chunk.map((g) => `<${g.toString(16).padStart(4, '0').toUpperCase()}> <${utf16Hex(f.used.get(g))}>`).join('\n')}\nendbfchar\n`;
      }
      cmap += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';
      const tz = await deflateBytes(latin1(cmap));
      const tu = add({ dict: `<< /Length ${tz.data.length}${tz.filter} >>`, stream: tz.data });
      res.push(`/F${key} ${add(`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tu} 0 R >>`)} 0 R`);
    }
    const imgs = [];
    for (let i = 0; i < this.images.length; i++) {
      const im = this.images[i];
      let id;
      if (im.raw) {
        const mask = im.mask ? add({ dict: `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${im.mask.data.length}${im.mask.filter} >>`, stream: im.mask.data }) : 0;
        id = add({ dict: `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8${mask ? ` /SMask ${mask} 0 R` : ''} /Length ${im.raw.data.length}${im.raw.filter} >>`, stream: im.raw.data });
      } else {
        id = add({ dict: `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>`, stream: im.bytes });
      }
      imgs.push(`/Im${i} ${id} 0 R`);
    }
    const resources = `<< /Font << ${res.join(' ')} >>${imgs.length ? ` /XObject << ${imgs.join(' ')} >>` : ''} >>`;
    const pageIds = this.pages.map(() => add(null));
    for (let i = 0; i < this.pages.length; i++) {
      const p = this.pages[i];
      const z = await deflateBytes(latin1(p.ops.join('\n')));
      const cid = add({ dict: `<< /Length ${z.data.length}${z.filter} >>`, stream: z.data });
      const annots = p.links.filter((l) => pageIds[l.page]).map((l) => add(`<< /Type /Annot /Subtype /Link /Rect [${this.n(l.x)} ${this.n(this.H - l.y - l.h)} ${this.n(l.x + l.w)} ${this.n(this.H - l.y)}] /Border [0 0 0] /Dest [${pageIds[l.page]} 0 R /XYZ 0 ${this.n(this.H - Math.max(0, l.top - 12))} 0] >>`));
      objs[pageIds[i] - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.n(this.W)} ${this.n(this.H)}] /Resources ${resources} /Contents ${cid} 0 R${annots.length ? ` /Annots [${annots.map((a) => `${a} 0 R`).join(' ')}]` : ''} >>`;
    }
    objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
    objs[1] = `<< /Type /Pages /Kids [${pageIds.map((k) => `${k} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    const d = new Date();
    const p2 = (x) => String(x).padStart(2, '0');
    const ds = `D:${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;
    const info = add(`<< /Title ${pdfUtf16(meta.title)} /Author ${pdfUtf16(meta.author)} /Creator (Fixframe) /Producer (Fixframe) /CreationDate (${ds}) >>`);
    const parts = [];
    let pos = 0;
    const offs = [];
    const push = (x) => { const u = typeof x === 'string' ? latin1(x) : x; parts.push(u); pos += u.length; };
    push(`%PDF-${v16 ? '1.6' : '1.4'}\n%âãÏÓ\n`);
    objs.forEach((o, i) => {
      offs.push(pos);
      push(`${i + 1} 0 obj\n`);
      if (typeof o === 'string') push(o);
      else { push(o.dict); push('\nstream\n'); push(o.stream); push('\nendstream'); }
      push('\nendobj\n');
    });
    const xref = pos;
    let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const o of offs) x += `${String(o).padStart(10, '0')} 00000 n \n`;
    push(x);
    push(`trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }
}

/* The guide as a PDF: dark cover with the first step as hero, then light (or dark) pages with a black header band,
   tools and safety side by side, an overview of all steps as picture cards, the steps, and a contact block. */
async function buildPdf(data, opts) {
  const ff = XFont.fileFaces();
  const pdf = new PdfDoc(opts.paper, ff.r ? { R: ff.r, B: ff.b || null } : null);
  const L = xl();
  const dark = Brand.cfg.pdfPages === 'dark';
  const C = dark
    ? { bg: XT.black, ink: XT.white, ink2: XT.grey1, ink3: XT.grey2, rule: XT.line, stage: XT.stage, panel: XT.panel, cBg: XT.cautionBgDark, cInk: XT.white, cBar: XT.caution, cLabel: XT.caution, accent: XT.brown }
    : { bg: XT.paper, ink: XT.ink, ink2: XT.ink2, ink3: XT.ink3, rule: XT.rule, stage: XT.stageLight, panel: XT.wash, cBg: XT.cautionBg, cInk: XT.cautionInk, cBar: XT.cautionDeep, cLabel: XT.cautionDeep, accent: XT.brown };
  const M = { l: 48, r: 48, t: 74, b: 66 };
  const CW = pdf.W - M.l - M.r;
  const bandH = 34;
  const logo = logoCanvas(480);
  const logoIdx = logo ? await pdf.addCanvas(logo) : -1;
  const lw = logo ? logo.width : 0;
  const lh = logo ? logo.height : 0;
  if (logo) freeCanvas(logo);
  const eyebrow = (x, y, t, size, color) => pdf.text(x, y, String(t).toUpperCase(), 'B', size, color, size * 0.14);
  const drawLogo = (x, y, maxW, maxH) => {
    if (logoIdx < 0) return 0;
    const s = Math.min(maxW / lw, maxH / lh);
    pdf.image(logoIdx, x, y + (maxH - lh * s) / 2, lw * s, lh * s);
    return lw * s;
  };
  /* Picture on a grey stage: "contain" keeps markup at the edges visible, "cover" fills the stage. */
  const stage = async (im, x, y, w, h, fit, color) => {
    pdf.rect(x, y, w, h, color || C.stage);
    if (!im) return;
    const idx = im.idx != null ? im.idx : (im.idx = pdf.addImage(await blobBytes(im.blob), im.w, im.h));
    if (fit === 'cover') {
      const s = Math.max(w / im.w, h / im.h);
      pdf.clip(x, y, w, h);
      pdf.image(idx, x + (w - im.w * s) / 2, y + (h - im.h * s) / 2, im.w * s, im.h * s);
      pdf.unclip();
    } else {
      const pad = Math.min(w, h) * 0.04;
      const s = Math.min((w - pad * 2) / im.w, (h - pad * 2) / im.h);
      pdf.image(idx, x + (w - im.w * s) / 2, y + (h - im.h * s) / 2, im.w * s, im.h * s);
    }
  };

  /* ---------- cover ---------- */
  pdf.page();
  pdf.rect(0, 0, pdf.W, pdf.H, XT.black);
  if (!drawLogo(M.l, 44, 150, 34) && data.company) eyebrow(M.l, 64, data.company, 9, XT.white);
  // opening title, centred (brand): label in brown, title in white, details in grey
  const centreAt = (yy, t, font, size, color, track) => pdf.text((pdf.W - pdf.measure(t, font, size, track || 0)) / 2, yy, t, font, size, color, track || 0);
  let y = 196;
  const kick = String(L.guide).toUpperCase();
  centreAt(y, kick, 'B', 8.5, XT.brown, 8.5 * 0.14);
  y += 20;
  const tl = pdf.wrap(data.title, 'B', 31, CW * 0.9).slice(0, 3);
  tl.forEach((ln, i) => centreAt(y + 24 + i * 35, ln, 'B', 31, XT.white, -0.25));
  y += tl.length * 35 + 14;
  const sub = data.claim || xFirstSentence(data.intro, 140);
  if (sub) {
    const sl = pdf.wrap(sub, 'R', 13, CW * 0.8).slice(0, 3);
    sl.forEach((ln, i) => centreAt(y + 13 + i * 18.5, ln, 'R', 13, XT.grey1));
    y += sl.length * 18.5 + 8;
  }
  const meta = [L.steps(data.steps.length), longDate(data.date)].concat(data.author ? [data.author] : []).join('   ·   ');
  centreAt(y + 16, meta, 'R', 9, XT.grey2);
  y += 40;
  const coverBottom = pdf.H - 84;
  if (data.hero) {
    const hh = Math.min((CW * 2) / 3, coverBottom - y);
    if (hh > 120) await stage(data.hero, M.l, y, CW, hh, 'cover', XT.stage);
  }
  pdf.rect(M.l, pdf.H - 58, CW, 0.6, XT.line);
  pdf.text(M.l, pdf.H - 40, data.company || data.title, 'R', 8, XT.grey2);
  const rightCover = L.guide;
  pdf.text(pdf.W - M.r - pdf.measure(rightCover, 'R', 8), pdf.H - 40, rightCover, 'R', 8, XT.grey2);

  /* ---------- content pages ---------- */
  const newPage = () => {
    pdf.page();
    if (dark) pdf.rect(0, 0, pdf.W, pdf.H, XT.black);
    pdf.rect(0, 0, pdf.W, bandH, XT.black);
    if (dark) pdf.rect(0, bandH, pdf.W, 0.6, XT.line);
    if (!drawLogo(M.l, 9, 90, bandH - 18) && data.company) eyebrow(M.l, 21, data.company, 7, XT.white);
    const t = pdf.wrap(String(data.title).toUpperCase(), 'B', 7, CW * 0.55)[0] || '';
    pdf.text(pdf.W - M.r - pdf.measure(t, 'B', 7, 1), 21, t, 'B', 7, XT.grey1, 1);
    y = M.t;
  };
  const bottom = () => pdf.H - M.b;
  const need = (hh) => { if (y + hh > bottom()) newPage(); };
  const para = (raw, o = {}) => {
    const size = o.size || 10.5;
    const lhh = (o.lh || 1.5) * size;
    for (const ln of pdf.wrap(raw, o.font || 'R', size, o.width || CW)) {
      need(lhh);
      if (ln) pdf.text(M.l + (o.indent || 0), y + lhh / 2 + size * 0.36, ln, o.font || 'R', size, o.color || C.ink);
      y += lhh;
    }
    y += o.after == null ? 6 : o.after;
  };
  const sectionTitle = (kicker, title) => {
    need(64);
    eyebrow(M.l, y + 8, kicker, 7.5, C.accent);
    y += 16;
    if (title) { pdf.text(M.l, y + 17, title, 'B', 18, C.ink, -0.1); y += 30; }
  };
  newPage();
  if (data.intro) {
    sectionTitle(L.intro, '');
    para(data.intro, { size: 11.5, lh: 1.55, after: 18 });
  }
  // tools and safety: two blocks side by side, as on the product pages
  const blocks = [];
  if (data.tools.length) blocks.push({ title: L.tools, items: data.tools, safety: false });
  if (data.safety.length) blocks.push({ title: L.safety, items: data.safety, safety: true });
  if (blocks.length) {
    const gap = 14;
    const bw = blocks.length === 2 ? (CW - gap) / 2 : CW;
    const lay = blocks.map((b) => {
      const rows = b.items.map((t) => pdf.wrap(t, 'R', 10, bw - 40));
      return Object.assign({ rows, h: 46 + rows.reduce((a, r) => a + r.length * 14 + 5, 0) }, b);
    });
    const bh = Math.max(...lay.map((b) => b.h));
    if (bh <= bottom() - M.t) {
      need(bh + 10);
      lay.forEach((b, i) => {
        const x = M.l + i * (bw + gap);
        pdf.rect(x, y, bw, bh, b.safety ? C.cBg : C.panel);
        if (b.safety) pdf.rect(x, y, 3, bh, C.cBar);
        eyebrow(x + 18, y + 26, b.title, 7.5, b.safety ? C.cLabel : C.accent);
        let yy = y + 44;
        for (const r of b.rows) {
          pdf.rect(x + 18, yy - 7.2, 4, 4, b.safety ? C.cBar : C.ink);
          r.forEach((ln, k) => pdf.text(x + 30, yy + k * 14, ln, 'R', 10, b.safety ? C.cInk : C.ink));
          yy += r.length * 14 + 5;
        }
      });
      y += bh + 26;
    } else {
      for (const b of lay) { sectionTitle(b.title, ''); for (const t of b.items) para(`•  ${t}`, { size: 10, after: 2 }); y += 12; }
    }
  }
  // overview: one card per step (picture on the grey stage, label, title), each a link to its step
  const stepPos = [];
  const links = [];
  if (data.steps.length > 1) {
    sectionTitle(L.overview, L.steps(data.steps.length));
    const cols = 3;
    const gap = 12;
    const cw = (CW - gap * (cols - 1)) / cols;
    const ch = (cw * 2) / 3;
    for (let i = 0; i < data.steps.length; i += cols) {
      const row = data.steps.slice(i, i + cols);
      const tls = row.map((st) => pdf.wrap(st.title, 'B', 9.5, cw).slice(0, 3));
      const rh = ch + 26 + Math.max(...tls.map((t) => t.length)) * 12.5;
      need(rh + 12);
      row.forEach((st, k) => {
        const x = M.l + k * (cw + gap);
        links.push({ page: pdf.pages.length - 1, x, y, w: cw, h: rh, n: st.n });
        st.thumb = { x, y, w: cw, h: ch };
        eyebrow(x, y + ch + 15, xStepLabel(st.n), 6.5, C.accent);
        tls[k].forEach((ln, j) => pdf.text(x, y + ch + 30 + j * 12.5, ln, 'B', 9.5, C.ink));
      });
      for (const st of row) await stage(st.images[0], st.thumb.x, st.thumb.y, st.thumb.w, st.thumb.h, 'contain');
      y += rh + 14;
    }
    y += 10;
  }
  // the steps
  for (const st of data.steps) {
    const first = st.images[0];
    const firstH = first ? Math.min(200, (CW * first.h) / first.w) : 0;
    // keep label, title, text, caution and the first picture together
    const textH = (st.desc ? pdf.wrap(st.desc, 'R', 10.5, CW).length * 10.5 * 1.55 + 10 : 0)
      + (st.caution ? 54 + pdf.wrap(st.caution, 'R', 10, CW - 40).length * 14.5 : 0)
      + pdf.wrap(st.title, 'B', 18, CW).length * 23;
    need(Math.min(60 + textH + firstH, bottom() - M.t - 10));
    if (y > M.t + 1) { pdf.rect(M.l, y, CW, 0.6, C.rule); y += 22; }
    stepPos[st.n] = { page: pdf.pages.length - 1, y };
    eyebrow(M.l, y + 8, xStepLabel(st.n, data.steps.length), 7.5, C.accent);
    y += 16;
    const tl2 = pdf.wrap(st.title, 'B', 18, CW);
    for (const ln of tl2) { need(23); pdf.text(M.l, y + 17, ln, 'B', 18, C.ink, -0.1); y += 23; }
    y += 8;
    if (st.desc) para(st.desc, { size: 10.5, lh: 1.55, after: 10 });
    if (st.caution) {
      const cl = pdf.wrap(st.caution, 'R', 10, CW - 40);
      const boxH = 40 + cl.length * 14.5;
      need(boxH + 8);
      pdf.rect(M.l, y, CW, boxH, C.cBg);
      pdf.rect(M.l, y, 3, boxH, C.cBar);
      eyebrow(M.l + 18, y + 20, L.caution, 7, C.cLabel);
      cl.forEach((ln, i) => pdf.text(M.l + 18, y + 36 + i * 14.5, ln, 'R', 10, C.cInk));
      y += boxH + 14;
    }
    if (st.images.length === 1) {
      const im = st.images[0];
      const cap = im.caption ? pdf.wrap(im.caption, 'R', 8.5, CW) : [];
      // the picture shrinks to the space left on the page, down to 200 pt, before it moves to the next page
      if (bottom() - y - 8 - cap.length * 12 < 200) newPage();
      const maxH = Math.min(330, bottom() - y - 8 - cap.length * 12);
      const s = Math.min(CW / im.w, maxH / im.h);
      const ih = im.h * s;
      await stage(im, M.l, y, CW, ih, 'contain');
      y += ih + 6;
      cap.forEach((ln) => { pdf.text(M.l, y + 8.5, ln, 'R', 8.5, C.ink3); y += 12; });
      y += 12;
    } else if (st.images.length > 1) {
      const gap = 12;
      const cw = (CW - gap) / 2;
      const ch = (cw * 2) / 3;
      for (let i = 0; i < st.images.length; i += 2) {
        const row = st.images.slice(i, i + 2);
        const caps = row.map((im) => (im.caption ? pdf.wrap(im.caption, 'R', 8.5, cw).slice(0, 3) : []));
        const rh = ch + 6 + Math.max(...caps.map((c) => c.length)) * 12;
        need(rh + 10);
        for (let k = 0; k < row.length; k++) {
          const x = M.l + k * (cw + gap);
          await stage(row[k], x, y, cw, ch, 'contain');
          caps[k].forEach((ln, j) => pdf.text(x, y + ch + 14 + j * 12, ln, 'R', 8.5, C.ink3));
        }
        y += rh + 12;
      }
    }
    y += 10;
  }
  // contact block, like the call to action at the end of the product pages
  if (data.company || data.contact.length) {
    const cl = data.contact.flatMap((t) => pdf.wrap(t, 'R', 10, CW - 48));
    const boxH = 70 + cl.length * 15;
    need(boxH + 40);
    y += 8;
    pdf.rect(M.l, y, CW, boxH, dark ? XT.panel : XT.black);
    eyebrow(M.l + 24, y + 26, data.company || L.contact, 7.5, XT.brown);
    pdf.text(M.l + 24, y + 48, L.ask, 'B', 15, XT.white, -0.1);
    cl.forEach((ln, i) => pdf.text(M.l + 24, y + 70 + i * 15, ln, 'R', 10, XT.grey1));
    y += boxH + 14;
    const rights = xRights(data.date);
    if (rights) { pdf.text(M.l, y + 8, rights, 'R', 8, C.ink3); y += 16; }
  }

  // links from the overview cards to their steps
  for (const l of links) {
    const target = stepPos[l.n];
    if (target) pdf.pages[l.page].links.push({ x: l.x, y: l.y, w: l.w, h: l.h, page: target.page, top: target.y });
  }
  const total = pdf.pages.length;
  pdf.pages.forEach((pg, i) => {
    if (i === 0) return;
    pdf.cur = pg;
    const right = L.page(i + 1, total);
    pdf.rect(M.l, pdf.H - 46, CW, 0.6, C.rule);
    const leftRaw = [data.company, data.title].filter(Boolean).join('  ·  ');
    const left = pdf.wrap(leftRaw, 'R', 7.5, CW - pdf.measure(right, 'R', 7.5) - 24)[0] || '';
    pdf.text(M.l, pdf.H - 32, left, 'R', 7.5, C.ink3);
    pdf.text(pdf.W - M.r - pdf.measure(right, 'R', 7.5), pdf.H - 32, right, 'R', 7.5, C.ink3);
  });
  return pdf.build({ title: data.title, author: data.author || data.company });
}
