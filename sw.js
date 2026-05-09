// sw.js — VexaProxy Service Worker
// Intercepts ALL fetches from proxied pages and routes them through /proxy?url=
// Uses <base> tag approach: browser resolves relative URLs to absolute real-site URLs,
// SW then intercepts those absolute external URLs and proxies them.

const PROXY_PATH = '/proxy?url=';

// Static files served from our own server — never intercept these
const OWN_STATIC = new Set([
  '/sw.js', '/proxy-bootstrap.js', '/index.html', '/health', '/favicon.ico'
]);

self.addEventListener('install', () => {
  // Take over immediately — don't wait for old SW to die
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Claim all open clients immediately so this SW controls them right away
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // ── Never intercept our own static files ──────────────────────────────
  if (OWN_STATIC.has(url.pathname)) return;

  // ── Never intercept already-proxied requests (avoid loops) ───────────
  if (url.pathname.startsWith('/proxy')) return;

  // ── External absolute URL (e.g. http://www.crazygames.com/style.css) ─
  // This is what happens AFTER the <base> tag resolves relative paths:
  // <link href="/style.css"> + <base href="https://www.crazygames.com/">
  //   -> browser requests https://www.crazygames.com/style.css
  //   -> SW intercepts it here and proxies it
  if (url.origin !== self.location.origin) {
    event.respondWith(doProxyFetch(req.url, req));
    return;
  }

  // ── Same-origin request that isn't a static file or /proxy ───────────
  // This happens when JS does fetch('/api/data') and the base tag is missing
  // or when the page was loaded before SW was active.
  // Try to recover the real base URL from the Referer header.
  const realBase = extractRealBase(req.referrer);
  if (realBase) {
    try {
      const absolute = new URL(url.pathname + url.search + url.hash, realBase).href;
      // Make sure we didn't resolve back to our own origin
      if (!absolute.startsWith(self.location.origin)) {
        event.respondWith(doProxyFetch(absolute, req));
        return;
      }
    } catch(e) {}
  }

  // All other same-origin requests: let through normally
});

// Extract the real proxied URL from a Referer like:
// https://shiny-giggle-....github.dev/proxy?url=https%3A%2F%2Fwww.crazygames.com%2F
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
  // Decode any accidental double-encoding
  const clean = fullyDecode(targetUrl);
  const proxied = self.location.origin + PROXY_PATH + encodeURIComponent(clean);

  return fetch(proxied, {
    method:      req.method,
    headers:     sanitizeHeaders(req.headers),
    body:        req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
    redirect:    'follow',
    credentials: 'omit',
  }).catch((err) => {
    return new Response('Proxy error: ' + err.message, {
      status: 502,
      headers: { 'Content-Type': 'text/plain' }
    });
  });
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
