// Minimal service worker — first PWA pass
// No caching: network-only. Safe during active development.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// No fetch handler — all requests go to the network unchanged.
