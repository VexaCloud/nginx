// sw.js
const PROXY_PREFIX = '/proxy?url=';
let realBase = null;

self.addEventListener('message', e => {
  if (e.data?.type === 'SET_CONTEXT') realBase = e.data.base;
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const url = event.request.url;

  if (url.includes(PROXY_PREFIX) || url.includes('/sw.js') || url.includes('/proxy-bootstrap.js')) {
    return;
  }

  // External absolute URL
  if (/^https?:\/\//.test(url)) {
    event.respondWith(proxyFetch(url, event.request));
    return;
  }

  // Relative request on our domain
  if (realBase && url.startsWith(self.location.origin)) {
    const path = url.slice(self.location.origin.length);
    if (path && !path.startsWith('/proxy')) {
      try {
        const absolute = new URL(path, realBase).href;
        event.respondWith(proxyFetch(absolute, event.request));
      } catch (_) {}
    }
  }
});

async function proxyFetch(target, req) {
  const proxied = self.location.origin + PROXY_PREFIX + encodeURIComponent(target);

  let res = await fetch(proxied, {
    method: req.method,
    headers: sanitizeHeaders(req.headers),
    body: req.body,
    redirect: 'manual'
  }).catch(() => new Response('Proxy Error', {status: 502}));

  // Handle redirects properly
  if (res.status >= 300 && res.status < 400) {
    let loc = res.headers.get('Location');
    if (loc) {
      if (!loc.startsWith('http')) loc = new URL(loc, target).href;
      const newLoc = '/proxy?url=' + encodeURIComponent(loc);
      return new Response(null, { status: res.status, headers: { 'Location': newLoc } });
    }
  }
  return res;
}

function sanitizeHeaders(headers) {
  const h = new Headers();
  for (const [k, v] of headers) {
    if (!['cookie', 'authorization', 'referer'].includes(k.toLowerCase())) h.set(k, v);
  }
  return h;
}
