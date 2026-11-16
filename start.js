/* ============================================================================================================
   start.js
   What it does:    Starts the app: connects the buttons to what they do, opens the start screen, handles dropped
                   files.
   Change here:     Which button does what (look for addEventListener).
   Edit with care: change texts and values, not the structure.
   Technical note:  Wiring.
   ============================================================================================================ */
function bindEditor() {
  const v = vid();
  v.addEventListener('play', () => { setIcon($('#tp-play'), 'pause'); $('#tp-play').setAttribute('aria-label', 'Pause'); });
  v.addEventListener('pause', () => {
    setIcon($('#tp-play'), 'play');
    $('#tp-play').setAttribute('aria-label', 'Play');
    if (E.P && !Scrub.busy) { E.t = v.currentTime; TL.setTime(E.t); updateTimeUI(); }
  });
  v.addEventListener('click', () => togglePlay());
  $('#tp-play').addEventListener('click', () => togglePlay());
  $('#tp-back1').addEventListener('click', () => nudge(-1));
  $('#tp-fwd1').addEventListener('click', () => nudge(1));
  $('#tp-prevf').addEventListener('click', () => nudge(-1 / E.fps));
  $('#tp-nextf').addEventListener('click', () => nudge(1 / E.fps));
  $('#act-split').addEventListener('click', () => splitHere());
  $('#act-start').addEventListener('click', () => setEdge('start'));
  $('#act-end').addEventListener('click', () => setEdge('end'));
  $('#act-capture').addEventListener('click', () => capturePicture());
  $('#ed-back').addEventListener('click', () => closeEditor(false));
  $('#ed-title').addEventListener('click', () => renameGuide());
  $('#ed-undo').addEventListener('click', () => undo());
  $('#ed-redo').addEventListener('click', () => redo());
  $('#ed-export').addEventListener('click', () => Exporter.open());
  $('#btn-play-all').addEventListener('click', () => playAll());
  $('#btn-add-step').addEventListener('click', () => addStepHere());
  $('#tab-steps').addEventListener('click', () => selectTab('steps'));
  $('#tab-guide').addEventListener('click', () => selectTab('guide'));
  for (const k of ['title', 'author', 'intro', 'tools']) {
    $(`#g-${k}`).addEventListener('input', (e) => {
      if (!E.P) return;
      E.P[k] = e.target.value;
      if (k === 'title') $('#ed-title').textContent = E.P.title || 'Untitled guide';
      saveSoon();
    });
  }
  const ed = $('#editor');
  const typingField = (el) => !!el && el.matches && el.matches('input[type="text"], textarea') && ed.contains(el) && !$('#stage').contains(el);
  ed.addEventListener('focusin', (e) => { if (typingField(e.target)) { Play.stop(); ed.classList.add('typing'); } });
  ed.addEventListener('focusout', () => setTimeout(() => { if (!typingField(document.activeElement)) ed.classList.remove('typing'); }, 80));
  if (window.ResizeObserver) new ResizeObserver(() => updateStageHeight()).observe($('#stage'));
  document.addEventListener('keydown', (e) => {
    if (!E.P || $('#editor').hidden || !$('#piced').hidden || !$('#exporter').hidden || $('#modal-root').children.length) return;
    if (/input|textarea|select/i.test((document.activeElement || {}).tagName || '')) return;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(e.shiftKey ? -1 : -1 / E.fps); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(e.shiftKey ? 1 : 1 / E.fps); }
    else if (e.key === 's' || e.key === 'S') splitHere();
    else if (e.key === 'i' || e.key === 'I') setEdge('start');
    else if (e.key === 'o' || e.key === 'O') setEdge('end');
    else if (e.key === 'p' || e.key === 'P') capturePicture();
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && E.P) { Play.stop(); saveNow(); } });
  window.addEventListener('pagehide', () => { if (E.P) saveNow(); });
}

/* Laptop: drop videos (new guide) or a .fixframe.json (open edit file) on the start screen. */
function bindDrop() {
  const zone = $('#drop-zone');
  let depth = 0;
  const homeOpen = () => !$('#home').hidden && !$('#modal-root').children.length && !$('#gate');
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  document.addEventListener('dragenter', (e) => { if (!hasFiles(e) || !homeOpen()) return; depth++; zone.classList.add('on'); });
  document.addEventListener('dragleave', () => { if (depth && --depth === 0) zone.classList.remove('on'); });
  document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    zone.classList.remove('on');
    if (!homeOpen()) return;
    const files = Array.from(e.dataTransfer.files || []);
    const json = files.find((f) => /\.json$/i.test(f.name) || f.type === 'application/json');
    const videos = files.filter((f) => f.type ? /^video\//.test(f.type) || isVideoFile(f) && !/^image\//.test(f.type) : isVideoFile(f));
    if (json) openEditFileFlow(json);
    else if (videos.length) newProjectFromFiles(videos);
    else toast('Drop video files or a Fixframe edit file.', 'err');
  });
}

async function main() {
  // fixed texts from settings.js into the page
  for (const el of document.querySelectorAll('[data-text]')) el.textContent = TEXTS[el.dataset.text] || '';
  fillIcons();
  bindEditor();
  TL.init();
  PicEditor.init();
  Exporter.init();
  window.addEventListener('popstate', () => Nav.onPopState());
  $('#btn-new').addEventListener('click', () => $('#file-video').click());
  $('#file-video').addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) newProjectFromFiles(files);
  });
  $('#btn-open-edit').addEventListener('click', () => openEditFileFlow());
  $('#btn-scan-qr').addEventListener('click', () => scanEditQr());
  $('#btn-settings').addEventListener('click', () => openSettings());
  $('#btn-update-now').addEventListener('click', () => PWA.apply());
  DownloadsCap.get();
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitViewport);
    window.visualViewport.addEventListener('scroll', fitViewport);
  }
  await App.load();
  await Brand.load();
  bindDrop();
  XFont.load(); // export font, loaded in the background; exports wait for it
  PWA.init();
  await Access.start();
  await renderHome();
  if (await maybeCreateSample()) renderHome();
}
window.__ff = { E, Store, TL, PicEditor, Exporter, PWA, Brand, App, Access, XFont };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main); else main();
