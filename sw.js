// sw.js — VexaProxy Service Worker
const PROXY_PATH = '/proxy?url=';

// Store context per-client so we don't rely on async postMessage
const clientContexts = new Map();

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SET_CONTEXT' && e.source) {
    clientContexts.set(e.source.id, {
      origin: e.data.origin,
      base:   e.data.base,
    });
  }
});

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const OWN_PATHS = ['/sw.js', '/proxy-bootstrap.js', '/index.html', '/health'];

self.addEventListener('fetch', (event) => {
  const req  = event.request;
  const url  = new URL(req.url);
  const path = url.pathname;

  // Never touch our own static files
  if (OWN_PATHS.includes(path)) return;

  // Already a proxied request — let it through
  if (path.startsWith('/proxy')) return;

  // External absolute URL — proxy it directly
  if (url.origin !== self.location.origin) {
    event.respondWith(proxyFetch(req.url, req));
    return;
  }

  // Request to our own origin that is NOT a proxy path and NOT a static file.
  // This means it's a relative-path fetch from inside a proxied page
  // (e.g. fetch('/api/data') or <img src="/images/logo.png">).
  // Resolve it against the real origin extracted from the page's referrer.
  const referrer = req.referrer || '';
  const realBase = extractRealBase(referrer);

  if (realBase) {
    try {
      const absolute = new URL(path + url.search + url.hash, realBase).href;
      if (!absolute.startsWith(self.location.origin)) {
        event.respondWith(proxyFetch(absolute, req));
        return;
      }
    } catch(e) {}
  }
});

// Extract the real proxied URL from a referrer like:
// http://myserver/proxy?url=https%3A%2F%2Fwww.crazygames.com%2Fpath
function extractRealBase(referrer) {
  if (!referrer) return null;
  try {
    const ref = new URL(referrer);
    if (ref.pathname.startsWith('/proxy')) {
      const inner = ref.searchParams.get('url');
      if (inner) return decodeURIComponent(inner);
    }
  } catch(e) {}
  return null;
}

function proxyFetch(targetUrl, req) {
  const clean = fullyDecode(targetUrl);
  const proxied = self.location.origin + PROXY_PATH + encodeURIComponent(clean);

  return fetch(proxied, {
    method:      req.method,
    headers:     sanitizeHeaders(req.headers),
    body:        req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
    redirect:    'follow',
    credentials: 'omit',
  }).catch(() => new Response('Proxy fetch failed', { status: 502 }));
}

function fullyDecode(url) {
  try {
    let prev = url;
    while (true) {
      const d = decodeURIComponent(prev);
      if (d === prev || !/^https?:\/\//i.test(d)) break;
      prev = d;
    }
    return prev;
  } catch(e) { return url; }
}

function sanitizeHeaders(headers) {
  const out = new Headers();
  const blocked = new Set(['cookie','authorization','x-forwarded-for','x-real-ip','origin','referer']);
  for (const [k, v] of headers.entries()) {
    if (!blocked.has(k.toLowerCase())) out.set(k, v);
  }
  return out;
}
