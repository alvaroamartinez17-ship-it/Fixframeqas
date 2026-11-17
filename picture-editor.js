/* ============================================================================================================
   picture-editor.js
   What it does:    The full-screen markup editor for pictures (tools, colours, sizes, caption, undo).
   Change here:     The hint texts at the top (PE_HINTS).
   Safe to edit texts here.
   Technical note:  Picture markup editor (full screen). Works on a copy; Done hands the shapes back.
   ============================================================================================================ */
const PE_HINTS = {
  select: 'Tap a mark to select it. Drag to move it; drag its dots to reshape it.',
  arrow: 'Drag from where the arrow starts to its tip, or tap the spot it should point at.',
  box: 'Tap where the info box should go.',
  ellipse: 'Drag across a part to circle it, or tap the part.',
  rect: 'Drag across a part to frame it, or tap the part.',
  num: 'Tap to place the next number.',
};
const PicEditor = {
  open(pic, opts) {
    this.pic = pic;
    this.opts = opts;
    this.shapes = JSON.parse(JSON.stringify(pic.shapes || []));
    this.orig = JSON.stringify(this.shapes);
    this.caption = pic.caption || '';
    this.sel = null;
    this.undo = [];
    this.redo = [];
    this.drag = null;
    this.tool = this.tool || 'arrow';
    this.color = ANN_COLORS.includes(this.color) ? this.color : ANN_COLORS[0];
    this.size = this.size || 2;
    $('#pe-title').textContent = opts.title || 'Mark up picture';
    $('#pe-caption').value = this.caption;
    $('#piced').hidden = false;
    document.body.style.overflow = 'hidden';
    Nav.push('piced', () => this.done(true));
    this.syncToolbar();
    this.ready = (async () => {
      const blob = await Store.getBlob('p:' + pic.id);
      if (!blob) throw new Error('Picture not found');
      this.img = await loadImageFromBlob(blob);
      this.iw = this.img.width || pic.w;
      this.ih = this.img.height || pic.h;
      this.layout();
    })().catch((e) => { toast(`Could not open the picture: ${e.message || e}`, 'err'); this.close(); });
  },
  init() {
    this.canvas = $('#pe-canvas');
    this.ctx = this.canvas.getContext('2d');
    $('#pe-colors').append(...ANN_COLORS.map((c) => h('button', {
      type: 'button', class: 'swatch', 'data-color': c, 'aria-pressed': 'false', 'aria-label': `Colour ${c}`, style: { background: c },
      onClick: () => this.setColor(c),
    })));
    $$('#piced .tool').forEach((b) => b.addEventListener('click', () => this.setTool(b.dataset.tool)));
    $$('#pe-sizes button').forEach((b) => b.addEventListener('click', () => this.setSize(+b.dataset.size)));
    $('#pe-undo').addEventListener('click', () => this.doUndo());
    $('#pe-redo').addEventListener('click', () => this.doRedo());
    $('#pe-remove').addEventListener('click', () => this.removeSelected());
    $('#pe-edit-text').addEventListener('click', () => this.editText());
    $('#pe-done').addEventListener('click', () => this.done(false));
    $('#pe-cancel').addEventListener('click', () => this.cancel());
    $('#pe-delete').addEventListener('click', () => this.deletePicture());
    $('#pe-caption').addEventListener('input', (e) => { this.caption = e.target.value; });
    $('#pe-caption').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', () => { this.drag = null; this.render(); });
    if (window.ResizeObserver) new ResizeObserver(() => { if (!$('#piced').hidden && this.img) this.layout(); }).observe($('#pe-stage'));
    document.addEventListener('keydown', (e) => {
      if ($('#piced').hidden || /input|textarea/i.test((document.activeElement || {}).tagName || '')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) { e.preventDefault(); this.removeSelected(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) this.doRedo(); else this.doUndo(); }
    });
  },
  layout() {
    const r = $('#pe-stage').getBoundingClientRect();
    const aw = Math.max(40, r.width - 12);
    const ah = Math.max(40, r.height - 12);
    const s = Math.min(aw / this.iw, ah / this.ih);
    const cw = Math.max(1, Math.floor(this.iw * s));
    const ch = Math.max(1, Math.floor(this.ih * s));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const c = this.canvas;
    c.style.width = `${cw}px`;
    c.style.height = `${ch}px`;
    c.width = Math.max(1, Math.round(cw * dpr));
    c.height = Math.max(1, Math.round(ch * dpr));
    this.W = c.width;
    this.H = c.height;
    this.dpr = dpr;
    freeCanvas(this.base);
    this.base = makeCanvas(this.W, this.H);
    this.base.getContext('2d').drawImage(this.img, 0, 0, this.W, this.H);
    this.render();
  },
  render() {
    if (!this.base) return;
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.base, 0, 0);
    drawAnnotations(ctx, this.shapes, W, H);
    const s = this.selShape();
    if (s) drawSelection(ctx, s, W, H, this.dpr, shapeHandles(ctx, s, W, H));
  },
  selShape() { return this.shapes.find((s) => s.id === this.sel) || null; },
  pt(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * this.W) / r.width, y: ((e.clientY - r.top) * this.H) / r.height };
  },
  topHit(p) {
    const tol = 10 * this.dpr;
    for (let i = this.shapes.length - 1; i >= 0; i--) if (hitShape(this.ctx, this.shapes[i], this.W, this.H, p.x, p.y, tol)) return this.shapes[i];
    return null;
  },
  handleAt(p) {
    const s = this.selShape();
    if (!s) return null;
    const r = 22 * this.dpr;
    return shapeHandles(this.ctx, s, this.W, this.H).find((hd) => Math.hypot(hd.x - p.x, hd.y - p.y) <= r) || null;
  },
  onDown(e) {
    if (!e.isPrimary || !this.base) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const p = this.pt(e);
    const before = JSON.stringify(this.shapes);
    const hd = this.handleAt(p);
    if (hd) { this.drag = { mode: 'handle', id: hd.id, before, start: p }; return; }
    const sel = this.selShape();
    if (sel && hitShape(this.ctx, sel, this.W, this.H, p.x, p.y, 10 * this.dpr)) {
      this.drag = { mode: 'move', last: p, start: p, before, wasSel: true };
      return;
    }
    if (this.tool === 'select') {
      const hit = this.topHit(p);
      this.sel = hit ? hit.id : null;
      this.drag = hit ? { mode: 'move', last: p, start: p, before, wasSel: false } : null;
      this.syncContext();
      this.render();
      return;
    }
    this.drag = { mode: 'pending', start: p, before, hit: this.topHit(p) };
  },
  onMove(e) {
    const d = this.drag;
    if (!d || !e.isPrimary) return;
    const p = this.pt(e);
    const { W, H } = this;
    if (d.mode === 'handle') {
      const s = this.selShape();
      const nx = clamp(p.x / W, 0, 1);
      const ny = clamp(p.y / H, 0, 1);
      if (d.id === 'p1') { s.x1 = nx; s.y1 = ny; } else if (d.id === 'p2') { s.x2 = nx; s.y2 = ny; } else if (d.id === 'tip') { s.tx = nx; s.ty = ny; }
      this.render();
    } else if (d.mode === 'move') {
      moveShape(this.selShape(), (p.x - d.last.x) / W, (p.y - d.last.y) / H);
      d.last = p;
      this.render();
    } else if (d.mode === 'pending') {
      if (Math.hypot(p.x - d.start.x, p.y - d.start.y) > 8 * this.dpr && ['arrow', 'rect', 'ellipse'].includes(this.tool)) {
        const s = { id: uid('a'), type: this.tool, x1: d.start.x / W, y1: d.start.y / H, x2: clamp(p.x / W, 0, 1), y2: clamp(p.y / H, 0, 1), color: this.color, size: this.size };
        this.shapes.push(s);
        this.sel = s.id;
        this.drag = { mode: 'handle', id: 'p2', before: d.before, start: d.start, created: true };
        this.syncContext();
        this.render();
      }
    }
  },
  async onUp(e) {
    const d = this.drag;
    this.drag = null;
    if (!d || !e.isPrimary) return;
    const p = this.pt(e);
    const moved = Math.hypot(p.x - d.start.x, p.y - d.start.y) > 8 * this.dpr;
    if (d.mode === 'handle' && d.id === 'tip') {
      const s = this.selShape();
      const L = boxLayout(this.ctx, s, this.W, this.H);
      const tx = s.tx * this.W;
      const ty = s.ty * this.H;
      if (tx >= L.x - 4 && tx <= L.x + L.w + 4 && ty >= L.y - 4 && ty <= L.y + L.h + 4) { delete s.tx; delete s.ty; }
    }
    if (d.mode === 'move' && !moved && d.wasSel) {
      const s = this.selShape();
      if (s && s.type === 'box') { this.render(); this.editText(); return; }
    }
    if (d.mode === 'pending') {
      if (d.hit) { this.sel = d.hit.id; this.syncContext(); this.render(); return; }
      await this.createAt(d.start);
    }
    this.commit(d.before);
    this.syncContext();
    this.render();
  },
  async createAt(p) {
    const { W, H } = this;
    const m = Math.min(W, H);
    let s = null;
    if (this.tool === 'arrow') {
      let dx = p.x - W / 2;
      let dy = p.y - H / 2;
      const l = Math.hypot(dx, dy);
      if (l < m * 0.05) { dx = 0.6; dy = 0.8; } else { dx /= l; dy /= l; }
      // tail away from the centre so the arrow comes in from the open side
      const len = m * 0.22;
      let tx = p.x - dx * len;
      let ty = p.y - dy * len;
      tx = clamp(tx, 0, W); ty = clamp(ty, 0, H);
      s = { type: 'arrow', x1: tx / W, y1: ty / H, x2: p.x / W, y2: p.y / H };
    } else if (this.tool === 'rect' || this.tool === 'ellipse') {
      const hw = (m * 0.13 * (this.tool === 'ellipse' ? 1.3 : 1.25)) / W;
      const hh = (m * 0.13) / H;
      const cx = clamp(p.x / W, hw, 1 - hw);
      const cy = clamp(p.y / H, hh, 1 - hh);
      s = { type: this.tool, x1: cx - hw, y1: cy - hh, x2: cx + hw, y2: cy + hh };
    } else if (this.tool === 'num') {
      const n = this.shapes.filter((x) => x.type === 'num').reduce((a, x) => Math.max(a, x.n), 0) + 1;
      s = { type: 'num', x: p.x / W, y: p.y / H, n };
    } else if (this.tool === 'box') {
      const text = await askText({ title: 'Info box text', placeholder: 'e.g. Phillips PH1, 4 screws', multiline: true, ok: 'Add box', maxlength: 160 });
      if (!text || !text.trim()) return;
      s = { type: 'box', x: p.x / W, y: p.y / H, text: text.trim() };
    }
    if (!s) return;
    s.id = uid('a');
    s.color = this.color;
    s.size = this.size;
    this.shapes.push(s);
    this.sel = s.id;
  },
  commit(before) {
    if (JSON.stringify(this.shapes) === before) return;
    this.undo.push(before);
    if (this.undo.length > 100) this.undo.shift();
    this.redo.length = 0;
    this.syncContext();
  },
  doUndo() {
    if (!this.undo.length) return;
    this.redo.push(JSON.stringify(this.shapes));
    this.shapes = JSON.parse(this.undo.pop());
    if (!this.selShape()) this.sel = null;
    this.syncContext();
    this.render();
  },
  doRedo() {
    if (!this.redo.length) return;
    this.undo.push(JSON.stringify(this.shapes));
    this.shapes = JSON.parse(this.redo.pop());
    if (!this.selShape()) this.sel = null;
    this.syncContext();
    this.render();
  },
  removeSelected() {
    if (!this.sel) return;
    const before = JSON.stringify(this.shapes);
    this.shapes = this.shapes.filter((s) => s.id !== this.sel);
    this.sel = null;
    this.commit(before);
    this.render();
  },
  async editText() {
    const s = this.selShape();
    if (!s || s.type !== 'box') return;
    const text = await askText({ title: 'Info box text', value: s.text, multiline: true, ok: 'Save', maxlength: 160 });
    if (text == null) return;
    const before = JSON.stringify(this.shapes);
    if (!text.trim()) this.shapes = this.shapes.filter((x) => x !== s); else s.text = text.trim();
    if (!this.selShape()) this.sel = null;
    this.commit(before);
    this.render();
  },
  setTool(t) { this.tool = t; this.syncToolbar(); },
  setColor(c) {
    this.color = c;
    const s = this.selShape();
    if (s && s.color !== c) { const before = JSON.stringify(this.shapes); s.color = c; this.commit(before); this.render(); }
    this.syncToolbar();
  },
  setSize(n) {
    this.size = n;
    const s = this.selShape();
    if (s && s.size !== n) { const before = JSON.stringify(this.shapes); s.size = n; this.commit(before); this.render(); }
    this.syncToolbar();
  },
  syncToolbar() {
    $$('#piced .tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === this.tool)));
    $$('#pe-colors .swatch').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === this.color)));
    $$('#pe-sizes button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.size === this.size)));
    this.syncContext();
  },
  syncContext() {
    const s = this.selShape();
    $('#pe-remove').hidden = !s;
    $('#pe-edit-text').hidden = !(s && s.type === 'box');
    $('#pe-undo').disabled = !this.undo.length;
    $('#pe-redo').disabled = !this.redo.length;
    let hint = PE_HINTS[this.tool] || '';
    if (s && s.type === 'box' && s.tx == null) hint = 'Drag the dotted ⊕ to point the box at a part. Tap the box to edit its text.';
    else if (s) hint = 'Drag to move. Pick a colour or size to change it, or remove it.';
    $('#pe-hint').textContent = hint;
  },
  changed() { return JSON.stringify(this.shapes) !== this.orig || this.caption !== (this.pic.caption || ''); },
  done(fromHistory) {
    const res = this.changed() ? { shapes: this.shapes, caption: this.caption.trim() } : null;
    const cb = this.opts.onDone;
    this.close(fromHistory);
    if (cb) cb(res);
  },
  async cancel() {
    if (this.changed()) {
      const ok = await ask({ title: 'Discard your markup changes?', ok: 'Discard', danger: true, cancel: 'Keep editing' });
      if (!ok) return;
    }
    this.close(false);
  },
  async deletePicture() {
    const ok = await ask({ title: 'Delete this picture?', message: 'It is removed from the step and from all exports. You can undo this in the editor.', ok: 'Delete picture', danger: true });
    if (!ok) return;
    const cb = this.opts.onDelete;
    this.close(false);
    if (cb) cb();
  },
  close(fromHistory) {
    if (!fromHistory) Nav.pop('piced');
    $('#piced').hidden = true;
    document.body.style.overflow = '';
    closeImage(this.img);
    this.img = null;
    freeCanvas(this.base);
    this.base = null;
    this.drag = null;
  },
};
