// proxy-bootstrap.js — injected into every proxied HTML page
(function () {
  'use strict';

  function getRealParsed() {
    try {
      const p = new URLSearchParams(window.location.search);
      const u = p.get('url');
      return u ? new URL(u) : null;
    } catch (e) { return null; }
  }

  const realParsed = getRealParsed();
  const realOrigin = realParsed ? realParsed.origin : null;
  const realBase = realParsed ? realParsed.href : null;
  const PROXY_PREFIX = '/proxy?url=';
  const MY_ORIGIN = window.location.origin;

  // ==================== URL REWRITER ====================
  function toProxy(url) {
    if (!url || typeof url !== 'string') return url;
    if (url.startsWith(PROXY_PREFIX) || url.includes('/proxy?url=')) return url;

    if (/^(data:|blob:|javascript:|mailto:|tel:|#|about:)/i.test(url)) return url;

    try {
      let absolute;
      if (/^https?:\/\//i.test(url)) {
        absolute = url;
      } else if (url.startsWith('//')) {
        absolute = 'https:' + url;
      } else if (realBase) {
        absolute = new URL(url, realBase).href;
      } else {
        return url;
      }
      return PROXY_PREFIX + encodeURIComponent(absolute);
    } catch (e) {
      return url;
    }
  }

  // ==================== STRONG NAVIGATION SANDBOX ====================
  // Patch location.href
  try {
    Object.defineProperty(window.location, 'href', {
      set: (val) => { window.location.assign(val); },
      configurable: true
    });
  } catch (e) {}

  // Patch assign / replace
  const _assign = Location.prototype.assign;
  const _replace = Location.prototype.replace;

  Location.prototype.assign = function(url) {
    _assign.call(this, toProxy(url));
  };
  Location.prototype.replace = function(url) {
    _replace.call(this, toProxy(url));
  };

  // Also bind directly to window.location
  window.location.assign = Location.prototype.assign;
  window.location.replace = Location.prototype.replace;

  // Patch history API
  const _push = history.pushState;
  const _replaceState = history.replaceState;
  history.pushState = (state, title, url) => _push.call(history, state, title, url ? toProxy(url) : url);
  history.replaceState = (state, title, url) => _replaceState.call(history, state, title, url ? toProxy(url) : url);

  // Patch fetch
  const _fetch = window.fetch;
  window.fetch = function(input, init) {
    if (input instanceof Request) {
      const newUrl = toProxy(input.url);
      if (newUrl !== input.url) {
        input = new Request(newUrl, init || {});
      }
    } else {
      input = toProxy(String(input));
    }
    return _fetch.call(window, input, init);
  };

  // Patch XMLHttpRequest
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    return _open.call(this, method, toProxy(String(url)), ...rest);
  };

  // Patch window.open
  const _winOpen = window.open;
  window.open = (url, ...args) => _winOpen.call(window, url ? toProxy(url) : url, ...args);

  // Strong click interceptor
  document.addEventListener('click', function(e) {
    const a = e.target.closest('a[href], [data-href]');
    if (!a) return;

    let href = a.getAttribute('href') || a.getAttribute('data-href') || '';
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) return;

    const proxied = toProxy(href);
    if (proxied !== href) {
      e.preventDefault();
      e.stopImmediatePropagation();
      window.location.href = proxied;
    }
  }, true);

  // Form submit protection
  document.addEventListener('submit', function(e) {
    const form = e.target;
    if (form.action) {
      form.action = toProxy(form.action);
    }
  }, true);

  // Register Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        const msg = { type: 'SET_CONTEXT', origin: realOrigin, base: realBase };
        const sw = reg.installing || reg.waiting || reg.active;
        if (sw) sw.postMessage(msg);
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage(msg);
        }
      })
      .catch(() => {});
  }
})();
