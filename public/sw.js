// Basic Service Worker to fulfill PWA requirements
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Install');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activate');
});

self.addEventListener('fetch', (event) => {
  // Let the browser handle fetch
});
