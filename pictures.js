/* ============================================================================================================
   pictures.js
   What it does:    Opens pictures in every format the browser knows, plus TIFF, for the brand intro, safety and
                   closing.
   Change here:     The messages for pictures that cannot be read.
   Engine room: better leave it as it is.
   Technical note:  Pictures in any format this browser can decode (JPEG, PNG, WebP, AVIF, GIF, BMP, ICO, SVG;
                   HEIC/HEIF where the browser supports it, e.g. Safari), plus TIFF read by Fixframe itself. Used
                   for brand intro / safety / closing pictures.
   ============================================================================================================ */
const IMAGE_ACCEPT = 'image/*,.jpg,.jpeg,.png,.gif,.webp,.avif,.bmp,.ico,.svg,.tif,.tiff,.heic,.heif';
const isImageFile = (f) => /^image\//.test(f.type || '') || /\.(jpe?g|png|gif|webp|avif|bmp|ico|svg|tiff?|heic|heif|jxl)$/i.test(f.name || '');

function imageError(msg) { const e = new Error(msg); e.userMsg = msg; return e; }

/* Baseline TIFF: strips, 1/8/16 bits, gray / RGB(A) / palette, no compression, LZW, PackBits or Deflate. */
async function decodeTiff(u8) {
  const le = u8[0] === 0x49;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const u16 = (o) => dv.getUint16(o, le);
  const u32 = (o) => dv.getUint32(o, le);
  const ifd = u32(4);
  const tags = {};
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    const tag = u16(e);
    const type = u16(e + 2);
    const count = u32(e + 4);
    const size = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8][type] || 1;
    const off = count * size > 4 ? u32(e + 8) : e + 8;
    const vals = [];
    for (let k = 0; k < Math.min(count, 1 << 20); k++) vals.push(type === 3 ? u16(off + 2 * k) : type === 4 ? u32(off + 4 * k) : u8[off + k]);
    tags[tag] = vals;
  }
  const one = (t, d) => (tags[t] ? tags[t][0] : d);
  const W = one(256, 0);
  const H = one(257, 0);
  const bps = one(258, 1);
  const comp = one(259, 1);
  const photo = one(262, 1);
  const spp = one(277, 1);
  const rps = one(278, H);
  const offs = tags[273];
  const counts = tags[279];
  if (!W || !H || !offs || !counts || tags[322] || one(284, 1) !== 1 || ![1, 8, 16].includes(bps) || ![1, 5, 8, 32946, 32773].includes(comp)) return null;
  const rowBytes = Math.ceil((W * spp * bps) / 8);
  const data = new Uint8Array(rowBytes * H);
  let pos = 0;
  for (let s = 0; s < offs.length && pos < data.length; s++) {
    let strip = u8.subarray(offs[s], offs[s] + counts[s]);
    if (comp === 5) strip = tiffLzw(strip);
    else if (comp === 32773) strip = packBits(strip, rowBytes * Math.min(rps, H));
    else if (comp === 8 || comp === 32946) strip = await inflateZlib(strip);
    const take = Math.min(strip.length, data.length - pos, rowBytes * rps);
    data.set(strip.subarray(0, take), pos);
    pos += take;
  }
  if (one(317, 1) === 2 && bps === 8) {
    for (let y = 0; y < H; y++) for (let x = spp; x < W * spp; x++) data[y * rowBytes + x] = (data[y * rowBytes + x] + data[y * rowBytes + x - spp]) & 255;
  }
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const cmap = tags[320];
  const sample = (y, x, k) => {
    if (bps === 8) return data[y * rowBytes + x * spp + k];
    if (bps === 16) { const o = y * rowBytes + (x * spp + k) * 2; return le ? data[o + 1] : data[o]; }
    const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
    return bit ? 255 : 0;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (photo === 2 && spp >= 3) { d[o] = sample(y, x, 0); d[o + 1] = sample(y, x, 1); d[o + 2] = sample(y, x, 2); d[o + 3] = spp >= 4 ? sample(y, x, 3) : 255; }
      else if (photo === 3 && cmap) {
        const i = bps === 8 ? data[y * rowBytes + x] : sample(y, x, 0) ? 1 : 0;
        const nC = cmap.length / 3;
        d[o] = cmap[i] >> 8; d[o + 1] = cmap[nC + i] >> 8; d[o + 2] = cmap[2 * nC + i] >> 8; d[o + 3] = 255;
      } else {
        let g = sample(y, x, 0);
        if (photo === 0) g = 255 - g;
        d[o] = d[o + 1] = d[o + 2] = g; d[o + 3] = spp >= 2 ? sample(y, x, 1) : 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
function tiffLzw(src) {
  let out = new Uint8Array(Math.max(1024, src.length * 3));
  let len = 0;
  const push = (e) => {
    if (len + e.length > out.length) { const o2 = new Uint8Array((len + e.length) * 2); o2.set(out.subarray(0, len)); out = o2; }
    out.set(e, len);
    len += e.length;
  };
  let bitPos = 0;
  const total = src.length * 8;
  const read = (n) => {
    let v = 0;
    for (let k = 0; k < n; k++) { const b = bitPos >> 3; v = (v << 1) | ((src[b] >> (7 - (bitPos & 7))) & 1); bitPos++; }
    return v;
  };
  let dict = [];
  const reset = () => { dict = []; for (let i = 0; i < 256; i++) dict.push(Uint8Array.of(i)); dict.push(null, null); };
  reset();
  let width = 9;
  let prev = null;
  while (bitPos + width <= total) {
    const code = read(width);
    if (code === 257) break;
    if (code === 256) { reset(); width = 9; prev = null; continue; }
    let entry;
    if (code < dict.length && dict[code]) entry = dict[code];
    else if (code === dict.length && prev) { entry = new Uint8Array(prev.length + 1); entry.set(prev); entry[prev.length] = prev[0]; }
    else break;
    push(entry);
    if (prev) { const ne = new Uint8Array(prev.length + 1); ne.set(prev); ne[prev.length] = entry[0]; dict.push(ne); }
    prev = entry;
    if (dict.length >= (1 << width) - 1 && width < 12) width++;
  }
  return out.subarray(0, len);
}
function packBits(src, expect) {
  const out = new Uint8Array(expect);
  let i = 0;
  let o = 0;
  while (i < src.length && o < expect) {
    let n = src[i++];
    if (n > 127) n -= 256;
    if (n >= 0) { for (let k = 0; k <= n && o < expect; k++) out[o++] = src[i++]; }
    else if (n !== -128) { const v = src[i++]; for (let k = 0; k < 1 - n && o < expect; k++) out[o++] = v; }
  }
  return out;
}
function loadImageEl(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.src = url;
  });
}
/* Decode a picture file into a canvas, flattened onto black (brand pictures are shown on black), at most maxSide. */
async function decodeImageFile(file, maxSide = 2560) {
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const tiff = (head[0] === 0x49 && head[1] === 0x49 && head[2] === 42 && head[3] === 0) || (head[0] === 0x4d && head[1] === 0x4d && head[2] === 0 && head[3] === 42);
  const isSvg = /svg/i.test(file.type || '') || /\.svg$/i.test(file.name || '');
  let src = null;
  if (tiff) { try { src = await decodeTiff(new Uint8Array(await file.arrayBuffer())); } catch (e) { src = null; } }
  if (!src && !isSvg) { try { src = await createImageBitmap(file); } catch (e) { src = null; } }
  if (!src) { try { src = await loadImageEl(file); } catch (e) { src = null; } }
  if (!src) {
    const brand = String.fromCharCode(...head.subarray(4, 12));
    if (/ftyp(heic|heix|hevc|hevx|heim|heis|mif1|msf1)/.test(brand)) {
      throw imageError('HEIC/HEIF pictures cannot be read by this browser. On iPhone, choose the picture from Photos (it is converted automatically); otherwise save it as JPEG first.');
    }
    if (tiff) throw imageError('This TIFF picture uses a compression Fixframe cannot read (for example fax compression or tiles). Save it as JPEG or PNG first.');
    throw imageError('This picture cannot be read in this browser. JPEG, PNG, WebP, GIF, BMP, SVG and TIFF work.');
  }
  let w = src.naturalWidth || src.width;
  let h = src.naturalHeight || src.height;
  if (!w || !h) { w = 1920; h = 1080; }
  let k = Math.min(1, maxSide / Math.max(w, h));
  if (isSvg) k = 1920 / Math.max(w, h);
  const c = makeCanvas(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  if (src.close) src.close();
  return c;
}
