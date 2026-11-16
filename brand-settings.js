/* ============================================================================================================
   brand-settings.js
   What it does:    The Brand & safety screen: logo, export design (language, card background, company, claim,
                   contact), font, brand intro, safety instructions, closing.
   Change here:     Texts on that screen; the default language and card background (look for 'lang:' and
                   'cardBg:').
   Edit with care: change texts and values, not the structure.
   Technical note:  Brand kit, shared by all guides and stored on the device: logo watermark, card background
                   picture, brand intro, safety instructions, closing video.
   ============================================================================================================ */
const BG_DARK = [0, 0.55, 0.38, 0.24];
const Brand = {
  cfg: {
    wmPos: 'tl', wmSize: 2, wmOpacity: 0.85, bgDark: 2, safetyText: '', clips: {},
    // export design (settings.js and export-look.js): language of the export labels, card background, PDF pages, footer details, font
    lang: 'en', cardBg: 'plain', pdfPages: 'light', company: '', claim: '', contact: '', font: null,
  },
  logo: null, logoUrl: '', bgSrc: null, bg: null, bgUrl: '', bgCustom: false, urls: {}, imgs: {},
  async load() {
    try {
      const c = await Store.getBlob('cfg:brand');
      if (c && typeof c === 'object' && !(c instanceof Blob)) Object.assign(this.cfg, c);
    } catch (e) { /* defaults */ }
    if (!this.cfg.clips) this.cfg.clips = {};
    try { const b = await Store.getBlob('b:logo'); if (b) await this.useLogo(b); } catch (e) { /* no logo */ }
    await this.loadBg();
  },
  async loadBg() {
    try {
      let b = await Store.getBlob('b:bg');
      this.bgCustom = !!b;
      if (!b) b = await this.defaultBg();
      if (b) await this.useBg(b); else { this.bg = null; this.bgSrc = null; this.bgUrl = ''; }
    } catch (e) { this.bg = null; }
  },
  async defaultBg() {
    // Standard background shipped with the app (step-bg.jpg next to index.html), if present.
    try {
      const r = await fetch('step-bg.jpg');
      if (!r.ok) return null;
      const b = await r.blob();
      return /^image\//.test(b.type) && b.size > 500 ? b : null;
    } catch (e) { return null; }
  },
  save() { return Store.putBlob('cfg:brand', this.cfg).catch(() => {}); },
  has(k) {
    if (k === 'logo') return !!this.logo;
    if (k === 'safetyText') return lines(this.cfg.safetyText).length > 0;
    if (k === 'safety') return this.has('safetyText') || !!this.cfg.clips.safetyVideo;
    return !!this.cfg.clips[k];
  },
  async useLogo(blob) {
    const img = await loadImageFromBlob(blob);
    if (!img.width || !img.height) throw new Error('This picture cannot be read.');
    closeImage(this.logo);
    this.logo = img;
    const k = Math.min(1, 240 / Math.max(img.width, img.height));
    const c = makeCanvas(img.width * k, img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    this.logoUrl = c.toDataURL('image/png');
    freeCanvas(c);
  },
  async setLogo(file) { await this.useLogo(file); await Store.putBlob('b:logo', file); },
  async clearLogo() { await Store.delBlobs(['b:logo']); closeImage(this.logo); this.logo = null; this.logoUrl = ''; },
  async useBg(blob) {
    const img = await loadImageFromBlob(blob);
    if (!img.width || !img.height) throw new Error('This picture cannot be read.');
    const k = Math.min(1, 1280 / Math.max(img.width, img.height));
    freeCanvas(this.bgSrc);
    this.bgSrc = makeCanvas(img.width * k, img.height * k);
    this.bgSrc.getContext('2d').drawImage(img, 0, 0, this.bgSrc.width, this.bgSrc.height);
    closeImage(img);
    this.processBg();
  },
  processBg() {
    // Grey + darkened copy, done per pixel because canvas filters are missing in older Safari.
    const src = this.bgSrc;
    if (!src) return;
    const c = makeCanvas(src.width, src.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0);
    const im = ctx.getImageData(0, 0, c.width, c.height);
    const d = im.data;
    const k = BG_DARK[this.cfg.bgDark || 2];
    for (let i = 0; i < d.length; i += 4) {
      const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * k;
      d[i] = g; d[i + 1] = g; d[i + 2] = g;
    }
    ctx.putImageData(im, 0, 0);
    freeCanvas(this.bg);
    this.bg = c;
    const t = makeCanvas(192, 192 * (c.height / c.width));
    t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
    this.bgUrl = t.toDataURL('image/jpeg', 0.8);
    freeCanvas(t);
  },
  async setBg(file) { await this.useBg(file); await Store.putBlob('b:bg', file); this.bgCustom = true; },
  async clearBg() { await Store.delBlobs(['b:bg']); await this.loadBg(); },
  /* A brand clip is a video (old formats are converted first) or a picture shown for a few seconds. */
  async setClip(slot, file, onStatus) {
    if (isImageFile(file) && !/^video\//.test(file.type || '')) {
      const c = await decodeImageFile(file, 2560);
      const blob = await canvasToBlob(c, 'image/jpeg', 0.92);
      await Store.putBlob('b:clip:' + slot, blob);
      if (this.urls[slot]) URL.revokeObjectURL(this.urls[slot]);
      delete this.urls[slot];
      this.imgs[slot] = c;
      const old = this.cfg.clips[slot];
      this.cfg.clips[slot] = { kind: 'image', name: file.name || 'picture', size: blob.size, width: c.width, height: c.height, duration: old && old.kind === 'image' ? old.duration : 5 };
      await this.save();
      return;
    }
    let r;
    try { r = await playableVideo(file, onStatus); } catch (e) {
      if (!e.userMsg) e.userMsg = 'This video cannot be played in this browser. MP4 or MOV works best.';
      throw e;
    }
    try { await Store.putBlob('b:clip:' + slot, r.file); } catch (e) { URL.revokeObjectURL(r.url); throw e; }
    if (this.urls[slot]) URL.revokeObjectURL(this.urls[slot]);
    this.urls[slot] = r.url;
    delete this.imgs[slot];
    this.cfg.clips[slot] = { kind: 'video', name: r.file.name || 'video', size: r.file.size, duration: r.meta.duration, width: r.meta.width, height: r.meta.height };
    await this.save();
  },
  async clearClip(slot) {
    await Store.delBlobs(['b:clip:' + slot]);
    if (this.urls[slot]) URL.revokeObjectURL(this.urls[slot]);
    delete this.urls[slot];
    delete this.imgs[slot];
    delete this.cfg.clips[slot];
    await this.save();
  },
  async prepareClips() {
    for (const slot of Object.keys(this.cfg.clips)) {
      const c = this.cfg.clips[slot];
      if (c.kind === 'image' ? this.imgs[slot] : this.urls[slot]) continue;
      const b = await Store.getBlob('b:clip:' + slot).catch(() => null);
      if (!b) { delete this.cfg.clips[slot]; this.save(); continue; }
      if (c.kind === 'image') {
        try { this.imgs[slot] = await createImageBitmap(b); } catch (e) { try { this.imgs[slot] = await loadImageEl(b); } catch (e2) { delete this.cfg.clips[slot]; this.save(); } }
      } else this.urls[slot] = URL.createObjectURL(b);
    }
  },
};

function openBrandSettings(onClose) {
  const body = h('div', { class: 'dlg' });
  const saveText = debounce(() => Brand.save(), 500);
  const btn = (label, fn, cls) => h('button', { type: 'button', class: 'btn small' + (cls ? ' ' + cls : ''), onClick: fn }, label);
  const act = async (fn, okMsg) => {
    const b = busy('Saving…');
    try { await fn(); b.close(); if (okMsg) toast(okMsg, '', 1800); }
    catch (e) { b.close(); toast(e && e.userMsg ? e.userMsg : (e && e.message && !/quota/i.test(e.message) && e.name !== 'QuotaExceededError' ? e.message : storageErrorText(e)), 'err', 6000); }
    draw();
  };
  const seg = (label, options, cur, set) => h('div', { class: 'set-row' }, h('span', null, label),
    h('div', { class: 'seg', role: 'group', 'aria-label': label }, options.map(([v, l]) => h('button', {
      type: 'button', 'aria-pressed': String(cur === v), onClick: () => { set(v); Brand.save(); draw(); },
    }, l))));
  const clip = (slot, title, hint) => {
    const c = Brand.cfg.clips[slot];
    const pic = c && c.kind === 'image';
    return h('div', { class: 'set-section', id: `brand-clip-${slot}` }, h('h4', null, title),
      h('p', null, c ? (pic ? `${c.name} · picture · ${c.width}×${c.height}` : `${c.name} · ${fmtDur(c.duration)} · ${fmtBytes(c.size)}`) : hint),
      pic ? seg('Show for', PICTURE_SHOW_SECONDS.map((n) => [n, `${n} s`]), c.duration, (v) => { c.duration = v; }) : null,
      h('div', { class: 'set-row wrap' },
        btn(c ? 'Replace' : 'Choose video or picture', async () => {
          const f = await pickFile(`${VIDEO_ACCEPT},${IMAGE_ACCEPT}`);
          if (!f) return;
          const bz = busy(isImageFile(f) ? 'Reading picture…' : 'Reading video…');
          try { await Brand.setClip(slot, f, (t) => bz.set(t)); bz.close(); toast(isImageFile(f) ? 'Picture saved' : 'Video saved', '', 1800); }
          catch (e) { bz.close(); toast(e && e.userMsg ? e.userMsg : storageErrorText(e), 'err', 9000); }
          draw();
        }),
        c ? btn('Remove', () => act(() => Brand.clearClip(slot)), 'danger-ghost') : null));
  };
  const safety = h('textarea', { id: 'brand-safety', rows: '4', placeholder: 'One instruction per line, e.g.\nUnplug the machine\nWear safety glasses' });
  safety.addEventListener('input', () => { Brand.cfg.safetyText = safety.value; saveText(); });
  const textField = (key, label, o = {}) => {
    const el = h(o.multiline ? 'textarea' : 'input', Object.assign({ id: `brand-${key}`, class: o.multiline ? '' : 'dlg-input', maxlength: o.max || '120', placeholder: o.placeholder || '', 'aria-label': label },
      o.multiline ? { rows: '3' } : { type: 'text', autocomplete: 'off' }));
    el.addEventListener('input', () => { Brand.cfg[key] = el.value; saveText(); });
    return { el, row: () => { el.value = Brand.cfg[key] || ''; return h('label', { class: 'set-field' }, h('span', null, label), el); } };
  };
  const company = textField('company', 'Company name', { placeholder: 'Shown in the footer of PDF and Word guides' });
  const claim = textField('claim', 'Claim or subline', { placeholder: 'Optional, shown under the title' });
  const contact = textField('contact', 'Contact and address', { multiline: true, max: '400', placeholder: 'Street, town\nPhone\nwww.example.com' });
  const fontSection = () => {
    const c = Brand.cfg.font;
    return h('div', { class: 'set-section', id: 'brand-font' }, h('h4', null, 'Font for exports'),
      h('div', { class: 'set-row' }, h('span', null, XFont.custom ? XFont.name : 'Inter'), h('span', { class: 'set-val' }, XFont.custom ? 'your font' : 'standard')),
      XFont.custom && c && c.files ? h('p', null, c.files.join(' · ')) : null,
      XFont.note ? h('p', { class: 'brand-note' }, XFont.note) : null,
      XFont.custom && c && c.cff ? h('p', null, 'Word files name this font but cannot carry it (.otf with PostScript outlines); Word shows it where it is installed.') : null,
      h('div', { class: 'set-row wrap' },
        btn(XFont.custom ? 'Replace font files' : 'Choose font files', async () => {
          const files = await pickFiles('.ttf,.otf,.woff,font/ttf,font/otf,font/woff,application/font-sfnt,application/x-font-ttf', true);
          if (files.length) act(() => XFont.choose(files), 'Font saved');
        }),
        XFont.custom ? btn('Use Inter', () => act(() => XFont.useStandard()), 'danger-ghost') : null),
      h('p', null, 'Load the .ttf or .otf files of your brand font, regular and bold. Only use fonts whose licence allows embedding them in documents.'));
  };
  function draw() {
    safety.value = Brand.cfg.safetyText || '';
    const picture = Brand.cfg.cardBg === 'picture';
    setKids(body,
      h('p', { class: 'dlg-msg' }, 'Used in every guide and saved in this browser. Switch each part on or off when you export.'),
      h('div', { class: 'set-section', id: 'brand-design' }, h('h4', null, 'Export design'),
        h('p', null, 'Videos, PDF and Word guides share one look: black stage, white type, pictures on a grey stage.'),
        seg('Language', [['en', 'English'], ['de', 'Deutsch']], Brand.cfg.lang || 'en', (v) => { Brand.cfg.lang = v; }),
        seg('Card background', [['plain', 'Black'], ['picture', 'Picture']], Brand.cfg.cardBg || 'plain', (v) => { Brand.cfg.cardBg = v; }),
        seg('PDF pages', [['light', 'Light'], ['dark', 'Dark']], Brand.cfg.pdfPages || 'light', (v) => { Brand.cfg.pdfPages = v; }),
        company.row(), claim.row(), contact.row()),
      fontSection(),
      h('div', { class: 'set-section' }, h('h4', null, 'Logo watermark'),
        h('div', { class: 'set-row wrap' },
          h('span', { class: 'brand-thumb', style: { backgroundImage: Brand.logoUrl ? `url("${Brand.logoUrl}")` : '' } }),
          btn(Brand.logo ? 'Replace logo' : 'Choose logo', async () => { const f = await pickFile('image/*'); if (f) act(() => Brand.setLogo(f), 'Logo saved'); }),
          Brand.logo ? btn('Remove', () => act(() => Brand.clearLogo()), 'danger-ghost') : null),
        h('p', null, 'A PNG with a transparent background looks best. Shown on step clips, pictures and cards.'),
        seg('Position', [['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘']], Brand.cfg.wmPos, (v) => { Brand.cfg.wmPos = v; }),
        seg('Size', [[1, 'S'], [2, 'M'], [3, 'L']], Brand.cfg.wmSize, (v) => { Brand.cfg.wmSize = v; }),
        seg('Opacity', [[0.4, '40%'], [0.65, '65%'], [0.85, '85%'], [1, '100%']], Brand.cfg.wmOpacity, (v) => { Brand.cfg.wmOpacity = v; })),
      !picture ? null : h('div', { class: 'set-section' }, h('h4', null, 'Background picture for cards'),
        h('div', { class: 'set-row wrap' },
          h('span', { class: 'brand-thumb cover', style: { backgroundImage: Brand.bgUrl ? `url("${Brand.bgUrl}")` : '' } }),
          btn(Brand.bgCustom ? 'Replace picture' : 'Choose picture', async () => { const f = await pickFile('image/*'); if (f) act(() => Brand.setBg(f), 'Background saved'); }),
          Brand.bgCustom ? btn('Use standard', () => act(() => Brand.clearBg()), 'danger-ghost') : null),
        h('p', null, Brand.bgCustom ? 'Your picture, turned grey and darkened, sits behind the title, safety and step cards.'
          : (Brand.bg ? 'The standard picture is in use. Choose your own to replace it.' : 'The standard grid is in use. Choose a picture; it is turned grey and darkened automatically.')),
        Brand.bg ? seg('Darkness', [[1, 'Light'], [2, 'Medium'], [3, 'Dark']], Brand.cfg.bgDark, (v) => { Brand.cfg.bgDark = v; Brand.processBg(); }) : null),
      clip('intro', 'Brand intro', 'A video or a picture. Plays first in every exported video.'),
      h('div', { class: 'set-section' }, h('h4', null, 'Safety instructions'),
        h('p', null, 'Shown as a card after the title, and as a box in PDF and Word guides.'), safety),
      clip('safetyVideo', 'Safety video or picture', 'Optional. Plays after the safety card, before step 1.'),
      clip('outro', 'Closing', 'A video or a picture. Plays last in every exported video.'),
      h('p', { class: 'hint' }, 'Brand videos are fitted into the frame and play without sound, like the rest of the export.'));
  }
  draw();
  Modal.open(body, { full: true, title: 'Brand & safety', onClose: () => { saveText.flush(); if (onClose) onClose(); } });
}
