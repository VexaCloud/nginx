// proxy-bootstrap.js
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

  function toProxy(url) {
    if (!url || typeof url !== 'string') return url;
    if (url.includes(PROXY_PREFIX)) return url;

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

  // Strong location sandbox
  const originalAssign = Location.prototype.assign;
  const originalReplace = Location.prototype.replace;

  Location.prototype.assign = function(url) { originalAssign.call(this, toProxy(url)); };
  Location.prototype.replace = function(url) { originalReplace.call(this, toProxy(url)); };
  window.location.assign = Location.prototype.assign;
  window.location.replace = Location.prototype.replace;

  Object.defineProperty(window.location, 'href', {
    set: (val) => Location.prototype.assign.call(window.location, val),
    configurable: true
  });

  // History
  const _push = history.pushState;
  const _replace = history.replaceState;
  history.pushState = (s, t, u) => _push.call(history, s, t, u ? toProxy(u) : u);
  history.replaceState = (s, t, u) => _replace.call(history, s, t, u ? toProxy(u) : u);

  // fetch, XHR, window.open, etc.
  const _fetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === 'string') input = toProxy(input);
    else if (input instanceof Request) input = new Request(toProxy(input.url), init || {});
    return _fetch.call(this, input, init);
  };

  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, url, ...r) {
    return _open.call(this, m, toProxy(url), ...r);
  };

  const _winOpen = window.open;
  window.open = (url, ...a) => _winOpen.call(window, url ? toProxy(url) : url, ...a);

  // Click handler
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || /^(#|javascript:|mailto:)/i.test(href)) return;

    const proxied = toProxy(href);
    if (proxied !== href) {
      e.preventDefault();
      e.stopImmediatePropagation();
      window.location.href = proxied;
    }
  }, true);

  // Service Worker registration
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(reg => {
      const msg = { type: 'SET_CONTEXT', origin: realOrigin, base: realBase };
      const sw = reg.installing || reg.waiting || reg.active;
      if (sw) sw.postMessage(msg);
      if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage(msg);
    });
  }
})();
