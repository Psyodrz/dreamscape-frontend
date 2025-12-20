const CACHE_NAME = 'dreamscape-maze-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/styles.css',
  '/assets/logo.png',
  '/assets/icon.png'
  // Add other critical assets here
];

// Install Event - Cache Files
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installed');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching App Shell');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  // Force activation immediately for faster updates
  self.skipWaiting(); 
});

// Activate Event - Clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activated');
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          console.log('[Service Worker] Removing Old Cache', key);
          return caches.delete(key);
        }
      }));
    })
  );
  // Take control of all clients immediately
  return self.clients.claim();
});

// Fetch Event - Network First, then Cache (for real-time updates)
self.addEventListener('fetch', (event) => {
  // Only handle http and https requests
  if (!event.request.url.startsWith('http')) {
    return;
  }

  // Navigation requests: Network first, fall back to cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          return caches.match(event.request);
        })
    );
    return;
  }

  // Asset requests: Stale-while-revalidate (fast load, then update cache)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        // Cache the new response
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      });
      // Return cached response if available, otherwise wait for network
      return cachedResponse || fetchPromise;
    })
  );
});

// Message Event - Listen for 'SKIP_WAITING'
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
