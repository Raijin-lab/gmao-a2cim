// Incrémente cette version (ex: v2, v3) à chaque fois que tu veux forcer la mise à jour chez tout le monde
const CACHE_NAME = 'gmao-a2cim-v2';

// Installation : Force le nouveau Service Worker à s'activer immédiatement
self.addEventListener('install', (e) => {
    self.skipWaiting();
});

// Activation : Supprime instantanément tous les anciens caches stockés sur les téléphones
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

// Récupération : Réseau d'abord, sinon cache
self.addEventListener('fetch', (e) => {
    e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
    );
});
