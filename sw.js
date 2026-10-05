const CACHE_NAME = 'gmao-a2cim-v1';

// Installation du Service Worker
self.addEventListener('install', (e) => {
    console.log('[Service Worker] Installation terminée');
    self.skipWaiting();
});

// Intercepter les requêtes pour le mode hors-ligne
self.addEventListener('fetch', (e) => {
    // Pour l'instant, on laisse passer le réseau normal pour faciliter les tests
});