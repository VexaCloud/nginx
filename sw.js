// sw.js — VexaProxy Service Worker
const PROXY_PREFIX = '/proxy?url=';
let currentOrigin = null;
let currentBase = null;

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SET_CONTEXT') {
    currentOrigin = e.data.origin;
    currentBase = e.data.base;
  }
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = req.url;

  // Skip our own proxy requests and static files
  if (url.includes(PROXY_PREFIX) ||
      url.startsWith(self.location.origin + '/sw.js') ||
      url.startsWith(self.location.origin + '/proxy-bootstrap.js')) {
    return;
  }

  // Absolute external URLs
  if (/^https?:\/\//.test(url) && !url.startsWith(self.location.origin)) {
    event.respondWith(proxyFetch(url, req));
    return;
  }

  // Relative URLs that should belong to the proxied site
  if (currentBase && url.startsWith(self.location.origin + '/')) {
    const path = url.slice(self.location.origin.length);
    if (path && !path.startsWith('/proxy')) {
      try {
        const absolute = new URL(path, currentBase).href;
        event.respondWith(proxyFetch(absolute, req));
        return;
      } catch (e) {}
    }
  }
});

function proxyFetch(targetUrl, req) {
  const proxied = self.location.origin + PROXY_PREFIX + encodeURIComponent(targetUrl);
  return fetch(proxied, {
    method: req.method,
    headers: sanitizeHeaders(req.headers),
    body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
    redirect: 'follow',
    credentials: 'omit',
  }).catch(() => new Response('Proxy fetch failed', { status: 502 }));
}

function sanitizeHeaders(headers) {
  const out = new Headers();
  const blocked = new Set(['cookie', 'authorization', 'x-forwarded-for', 'x-real-ip', 'origin', 'referer']);
  for (const [k, v] of headers.entries()) {
    if (!blocked.has(k.toLowerCase())) out.set(k, v);
  }
  return out;
}
