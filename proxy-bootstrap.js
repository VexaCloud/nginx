// proxy-bootstrap.js — injected into every proxied HTML page by nginx sub_filter
// Sandboxes ALL navigation, fetch, XHR, and link clicks inside the proxy.

(function () {
  'use strict';

  // ── Recover the real URL this page was fetched from ─────────────────
  // Our page URL is always /proxy?url=<encoded-target>
  // e.g. /proxy?url=https%3A%2F%2Fwww.crazygames.com%2Fsome%2Fpath
  function getRealUrl() {
    try {
      const p = new URLSearchParams(window.location.search);
      const u = p.get('url');
      return u ? new URL(u) : null;
    } catch (e) { return null; }
  }

  const realParsed = getRealUrl();
  const realOrigin = realParsed ? realParsed.origin : null; // https://www.crazygames.com
  const realBase   = realParsed ? realParsed.href   : null; // full URL incl path, for relative resolution

  const PROXY_PREFIX = '/proxy?url=';
  const MY_ORIGIN    = window.location.origin; // http://yourserver

  // ── Register the Service Worker ─────────────────────────────────────
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

  // ── Core URL rewriter ────────────────────────────────────────────────
  function toProxy(url) {
    if (!url || typeof url !== 'string') return url;
    // Already proxied through us
    if (url.startsWith(PROXY_PREFIX) || url.startsWith(MY_ORIGIN + PROXY_PREFIX)) return url;
    // data:, blob:, javascript:, mailto:, #anchor — leave alone
    if (/^(data:|blob:|javascript:|mailto:|#)/.test(url)) return url;
    // Absolute http/https
    if (/^https?:\/\//i.test(url)) {
      return PROXY_PREFIX + encodeURIComponent(url);
    }
    // Protocol-relative
    if (url.startsWith('//')) {
      return PROXY_PREFIX + encodeURIComponent('https:' + url);
    }
    // Relative URL — resolve against the REAL page URL (not our proxy URL)
    if (realBase) {
      try {
        const abs = new URL(url, realBase).href;
        return PROXY_PREFIX + encodeURIComponent(abs);
      } catch (e) {}
    }
    return url;
  }

  // ── Patch window.location.href ───────────────────────────────────────
  try {
    const desc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
    Object.defineProperty(Location.prototype, 'href', {
      set(val) { desc.set.call(this, toProxy(String(val))); },
      get()    { return desc.get.call(this); },
      configurable: true,
    });
  } catch (e) {}

  // ── Patch location.assign / replace ─────────────────────────────────
  try {
    const origAssign  = Location.prototype.assign;
    const origReplace = Location.prototype.replace;
    Location.prototype.assign  = function(url) { origAssign.call(this,  toProxy(url)); };
    Location.prototype.replace = function(url) { origReplace.call(this, toProxy(url)); };
  } catch (e) {}

  // ── Patch history ────────────────────────────────────────────────────
  const _push    = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);
  history.pushState    = (s, t, url) => _push(s,    t, url ? toProxy(url) : url);
  history.replaceState = (s, t, url) => _replace(s, t, url ? toProxy(url) : url);

  // ── Patch fetch() ────────────────────────────────────────────────────
  const _fetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    if (input instanceof Request) {
      const proxied = toProxy(input.url);
      if (proxied !== input.url) input = new Request(proxied, { method: input.method, headers: input.headers, body: input.body, mode: 'cors', credentials: 'omit' });
    } else {
      input = toProxy(String(input));
    }
    return _fetch(input, init);
  };

  // ── Patch XMLHttpRequest ─────────────────────────────────────────────
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    return _open.call(this, method, toProxy(String(url)), ...rest);
  };

  // ── Patch window.open ────────────────────────────────────────────────
  const _winOpen = window.open.bind(window);
  window.open = (url, ...args) => _winOpen(url ? toProxy(url) : url, ...args);

  // ── Intercept <a> clicks (capture phase, before page handlers) ───────
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

  // ── Intercept <form> submits ─────────────────────────────────────────
  document.addEventListener('submit', function(e) {
    const form = e.target;
    const action = form.action || '';
    const proxied = toProxy(action);
    if (proxied !== action) form.action = proxied;
  }, true);

  // ── Patch document.createElement to catch dynamic script/img/link ────
  const _createElement = document.createElement.bind(document);
  document.createElement = function(tag, ...args) {
    const el = _createElement(tag, ...args);
    const tagLower = tag.toLowerCase();
    if (tagLower === 'script' || tagLower === 'img' || tagLower === 'iframe') {
      const srcDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'src') ||
                      Object.getOwnPropertyDescriptor(Element.prototype, 'src');
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
    if (tagLower === 'link') {
      const hrefDesc = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'href') ||
                       Object.getOwnPropertyDescriptor(Element.prototype, 'href');
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
