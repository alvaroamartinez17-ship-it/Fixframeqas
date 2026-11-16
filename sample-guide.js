/* ============================================================================================================
   sample-guide.js
   What it does:    Makes the 'Sample' guide on the first start, from sample.mp4.
   Change here:     The texts of the sample steps.
   Safe to edit texts here.
   Technical note:  First run: build a marked sample guide from the bundled demo clip so every feature can be
                   tried.
   ============================================================================================================ */
async function createSampleProject() {
  let blob;
  try {
    const r = await fetch('sample.mp4');
    if (!r.ok) return null;
    blob = await r.blob();
    if (!blob.size) return null;
    blob = new Blob([blob], { type: 'video/mp4' });
  } catch (e) { return null; }
  const url = URL.createObjectURL(blob);
  const v = createVideo(url);
  try {
    await videoReady(v);
    await ensureFrameData(v);
    const dur = v.duration;
    const P = newProject({
      title: 'Replace the water filter',
      author: 'Sample guide',
      intro: 'A short demo made from one repair video. Open a step to see its trim, speed and marked-up pictures, then try Export.',
      tools: 'PH1 Phillips screwdriver\nNew filter cartridge\nSmall tray for the screws',
      sample: true,
      createdBy: '',
    });
    const src = newSource(P, { name: 'sample.mp4', type: 'video/mp4', size: blob.size, duration: dur, width: v.videoWidth, height: v.videoHeight });
    P.videos = [src];
    const at = { src: src.id };
    const grab = async (t) => {
      await seekTo(v, t);
      const c = frameCanvas(v, 1920);
      const b = await canvasToBlob(c, 'image/jpeg', 0.92);
      const pic = { id: uid('i'), t, w: c.width, h: c.height, caption: '', shapes: [], rev: uid('r') };
      freeCanvas(c);
      await Store.putBlob('p:' + pic.id, b);
      P.picIds.push(pic.id);
      return pic;
    };
    const p1 = await grab(0.7);
    p1.caption = 'Undo the screws in this order.';
    p1.shapes = [
      { id: uid('a'), type: 'num', x: 0.247, y: 0.175, n: 1, color: '#FFCC00', size: 2 },
      { id: uid('a'), type: 'num', x: 0.655, y: 0.175, n: 2, color: '#FFCC00', size: 2 },
      { id: uid('a'), type: 'num', x: 0.247, y: 0.655, n: 3, color: '#FFCC00', size: 2 },
      { id: uid('a'), type: 'num', x: 0.655, y: 0.655, n: 4, color: '#FFCC00', size: 2 },
      { id: uid('a'), type: 'box', x: 0.80, y: 0.06, text: 'PH1 · 4 screws', color: '#FF3B30', size: 2, tx: 0.718, ty: 0.255 },
    ];
    const p2 = await grab(13.2);
    p2.caption = 'The new cartridge sits flush in the slot.';
    p2.shapes = [
      { id: uid('a'), type: 'rect', x1: 0.325, y1: 0.395, x2: 0.675, y2: 0.605, color: '#FFCC00', size: 2 },
      { id: uid('a'), type: 'arrow', x1: 0.06, y1: 0.50, x2: 0.30, y2: 0.50, color: '#FF3B30', size: 3 },
      { id: uid('a'), type: 'box', x: 0.035, y: 0.08, text: 'Push in until it clicks', color: '#FF3B30', size: 2, tx: 0.33, ty: 0.42 },
    ];
    P.steps = [
      newStep(0.6, 6.3, { ...at, title: 'Remove the four cover screws', desc: 'Undo the screws in the order shown. Keep them in a tray; they are all the same length.', speed: 2, pictures: [p1] }),
      newStep(6.3, 9.0, { ...at, title: 'Lift off the service cover', desc: 'Lift the cover straight up and put it aside.', caution: 'Unplug the machine before you open the cover.' }),
      newStep(9.0, Math.min(dur, 13.6), { ...at, title: 'Swap the filter cartridge', desc: 'Pull the old cartridge out to the left. Slide the new one in until it clicks.', pictures: [p2] }),
    ];
    src.thumbs = (await makeThumbs(url, dur, (item, i, n) => { item.span = dur / n; })) || [];
    P.cover = await PicThumbs.get(p1);
    await Store.putBlob(src.key, blob);
    await Store.saveProject(P);
    return P;
  } finally {
    disposeVideo(v);
    URL.revokeObjectURL(url);
  }
}

async function maybeCreateSample() {
  let flag = null;
  try { flag = localStorage.getItem('ff-sample'); } catch (e) { /* storage blocked */ }
  if (flag) return false;
  let list = [];
  try { list = await Store.listProjects(); } catch (e) { /* ignore */ }
  if (list.length) { try { localStorage.setItem('ff-sample', '1'); } catch (e) { /* ignore */ } return false; }
  const note = $('#projects-empty');
  const text = note.textContent;
  note.textContent = 'Preparing a sample guide…';
  const P = await createSampleProject().catch((e) => { console.warn('Sample guide not created', e); return null; });
  note.textContent = text;
  if (P) { try { localStorage.setItem('ff-sample', '1'); } catch (e) { /* ignore */ } }
  return !!P;
}
