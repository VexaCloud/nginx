// sw.js
const PROXY_PREFIX = '/proxy?url=';
let realBase = null;

self.addEventListener('message', e => {
  if (e.data?.type === 'SET_CONTEXT') {
    realBase = e.data.base;
  }
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Skip our own files
  if (url.includes(PROXY_PREFIX) || url.includes('/sw.js') || url.includes('/proxy-bootstrap.js')) {
    return;
  }

  // Absolute external URL
  if (/^https?:\/\//.test(url)) {
    event.respondWith(proxyFetch(url, event.request));
    return;
  }

  // === CRITICAL: Relative paths ===
  if (realBase && url.startsWith(self.location.origin)) {
    const path = url.slice(self.location.origin.length);
    if (path && !path.startsWith('/proxy')) {
      try {
        const absolute = new URL(path, realBase).href;
        event.respondWith(proxyFetch(absolute, event.request));
        return;
      } catch (_) {}
    }
  }
});

async function proxyFetch(targetUrl, req) {
  const proxied = self.location.origin + PROXY_PREFIX + encodeURIComponent(targetUrl);

  const res = await fetch(proxied, {
    method: req.method,
    headers: sanitizeHeaders(req.headers),
    body: req.body,
    redirect: 'manual'
  }).catch(() => new Response('Proxy Error', {status: 502}));

  // Handle redirects
  if (res.status >= 300 && res.status < 400) {
    let loc = res.headers.get('Location');
    if (loc) {
      if (!loc.startsWith('http')) loc = new URL(loc, targetUrl).href;
      return new Response(null, {
        status: res.status,
        headers: { 'Location': '/proxy?url=' + encodeURIComponent(loc) }
      });
    }
  }
  return res;
}

function sanitizeHeaders(headers) {
  const out = new Headers();
  for (const [k, v] of headers) {
    if (!['cookie','authorization','referer'].includes(k.toLowerCase())) {
      out.set(k, v);
    }
  }
  return out;
}
