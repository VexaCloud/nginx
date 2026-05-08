// sw.js
const PROXY_PREFIX = '/proxy?url=';
let realBase = null;   // e.g. "https://www.xbox.com/"

self.addEventListener('message', e => {
  if (e.data?.type === 'SET_CONTEXT') realBase = e.data.base;
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const url = event.request.url;

  if (url.includes(PROXY_PREFIX) || 
      url.includes('/sw.js') || 
      url.includes('/proxy-bootstrap.js')) return;

  let targetUrl = null;

  // Absolute URL
  if (/^https?:\/\//.test(url)) {
    targetUrl = url;
  }
  // Relative path starting with / (THIS IS THE KEY FIX)
  else if (realBase && url.startsWith(self.location.origin + '/')) {
    const path = url.slice(self.location.origin.length);
    if (path && !path.startsWith('/proxy')) {
      try {
        targetUrl = new URL(path, realBase).href;
      } catch (_) {}
    }
  }

  if (targetUrl) {
    event.respondWith(proxyFetch(targetUrl, event.request));
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
    if (!['cookie', 'authorization', 'referer', 'origin'].includes(k.toLowerCase())) {
      out.set(k, v);
    }
  }
  return out;
}
