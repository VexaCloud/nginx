// sw.js — VexaProxy Service Worker
// Uses Referer header to resolve relative paths — works without postMessage race conditions.

const PROXY_PATH = '/proxy?url=';
const OWN_PATHS  = new Set(['/sw.js', '/proxy-bootstrap.js', '/index.html', '/health']);

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never touch our own static files
  if (OWN_PATHS.has(url.pathname)) return;

  // Already a proxy request — let nginx handle it
  if (url.pathname.startsWith('/proxy')) return;

  // External URL — route straight through proxy
  if (url.origin !== self.location.origin) {
    event.respondWith(doProxyFetch(req.url, req));
    return;
  }

  // Request to our own origin that isn't a static file or proxy path.
  // This is a relative-path resource from inside a proxied page
  // e.g. <img src="/images/logo.png"> or fetch('/api/v1/data')
  // Recover the real base from the Referer header.
  const realBase = getRealBaseFromReferer(req.referrer);
  if (realBase) {
    try {
      const absolute = new URL(url.pathname + url.search + url.hash, realBase).href;
      if (!absolute.startsWith(self.location.origin)) {
        event.respondWith(doProxyFetch(absolute, req));
        return;
      }
    } catch(e) {}
  }
});

// Parse the real proxied URL out of a referrer like:
// https://shiny-giggle-...app.github.dev/proxy?url=https%3A%2F%2Fwww.crazygames.com%2F
function getRealBaseFromReferer(referrer) {
  if (!referrer) return null;
  try {
    const ref = new URL(referrer);
    // Works on any domain — just needs /proxy?url= path
    if (ref.pathname.startsWith('/proxy')) {
      const inner = ref.searchParams.get('url');
      if (inner) return decodeURIComponent(inner);
    }
  } catch(e) {}
  return null;
}

function doProxyFetch(targetUrl, req) {
  const clean   = fullyDecode(targetUrl);
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
    let s = url;
    for (let i = 0; i < 3; i++) {
      const d = decodeURIComponent(s);
      if (d === s) break;
      if (!/^https?:\/\//i.test(d)) break;
      s = d;
    }
    return s;
  } catch(e) { return url; }
}

function sanitizeHeaders(headers) {
  const blocked = new Set(['cookie','authorization','x-forwarded-for','x-real-ip','origin','referer']);
  const out = new Headers();
  for (const [k, v] of headers.entries()) {
    if (!blocked.has(k.toLowerCase())) out.set(k, v);
  }
  return out;
}
