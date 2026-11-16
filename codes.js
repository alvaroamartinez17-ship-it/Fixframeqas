/* ============================================================================================================
   codes.js
   What it does:    The maths behind invitation codes and unlock codes. Shared with the owner tool, so both always
                   agree.
   Change here:     Nothing! A change here makes the owner tool and the app disagree, and codes stop working.
   Engine room: better leave it as it is.
   Technical note:  Invitation and unlock codes: plain functions, shared by the app and the owner tool (no screen,
                   no storage). - An invitation code looks like FX-ABCD-2345. The website only holds a fingerprint
                   of each code. - An unlock code is 8 digits: a 4-digit check made from date, hour and invitation
                   number, then the owner number.
   ============================================================================================================ */
const FF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0, 1, I, L, O: nothing to mix up when typing

function ffNormCode(input) {
  let s = String(input == null ? '' : input).slice(0, 64).toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (s.length === 8) s = 'FX' + s;
  if (s.length !== 10 || s.slice(0, 2) !== 'FX') return '';
  for (const ch of s.slice(2)) if (!FF_ALPHABET.includes(ch)) return '';
  return s;
}
/* FX-ABCD-2345 -> FX-····-2345: only the last 4 characters are shown. */
function ffMaskCode(norm) { return `FX-\u00b7\u00b7\u00b7\u00b7-${norm.slice(6)}`; }
function ffShowCode(norm) { return `${norm.slice(0, 2)}-${norm.slice(2, 6)}-${norm.slice(6)}`; }
function ffRandomCode() {
  const n = FF_ALPHABET.length;
  const top = 256 - (256 % n); // skip the uneven remainder so every character is equally likely
  let out = '';
  while (out.length < 8) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) if (b < top && out.length < 8) out += FF_ALPHABET[b % n];
  }
  return 'FX' + out;
}
function ffRandomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---- SHA-256 / HMAC / PBKDF2 in plain JavaScript: used when the browser offers no crypto.subtle ---- */
const FF_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
function ffSha256(bytes) {
  const len = bytes.length;
  const total = ((len + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[len] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, Math.floor((len * 8) / 4294967296));
  dv.setUint32(total - 4, (len * 8) >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const r = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15];
      const b = w[i - 2];
      w[i] = w[i - 16] + (r(a, 7) ^ r(a, 18) ^ (a >>> 3)) + w[i - 7] + (r(b, 17) ^ r(b, 19) ^ (b >>> 10));
    }
    let [a, b, c, d, e, f, g, hh] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + FF_K[i] + w[i]) >>> 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += hh;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]);
  return out;
}
function ffPbkdf2Js(pw, salt, rounds, len) {
  let key = pw;
  if (key.length > 64) key = ffSha256(key);
  const ipad = new Uint8Array(64 + 32);
  const opad = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) { const k = key[i] || 0; ipad[i] = k ^ 0x36; opad[i] = k ^ 0x5c; }
  const hmac32 = (msg32) => { ipad.set(msg32, 64); opad.set(ffSha256(ipad), 64); return ffSha256(opad); };
  const first = new Uint8Array(64 + salt.length + 4);
  first.set(ipad.subarray(0, 64));
  first.set(salt, 64);
  first[first.length - 1] = 1; // block number 1: one block is enough for up to 32 bytes
  opad.set(ffSha256(first), 64);
  let u = ffSha256(opad);
  const t = u.slice();
  for (let i = 1; i < rounds; i++) {
    u = hmac32(u);
    for (let k = 0; k < 32; k++) t[k] ^= u[k];
  }
  return t.slice(0, len);
}

/* The fingerprint that is stored on the website instead of the code itself. */
async function ffFingerprint(text, saltHex, rounds) {
  const enc = new TextEncoder();
  const pw = enc.encode(String(text));
  const salt = enc.encode('fixframe|' + saltHex);
  let bytes = null;
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const key = await crypto.subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveBits']);
      bytes = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, key, 128));
    }
  } catch (e) { bytes = null; }
  if (!bytes) bytes = ffPbkdf2Js(pw, salt, rounds, 16);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---- unlock code ---- */
const ff2 = (n) => String(n).padStart(2, '0');
const ff4 = (n) => String(n).padStart(4, '0');
/* Date and hour as two 4-digit numbers: day+month (10 Nov -> 1011) and year+hour (2026, 15 h -> 2615). */
function ffStamp(date) {
  return { ddmm: date.getDate() * 100 + (date.getMonth() + 1), yyhh: (date.getFullYear() % 100) * 100 + date.getHours() };
}
/* What the app shows and the user sends: invitation number, day+month, year+hour. */
function ffRequestId(n, ddmm, yyhh) { return `${ff2(n)}-${ff4(ddmm)}-${ff4(yyhh)}`; }
function ffParseRequest(text) {
  const m = /(?:^|\D)(\d{1,4})\s*[-–—\/ ]\s*(\d{4})\s*[-–—\/ ]\s*(\d{4})(?!\d)/.exec(String(text || ''));
  if (!m) return null;
  const n = +m[1];
  const ddmm = +m[2];
  const yyhh = +m[3];
  const day = Math.floor(ddmm / 100);
  const month = ddmm % 100;
  const hour = yyhh % 100;
  if (day < 1 || day > 31 || month < 1 || month > 12 || hour > 23) return null;
  return { n, ddmm, yyhh, day, month, year: 2000 + Math.floor(yyhh / 100), hour };
}
/* The check: (day+month  +  year+hour)  x  (owner number + invitation number), last four digits. */
function ffUnlockPart(n, ddmm, yyhh, tail) { return ff4(((ddmm + yyhh) * (tail + n)) % 10000); }
function ffUnlockCode(n, ddmm, yyhh, tail) { return ffUnlockPart(n, ddmm, yyhh, +tail) + ff4(+tail); }
