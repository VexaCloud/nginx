// proxy-bootstrap.js — injected into every proxied HTML page by nginx sub_filter
// Sandboxes ALL navigation, fetch, XHR, and link clicks inside the proxy.

(function () {
  'use strict';

  // Recover the real URL this page represents from our ?url= param
  function getRealParsed() {
    try {
      const p = new URLSearchParams(window.location.search);
      const u = p.get('url');
      return u ? new URL(u) : null;
    } catch (e) { return null; }
  }

  const realParsed = getRealParsed();
  const realOrigin = realParsed ? realParsed.origin : null; // https://www.crazygames.com
  const realBase   = realParsed ? realParsed.href   : null; // full URL for relative resolution

  const PROXY_PREFIX = '/proxy?url=';
  const MY_ORIGIN    = window.location.origin;

  // Register Service Worker and tell it the real origin/base
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        const msg = { type: 'SET_CONTEXT', origin: realOrigin, base: realBase };
        const sw = reg.installing || reg.waiting || reg.active;
        if (sw && sw.state !== 'redundant') sw.postMessage(msg);
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage(msg);
        }
      }).catch(() => {});
  }

  // Core URL rewriter — converts any URL to go through /proxy?url=
  function toProxy(url) {
    if (!url || typeof url !== 'string') return url;
    if (url.startsWith(PROXY_PREFIX) || url.startsWith(MY_ORIGIN + PROXY_PREFIX)) return url;
    if (/^(data:|blob:|javascript:|mailto:|#)/.test(url)) return url;
    // Absolute http/https
    if (/^https?:\/\//i.test(url)) return PROXY_PREFIX + encodeURIComponent(url);
    // Protocol-relative
    if (url.startsWith('//')) return PROXY_PREFIX + encodeURIComponent('https:' + url);
    // Relative — resolve against the real page base URL
    if (realBase) {
      try { return PROXY_PREFIX + encodeURIComponent(new URL(url, realBase).href); }
      catch (e) {}
    }
    return url;
  }

  // Patch window.location.href setter
  try {
    const desc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
    Object.defineProperty(Location.prototype, 'href', {
      set(val) { desc.set.call(this, toProxy(String(val))); },
      get()    { return desc.get.call(this); },
      configurable: true,
    });
  } catch (e) {}

  // Patch location.assign / replace
  try {
    const _assign  = Location.prototype.assign;
    const _replace = Location.prototype.replace;
    Location.prototype.assign  = function(url) { _assign.call(this,  toProxy(url)); };
    Location.prototype.replace = function(url) { _replace.call(this, toProxy(url)); };
  } catch (e) {}

  // Patch history
  const _push    = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);
  history.pushState    = (s, t, url) => _push(s,    t, url ? toProxy(url) : url);
  history.replaceState = (s, t, url) => _replace(s, t, url ? toProxy(url) : url);

  // Patch fetch()
  const _fetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    if (input instanceof Request) {
      const p = toProxy(input.url);
      if (p !== input.url) input = new Request(p, { method: input.method, headers: input.headers, body: input.body, mode: 'cors', credentials: 'omit' });
    } else {
      input = toProxy(String(input));
    }
    return _fetch(input, init);
  };

  // Patch XMLHttpRequest
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    return _open.call(this, method, toProxy(String(url)), ...rest);
  };

  // Patch window.open
  const _winOpen = window.open.bind(window);
  window.open = (url, ...args) => _winOpen(url ? toProxy(url) : url, ...args);

  // Intercept <a> clicks before page handlers (capture phase)
  document.addEventListener('click', function(e) {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || /^(#|javascript:|mailto:)/.test(href)) return;
    const proxied = toProxy(href);
    if (proxied !== href) {
      e.preventDefault();
      e.stopPropagation();
      window.location.href = proxied;
    }
  }, true);

  // Intercept <form> submits
  document.addEventListener('submit', function(e) {
    const form = e.target;
    if (form.action) {
      const proxied = toProxy(form.action);
      if (proxied !== form.action) form.action = proxied;
    }
  }, true);

  // Patch document.createElement to catch dynamically created script/img/link/iframe
  const _createElement = document.createElement.bind(document);
  document.createElement = function(tag, ...args) {
    const el = _createElement(tag, ...args);
    const t = tag.toLowerCase();
    if (t === 'script' || t === 'img' || t === 'iframe') {
      const proto = el.__proto__;
      const srcDesc = Object.getOwnPropertyDescriptor(proto, 'src');
      if (srcDesc) {
        try {
          Object.defineProperty(el, 'src', {
            set(val) { srcDesc.set.call(this, toProxy(String(val))); },
            get()    { return srcDesc.get.call(this); },
            configurable: true,
          });
        } catch(e) {}
      }
    }
    if (t === 'link') {
      const hrefDesc = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'href');
      if (hrefDesc) {
        try {
          Object.defineProperty(el, 'href', {
            set(val) { hrefDesc.set.call(this, toProxy(String(val))); },
            get()    { return hrefDesc.get.call(this); },
            configurable: true,
          });
        } catch(e) {}
      }
    }
    return el;
  };

})();
