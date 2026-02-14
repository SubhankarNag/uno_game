// UNO Online — Service Worker
const CACHE_VERSION = 4;
const CACHE_NAME = 'uno-game-v' + CACHE_VERSION;
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './game.html',
    './css/style.css',
    './css/game.css',
    './css/cards.css',
    './js/app.js',
    './js/game.js',
    './js/game-engine.js',
    './js/firebase-sync.js',
    './js/firebase-config.js',
    './js/sounds.js',
    './manifest.json',
];

// Install — cache core assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// Fetch — network first for API/Firebase, cache first for static assets
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip Firebase and external API requests — always go to network
    if (url.hostname.includes('firebaseio.com') ||
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('gstatic.com') ||
        url.hostname.includes('google.com') ||
        url.hostname.includes('fonts.googleapis.com') ||
        url.hostname.includes('fonts.gstatic.com')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cached) => {
            // Return cached version immediately, update cache in background (stale-while-revalidate)
            const fetchPromise = fetch(event.request, { cache: 'no-cache' }).then((response) => {
                if (response && response.status === 200 && response.type === 'basic') {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            }).catch(() => cached);

            return cached || fetchPromise;
        })
    );
});
