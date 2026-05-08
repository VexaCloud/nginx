// sw.js — VexaProxy Service Worker
const PROXY_PATH = '/proxy?url=';
let currentOrigin = null;
let currentBase   = null;

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SET_CONTEXT') {
    currentOrigin = e.data.origin;
    currentBase   = e.data.base;
  }
});

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const OWN_FILES = new Set(['/sw.js', '/proxy-bootstrap.js', '/index.html', '/health']);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const path = url.pathname;

  if (url.origin === self.location.origin) {
    if (OWN_FILES.has(path) || path.startsWith('/proxy')) return;

    if (currentBase) {
      try {
        const absolute = new URL(path + url.search, currentBase).href;
        if (!absolute.startsWith(self.location.origin)) {
          event.respondWith(proxyFetch(absolute, req));
          return;
        }
      } catch(e) {}
    }
    return;
  }

  event.respondWith(proxyFetch(req.url, req));
});

function proxyFetch(targetUrl, req) {
  let clean = targetUrl;
  try {
    let prev = clean;
    while (true) {
      const d = decodeURIComponent(prev);
      if (d === prev || !/^https?:\/\//i.test(d)) break;
      prev = d;
    }
    clean = prev;
  } catch(e) {}

  const proxied = self.location.origin + PROXY_PATH + encodeURIComponent(clean);

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
