/* Service Worker — محاسبة النفس
 * الشبكة أولًا، ثم النسخة المحلية عند انقطاع الاتصال.
 * لا تُخزَّن استجابات الأخطاء، ولا تُعترض الطلبات غير GET.
 */
'use strict';

const CACHE_VERSION = 'muhasabat-shell-v5';
const RUNTIME_CACHE = 'muhasabat-runtime-v5';
const SCOPE_URL = self.registration.scope;
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
].map(path => new URL(path, SCOPE_URL).href);
const INDEX_URL = new URL('./index.html', SCOPE_URL).href;
const HOME_URL = new URL('./', SCOPE_URL).href;
const EXTERNAL_CACHE_HOSTS = new Set([
  'cdn.tailwindcss.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
]);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // فشل مورد اختياري لا يمنع تثبيت عامل الخدمة.
    await Promise.all(SHELL.map(async url => {
      try {
        const response = await fetch(url, { cache: 'reload' });
        if (response.ok) await cache.put(url, response.clone());
      } catch (_) { /* تتم إعادة المحاولة عند الاتصال */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith('muhasabat-') && name !== CACHE_VERSION && name !== RUNTIME_CACHE)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    if (!EXTERNAL_CACHE_HOSTS.has(url.hostname)) return;
    const update = (async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const response = await fetch(request);
      if (response && (response.ok || response.type === 'opaque')) {
        await cache.put(request, response.clone());
      }
      return response;
    })();
    // الانتظار مهم حتى لا يُلغى تحديث ذاكرة CDN المؤقتة بعد الرد.
    event.waitUntil(update.then(() => undefined).catch(() => undefined));
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      try { return await update; }
      catch (_) { return new Response('', { status: 503, statusText: 'Offline' }); }
    })());
    return;
  }

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
          '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>غير متصل</title><body style="font-family:sans-serif;padding:2rem"><h1>التطبيق غير متاح دون اتصال</h1><p>افتح التطبيق مرة واحدة أثناء الاتصال بالإنترنت حتى تُخزَّن النسخة المحلية.</p></body></html>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  event.respondWith(networkFirst(request, CACHE_VERSION).catch(() =>
    new Response('تعذّر تحميل المورد دون اتصال.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    })
  ));
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