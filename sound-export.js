/* ============================================================================================================
   sound-export.js
   What it does:    "Add sound" in the video export. After the MP4 is made, music is laid under it, following the
                   parts of the guide: presentation (brand intro + title card), safety, steps, closing. Optional
                   tones: one at the start of the safety part, a short one at each step.
                   The picture is not touched: the sound track is added to the finished file.
   Change here:     Nothing usually. Style names, tones and loudness are in settings.js (SOUND).
                   The music itself and the sound packs come from fixsound-core.js (the Fixsound app's core).
   Medium: change texts and values, not the structure.
   Technical note:  Plan from the render timeline -> FixsoundCore.clips -> mix in pieces of SOUND.pieceSeconds with
                   OfflineAudioContext (keeps memory low on phones) -> AudioEncoder (AAC, else Opus) ->
                   MP4.addSound (appends the sound track and a new index).
   ============================================================================================================ */

FixsoundCore.setBase(''); // the snd-*.m4a files are next to index.html

/* The choices for "Sound style" on the export screen: the built-in styles and the sound packs on this device. */
function soundStyleChoices() {
  return FixsoundCore.styles().filter((s) => s.id !== 'none').map((s) => [s.id, s.n]);
}
/* Sound packs are kept by the browser; read them once when the export screen opens. */
async function loadSoundPacks() {
  try { await FixsoundCore.loadPacks(); } catch (e) { /* no packs */ }
}

/* Where the parts of the exported video are, in seconds. Fixframe knows this from its own timeline. */
function soundPlan(segs, total, o) {
  const isPresentation = (s) => s.kind === 'intro' || (s.slot === 'intro');
  const isSafety = (s) => s.kind === 'safety' || s.slot === 'safetyVideo';
  const isClosing = (s) => s.slot === 'outro';
  let presentationEnd = 0;
  let safetyEnd = 0;
  let closingStart = total;
  for (const s of segs) {
    if (isPresentation(s)) presentationEnd = Math.max(presentationEnd, s.t1);
    if (isSafety(s)) safetyEnd = Math.max(safetyEnd, s.t1);
    if (isClosing(s)) closingStart = Math.min(closingStart, s.t0);
  }
  safetyEnd = Math.max(safetyEnd, presentationEnd);
  const steps = [];
  const seen = new Set();
  for (const s of segs) {
    if (s.index == null || seen.has(s.index)) continue;
    seen.add(s.index);
    steps.push(s.t0);
  }
  return {
    style: o.soundStyle || SOUND.startStyle,
    parts: { presentationEnd, safetyEnd, closingStart },
    steps,
    attentionTone: SOUND.attentionTone,
    stepTone: !!o.stepTone,
    toneVolume: SOUND.toneVolume,
  };
}

/* Adds the sound to a finished MP4 (Blob). Returns a new Blob, or throws with a message for the user. */
async function addSoundToVideo(blob, plan, onProgress, signal) {
  const say = (frac, text) => onProgress && onProgress(frac, text);
  const stop = () => { if (signal && signal.aborted) throw new DOMException('Export stopped', 'AbortError'); };
  if (!('AudioEncoder' in window) || !('OfflineAudioContext' in window)) throw new Error('this browser cannot write sound into a video');
  await loadSoundPacks();
  const info = await MP4.inspect(blob);
  if (!info.canRemux) throw new Error('the video file could not take a sound track');
  const D = info.duration / info.timescale;
  const p = FixsoundCore.readPlan(plan, D);
  const clips = FixsoundCore.clips(FixsoundCore.partsOf(p.style), p.b, D,
    { chime: p.chime, tick: p.tick, marks: p.marks, toneVol: plan.toneVolume });
  say(0, 'Loading music…');
  await FixsoundCore.load(clips.map((c) => c.src));
  stop();

  const enc = await openSoundEncoder();
  if (!enc) throw new Error('this browser cannot write sound into a video');
  const spec = { D, clips, buf: (c) => FixsoundCore.cached(c.src), voices: [], mix: { orig: 0, music: 1, voice: 1, duck: 0.3, duckOn: false }, orig: null };
  const RATE = 48000;
  const piece = SOUND.pieceSeconds;
  const totalSamples = Math.ceil(D * RATE);
  // Each piece starts half a second early and that half second is dropped: the mix's loudness limiter has a short
  // delay and a memory, and they must be "warm" at the joint, otherwise every joint would click.
  const LEAD = start => Math.min(start, RATE / 2);
  for (let start = 0; start < totalSamples; start += piece * RATE) {
    stop();
    const n = Math.min(piece * RATE, totalSamples - start);
    const lead = LEAD(start);
    const oc = new OfflineAudioContext(2, n + lead, RATE);
    FixsoundCore.schedule(oc, oc.destination, 0, (start - lead) / RATE, spec);
    let buf = await oc.startRendering();
    if (lead) {
      const cut = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: RATE });
      for (let c = 0; c < 2; c++) cut.getChannelData(c).set(buf.getChannelData(c).subarray(lead, lead + n));
      buf = cut;
    }
    await enc.add(buf, start);
    say((start + n) / totalSamples, 'Adding sound…');
  }
  const a = await enc.finish();
  return MP4.addSound(blob, info, a);
}

/* The sound encoder: AAC where the browser has it, else Opus. Fed piece by piece. */
async function openSoundEncoder() {
  if (!('AudioEncoder' in window)) return null;
  for (const codec of ['mp4a.40.2', 'opus']) {
    const cfg = { codec, sampleRate: 48000, numberOfChannels: 2, bitrate: codec === 'opus' ? 128000 : 160000 };
    try { if (!(await AudioEncoder.isConfigSupported(cfg)).supported) continue; } catch (e) { continue; }
    const frames = [];
    let desc = null;
    let err = null;
    const enc = new AudioEncoder({
      output: (chunk, meta) => {
        const u = new Uint8Array(chunk.byteLength);
        chunk.copyTo(u);
        frames.push(u);
        const d = meta && meta.decoderConfig && meta.decoderConfig.description;
        if (d && !desc) desc = new Uint8Array(d.buffer ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d);
      },
      error: (e) => { err = e; },
    });
    try { enc.configure(cfg); } catch (e) { continue; }
    return {
      async add(buf, offset) {
        const L = buf.getChannelData(0);
        const R = buf.getChannelData(1);
        for (let i = 0; i < buf.length; i += 48000) {
          if (err) throw err;
          const n = Math.min(48000, buf.length - i);
          const data = new Float32Array(n * 2);
          data.set(L.subarray(i, i + n), 0);
          data.set(R.subarray(i, i + n), n);
          const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((offset + i) / 48000 * 1e6), data });
          enc.encode(ad);
          ad.close();
          while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 8));
        }
      },
      async finish() {
        await enc.flush();
        enc.close();
        if (err) throw err;
        if (!frames.length) throw new Error('no sound was written');
        if (codec === 'opus') return { codec: 'opus', frameLen: 960, sampleRate: 48000, channels: 2, bitrate: cfg.bitrate, head: desc, frames };
        const adts = (f) => f.length > 7 && f[0] === 0xff && (f[1] & 0xf6) === 0xf0;
        const out = !desc && adts(frames[0]) ? frames.map((f) => f.subarray(f[1] & 1 ? 7 : 9)) : frames;
        return { codec: 'aac', sampleRate: 48000, channels: 2, bitrate: cfg.bitrate, asc: desc || Uint8Array.of(0x11, 0x90), frames: out };
      },
    };
  }
  return null;
}
