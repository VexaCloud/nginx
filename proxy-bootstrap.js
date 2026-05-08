// proxy-bootstrap.js — injected into every proxied HTML page
(function () {
  'use strict';

  function safeDecodeURL(url) {
    try {
      let prev = url;
      while (true) {
        const decoded = decodeURIComponent(prev);
        if (decoded === prev) break;
        if (!/^https?:\/\//i.test(decoded) && !decoded.startsWith('/')) break;
        prev = decoded;
      }
      return prev;
    } catch (e) { return url; }
  }

  function getRealParsed() {
    try {
      const p = new URLSearchParams(window.location.search);
      let u = p.get('url');
      if (!u) return null;
      u = safeDecodeURL(u);
      return new URL(u);
    } catch (e) { return null; }
  }

  const realParsed = getRealParsed();
  const realOrigin = realParsed ? realParsed.origin : null;
  const realBase   = realParsed ? realParsed.href   : null;
  const MY_ORIGIN  = window.location.origin;
  const PROXY_PATH = '/proxy?url=';

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

  function toProxy(url) {
    if (!url || typeof url !== 'string') return url;
    if (/^(data:|blob:|javascript:|mailto:|tel:|#)/.test(url)) return url;

    let clean = safeDecodeURL(url);

    // Fix already-proxied but double-encoded URLs like /proxy?url=https%3A%2F%2F
    if (clean.startsWith(PROXY_PATH) || clean.startsWith(MY_ORIGIN + PROXY_PATH)) {
      try {
        const inner = clean.startsWith(MY_ORIGIN) ? clean.slice(MY_ORIGIN.length) : clean;
        const innerUrl = new URLSearchParams(inner.slice('/proxy?'.length)).get('url');
        if (innerUrl) {
          const decoded = safeDecodeURL(innerUrl);
          new URL(decoded); // validate
          return PROXY_PATH + encodeURIComponent(decoded);
        }
      } catch(e) {}
      return clean;
    }

    // Absolute http/https
    if (/^https?:\/\//i.test(clean)) {
      return PROXY_PATH + encodeURIComponent(clean);
    }

    // Protocol-relative
    if (clean.startsWith('//')) {
      return PROXY_PATH + encodeURIComponent('https:' + clean);
    }

    // Relative — resolve against real page base
    if (realBase) {
      try {
        const abs = new URL(clean, realBase).href;
        return PROXY_PATH + encodeURIComponent(abs);
      } catch (e) {}
    }

    return url;
  }

  // Patch location.href
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
    Location.prototype.assign  = function(u) { _assign.call(this,  toProxy(u)); };
    Location.prototype.replace = function(u) { _replace.call(this, toProxy(u)); };
  } catch (e) {}

  // Patch history
  const _push    = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);
  history.pushState    = (s, t, u) => _push(s,    t, u ? toProxy(u) : u);
  history.replaceState = (s, t, u) => _replace(s, t, u ? toProxy(u) : u);

  // Patch fetch
  const _fetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    if (input instanceof Request) {
      const p = toProxy(input.url);
      if (p !== input.url) input = new Request(p, {
        method: input.method, headers: input.headers,
        body: input.body, mode: 'cors', credentials: 'omit'
      });
    } else {
      input = toProxy(String(input));
    }
    return _fetch(input, init);
  };

  // Patch XHR
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    return _open.call(this, method, toProxy(String(url)), ...rest);
  };

  // Patch window.open
  const _winOpen = window.open.bind(window);
  window.open = (u, ...args) => _winOpen(u ? toProxy(u) : u, ...args);

  // Intercept <a> clicks
  document.addEventListener('click', function(e) {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || /^(#|javascript:|mailto:|tel:)/.test(href)) return;
    const proxied = toProxy(href);
    if (proxied !== href) {
      e.preventDefault();
      e.stopPropagation();
      window.location.href = proxied;
    }
  }, true);

  // Intercept form submits
  document.addEventListener('submit', function(e) {
    const form = e.target;
    if (form.action) {
      const p = toProxy(form.action);
      if (p !== form.action) form.action = p;
    }
  }, true);

  // Patch createElement
  const _createElement = document.createElement.bind(document);
  document.createElement = function(tag, ...args) {
    const el = _createElement(tag, ...args);
    const t = tag.toLowerCase();
    if (t === 'script' || t === 'img' || t === 'iframe') {
      try {
        const srcDesc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'src');
        if (srcDesc) Object.defineProperty(el, 'src', {
          set(val) { srcDesc.set.call(this, toProxy(String(val))); },
          get()    { return srcDesc.get.call(this); },
          configurable: true,
        });
      } catch(e) {}
    }
    if (t === 'link') {
      try {
        const hrefDesc = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'href');
        if (hrefDesc) Object.defineProperty(el, 'href', {
          set(val) { hrefDesc.set.call(this, toProxy(String(val))); },
          get()    { return hrefDesc.get.call(this); },
          configurable: true,
        });
      } catch(e) {}
    }
    return el;
  };

})();
