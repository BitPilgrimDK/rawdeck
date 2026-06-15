const CACHE_NAME = 'rawdeck-v2-cache';
const ASSETS = [
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './radio1.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  // Exclude live audio streams and media files from Service Worker interception.
  // This prevents the browser from killing the service worker thread after 29 seconds.
  if (
    e.request.destination === 'audio' || 
    e.request.url.includes('.mp3') || 
    e.request.url.includes('.ogg') || 
    e.request.url.includes('.aac') || 
    e.request.url.includes('.m4a') || 
    e.request.url.includes('.flac') || 
    e.request.url.includes('.wav')
  ) {
    return; // Pass through natively to the browser network layer
  }

  e.respondWith(
    caches.match(e.request).then((response) => response || fetch(e.request))
  );
});