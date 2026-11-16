/* ============================================================================================================
   fixsound-core.js
   What it does:    The sound part of the Fixsound app, taken over unchanged (Fixsound 1.3.1): the built-in music
                   (files in the sounds folder), the sound styles Standard / Jazz / Lo-fi, the sound packs people
                   made in Fixsound, the mix, and the writer that adds a sound track to an MP4 without touching
                   the picture. Fixframe uses it in sound-export.js.
   Change here:     Better nothing: keep it the same as in Fixsound, so both apps sound the same.
                   Volumes of the styles: STYLES below (0 = silent, 1 = full).
   Engine: better leave it as it is.
   ============================================================================================================ */
/* Fixsound core 1.3.1: MP4 sound writer + sound styles, packs, mix, encoder. See INTEGRATION.md. */
/* ===== MP4: add a sound track without touching the picture =====
   The original file is kept byte for byte. Its index (moov) is switched off,
   the new sound and a new index are appended at the end. */
const MP4 = (() => {
  const u32 = (dv, o) => dv.getUint32(o), str4 = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  async function topBoxes(file) {
    const out = []; let pos = 0;
    while (pos + 8 <= file.size) {
      const dv = new DataView(await file.slice(pos, pos + 16).arrayBuffer());
      let size = u32(dv, 0), hdr = 8; const type = str4(dv, 4);
      if (size === 1) { size = u32(dv, 8) * 4294967296 + u32(dv, 12); hdr = 16; }
      const open = size === 0; if (open) size = file.size - pos;
      if (size < hdr || !/^[\x20-\x7e]{4}$/.test(type)) throw new Error('not an MP4 file');
      out.push({ type, pos, size, hdr, open }); pos += size;
    }
    return out;
  }
  function children(dv, start, end) {
    const out = []; let p = start;
    while (p + 8 <= end) { let size = u32(dv, p), hdr = 8; if (size === 1) { size = u32(dv, p + 8) * 4294967296 + u32(dv, p + 12); hdr = 16; } if (size === 0) size = end - p; if (size < 8) break; out.push({ type: str4(dv, p + 4), pos: p, size, hdr }); p += size; }
    return out;
  }
  const find = (dv, box, type) => children(dv, box.pos + box.hdr, box.pos + box.size).find(b => b.type === type);

  async function inspect(file) {
    const boxes = await topBoxes(file);
    const ftyp = boxes.find(b => b.type === 'ftyp'), moovB = boxes.find(b => b.type === 'moov');
    if (!moovB) throw new Error('no index (moov) found');
    const info = { boxes, moovB, fragmented: boxes.some(b => b.type === 'moof'), brand: '', tracks: [] };
    if (ftyp) info.brand = str4(new DataView(await file.slice(ftyp.pos + 8, ftyp.pos + 12).arrayBuffer()), 0);
    if (moovB.size > 64 * 1048576) throw new Error('index too large');
    const buf = await file.slice(moovB.pos, moovB.pos + moovB.size).arrayBuffer(), dv = new DataView(buf);
    const moov = { pos: 0, size: moovB.size, hdr: moovB.hdr };
    info.moov = buf;
    for (const b of children(dv, moov.hdr, moov.size)) {
      if (b.type === 'mvhd') { const v = dv.getUint8(b.pos + 8); info.mvhd = b; info.mvhdV = v; info.timescale = u32(dv, b.pos + (v ? 28 : 20)); info.duration = v ? u32(dv, b.pos + 32) * 4294967296 + u32(dv, b.pos + 36) : u32(dv, b.pos + 24); }
      if (b.type === 'mvex') info.fragmented = true;
      if (b.type === 'trak') {
        const tk = find(dv, b, 'tkhd'), md = find(dv, b, 'mdia'), hd = md && find(dv, md, 'hdlr');
        info.tracks.push({ box: b, id: tk ? u32(dv, tk.pos + (dv.getUint8(tk.pos + 8) ? 28 : 20)) : 0, kind: hd ? str4(dv, hd.pos + 16) : '' });
      }
    }
    info.hasVideo = info.tracks.some(t => t.kind === 'vide'); info.hasSound = info.tracks.some(t => t.kind === 'soun');
    info.canRemux = !!(info.mvhd && info.hasVideo && !info.fragmented && info.brand !== 'qt  ');
    return info;
  }

  /* --- writing --- */
  const cat = parts => { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
  const be = (...v) => { const o = new Uint8Array(v.length * 4), d = new DataView(o.buffer); v.forEach((x, i) => d.setUint32(i * 4, x >>> 0)); return o; };
  const be16 = (...v) => { const o = new Uint8Array(v.length * 2), d = new DataView(o.buffer); v.forEach((x, i) => d.setUint16(i * 2, x)); return o; };
  const txt = s => Uint8Array.from(s, c => c.charCodeAt(0));
  const box = (type, ...parts) => { const body = cat(parts); return cat([be(body.length + 8), txt(type), body]); };
  const full = (type, vf, ...parts) => box(type, be(vf), ...parts);
  const desc = (tag, body) => { const n = body.length; return cat([Uint8Array.of(tag, 0x80 | (n >> 21) & 127, 0x80 | (n >> 14) & 127, 0x80 | (n >> 7) & 127, n & 127), body]); };
  const MATRIX = be(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);

  function audioTrak(a, id, movieScale, chunkOffsets, perChunk) {
    const n = a.sizes.length, FL = a.frameLen || 1024, mediaDur = n * FL, movieDur = Math.round(mediaDur / a.sampleRate * movieScale);
    const esds = a.codec === 'opus' ? null : full('esds', 0, desc(3, cat([be16(id), Uint8Array.of(0),
      desc(4, cat([Uint8Array.of(0x40, 0x15, 0, 0x18, 0), be(a.bitrate, a.bitrate), desc(5, a.asc)])), desc(6, Uint8Array.of(2))])));
    const entryHead = [be(0), be16(0, 1), be(0, 0), be16(a.channels, 16, 0, 0), be(a.sampleRate * 65536)];
    let entry;
    if (a.codec === 'opus') { // OpusHead (little endian) -> dOps (big endian)
      const hd = a.head && a.head.length >= 19 ? new DataView(a.head.buffer, a.head.byteOffset, a.head.byteLength) : null;
      entry = box('Opus', ...entryHead, box('dOps', Uint8Array.of(0, a.channels), be16(hd ? hd.getUint16(10, true) : 312), be(48000), be16(0), Uint8Array.of(0)));
    } else entry = box('mp4a', ...entryHead, esds);
    const stsc = [[1, perChunk, 1]], last = n - (chunkOffsets.length - 1) * perChunk;
    if (chunkOffsets.length > 1 && last !== perChunk) stsc.push([chunkOffsets.length, last, 1]); else if (chunkOffsets.length === 1) stsc[0][1] = n;
    const co = new Uint8Array(chunkOffsets.length * 8), cd = new DataView(co.buffer);
    chunkOffsets.forEach((o, i) => { cd.setUint32(i * 8, Math.floor(o / 4294967296)); cd.setUint32(i * 8 + 4, o >>> 0); });
    const stbl = box('stbl', full('stsd', 0, be(1), entry), full('stts', 0, be(1, n, FL)), full('stsc', 0, be(stsc.length), ...stsc.map(e => be(...e))),
      full('stsz', 0, be(0, n), be(...a.sizes)), full('co64', 0, be(chunkOffsets.length), co));
    return box('trak',
      full('tkhd', 7, be(0, 0, id, 0, movieDur, 0, 0), be16(0, 1, 0x0100, 0), MATRIX, be(0, 0)),
      box('mdia', full('mdhd', 0, be(0, 0, a.sampleRate, mediaDur), be16(0x55c4, 0)),
        full('hdlr', 0, be(0), txt('soun'), be(0, 0, 0), txt('Sound\0')),
        box('minf', full('smhd', 0, be(0)), box('dinf', full('dref', 0, be(1), full('url ', 1))), stbl)));
  }

  /* a: { sampleRate, channels, bitrate, asc: Uint8Array, frames: Uint8Array[] } -> Blob */
  function addSound(file, info, a) {
    const dv = new DataView(info.moov), src = new Uint8Array(info.moov);
    a.sizes = a.frames.map(f => f.length);
    const mdatBody = a.sizes.reduce((x, y) => x + y, 0), mdatHdr = mdatBody + 8 > 0xffffffff ? 16 : 8;
    const perChunk = 43, offs = []; let p = file.size + mdatHdr;
    a.sizes.forEach((s, i) => { if (i % perChunk === 0) offs.push(p); p += s; });
    const id = Math.max(0, ...info.tracks.map(t => t.id)) + 1;
    const mv = src.slice(info.mvhd.pos, info.mvhd.pos + info.mvhd.size), mdv = new DataView(mv.buffer);
    const aDur = Math.round(a.sizes.length * (a.frameLen || 1024) / a.sampleRate * info.timescale), dur = Math.max(info.duration, aDur);
    if (info.mvhdV) { mdv.setUint32(32, Math.floor(dur / 4294967296)); mdv.setUint32(36, dur >>> 0); } else mdv.setUint32(24, dur);
    mdv.setUint32(mv.length - 4, id + 1);
    const vids = info.tracks.filter(t => t.kind === 'vide').map(t => src.subarray(t.box.pos, t.box.pos + t.box.size));
    const moov = box('moov', mv, ...vids, audioTrak(a, id, info.timescale, offs, perChunk));
    const parts = [], mb = info.moovB, lastB = info.boxes[info.boxes.length - 1];
    parts.push(file.slice(0, mb.pos + 4), txt('free'));
    if (lastB.open && lastB !== mb) { // a box that "runs to the end of the file" gets its real size
      if (lastB.size > 0xffffffff) throw new Error('file layout not supported');
      parts.push(file.slice(mb.pos + 8, lastB.pos), be(lastB.size), file.slice(lastB.pos + 4));
    } else parts.push(file.slice(mb.pos + 8));
    if (mb.open) throw new Error('file layout not supported');
    parts.push(mdatHdr === 8 ? cat([be(mdatBody + 8), txt('mdat')]) : cat([be(1), txt('mdat'), be(Math.floor((mdatBody + 16) / 4294967296), (mdatBody + 16) >>> 0)]));
    parts.push(...a.frames, moov);
    return new Blob(parts, { type: 'video/mp4' });
  }
  return { inspect, addSound };
})();
if (typeof module !== 'undefined') module.exports = MP4;

/* ===== Fixsound core =====
   Everything needed to put sound under a finished video, without any screen code:
   built-in sounds, the user's sound packs, sound styles per video part, the mix,
   the sound encoder and the MP4 writer (MP4, in mp4.js, is loaded before this file).
   Used by the Fixsound app, and written so that Fixframe can take it over unchanged
   for a later "Add sound" option in its video export. See INTEGRATION.md. */
const FixsoundCore = (() => {
  const VERSION = '1.3.1';
  let base = ''; // folder that holds the snd-*.m4a files, relative to the page ('' = same folder)

  /* --- built-in sounds: finished audio files shipped with the app (made by tools/music.js) --- */
  const BUILTIN = [
    { id: 'std1', name: 'Opening', group: 'Standard', n: 846720 },
    { id: 'std2', name: 'Calm', group: 'Standard', n: 641455 },
    { id: 'std3', name: 'Steady', group: 'Standard', n: 962182 },
    { id: 'std4', name: 'Daylight', group: 'Standard', n: 784000 },
    { id: 'std5', name: 'Focus', group: 'Standard', n: 1058400 },
    { id: 'std6', name: 'Wrap-up', group: 'Standard', n: 900766 },
    { id: 'std7', name: 'Quiet room', group: 'Standard', n: 705600 },
    { id: 'jazz1', name: 'Walking trio', group: 'Jazz', n: 1282909 },
    { id: 'lofi1', name: 'Slow afternoon', group: 'Lo-fi', n: 1114105 },
    { id: 'chime', name: 'Attention tone', group: 'Tone', n: 114660, tone: true },
    { id: 'tick', name: 'Step tone', group: 'Tone', n: 61740, tone: true }
  ];
  const FILES = BUILTIN.map(s => 'snd-' + s.id + '.m4a');

  /* --- the four parts of a Fixframe video and the built-in styles: part -> [sound key, volume] --- */
  const PARTS = [['intro', 'Presentation'], ['safety', 'Safety'], ['steps', 'Steps'], ['closing', 'Closing']];
  const one = (key, v) => ({ intro: [key, v], safety: [key, v * 0.6], steps: [key, v * 0.75], closing: [key, v] });
  const STYLES = [
    { id: 'standard', n: 'Standard', parts: { intro: ['b:std1', 0.7], safety: ['b:std2', 0.45], steps: ['b:std3', 0.5], closing: ['b:std1', 0.7] } },
    { id: 'jazz', n: 'Jazz', parts: one('b:jazz1', 0.65) },
    { id: 'lofi', n: 'Lo-fi', parts: one('b:lofi1', 0.7) },
    { id: 'none', n: 'No music', parts: {} }
  ];

  /* --- audio context: one per page. iPhone: "playback" keeps sound on when the ring switch is on silent --- */
  let AC;
  function ctx() {
    if (!AC) { try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {} AC = new (window.AudioContext || window.webkitAudioContext)(); }
    return AC;
  }
  async function decode(blob) {
    const ab = await blob.arrayBuffer();
    return await new Promise((res, rej) => { const p = ctx().decodeAudioData(ab, res, rej); if (p && p.catch) p.catch(rej); });
  }

  /* --- sound packs: the user's own music, one file per part, kept in this browser.
     Own database, so apps on the same web address (e.g. Fixsound and Fixframe on one GitHub account) share them. --- */
  const DB = (() => {
    let dbp; const db = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open('fixsound-packs', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
    const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('kv', mode), rq = fn(t.objectStore('kv')); t.oncomplete = () => res(rq && rq.result); t.onerror = t.onabort = () => rej(t.error || new Error('storage')); }); };
    return { get: k => tx('readonly', s => s.get(k)), put: (k, v) => tx('readwrite', s => s.put(v, k)), del: k => tx('readwrite', s => s.delete(k)) };
  })();
  let packs = [];
  async function loadPacks() { try { packs = (await DB.get('packs')) || []; } catch (e) { packs = []; } return packs; }
  // files: { intro, safety, steps, closing } -> File or Blob (any may be missing, at least one needed)
  async function savePack(name, files, id) {
    const old = id && packs.find(p => p.id === id);
    id = id || 'pk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const pk = { id, name: (name || 'My sound').trim().slice(0, 40) || 'My sound', created: old ? old.created : Date.now(), parts: old ? Object.assign({}, old.parts) : {} };
    for (const [k] of PARTS) {
      const f = files[k]; if (!f) continue;
      await decode(f); // refuse files that are not sound
      await DB.put('pf:' + id + ':' + k, f); cache.delete('p:' + id + ':' + k);
      pk.parts[k] = { name: f.name || k, size: f.size };
    }
    if (!Object.keys(pk.parts).length) throw new Error('Choose at least one music file.');
    packs = packs.filter(p => p.id !== id).concat(pk); await DB.put('packs', packs); return pk;
  }
  async function removePackPart(id, k) { const pk = packs.find(p => p.id === id); if (!pk) return; delete pk.parts[k]; await DB.del('pf:' + id + ':' + k); cache.delete('p:' + id + ':' + k); await DB.put('packs', packs); }
  async function deletePack(id) { for (const [k] of PARTS) { await DB.del('pf:' + id + ':' + k); cache.delete('p:' + id + ':' + k); } packs = packs.filter(p => p.id !== id); await DB.put('packs', packs); }
  // a pack used as a style: a missing part takes the steps music (or any music of the pack)
  function packStyle(pk) {
    const has = Object.keys(pk.parts), pick = k => pk.parts[k] ? k : pk.parts.steps ? 'steps' : has[0], vol = { intro: 0.75, safety: 0.45, steps: 0.55, closing: 0.75 }, parts = {};
    for (const [k] of PARTS) parts[k] = ['p:' + pk.id + ':' + pick(k), vol[k]];
    return { id: 'pack:' + pk.id, n: pk.name, pack: true, parts };
  }
  const styles = () => STYLES.slice(0, -1).concat(packs.map(packStyle), STYLES.slice(-1));
  const style = id => styles().find(s => s.id === id);

  /* --- sound keys: 'b:<built-in id>' or 'p:<pack id>:<part>' --- */
  const cache = new Map();
  function nameOf(key) {
    if (!key) return '';
    if (key.startsWith('b:')) { const s = BUILTIN.find(x => x.id === key.slice(2)); return s ? s.name : ''; }
    const [, id, k] = key.split(':'), pk = packs.find(p => p.id === id); return pk && pk.parts[k] ? pk.name + ' · ' + PARTS.find(p => p[0] === k)[1] : '';
  }
  const exists = key => !!nameOf(key);
  async function buffer(key) {
    if (cache.has(key)) return cache.get(key);
    let b;
    if (key.startsWith('b:')) {
      const s = BUILTIN.find(x => x.id === key.slice(2)); if (!s) throw new Error('Unknown sound ' + key);
      const r = await fetch(base + 'snd-' + s.id + '.m4a'); if (!r.ok) throw new Error('The sound file for "' + s.name + '" is missing.');
      b = await decode(await r.blob());
      if (b.length > s.n + 8) b = trim(b, Math.min(1024, b.length - s.n), s.n); // browsers that keep the encoder's lead-in silence
    } else {
      const bl = await DB.get('pf:' + key.slice(2)); if (!bl) throw new Error('A file of the sound pack is missing.');
      b = await decode(bl);
    }
    cache.set(key, b); return b;
  }
  function trim(b, from, n) { const o = ctx().createBuffer(b.numberOfChannels, n, b.sampleRate); for (let c = 0; c < b.numberOfChannels; c++) o.getChannelData(c).set(b.getChannelData(c).subarray(from, from + n)); return o; }
  const cached = key => cache.get(key);
  const load = keys => Promise.all([...new Set(keys.filter(Boolean))].map(buffer));

  /* --- plan: where the parts are, read from a parts file / Fixframe; missing values = whole video is "steps" --- */
  function readPlan(j, D) {
    const p = j && j.parts || {}, cl = v => Math.min(D, Math.max(0, v)), n = v => typeof v === 'number' && isFinite(v) ? cl(v) : null;
    const a = n(p.presentationEnd) || 0, b = Math.max(a, n(p.safetyEnd) || 0), c = Math.max(b, n(p.closingStart) == null ? D : n(p.closingStart));
    return { b: [a, b, c], marks: (Array.isArray(j && j.steps) ? j.steps : []).map(n).filter(x => x != null).sort((x, y) => x - y),
      style: j && j.style && style(j.style) ? j.style : 'standard', chime: !j || j.attentionTone !== false, tick: !!(j && j.stepTone) };
  }
  const spans = (b, D) => [{ k: 'intro', s: 0, e: b[0] }, { k: 'safety', s: b[0], e: b[1] }, { k: 'steps', s: b[1], e: b[2] }, { k: 'closing', s: b[2], e: D }];
  // style parts -> editable copy { part: { src, vol } }
  function partsOf(id) { const st = style(id) || STYLES[STYLES.length - 1], out = {}; for (const [k] of PARTS) out[k] = st.parts[k] ? { src: st.parts[k][0], vol: st.parts[k][1] } : { src: '', vol: 0.5 }; return out; }
  // parts + boundaries + tones -> music clips with fades and short overlaps at the part changes
  function clips(parts, b, D, opt) {
    const out = [], ph = spans(b, D); opt = opt || {}; const tv = opt.toneVol == null ? 1 : opt.toneVol; // 1 = normal tone level
    ph.forEach((p, i) => {
      const pt = parts[p.k], len = p.e - p.s; if (!pt || !pt.src || !exists(pt.src) || len < 0.3) return;
      const first = p.s <= 0.01, last = p.e >= D - 0.01;
      out.push({ id: 'auto-' + p.k, auto: p.k, src: pt.src, name: PARTS[i][1] + ' · ' + nameOf(pt.src), start: first ? 0 : Math.max(0, p.s - 0.35), end: last ? D : p.e + 0.35, vol: pt.vol, fi: first ? 0.3 : 0.7, fo: last ? Math.min(3, len / 2) : 0.7, loop: true });
    });
    if (opt.chime && ph[1].e - ph[1].s >= 0.3) out.push({ id: 'auto-chime', auto: 'chime', src: 'b:chime', name: 'Attention tone', start: ph[1].s, end: null, vol: 0.16 * tv, fi: 0, fo: 0, loop: false });
    if (opt.tick) (opt.marks || []).forEach((t, i) => out.push({ id: 'auto-tick' + i, auto: 'tick', src: 'b:tick', name: 'Step', start: t, end: null, vol: 0.12 * tv, fi: 0, fo: 0, loop: false }));
    return out;
  }

  /* --- the mix, for listening (AudioContext) and for export (OfflineAudioContext)
     s = { D, clips: [{ src, start, end, vol, fi, fo, loop }], buf: clip -> AudioBuffer, voices: [{ buf, t, in, dur, vol }], mix: { orig, music, voice, duck, duckOn }, orig: AudioBuffer|null } --- */
  function schedule(c, dest, c0, t0, s) {
    const D = s.D, mx = s.mix, srcs = [], at = t => c0 + (t - t0);
    const master = c.createGain(), comp = c.createDynamicsCompressor();
    comp.threshold.value = -5; comp.knee.value = 5; comp.ratio.value = 12; comp.attack.value = 0.003; comp.release.value = 0.15;
    master.connect(comp); comp.connect(dest);
    const env = (param, pts) => {
      let v0 = pts[0][1];
      for (let i = 0; i < pts.length; i++) { const [a, va] = pts[i], nx = pts[i + 1]; if (t0 >= a) v0 = nx && t0 < nx[0] && nx[0] > a ? va + (nx[1] - va) * (t0 - a) / (nx[0] - a) : va; }
      param.setValueAtTime(v0, c0);
      for (const [t, v] of pts) if (t > t0) param.linearRampToValueAtTime(v, at(t));
    };
    const play = (buf, start, end, offset, loop, node) => {
      if (end <= t0 || start >= D) return;
      const x = c.createBufferSource(); x.buffer = buf; x.loop = !!loop; x.connect(node);
      const begin = Math.max(start, t0); let off = offset + (begin - start); if (loop) off %= buf.duration;
      x.start(at(begin), Math.max(0, off)); x.stop(at(Math.min(end, D))); srcs.push(x);
    };
    const vbus = c.createGain(); vbus.gain.value = mx.voice; vbus.connect(master);
    const talk = [];
    for (const v of s.voices || []) { if (!v.buf) continue; const g = c.createGain(); g.gain.value = v.vol == null ? 1 : v.vol; g.connect(vbus); const dur = v.dur || v.buf.duration; play(v.buf, v.t, v.t + dur, v.in || 0, false, g); talk.push([v.t, Math.min(D, v.t + dur)]); }
    const mbus = c.createGain(); mbus.gain.value = mx.music; const duck = c.createGain(); mbus.connect(duck); duck.connect(master);
    if (mx.duckOn && talk.length) {
      talk.sort((a, b) => a[0] - b[0]); const mg = [];
      for (const x of talk) { const p = mg[mg.length - 1]; if (p && x[0] - p[1] < 1.4) p[1] = Math.max(p[1], x[1]); else mg.push([...x]); }
      const pts = [[-1, 1]];
      for (const [a, b] of mg) pts.push([Math.max(pts[pts.length - 1][0], a - 0.4), 1], [a, mx.duck], [b, mx.duck], [b + 0.7, 1]);
      env(duck.gain, pts);
    }
    for (const m of s.clips) {
      const b = s.buf(m); if (!b) continue;
      let end = Math.min(m.end == null ? D : m.end, D); if (!m.loop) end = Math.min(end, m.start + b.duration);
      const len = end - m.start; if (len <= 0.05) continue;
      let fi = Math.max(0.01, m.fi), fo = Math.max(0.01, m.fo); if (fi + fo > len) { const k = len / (fi + fo); fi *= k; fo *= k; }
      const g = c.createGain(); g.connect(mbus);
      env(g.gain, [[m.start - 1, 0], [m.start, 0], [m.start + fi, m.vol], [end - fo, m.vol], [end, 0]]);
      play(b, m.start, end, 0, m.loop, g);
    }
    if (s.orig && mx.orig > 0) { const g = c.createGain(); g.gain.value = mx.orig; g.connect(master); play(s.orig, 0, Math.min(D, s.orig.duration), 0, false, g); }
    return { stop() { for (const x of srcs) { try { x.stop(); } catch (e) {} x.disconnect(); } try { comp.disconnect(); } catch (e) {} } };
  }
  function render(s) { const oc = new OfflineAudioContext(2, Math.ceil(s.D * 48000), 48000); schedule(oc, oc.destination, 0, 0, s); return oc.startRendering(); }

  /* --- sound encoding: AAC where the browser has it, else Opus --- */
  const pause = ms => new Promise(r => setTimeout(r, ms));
  async function encode(buf, onp) { return (await encodeWith('mp4a.40.2', buf, onp)) || (await encodeWith('opus', buf, onp)); }
  async function encodeWith(codec, buf, onp) {
    if (!('AudioEncoder' in window)) return null;
    const cfg = { codec, sampleRate: 48000, numberOfChannels: 2, bitrate: codec === 'opus' ? 128000 : 160000 };
    try { if (!(await AudioEncoder.isConfigSupported(cfg)).supported) return null; } catch (e) { return null; }
    const frames = []; let asc = null, err = null;
    const enc = new AudioEncoder({ output: (ch, meta) => { const u = new Uint8Array(ch.byteLength); ch.copyTo(u); frames.push(u); const d = meta && meta.decoderConfig && meta.decoderConfig.description; if (d && !asc) asc = new Uint8Array(d.buffer ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d); }, error: e => err = e });
    enc.configure(cfg);
    const L = buf.getChannelData(0), R = buf.getChannelData(1), N = buf.length, step = 48000;
    for (let i = 0; i < N && !err; i += step) {
      const n = Math.min(step, N - i), data = new Float32Array(n * 2); data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i / 48000 * 1e6), data }); enc.encode(ad); ad.close();
      while (enc.encodeQueueSize > 6) await pause(8); if (onp) onp(i / N);
    }
    await enc.flush(); enc.close(); if (err) { if (codec !== 'opus') return null; throw err; } if (!frames.length) return null;
    if (codec === 'opus') return { codec: 'opus', frameLen: 960, sampleRate: 48000, channels: 2, bitrate: cfg.bitrate, head: asc, frames };
    const adts = f => f.length > 7 && f[0] === 0xff && (f[1] & 0xf6) === 0xf0;
    const out = !asc && adts(frames[0]) ? frames.map(f => f.subarray(f[1] & 1 ? 7 : 9)) : frames;
    return { codec: 'aac', sampleRate: 48000, channels: 2, bitrate: 160000, asc: asc || Uint8Array.of(0x11, 0x90), frames: out };
  }
  function wav(buf) {
    const n = buf.length, L = buf.getChannelData(0), R = buf.getChannelData(1), ab = new ArrayBuffer(44 + n * 4), d = new DataView(ab), w = (o, s) => { for (let i = 0; i < s.length; i++) d.setUint8(o + i, s.charCodeAt(i)); }, cl = v => Math.max(-1, Math.min(1, v));
    w(0, 'RIFF'); d.setUint32(4, 36 + n * 4, true); w(8, 'WAVEfmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 2, true); d.setUint32(24, buf.sampleRate, true); d.setUint32(28, buf.sampleRate * 4, true); d.setUint16(32, 4, true); d.setUint16(34, 16, true); w(36, 'data'); d.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) { d.setInt16(44 + i * 4, cl(L[i]) * 32767, true); d.setInt16(46 + i * 4, cl(R[i]) * 32767, true); }
    return new Blob([ab], { type: 'audio/wav' });
  }

  /* --- one call for another app: MP4 in, MP4 with sound out (picture copied unchanged)
     plan = { style: 'standard' | 'jazz' | 'lofi' | 'pack:<id>' | 'none', parts: { presentationEnd, safetyEnd, closingStart } (seconds),
              steps: [seconds], attentionTone: true, stepTone: false, voices: [{ t: seconds, blob }] (optional, e.g. a spoken text later) }
     opt = { name: file name, onProgress: (0..1, text) => {} } --- */
  async function addSound(file, plan, opt) {
    opt = opt || {}; const say = (p, t) => opt.onProgress && opt.onProgress(p, t);
    await loadPacks();
    const info = await MP4.inspect(file); if (!info.canRemux) throw new Error('Only normal MP4 videos can get sound this way.');
    const D = info.duration / info.timescale, p = readPlan(plan, D), parts = partsOf(p.style), cl = clips(parts, p.b, D, Object.assign(p, { toneVol: plan && plan.toneVolume }));
    say(0.05, 'Loading sounds…'); await load(cl.map(m => m.src));
    const voices = [];
    for (const v of (plan && plan.voices) || []) if (v && v.blob) voices.push({ t: v.t || 0, buf: await decode(v.blob), vol: v.vol });
    let orig = null; if (info.hasSound) { try { orig = await decode(file); } catch (e) {} }
    say(0.15, 'Mixing sound…');
    const mix = await render({ D, clips: cl, buf: m => cached(m.src), voices, mix: { orig: 1, music: 1, voice: 1, duck: 0.3, duckOn: true }, orig });
    const a = await encode(mix, x => say(0.2 + x * 0.7, 'Writing sound…')); if (!a) throw new Error('This browser cannot write sound into a video.');
    say(0.95, 'Writing video…');
    const out = new File([MP4.addSound(file, info, a)], opt.name || (file.name || 'video.mp4').replace(/(\.mp4)?$/i, '_sound.mp4'), { type: 'video/mp4' });
    out.codec = a.codec; say(1, ''); return out;
  }

  return { VERSION, BUILTIN, FILES, PARTS, setBase: b => { base = b || ''; }, ctx, decode,
    loadPacks, packs: () => packs, savePack, removePackPart, deletePack, styles, style, partsOf, nameOf, exists,
    buffer, cached, load, readPlan, spans, clips, schedule, render, encode, wav, addSound };
})();
if (typeof module !== 'undefined') module.exports = FixsoundCore;
