// proxy-bootstrap.js
// Injected into every proxied HTML page by nginx sub_filter.
// Responsibilities:
//   1. Register /sw.js as a Service Worker to intercept all future fetches
//   2. Tell the SW what the real origin of this page is
//   3. Patch window.location and history so in-page navigation stays in proxy
//   4. Patch XMLHttpRequest and fetch() as a fallback for browsers that are
//      slow to activate the SW on first load

(function () {
  'use strict';

  // ── Determine the real origin of the page we're proxying ────────────
  // nginx has already rewritten the HTML, so we recover the original URL
  // from the ?url= query param in our own page's URL, OR from the
  // sub-filtered base href if present.
  function getRealOrigin() {
    try {
      // Our page URL is like: http://myserver/proxy?url=https://www.crazygames.com/...
      const params = new URLSearchParams(window.location.search);
      const proxyUrl = params.get('url');
      if (proxyUrl) {
        const u = new URL(proxyUrl);
        return u.origin; // e.g. "https://www.crazygames.com"
      }
    } catch (e) {}
    return null;
  }

  const realOrigin = getRealOrigin();
  const PROXY_BASE = window.location.origin + '/proxy?url=';

  // ── 1. Register Service Worker ───────────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        // Tell the SW the real origin so it can resolve relative paths
        const sw = reg.installing || reg.waiting || reg.active;
        if (sw) {
          sw.postMessage({ type: 'SET_ORIGIN', origin: realOrigin });
        }
        // Also message the active controller if different
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: 'SET_ORIGIN',
            origin: realOrigin
          });
        }
      })
      .catch(() => {}); // SW unavailable (HTTP, private mode) — fallback patches cover it
  }

  // ── 2. Rewrite any absolute URL to go through the proxy ─────────────
  function proxyUrl(url) {
    if (!url || typeof url !== 'string') return url;
    // Already proxied
    if (url.startsWith('/proxy?url=') || url.startsWith(window.location.origin + '/proxy?url=')) return url;
    // Absolute http/https
    if (/^https?:\/\//i.test(url)) {
      return PROXY_BASE + encodeURIComponent(url);
    }
    // Protocol-relative
    if (url.startsWith('//')) {
      return PROXY_BASE + encodeURIComponent('https:' + url);
    }
    // Relative URL — resolve against real origin
    if (realOrigin && !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('#')) {
      try {
        const abs = new URL(url, realOrigin).href;
        return PROXY_BASE + encodeURIComponent(abs);
      } catch (e) {}
    }
    return url;
  }

  // ── 3. Patch window.location navigation ─────────────────────────────
  // Intercepts window.location.href = '...' assignments
  const locDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
  if (!locDescriptor || locDescriptor.configurable) {
    try {
      const origHref = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
      Object.defineProperty(Location.prototype, 'href', {
        set(val) { origHref.set.call(this, proxyUrl(val)); },
        get()    { return origHref.get.call(this); },
        configurable: true,
      });
    } catch (e) {}
  }

  // Intercepts window.location.assign() and .replace()
  const origAssign  = window.location.assign.bind(window.location);
  const origReplace = window.location.replace.bind(window.location);
  try {
    window.location.assign  = (url) => origAssign(proxyUrl(url));
    window.location.replace = (url) => origReplace(proxyUrl(url));
  } catch (e) {}

  // ── 4. Patch history.pushState / replaceState ────────────────────────
  const origPush    = history.pushState.bind(history);
  const origReplace2 = history.replaceState.bind(history);
  history.pushState = function (state, title, url) {
    origPush(state, title, url ? proxyUrl(url) : url);
  };
  history.replaceState = function (state, title, url) {
    origReplace2(state, title, url ? proxyUrl(url) : url);
  };

  // ── 5. Patch fetch() as SW fallback ─────────────────────────────────
  // The SW might not be active for the very first request on a cold install.
  // This patch ensures even that first load is sandboxed.
  const origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    let url = input instanceof Request ? input.url : String(input);
    const proxied = proxyUrl(url);
    if (proxied !== url) {
      if (input instanceof Request) {
        input = new Request(proxied, input);
      } else {
        input = proxied;
      }
    }
    return origFetch(input, init);
  };

  // ── 6. Patch XMLHttpRequest ──────────────────────────────────────────
  const OrigXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = class extends OrigXHR {
    open(method, url, ...args) {
      return super.open(method, proxyUrl(url), ...args);
    }
  };

  // ── 7. Patch open() for popup windows ───────────────────────────────
  const origOpen = window.open.bind(window);
  window.open = function (url, ...args) {
    return origOpen(url ? proxyUrl(url) : url, ...args);
  };

  // ── 8. Intercept <a> clicks before navigation fires ─────────────────
  document.addEventListener('click', function (e) {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    const proxied = proxyUrl(href);
    if (proxied !== href) {
      e.preventDefault();
      window.location.href = proxied;
    }
  }, true); // capture phase — fires before the page's own listeners

  // ── 9. Intercept <form> submissions ─────────────────────────────────
  document.addEventListener('submit', function (e) {
    const form = e.target;
    const action = form.getAttribute('action');
    if (!action) return;
    const proxied = proxyUrl(action);
    if (proxied !== action) {
      form.setAttribute('action', proxied);
    }
  }, true);

})();
