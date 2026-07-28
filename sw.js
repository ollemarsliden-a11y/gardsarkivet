// Cachar bara appens eget skal (HTML/CSS/JS/ikoner) så att den startar snabbt
// och visar något vettigt utan täckning. Dokumenten själva cachas aldrig –
// de innehåller personuppgifter och ska bara finnas i lagringen.
const CACHE = 'marsliden-skal-v3';
const SKAL = ['./', './index.html', './css/style.css', './js/app.js', './js/config.js',
  './icon-192.png', './icon-512.png', './kultsjon.jpg', './manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SKAL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((namn) => Promise.all(namn.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Allt utom appens egna filer går alltid direkt till nätet
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // Nätet först, cachen som reserv – annars får man gamla versioner efter deploy
  e.respondWith(
    fetch(e.request)
      .then((svar) => {
        const kopia = svar.clone();
        caches.open(CACHE).then((c) => c.put(e.request, kopia));
        return svar;
      })
      .catch(() => caches.match(e.request).then((träff) => träff ?? caches.match('./index.html'))),
  );
});
