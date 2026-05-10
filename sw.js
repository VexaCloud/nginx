// sw.js — VexaProxy Service Worker
const PROXY_PATH = '/proxy?url=';
const OWN_STATIC = new Set([
  '/sw.js', '/proxy-bootstrap.js', '/index.html',
  '/health', '/favicon.ico', '/404.html', '/proxy-error.html'
]);

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never touch our own static files
  if (OWN_STATIC.has(url.pathname)) return;

  // Already a proxied request — pass through
  if (url.pathname.startsWith('/proxy')) return;

  // External absolute URL — route through proxy
  if (url.origin !== self.location.origin) {
    event.respondWith(doProxyFetch(req.url, req));
    return;
  }

  // Same-origin request that isn't a proxy or static file.
  // This is a relative-path fetch from inside a proxied page
  // (e.g. fetch('/api/data') when JS ran before <base> tag took effect)
  // Recover real base from Referer header.
  const realBase = extractRealBase(req.referrer);
  if (realBase) {
    try {
      const absolute = new URL(url.pathname + url.search + url.hash, realBase).href;
      if (!absolute.startsWith(self.location.origin)) {
        event.respondWith(doProxyFetch(absolute, req));
        return;
      }
    } catch(e) {}
  }

  // Let other same-origin requests through (our own static files etc.)
});

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

function doProxyFetch(targetUrl, req) {
  const clean = fullyDecode(targetUrl);
  const proxied = self.location.origin + PROXY_PATH + encodeURIComponent(clean);
  return fetch(proxied, {
    method:      req.method,
    headers:     sanitizeHeaders(req.headers),
    body:        req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
    redirect:    'follow',
    credentials: 'omit',
  }).catch((err) => new Response('Proxy error: ' + err, {
    status: 502,
    headers: { 'Content-Type': 'text/plain' },
  }));
}

function fullyDecode(url) {
  try {
    let s = url;
    for (let i = 0; i < 3; i++) {
      const d = decodeURIComponent(s);
      if (d === s || !/^https?:\/\//i.test(d)) break;
      s = d;
    }
    return s;
  } catch(e) { return url; }
}

function sanitizeHeaders(headers) {
  const blocked = new Set([
    'cookie', 'authorization', 'x-forwarded-for',
    'x-real-ip', 'origin', 'referer'
  ]);
  const out = new Headers();
  for (const [k, v] of headers.entries()) {
    if (!blocked.has(k.toLowerCase())) out.set(k, v);
  }
  return out;
}
