/* ============================================================================================================
   invitation.js
   What it does:    The invitation screen, the export counter and the unlock-code screen. Works only when
                   access.json is on the website.
   Change here:     Texts of those screens. The limit and the codes come from access.json (owner tool).
   Edit with care: change texts and values, not the structure.
   Technical note:  Access by invitation (optional). It is switched on by a file named access.json next to
                   index.html: { "codes": [fingerprints…], "salt": "…", "rounds": 100000, "contact": "…",
                   "exportLimit": 10, "unlock": "…" } - "codes" lists a fingerprint per invitation code; its place
                   in the list is the invitation number. No file: the app is open to all. - After "exportLimit"
                   video exports the app asks for an unlock code (see codes.js). Everything is checked on the
                   device. The app only downloads access.json; it sends nothing.
   ============================================================================================================ */
const Access = {
  cfg: null,        // the cleaned access.json, or null when there is none
  known: false,     // false until the website has answered once
  st: null,         // { fp, n, at } once an invitation code was accepted
  ex: { count: 0, total: 0, unlocks: 0, req: null },
  note: '',
  linkCode: '',
  gateEl: null, gateMode: '', gateDone: null, lastFetch: 0, checkedAt: 0,
  VIDEO_FORMATS: ['mp4'],

  async load() {
    try {
      const s = await Store.getBlob('cfg:access');
      if (!s || typeof s !== 'object' || s instanceof Blob) return;
      this.known = !!s.known;
      this.checkedAt = +s.checkedAt || 0;
      this.cfg = s.cfg ? this.clean(s.cfg) : null;
      if (s.st && typeof s.st.fp === 'string') this.st = { fp: s.st.fp, n: +s.st.n || 0, at: +s.st.at || 0 };
      if (s.ex && typeof s.ex === 'object') {
        const r = s.ex.req;
        this.ex = {
          count: Math.max(0, +s.ex.count || 0), total: Math.max(0, +s.ex.total || 0), unlocks: Math.max(0, +s.ex.unlocks || 0),
          req: r && typeof r === 'object' ? { n: +r.n || 0, ddmm: +r.ddmm || 0, yyhh: +r.yyhh || 0, at: +r.at || 0 } : null,
        };
      }
    } catch (e) { /* start without stored access data */ }
  },
  save() { return Store.putBlob('cfg:access', { known: this.known, checkedAt: this.checkedAt, cfg: this.cfg, st: this.st, ex: this.ex }).catch(() => {}); },

  /* Copy field by field: the file is edited by hand. Returns null when it switches nothing on. */
  clean(j) {
    if (!j || typeof j !== 'object') return null;
    const hex = (v, min, max) => (typeof v === 'string' && new RegExp(`^[0-9a-f]{${min},${max}}$`).test(v.trim().toLowerCase()) ? v.trim().toLowerCase() : '');
    const salt = hex(j.salt, 8, 64);
    const rounds = clamp(Math.round(+j.rounds || 100000), 1000, 2000000);
    const gate = Array.isArray(j.codes) && !!salt;
    const codes = gate ? j.codes.slice(0, 5000).map((c) => hex(c, 32, 32)) : [];
    const unlock = salt ? hex(j.unlock, 32, 32) : '';
    const limit = unlock ? clamp(Math.round(+(j.exportLimit != null ? j.exportLimit : j.limit) || 0), 0, 100000) : 0;
    if (!gate && !limit) return null;
    const recheck = clamp(Math.round(j.recheckDays != null && isFinite(+j.recheckDays) ? +j.recheckDays : 7), 0, 365);
    return { gate, salt, rounds, codes, unlock, limit, recheck, contact: typeof j.contact === 'string' ? j.contact.trim().slice(0, 200) : '' };
  },
  async fetchConfig(ms) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    this.lastFetch = Date.now();
    try {
      const r = await fetch(`access.json?t=${Math.floor(Date.now() / 60000)}`, { cache: 'no-store', signal: ctl.signal });
      if (r.status === 404 || r.status === 410) return { state: 'off' };
      if (!r.ok) return { state: 'error' };
      let j = null;
      try { j = JSON.parse(await r.text()); } catch (e) { return { state: 'invalid' }; }
      if (!j || typeof j !== 'object' || Array.isArray(j)) return { state: 'invalid' };
      return { state: 'on', cfg: this.clean(j) };
    } catch (e) { return { state: 'error' }; } finally { clearTimeout(timer); }
  },
  apply(r) {
    if (r.state === 'on') { this.cfg = r.cfg; this.known = true; this.note = ''; this.checkedAt = Date.now(); }
    else if (r.state === 'off') { this.cfg = null; this.known = true; this.note = ''; this.checkedAt = Date.now(); }
    else if (r.state === 'invalid') this.note = 'The file access.json on the website could not be read. Check it for a typing mistake.';
  },

  /* '' = the app may be used, 'enter' = an invitation code is needed, 'blocked' = the stored code is no longer listed */
  need() {
    if (!this.cfg || !this.cfg.gate) return '';
    if (this.st && this.st.fp) {
      const i = this.cfg.codes.indexOf(this.st.fp);
      if (i < 0) return 'blocked';
      this.st.n = i + 1;
      return '';
    }
    return 'enter';
  },
  active() { return !!(this.cfg && (this.cfg.gate || this.cfg.limit)); },
  number() { return this.cfg && this.cfg.gate && this.st ? this.st.n || 0 : 0; },

  readLink() {
    try {
      const m = /[#&]code=([^&]*)/i.exec(location.hash || '');
      if (!m) return;
      this.linkCode = decodeURIComponent(m[1]).slice(0, 40);
      history.replaceState(history.state, '', location.pathname + location.search);
    } catch (e) { /* no invitation link */ }
  },

  /* Called once at start; resolves when the app may be used. */
  async start() {
    this.readLink();
    await this.load();
    if (!this.known) { this.apply(await this.fetchConfig(6000)); await this.save(); }
    else if (this.need() === 'enter' || this.due()) this.refresh();
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.due() && Date.now() - this.lastFetch > 3600000) this.refresh(); });
    const need = this.need();
    if (need) await this.showGate(need);
  },
  /* Few contacts: the list is read again only every few days (access.json "recheckDays", 7 when missing;
     0 = only while an invitation code is being entered). */
  days() { return this.cfg ? this.cfg.recheck : 7; },
  due() { const d = this.days(); return d > 0 && Date.now() - this.checkedAt > d * 86400000; },
  /* Reads access.json again in the background, so a blocked code stops and a new list arrives. */
  async refresh() {
    const before = this.need();
    const r = await this.fetchConfig(15000);
    if (r.state === 'error') return r.state;
    this.apply(r);
    await this.save();
    const after = this.need();
    if (this.gateEl) {
      if (!after) this.openApp();
      else if (after !== this.gateMode) this.renderGate(after);
    } else if (after && !before) {
      try { if (E.P) await saveNow(); } catch (e) { /* the reload saves again */ }
      location.reload();
    }
    return r.state;
  },

  /* ---------- the invitation screen ---------- */
  showGate(mode) {
    $('#app').hidden = true;
    this.gateEl = h('div', { class: 'gate', id: 'gate' });
    document.body.append(this.gateEl);
    this.renderGate(mode);
    return new Promise((res) => { this.gateDone = res; });
  },
  dropGate() {
    if (this.gateEl) this.gateEl.remove();
    this.gateEl = null;
    this.gateMode = '';
    $('#app').hidden = false;
  },
  openApp() {
    const done = this.gateDone;
    this.gateDone = null;
    this.dropGate();
    if (done) done();
  },
  renderGate(mode) {
    this.gateMode = mode;
    const blocked = mode === 'blocked';
    const input = h('input', {
      id: 'gate-code', class: 'gate-code', type: 'text', placeholder: 'FX-XXXX-XXXX', maxlength: '16', 'aria-label': 'Invitation code',
      autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go',
    });
    // A code that came with the invitation link is kept out of sight: only its last 4 characters are shown.
    const linked = ffNormCode(this.linkCode);
    const masked = linked ? ffMaskCode(linked) : '';
    if (masked) { input.value = masked; input.dataset.masked = '1'; }
    input.addEventListener('focus', () => { if (input.dataset.masked) input.select(); });
    input.addEventListener('input', (e) => {
      if (input.dataset.masked) delete input.dataset.masked; // typing replaces the linked code
      // group the characters while typing at the end; leave the text alone while correcting in the middle
      if (e.inputType && e.inputType.startsWith('delete')) return;
      if (input.selectionStart !== input.value.length) return;
      const raw = input.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 10);
      input.value = raw.startsWith('FX') ? [raw.slice(0, 2), raw.slice(2, 6), raw.slice(6)].filter(Boolean).join('-') : raw;
    });
    const msg = h('p', { class: 'gate-msg', id: 'gate-msg', role: 'status', 'aria-live': 'polite' });
    const go = h('button', { class: 'btn primary big', id: 'gate-go', type: 'submit' }, 'Activate');
    const again = blocked ? h('button', { class: 'btn wide', id: 'gate-again', type: 'button' }, icon('refresh'), 'Check again') : null;
    let working = false;
    const run = async (fn) => {
      if (working) return;
      working = true;
      go.disabled = true;
      if (again) again.disabled = true;
      msg.className = 'gate-msg';
      msg.textContent = 'Checking…';
      let text = '';
      try { text = await fn(); } catch (e) { text = 'That did not work. Please try again.'; }
      working = false;
      if (!this.gateEl || !msg.isConnected) return;
      go.disabled = false;
      if (again) again.disabled = false;
      msg.textContent = text || '';
      if (text) msg.className = 'gate-msg err';
    };
    if (again) {
      again.addEventListener('click', () => run(async () => {
        const state = await this.refresh();
        if (!this.gateEl) return '';
        return state === 'error' ? 'No connection to the website right now. Try again when you are online.' : 'This code is still not on the list.';
      }));
    }
    const form = h('form', { class: 'gate-form', onSubmit: (e) => { e.preventDefault(); run(() => this.submit(input.dataset.masked && input.value === masked ? linked : input.value)); } }, input, go);
    const wipe = h('button', { class: 'gate-link', id: 'gate-wipe', type: 'button', onClick: () => wipeEverything() }, 'Delete Fixframe data on this device');
    setKids(this.gateEl, h('div', { class: 'gate-in' },
      $('.home-bar .brand').cloneNode(true),
      h('h1', null, blocked ? 'This invitation is no longer valid' : 'Invitation needed'),
      h('p', { class: 'gate-lead' }, blocked
        ? 'The invitation code used on this device is no longer on the list. Your guides are kept. Enter a new code to continue.'
        : 'Fixframe is by invitation. Enter your personal invitation code to start.'),
      form, msg, again,
      h('p', { class: 'gate-contact' }, h('b', null, 'No code? '), 'Contact the owner of this app.'),
      IS_IOS && !IS_STANDALONE ? h('p', { class: 'gate-hint' }, 'On iPhone and iPad: first tap Share, then “Add to Home Screen”, and enter the code in the installed app. Safari and the installed app do not share their data.') : null,
      h('div', { class: 'gate-update' }, h('span', null, 'An update is ready.'), h('button', { class: 'btn small accent', type: 'button', onClick: () => PWA.apply() }, 'Install')),
      h('div', { class: 'gate-foot' },
        h('p', null, TEXTS.privacy),
        h('p', { class: 'gate-ver' }, `Fixframe ${APP_VERSION}`), wipe)));
    if (!IS_IOS && !blocked) { try { input.focus({ preventScroll: true }); } catch (e) { /* optional */ } }
  },
  /* Returns '' when the code was accepted, else the message to show. */
  async submit(raw) {
    const norm = ffNormCode(raw);
    if (!norm) return 'A code looks like FX-ABCD-2345. Check it and try again.';
    for (let pass = 0; pass < 2; pass++) {
      const cfg = this.cfg;
      if (!cfg || !cfg.gate) { this.openApp(); return ''; }
      const fp = await ffFingerprint(norm, cfg.salt, cfg.rounds);
      const i = cfg.codes.indexOf(fp);
      if (i >= 0) {
        this.st = { fp, n: i + 1, at: Date.now() };
        this.linkCode = '';
        await this.save();
        this.openApp();
        return '';
      }
      if (pass === 0) {
        // the list on the device may be older than the code: load it once more
        const r = await this.fetchConfig(8000);
        if (r.state !== 'on' && r.state !== 'off') break;
        this.apply(r);
        await this.save();
      }
    }
    await sleep(700);
    return 'This code is not valid. Check it and try again.';
  },
  async forget() {
    this.st = null;
    await this.save();
    location.reload();
  },

  /* ---------- unlock code after a number of video exports ---------- */
  limit() { return this.cfg && this.cfg.limit > 0 && this.cfg.unlock ? this.cfg.limit : 0; },
  left() { const L = this.limit(); return L ? Math.max(0, L - this.ex.count) : Infinity; },
  isVideo(fmt) { return this.VIDEO_FORMATS.includes(fmt); },
  async allowVideoExport() {
    if (!this.limit() || this.left() > 0) return true;
    return this.askUnlock();
  },
  async countVideoExport() {
    this.ex.count += 1;
    this.ex.total += 1;
    await this.save();
  },
  async request() {
    if (!this.ex.req) {
      this.ex.req = Object.assign({ n: this.number(), at: Date.now() }, ffStamp(new Date()));
      await this.save();
    }
    return this.ex.req;
  },
  async tryUnlock(raw) {
    const d = String(raw || '').replace(/\D/g, '');
    const cfg = this.cfg;
    const req = this.ex.req;
    if (d.length !== 8 || !cfg || !cfg.unlock || !req) return false;
    const tail = d.slice(4);
    if ((await ffFingerprint('unlock:' + tail, cfg.salt, cfg.rounds)) !== cfg.unlock) return false;
    if (ffUnlockPart(req.n, req.ddmm, req.yyhh, +tail) !== d.slice(0, 4)) return false;
    this.ex.count = 0;
    this.ex.req = null;
    this.ex.unlocks += 1;
    await this.save();
    return true;
  },
  /* The sheet that shows the request number and takes the unlock code. Resolves true once unlocked. */
  async askUnlock() {
    const req = await this.request();
    const id = ffRequestId(req.n, req.ddmm, req.yyhh);
    const limit = this.limit();
    const used = this.ex.count;
    return new Promise((resolve) => {
      let m = null;
      const input = h('input', {
        class: 'dlg-input unlock-input', id: 'unlock-code', type: 'text', inputmode: 'numeric', placeholder: '0000-0000', maxlength: '11',
        autocomplete: 'off', enterkeyhint: 'done', 'aria-label': 'Unlock code',
      });
      input.addEventListener('input', (e) => {
        if (e.inputType && e.inputType.startsWith('delete')) return;
        if (input.selectionStart !== input.value.length) return;
        const raw = input.value.replace(/\D/g, '').slice(0, 8);
        input.value = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
      });
      const msg = h('p', { class: 'gate-msg', id: 'unlock-msg', role: 'status', 'aria-live': 'polite' });
      const ok = h('button', { type: 'submit', class: 'btn primary' }, 'Unlock');
      const body = h('form', {
        class: 'dlg', id: 'unlock-form',
        onSubmit: async (e) => {
          e.preventDefault();
          if (ok.disabled) return;
          ok.disabled = true;
          msg.className = 'gate-msg';
          msg.textContent = 'Checking…';
          const good = await this.tryUnlock(input.value);
          if (good) { m.close(true); toast(`Unlocked: ${plural(limit, 'more video export')}.`); return; }
          await sleep(500);
          ok.disabled = false;
          msg.className = 'gate-msg err';
          msg.textContent = 'This code does not fit this request. Check the 8 digits.';
        },
      },
        h('h3', { class: 'dlg-title' }, 'Unlock code'),
        h('p', { class: 'dlg-msg' }, used >= limit
          ? `You have made ${plural(used, 'video export')}. To make the next ${limit}, contact the owner of this app, give them this request number and enter the code you get back.`
          : `${used} of ${limit} video exports are used. You can get the next unlock code now: contact the owner of this app, give them this request number and enter the code you get back.`),
        h('div', { class: 'unlock-req' }, h('span', { class: 'label' }, 'Request number'), h('b', { id: 'unlock-req' }, id)),
        input, msg,
        h('div', { class: 'dlg-actions' },
          h('button', { type: 'button', class: 'btn', onClick: () => m.close(false) }, 'Later'), ok),
        h('p', { class: 'hint' }, 'Editing and PDF and Word guides keep working without the code.'));
      m = Modal.open(body, { top: true, onClose: (v) => resolve(v === true) });
    });
  },
  exportNote() {
    const L = this.limit();
    if (!L) return '';
    const left = this.left();
    if (left === 0) return ' · unlock code needed';
    return left <= 3 ? ` · ${plural(left, 'video export')} left before the next unlock code` : '';
  },

  settingsSection(closeSettings) {
    if (!this.active() && !this.note) return null;
    const rows = [h('h4', null, 'Access')];
    if (this.note) rows.push(h('p', null, this.note));
    if (this.cfg && this.cfg.gate && this.st) {
      rows.push(h('div', { class: 'set-row' }, h('span', null, 'Invitation'), h('span', { class: 'set-val', id: 'set-invite' }, `#${this.st.n}`)));
    }
    const L = this.limit();
    if (L) {
      rows.push(h('div', { class: 'set-row' }, h('span', null, 'Video exports'), h('span', { class: 'set-val', id: 'set-exports' }, `${Math.min(this.ex.count, L)} of ${L} used`)));
      rows.push(h('p', null, `After ${L} video exports the app asks for an unlock code. Editing, PDF and Word guides are not counted.`));
    }
    const btns = [];
    if (L && this.ex.count > 0) btns.push(h('button', { class: 'btn small', id: 'set-unlock', type: 'button', onClick: () => { closeSettings(); this.askUnlock(); } }, 'Enter unlock code'));
    if (this.cfg && this.cfg.gate && this.st) {
      btns.push(h('button', {
        class: 'btn small', id: 'set-forget', type: 'button',
        onClick: async () => {
          closeSettings();
          const ok = await ask({ title: 'Remove the invitation from this device?', message: 'Fixframe will ask for an invitation code again. Your guides are kept.', ok: 'Remove invitation' });
          if (ok) this.forget();
        },
      }, 'Remove invitation'));
    }
    if (btns.length) rows.push(h('div', { class: 'set-row wrap' }, btns));
    return h('div', { class: 'set-section', id: 'set-access' }, rows);
  },
};
