/* ============================================================================================================
   qr-engine.js
   What it does:    Makes QR codes and reads them from camera pictures (with error correction), without any outside
                   library.
   Change here:     Nothing.
   Engine room: better leave it as it is.
   Technical note:  QR codes, made and read by Fixframe itself (no library, nothing loaded from elsewhere).
                   QR.encode(text) → { size, get(x, y) } and QR.decode(gray, w, h) → text or null, where gray is
                   one byte per pixel. Reading works on camera pictures: adaptive black/white, finder patterns,
                   alignment pattern, perspective, format/version information and Reed-Solomon error correction.
                   Used to move edit data between devices.
   ============================================================================================================ */
const QR = (() => {
  // ---- tables (ISO/IEC 18004) ----
  const ECC_PER_BLOCK = {
    L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  };
  const BLOCKS = {
    L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  };
  const ECL_BITS = { L: 1, M: 0, Q: 3, H: 2 };
  const ECL_OF_BITS = ['M', 'L', 'H', 'Q'];
  const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

  // ---- GF(256) and Reed-Solomon ----
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
  const div = (a, b) => (a ? EXP[(LOG[a] + 255 - LOG[b]) % 255] : 0);
  const divisors = {};
  function rsDivisor(degree) {
    if (divisors[degree]) return divisors[degree];
    const r = new Array(degree).fill(0);
    r[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < r.length; j++) { r[j] = mul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
      root = mul(root, 2);
    }
    return (divisors[degree] = r);
  }
  function rsRemainder(data, divisor) {
    const r = divisor.map(() => 0);
    for (const b of data) {
      const f = b ^ r.shift();
      r.push(0);
      for (let i = 0; i < divisor.length; i++) r[i] ^= mul(divisor[i], f);
    }
    return r;
  }
  /* Corrects a block (data + ecc, highest power first) in place; returns false when it cannot. */
  function rsCorrect(cw, nsym) {
    const n = cw.length;
    const S = new Array(nsym);
    let bad = false;
    for (let i = 0; i < nsym; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s = mul(s, EXP[i]) ^ cw[j];
      S[i] = s;
      if (s) bad = true;
    }
    if (!bad) return true;
    // Berlekamp-Massey: error locator C (lowest power first)
    let C = [1];
    let B = [1];
    let L = 0;
    let m = 1;
    let b = 1;
    for (let k = 0; k < nsym; k++) {
      let d = S[k];
      for (let i = 1; i <= L; i++) d ^= mul(C[i] || 0, S[k - i]);
      if (!d) { m++; continue; }
      const T = C.slice();
      const coef = div(d, b);
      while (C.length < B.length + m) C.push(0);
      for (let i = 0; i < B.length; i++) C[i + m] ^= mul(coef, B[i]);
      if (2 * L <= k) { L = k + 1 - L; B = T; b = d; m = 1; } else m++;
    }
    if (L * 2 > nsym) return false;
    // Chien search
    const pos = [];
    for (let j = 0; j < n; j++) {
      const e = n - 1 - j;
      const xinv = EXP[(255 - (e % 255)) % 255];
      let v = 0;
      for (let i = C.length - 1; i >= 0; i--) v = mul(v, xinv) ^ C[i];
      if (!v) pos.push(j);
    }
    if (pos.length !== L) return false;
    // Forney
    const omega = new Array(nsym).fill(0);
    for (let i = 0; i < nsym; i++) for (let j = 0; j <= i && j < C.length; j++) omega[i] ^= mul(S[i - j], C[j]);
    for (const j of pos) {
      const e = n - 1 - j;
      const X = EXP[e % 255];
      const xinv = EXP[(255 - (e % 255)) % 255];
      let num = 0;
      for (let i = nsym - 1; i >= 0; i--) num = mul(num, xinv) ^ omega[i];
      let den = 0;
      for (let i = 1; i < C.length; i += 2) {
        let t = C[i];
        for (let k = 0; k < i - 1; k++) t = mul(t, xinv);
        den ^= t;
      }
      if (!den) return false;
      cw[j] ^= mul(X, div(num, den));
    }
    for (let i = 0; i < nsym; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s = mul(s, EXP[i]) ^ cw[j];
      if (s) return false;
    }
    return true;
  }

  // ---- geometry shared by writing and reading ----
  const rawModules = (v) => {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
    return r;
  };
  const dataCodewords = (v, ecl) => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[ecl][v] * BLOCKS[ecl][v];
  function alignPos(v) {
    if (v === 1) return [];
    const n = Math.floor(v / 7) + 2;
    const step = Math.floor((v * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
    const r = [6];
    for (let p = v * 4 + 10; r.length < n; p -= step) r.splice(1, 0, p);
    return r;
  }
  function formatBits(ecl, mask) {
    const data = (ECL_BITS[ecl] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  }
  function versionBits(v) {
    let rem = v;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    return (v << 12) | rem;
  }
  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  /* The fixed parts of a symbol: finder, timing and alignment patterns, reserved format/version areas. */
  const templates = {};
  function template(v) {
    if (templates[v]) return templates[v];
    const size = v * 4 + 17;
    const mod = new Uint8Array(size * size);
    const fn = new Uint8Array(size * size);
    const set = (x, y, d) => { if (x >= 0 && y >= 0 && x < size && y < size) { mod[y * size + x] = d ? 1 : 0; fn[y * size + x] = 1; } };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const ap = alignPos(v);
    for (let i = 0; i < ap.length; i++) for (let j = 0; j < ap.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    // reserve format areas (filled later) and the dark module
    for (let i = 0; i <= 8; i++) { if (i !== 6) { set(8, i, 0); set(i, 8, 0); } }
    for (let i = 0; i < 8; i++) { set(size - 1 - i, 8, 0); set(8, size - 1 - i, 0); }
    set(8, size - 8, 1);
    if (v >= 7) {
      const bits = versionBits(v);
      for (let i = 0; i < 18; i++) {
        const bit = (bits >>> i) & 1;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        set(a, b, bit); set(b, a, bit);
      }
    }
    return (templates[v] = { size, mod, fn });
  }
  /* Format bit i (0..14) positions, both copies, as [x, y]. */
  function formatPositions(size) {
    const a = [];
    const b = [];
    for (let i = 0; i <= 5; i++) a.push([8, i]);
    a.push([8, 7], [8, 8], [7, 8]);
    for (let i = 9; i < 15; i++) a.push([14 - i, 8]);
    for (let i = 0; i < 8; i++) b.push([size - 1 - i, 8]);
    for (let i = 8; i < 15; i++) b.push([8, size - 15 + i]);
    return [a, b];
  }
  /* Module order for the data bits (two-column zigzag from the bottom right). */
  function dataOrder(v) {
    const { size, fn } = template(v);
    const order = [];
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const up = ((right + 1) & 2) === 0;
          const y = up ? size - 1 - vert : vert;
          if (!fn[y * size + x]) order.push(y * size + x);
        }
      }
    }
    return order;
  }
  function blockLayout(v, ecl) {
    const nb = BLOCKS[ecl][v];
    const ecc = ECC_PER_BLOCK[ecl][v];
    const raw = Math.floor(rawModules(v) / 8);
    const nShort = nb - (raw % nb);
    const shortLen = Math.floor(raw / nb);
    return { nb, ecc, raw, nShort, shortLen };
  }

  // ---- writing ----
  const charBits = (mode, v) => {
    const g = v <= 9 ? 0 : v <= 26 ? 1 : 2;
    return mode === 1 ? [10, 12, 14][g] : mode === 2 ? [9, 11, 13][g] : [8, 16, 16][g];
  };
  function encode(text, ecl = 'M', minVersion = 1) {
    const isAlnum = [...text].every((c) => ALNUM.includes(c));
    const bytes = isAlnum ? null : new TextEncoder().encode(text);
    const mode = isAlnum ? 2 : 4;
    const count = isAlnum ? text.length : bytes.length;
    const bitsFor = (v) => 4 + charBits(mode, v) + (isAlnum ? Math.floor(count / 2) * 11 + (count % 2) * 6 : count * 8);
    let v = minVersion;
    for (; v <= 40; v++) if (bitsFor(v) <= dataCodewords(v, ecl) * 8) break;
    if (v > 40) throw new Error('Too much data for one QR code');
    const bits = [];
    const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(mode, 4);
    put(count, charBits(mode, v));
    if (isAlnum) {
      for (let i = 0; i + 1 < text.length; i += 2) put(ALNUM.indexOf(text[i]) * 45 + ALNUM.indexOf(text[i + 1]), 11);
      if (text.length % 2) put(ALNUM.indexOf(text[text.length - 1]), 6);
    } else for (const b of bytes) put(b, 8);
    const cap = dataCodewords(v, ecl) * 8;
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k]; data.push(b); }
    // error correction + interleaving
    const L = blockLayout(v, ecl);
    const div = rsDivisor(L.ecc);
    const blocks = [];
    for (let i = 0, k = 0; i < L.nb; i++) {
      const dat = data.slice(k, k + L.shortLen - L.ecc + (i < L.nShort ? 0 : 1));
      k += dat.length;
      const e = rsRemainder(dat, div);
      if (i < L.nShort) dat.push(0);
      blocks.push(dat.concat(e));
    }
    const all = [];
    for (let i = 0; i < blocks[0].length; i++) {
      for (let j = 0; j < blocks.length; j++) if (i !== L.shortLen - L.ecc || j >= L.nShort) all.push(blocks[j][i]);
    }
    const T = template(v);
    const order = dataOrder(v);
    let best = null;
    for (let mask = 0; mask < 8; mask++) {
      const m = T.mod.slice();
      const f = MASKS[mask];
      for (let i = 0; i < order.length; i++) {
        const p = order[i];
        const bit = i < all.length * 8 ? (all[i >>> 3] >>> (7 - (i & 7))) & 1 : 0;
        m[p] = bit ^ (f(p % T.size, Math.floor(p / T.size)) ? 1 : 0);
      }
      const fb = formatBits(ecl, mask);
      const [pa, pb] = formatPositions(T.size);
      for (let i = 0; i < 15; i++) { const bit = (fb >>> i) & 1; m[pa[i][1] * T.size + pa[i][0]] = bit; m[pb[i][1] * T.size + pb[i][0]] = bit; }
      const score = penalty(m, T.size);
      if (!best || score < best.score) best = { score, m };
    }
    const S = T.size;
    const mod = best.m;
    return { size: S, version: v, get: (x, y) => mod[y * S + x] === 1 };
  }
  function penalty(m, n) {
    let p = 0;
    let dark = 0;
    for (let y = 0; y < n; y++) {
      for (const horiz of [true, false]) {
        let run = 0;
        let prev = -1;
        let hist = 0;
        for (let x = 0; x < n; x++) {
          const c = horiz ? m[y * n + x] : m[x * n + y];
          if (c === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else { run = 1; prev = c; }
          hist = ((hist << 1) | c) & 0x7ff;
          if (x >= 10 && (hist === 0x5d || hist === 0x5d0)) p += 40;
        }
      }
      for (let x = 0; x < n; x++) {
        const c = m[y * n + x];
        dark += c;
        if (x < n - 1 && y < n - 1 && c === m[y * n + x + 1] && c === m[(y + 1) * n + x] && c === m[(y + 1) * n + x + 1]) p += 3;
      }
    }
    p += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
    return p;
  }
  /* Draws a code on a canvas with the white quiet zone around it. */
  function toCanvas(q, scale, canvas) {
    const quiet = 4;
    const n = q.size + quiet * 2;
    const c = canvas || document.createElement('canvas');
    c.width = c.height = n * scale;
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#000';
    for (let y = 0; y < q.size; y++) for (let i = 0; i < q.size; i++) if (q.get(i, y)) x.fillRect((i + quiet) * scale, (y + quiet) * scale, scale, scale);
    return c;
  }

  // ---- reading ----
  /* Adaptive black/white (Bradley): a pixel is black when darker than its neighbourhood. */
  function binarize(g, w, h, rDiv = 16, pct = 88) {
    const W1 = w + 1;
    const I = new Uint32Array(W1 * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      const o = (y + 1) * W1;
      const p = y * W1;
      for (let x = 0; x < w; x++) { row += g[y * w + x]; I[o + x + 1] = I[p + x + 1] + row; }
    }
    const r = Math.max(4, Math.floor(Math.min(w, h) / rDiv));
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = y - r < 0 ? 0 : y - r;
      const y1 = y + r + 1 > h ? h : y + r + 1;
      const a0 = y0 * W1;
      const a1 = y1 * W1;
      const dyc = (y1 - y0) * 100;
      for (let x = 0; x < w; x++) {
        const x0 = x - r < 0 ? 0 : x - r;
        const x1 = x + r + 1 > w ? w : x + r + 1;
        const sum = I[a1 + x1] - I[a0 + x1] - I[a1 + x0] + I[a0 + x0];
        out[y * w + x] = g[y * w + x] * (x1 - x0) * dyc < sum * pct ? 1 : 0;
      }
    }
    return out;
  }
  const ratioOk = (s, tol = 0.6) => {
    const tot = s[0] + s[1] + s[2] + s[3] + s[4];
    if (tot < 7) return false;
    const u = tot / 7;
    const d = u * tol;
    return Math.abs(u - s[0]) < d && Math.abs(u - s[1]) < d && Math.abs(3 * u - s[2]) < 3 * d && Math.abs(u - s[3]) < d && Math.abs(u - s[4]) < d;
  };
  /* Runs through the centre (cx, cy) along direction (dx, dy): returns [center offset, total] or null. */
  function crossCheck(B, w, h, cx, cy, dx, dy, maxCount, expectTotal) {
    const at = (k) => {
      const x = Math.round(cx + dx * k);
      const y = Math.round(cy + dy * k);
      return x < 0 || y < 0 || x >= w || y >= h ? -1 : B[y * w + x];
    };
    const s = [0, 0, 0, 0, 0];
    let k = 0;
    while (at(k) === 1) { s[2]++; k--; }
    if (at(k) === -1) return null;
    while (at(k) === 0 && s[1] <= maxCount) { s[1]++; k--; }
    if (at(k) === -1 || s[1] > maxCount) return null;
    while (at(k) === 1 && s[0] <= maxCount) { s[0]++; k--; }
    if (s[0] > maxCount) return null;
    k = 1;
    while (at(k) === 1) { s[2]++; k++; }
    if (at(k) === -1) return null;
    const startRight = k;
    while (at(k) === 0 && s[3] <= maxCount) { s[3]++; k++; }
    if (at(k) === -1 || s[3] > maxCount) return null;
    while (at(k) === 1 && s[4] <= maxCount) { s[4]++; k++; }
    if (s[4] > maxCount) return null;
    const tot = s[0] + s[1] + s[2] + s[3] + s[4];
    if (expectTotal && Math.abs(tot - expectTotal) * 2.5 > expectTotal * 2) return null;
    if (!ratioOk(s)) return null;
    return [startRight - s[2] / 2 - 0.5, tot, s[1] + s[2] + s[3]];
  }
  function findFinders(B, w, h) {
    const found = [];
    const step = Math.max(1, Math.floor(h / 240));
    for (let y = 0; y < h; y += step) {
      const s = [0, 0, 0, 0, 0];
      let st = 0;
      for (let x = 0; x <= w; x++) {
        const px = x < w ? B[y * w + x] : 0;
        if (px === 1) {
          if (st & 1) st++;
          s[st]++;
        } else if (!(st & 1)) {
          if (st === 4) {
            if (ratioOk(s)) {
              const tot = s[0] + s[1] + s[2] + s[3] + s[4];
              const cx = x - s[4] - s[3] - s[2] / 2;
              const v = crossCheck(B, w, h, cx, y, 0, 1, s[2] * 2, tot);
              if (v) {
                const cy = y + v[0];
                const hh = crossCheck(B, w, h, cx, cy, 1, 0, s[2] * 2, tot);
                const cx2 = hh ? cx + hh[0] : 0;
                // a real finder also shows 1:1:3:1:1 along both diagonals
                const diag = hh && crossCheck(B, w, h, cx2, cy, 1, 1, s[2] * 2, 0) && crossCheck(B, w, h, cx2, cy, 1, -1, s[2] * 2, 0);
                if (hh && diag) {
                  // outer width (7 modules) and inner width (5 modules) err in opposite directions when
                  // blur or exposure make black thicker or thinner: together they give the true module size
                  const ms = (tot + v[1] + hh[1] + s[1] + s[2] + s[3] + v[2] + hh[2]) / 36;
                  const near = found.find((f) => Math.hypot(f.x - cx2, f.y - cy) < f.ms * 1.5 && Math.abs(f.ms - ms) < f.ms * 0.35);
                  if (near) {
                    near.x = (near.x * near.n + cx2) / (near.n + 1);
                    near.y = (near.y * near.n + cy) / (near.n + 1);
                    near.ms = (near.ms * near.n + ms) / (near.n + 1);
                    near.n++;
                  } else if (found.length < 120) found.push({ x: cx2, y: cy, ms, n: 1 });
                }
              }
            }
            s[0] = s[2]; s[1] = s[3]; s[2] = s[4]; s[3] = 1; s[4] = 0; st = 3;
          } else { st++; s[st]++; }
        } else s[st]++;
      }
    }
    return found;
  }
  /* The three finder centres that form the code: similar module size, two equal sides at a right angle. */
  function pickThree(found) {
    const c = found.slice().sort((a, b) => b.n - a.n).slice(0, 12);
    const maxN = c.length ? c[0].n : 1;
    const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
    let best = null;
    for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) for (let k = j + 1; k < c.length; k++) {
      const p = [c[i], c[j], c[k]];
      const ms = (p[0].ms + p[1].ms + p[2].ms) / 3;
      if (p.some((q) => Math.abs(q.ms - ms) > ms * 0.4)) continue;
      const msVar = Math.max(...p.map((q) => Math.abs(q.ms - ms))) / ms;
      const s = [d2(p[1], p[2]), d2(p[0], p[2]), d2(p[0], p[1])];
      const hyp = s.indexOf(Math.max(...s));
      const legs = s.filter((_, n) => n !== hyp);
      if (legs[0] < (ms * 12) ** 2 || legs[1] < (ms * 12) ** 2) continue;
      const legErr = Math.abs(Math.sqrt(legs[0]) - Math.sqrt(legs[1])) / Math.sqrt(Math.max(legs[0], legs[1]));
      const angErr = Math.abs(s[hyp] - legs[0] - legs[1]) / s[hyp];
      if (legErr > 0.35 || angErr > 0.35) continue;
      const score = legErr + angErr + msVar + (1 - Math.min(p[0].n, p[1].n, p[2].n) / maxN) * 0.6;
      if (!best || score < best.score) {
        const tl = p[hyp];
        let [a, b] = p.filter((_, n) => n !== hyp);
        if ((a.x - tl.x) * (b.y - tl.y) - (a.y - tl.y) * (b.x - tl.x) < 0) [a, b] = [b, a];
        best = { score, tl, tr: a, bl: b, ms };
      }
    }
    return best;
  }
  /* Homography that maps module coordinates (u, v) to picture coordinates, from four point pairs. */
  function homography(src, dst) {
    // least squares over all point pairs (exact for four): normal equations of the 2n×8 system
    const rows = [];
    for (let i = 0; i < src.length; i++) {
      const [u, v] = src[i];
      const [x, y] = dst[i];
      rows.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
      rows.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
    }
    const A = [];
    for (let r = 0; r < 8; r++) {
      const row = new Array(9).fill(0);
      for (const q of rows) for (let c = 0; c < 9; c++) row[c] += q[r] * q[c];
      A.push(row);
    }
    for (let c = 0; c < 8; c++) {
      let p = c;
      for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]];
      if (Math.abs(A[c][c]) < 1e-12) return null;
      for (let r = 0; r < 8; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
      }
    }
    const H = A.map((r, i) => r[8] / r[i]);
    return (u, v) => {
      const z = H[6] * u + H[7] * v + 1;
      return [(H[0] * u + H[1] * v + H[2]) / z, (H[3] * u + H[4] * v + H[5]) / z];
    };
  }
  /* Best match of the 5×5 alignment pattern (dark ring, light ring, dark centre) around (ex, ey), using the grey
     picture and local module axes ux, uy; R is the search radius in pixels. */
  const ALIGN_TPL = [];
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) ALIGN_TPL.push(i, j, Math.max(Math.abs(i), Math.abs(j)) !== 1 ? 1 : -1);
  function matchAlignment(G, w, h, ex, ey, ux, uy, R, step) {
    const m = Math.hypot(ux[0], ux[1]);
    if (!step) step = Math.max(1, Math.round(m / 3.5));
    const offX = new Float32Array(25);
    const offY = new Float32Array(25);
    for (let k = 0; k < 25; k++) {
      offX[k] = ALIGN_TPL[k * 3] * ux[0] + ALIGN_TPL[k * 3 + 1] * uy[0];
      offY[k] = ALIGN_TPL[k * 3] * ux[1] + ALIGN_TPL[k * 3 + 1] * uy[1];
    }
    const v = new Float32Array(25);
    let best = null;
    for (let dy = -R; dy <= R; dy += step) for (let dx = -R; dx <= R; dx += step) {
      const cx = ex + dx;
      const cy = ey + dy;
      let sum = 0;
      let sq = 0;
      for (let k = 0; k < 25; k++) {
        let X = Math.round(cx + offX[k]);
        let Y = Math.round(cy + offY[k]);
        if (X < 0) X = 0; else if (X >= w) X = w - 1;
        if (Y < 0) Y = 0; else if (Y >= h) Y = h - 1;
        const g = G[Y * w + X];
        v[k] = g; sum += g; sq += g * g;
      }
      const mean = sum / 25;
      const sd = Math.sqrt(Math.max(1e-6, sq / 25 - mean * mean));
      if (sd < 8) continue;
      let corr = 0;
      for (let k = 0; k < 25; k++) corr += ALIGN_TPL[k * 3 + 2] * (mean - v[k]);
      corr /= 25 * sd;
      const dist = dx * dx + dy * dy;
      if (!best || corr > best.corr + 1e-9 || (Math.abs(corr - best.corr) < 1e-9 && dist < best.dist)) best = { corr, dist, x: cx, y: cy };
    }
    if (best && step > 1) {
      // refine around the best coarse position, pixel by pixel
      const fine = matchAlignment(G, w, h, best.x, best.y, ux, uy, step, 1);
      if (fine && fine.corr >= best.corr) best = fine;
    }
    return best && best.corr > 0.55 ? best : null;
  }
  function findAlignment(G, w, h, f, dim) {
    const n = dim - 7;
    const ux = [(f.tr.x - f.tl.x) / n, (f.tr.y - f.tl.y) / n];
    const uy = [(f.bl.x - f.tl.x) / n, (f.bl.y - f.tl.y) / n];
    const brx = f.tr.x - f.tl.x + f.bl.x;
    const bry = f.tr.y - f.tl.y + f.bl.y;
    const corr = 1 - 3 / n;
    return matchAlignment(G, w, h, f.tl.x + corr * (brx - f.tl.x), f.tl.y + corr * (bry - f.tl.y), ux, uy, Math.ceil(f.ms * 6));
  }
  /* Better geometry: look for every alignment pattern near where the current map puts it, then fit the map to all
     points found (finder centres + alignment centres). Repeated twice. */
  function refineMap(G, w, h, map, n, src, dst) {
    const ap = alignPos((n - 17) / 4);
    let S = src.slice();
    let D = dst.slice();
    for (let round = 0; round < 2; round++) {
      const s2 = src.slice(0, 3);
      const d2 = dst.slice(0, 3);
      for (let i = 0; i < ap.length; i++) for (let j = 0; j < ap.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) continue;
        const u = ap[i] + 0.5;
        const v = ap[j] + 0.5;
        const [px, py] = map(u, v);
        const [ax, ay] = map(u + 1, v);
        const [bx, by] = map(u, v + 1);
        const ux = [ax - px, ay - py];
        const uy = [bx - px, by - py];
        const m = Math.hypot(...ux);
        const hit = matchAlignment(G, w, h, px, py, ux, uy, Math.ceil(m * 2));
        if (hit) { s2.push([u, v]); d2.push([hit.x, hit.y]); }
      }
      if (s2.length < 4) break;
      const next = homography(s2, d2);
      if (!next) break;
      map = next;
      S = s2;
      D = d2;
    }
    return { map, S, D };
  }
  /* Grey value of every module (average of 5 points), then black/white against the modules around it:
     copes with blur, uneven light and glare better than the picture-wide black/white. */
  function sampleGrid(G, w, h, map, dim) {
    const val = new Float32Array(dim * dim);
    const gp = (x, y) => {
      const X = Math.min(w - 1, Math.max(0, Math.round(x)));
      const Y = Math.min(h - 1, Math.max(0, Math.round(y)));
      return G[Y * w + X];
    };
    for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) {
      let k = 0;
      for (const [ox, oy] of [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7]]) {
        const [px, py] = map(x + ox, y + oy);
        k += gp(px, py);
      }
      val[y * dim + x] = k / 5;
    }
    const R = Math.max(3, Math.round(dim / 8));
    const I = new Float64Array((dim + 1) * (dim + 1));
    for (let y = 0; y < dim; y++) {
      let row = 0;
      for (let x = 0; x < dim; x++) { row += val[y * dim + x]; I[(y + 1) * (dim + 1) + x + 1] = I[y * (dim + 1) + x + 1] + row; }
    }
    const g = new Uint8Array(dim * dim);
    for (let y = 0; y < dim; y++) {
      const y0 = Math.max(0, y - R);
      const y1 = Math.min(dim, y + R + 1);
      for (let x = 0; x < dim; x++) {
        const x0 = Math.max(0, x - R);
        const x1 = Math.min(dim, x + R + 1);
        const mean = (I[y1 * (dim + 1) + x1] - I[y0 * (dim + 1) + x1] - I[y1 * (dim + 1) + x0] + I[y0 * (dim + 1) + x0]) / ((x1 - x0) * (y1 - y0));
        g[y * dim + x] = val[y * dim + x] < mean ? 1 : 0;
      }
    }
    return g;
  }
  const popcount = (x) => { let c = 0; while (x) { c += x & 1; x >>>= 1; } return c; };
  const FORMATS = [];
  for (const e of 'LMQH') for (let m = 0; m < 8; m++) FORMATS.push({ e, m, bits: formatBits(e, m) });
  /* Reads the data of a sampled grid of modules. */
  function readGrid(g, dim) {
    const v = (dim - 17) / 4;
    if (v < 1 || v > 40 || v !== Math.floor(v)) return null;
    const [pa, pb] = formatPositions(dim);
    let best = null;
    for (const pos of [pa, pb]) {
      let bits = 0;
      for (let i = 0; i < 15; i++) bits |= g[pos[i][1] * dim + pos[i][0]] << i;
      for (const f of FORMATS) {
        const d = popcount(bits ^ f.bits);
        if (!best || d < best.d) best = { d, f };
      }
    }
    if (!best || best.d > 3) return null;
    const { e: ecl, m: mask } = best.f;
    if (v >= 7) {
      let ok = false;
      for (const corner of [0, 1]) {
        let bits = 0;
        for (let i = 0; i < 18; i++) {
          const a = dim - 11 + (i % 3);
          const b = Math.floor(i / 3);
          bits |= g[(corner ? a : b) * dim + (corner ? b : a)] << i;
        }
        if (popcount(bits ^ versionBits(v)) <= 3) ok = true;
      }
      if (!ok) return null;
    }
    const order = dataOrder(v);
    const f = MASKS[mask];
    const L = blockLayout(v, ecl);
    const cw = new Uint8Array(L.raw);
    for (let i = 0; i < L.raw * 8; i++) {
      const p = order[i];
      const bit = g[p] ^ (f(p % dim, Math.floor(p / dim)) ? 1 : 0);
      cw[i >>> 3] |= bit << (7 - (i & 7));
    }
    const blocks = [];
    for (let j = 0; j < L.nb; j++) blocks.push(new Array(L.shortLen + 1).fill(0));
    let k = 0;
    for (let i = 0; i < L.shortLen + 1; i++) {
      for (let j = 0; j < L.nb; j++) if (i !== L.shortLen - L.ecc || j >= L.nShort) blocks[j][i] = cw[k++];
    }
    const data = [];
    for (let j = 0; j < L.nb; j++) {
      let b = blocks[j];
      if (j < L.nShort) b = b.slice(0, L.shortLen - L.ecc).concat(b.slice(L.shortLen - L.ecc + 1));
      if (!rsCorrect(b, L.ecc)) return null;
      data.push(...b.slice(0, b.length - L.ecc));
    }
    return parseBits(data, v);
  }
  function parseBits(data, v) {
    let pos = 0;
    const total = data.length * 8;
    const take = (n) => {
      let r = 0;
      for (let i = 0; i < n; i++) { r = (r << 1) | ((data[pos >>> 3] >>> (7 - (pos & 7))) & 1); pos++; }
      return r;
    };
    let out = '';
    while (pos + 4 <= total) {
      const mode = take(4);
      if (mode === 0) break;
      if (mode === 7) { const b = take(8); if (b & 0x80) take(b & 0x40 ? 16 : 8); continue; }
      if (mode === 1) {
        let n = take(charBits(1, v));
        while (n >= 3) { out += String(take(10)).padStart(3, '0'); n -= 3; }
        if (n === 2) out += String(take(7)).padStart(2, '0');
        else if (n === 1) out += String(take(4));
      } else if (mode === 2) {
        let n = take(charBits(2, v));
        while (n >= 2) { const x = take(11); out += ALNUM[Math.floor(x / 45)] + ALNUM[x % 45]; n -= 2; }
        if (n === 1) out += ALNUM[take(6)];
      } else if (mode === 4) {
        const n = take(charBits(4, v));
        if (pos + n * 8 > total) return null;
        const bytes = new Uint8Array(n);
        for (let i = 0; i < n; i++) bytes[i] = take(8);
        try { out += new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { out += String.fromCharCode(...bytes); }
      } else return out || null;
    }
    return out;
  }
  /* Size of the code from the timing pattern: for every possible size, map the module grid onto the picture and
     check how well row 6 and column 6 alternate dark/light, one module each. The true size alternates best. */
  function timingDims(G, w, h, f, est) {
    const gp = (x, y) => {
      const X = Math.min(w - 1, Math.max(0, Math.round(x)));
      const Y = Math.min(h - 1, Math.max(0, Math.round(y)));
      return G[Y * w + X];
    };
    const scored = [];
    for (let n = 21; n <= 177; n += 4) {
      if (n < est * 0.65 || n > est * 1.45) continue;
      const map = homography([[3.5, 3.5], [n - 3.5, 3.5], [3.5, n - 3.5], [n - 3.5, n - 3.5]],
        [[f.tl.x, f.tl.y], [f.tr.x, f.tr.y], [f.bl.x, f.bl.y], [f.tr.x - f.tl.x + f.bl.x, f.tr.y - f.tl.y + f.bl.y]]);
      if (!map) continue;
      let good = 0;
      let all = 0;
      for (const row of [true, false]) {
        const vals = [];
        for (let i = 8; i <= n - 9; i++) {
          const [x, y] = row ? map(i + 0.5, 6.5) : map(6.5, i + 0.5);
          vals.push(gp(x, y));
        }
        // each module against its two neighbours: dark ones darker, light ones lighter
        for (let k = 1; k < vals.length - 1; k++) {
          const dark = (k % 2) === 0;
          const nb = (vals[k - 1] + vals[k + 1]) / 2;
          all++;
          if (dark ? vals[k] < nb : vals[k] > nb) good++;
        }
      }
      if (all) scored.push([n, good / all]);
    }
    return scored.filter((x) => x[1] >= 0.7).sort((x, y) => y[1] - x[1]).map((x) => x[0]);
  }
  /* Module size measured along the line from one finder centre towards another: centre → end of the light ring
     (2.5 modules, shrunk by blur) and → end of the dark ring (3.5 modules, grown by the same amount); both directions. */
  function moduleAlong(B, w, h, a, b) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const px = (x, y) => { const X = Math.round(x); const Y = Math.round(y); return X < 0 || Y < 0 || X >= w || Y >= h ? -1 : B[Y * w + X]; };
    const res = [];
    for (const sgn of [1, -1]) {
      const marks = [];
      let prev = 1;
      for (let t = 0; t < a.ms * 6 && marks.length < 3; t += 0.5) {
        const v = px(a.x + ux * t * sgn, a.y + uy * t * sgn);
        if (v < 0) break;
        if (v !== prev) { marks.push(t); prev = v; }
      }
      if (marks.length === 3) res.push((marks[1] + marks[2]) / 6);
    }
    return res.length ? res.reduce((x, y) => x + y) / res.length : 0;
  }
  /* Finds and reads one QR code in a grey picture. Returns the text or null. */
  function decode(gray, w, h) {
    // two black/white versions of the picture: the usual one, then a finer one for small or blurred codes
    for (const [rDiv, pct] of [[16, 88], [40, 95]]) {
      const B = binarize(gray, w, h, rDiv, pct);
      const found = findFinders(B, w, h);
      if (found.length < 3) continue;
      const f = pickThree(found);
      if (!f) continue;
      const t = decodeWith(gray, w, h, B, f);
      if (t != null) return t;
    }
    return null;
  }
  function decodeWith(gray, w, h, B, f) {
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const m1 = (moduleAlong(B, w, h, f.tl, f.tr) + moduleAlong(B, w, h, f.tr, f.tl)) / 2;
    const m2 = (moduleAlong(B, w, h, f.tl, f.bl) + moduleAlong(B, w, h, f.bl, f.tl)) / 2;
    const est = m1 > 0.5 && m2 > 0.5 ? (d(f.tl, f.tr) / m1 + d(f.tl, f.bl) / m2) / 2 + 7 : (d(f.tl, f.tr) + d(f.tl, f.bl)) / 2 / f.ms + 7;
    let dim = Math.round(est);
    dim += [1, 0, -1, 2][((dim % 4) + 4) % 4];
    const tries = [];
    for (const x of [...timingDims(gray, w, h, f, est).slice(0, 3), dim, dim - 4, dim + 4]) {
      if (x >= 21 && x <= 177 && !tries.includes(x)) tries.push(x);
    }
    for (const n of tries) {
      const v = (n - 17) / 4;
      let br = null;
      if (v >= 2) {
        const a = findAlignment(gray, w, h, f, n);
        if (a) br = [a.x, a.y];
      }
      const pts = [[3.5, 3.5], [n - 3.5, 3.5], [3.5, n - 3.5]];
      const img = [[f.tl.x, f.tl.y], [f.tr.x, f.tr.y], [f.bl.x, f.bl.y]];
      const four = [];
      if (br) four.push([[n - 6.5, n - 6.5], br]);
      four.push([[n - 3.5, n - 3.5], [f.tr.x - f.tl.x + f.bl.x, f.tr.y - f.tl.y + f.bl.y]]);
      for (const [mp, ip] of four) {
        let map = homography([...pts, mp], [...img, ip]);
        if (!map) continue;
        if (v >= 2) map = refineMap(gray, w, h, map, n, [...pts, mp], [...img, ip]).map;
        const g = sampleGrid(gray, w, h, map, n);
        let t = readGrid(g, n);
        if (t == null) {
          // a mirrored picture (some laptop cameras): read the grid transposed
          const tg = new Uint8Array(n * n);
          for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) tg[y * n + x] = g[x * n + y];
          t = readGrid(tg, n);
        }
        if (t != null) return t;
      }
    }
    return null;
  }
  return { encode, toCanvas, decode, _test: { moduleAlong, rsCorrect, rsRemainder, rsDivisor, binarize, findFinders, pickThree, readGrid, template, sampleGrid, findAlignment, timingDims } };
})();

/* Base45 (RFC 9285): bytes as QR alphanumeric characters, about 30 % smaller in a code than base64. */
const B45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
function base45Encode(u8) {
  let s = '';
  for (let i = 0; i + 1 < u8.length; i += 2) {
    let n = u8[i] * 256 + u8[i + 1];
    s += B45[n % 45]; n = Math.floor(n / 45);
    s += B45[n % 45]; n = Math.floor(n / 45);
    s += B45[n];
  }
  if (u8.length % 2) { const n = u8[u8.length - 1]; s += B45[n % 45] + B45[Math.floor(n / 45)]; }
  return s;
}
function base45Decode(s) {
  const out = [];
  for (let i = 0; i < s.length; i += 3) {
    const c = B45.indexOf(s[i]);
    const d = B45.indexOf(s[i + 1]);
    if (c < 0 || d < 0) throw new Error('base45');
    if (i + 2 < s.length) {
      const e = B45.indexOf(s[i + 2]);
      if (e < 0) throw new Error('base45');
      const n = c + d * 45 + e * 2025;
      if (n > 65535) throw new Error('base45');
      out.push(n >> 8, n & 255);
    } else {
      const n = c + d * 45;
      if (n > 255) throw new Error('base45');
      out.push(n);
    }
  }
  return new Uint8Array(out);
}
