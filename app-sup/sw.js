/* ════════════════════════════════════════════════════════════════
   FrioPacking · Centro de Control del Supervisor — Service Worker
   Objetivo: que la app ABRA e INSTALE sin señal (PWA).
   NO toca la lógica de datos: las llamadas a Supabase SIEMPRE van a la
   red (el offline de datos ya lo maneja la cola local `fp_rd_*` de la app).
   Subir la versión (v1 → v2…) al cambiar este archivo para forzar refresco.
   ════════════════════════════════════════════════════════════════ */
const VERSION   = 'fp-sup-v6';   // subir en cada cambio del shell: fuerza refresco del SW
const APP_SHELL = VERSION + '-shell';
const RUNTIME   = VERSION + '-runtime';

// Núcleo que debe estar disponible sin señal.
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/logo-mark.png',
  './assets/logo-light.png',
  './assets/logo-color.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png'
];

// Host de Supabase: NUNCA servir desde caché (datos en vivo).
const SUPABASE_HOST = 'iiceeajjmugtuzcfqggs.supabase.co';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_SHELL);
    // Resiliente: si un recurso falla (404), no aborta toda la instalación.
    await Promise.allSettled(
      PRECACHE.map((u) => cache.add(new Request(u, { cache: 'reload' })))
    );
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                 // POST/PATCH/DELETE → red (la app los maneja)

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // 1) Supabase (REST + Storage): siempre red, sin tocar caché.
  if (url.hostname === SUPABASE_HOST) return;

  // 2) Navegación (el HTML de la app): red primero → cae a caché sin señal.
  //    Ignora el query `?v=timestamp` que el shell agrega al iframe.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(APP_SHELL);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (e) {
        const cache = await caches.open(APP_SHELL);
        return (await cache.match('./index.html'))
            || (await cache.match('./'))
            || Response.error();
      }
    })());
    return;
  }

  // 3) Mismo origen (assets, íconos, manifest): caché primero → red de respaldo.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const cache = await caches.open(RUNTIME);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (e) {
        return cached || Response.error();
      }
    })());
    return;
  }

  // 4) CDN externas (fuentes, jsPDF, pdf.js, xlsx…): stale-while-revalidate.
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME);
    const cached = await cache.match(req);
    const network = fetch(req)
      .then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      })
      .catch(() => cached);
    return cached || network;
  })());
});
