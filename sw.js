// GMAO A2CIM - Service Worker
// Incrémenter VERSION à chaque déploiement pour renouveler les caches.
const VERSION = 'v42';
const SHELL_CACHE = `gmao-shell-${VERSION}`;
const CDN_CACHE = `gmao-cdn-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './firebase-init.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Hôtes de bibliothèques (Tailwind, FontAwesome, FullCalendar, Tesseract, SDK Firebase, polices)
const CDN_HOSTS = [
  'cdn.tailwindcss.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'www.gstatic.com'
];

// Jamais interceptés : Firestore gère lui-même son cache hors-ligne, et l'auth ne doit pas être mise en cache.
const BYPASS_HOSTS = new Set([
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseappcheck.googleapis.com',
  'www.google.com',
  'www.recaptcha.net'
]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // allSettled : un fichier manquant (ex. icône) ne bloque pas l'installation
      Promise.allSettled(SHELL.map((url) => cache.add(url)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== CDN_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function isCacheable(res) {
  return res && (res.ok || res.type === 'opaque');
}

// Réseau d'abord, cache en secours (fichiers de l'application : toujours à jour si en ligne)
async function networkFirst(request, isNavigation) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (isNavigation) {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return new Response('Hors-ligne', { status: 503, statusText: 'Offline' });
  }
}

// Cache d'abord + mise à jour en arrière-plan (bibliothèques externes)
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CDN_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => { if (isCacheable(res)) cache.put(request, res.clone()); return res; })
    .catch(() => null);
  return cached || (await network) || new Response('', { status: 504 });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (BYPASS_HOSTS.has(url.hostname)) return;

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, req.mode === 'navigate'));
  } else if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req));
  }
});
