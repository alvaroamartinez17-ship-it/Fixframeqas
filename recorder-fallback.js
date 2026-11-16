/* ============================================================================================================
   recorder-fallback.js
   What it does:    Plan B for browsers that cannot make MP4 directly: records the video in real time instead.
   Change here:     Nothing.
   Engine room: better leave it as it is.
   Technical note:  Fallback when WebCodecs H.264 is missing: record the canvas in real time with MediaRecorder,
                   pausing the recorder while each frame is prepared so timing stays correct. Slower, but works.
   ============================================================================================================ */
class RecorderSink {
  static pickType() {
    if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;
    const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for (const t of types) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) { /* next */ } }
    return null;
  }
  constructor(bitrate) {
    this.type = RecorderSink.pickType();
    this.ext = this.type && this.type.startsWith('video/mp4') ? 'mp4' : 'webm';
    this.bitrate = bitrate;
  }
  async init(W, H, fps, canvas) {
    let stream = canvas.captureStream(0);
    this.track = stream.getVideoTracks()[0];
    this.manual = !!(this.track && typeof this.track.requestFrame === 'function');
    if (!this.manual) { stream = canvas.captureStream(fps); this.track = stream.getVideoTracks()[0]; }
    this.chunks = [];
    this.rec = new MediaRecorder(stream, { mimeType: this.type, videoBitsPerSecond: this.bitrate });
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.start(1000);
    this.rec.pause();
  }
  async addFrame(canvas, t, d) {
    this.rec.resume();
    if (this.manual) this.track.requestFrame();
    await sleep(Math.max(8, d * 1000));
    this.rec.pause();
  }
  async finish() {
    const stopped = new Promise((r) => { this.rec.onstop = r; });
    if (this.rec.state === 'paused') this.rec.resume();
    this.rec.stop();
    await stopped;
    try { this.track.stop(); } catch (e) { /* ignore */ }
    return new Blob(this.chunks, { type: this.type.split(';')[0] });
  }
  abort() { try { if (this.rec && this.rec.state !== 'inactive') this.rec.stop(); } catch (e) { /* ignore */ } }
}

async function pickVideoSink(W, H, fps, bitrate) {
  const cfg = window.__ffForceRecorder ? null : await Mp4Enc.probe(W, H, fps, bitrate);
  if (cfg) return { sink: new Mp4Sink(cfg), ext: 'mp4', note: '' };
  if (RecorderSink.pickType()) {
    const r = new RecorderSink(bitrate);
    return { sink: r, ext: r.ext, note: 'This browser records the video in real time, so it takes about as long as the video itself.' };
  }
  return null;
}
