// sw.js — VexaProxy Service Worker
// Intercepts every fetch made by a proxied page and routes it through /proxy?url=

const PROXY_PREFIX = '/proxy?url=';
let currentOrigin = null;
let currentBase   = null;

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SET_CONTEXT') {
    currentOrigin = e.data.origin; // e.g. "https://www.crazygames.com"
    currentBase   = e.data.base;   // e.g. "https://www.crazygames.com/some/path"
  }
});

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = req.url;

  // Never intercept requests already going to our proxy endpoint
  if (url.includes(PROXY_PREFIX)) return;

  // Never intercept our own static files (sw.js, bootstrap, index.html, etc.)
  if (url.startsWith(self.location.origin + '/') &&
      !url.startsWith(self.location.origin + '/proxy')) return;

  // Intercept absolute external URLs
  if (/^https?:\/\//.test(url) && !url.startsWith(self.location.origin)) {
    event.respondWith(proxyFetch(url, req));
    return;
  }

  // Intercept relative-path requests that belong to the proxied origin
  // (e.g. a page does fetch('/api/data') which resolves to our origin)
  if (currentBase && url.startsWith(self.location.origin + '/') &&
      !url.startsWith(self.location.origin + '/proxy') &&
      !url.startsWith(self.location.origin + '/sw.js') &&
      !url.startsWith(self.location.origin + '/proxy-bootstrap.js')) {
    const path = url.slice(self.location.origin.length);
    try {
      const absolute = new URL(path, currentBase).href;
      event.respondWith(proxyFetch(absolute, req));
    } catch (e) {}
  }
});

function proxyFetch(targetUrl, req) {
  const proxied = self.location.origin + PROXY_PREFIX + encodeURIComponent(targetUrl);
  return fetch(proxied, {
    method:      req.method,
    headers:     sanitizeHeaders(req.headers),
    body:        req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
    redirect:    'follow',
    credentials: 'omit',
  }).catch(() => new Response('Proxy fetch failed', { status: 502 }));
}

function sanitizeHeaders(headers) {
  const out = new Headers();
  const blocked = new Set(['cookie','authorization','x-forwarded-for','x-real-ip','origin','referer']);
  for (const [k, v] of headers.entries()) {
    if (!blocked.has(k.toLowerCase())) out.set(k, v);
  }
  return out;
}
