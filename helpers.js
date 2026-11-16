'use strict';
/* ============================================================================================================
   helpers.js
   What it does:    Small tools used everywhere: finding things on the page, building buttons and lists, dialogs,
                   short messages at the bottom of the screen (toasts), times and file sizes as text.
   Change here:     Rarely. The wording of a few general messages.
   Edit with care: change texts and values, not the structure.
   Technical note:  Fixframe — turn a repair video into a step-by-step guide. Videos and project data are processed
                   locally in the browser.
   ============================================================================================================ */
const IS_FRAMED = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
const UA = navigator.userAgent || '';
const IS_IOS = /iP(hone|ad|od)/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_ANDROID = /Android/i.test(UA);
const IS_STANDALONE = (() => {
  try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; }
})();

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* Let the page breathe without a timer (timers are slowed to about once a second in background tabs). */
const yieldNow = (() => {
  if (typeof MessageChannel === 'undefined') return () => sleep(0);
  const ch = new MessageChannel();
  const q = [];
  ch.port1.onmessage = () => { const r = q.shift(); if (r) r(); };
  return () => new Promise((r) => { q.push(r); ch.port2.postMessage(0); });
})();
const uid = (p) => (p || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const k of Object.keys(props)) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k.length > 2 && k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function setKids(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

function icon(name, cls) {
  const s = document.createElement('span');
  s.className = 'ico' + (cls ? ' ' + cls : '');
  s.innerHTML = ICONS[name] || '';
  return s;
}
function fillIcons(root) {
  $$('[data-icon]', root || document).forEach((el) => {
    if (el.dataset.iconDone) return;
    el.dataset.iconDone = '1';
    el.insertAdjacentHTML('afterbegin', `<span class="ico">${ICONS[el.dataset.icon] || ''}</span>`);
  });
}
function setIcon(el, name) {
  const s = el.querySelector('.ico');
  if (s) s.innerHTML = ICONS[name] || '';
}

function fmtTime(t, withCs = true) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const whole = Math.floor(s);
  if (!withCs) return `${m}:${String(whole).padStart(2, '0')}`;
  const cs = Math.min(99, Math.floor((s - whole) * 100 + 1e-6));
  return `${m}:${String(whole).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
function fmtTenths(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const d = Math.round(t * 10);
  const m = Math.floor(d / 600);
  const s = (d - m * 600) / 10;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}
function fmtDur(t) {
  if (!isFinite(t)) t = 0;
  if (t < 59.95) return `${(Math.round(t * 10) / 10).toFixed(1)} s`;
  return fmtTime(Math.round(t), false);
}
function fmtBytes(n) {
  if (!isFinite(n) || n < 0) return '–';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}
function fmtDate(ts) {
  try { return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; }
}
function fmtCount(n) { try { return Number(n).toLocaleString('en-US'); } catch (e) { return String(n); } }
function speedLabel(s) { return s === 0.5 ? '½×' : `${s}×`; }
function plural(n, one, many) { return `${n} ${n === 1 ? one : (many || one + 's')}`; }
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function safeFileName(title, ext) {
  let base = String(title || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!base) base = 'Repair guide';
  return `${base}.${ext}`;
}
function debounce(fn, ms) {
  let t = 0;
  const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  f.flush = (...a) => { clearTimeout(t); return fn(...a); };
  f.cancel = () => clearTimeout(t);
  return f;
}
function lines(text) { return String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean); }

function makeCanvas(w, hgt) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(hgt));
  return c;
}
function freeCanvas(c) { if (c && c.width !== undefined) { c.width = 0; c.height = 0; } }
function canvasToBlob(c, type = 'image/jpeg', q = 0.9) {
  return new Promise((resolve, reject) => {
    const fallback = () => { try { resolve(dataURLtoBlob(c.toDataURL(type, q))); } catch (e) { reject(e); } };
    try {
      if (c.toBlob) c.toBlob((b) => (b ? resolve(b) : fallback()), type, q);
      else fallback();
    } catch (e) { fallback(); }
  });
}
function dataURLtoBlob(d) {
  const i = d.indexOf(',');
  const mime = (d.slice(0, i).match(/:(.*?)[;,]/) || [])[1] || 'application/octet-stream';
  const bin = atob(d.slice(i + 1));
  const u8 = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
  return new Blob([u8], { type: mime });
}
function blobToDataURL(b) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
}
async function blobToBase64(b) { const d = await blobToDataURL(b); return d.slice(d.indexOf(',') + 1); }
async function blobBytes(b) { return new Uint8Array(await b.arrayBuffer()); }
async function loadImageFromBlob(blob) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(blob); } catch (e) { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try { await img.decode(); } catch (e) { await new Promise((r) => { img.onload = r; img.onerror = r; }); }
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return img;
}
function closeImage(img) { try { if (img && img.close) img.close(); } catch (e) { /* ignore */ } }

/* ---------- sheets, dialogs, toasts ---------- */
const Modal = {
  /* full: a sheet over the whole phone screen (a centred dialog on wide screens) with a header holding the title and
     a Done button. Every sheet that can be dismissed closes with a swipe down on its grip or header. */
  open(content, { onClose, dismissable = true, top = false, full = false, title = '' } = {}) {
    const back = h('div', { class: 'modal-back' + (top ? ' top' : '') + (full ? ' full' : '') });
    const grip = h('div', { class: 'sheet-grip', 'aria-hidden': 'true' });
    const head = full
      ? h('div', { class: 'sheet-head' }, grip, h('h3', { class: 'sheet-title' }, title),
        dismissable ? h('button', { class: 'btn small sheet-done', type: 'button', onClick: () => close(null) }, 'Done') : null)
      : grip;
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || null }, head, content);
    back.append(sheet);
    if (dismissable && !top) {
      let y0 = null;
      let dy = 0;
      head.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        y0 = e.clientY; dy = 0;
        sheet.style.transition = 'none';
        try { head.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
      });
      head.addEventListener('pointermove', (e) => {
        if (y0 == null) return;
        dy = Math.max(0, e.clientY - y0);
        sheet.style.transform = `translateY(${dy}px)`;
      });
      const end = () => {
        if (y0 == null) return;
        y0 = null;
        sheet.style.transition = '';
        if (dy > 80) close(null);
        else sheet.style.transform = '';
      };
      head.addEventListener('pointerup', end);
      head.addEventListener('pointercancel', end);
    }
    $('#modal-root').append(back);
    requestAnimationFrame(() => requestAnimationFrame(() => back.classList.add('in')));
    let closed = false;
    const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(null); };
    const close = (v) => {
      if (closed) return;
      closed = true;
      back.classList.remove('in');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => back.remove(), 200);
      if (onClose) onClose(v);
    };
    document.addEventListener('keydown', onKey);
    if (dismissable) back.addEventListener('pointerdown', (e) => { if (e.target === back) close(null); });
    return { close, sheet, back };
  },
};

function ask({ title, message, ok = 'OK', cancel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let m = null;
    const body = h('div', { class: 'dlg' },
      h('h3', { class: 'dlg-title' }, title),
      message ? h('p', { class: 'dlg-msg' }, message) : null,
      h('div', { class: 'dlg-actions' },
        cancel ? h('button', { class: 'btn', type: 'button', onClick: () => m.close(false) }, cancel) : null,
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', onClick: () => m.close(true) }, ok)));
    m = Modal.open(body, { onClose: (v) => resolve(!!v) });
  });
}

function askText({ title, message = '', value = '', placeholder = '', multiline = false, ok = 'Save', maxlength = 300 }) {
  return new Promise((resolve) => {
    let m = null;
    const input = multiline
      ? h('textarea', { class: 'dlg-input', rows: '3', placeholder, maxlength: String(maxlength) })
      : h('input', { class: 'dlg-input', type: 'text', placeholder, maxlength: String(maxlength), enterkeyhint: 'done', autocomplete: 'off' });
    input.value = value;
    const submit = () => m.close(input.value);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
    });
    const body = h('form', { class: 'dlg', onSubmit: (e) => { e.preventDefault(); submit(); } },
      h('h3', { class: 'dlg-title' }, title),
      message ? h('p', { class: 'dlg-msg' }, message) : null,
      input,
      h('div', { class: 'dlg-actions' },
        h('button', { type: 'button', class: 'btn', onClick: () => m.close(null) }, 'Cancel'),
        h('button', { type: 'submit', class: 'btn primary' }, ok)));
    m = Modal.open(body, { top: true, onClose: (v) => resolve(v == null ? null : String(v)) });
    try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) { /* ignore */ }
  });
}

function busy(msg) {
  const p = h('p', null, msg);
  const m = Modal.open(h('div', { class: 'dlg busy' }, h('div', { class: 'spinner' }), p), { dismissable: false });
  return { set: (t) => { p.textContent = t; }, close: () => m.close() };
}

function toast(msg, kind = '', ms = 2800) {
  const t = h('div', { class: 'toast ' + kind, role: 'status' }, msg);
  $('#toasts').append(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('in')));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 260); }, ms);
}

/* Android back button / back gesture closes the top-most screen. */
const Nav = {
  stack: [],
  skip: 0,
  push(name, onBack) {
    this.stack.push({ name, onBack });
    if (!IS_FRAMED) { try { history.pushState({ ff: this.stack.length }, ''); } catch (e) { /* ignore */ } }
  },
  pop(name) {
    const i = this.stack.map((s) => s.name).lastIndexOf(name);
    if (i < 0) return;
    const n = this.stack.length - i;
    this.stack.length = i;
    // history.go(-n) fires a single popstate, which must not close anything else
    if (!IS_FRAMED) { this.skip += 1; try { history.go(-n); } catch (e) { this.skip -= 1; } }
  },
  onPopState() {
    if (this.skip > 0) { this.skip--; return; }
    const top = this.stack.pop();
    if (top) top.onBack();
  },
};

function pickFiles(accept, multiple) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, hidden: true, multiple: !!multiple });
    document.body.append(input);
    input.addEventListener('change', () => { const list = Array.from(input.files || []); input.remove(); resolve(list); });
    input.addEventListener('cancel', () => { input.remove(); resolve([]); });
    input.click();
  });
}
async function pickFile(accept) { return (await pickFiles(accept, false))[0] || null; }
function readText(blob) {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsText(blob);
  });
}
/* Keep sheets and full-screen editors inside the visible area when the on-screen keyboard is open. */
function fitViewport() {
  const vv = window.visualViewport;
  const st = document.documentElement.style;
  if (!vv || Math.abs(vv.scale - 1) > 0.01 || window.innerHeight - vv.height < 80) {
    st.removeProperty('--vv-h');
    st.removeProperty('--vv-top');
    return;
  }
  st.setProperty('--vv-h', `${vv.height}px`);
  st.setProperty('--vv-top', `${vv.offsetTop}px`);
}
