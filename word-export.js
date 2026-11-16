/* ============================================================================================================
   word-export.js
   What it does:    Writes the Word (.docx) guide: title banner, tools and safety, step overview, steps with
                   pictures, header and footer.
   Change here:     Sizes and texts of the parts (look for buildDocx).
   Edit with care: change texts and values, not the structure.
   Technical note:  Word (.docx) writer: WordprocessingML parts in a stored ZIP, in the export look: black title
                   banner with the first step, tools and safety side by side, step cards linked to the steps,
                   pictures on grey, embedded export font, header and footer.
   ============================================================================================================ */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(files, type) {
  const enc = new TextEncoder();
  const now = new Date();
  const dtime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const ddate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, dtime, true); lh.setUint16(12, ddate, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, dtime, true); ch.setUint16(14, ddate, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, p) => a + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true);
  end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true);
  return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: type || 'application/zip' });
}

function xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// Children of w:pPr and w:rPr must follow the schema order, or Word reports the file as damaged.
function wpPr(o) {
  let x = '';
  if (o.style) x += `<w:pStyle w:val="${o.style}"/>`;
  if (o.keepNext) x += '<w:keepNext/>';
  if (o.keepLines) x += '<w:keepLines/>';
  if (o.tabs) x += `<w:tabs>${o.tabs}</w:tabs>`;
  if (o.spacing) x += `<w:spacing ${o.spacing}/>`;
  if (o.ind) x += `<w:ind ${o.ind}/>`;
  if (o.jc) x += `<w:jc w:val="${o.jc}"/>`;
  return x ? `<w:pPr>${x}</w:pPr>` : '';
}
function wrPr(o) {
  let x = '';
  if (o.b) x += '<w:b/><w:bCs/>';
  if (o.i) x += '<w:i/><w:iCs/>';
  if (o.caps) x += '<w:caps/>';
  if (o.color) x += `<w:color w:val="${o.color}"/>`;
  if (o.spacing) x += `<w:spacing w:val="${o.spacing}"/>`;
  if (o.sz) x += `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>`;
  if (o.u) x += '<w:u w:val="single"/>';
  return x ? `<w:rPr>${x}</w:rPr>` : '';
}
const W_TAB = '<w:r><w:tab/></w:r>';
function wRun(text, r = {}) { return `<w:r>${wrPr(r)}<w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`; }
function wPara(runs, p = {}) { return `<w:p>${wpPr(p)}${runs}</w:p>`; }
function wParas(text, p = {}, r = {}) {
  return String(text || '').replace(/\r/g, '').split('\n').map((ln) => wPara(ln ? wRun(ln, r) : '', p)).join('');
}


function docxStyles(font, lang, tabPos) {
  const f = xmlEsc(font);
  const st = (type, id, name, extra) => `<w:style w:type="${type}"${id === 'Normal' ? ' w:default="1"' : ''}${/^(Kicker|StepKicker|Subtitle2|Meta|ListItem|Caution|Picture|CellText|Banner)$/.test(id) ? ' w:customStyle="1"' : ''} w:styleId="${id}"><w:name w:val="${name}"/>${extra}</w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:eastAsia="${f}" w:cs="${f}"/><w:color w:val="0D0D0D"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="${lang}"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
${st('paragraph', 'Normal', 'Normal', '<w:qFormat/>')}
${st('paragraph', 'Title', 'Title', '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="60" w:after="200" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val="FFFFFF"/><w:spacing w:val="-10"/><w:sz w:val="60"/><w:szCs w:val="60"/></w:rPr>')}
${st('paragraph', 'Subtitle', 'Subtitle', '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="200" w:line="300" w:lineRule="auto"/></w:pPr><w:rPr><w:color w:val="C2C2C2"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr>')}
${st('paragraph', 'Meta', 'Meta', '<w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="8F8F8F"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>')}
${st('paragraph', 'Kicker', 'Kicker', '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="100"/></w:pPr><w:rPr><w:b/><w:bCs/><w:caps/><w:color w:val="7A7A7A"/><w:spacing w:val="28"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr>')}
${st('paragraph', 'StepKicker', 'Step label', '<w:basedOn w:val="Kicker"/><w:next w:val="Heading1"/><w:pPr><w:keepNext/><w:pBdr><w:top w:val="single" w:sz="4" w:space="18" w:color="D9D9D9"/></w:pBdr><w:spacing w:before="480" w:after="100"/></w:pPr>')}
${st('paragraph', 'Heading1', 'heading 1', '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="0" w:after="160" w:line="252" w:lineRule="auto"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/><w:spacing w:val="-6"/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr>')}
${st('paragraph', 'Heading2', 'heading 2', '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="0" w:after="240" w:line="252" w:lineRule="auto"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:bCs/><w:spacing w:val="-6"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>')}
${st('paragraph', 'ListItem', 'List Item', '<w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="80"/><w:ind w:left="300" w:hanging="300"/></w:pPr>')}
${st('paragraph', 'Caution', 'Caution', '<w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:pBdr><w:left w:val="single" w:sz="24" w:space="10" w:color="C79100"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="FFF6D9"/><w:spacing w:before="160" w:after="240"/><w:ind w:left="240" w:right="120"/></w:pPr><w:rPr><w:color w:val="4A3700"/></w:rPr>')}
${st('paragraph', 'Caption', 'caption', '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="80" w:after="200"/></w:pPr><w:rPr><w:color w:val="7A7A7A"/><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr>')}
${st('paragraph', 'Picture', 'Picture', '<w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>')}
${st('paragraph', 'CellText', 'Cell Text', '<w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/></w:pPr>')}
${st('paragraph', 'Header', 'header', `<w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="6" w:color="D9D9D9"/></w:pBdr><w:tabs><w:tab w:val="right" w:pos="${tabPos}"/></w:tabs><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="7A7A7A"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr>`)}
${st('paragraph', 'Footer', 'footer', `<w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="6" w:color="D9D9D9"/></w:pBdr><w:tabs><w:tab w:val="right" w:pos="${tabPos}"/></w:tabs><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="7A7A7A"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr>`)}
</w:styles>`;
}
function newGuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  const hx = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `{${hx.slice(0, 8)}-${hx.slice(8, 12)}-${hx.slice(12, 16)}-${hx.slice(16, 20)}-${hx.slice(20)}}`;
}
/* Embedded fonts in Word files are "obfuscated": the first 32 bytes XOR the font key (ECMA-376 Part 1, 17.8.1). */
function obfuscateFont(u8, guid) {
  const hx = guid.replace(/[{}-]/g, '');
  const key = [];
  for (let i = 0; i < 16; i++) key.push(parseInt(hx.substr(30 - i * 2, 2), 16));
  const out = u8.slice();
  for (let i = 0; i < 32 && i < out.length; i++) out[i] ^= key[i % 16];
  return out;
}

async function buildDocx(data, opts) {
  const L = xl();
  const letter = opts.paper === 'letter';
  const pg = letter ? { w: 12240, h: 15840, m: 1080 } : { w: 11906, h: 16838, m: 1134 };
  const CW = pg.w - pg.m * 2; // content width in twips
  const T2E = 635;
  const ff = XFont.fileFaces();
  const fontName = ff.name || 'Inter';
  const n = data.steps.length;
  const media = [];
  const rels = [];
  let mid = 0;
  const addMedia = (bytes, ext) => {
    mid++;
    const rid = `rIdImg${mid}`;
    media.push({ name: `word/media/image${mid}.${ext}`, data: bytes });
    rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${mid}.${ext}"/>`);
    return { rid, file: `media/image${mid}.${ext}` };
  };
  const ridOf = async (im) => im.rid || (im.rid = addMedia(await blobBytes(im.blob), 'jpeg').rid);
  let did = 0;
  const drawing = (rid, cx, cy, crop) => {
    did++;
    const src = crop ? `<a:srcRect l="${crop.l}" t="${crop.t}" r="${crop.r}" b="${crop.b}"/>` : '';
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${Math.round(cx)}" cy="${Math.round(cy)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${did}" name="Picture ${did}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${did}" name="Picture ${did}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/>${src}<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  };
  const coverCrop = (w, h, aspect) => {
    const r = w / h;
    if (Math.abs(r - aspect) < 0.01) return null;
    if (r > aspect) { const c = Math.round(((1 - (aspect * h) / w) / 2) * 100000); return { l: c, r: c, t: 0, b: 0 }; }
    const c = Math.round(((1 - w / aspect / h) / 2) * 100000);
    return { l: 0, r: 0, t: c, b: c };
  };
  const cell = (w, xml, o = {}) => {
    const m = (k) => (o[k] != null ? o[k] : o.m || 0);
    const borders = o.left ? `<w:tcBorders><w:left w:val="single" w:sz="${o.left.sz}" w:space="0" w:color="${o.left.color}"/></w:tcBorders>` : '';
    return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${borders}${o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : ''}<w:tcMar><w:top w:w="${m('mt')}" w:type="dxa"/><w:left w:w="${m('ml')}" w:type="dxa"/><w:bottom w:w="${m('mb')}" w:type="dxa"/><w:right w:w="${m('mr')}" w:type="dxa"/></w:tcMar>${o.valign ? `<w:vAlign w:val="${o.valign}"/>` : ''}</w:tcPr>${xml || '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>'}</w:tc>`;
  };
  const row = (cells, height) => `<w:tr><w:trPr><w:cantSplit/>${height ? `<w:trHeight w:val="${height}" w:hRule="exact"/>` : ''}</w:trPr>${cells}</w:tr>`;
  const table = (widths, rows) => `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`;
  const gapPara = (after = 240) => wPara('', { spacing: `w:before="0" w:after="${after}" w:line="120" w:lineRule="exact"` });
  const kicker = (t, color) => wPara(wRun(t, color ? { color } : {}), { style: 'Kicker' });

  // logo (PNG keeps its transparency), used in the banner and the page header
  let logo = null;
  const lc = logoCanvas(480);
  if (lc) {
    const png = await canvasToBlob(lc, 'image/png');
    logo = Object.assign(addMedia(await blobBytes(png), 'png'), { ar: lc.width / lc.height });
    freeCanvas(lc);
  }
  const logoRun = (hEmu, maxWEmu) => {
    let h = hEmu;
    let w = h * logo.ar;
    if (w > maxWEmu) { w = maxWEmu; h = w / logo.ar; }
    return drawing(logo.rid, w, h);
  };

  let body = '';
  /* ---------- title banner: black, like the stage of the product pages ---------- */
  const inner = CW - 960;
  let bx = '';
  if (logo) bx += wPara(logoRun(320040, 1645920), { spacing: 'w:before="0" w:after="480"' });
  else if (data.company) bx += wPara(wRun(data.company, { b: true, caps: true, color: 'FFFFFF', spacing: 28, sz: 18 }), { spacing: 'w:before="0" w:after="480"' });
  bx += kicker(L.guide, '8F8F8F');
  bx += wPara(wRun(data.title), { style: 'Title' });
  const sub = data.claim || xFirstSentence(data.intro, 160);
  if (sub) bx += wPara(wRun(sub), { style: 'Subtitle' });
  bx += wPara(wRun([L.steps(n), longDate(data.date)].concat(data.author ? [`${L.madeBy} ${data.author}`] : []).join('   ·   ')), { style: 'Meta' });
  if (data.hero) {
    const cx = inner * T2E;
    bx += wPara(drawing(await ridOf(data.hero), cx, (cx * 2) / 3, coverCrop(data.hero.w, data.hero.h, 1.5)), { style: 'Picture', spacing: 'w:before="360" w:after="0"' });
  }
  body += table([CW], [row(cell(CW, bx, { fill: '0D0D0D', m: 480 }))]);
  body += gapPara(360);

  if (data.intro) { body += kicker(L.intro); body += wParas(data.intro, { spacing: 'w:after="160"' }); body += gapPara(240); }

  /* ---------- tools and safety side by side ---------- */
  const listBlock = (title, items, safety) => kicker(title, safety ? 'C79100' : null)
    + items.map((t) => wPara(wRun('■', { color: safety ? 'C79100' : '0D0D0D', sz: 14 }) + W_TAB + wRun(t, safety ? { color: '4A3700' } : {}), { style: 'ListItem' })).join('');
  const blocks = [];
  if (data.tools.length) blocks.push({ xml: listBlock(L.tools, data.tools, false), fill: 'F2F2F2' });
  if (data.safety.length) blocks.push({ xml: listBlock(L.safety, data.safety, true), fill: 'FFF6D9', left: { sz: 24, color: 'C79100' } });
  if (blocks.length === 2) {
    const w = (CW - 240) / 2;
    body += table([w, 240, w], [row(cell(w, blocks[0].xml, { fill: blocks[0].fill, m: 320 }) + cell(240, '') + cell(w, blocks[1].xml, { fill: blocks[1].fill, m: 320, left: blocks[1].left }))]);
    body += gapPara(360);
  } else if (blocks.length === 1) {
    body += table([CW], [row(cell(CW, blocks[0].xml, { fill: blocks[0].fill, m: 320, left: blocks[0].left }))]);
    body += gapPara(360);
  }

  /* ---------- all steps as cards: picture (3:2), label, title linked to the step ---------- */
  if (n > 1) {
    body += kicker(L.overview);
    body += wPara(wRun(L.steps(n)), { style: 'Heading2' });
    const cw = Math.floor((CW - 480) / 3);
    const widths = [cw, 240, cw, 240, cw];
    const rows = [];
    for (let i = 0; i < n; i += 3) {
      const grp = data.steps.slice(i, i + 3);
      let pics = '';
      let texts = '';
      for (let k = 0; k < 3; k++) {
        const st = grp[k];
        if (k) { pics += cell(240, ''); texts += cell(240, ''); }
        if (!st) { pics += cell(cw, ''); texts += cell(cw, ''); continue; }
        const im = st.images[0];
        const cx = cw * T2E;
        pics += cell(cw, im
          ? wPara(drawing(await ridOf(im), cx, (cx * 2) / 3, coverCrop(im.w, im.h, 1.5)), { style: 'Picture' })
          : wPara(wRun(String(st.n), { b: true, color: '9A9A9A', sz: 72 }), { style: 'Picture', spacing: 'w:before="480" w:after="480"' }), { fill: 'E6E6E6' });
        texts += cell(cw, wPara(wRun(xStepLabel(st.n), { b: true, caps: true, color: '7A7A7A', spacing: 28, sz: 14 }), { style: 'CellText', spacing: 'w:before="140" w:after="40"' })
          + `<w:p>${wpPr({ style: 'CellText' })}<w:hyperlink w:anchor="step_${st.n}" w:history="1">${wRun(st.title, { b: true, sz: 19 })}</w:hyperlink></w:p>`);
      }
      rows.push(row(pics), row(texts), row(cell(cw, '') + cell(240, '') + cell(cw, '') + cell(240, '') + cell(cw, ''), 360));
    }
    body += table(widths, rows);
    body += gapPara(120);
  }

  /* ---------- the steps ---------- */
  for (const st of data.steps) {
    body += wPara(wRun(xStepLabel(st.n, n)), { style: 'StepKicker' });
    body += `<w:p>${wpPr({ style: 'Heading1' })}<w:bookmarkStart w:id="${st.n}" w:name="step_${st.n}"/>${wRun(st.title)}<w:bookmarkEnd w:id="${st.n}"/></w:p>`;
    if (st.desc) body += wParas(st.desc, { keepNext: true });
    if (st.caution) body += wPara(wRun(`${L.caution.toUpperCase()}  `, { b: true, color: 'C79100', spacing: 20, sz: 15 }) + wRun(st.caution.replace(/\s*\n\s*/g, ' ')), { style: 'Caution' });
    if (st.images.length === 1) {
      const im = st.images[0];
      const iw = CW - 480;
      const s = Math.min((iw * T2E) / im.w, 3900000 / im.h);
      body += table([CW], [row(cell(CW, wPara(drawing(await ridOf(im), im.w * s, im.h * s), { style: 'Picture' }), { fill: 'E6E6E6', m: 240 }))]);
      body += im.caption ? wPara(wRun(im.caption), { style: 'Caption' }) : gapPara(120);
    } else if (st.images.length > 1) {
      const w = (CW - 240) / 2;
      const iw = w - 320;
      const rows = [];
      for (let i = 0; i < st.images.length; i += 2) {
        const pair = st.images.slice(i, i + 2);
        let pics = '';
        let caps = '';
        for (let k = 0; k < 2; k++) {
          const im = pair[k];
          if (k) { pics += cell(240, ''); caps += cell(240, ''); }
          if (!im) { pics += cell(w, ''); caps += cell(w, ''); continue; }
          const s = Math.min((iw * T2E) / im.w, 2600000 / im.h);
          pics += cell(w, wPara(drawing(await ridOf(im), im.w * s, im.h * s), { style: 'Picture' }), { fill: 'E6E6E6', m: 160, valign: 'center' });
          caps += cell(w, im.caption ? wPara(wRun(im.caption), { style: 'Caption', spacing: 'w:before="80" w:after="80"' }) : '');
        }
        rows.push(row(pics), row(caps));
      }
      body += table([w, 240, w], rows);
      body += gapPara(120);
    }
  }

  /* ---------- contact block and copyright ---------- */
  if (data.company || data.contact.length) {
    let cx = kicker(data.company || L.contact, '8F8F8F');
    cx += wPara(wRun(L.ask, { b: true, color: 'FFFFFF', sz: 30 }), { spacing: 'w:after="160"' });
    cx += data.contact.map((t) => wPara(wRun(t, { color: 'C2C2C2' }), { spacing: 'w:after="40"' })).join('');
    body += gapPara(360);
    body += table([CW], [row(cell(CW, cx, { fill: '0D0D0D', m: 480 }))]);
    const rights = xRights(data.date);
    body += rights ? wPara(wRun(rights, { color: '7A7A7A', sz: 16 }), { spacing: 'w:before="160"' }) : gapPara(0);
  }

  /* ---------- header (from page 2), footer with page numbers ---------- */
  const hdrRels = [];
  let hdrLeft = '';
  if (logo) {
    hdrRels.push(`<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${logo.file}"/>`);
    let h = 192024;
    let w = h * logo.ar;
    if (w > 1188720) { w = 1188720; h = w / logo.ar; }
    hdrLeft = drawing('rIdLogo', w, h);
  } else if (data.company) hdrLeft = wRun(data.company, { b: true, caps: true, spacing: 20 });
  const NSW = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr ${NSW}><w:p>${wpPr({ style: 'Header' })}${hdrLeft}${W_TAB}${wRun(data.title, { caps: true, spacing: 20 })}</w:p></w:hdr>`;
  const field = (code) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const pageText = L.page('\u0001', '\u0002').split(/(\u0001|\u0002)/).map((p) => (p === '\u0001' ? field('PAGE') : p === '\u0002' ? field('NUMPAGES') : p ? wRun(p) : '')).join('');
  const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr ${NSW}><w:p>${wpPr({ style: 'Footer' })}${wRun([data.company, data.title].filter(Boolean).join('  ·  '))}${W_TAB}${pageText}</w:p></w:ftr>`;
  // the first page (the black banner) gets an empty header and footer of its own
  const emptyHdr = (tag) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:${tag} ${NSW}><w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p></w:${tag}>`;
  const sect = `<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader1"/><w:headerReference w:type="first" r:id="rIdHeader0"/><w:footerReference w:type="default" r:id="rIdFooter1"/><w:footerReference w:type="first" r:id="rIdFooter0"/><w:pgSz w:w="${pg.w}" w:h="${pg.h}"/><w:pgMar w:top="${pg.m}" w:right="${pg.m}" w:bottom="${pg.m}" w:left="${pg.m}" w:header="567" w:footer="567" w:gutter="0"/><w:titlePg/></w:sectPr>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NSW}><w:body>${body}${sect}</w:body></w:document>`;

  /* ---------- the export font, embedded when it has TrueType outlines and its licence allows it ---------- */
  const fontFiles = [];
  const fontRels = [];
  let embeds = '';
  const embed = (face, tag) => {
    if (!face || face.isCFF) return;
    const guid = newGuid();
    const k = fontFiles.length + 1;
    fontFiles.push({ name: `word/fonts/font${k}.odttf`, data: obfuscateFont(face.u8, guid) });
    fontRels.push(`<Relationship Id="rIdFont${k}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font${k}.odttf"/>`);
    embeds += `<w:${tag} r:id="rIdFont${k}" w:fontKey="${guid}"/>`;
  };
  embed(ff.r, 'embedRegular');
  embed(ff.b, 'embedBold');
  const panose = ff.r && /^[0-9A-F]{20}$/.test(ff.r.panose) ? `<w:panose1 w:val="${ff.r.panose}"/>` : '';
  const fontTable = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:font w:name="${xmlEsc(fontName)}"><w:altName w:val="Arial"/>${panose}<w:charset w:val="00"/><w:family w:val="swiss"/><w:pitch w:val="variable"/>${embeds}</w:font></w:fonts>`;
  const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${fontFiles.length ? '<w:embedTrueTypeFonts/>' : ''}<w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rIdFonts" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/><Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/><Relationship Id="rIdHeader0" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header0.xml"/><Relationship Id="rIdFooter0" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer0.xml"/>${rels.join('')}</Relationships>`;
  const relsXml = (list) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.join('')}</Relationships>`;
  const iso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(data.title)}</dc:title><dc:creator>${xmlEsc(data.author || data.company || 'Fixframe')}</dc:creator><cp:lastModifiedBy>Fixframe</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`;
  const app = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Fixframe</Application></Properties>';
  const W = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/><Override PartName="/word/document.xml" ContentType="${W}.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="${W}.styles+xml"/><Override PartName="/word/settings.xml" ContentType="${W}.settings+xml"/><Override PartName="/word/fontTable.xml" ContentType="${W}.fontTable+xml"/><Override PartName="/word/header1.xml" ContentType="${W}.header+xml"/><Override PartName="/word/footer1.xml" ContentType="${W}.footer+xml"/><Override PartName="/word/header0.xml" ContentType="${W}.header+xml"/><Override PartName="/word/footer0.xml" ContentType="${W}.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>';
  const files = [
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: rootRels },
    { name: 'docProps/core.xml', data: core },
    { name: 'docProps/app.xml', data: app },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: docxStyles(fontName, L.locale, CW) },
    { name: 'word/settings.xml', data: settings },
    { name: 'word/fontTable.xml', data: fontTable },
    { name: 'word/header1.xml', data: headerXml },
    { name: 'word/footer1.xml', data: footerXml },
    { name: 'word/header0.xml', data: emptyHdr('hdr') },
    { name: 'word/footer0.xml', data: emptyHdr('ftr') },
    { name: 'word/_rels/document.xml.rels', data: docRels },
  ];
  if (hdrRels.length) files.push({ name: 'word/_rels/header1.xml.rels', data: relsXml(hdrRels) });
  if (fontRels.length) files.push({ name: 'word/_rels/fontTable.xml.rels', data: relsXml(fontRels) });
  return zipStore(files.concat(media, fontFiles), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}
