// sw.js — VexaProxy Service Worker
// Intercepts every fetch made by a proxied page and routes it through /proxy?url=
// This catches XHR, fetch(), dynamic import(), <img>, <script>, <link>, etc.
// It is the only reliable way to sandbox all network traffic from a proxied page.

const PROXY_PREFIX = '/proxy?url=';

// Determine the "current base URL" from the SW's own URL context.
// When the SW is installed on a proxied page, self.location is still our origin,
// but we track the target origin via a stored variable set by the bootstrap script.
let currentOrigin = null; // set via postMessage from bootstrap

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SET_ORIGIN') {
    currentOrigin = event.data.origin; // e.g. "https://www.crazygames.com"
  }
});

self.addEventListener('install', () => {
  self.skipWaiting(); // activate immediately, don't wait for old SW to die
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim()); // take control of all open pages immediately
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = req.url;

  // ── Never intercept requests that are already going to our proxy ──
  if (url.startsWith(self.location.origin + PROXY_PREFIX)) return;

  // ── Never intercept requests to our own static files ──
  if (
    url === self.location.origin + '/sw.js' ||
    url === self.location.origin + '/proxy-bootstrap.js' ||
    url.startsWith(self.location.origin + '/') &&
    !url.startsWith(self.location.origin + '/proxy')
  ) {
    // It's a request to our own origin for a static asset — let it through
    return;
  }

  // ── Intercept any absolute http/https URL that isn't our own origin ──
  if (/^https?:\/\//.test(url) && !url.startsWith(self.location.origin)) {
    const proxied = self.location.origin + PROXY_PREFIX + encodeURIComponent(url);
    event.respondWith(
      fetch(proxied, {
        method:  req.method,
        headers: sanitizeHeaders(req.headers),
        body:    req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
        redirect: 'follow',
        mode:    'cors',
        credentials: 'omit', // never send cookies to upstream targets
      }).catch(() => new Response('Proxy fetch failed', { status: 502 }))
    );
    return;
  }

  // ── Intercept relative URLs while inside a proxied page ──
  // These fire when a page does fetch('/api/data') — relative to the proxied origin,
  // not our proxy origin. We reconstruct the absolute URL using currentOrigin.
  if (currentOrigin && url.startsWith(self.location.origin + '/') &&
      !url.startsWith(self.location.origin + PROXY_PREFIX) &&
      !url.startsWith(self.location.origin + '/sw.js') &&
      !url.startsWith(self.location.origin + '/proxy-bootstrap.js')) {

    // Strip our origin prefix to get the path, reattach to the real origin
    const path = url.slice(self.location.origin.length);
    const absolute = currentOrigin.replace(/\/$/, '') + path;
    const proxied = self.location.origin + PROXY_PREFIX + encodeURIComponent(absolute);

    event.respondWith(
      fetch(proxied, {
        method:  req.method,
        headers: sanitizeHeaders(req.headers),
        body:    req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
        redirect: 'follow',
        mode:    'cors',
        credentials: 'omit',
      }).catch(() => new Response('Proxy fetch failed', { status: 502 }))
    );
  }
});

// Strip headers that would expose the user's real identity or break the proxy
function sanitizeHeaders(headers) {
  const out = new Headers();
  for (const [k, v] of headers.entries()) {
    const lower = k.toLowerCase();
    if (
      lower === 'cookie' ||
      lower === 'authorization' ||
      lower === 'x-forwarded-for' ||
      lower === 'x-real-ip' ||
      lower === 'origin' ||
      lower === 'referer'
    ) continue;
    out.set(k, v);
  }
  return out;
}
