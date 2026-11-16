/* ============================================================================================================
   mp4-writer.js
   What it does:    Turns the painted frames into an MP4 video file (H.264), using the video chip of the device.
   Change here:     Nothing.
   Engine room: better leave it as it is.
   Technical note:  H.264 encoding with WebCodecs and a small MP4 (ISO BMFF) writer. Video only, fast-start layout.
   ============================================================================================================ */
const U32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const U16 = (n) => [(n >>> 8) & 255, n & 255];
const STR = (s) => Array.from(s, (c) => c.charCodeAt(0) & 255);
function catBytes(parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function mp4box(type, ...parts) {
  const body = catBytes(parts);
  return catBytes([U32(body.length + 8), STR(type), body]);
}
function mp4full(type, version, flags, ...parts) {
  return mp4box(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...parts);
}
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].flatMap(U32);
function toU8(buf) {
  if (buf instanceof Uint8Array) return buf;
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function splitAnnexB(u8) {
  const nals = [];
  let i = 0;
  let start = -1;
  while (i + 2 < u8.length) {
    if (u8[i] === 0 && u8[i + 1] === 0 && (u8[i + 2] === 1 || (u8[i + 2] === 0 && i + 3 < u8.length && u8[i + 3] === 1))) {
      const sc = u8[i + 2] === 1 ? 3 : 4;
      if (start >= 0) nals.push(u8.subarray(start, i));
      i += sc;
      start = i;
    } else i++;
  }
  if (start >= 0) nals.push(u8.subarray(start));
  return nals.map((n) => { let e = n.length; while (e > 0 && n[e - 1] === 0) e--; return n.subarray(0, e); }).filter((n) => n.length);
}

class Mp4Muxer {
  constructor(width, height, fps) {
    this.w = width; this.h = height; this.fps = fps;
    this.ts = 90000;
    this.samples = [];
    this.desc = null;
  }
  add(chunk, meta) {
    if (!this.desc && meta && meta.decoderConfig && meta.decoderConfig.description) this.desc = toU8(meta.decoderConfig.description).slice();
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    this.samples.push({ pts: chunk.timestamp, key: chunk.type === 'key', data });
  }
  convertAnnexB() {
    let sps = null;
    let pps = null;
    for (const s of this.samples) {
      const out = [];
      for (const n of splitAnnexB(s.data)) {
        const type = n[0] & 0x1f;
        if (type === 7) { if (!sps) sps = n.slice(); continue; }
        if (type === 8) { if (!pps) pps = n.slice(); continue; }
        if (type === 9) continue;
        out.push(U32(n.length), n);
      }
      s.data = catBytes(out);
    }
    if (!sps || !pps) throw new Error('The video encoder produced no stream headers.');
    this.desc = catBytes([[1, sps[1], sps[2], sps[3], 0xff, 0xe1], U16(sps.length), sps, [1], U16(pps.length), pps]);
  }
  finish() {
    if (!this.samples.length) throw new Error('No video frames were encoded.');
    if (!this.desc) this.convertAnnexB();
    const n = this.samples.length;
    const ts = this.ts;
    const frameDur = Math.round(ts / this.fps);
    const pts = this.samples.map((s) => Math.round((s.pts * ts) / 1e6));
    const sorted = pts.slice().sort((a, b) => a - b);
    const base = sorted[0];
    let minOff = 0;
    const offs = pts.map((p, i) => { const o = p - sorted[i]; if (o < minOff) minOff = o; return o; });
    const shift = -minOff;
    const ctts = offs.map((o) => o + shift);
    const durs = sorted.map((d, i) => (i < n - 1 ? sorted[i + 1] - d : frameDur));
    const mediaDur = durs.reduce((a, b) => a + b, 0);
    const movieDur = Math.round((mediaDur * 1000) / ts);
    const editStart = shift; // composition times start at `shift` when B-frames reorder the stream

    const runs = (arr) => {
      const out = [];
      for (const v of arr) {
        const last = out[out.length - 1];
        if (last && last[1] === v) last[0]++; else out.push([1, v]);
      }
      return out;
    };
    const stts = runs(durs);
    const cttsRuns = runs(ctts);
    const needCtts = ctts.some((c) => c !== 0);
    const keys = [];
    this.samples.forEach((s, i) => { if (s.key) keys.push(i + 1); });
    const sizes = this.samples.map((s) => s.data.length);

    const build = (offsets) => {
      const avc1 = mp4box('avc1',
        [0, 0, 0, 0, 0, 0], U16(1), U16(0), U16(0), U32(0), U32(0), U32(0),
        U16(this.w), U16(this.h), U32(0x00480000), U32(0x00480000), U32(0), U16(1),
        [8].concat(STR('Fixframe'), new Array(23).fill(0)), U16(0x18), U16(0xffff),
        mp4box('avcC', this.desc), mp4box('pasp', U32(1), U32(1)));
      const stbl = mp4box('stbl',
        mp4full('stsd', 0, 0, U32(1), avc1),
        mp4full('stts', 0, 0, U32(stts.length), stts.flatMap(([c, d]) => U32(c).concat(U32(d)))),
        needCtts ? mp4full('ctts', 0, 0, U32(cttsRuns.length), cttsRuns.flatMap(([c, d]) => U32(c).concat(U32(d)))) : [],
        keys.length && keys.length < n ? mp4full('stss', 0, 0, U32(keys.length), keys.flatMap(U32)) : [],
        mp4full('stsc', 0, 0, U32(1), U32(1), U32(1), U32(1)),
        mp4full('stsz', 0, 0, U32(0), U32(n), sizes.flatMap(U32)),
        mp4full('stco', 0, 0, U32(n), offsets.flatMap(U32)));
      const minf = mp4box('minf',
        mp4full('vmhd', 0, 1, U16(0), U16(0), U16(0), U16(0)),
        mp4box('dinf', mp4full('dref', 0, 0, U32(1), mp4full('url ', 0, 1))),
        stbl);
      const mdia = mp4box('mdia',
        mp4full('mdhd', 0, 0, U32(0), U32(0), U32(ts), U32(mediaDur), U16(0x55c4), U16(0)),
        mp4full('hdlr', 0, 0, U32(0), STR('vide'), U32(0), U32(0), U32(0), STR('VideoHandler'), [0]),
        minf);
      const edts = editStart ? mp4box('edts', mp4full('elst', 0, 0, U32(1), U32(movieDur), U32(editStart), U16(1), U16(0))) : [];
      const trak = mp4box('trak',
        mp4full('tkhd', 0, 3, U32(0), U32(0), U32(1), U32(0), U32(movieDur), U32(0), U32(0), U16(0), U16(0), U16(0), U16(0), MATRIX, U32(this.w * 65536), U32(this.h * 65536)),
        edts, mdia);
      const mvhd = mp4full('mvhd', 0, 0, U32(0), U32(0), U32(1000), U32(movieDur), U32(0x00010000), U16(0x0100), U16(0), U32(0), U32(0), MATRIX, new Array(24).fill(0), U32(2));
      return mp4box('moov', mvhd, trak);
    };
    const ftyp = mp4box('ftyp', STR('isom'), U32(0x200), STR('isom'), STR('iso2'), STR('avc1'), STR('mp41'));
    const probe = build(new Array(n).fill(0));
    let off = ftyp.length + probe.length + 8;
    const offsets = sizes.map((sz) => { const o = off; off += sz; return o; });
    const moov = build(offsets);
    const dataLen = sizes.reduce((a, b) => a + b, 0);
    const mdatHead = catBytes([U32(dataLen + 8), STR('mdat')]);
    return new Blob([ftyp, moov, mdatHead].concat(this.samples.map((s) => s.data)), { type: 'video/mp4' });
  }
}

const Mp4Enc = {
  async probe(W, H, fps, bitrate) {
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
    for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.42001f']) {
      const cfg = { codec, width: W, height: H, bitrate, framerate: fps, avc: { format: 'avc' } };
      try {
        const r = await VideoEncoder.isConfigSupported(cfg);
        if (r && r.supported) return Object.assign({}, cfg, r.config || {});
      } catch (e) { /* try next profile */ }
    }
    return null;
  },
};

class Mp4Sink {
  constructor(cfg) { this.cfg = cfg; this.err = null; }
  async init(W, H, fps) {
    this.mux = new Mp4Muxer(W, H, fps);
    this.enc = new VideoEncoder({
      output: (chunk, meta) => { try { this.mux.add(chunk, meta); } catch (e) { this.err = e; } },
      error: (e) => { this.err = e; },
    });
    this.enc.configure(this.cfg);
  }
  async addFrame(canvas, t, d, key) {
    if (this.err) throw this.err;
    const frame = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6), duration: Math.round(d * 1e6) });
    try { this.enc.encode(frame, { keyFrame: !!key }); } finally { frame.close(); }
    while (this.enc.encodeQueueSize > 4) {
      if ('ondequeue' in this.enc) await new Promise((r) => { this.enc.addEventListener('dequeue', r, { once: true }); setTimeout(r, 250); });
      else await yieldNow();
      if (this.err) throw this.err;
    }
  }
  async finish() {
    await this.enc.flush();
    if (this.err) throw this.err;
    try { this.enc.close(); } catch (e) { /* ignore */ }
    return this.mux.finish();
  }
  abort() { try { if (this.enc && this.enc.state !== 'closed') this.enc.close(); } catch (e) { /* ignore */ } }
}
