/* Service worker: precaches the app and all quiz content so the installed PWA works offline (spec FR-50). */
const PRECACHE = __PRECACHE__
const CACHE = 'quiz-library-__VERSION__'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('quiz-library-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    // Network first so a new version arrives on the next launch; the cached shell when offline or slow.
    event.respondWith(
      Promise.race([
        fetch(request),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]).catch(() => caches.match('./', { cacheName: CACHE }).then((cached) => cached || Response.error())),
    )
    return
  }
  // Content and assets of this version come from its own cache, so a quiz never mixes two versions.
  event.respondWith(caches.match(request, { cacheName: CACHE }).then((cached) => cached || fetch(request)))
})
