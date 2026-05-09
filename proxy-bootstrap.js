// proxy-bootstrap.js — injected into every proxied HTML page
(function () {
  'use strict';

  function getRealParsed() {
    try {
      const raw = new URLSearchParams(window.location.search).get('url');
      if (!raw) return null;
      let u = raw;
      for (let i = 0; i < 3; i++) {
        const d = decodeURIComponent(u);
        if (d === u) break;
        if (!/^https?:\/\//i.test(d)) break;
        u = d;
      }
      return new URL(u);
    } catch(e) { return null; }
  }

  const realParsed = getRealParsed();
  const realOrigin = realParsed ? realParsed.origin : null;
  const realBase   = realParsed ? realParsed.href   : null;
  const MY_ORIGIN  = window.location.origin;
  const PROXY_PATH = '/proxy?url=';

  // Register SW — reload once it activates so it catches all sub-resources
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        if (reg.installing) {
          reg.installing.addEventListener('statechange', function() {
            if (this.state === 'activated') window.location.reload();
          });
        }
      }).catch(() => {});
  }

  function toProxy(url) {
    if (!url || typeof url !== 'string') return url;
    if (/^(data:|blob:|javascript:|mailto:|tel:|#)/.test(url)) return url;

    // Decode any double-encoding
    let clean = url;
    for (let i = 0; i < 3; i++) {
      try {
        const d = decodeURIComponent(clean);
        if (d === clean) break;
        if (!/^https?:\/\//i.test(d) && !d.startsWith('/') && !d.startsWith('.')) break;
        clean = d;
      } catch(e) { break; }
    }

    // Already proxied — normalise
    if (clean.startsWith(PROXY_PATH)) {
      try {
        const inner = new URLSearchParams(clean.slice('/proxy?'.length)).get('url');
        if (inner) {
          let decoded = inner;
          for (let i = 0; i < 3; i++) {
            const d = decodeURIComponent(decoded);
            if (d === decoded || !/^https?:\/\//i.test(d)) break;
            decoded = d;
          }
          new URL(decoded);
          return PROXY_PATH + encodeURIComponent(decoded);
        }
      } catch(e) {}
      return clean;
    }

    if (clean.startsWith(MY_ORIGIN + PROXY_PATH)) {
      return clean.slice(MY_ORIGIN.length);
    }

    if (/^https?:\/\//i.test(clean)) {
      return PROXY_PATH + encodeURIComponent(clean);
    }

    if (clean.startsWith('//')) {
      return PROXY_PATH + encodeURIComponent('https:' + clean);
    }

    if (realBase) {
      try {
        const abs = new URL(clean, realBase).href;
        return PROXY_PATH + encodeURIComponent(abs);
      } catch(e) {}
    }

    return url;
  }

  // Patch location.href
  try {
    const desc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
    Object.defineProperty(Location.prototype, 'href', {
      set(v) { desc.set.call(this, toProxy(String(v))); },
      get()  { return desc.get.call(this); },
      configurable: true,
    });
  } catch(e) {}

  // Patch location.assign / replace
  try {
    const _a = Location.prototype.assign;
    const _r = Location.prototype.replace;
    Location.prototype.assign  = function(u) { _a.call(this, toProxy(String(u))); };
    Location.prototype.replace = function(u) { _r.call(this, toProxy(String(u))); };
  } catch(e) {}

  // Patch history
  const _push = history.pushState.bind(history);
  const _rep  = history.replaceState.bind(history);
  history.pushState    = (s,t,u) => _push(s, t, u != null ? toProxy(String(u)) : u);
  history.replaceState = (s,t,u) => _rep(s,  t, u != null ? toProxy(String(u)) : u);

  // Patch fetch
  const _fetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    if (input instanceof Request) {
      const p = toProxy(input.url);
      if (p !== input.url) input = new Request(p, {
        method: input.method, headers: input.headers,
        body: input.body, mode: 'cors', credentials: 'omit',
      });
    } else {
      input = toProxy(String(input));
    }
    return _fetch(input, init);
  };

  // Patch XHR
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, u, ...r) {
    return _open.call(this, m, toProxy(String(u)), ...r);
  };

  // Patch window.open
  const _wopen = window.open.bind(window);
  window.open = (u, ...a) => _wopen(u ? toProxy(String(u)) : u, ...a);

  // Intercept <a> clicks
  document.addEventListener('click', function(e) {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || /^(#|javascript:|mailto:|tel:)/.test(href)) return;
    const p = toProxy(href);
    if (p !== href) {
      e.preventDefault();
      e.stopPropagation();
      window.location.href = p;
    }
  }, true);

  // Intercept form submits
  document.addEventListener('submit', function(e) {
    const f = e.target;
    if (f.action) {
      const p = toProxy(f.action);
      if (p !== f.action) f.action = p;
    }
  }, true);

  // Patch createElement
  const _create = document.createElement.bind(document);
  document.createElement = function(tag, ...args) {
    const el = _create(tag, ...args);
    const t  = tag.toLowerCase();
    if (t === 'script' || t === 'img' || t === 'iframe') {
      try {
        const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'src');
        if (d) Object.defineProperty(el, 'src', {
          set(v) { d.set.call(this, toProxy(String(v))); },
          get()  { return d.get.call(this); },
          configurable: true,
        });
      } catch(e) {}
    }
    if (t === 'link') {
      try {
        const d = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'href');
        if (d) Object.defineProperty(el, 'href', {
          set(v) { d.set.call(this, toProxy(String(v))); },
          get()  { return d.get.call(this); },
          configurable: true,
        });
      } catch(e) {}
    }
    return el;
  };

})();
