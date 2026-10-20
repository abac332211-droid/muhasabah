/* Service Worker — محاسبة النفس
 * إصدار v7.3 — دعم الأوفلاين التام + cache-first للأصول (أداء فوري)
 */
'use strict';

const CACHE_VERSION = 'muhasabat-shell-v7.3';
const SCOPE_URL = self.registration.scope;

/* الأصول الداخلية للتطبيق (Shell) */
const SHELL = [
  './',
  './index.html',
  './tailwind.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
].map(path => new URL(path, SCOPE_URL).href);

/* خطوط جوجل الخارجية (اختيارية وتُخزن عند توفر الإنترنت) */
const GOOGLE_FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Cairo:wght@300;400;600;700&display=swap';

const INDEX_URL = new URL('./index.html', SCOPE_URL).href;
const HOME_URL = new URL('./', SCOPE_URL).href;

const EXTERNAL_CACHE_HOSTS = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com'
]);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);

    /* 1) تخزين ملفات التطبيق الأساسية (أوفلاين محلي 100%) */
    await Promise.all(SHELL.map(async url => {
      try {
        const r = await fetch(url, { cache: 'reload' });
        if (r.ok) await cache.put(url, r.clone());
      } catch (_) { /* تجاهل */ }
    }));

    /* 2) استباق تخزين الخطوط الخارجية إذا وُجد إنترنت */
    try {
      const r = await fetch(GOOGLE_FONTS_CSS, { mode: 'cors' });
      if (r.ok) {
        await cache.put(GOOGLE_FONTS_CSS, r.clone());
        const css = await r.clone().text();
        const matches = css.match(/https:\/\/fonts\.gstatic\.com\/[^)'"\s]+/g) || [];
        const uniqueUrls = Array.from(new Set(matches));
        await Promise.all(uniqueUrls.map(async fontUrl => {
          try {
            const fr = await fetch(fontUrl, { mode: 'cors' });
            if (fr.ok) await cache.put(fontUrl, fr.clone());
          } catch (_) { /* تجاهل */ }
        }));
      }
    } catch (_) { /* إن لم يتوفر إنترنت سيعتمد على خطوط النظام */ }

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith('muhasabat-') && name !== CACHE_VERSION)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

/* Cache-First: للأصول الثابتة (CSS، أيقونات، manifest، خطوط) */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  /* 1) التنقل (HTML) — Network-First: دائمًا أحدث نسخة */
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const contentType = response.headers.get('content-type') || '';
        if (response.ok && contentType.toLowerCase().includes('text/html')) {
          const cache = await caches.open(CACHE_VERSION);
          await cache.put(INDEX_URL, response.clone());
        }
        return response;
      } catch (_) {
        const cached = await caches.match(request) || await caches.match(HOME_URL) || await caches.match(INDEX_URL);
        if (cached) return cached;
        return new Response(
          '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>غير متصل</title><body style="font-family:sans-serif;padding:2rem;text-align:center;direction:rtl"><h1>التطبيق غير متاح دون اتصال</h1><p>افتح التطبيق مرة واحدة أثناء الاتصال بالإنترنت حتى تُخزَّن النسخة المحلية.</p></body></html>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  /* 2) المصادر الخارجية (الخطوط) — Cache-First */
  if (url.origin !== self.location.origin) {
    if (!EXTERNAL_CACHE_HOSTS.has(url.hostname)) return;
    event.respondWith(cacheFirst(request, CACHE_VERSION));
    return;
  }

  /* 3) الأصول الداخلية الثابتة (CSS، أيقونات، manifest) — Cache-First */
  event.respondWith(cacheFirst(request, CACHE_VERSION));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) return client.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(HOME_URL);
  })());
});
