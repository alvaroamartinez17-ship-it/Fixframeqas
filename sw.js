/* Fixframe service worker: keeps the app available offline and installs updates only when asked. It never contacts other sites.
   VERSION must be the same as APP_VERSION in settings.js. Raise both with every change you publish:
   only a changed sw.js tells phones and laptops that there is something new. */
const VERSION = '1.9.1';
const CACHE = `fixframe-${VERSION}`;
// FILES-START (this list is written by tools/build.py; add new files here by hand if you edit on GitHub)
const ASSETS = [
  './',
  './Noto-OFL.txt',
  './apple-touch-icon.png',
  './brand-settings.js',
  './codes.js',
  './document-data.js',
  './edit-file.js',
  './editor.js',
  './export-font.js',
  './export-look.js',
  './export-screen.js',
  './fast-video-reader.js',
  './favicon-64.png',
  './fixsound-core.js',
  './fx-font-bold.ttf',
  './fx-font-regular.ttf',
  './guide-data.js',
  './hand-over.js',
  './helpers.js',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './icons.js',
  './index.html',
  './invitation.js',
  './manifest.webmanifest',
  './markup-shapes.js',
  './mp4-writer.js',
  './old-video-converter.js',
  './old-video-tables.js',
  './pdf-export.js',
  './pdf-font-metrics.js',
  './picture-editor.js',
  './pictures.js',
  './qr-engine.js',
  './qr-transfer.js',
  './recorder-fallback.js',
  './sample-guide.js',
  './sample.mp4',
  './settings.js',
  './snd-chime.m4a',
  './snd-jazz1.m4a',
  './snd-lofi1.m4a',
  './snd-std1.m4a',
  './snd-std2.m4a',
  './snd-std3.m4a',
  './snd-std4.m4a',
  './snd-std5.m4a',
  './snd-std6.m4a',
  './snd-std7.m4a',
  './snd-tick.m4a',
  './sound-export.js',
  './start-screen.js',
  './start.js',
  './step-bg.jpg',
  './storage.js',
  './style.css',
  './timeline.js',
  './updates.js',
  './video-files.js',
  './video-render.js',
  './word-export.js',
];
// FILES-END

/* Browsers look at sw.js by themselves from time to time. Such a check must not download or install anything:
   a new version installs only on the first visit, or when the app asked for it ("Check for updates" in Settings
   writes a short-lived flag). Versions before 1.5.2 cannot write the flag, so updates from them are let through. */
const older = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); }
  return false;
};
async function installAllowed() {
  const keys = (await caches.keys()).filter((k) => /^fixframe-\d/.test(k) && k !== CACHE);
  if (!keys.length) return true;
  if (keys.some((k) => older(k.slice(9), '1.5.2'))) return true;
  try {
    const flags = await caches.open('fixframe-flags');
    const r = await flags.match('./update-ok');
    if (r) {
      const at = +(await r.text());
      await flags.delete('./update-ok');
      if (Date.now() - at < 10 * 60000) return true;
    }
  } catch (e) { /* no flag */ }
  return false;
}
self.addEventListener('install', (event) => {
  // No skipWaiting(): a new version waits until the user taps "Install update".
  event.waitUntil((async () => {
    if (!(await installAllowed())) throw new Error('Update not requested');
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('fixframe-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'SKIP_WAITING') self.skipWaiting();
  if (msg.type === 'GET_VERSION' && event.ports && event.ports[0]) event.ports[0].postMessage({ version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('./index.html', { ignoreSearch: true }).then((r) => r || fetch(req)));
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
});
