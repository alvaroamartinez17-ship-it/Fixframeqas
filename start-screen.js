/* ============================================================================================================
   start-screen.js
   What it does:    The start screen (list of guides, new guide, open or scan an edit file) and the Settings sheet.
   Change here:     Texts on the start screen and in Settings.
   Safe to edit texts here.
   Technical note:  Home screen: guide list, new guide from videos, settings with name, updates and reset.
   ============================================================================================================ */
function showView(name) {
  $('#home').hidden = name !== 'home';
  $('#editor').hidden = name !== 'editor';
  window.scrollTo(0, 0);
}

function guessTitle(fileName) {
  const base = String(fileName || '').replace(/\.[^.]+$/, '').trim();
  if (!base || /^(IMG|VID|PXL|MOV|DSC|GOPR|DJI|MVI|VIDEO|RPReplay|Screen ?Recording)[\s_-]*\d/i.test(base) || /^\d{6,}/.test(base)) return 'New repair guide';
  return base.replace(/[_]+/g, ' ').slice(0, 80);
}

async function loadProjects() {
  const list = await Store.listProjects();
  return list.map(migrateProject);
}

async function renderHome() {
  let list = [];
  try { list = await loadProjects(); } catch (e) { toast(storageErrorText(e), 'err'); }
  list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const ul = $('#projects');
  ul.textContent = '';
  for (const P of list) ul.append(projectCard(P));
  $('#projects-empty').hidden = list.length > 0;
  $('#proj-count').textContent = list.length ? String(list.length) : '';
  $('#intro-card').hidden = list.some((p) => !p.sample);
  updateStorageLine();
}

function projectThumb(P) {
  if (P.cover) return P.cover;
  const th = (P.videos[0] && P.videos[0].thumbs) || [];
  return th.length ? th[Math.floor(th.length / 3)].src : '';
}

function projectCard(P) {
  const nPics = P.steps.reduce((a, s) => a + s.pictures.length, 0);
  const thumb = projectThumb(P);
  const nVid = P.videos.length;
  const footage = nVid > 1 ? `${nVid} videos · ${fmtDur(totalVideoDur(P))}` : `${fmtDur(totalVideoDur(P))} video`;
  return h('li', { class: 'proj' },
    h('button', { class: 'proj-main', type: 'button', onClick: () => openProjectById(P.id) },
      h('span', { class: 'proj-thumb', style: { backgroundImage: thumb ? `url("${thumb}")` : '' } }),
      h('span', { class: 'proj-meta' },
        h('span', { class: 'proj-title' }, P.sample ? h('span', { class: 'tag-sample' }, 'Sample') : null, P.title || 'Untitled guide'),
        h('span', { class: 'proj-sub' }, `${plural(P.steps.length, 'step')} · ${plural(nPics, 'picture')}${P.from ? ` · from ${P.from}` : ''}`),
        h('span', { class: 'proj-sub' }, `${footage} · ${fmtDate(P.updatedAt)}`))),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Delete ${P.title || 'guide'}`, onClick: () => deleteProjectFlow(P) }, icon('trash')));
}

async function deleteProjectFlow(P) {
  const ok = await ask({
    title: `Delete “${P.title || 'Untitled guide'}”?`,
    message: `Fixframe removes its copy of the ${P.videos.length > 1 ? 'videos' : 'video'}, the pictures and the steps of this guide. Your original video ${P.videos.length > 1 ? 'files' : 'file'} and files you already exported are not affected.`,
    ok: 'Delete guide', danger: true,
  });
  if (!ok) return;
  try { await Store.deleteProject(P); toast('Guide deleted'); } catch (e) { toast(storageErrorText(e), 'err'); }
  renderHome();
}

async function updateStorageLine() {
  const el = $('#storage-line');
  const persistent = await Store.isPersistent();
  if (!persistent) { el.textContent = 'This browser view cannot keep data. Guides last only until you close it.'; return; }
  const est = await storageEstimate();
  el.textContent = est && est.usage != null
    ? `Stored locally in this browser · ${fmtBytes(est.usage)} used`
    : 'Stored locally in this browser';
}

async function openProjectById(id) {
  const b = busy('Opening guide…');
  try {
    const P = await Store.getProject(id);
    b.close();
    if (!P) { toast('This guide could not be found.', 'err'); renderHome(); return; }
    await openEditor(P);
  } catch (e) { b.close(); toast(storageErrorText(e), 'err'); }
}

/* A new guide from one or several videos; each video starts as one step. */
async function newProjectFromFiles(files) {
  const vids = files.filter(isVideoFile);
  if (!vids.length) { toast('Please choose a video file.', 'err'); return; }
  const b = busy('Reading video…');
  const P = newProject({ title: guessTitle(vids[0].name) });
  addHistory(P, 'created');
  const urls = {};
  let unreadable = 0;
  let why = '';
  const undo = async () => {
    Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
    try { await Store.delBlobs(P.videos.map((v) => v.key)); } catch (e) { /* nothing more to do */ }
  };
  try {
    for (let i = 0; i < vids.length; i++) {
      b.set(vids.length > 1 ? `Saving video ${i + 1} of ${vids.length} in the app…` : `Saving video in the app (${fmtBytes(vids[i].size)})…`);
      try {
        const r = await ingestVideo(P, vids[i], (t) => b.set(vids.length > 1 ? `Video ${i + 1} of ${vids.length}: ${t}` : t));
        P.videos.push(r.src);
        urls[r.src.id] = r.url;
        P.steps.push(newStep(0, r.src.duration, { src: r.src.id }));
      } catch (e) {
        if (!(e && e.unplayable)) throw e;
        unreadable++;
        why = e.userMsg || why;
      }
    }
    if (!P.videos.length) {
      b.close();
      toast(why || 'This video cannot be played in this browser. MP4 or MOV (H.264 or HEVC) works best.', 'err', 9000);
      return;
    }
    await Store.saveProject(P);
  } catch (e) {
    b.close();
    await undo();
    toast(storageErrorText(e), 'err', 7000);
    return;
  }
  requestPersist();
  b.close();
  await openEditor(P, urls);
  if (unreadable) toast((unreadable === 1 ? 'One video was left out. ' : `${unreadable} videos were left out. `) + (why || 'They cannot be played in this browser.'), 'err', 9000);
  else toast(P.videos.length > 1 ? 'Each video starts as one step. Tap “Split here” where a new step begins.' : 'Play the video and tap “Split here” where each step begins.', '', 4500);
}

/* ---------- settings ---------- */
async function openSettings() {
  const status = h('div', { class: 'set-status' });
  const check = h('button', { class: 'btn small', type: 'button' }, icon('refresh'), 'Check for updates');
  const install = h('button', { class: 'btn small accent', type: 'button', hidden: !(PWA.reg && PWA.reg.waiting) }, 'Install update');
  check.addEventListener('click', async () => {
    status.textContent = 'Checking…';
    const r = await PWA.check();
    install.hidden = r !== 'available';
    status.textContent = {
      available: `Version ${PWA.waitingVersion || 'update'} is ready. Install it now; your guides stay as they are.`,
      current: `You have the latest version (${APP_VERSION}).`,
      offline: 'No connection right now. Try again when you are online.',
      unsupported: 'Updates work in the app installed from your website.',
    }[r] || '';
  });
  install.addEventListener('click', () => PWA.apply());
  if (PWA.reg && PWA.reg.waiting) status.textContent = `Version ${PWA.waitingVersion || 'update'} is ready to install.`;

  const store = h('p', null, 'Checking storage…');
  const persist = h('p', null, '');
  (async () => {
    const persistent = await Store.isPersistent();
    const est = await storageEstimate();
    if (!persistent) store.textContent = 'This view cannot keep data, so guides are only kept until it closes.';
    else store.textContent = est && est.usage != null
      ? `Fixframe uses ${fmtBytes(est.usage)}${est.quota ? ` of about ${fmtBytes(est.quota)} available to it` : ''} in this browser.`
      : 'Guides are stored locally in this browser.';
    let kept = false;
    try { kept = !!(navigator.storage && navigator.storage.persisted && (await navigator.storage.persisted())); } catch (e) { /* ignore */ }
    persist.textContent = kept ? 'Storage is protected from automatic clean-up.' : (IS_STANDALONE ? '' : 'Tip: install Fixframe on the home screen so the browser does not clean up its storage.');
  })();

  const saveName = debounce(() => App.save(), 400);
  const name = h('input', { type: 'text', id: 'set-name', class: 'dlg-input', maxlength: '60', placeholder: 'Your name', autocomplete: 'name', enterkeyhint: 'done' });
  name.value = App.cfg.userName || '';
  name.addEventListener('input', () => { App.cfg.userName = name.value.trim(); saveName(); });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });

  const wipe = h('button', { class: 'btn danger-ghost', type: 'button' }, icon('trash'), 'Delete all guides and reset');
  let m = null;
  const sections = [
    h('div', { class: 'set-section' },
      h('h4', null, 'Your name'), name,
      h('p', null, 'Written into the guides you start and the edit files you create, so others can see who made them. Saved in this browser.')),
    h('div', { class: 'set-section' }, h('h4', null, 'Privacy'), h('p', { id: 'set-privacy' }, TEXTS.privacy)),
    Access.settingsSection(() => m.close()),
    h('div', { class: 'set-section' },
      h('h4', null, 'Version'),
      h('div', { class: 'set-row' }, h('span', null, IS_STANDALONE ? 'Installed app' : 'Running in the browser'), h('span', { class: 'set-val' }, APP_VERSION))),
  ];
  if (PWA.supported()) {
    sections.push(h('div', { class: 'set-section' }, h('h4', null, 'Updates'), h('div', { class: 'set-row' }, check, install), status));
  } else {
    sections.push(h('div', { class: 'set-section' }, h('h4', null, 'Updates'),
      h('p', null, 'Updates install from the Fixframe website once the app is added to your home screen.')));
  }
  const brandBtn = h('button', { class: 'btn small', type: 'button' }, 'Open brand settings');
  sections.push(h('div', { class: 'set-section' }, h('h4', null, 'Brand & safety'),
    h('p', null, 'Logo watermark, background picture for the cards, brand intro, safety instructions and closing video. Used in every guide.'), brandBtn));
  sections.push(h('div', { class: 'set-section' }, h('h4', null, 'Storage'), store, persist));
  if (!IS_STANDALONE && !IS_FRAMED) {
    sections.push(h('div', { class: 'set-section' }, h('h4', null, 'Install'),
      h('p', null, IS_IOS
        ? 'In Safari, tap Share, then “Add to Home Screen”. The installed app keeps its own guides, separate from Safari.'
        : 'In Chrome, open the ⋮ menu and choose “Install app” or “Add to Home screen”.')));
  }
  sections.push(h('div', { class: 'set-section' }, h('h4', null, 'Reset'),
    h('p', null, 'Removes every guide, video and picture, plus the offline copy of the app.'), wipe));
  m = Modal.open(h('div', { class: 'dlg' }, sections), { full: true, title: 'Settings', onClose: () => saveName.flush() });
  wipe.addEventListener('click', () => { m.close(); wipeEverything(); });
  brandBtn.addEventListener('click', () => { m.close(); openBrandSettings(); });
}

async function wipeEverything() {
  const ok = await ask({
    title: 'Delete all guides and reset Fixframe?',
    message: 'This removes every video, picture and guide that Fixframe stored in this browser, your name and brand settings, and the offline copy of the app. It cannot be undone.' + (Access.cfg && Access.cfg.gate ? ' You will need your invitation code again.' : ''),
    ok: 'Delete everything', danger: true,
  });
  if (!ok) return;
  const b = busy('Deleting all data…');
  try { if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistrations) { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map((r) => r.unregister())); } } catch (e) { /* ignore */ }
  try { if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); } } catch (e) { /* ignore */ }
  await Store.wipe();
  try { localStorage.clear(); } catch (e) { /* ignore */ }
  try { sessionStorage.clear(); } catch (e) { /* ignore */ }
  b.close();
  Access.dropGate();
  $('#app').replaceChildren(h('div', { class: 'reset-screen' },
    h('h1', null, 'Fixframe is reset'),
    h('p', null, 'Fixframe removed the guides, videos and pictures it stored in this browser. Files you saved or shared before are not affected.'),
    h('p', null, IS_IOS
      ? 'To remove the app icon too, touch and hold it on the home screen and choose “Remove App”.'
      : 'To remove the app icon too, touch and hold it and choose “Uninstall” or “Remove”.'),
    h('button', { class: 'btn primary', type: 'button', onClick: () => location.reload() }, 'Start again')));
}
