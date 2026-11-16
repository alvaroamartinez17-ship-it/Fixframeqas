/* ============================================================================================================
   timeline.js
   What it does:    The timeline under the video: the film strip, the coloured step blocks and their drag handles,
                   zoom.
   Change here:     Nothing, unless the timeline should behave differently.
   Edit with care: change texts and values, not the structure.
   Technical note:  Timeline: fixed centre playhead over a scrolling filmstrip; steps as blocks with draggable trim
                   handles.
   ============================================================================================================ */
const TL = {
  pps: 20, pad: 0, dur: 0, expected: -1, tap: null, drag: null,
  init() {
    this.scroll = $('#tl-scroll');
    this.track = $('#tl-track');
    this.ruler = $('#tl-ruler');
    this.thumbs = $('#tl-thumbs');
    this.steps = $('#tl-steps');
    this.scroll.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.track.addEventListener('pointerdown', (e) => this.onDown(e));
    this.track.addEventListener('pointerup', (e) => this.onUp(e));
    this.track.addEventListener('pointercancel', () => { this.tap = null; });
    $('#tl-zoom-in').addEventListener('click', () => this.zoom(1.8));
    $('#tl-zoom-out').addEventListener('click', () => this.zoom(1 / 1.8));
    window.addEventListener('resize', () => { if (E.P) { this.layout(); this.setTime(E.t); updateStageHeight(); } });
  },
  width() { return this.scroll.clientWidth || 360; },
  minPps() { return Math.max(0.05, (this.width() * 0.92) / Math.max(this.dur, 0.1)); },
  maxPps() { return 260; },
  setup(dur) {
    this.dur = dur;
    this.pps = clamp(this.width() / Math.min(Math.max(dur, 0.1), 30), this.minPps(), this.maxPps());
    this.layout();
  },
  layout() {
    this.pad = this.width() / 2;
    this.track.style.width = `${Math.ceil(this.pad * 2 + this.dur * this.pps)}px`;
    this.renderRuler();
    this.renderThumbs();
    this.renderSteps();
  },
  x(t) { return this.pad + t * this.pps; },
  setTime(t, smooth) {
    const left = t * this.pps;
    this.expected = left;
    if (smooth && Math.abs(this.scroll.scrollLeft - left) > 4) {
      this.expected = -2; // ignore scroll events until the animation lands
      this.scroll.scrollTo({ left, behavior: 'smooth' });
      clearTimeout(this.smoothTimer);
      this.smoothTimer = setTimeout(() => { this.expected = this.scroll.scrollLeft; }, 450);
    } else this.scroll.scrollLeft = left;
  },
  onScroll() {
    const sl = this.scroll.scrollLeft;
    if (this.expected === -2) return;
    if (this.expected >= 0 && Math.abs(sl - this.expected) < 1.5) return;
    this.expected = -1;
    onScrub(clamp(sl / this.pps, 0, this.dur));
  },
  zoom(f) {
    const t = E.t;
    this.pps = clamp(this.pps * f, this.minPps(), this.maxPps());
    this.layout();
    this.setTime(t);
  },
  renderRuler() {
    const r = this.ruler;
    r.textContent = '';
    const majors = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];
    const major = majors.find((s) => s * this.pps >= 58) || 1200;
    const div = { 0.2: 4, 2: 4, 15: 3, 120: 4 }[major] || 5;
    const minorPx = (major / div) * this.pps;
    const ticks = h('div', { class: 'tl-ticks' });
    ticks.style.left = `${this.pad}px`;
    ticks.style.width = `${this.dur * this.pps}px`;
    ticks.style.backgroundImage = `repeating-linear-gradient(to right, var(--hair-2) 0 1px, transparent 1px ${minorPx}px)`;
    r.append(ticks);
    const n = Math.floor(this.dur / major + 1e-9);
    for (let k = 0; k <= n; k++) {
      const t = k * major;
      const label = major < 1 ? `${fmtTime(t, false)}.${Math.round((t % 1) * 10)}` : fmtTime(t, false);
      const el = h('span', { class: 'tl-lab' }, label);
      el.style.left = `${this.x(t)}px`;
      r.append(el);
    }
  },
  renderThumbs() {
    const box = this.thumbs;
    box.querySelectorAll('.tl-thumb').forEach((n) => n.remove());
    const th = E.thumbs || [];
    for (const it of th) {
      const span = it.span || this.dur / th.length;
      const d = h('div', { class: 'tl-thumb' });
      d.style.left = `${this.x(it.t - span / 2)}px`;
      d.style.width = `${Math.ceil(span * this.pps) + 1}px`;
      d.style.backgroundImage = `url("${it.src}")`;
      box.append(d);
    }
  },
  renderSteps() {
    if (!E.P) return;
    const box = this.steps;
    box.textContent = '';
    const ranges = E.P.steps.filter((s) => s.src === E.src).map((s) => [s.start, s.end]).sort((a, b) => a[0] - b[0]);
    let cur = 0;
    const gaps = [];
    for (const [a, b] of ranges) { if (a > cur + 0.01) gaps.push([cur, a]); cur = Math.max(cur, b); }
    if (cur < this.dur - 0.01) gaps.push([cur, this.dur]);
    for (const [a, b] of gaps) {
      const g = h('div', { class: 'tl-gap', title: 'Left out of exports' });
      g.style.left = `${this.x(a)}px`;
      g.style.width = `${(b - a) * this.pps}px`;
      box.append(g);
    }
    E.P.steps.forEach((s, i) => {
      if (s.src !== E.src) return; // other videos have their own timeline
      const sel = s.id === E.sel;
      const b = h('div', { class: `tl-block${sel ? ' is-sel' : ''}`, 'data-id': s.id },
        h('span', { class: 'tl-block-label' }, `${i + 1}${s.speed !== 1 ? ` · ${speedLabel(s.speed)}` : ''}`));
      this.place(b, s);
      for (const p of s.pictures) {
        const m = h('i', { class: 'tl-pic' });
        m.style.left = `${clamp((p.t - s.start) * this.pps, 4, Math.max(4, (s.end - s.start) * this.pps - 4))}px`;
        b.append(m);
      }
      if (sel) b.append(h('div', { class: 'tl-handle start', 'data-edge': 'start', 'aria-label': 'Drag to trim the start' }), h('div', { class: 'tl-handle end', 'data-edge': 'end', 'aria-label': 'Drag to trim the end' }));
      box.append(b);
    });
  },
  place(el, s) {
    el.style.left = `${this.x(s.start)}px`;
    el.style.width = `${Math.max(2, (s.end - s.start) * this.pps)}px`;
  },
  timeAt(clientX) {
    const r = this.track.getBoundingClientRect();
    return clamp((clientX - r.left - this.pad) / this.pps, 0, this.dur);
  },
  onDown(e) {
    const handle = e.target.closest('.tl-handle');
    if (handle) { this.startDrag(e, handle); return; }
    this.tap = { x: e.clientX, y: e.clientY, at: performance.now(), id: e.pointerId, target: e.target };
  },
  onUp(e) {
    const tp = this.tap;
    this.tap = null;
    if (!tp || tp.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - tp.x, e.clientY - tp.y) > 8 || performance.now() - tp.at > 600) return;
    const block = tp.target.closest && tp.target.closest('.tl-block');
    if (block && block.dataset.id !== E.sel) { selectStep(block.dataset.id, true, true); return; }
    seekPrecise(this.timeAt(e.clientX), true);
  },
  startDrag(e, handle) {
    e.preventDefault();
    e.stopPropagation();
    const st = selStep();
    if (!st) return;
    if (!vid().paused) Play.stop();
    const edge = handle.dataset.edge;
    const before = snap();
    const block = handle.parentElement;
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    let lastSeek = 0;
    const move = (ev) => {
      const t = this.timeAt(ev.clientX);
      if (edge === 'start') st.start = Math.min(t, st.end - 0.1); else st.end = Math.max(t, st.start + 0.1);
      this.place(block, st);
      const lab = block.querySelector('.tl-block-label');
      if (lab) lab.textContent = `${stepIndex(st.id) + 1}${st.speed !== 1 ? ` · ${speedLabel(st.speed)}` : ''}`;
      block.querySelectorAll('.tl-pic').forEach((m, k) => { const p = st.pictures[k]; if (p) m.style.left = `${clamp((p.t - st.start) * this.pps, 4, Math.max(4, (st.end - st.start) * this.pps - 4))}px`; });
      const et = edge === 'start' ? st.start : st.end;
      $('#tc-cur').textContent = fmtTime(et);
      const now = performance.now();
      if (now - lastSeek > 60) { lastSeek = now; Scrub.target = et; Scrub.lastFast = true; Scrub.kick(true); }
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      if (snap() !== before) pushUndo(before);
      const et = edge === 'start' ? st.start : st.end;
      changed();
      seekPrecise(edge === 'start' ? et + 0.001 : Math.max(0, et - 0.001));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  },
};
