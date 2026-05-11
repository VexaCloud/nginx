// sw.js — VexaProxy Service Worker
var PROXY_PATH = '/proxy?url=';
var OWN = ['/sw.js','/proxy-bootstrap.js','/index.html','/health','/favicon.ico','/404.html','/proxy-error.html'];

self.addEventListener('install',  function() { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', function(event) {
  var req = event.request;
  var url; try { url = new URL(req.url); } catch(e) { return; }

  if (OWN.indexOf(url.pathname) !== -1) return;
  if (url.pathname.indexOf('/proxy') === 0) return;

  if (url.origin !== self.location.origin) {
    event.respondWith(doProxyFetch(req.url, req));
    return;
  }

  var realBase = extractRealBase(req.referrer);
  if (realBase) {
    try {
      var abs = new URL(url.pathname + url.search + url.hash, realBase).href;
      if (abs.indexOf(self.location.origin) !== 0) {
        event.respondWith(doProxyFetch(abs, req));
        return;
      }
    } catch(e) {}
  }
});

function extractRealBase(ref) {
  if (!ref) return null;
  try {
    var r = new URL(ref);
    if (r.pathname.indexOf('/proxy') === 0) {
      var u = r.searchParams.get('url');
      if (u) return decodeURIComponent(u);
    }
  } catch(e) {}
  return null;
}

function doProxyFetch(targetUrl, req) {
  var clean = fullyDecode(targetUrl);
  var proxied = self.location.origin + PROXY_PATH + encodeURIComponent(clean);
  return fetch(proxied, {
    method: req.method,
    headers: sanitize(req.headers),
    body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
    redirect: 'follow',
    credentials: 'omit',
  }).catch(function(e) {
    return new Response('Proxy error: ' + e, { status: 502, headers: {'Content-Type':'text/plain'} });
  });
}

function fullyDecode(url) {
  try {
    var s = url;
    for (var i = 0; i < 3; i++) {
      var d = decodeURIComponent(s);
      if (d === s || !/^https?:\/\//i.test(d)) break;
      s = d;
    }
    return s;
  } catch(e) { return url; }
}

function sanitize(headers) {
  var blocked = ['cookie','authorization','x-forwarded-for','x-real-ip','origin','referer',
    'sec-fetch-site','sec-fetch-mode','sec-fetch-dest','sec-fetch-user',
    'sec-ch-ua','sec-ch-ua-mobile','sec-ch-ua-platform'];
  var out = new Headers();
  headers.forEach(function(v, k) {
    if (blocked.indexOf(k.toLowerCase()) === -1) out.set(k, v);
  });
  return out;
}
