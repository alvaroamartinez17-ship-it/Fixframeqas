/* ============================================================================================================
   export-look.js
   What it does:    Helpers for the export look: dates, 'Step 3 / 12', company and copyright line. The colours and
                   words themselves are in settings.js.
   Change here:     Use settings.js instead.
   Edit with care: change texts and values, not the structure.
   Technical note:  Look of everything Fixframe exports (video cards, PDF, Word), in the style of a premium
                   product page: near-black stage (#0D0D0D), white type, the product (here: the repair) shown on a
                   grey stage, small upper-case labels above large headlines, cards of picture + title + one line,
                   and a footer with company, contact and copyright. No orange: the app keeps its own colours, the
                   exports do not.
   ============================================================================================================ */
// The colours (XT) and the words (XSTR) of the exports are in settings.js.

function xl() { return XSTR[Brand.cfg.lang === 'de' ? 'de' : 'en']; }
function xDate(d) {
  try { return d.toLocaleDateString(xl().locale, { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return d.toISOString().slice(0, 10); }
}
function xStepOf(n, total) { const L = xl(); return `${L.step} ${n} ${L.of} ${total}`; }
function xStepLabel(n, total) { return total ? `${xl().step} ${n} / ${total}` : `${xl().step} ${n}`; }
function xCompany() { return String(Brand.cfg.company || '').trim(); }
function xContactLines() { return lines(Brand.cfg.contact || ''); }
function xClaim() { return String(Brand.cfg.claim || '').trim(); }
function xRights(d) { const c = xCompany(); return c ? xl().rights((d || new Date()).getFullYear(), c) : ''; }
/* First sentence (or the first line) of a text, for one-line card descriptions. */
function xFirstSentence(t, max = 140) {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const m = /^(.+?[.!?])(\s|$)/.exec(s);
  let out = m && m[1].length >= 12 ? m[1] : s;
  if (out.length > max) out = `${out.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
  return out;
}
