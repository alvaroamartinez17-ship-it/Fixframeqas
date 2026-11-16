/* ============================================================================================================
   fast-video-reader.js
   What it does:    Reads the frames of a video quickly for the export, and checks itself: if a frame is not right,
                   the export uses the slow, careful way.
   Change here:     Nothing.
   Engine room: better leave it as it is.
   Technical note:  Fast frames for exports: MP4 / MOV / 3GP files are read and decoded in order with WebCodecs,
                   instead of seeking the <video> element once per frame (each seek makes the browser decode again
                   from the last key frame, which is very slow for long or high-resolution videos and almost stops
                   when the tab is in the background). Anything this reader cannot handle returns null, and the
                   export uses the <video> element as before.
   ============================================================================================================ */
const FrameReader = (() => {
  const fcc = (u8, o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  const hex2 = (n) => n.toString(16).padStart(2, '0');

  function boxes(u8, s, e, cb) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let o = s;
    while (o + 8 <= e) {
      let size = dv.getUint32(o);
      const type = fcc(u8, o + 4);
      let head = 8;
      if (size === 1) { size = dv.getUint32(o + 8) * 4294967296 + dv.getUint32(o + 12); head = 16; }
      else if (size === 0) size = e - o;
      if (size < head || o + size > e) break;
      cb(type, o + head, o + size, dv);
      o += size;
    }
  }

  /* Find the top-level 'moov' box without reading the whole file (it may sit at the end). */
  async function readMoov(blob) {
    let o = 0;
    let fragmented = false;
    let moov = null;
    for (let guard = 0; o + 8 <= blob.size && guard < 10000; guard++) {
      const h = new Uint8Array(await blob.slice(o, o + 16).arrayBuffer());
      if (h.length < 8) break;
      const dv = new DataView(h.buffer);
      let size = dv.getUint32(0);
      const type = fcc(h, 4);
      if (guard === 0 && !['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(type)) return null;
      if (size === 1) size = dv.getUint32(8) * 4294967296 + dv.getUint32(12);
      else if (size === 0) size = blob.size - o;
      if (size < 8) return null;
      if (type === 'moov') {
        if (size > 256 * 1048576) return null;
        moov = new Uint8Array(await blob.slice(o, o + size).arrayBuffer());
      } else if (type === 'moof') fragmented = true;
      o += size;
    }
    return moov && !fragmented ? moov : null;
  }

  function codecString(type, cfg) {
    const c = cfg.data;
    if ((type === 'avc1' || type === 'avc3') && cfg.type === 'avcC' && c.length > 4) return `avc1.${hex2(c[1])}${hex2(c[2])}${hex2(c[3])}`;
    if ((type === 'hvc1' || type === 'hev1') && cfg.type === 'hvcC' && c.length > 13) {
      const space = ['', 'A', 'B', 'C'][c[1] >> 6];
      const tier = c[1] & 0x20 ? 'H' : 'L';
      const prof = c[1] & 0x1f;
      let compat = ((c[2] << 24) | (c[3] << 16) | (c[4] << 8) | c[5]) >>> 0;
      let rev = 0;
      for (let i = 0; i < 32; i++) { rev = (rev << 1) | (compat & 1); compat >>>= 1; }
      const cons = Array.from(c.subarray(6, 12));
      while (cons.length && !cons[cons.length - 1]) cons.pop();
      return `${type}.${space}${prof}.${(rev >>> 0).toString(16)}.${tier}${c[12]}${cons.map((b) => '.' + b.toString(16)).join('')}`;
    }
    if (type === 'vp09' && cfg.type === 'vpcC' && c.length > 7) return `vp09.${String(c[4]).padStart(2, '0')}.${String(c[5]).padStart(2, '0')}.${String(c[6] >> 4).padStart(2, '0')}`;
    if (type === 'av01' && cfg.type === 'av1C' && c.length > 3) {
      const bits = c[2] & 0x40 ? (c[2] & 0x20 ? 12 : 10) : 8;
      return `av01.${c[1] >> 5}.${String(c[1] & 0x1f).padStart(2, '0')}${c[2] & 0x80 ? 'H' : 'M'}.${String(bits).padStart(2, '0')}`;
    }
    return null;
  }

  /* First video track: codec, decoder description, display rotation and every sample with its times. */
  function parseTrack(moov) {
    let track = null;
    let movieScale = 1000;
    boxes(moov, 8, moov.length, (type, a, b, dv) => {
      if (type === 'mvhd') movieScale = dv.getUint32(a + (moov[a] === 1 ? 20 : 12)) || 1000;
      if (type !== 'trak' || track) return;
      const t = {};
      const walk = (s, e) => boxes(moov, s, e, (ty, x, y, d) => {
        if (['mdia', 'minf', 'stbl', 'edts'].includes(ty)) walk(x, y);
        else if (ty === 'tkhd') {
          const v1 = moov[x] === 1;
          const m = x + (v1 ? 52 : 40);
          t.matrix = [d.getInt32(m) / 65536, d.getInt32(m + 4) / 65536, d.getInt32(m + 12) / 65536, d.getInt32(m + 16) / 65536];
        } else if (ty === 'elst') {
          const v1 = moov[x] === 1;
          const n = d.getUint32(x + 4);
          let o = x + 8;
          for (let i = 0; i < n; i++) {
            const mt = v1 ? d.getInt32(o + 8) * 4294967296 + d.getUint32(o + 12) : d.getInt32(o + 4);
            const segDur = v1 ? d.getUint32(o) * 4294967296 + d.getUint32(o + 4) : d.getUint32(o);
            if (mt === -1) { t.emptyEdit = (t.emptyEdit || 0) + segDur; }
            else if (t.mediaTime == null) t.mediaTime = mt;
            else t.multiEdit = true;
            o += v1 ? 20 : 12;
          }
        } else if (ty === 'mdhd') t.scale = d.getUint32(x + (moov[x] === 1 ? 20 : 12));
        else if (ty === 'hdlr' && !t.handler) t.handler = fcc(moov, x + 8);
        else if (ty === 'stsd') {
          const e0 = x + 8;
          t.entries = d.getUint32(x + 4);
          t.type = fcc(moov, e0 + 4);
          t.codedW = d.getUint16(e0 + 32);
          t.codedH = d.getUint16(e0 + 34);
          boxes(moov, e0 + 86, e0 + d.getUint32(e0), (ct, ca, cb) => {
            if (['avcC', 'hvcC', 'vpcC', 'av1C'].includes(ct) && !t.cfg) t.cfg = { type: ct, data: moov.slice(ca, cb) };
            if (ct === 'pasp' && d.getUint32(ca) !== d.getUint32(ca + 4)) t.nonSquare = true;
            if (ct === 'colr') t.colr = true;
          });
        } else if (ty === 'stts') { const n = d.getUint32(x + 4); t.stts = []; for (let i = 0; i < n; i++) t.stts.push([d.getUint32(x + 8 + i * 8), d.getUint32(x + 12 + i * 8)]); }
        else if (ty === 'ctts') { const n = d.getUint32(x + 4); // offsets read as signed: QuickTime and iPhone files store negative ones even with version 0
          t.ctts = []; for (let i = 0; i < n; i++) t.ctts.push([d.getUint32(x + 8 + i * 8), d.getInt32(x + 12 + i * 8)]); }
        else if (ty === 'stss') { const n = d.getUint32(x + 4); t.stss = new Set(); for (let i = 0; i < n; i++) t.stss.add(d.getUint32(x + 8 + i * 4) - 1); }
        else if (ty === 'stsc') { const n = d.getUint32(x + 4); t.stsc = []; for (let i = 0; i < n; i++) t.stsc.push([d.getUint32(x + 8 + i * 12), d.getUint32(x + 12 + i * 12)]); }
        else if (ty === 'stsz') { const fixed = d.getUint32(x + 4); const n = d.getUint32(x + 8); t.sizes = new Array(n); for (let i = 0; i < n; i++) t.sizes[i] = fixed || d.getUint32(x + 12 + i * 4); }
        else if (ty === 'stco') { const n = d.getUint32(x + 4); t.chunks = []; for (let i = 0; i < n; i++) t.chunks.push(d.getUint32(x + 8 + i * 4)); }
        else if (ty === 'co64') { const n = d.getUint32(x + 4); t.chunks = []; for (let i = 0; i < n; i++) t.chunks.push(d.getUint32(x + 8 + i * 8) * 4294967296 + d.getUint32(x + 12 + i * 8)); }
      });
      walk(a, b);
      if (t.handler === 'vide') track = t;
    });
    const t = track;
    if (!t || !t.cfg || !t.sizes || !t.chunks || !t.stsc || !t.stts || !t.scale || t.entries !== 1 || t.nonSquare || t.multiEdit) return null;
    const codec = codecString(t.type, t.cfg);
    if (!codec) return null;
    const n = t.sizes.length;
    const samples = new Array(n);
    let si = 0;
    for (let c = 0; c < t.chunks.length && si < n; c++) {
      let per = 0;
      for (const [first, k] of t.stsc) if (c + 1 >= first) per = k;
      let off = t.chunks[c];
      for (let k = 0; k < per && si < n; k++, si++) { samples[si] = { off, size: t.sizes[si] }; off += t.sizes[si]; }
    }
    if (si < n) return null;
    let dts = 0;
    let i = 0;
    for (const [count, delta] of t.stts) for (let k = 0; k < count && i < n; k++, i++) { samples[i].dts = dts; samples[i].d = delta / t.scale; dts += delta; }
    if (i < n) return null;
    i = 0;
    if (t.ctts) for (const [count, off] of t.ctts) for (let k = 0; k < count && i < n; k++, i++) samples[i].cto = off;
    // Times as the <video> element shows them: the edit list moves the start, an empty edit delays it.
    const shift = (t.mediaTime || 0) - ((t.emptyEdit || 0) / movieScale) * t.scale;
    for (let k = 0; k < n; k++) {
      const s = samples[k];
      s.key = t.stss ? t.stss.has(k) : true;
      s.pts = (s.dts + (s.cto || 0) - shift) / t.scale;
    }
    const [ma, mb] = t.matrix || [1, 0, 0, 1];
    const rot = ((Math.round((Math.atan2(mb, ma) * 180) / Math.PI / 90) * 90) % 360 + 360) % 360;
    return { colr: !!t.colr, codec, description: t.cfg.type === 'avcC' || t.cfg.type === 'hvcC' ? t.cfg.data : undefined, codedW: t.codedW, codedH: t.codedH, rot, samples };
  }

  class Reader {
    constructor(blob, tr, config) {
      this.blob = blob;
      this.tr = tr;
      this.config = config;
      this.frames = [];
      this.cur = null;
      this.err = null;
      this.wake = null;
      // Every frame time in showing order: frameAt() asks for exactly the frame that this table puts on screen.
      this.times = Float64Array.from(tr.samples, (s) => s.pts).sort();
      this.first = this.times[0];
      const durs = Float64Array.from(tr.samples, (s) => s.d || 0).sort();
      this.tol = Math.round(Math.max(0.12, 3 * (durs[durs.length >> 1] || 0.04)) * 1e6);
      this.makeDecoder();
    }
    makeDecoder() {
      if (this.dec) { try { this.dec.close(); } catch (e) { /* ignore */ } }
      this.err = null;
      this.dec = new VideoDecoder({
        output: (f) => {
          // kept in showing order, also for decoders that hand frames out in decoding order
          let i = this.frames.length;
          while (i > 0 && this.frames[i - 1].timestamp > f.timestamp) i--;
          this.frames.splice(i, 0, f);
          this.poke();
        },
        error: (e) => { this.err = e; this.poke(); },
      });
      this.dec.configure(this.config);
      this.hasDequeue = 'ondequeue' in this.dec;
      if (this.hasDequeue) this.dec.ondequeue = () => this.poke();
    }
    poke() { const w = this.wake; this.wake = null; clearTimeout(this.stallTimer); if (w) w(); }
    /* Waits for the decoder. A decoder that stays silent for 10 s counts as stuck: the export then uses the <video> element. */
    waitEvent() {
      return new Promise((r) => {
        this.wake = r;
        clearTimeout(this.stallTimer);
        this.stallTimer = setTimeout(() => { if (!this.err) this.err = new Error('The video decoder stopped answering'); this.poke(); }, 10000);
        if (!this.hasDequeue) yieldNow().then(() => { if (this.wake === r) this.poke(); }); // browsers without the dequeue event
      });
    }
    async flushAll() {
      let timer = 0;
      const stuck = new Promise((r, rej) => { timer = setTimeout(() => rej(new Error('The video decoder did not finish')), 15000); });
      try { await Promise.race([this.dec.flush(), stuck]); } finally { clearTimeout(timer); }
    }
    /* Middle of the frame that is on screen at time t (a time at which every decoder must show the same frame). */
    midFrame(t) {
      let best = null;
      for (const s of this.tr.samples) if (s.pts <= t + 1e-4 && (!best || s.pts > best.pts)) best = s;
      if (!best) return t;
      return best.pts + Math.min(best.d || 0.04, 0.2) / 2;
    }
    keyBefore(t) {
      const S = this.tr.samples;
      let k = 0;
      for (let i = 0; i < S.length; i++) { if (S[i].key && S[i].pts <= t + 1e-4) k = i; if (S[i].pts > t + 5) break; }
      return k;
    }
    /* Start decoding again at sample k (a key frame). */
    restart(k) {
      this.frames.forEach((f) => f.close());
      this.frames = [];
      if (this.cur) { this.cur.close(); this.cur = null; }
      if (this.err || this.dec.state === 'closed') this.makeDecoder();
      else { this.dec.reset(); this.dec.configure(this.config); }
      this.feedAt = k;
      this.finished = false;
    }
    async feedOne() {
      const s = this.tr.samples[this.feedAt];
      const data = new Uint8Array(await this.blob.slice(s.off, s.off + s.size).arrayBuffer());
      this.dec.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: Math.round(s.pts * 1e6), duration: Math.round(s.d * 1e6), data }));
      this.feedAt++;
    }
    /* Time stamp (µs) of the frame that is on screen at time t, from the file's own table. */
    expectTs(t) {
      const T = this.times;
      let lo = 0;
      let hi = T.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (T[mid] <= t + 0.0005) lo = mid; else hi = mid - 1; }
      return Math.round(T[lo] * 1e6);
    }
    /* The frame the <video> element would show at time t: the last one that starts at or before t. */
    async frameAt(t) {
      t = Math.max(t, this.first);
      const E = this.expectTs(t);
      const S = this.tr.samples;
      const pos = this.cur ? this.cur.timestamp : -Infinity;
      if (pos > E + 1500) this.restart(this.keyBefore(t));
      else if (E - Math.max(pos, this.feedAt < S.length ? S[this.feedAt].pts * 1e6 - 1e6 : pos) > 3e6) {
        const k = this.keyBefore(t);
        if (k > this.feedAt) this.restart(k);
      }
      for (;;) {
        if (this.closed) throw new Error('Reader closed');
        if (this.err) throw this.err;
        // 1.5 ms of slack: some decoders give the time stamps back slightly rounded
        while (this.frames.length && this.frames[0].timestamp <= E + 1500) {
          if (this.cur) this.cur.close();
          this.cur = this.frames.shift();
        }
        if (this.cur && Math.abs(this.cur.timestamp - E) <= 1500) break;
        // Not there yet. Later frames alone do not end the wait (a decoder may hand frames out of order);
        // 8 later frames, or one that is a second ahead, do: the frame was dropped.
        const n = this.frames.length;
        if (this.finished || n >= 8 || (n && this.frames[n - 1].timestamp - E > 1e6)) break;
        if (this.feedAt < S.length) {
          if (this.dec.decodeQueueSize < 6) await this.feedOne();
          else await this.waitEvent();
        } else {
          await this.flushAll();
          this.finished = true;
        }
      }
      if (!this.cur && this.frames.length) this.cur = this.frames.shift();
      if (!this.cur) throw new Error('No frame decoded');
      // A frame from the wrong moment (a stuck or confused decoder) must never go into the video.
      if (Math.abs(this.cur.timestamp - E) > this.tol) throw new Error(`Wrong frame time (${((this.cur.timestamp - E) / 1e6).toFixed(2)} s)`);
      return this.view();
    }
    view() {
      const f = this.cur;
      const rot = this.tr.rot;
      const w = f.displayWidth;
      const h = f.displayHeight;
      return {
        videoWidth: rot % 180 ? h : w,
        videoHeight: rot % 180 ? w : h,
        drawTo(ctx, x, y, dw, dh) {
          if (!rot) { ctx.drawImage(f, x, y, dw, dh); return; }
          ctx.save();
          ctx.translate(x + dw / 2, y + dh / 2);
          ctx.rotate((rot * Math.PI) / 180);
          if (rot % 180) ctx.drawImage(f, -dh / 2, -dw / 2, dh, dw);
          else ctx.drawImage(f, -dw / 2, -dh / 2, dw, dh);
          ctx.restore();
        },
      };
    }
    close() {
      this.closed = true;
      clearTimeout(this.stallTimer);
      this.frames.forEach((f) => f.close());
      this.frames = [];
      if (this.cur) { this.cur.close(); this.cur = null; }
      try { if (this.dec.state !== 'closed') this.dec.close(); } catch (e) { /* ignore */ }
    }
  }

  async function open(blob) {
    if (window.__ffNoFastFrames || typeof VideoDecoder === 'undefined' || typeof EncodedVideoChunk === 'undefined' || !blob) return null;
    try {
      const moov = await readMoov(blob);
      if (!moov) return null;
      const tr = parseTrack(moov);
      if (!tr || !tr.samples.length) return null;
      const config = { codec: tr.codec, codedWidth: tr.codedW, codedHeight: tr.codedH, optimizeForLatency: false };
      if (tr.description) config.description = tr.description;
      // Untagged SD video: the <video> element treats it as BT.601, so do the same (HD defaults to BT.709 anyway).
      if (!tr.colr && Math.max(tr.codedW, tr.codedH) < 1280 && Math.min(tr.codedW, tr.codedH) < 720) config.colorSpace = { primaries: 'smpte170m', transfer: 'smpte170m', matrix: 'smpte170m', fullRange: false };
      const sup = await VideoDecoder.isConfigSupported(config).catch(() => null);
      if (!sup || !sup.supported) return null;
      const r = new Reader(blob, tr, config);
      r.restart(0);
      return r;
    } catch (e) { return null; }
  }
  return { open, parseTrack, readMoov };
})();
