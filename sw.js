const CACHE_NAME = 'gmao-a2cim-v8'; // On change la version ici pour purger

self.addEventListener('install', (e) => {
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    console.log('[Service Worker] Suppression de l\'ancien cache :', key);
                    return caches.delete(key);
                }
            }));
        })
    );
    self.clients.claim();
});

// Mode réseau d'abord, pour être sûr de toujours lire le code en ligne
self.addEventListener('fetch', (e) => {
    e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
    );
});
