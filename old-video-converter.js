/* ============================================================================================================
   old-video-converter.js
   What it does:    Converts old videos that browsers cannot play any more (old Android 3GP, Xvid AVI, camera
                   Motion JPEG) into a normal MP4, on the device.
   Change here:     The messages shown for formats that cannot be read (search for 'cannot').
   Engine room: better leave it as it is.
   Technical note:  Old video formats that browsers no longer play, converted on the device into an H.264 MP4
                   before use: - 3GP / 3G2 / MP4 / MOV with H.263 or MPEG-4 Part 2 video (older Android and feature
                   phones, early cameras) - AVI with MPEG-4 Part 2 (Xvid / DivX, Simple Profile) or Motion JPEG
                   (older digital cameras) - MOV / MP4 with Motion JPEG The sound is not kept (Fixframe's exports
                   are silent). Nothing leaves the device. Decoder after ISO/IEC 14496-2 (Simple Profile incl.
                   short video header = H.263 baseline) and ITU-T H.263.
   ============================================================================================================ */
const OldVideo = (() => {
  const unsupported = (msg) => { const e = new Error(msg); e.userMsg = msg; e.unplayable = true; return e; };
  const corrupt = () => new Error('corrupt');

  /* ---------- bit reader ---------- */
  class Bits {
    constructor(u8, start = 0, end = u8.length) { this.u = u8; this.p = start * 8; this.e = end * 8; }
    peek(n) {
      const p = this.p;
      const i = p >> 3;
      const u = this.u;
      const w = ((u[i] << 24) | (u[i + 1] << 16) | (u[i + 2] << 8) | u[i + 3]) >>> 0;
      return n ? (((w << (p & 7)) >>> 0) >>> (32 - n)) : 0;
    }
    bits(n) {
      if (n > 24) { const hi = this.bits(n - 16); return hi * 65536 + this.bits(16); }
      const v = this.peek(n);
      this.p += n;
      return v;
    }
    bit() { const v = (this.u[this.p >> 3] >> (7 - (this.p & 7))) & 1; this.p++; return v; }
    left() { return this.e - this.p; }
  }
  /* VLC lookup: entries [code, length, symbol] -> table indexed by the next L bits */
  function vlc(entries) {
    let L = 1;
    for (const e of entries) if (e[1] > L) L = e[1];
    const t = new Int32Array(1 << L).fill(-1);
    for (const [code, len, sym] of entries) {
      if (!len) continue;
      const sh = L - len;
      const base = code << sh;
      for (let k = 0; k < 1 << sh; k++) t[base + k] = (sym << 5) | len;
    }
    return { t, L };
  }
  function rd(b, v) {
    const x = v.t[b.peek(v.L)];
    if (x < 0 || b.p > b.e) throw corrupt();
    b.p += x & 31;
    return x >> 5;
  }
  let T = null;
  function tables() {
    if (T) return T;
    const pairs = (a) => { const o = []; for (let i = 0; i < a.length; i += 2) o.push([a[i], a[i + 1], i / 2]); return o; };
    const rl = (run, level, lastStart) => {
      const maxLevel = [new Int32Array(64), new Int32Array(64)];
      const maxRun = [new Int32Array(64), new Int32Array(64)];
      for (let i = 0; i < 102; i++) {
        const last = i >= lastStart ? 1 : 0;
        if (level[i] > maxLevel[last][run[i]]) maxLevel[last][run[i]] = level[i];
        if (run[i] > maxRun[last][level[i]]) maxRun[last][level[i]] = run[i];
      }
      return { run, level, lastStart, maxLevel, maxRun };
    };
    T = {
      inter: vlc(pairs(M4T.interVlc)), intra: vlc(pairs(M4T.intraVlc)), mv: vlc(pairs(M4T.mv)), cbpy: vlc(pairs(M4T.cbpy)),
      dcL: vlc(pairs(M4T.dcLum)), dcC: vlc(pairs(M4T.dcChrom)),
      mcbpcI: vlc(M4T.mcbpcI.map((c, i) => [c, M4T.mcbpcIBits[i], i])),
      mcbpcP: vlc(M4T.mcbpcP.map((c, i) => [c, M4T.mcbpcPBits[i], i])),
      rlInter: rl(M4T.interRun, M4T.interLevel, 58), rlIntra: rl(M4T.intraRun, M4T.intraLevel, 67),
      zig: M4T.zigzag, altH: M4T.altH, altV: M4T.altV,
    };
    // 8x8 inverse DCT basis
    T.cos = new Float64Array(64);
    for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) T.cos[x * 8 + u] = (u ? 0.5 : Math.SQRT1_2 / 2) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
    return T;
  }
  const DQ = [-1, -2, 1, 2];
  const DC_THR = [99, 13, 15, 17, 19, 21, 23, 0];
  const H263_SIZES = [null, [128, 96], [176, 144], [352, 288], [704, 576], [1408, 1152]];
  const tmp = new Float64Array(64);
  function idct(F, out) {
    const c = T.cos;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        let s = 0;
        for (let u = 0; u < 8; u++) { const f = F[y * 8 + u]; if (f) s += c[x * 8 + u] * f; }
        tmp[y * 8 + x] = s;
      }
    }
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        let s = 0;
        for (let v = 0; v < 8; v++) s += c[y * 8 + v] * tmp[v * 8 + x];
        out[y * 8 + x] = Math.round(s);
      }
    }
  }

  /* ---------- MPEG-4 Part 2 Simple Profile / H.263 baseline decoder ---------- */
  class Decoder {
    constructor() { this.vol = null; this.cur = null; this.ref = null; this.w = 0; this.h = 0; this.decoded = 0; }
    alloc(w, h) {
      if (this.cur && w === this.w && h === this.h) return;
      this.w = w; this.h = h;
      this.mbW = (w + 15) >> 4; this.mbH = (h + 15) >> 4;
      const mk = () => ({ Y: new Uint8Array(this.mbW * 16 * this.mbH * 16), U: new Uint8Array(this.mbW * 8 * this.mbH * 8), V: new Uint8Array(this.mbW * 8 * this.mbH * 8) });
      this.cur = mk(); this.ref = mk();
      const n = this.mbW * this.mbH;
      this.slice = new Int32Array(n); this.qps = new Uint8Array(n);
      this.dcY = new Int32Array(4 * n); this.acY = new Int16Array(64 * n);
      this.dcC = [new Int32Array(n), new Int32Array(n)]; this.acC = [new Int16Array(16 * n), new Int16Array(16 * n)];
      this.mvx = new Int16Array(4 * n); this.mvy = new Int16Array(4 * n);
      this.q = new Int32Array(64); this.F = new Int32Array(64); this.R = new Int32Array(64);
    }
    /* VOL header (ISO/IEC 14496-2, 6.2.3) */
    parseVol(b) {
      const v = { quantPrecision: 5, intraMat: M4T.intraMatrix.slice(), interMat: M4T.interMatrix.slice() };
      b.bit();
      b.bits(8);
      let verid = 1;
      if (b.bit()) { verid = b.bits(4); b.bits(3); }
      if (b.bits(4) === 15) b.bits(16);
      if (b.bit()) { b.bits(2); b.bit(); if (b.bit()) { b.bits(15); b.bit(); b.bits(15); b.bit(); b.bits(15); b.bit(); b.bits(3); b.bits(11); b.bit(); b.bits(15); b.bit(); } }
      const shape = b.bits(2);
      if (shape !== 0) throw unsupported('This video uses shaped objects (MPEG-4 Core Profile), which Fixframe cannot convert.');
      b.bit();
      const res = b.bits(16);
      v.timeBits = res > 1 ? Math.floor(Math.log2(res - 1)) + 1 : 1;
      b.bit();
      if (b.bit()) b.bits(v.timeBits);
      b.bit(); v.w = b.bits(13); b.bit(); v.h = b.bits(13); b.bit();
      if (b.bit()) throw unsupported('This video is interlaced (MPEG-4 Advanced Simple Profile), which Fixframe cannot convert.');
      b.bit();
      const sprite = verid === 1 ? b.bit() : b.bits(2);
      if (sprite) throw unsupported('This video uses MPEG-4 global motion (Advanced Simple Profile), which Fixframe cannot convert.');
      if (b.bit()) { v.quantPrecision = b.bits(4); if (b.bits(4) !== 8) throw unsupported('This video is not 8-bit, which Fixframe cannot convert.'); }
      v.quantType = b.bit();
      if (v.quantType) {
        const load = (mat) => {
          let last = 0;
          let i = 0;
          for (; i < 64; i++) { const x = b.bits(8); if (!x) break; last = x; mat[T.zig[i]] = x; }
          for (; i < 64; i++) mat[T.zig[i]] = last;
        };
        if (b.bit()) load(v.intraMat);
        if (b.bit()) load(v.interMat);
      }
      if (verid !== 1 && b.bit()) throw unsupported('This video uses quarter-pixel motion (MPEG-4 Advanced Simple Profile), which Fixframe cannot convert.');
      if (!b.bit()) throw unsupported('This video uses MPEG-4 complexity estimation, which Fixframe cannot convert.');
      v.resyncDisabled = b.bit();
      if (b.bit()) throw unsupported('This video uses data partitioning (an error-resilience mode of old phones), which Fixframe cannot convert yet.');
      if (verid !== 1) { if (b.bit()) throw unsupported('This video uses MPEG-4 NEWPRED, which Fixframe cannot convert.'); b.bit(); }
      if (b.bit()) throw unsupported('This video uses MPEG-4 scalability, which Fixframe cannot convert.');
      return v;
    }
    /* Decode one sample (one picture). Returns 'frame', 'skip' (not coded: show the previous picture) or null. */
    decode(u8) {
      tables();
      if (u8.length > 3 && u8[0] === 0 && u8[1] === 0 && (u8[2] & 0xfc) === 0x80) return this.decodeH263(u8);
      let result = null;
      for (let i = 0; i + 3 < u8.length;) {
        if (!(u8[i] === 0 && u8[i + 1] === 0 && u8[i + 2] === 1)) { i++; continue; }
        const code = u8[i + 3];
        let j = i + 4;
        while (j + 3 < u8.length && !(u8[j] === 0 && u8[j + 1] === 0 && u8[j + 2] === 1)) j++;
        if (j + 3 >= u8.length) j = u8.length;
        const b = new Bits(u8, i + 4, j);
        if (code >= 0x20 && code <= 0x2f) { this.vol = this.parseVol(b); }
        else if (code === 0xb6) {
          if (!this.vol) throw corrupt();
          result = this.decodeVop(b);
        }
        i = j;
      }
      return result;
    }
    begin(w, h) {
      this.alloc(w, h);
      const t = this.ref; this.ref = this.cur; this.cur = t;
      this.slice.fill(-1);
    }
    decodeVop(b) {
      const v = this.vol;
      const type = b.bits(2);
      if (type > 1) throw unsupported(type === 2 ? 'This video has B-frames (MPEG-4 Advanced Simple Profile, e.g. Xvid with default settings), which Fixframe cannot convert.' : 'This video uses MPEG-4 sprites, which Fixframe cannot convert.');
      while (b.bit()) { /* modulo time base */ }
      b.bit(); b.bits(v.timeBits); b.bit();
      if (!b.bit()) return 'skip';
      if (type === 1 && !this.decoded) return 'skip';
      const st = { short: false, type, rounding: type === 1 ? b.bit() : 0, dcThr: DC_THR[b.bits(3)], qp: b.bits(v.quantPrecision), fcode: 1 };
      if (type === 1) st.fcode = b.bits(3) || 1;
      this.begin(v.w, v.h);
      this.mbLoop(b, st);
      this.decoded++;
      return 'frame';
    }
    decodeH263(u8) {
      const b = new Bits(u8);
      b.bits(22); b.bits(8); b.bit(); b.bit(); b.bits(3);
      const fmt = b.bits(3);
      if (fmt === 7 || !H263_SIZES[fmt]) throw unsupported('This H.263 video uses H.263+ features, which Fixframe cannot convert.');
      const type = b.bit();
      if (b.bit() || b.bit() || b.bit() || b.bit()) throw unsupported('This H.263 video uses optional H.263 modes, which Fixframe cannot convert.');
      const qp = b.bits(5);
      const cpm = b.bit();
      if (cpm) b.bits(2);
      while (b.bit()) b.bits(8);
      if (type === 1 && !this.decoded) return 'skip';
      const [w, h] = H263_SIZES[fmt];
      this.vol = this.vol || { w, h };
      this.begin(w, h);
      this.mbLoop(b, { short: true, type, rounding: 0, dcThr: 99, qp, fcode: 1, cpm, gobRows: h <= 400 ? 1 : h <= 800 ? 2 : 4 });
      this.decoded++;
      return 'frame';
    }
    mbLoop(b, st) {
      const total = this.mbW * this.mbH;
      let slice = 0;
      let mb = 0;
      const markerLen = st.type === 0 ? 16 : 15 + st.fcode;
      const mbBits = Math.ceil(Math.log2(total));
      try {
        while (mb < total) {
          const mx = mb % this.mbW;
          const my = (mb / this.mbW) | 0;
          if (st.short) {
            if (mx === 0 && my > 0 && my % st.gobRows === 0 && this.gobHeader(b, st)) slice++;
          } else if (!this.vol.resyncDisabled && mb > 0 && this.atResync(b, markerLen)) {
            b.p = this.resyncPos;
            mb = b.bits(mbBits);
            if (mb >= total) throw corrupt();
            st.qp = b.bits(this.vol.quantPrecision);
            if (b.bit()) {
              while (b.bit()) { /* modulo */ }
              b.bit(); b.bits(this.vol.timeBits); b.bit(); b.bits(2); b.bits(3);
              if (st.type === 1) b.bits(3);
            }
            slice++;
            continue;
          }
          this.curSlice = slice;
          this.decodeMb(b, st, mb % this.mbW, (mb / this.mbW) | 0);
          mb++;
        }
      } catch (e) {
        if (e && e.userMsg) throw e;
        // damaged picture: keep what was decoded, take the rest from the previous picture
        for (; mb < total; mb++) if (this.slice[mb] < 0) this.copyMb(mb % this.mbW, (mb / this.mbW) | 0);
      }
    }
    atResync(b, markerLen) {
      const prefix = [0x7f00, 0x7e00, 0x7c00, 0x7800, 0x7000, 0x6000, 0x4000, 0x0000];
      const off = b.p & 7;
      const v = b.peek(16);
      const stuff = 8 - off;
      if ((v >>> (16 - stuff)) !== (prefix[off] >>> (16 - stuff))) return false;
      const save = b.p;
      b.p += stuff;
      const ok = b.peek(markerLen + 1) === 1;
      this.resyncPos = b.p + markerLen + 1;
      b.p = save;
      return ok;
    }
    gobHeader(b, st) {
      const save = b.p;
      if (b.peek(17) !== 1) {
        const al = (8 - (b.p & 7)) & 7;
        if (!al || b.peek(al) !== 0) return false;
        b.p += al;
        if (b.peek(17) !== 1) { b.p = save; return false; }
      }
      b.p += 17;
      b.bits(5);
      if (st.cpm) b.bits(2);
      b.bits(2);
      st.qp = b.bits(5);
      return true;
    }
    mbAvail(mx, my) { return mx >= 0 && my >= 0 && mx < this.mbW && my < this.mbH && this.slice[my * this.mbW + mx] === this.curSlice; }
    decodeMb(b, st, mx, my) {
      const mbi = my * this.mbW + mx;
      this.slice[mbi] = this.curSlice;
      let intra;
      let cbpc;
      let dq;
      let four = false;
      if (st.type === 1) {
        if (b.bit()) { this.skipMb(mx, my); this.qps[mbi] = st.qp; return; }
        let m;
        do { m = rd(b, T.mcbpcP); } while (m === 20);
        const t = m >> 2;
        cbpc = m & 3;
        intra = t === 1 || t === 3;
        dq = t === 2 || t === 3 || t === 6;
        four = t === 4 || t === 6;
        if (four && st.short) throw unsupported('This H.263 video uses advanced prediction, which Fixframe cannot convert.');
      } else {
        let m;
        do { m = rd(b, T.mcbpcI); } while (m === 8);
        intra = true;
        cbpc = m & 3;
        dq = !!(m & 4);
      }
      const acPred = intra && !st.short ? b.bit() : 0;
      let cbpy = rd(b, T.cbpy);
      if (!intra) cbpy ^= 15;
      const dcVlc = st.qp < st.dcThr;
      if (dq) st.qp = Math.min(31, Math.max(1, st.qp + DQ[b.bits(2)]));
      this.qps[mbi] = st.qp;
      const cbp = (cbpy << 2) | cbpc;
      if (intra) {
        for (let k = 0; k < 4; k++) { this.mvx[this.bi(mx, my, k)] = 0; this.mvy[this.bi(mx, my, k)] = 0; }
        for (let n = 0; n < 6; n++) this.intraBlock(b, st, mx, my, n, (cbp >> (5 - n)) & 1, acPred, dcVlc);
        return;
      }
      // motion vectors
      if (four) {
        for (let k = 0; k < 4; k++) {
          const [px, py] = this.predMv(mx, my, k);
          const i = this.bi(mx, my, k);
          this.mvx[i] = this.mvd(b, px, st.fcode);
          this.mvy[i] = this.mvd(b, py, st.fcode);
        }
      } else {
        const [px, py] = this.predMv(mx, my, 0);
        const x = this.mvd(b, px, st.fcode);
        const y = this.mvd(b, py, st.fcode);
        for (let k = 0; k < 4; k++) { const i = this.bi(mx, my, k); this.mvx[i] = x; this.mvy[i] = y; }
      }
      this.predictMb(mx, my, four, st.rounding);
      for (let n = 0; n < 6; n++) if ((cbp >> (5 - n)) & 1) this.interBlock(b, st, mx, my, n);
      this.cleanIntra(mx, my);
    }
    bi(mx, my, k) { return (2 * my + (k >> 1)) * 2 * this.mbW + 2 * mx + (k & 1); }
    skipMb(mx, my) {
      for (let k = 0; k < 4; k++) { const i = this.bi(mx, my, k); this.mvx[i] = 0; this.mvy[i] = 0; }
      this.copyMb(mx, my);
      this.cleanIntra(mx, my);
    }
    copyMb(mx, my) {
      const { cur, ref } = this;
      const ys = this.mbW * 16;
      const cs = this.mbW * 8;
      for (let y = 0; y < 16; y++) { const o = (my * 16 + y) * ys + mx * 16; cur.Y.set(ref.Y.subarray(o, o + 16), o); }
      for (let y = 0; y < 8; y++) { const o = (my * 8 + y) * cs + mx * 8; cur.U.set(ref.U.subarray(o, o + 8), o); cur.V.set(ref.V.subarray(o, o + 8), o); }
    }
    cleanIntra(mx, my) {
      const mbi = my * this.mbW + mx;
      for (let k = 0; k < 4; k++) { const i = this.bi(mx, my, k); this.dcY[i] = 1024; this.acY.fill(0, i * 16, i * 16 + 16); }
      for (let c = 0; c < 2; c++) { this.dcC[c][mbi] = 1024; this.acC[c].fill(0, mbi * 16, mbi * 16 + 16); }
    }
    /* median motion vector prediction (ISO/IEC 14496-2 7.6.5): candidates outside the picture or the video packet are invalid */
    predMv(mx, my, k) {
      const bw = 2 * this.mbW;
      const bx = 2 * mx + (k & 1);
      const by = 2 * my + (k >> 1);
      const off = [2, 1, 1, -1][k];
      const cand = [[bx - 1, by], [bx, by - 1], [bx + off, by - 1]];
      const xs = [];
      const ys = [];
      let invalid = 0;
      const ok = [];
      for (const [x, y] of cand) {
        const valid = x >= 0 && y >= 0 && x < bw && this.mbAvail(x >> 1, y >> 1);
        ok.push(valid);
        if (!valid) invalid++;
        xs.push(valid ? this.mvx[y * bw + x] : 0);
        ys.push(valid ? this.mvy[y * bw + x] : 0);
      }
      if (invalid === 3) return [0, 0];
      if (invalid === 2) { const i = ok.indexOf(true); return [xs[i], ys[i]]; }
      const med = (a, b2, c) => Math.max(Math.min(a, b2), Math.min(Math.max(a, b2), c));
      return [med(xs[0], xs[1], xs[2]), med(ys[0], ys[1], ys[2])];
    }
    mvd(b, pred, fcode) {
      const code = rd(b, T.mv);
      if (code === 0) return pred;
      const sign = b.bit();
      const shift = fcode - 1;
      let val = code;
      if (shift) { val = (val - 1) << shift; val |= b.bits(shift); val++; }
      if (sign) val = -val;
      val += pred;
      const n = 5 + fcode;
      return (val << (32 - n)) >> (32 - n);
    }
    /* half-pel motion compensation from the previous picture, edges repeated (unrestricted motion vectors) */
    mc(src, sw, sh, stride, dst, x, y, size, mvx, mvy, rnd) {
      const ix = x + (mvx >> 1);
      const iy = y + (mvy >> 1);
      const hx = mvx & 1;
      const hy = mvy & 1;
      const inside = ix >= 0 && iy >= 0 && ix + size + 1 <= sw && iy + size + 1 <= sh;
      const px = inside ? (xx, yy) => src[yy * stride + xx] : (xx, yy) => src[Math.min(sh - 1, Math.max(0, yy)) * stride + Math.min(sw - 1, Math.max(0, xx))];
      for (let j = 0; j < size; j++) {
        const o = (y + j) * stride + x;
        for (let i = 0; i < size; i++) {
          const a = px(ix + i, iy + j);
          let v;
          if (!hx && !hy) v = a;
          else if (hx && !hy) v = (a + px(ix + i + 1, iy + j) + 1 - rnd) >> 1;
          else if (!hx) v = (a + px(ix + i, iy + j + 1) + 1 - rnd) >> 1;
          else v = (a + px(ix + i + 1, iy + j) + px(ix + i, iy + j + 1) + px(ix + i + 1, iy + j + 1) + 2 - rnd) >> 2;
          dst[o + i] = v;
        }
      }
    }
    predictMb(mx, my, four, rnd) {
      const { cur, ref, w, h } = this;
      const ys = this.mbW * 16;
      const cs = this.mbW * 8;
      const i0 = this.bi(mx, my, 0);
      if (!four) this.mc(ref.Y, w, h, ys, cur.Y, mx * 16, my * 16, 16, this.mvx[i0], this.mvy[i0], rnd);
      else for (let k = 0; k < 4; k++) { const i = this.bi(mx, my, k); this.mc(ref.Y, w, h, ys, cur.Y, mx * 16 + (k & 1) * 8, my * 16 + (k >> 1) * 8, 8, this.mvx[i], this.mvy[i], rnd); }
      let cx;
      let cy;
      const rc = (x) => M4T.chromaRound[x & 15] + ((x >> 3) & ~1);
      if (!four) { const x = this.mvx[i0]; const y = this.mvy[i0]; cx = (x >> 1) | (x & 1); cy = (y >> 1) | (y & 1); }
      else {
        let sx = 0;
        let sy = 0;
        for (let k = 0; k < 4; k++) { const i = this.bi(mx, my, k); sx += this.mvx[i]; sy += this.mvy[i]; }
        cx = rc(sx); cy = rc(sy);
      }
      const cw = (w + 1) >> 1;
      const ch = (h + 1) >> 1;
      this.mc(ref.U, cw, ch, cs, cur.U, mx * 8, my * 8, 8, cx, cy, rnd);
      this.mc(ref.V, cw, ch, cs, cur.V, mx * 8, my * 8, 8, cx, cy, rnd);
    }
    coefs(b, q, scan, pos, tab, rl, short) {
      for (;;) {
        const sym = rd(b, tab);
        let run;
        let level;
        let last;
        if (sym === 102) {
          if (short) {
            last = b.bit(); run = b.bits(6); level = b.bits(8);
            if (level > 127) level -= 256;
            if (!level || level === -128) throw corrupt();
          } else if (!b.bit()) {
            const s2 = rd(b, tab);
            if (s2 === 102) throw corrupt();
            run = rl.run[s2]; last = s2 >= rl.lastStart ? 1 : 0;
            level = rl.level[s2] + rl.maxLevel[last][run];
            if (b.bit()) level = -level;
          } else if (!b.bit()) {
            const s2 = rd(b, tab);
            if (s2 === 102) throw corrupt();
            level = rl.level[s2]; last = s2 >= rl.lastStart ? 1 : 0;
            run = rl.run[s2] + rl.maxRun[last][level] + 1;
            if (b.bit()) level = -level;
          } else {
            last = b.bit(); run = b.bits(6); b.bit(); level = b.bits(12);
            if (level & 0x800) level -= 0x1000;
            b.bit();
          }
        } else {
          run = rl.run[sym]; level = rl.level[sym]; last = sym >= rl.lastStart ? 1 : 0;
          if (b.bit()) level = -level;
        }
        pos += run;
        if (pos > 63) throw corrupt();
        q[scan[pos]] = level;
        pos++;
        if (last) return;
      }
    }
    dcScale(qp, luma) {
      if (luma) return qp < 5 ? 8 : qp < 9 ? 2 * qp : qp < 25 ? qp + 8 : 2 * qp - 16;
      return qp < 5 ? 8 : qp < 25 ? (qp + 13) >> 1 : qp - 6;
    }
    intraBlock(b, st, mx, my, n, coded, acPred, dcVlc) {
      const q = this.q;
      q.fill(0);
      const qp = st.qp;
      const F = this.F;
      if (st.short) {
        let dc = b.bits(8);
        if (!(dc & 0x7f)) throw corrupt();
        if (dc === 255) dc = 128;
        if (coded) this.coefs(b, q, T.zig, 1, T.inter, T.rlInter, true);
        this.dequant(q, F, qp, true, true);
        F[0] = dc * 8;
        this.put(F, mx, my, n, true);
        return;
      }
      // DC prediction from left (A), above-left (B) and above (C) blocks
      const luma = n < 4;
      const bw = 2 * this.mbW;
      let bx;
      let by;
      let dcArr;
      let acArr;
      let idx;
      let get;
      if (luma) {
        bx = 2 * mx + (n & 1); by = 2 * my + (n >> 1);
        dcArr = this.dcY; acArr = this.acY; idx = by * bw + bx;
        get = (x, y) => (x >= 0 && y >= 0 && this.mbAvail(x >> 1, y >> 1) ? y * bw + x : -1);
      } else {
        bx = mx; by = my;
        dcArr = this.dcC[n - 4]; acArr = this.acC[n - 4]; idx = my * this.mbW + mx;
        get = (x, y) => (this.mbAvail(x, y) ? y * this.mbW + x : -1);
      }
      const ia = get(bx - 1, by);
      const ib = get(bx - 1, by - 1);
      const ic = get(bx, by - 1);
      const a = ia >= 0 ? dcArr[ia] : 1024;
      const bb = ib >= 0 ? dcArr[ib] : 1024;
      const c = ic >= 0 ? dcArr[ic] : 1024;
      const top = Math.abs(a - bb) < Math.abs(bb - c);
      const scale = this.dcScale(qp, luma);
      const pred = Math.floor(((top ? c : a) + (scale >> 1)) / scale);
      let start = 0;
      if (dcVlc) {
        const size = rd(b, luma ? T.dcL : T.dcC);
        let diff = 0;
        if (size) {
          diff = b.bits(size);
          if (!(diff >> (size - 1))) diff -= (1 << size) - 1;
          if (size > 8) b.bit();
        }
        q[0] = diff;
        start = 1;
      }
      const scan = acPred ? (top ? T.altH : T.altV) : T.zig;
      if (coded) this.coefs(b, q, scan, start, T.intra, T.rlIntra, false);
      let dc = (pred + q[0]) * scale;
      if (dc < 0) dc = 0; else if (dc > 2047) dc = 2047;
      dcArr[idx] = dc;
      // AC prediction of the first row (from above) or first column (from the left), rescaled to this quantiser
      const nb = top ? ic : ia;
      if (acPred && nb >= 0) {
        const nmb = luma ? ((((top ? by - 1 : by) >> 1) * this.mbW) + ((top ? bx : bx - 1) >> 1)) : (top ? (my - 1) * this.mbW + mx : my * this.mbW + mx - 1);
        const nqp = this.qps[nmb];
        const rdiv = (x) => (nqp === qp ? x : Math.trunc((x * nqp + (x >= 0 ? qp >> 1 : -(qp >> 1))) / qp));
        for (let i = 1; i < 8; i++) {
          if (top) q[i] += rdiv(acArr[nb * 16 + 8 + i]);
          else q[i * 8] += rdiv(acArr[nb * 16 + i]);
        }
      }
      for (let i = 1; i < 8; i++) { acArr[idx * 16 + i] = q[i * 8]; acArr[idx * 16 + 8 + i] = q[i]; }
      this.dequant(q, F, qp, true, false, dc);
      this.put(F, mx, my, n, true);
    }
    interBlock(b, st, mx, my, n) {
      const q = this.q;
      q.fill(0);
      this.coefs(b, q, T.zig, 0, T.inter, T.rlInter, st.short);
      this.dequant(q, this.F, st.qp, false, st.short);
      this.put(this.F, mx, my, n, false);
    }
    dequant(q, F, qp, intra, short, dc = 0) {
      const v = this.vol;
      if (short || !v.quantType) {
        const mul = qp * 2;
        const add = (qp - 1) | 1;
        for (let i = 0; i < 64; i++) {
          const L = q[i];
          F[i] = L ? (L > 0 ? L * mul + add : L * mul - add) : 0;
        }
        for (let i = 0; i < 64; i++) if (F[i] > 2047) F[i] = 2047; else if (F[i] < -2048) F[i] = -2048;
        if (intra) F[0] = dc;
        return;
      }
      const W = intra ? v.intraMat : v.interMat;
      let sum = 0;
      for (let i = 0; i < 64; i++) {
        const L = q[i];
        let x = 0;
        if (L && !(intra && i === 0)) {
          const a = Math.abs(L);
          x = intra ? (a * qp * W[i]) >> 3 : (((a << 1) + 1) * qp * W[i]) >> 4;
          if (L < 0) x = -x;
          if (x > 2047) x = 2047; else if (x < -2048) x = -2048;
        }
        F[i] = x;
        sum += x;
      }
      if (intra) { F[0] = dc; sum += dc; }
      if (!(sum & 1)) F[63] ^= 1;
    }
    put(F, mx, my, n, intra) {
      const R = this.R;
      idct(F, R);
      let plane;
      let stride;
      let x0;
      let y0;
      if (n < 4) { plane = this.cur.Y; stride = this.mbW * 16; x0 = mx * 16 + (n & 1) * 8; y0 = my * 16 + (n >> 1) * 8; }
      else { plane = n === 4 ? this.cur.U : this.cur.V; stride = this.mbW * 8; x0 = mx * 8; y0 = my * 8; }
      for (let y = 0; y < 8; y++) {
        const o = (y0 + y) * stride + x0;
        for (let x = 0; x < 8; x++) {
          let v = R[y * 8 + x] + (intra ? 0 : plane[o + x]);
          plane[o + x] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      }
    }
    /* current picture as RGBA (ITU-R BT.601, limited range) */
    toImageData(img) {
      const { w, h } = this;
      const d = img.data;
      const Y = this.cur.Y;
      const U = this.cur.U;
      const V = this.cur.V;
      const ys = this.mbW * 16;
      const cs = this.mbW * 8;
      const W = img.width;
      const H = img.height;
      for (let y = 0; y < H && y < h; y++) {
        for (let x = 0; x < W && x < w; x++) {
          const yy = 1.164 * (Y[y * ys + x] - 16);
          const u = U[(y >> 1) * cs + (x >> 1)] - 128;
          const v = V[(y >> 1) * cs + (x >> 1)] - 128;
          const o = (y * W + x) * 4;
          d[o] = yy + 1.596 * v;
          d[o + 1] = yy - 0.392 * u - 0.813 * v;
          d[o + 2] = yy + 2.017 * u;
          d[o + 3] = 255;
        }
      }
    }
  }

  /* ---------- containers ---------- */
  const fourcc = (u8, o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  function boxes(u8, start, end, cb) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let o = start;
    while (o + 8 <= end) {
      let size = dv.getUint32(o);
      const type = fourcc(u8, o + 4);
      let head = 8;
      if (size === 1) { size = dv.getUint32(o + 8) * 4294967296 + dv.getUint32(o + 12); head = 16; } else if (size === 0) size = end - o;
      if (size < head || o + size > end) break;
      cb(type, o + head, o + size, dv);
      o += size;
    }
  }
  /* MP4 / 3GP / MOV: the first video track with its sample table */
  function demuxBmff(u8) {
    let found = null;
    const walk = (s, e, path) => boxes(u8, s, e, (type, a, b, dv) => {
      if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) {
        if (type === 'trak') {
          const t = { };
          walkTrak(a, b, t);
          if (t.handler === 'vide' && !found) found = t;
        } else walk(a, b, path + '/' + type);
      }
    });
    const walkTrak = (s, e, t) => boxes(u8, s, e, (type, a, b, dv) => {
      if (['mdia', 'minf', 'stbl'].includes(type)) walkTrak(a, b, t);
      else if (type === 'mdhd') t.timescale = u8[a] === 1 ? dv.getUint32(a + 20) : dv.getUint32(a + 12);
      else if (type === 'hdlr' && !t.handler) t.handler = fourcc(u8, a + 8); // QuickTime also has a data handler inside minf
      else if (type === 'stsd') {
        const e0 = a + 8;
        t.codec = fourcc(u8, e0 + 4);
        t.width = dv.getUint16(e0 + 8 + 24); t.height = dv.getUint16(e0 + 8 + 26);
        boxes(u8, e0 + 8 + 78, e0 + dv.getUint32(e0), (ct, ca, cb) => { if (ct === 'esds') t.config = esdsConfig(u8, ca + 4, cb); });
      } else if (type === 'stts') { const n = dv.getUint32(a + 4); t.stts = []; for (let i = 0; i < n; i++) t.stts.push([dv.getUint32(a + 8 + i * 8), dv.getUint32(a + 12 + i * 8)]); }
      else if (type === 'stsc') { const n = dv.getUint32(a + 4); t.stsc = []; for (let i = 0; i < n; i++) t.stsc.push([dv.getUint32(a + 8 + i * 12), dv.getUint32(a + 12 + i * 12)]); }
      else if (type === 'stsz') { const fixed = dv.getUint32(a + 4); const n = dv.getUint32(a + 8); t.sizes = []; for (let i = 0; i < n; i++) t.sizes.push(fixed || dv.getUint32(a + 12 + i * 4)); }
      else if (type === 'stco') { const n = dv.getUint32(a + 4); t.chunks = []; for (let i = 0; i < n; i++) t.chunks.push(dv.getUint32(a + 8 + i * 4)); }
      else if (type === 'co64') { const n = dv.getUint32(a + 4); t.chunks = []; for (let i = 0; i < n; i++) t.chunks.push(dv.getUint32(a + 8 + i * 8) * 4294967296 + dv.getUint32(a + 12 + i * 8)); }
    });
    walk(0, u8.length, '');
    if (!found || !found.sizes || !found.chunks || !found.stsc) return null;
    const t = found;
    const samples = [];
    let si = 0;
    for (let c = 0; c < t.chunks.length; c++) {
      let per = 0;
      for (const [first, n] of t.stsc) if (c + 1 >= first) per = n;
      let off = t.chunks[c];
      for (let k = 0; k < per && si < t.sizes.length; k++, si++) { samples.push({ off, size: t.sizes[si] }); off += t.sizes[si]; }
    }
    const ts = t.timescale || 1000;
    let time = 0;
    let i = 0;
    for (const [count, delta] of t.stts || []) for (let k = 0; k < count && i < samples.length; k++, i++) { samples[i].t = time / ts; samples[i].d = delta / ts; time += delta; }
    for (; i < samples.length; i++) { samples[i].t = i / 15; samples[i].d = 1 / 15; }
    const map = { mp4v: 'mpeg4', s263: 'h263', h263: 'h263', H263: 'h263', jpeg: 'mjpeg', mjpa: 'mjpeg', avc1: 'h264', hvc1: 'hevc', hev1: 'hevc' };
    return { codec: map[t.codec] || t.codec, fourcc: t.codec, width: t.width, height: t.height, config: t.config || null, samples };
  }
  function esdsConfig(u8, s, e) {
    let o = s;
    const len = () => { let n = 0; for (let k = 0; k < 4; k++) { const x = u8[o++]; n = (n << 7) | (x & 0x7f); if (!(x & 0x80)) break; } return n; };
    while (o < e) {
      const tag = u8[o++];
      const n = len();
      if (tag === 3) { const fl = u8[o + 2]; o += 3; if (fl & 0x80) o += 2; if (fl & 0x40) o += 1 + u8[o]; if (fl & 0x20) o += 2; continue; }
      if (tag === 4) { o += 13; continue; }
      if (tag === 5) return u8.slice(o, o + n);
      o += n;
    }
    return null;
  }
  /* AVI (incl. OpenDML): the first video stream's frames */
  function demuxAvi(u8) {
    let vs = -1;
    let si = 0;
    let codecFcc = '';
    let w = 0;
    let h = 0;
    let rate = 15;
    let scale = 1;
    const frames = [];
    const hdr = (s, e) => boxes2(s, e, (id, a, b) => {
      if (id === 'LIST') { const lt = fourcc(u8, a); if (lt === 'strl') { strl(a + 4, b); si++; } else hdr(a + 4, b); }
    });
    const strl = (s, e) => {
      let type = '';
      boxes2(s, e, (id, a) => {
        const dv = new DataView(u8.buffer, u8.byteOffset);
        if (id === 'strh') { type = fourcc(u8, a); if (type === 'vids' && vs < 0) { scale = dv.getUint32(a + 20, true) || 1; rate = dv.getUint32(a + 24, true) || 15; } }
        if (id === 'strf' && type === 'vids' && vs < 0) { vs = si; w = dv.getInt32(a + 4, true); h = Math.abs(dv.getInt32(a + 8, true)); codecFcc = fourcc(u8, a + 16); }
      });
    };
    const movi = (s, e) => boxes2(s, e, (id, a, b) => {
      if (id === 'LIST') { movi(a + 4, b); return; }
      if (+id.slice(0, 2) === vs && (id[2] === 'd') && frames.length < 500000) frames.push({ off: a, size: b - a });
    });
    const boxes2 = (s, e, cb) => {
      const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      let o = s;
      while (o + 8 <= e) {
        const id = fourcc(u8, o);
        const size = dv.getUint32(o + 4, true);
        if (o + 8 + size > e) { if (id === 'LIST') cb(id, o + 8, e); break; }
        cb(id, o + 8, o + 8 + size);
        o += 8 + size + (size & 1);
      }
    };
    boxes2(0, u8.length, (id, a, b) => {
      if (id !== 'RIFF') return;
      boxes2(a + 4, b, (cid, ca, cb) => {
        if (cid !== 'LIST') return;
        const lt = fourcc(u8, ca);
        if (lt === 'hdrl') hdr(ca + 4, cb);
        else if (lt === 'movi') movi(ca + 4, cb);
      });
    });
    if (vs < 0) return null;
    const fps = rate / scale;
    const up = codecFcc.toUpperCase();
    const codec = ['XVID', 'DIVX', 'DX50', 'FMP4', 'MP4V', 'M4S2', 'MP4S', 'DIV3', 'UMP4', 'RMP4', 'SEDG', 'WV1F', 'BLZ0', 'DXGM', '3IV2'].includes(up) ? (up === 'DIV3' ? 'msmpeg4' : 'mpeg4')
      : ['MJPG', 'AVRN', 'LJPG', 'JPGL', 'DMB1'].includes(up) ? 'mjpeg' : ['H264', 'AVC1', 'X264'].includes(up) ? 'h264' : up;
    return { codec, fourcc: codecFcc, width: w, height: h, config: null, samples: frames.map((f, i) => ({ off: f.off, size: f.size, t: i / fps, d: 1 / fps })) };
  }
  function demux(u8) {
    if (u8.length > 12 && fourcc(u8, 0) === 'RIFF' && fourcc(u8, 8) === 'AVI ') return demuxAvi(u8);
    if (u8.length > 12 && ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].includes(fourcc(u8, 4))) return demuxBmff(u8);
    return null;
  }
  const NAMES = { h263: 'H.263', mpeg4: 'MPEG-4 Part 2', mjpeg: 'Motion JPEG', h264: 'H.264', hevc: 'HEVC', msmpeg4: 'DivX 3 (MS MPEG-4)' };

  /* Motion JPEG frames often leave out the Huffman tables; add the standard ones */
  let DHT = null;
  function withDht(f) {
    let hasDht = false;
    for (let i = 2; i + 3 < f.length;) {
      if (f[i] !== 0xff) { i++; continue; }
      const m = f[i + 1];
      if (m === 0xc4) { hasDht = true; break; }
      if (m === 0xda) break;
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i++; continue; }
      i += 2 + ((f[i + 2] << 8) | f[i + 3]);
    }
    if (hasDht) return f;
    if (!DHT) DHT = Uint8Array.from(atob(M4T.dht), (c) => c.charCodeAt(0));
    const out = new Uint8Array(f.length + DHT.length);
    out.set(f.subarray(0, 2)); out.set(DHT, 2); out.set(f.subarray(2), 2 + DHT.length);
    return out;
  }

  /* Can this file be one of the old formats? (checked after the browser refused to play it) */
  function mayConvert(file) {
    return /\.(3gp|3gpp|3g2|3gpp2|mp4|m4v|mov|qt|avi|divx|xvid)$/i.test(file.name || '') || /3gpp|msvideo|avi|quicktime|mp4|x-m4v/i.test(file.type || '');
  }

  /* Convert to an H.264 MP4 on this device. onStatus(text) shows progress. */
  async function convert(file, onStatus) {
    if (file.size > 1.5 * 1073741824) throw unsupported('This video is too large to convert here (more than 1.5 GB).');
    const u8 = new Uint8Array(await file.arrayBuffer());
    const info = demux(u8);
    if (!info || !info.samples.length) throw unsupported('This video format cannot be played or converted in this browser. MP4 or MOV (H.264) works best.');
    const name = NAMES[info.codec] || info.fourcc || 'unknown';
    if (!['mpeg4', 'h263', 'mjpeg'].includes(info.codec)) {
      throw unsupported(`This video uses ${name} video, which this browser cannot play and Fixframe cannot convert. Convert it to MP4 (H.264) first, for example with VLC.`);
    }
    const dec = info.codec === 'mjpeg' ? null : new Decoder();
    let W = info.width;
    let H = info.height;
    if (dec && info.config) { try { dec.decode(info.config); } catch (e) { if (e.userMsg) throw e; } }
    if (dec && dec.vol && dec.vol.w) { W = dec.vol.w; H = dec.vol.h; }
    let canvas = null;
    let ctx = null;
    let img = null;
    let sink = null;
    let fps = 15;
    const ds = info.samples.map((s) => s.d).filter((d) => d > 0).sort((a, b) => a - b);
    if (ds.length) fps = Math.min(60, Math.max(1, Math.round(1 / ds[ds.length >> 1])));
    const start = async (w, h) => {
      W = Math.max(2, w & ~1); H = Math.max(2, h & ~1);
      canvas = makeCanvas(W, H);
      ctx = canvas.getContext('2d');
      img = ctx.createImageData(W, H);
      const pick = await pickVideoSink(W, H, fps, Math.round(W * H * fps * 0.16));
      if (!pick) throw unsupported('This browser cannot make videos, so the old video cannot be converted here.');
      sink = pick.sink;
      await sink.init(W, H, fps, canvas);
    };
    let produced = 0;
    let lastT = -1;
    const n = info.samples.length;
    let lastReport = 0;
    try {
      for (let i = 0; i < n; i++) {
        const s = info.samples[i];
        if (s.off + s.size > u8.length) break;
        const data = u8.subarray(s.off, s.off + s.size);
        let have = false;
        if (!dec) {
          if (s.size > 4) {
            try {
              const bmp = await createImageBitmap(new Blob([withDht(data)], { type: 'image/jpeg' }));
              if (!sink) await start(bmp.width, bmp.height);
              ctx.drawImage(bmp, 0, 0, W, H);
              if (bmp.close) bmp.close();
              have = true;
            } catch (e) { have = produced > 0; }
          } else have = produced > 0;
        } else {
          let r = null;
          try { r = s.size ? dec.decode(data) : 'skip'; } catch (e) { if (e.userMsg) throw e; r = dec.decoded ? 'skip' : null; }
          if (r === 'frame') {
            if (!sink) await start(dec.w, dec.h);
            dec.toImageData(img);
            ctx.putImageData(img, 0, 0);
            have = true;
          } else if (r === 'skip' && produced) have = true;
        }
        if (!have || !sink) continue;
        const t = Math.max(s.t, lastT + 0.001);
        await sink.addFrame(canvas, t, s.d || 1 / fps, produced % (fps * 2) === 0);
        lastT = t;
        produced++;
        if (onStatus && performance.now() - lastReport > 250) { lastReport = performance.now(); onStatus(`Converting old video (${name})… ${Math.round(((i + 1) / n) * 100)}%`); }
      }
      if (!produced) throw unsupported(`This ${name} video could not be read. It may be damaged.`);
      const blob = await sink.finish();
      const base = String(file.name || 'video').replace(/\.[a-z0-9]{2,5}$/i, '');
      return new File([blob], `${base}.${blob.type.includes('webm') ? 'webm' : 'mp4'}`, { type: blob.type || 'video/mp4' });
    } catch (e) {
      if (sink && sink.abort) sink.abort();
      throw e;
    } finally { if (canvas) freeCanvas(canvas); }
  }
  return { convert, mayConvert, demux, Decoder, codecName: (c) => NAMES[c] || c };
})();

/* File pickers list old formats too (some phones and computers give them no video type). */
const VIDEO_ACCEPT = 'video/*,.3gp,.3gpp,.3g2,.3gpp2,.avi,.divx,.xvid,.mov,.qt,.mp4,.m4v,.mkv,.webm';
const isVideoFile = (f) => !f.type || /^video\//.test(f.type) || /\.(3gp|3gpp|3g2|3gpp2|avi|divx|xvid|mov|qt|mp4|m4v|mkv|webm)$/i.test(f.name || '');

/* A video the browser can play: the file itself, or a converted copy of an old format. */
async function playableVideo(file, onStatus) {
  let url = URL.createObjectURL(file);
  try { return { file, url, meta: await probeVideo(url), converted: false }; } catch (e) { URL.revokeObjectURL(url); }
  if (!OldVideo.mayConvert(file)) {
    const err = new Error('unplayable');
    err.unplayable = true;
    throw err;
  }
  if (onStatus) onStatus('Converting old video…');
  const conv = await OldVideo.convert(file, onStatus);
  url = URL.createObjectURL(conv);
  try { return { file: conv, url, meta: await probeVideo(url), converted: true }; } catch (e) {
    URL.revokeObjectURL(url);
    const err = new Error('unplayable');
    err.unplayable = true;
    err.userMsg = 'The converted video could not be played in this browser.';
    throw err;
  }
}
