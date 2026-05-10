// proxy-bootstrap.js — injected into every proxied HTML page
(function () {
  'use strict';

  const MY_ORIGIN  = window.location.origin;
  const PROXY_PATH = '/proxy?url=';

  // ── Dynamic real URL resolution ────────────────────────────────────────
  // CRITICAL: Do NOT cache realBase at startup - it must be re-evaluated
  // on every toProxy() call because history.pushState() changes window.location.
  function getRealBase() {
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
      return new URL(u).href;
    } catch(e) { return null; }
  }

  function getRealOrigin() {
    try {
      const base = getRealBase();
      return base ? new URL(base).origin : null;
    } catch(e) { return null; }
  }

  // ── Fix duplicate <base> tags ───────────────────────────────────────────
  // nginx injects <base href="origin/"> first. Page may have its own <base> after it.
  // HTML spec: first base wins. Remove extras to avoid confusion.
  function fixBaseTags() {
    const bases = document.querySelectorAll('base');
    const realOrigin = getRealOrigin();
    if (bases.length > 0 && realOrigin) {
      bases[0].href = realOrigin + '/';
      for (let i = 1; i < bases.length; i++) bases[i].remove();
    }
  }
  // Fix now and again after DOM is ready
  fixBaseTags();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fixBaseTags);
  }

  // ── Register Service Worker ────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        if (reg.installing) {
          reg.installing.addEventListener('statechange', function() {
            if (this.state === 'activated') window.location.reload();
          });
        }
      })
      .catch(() => {});
  }

  // ── Core URL rewriter ──────────────────────────────────────────────────
  function toProxy(url) {
    if (!url || typeof url !== 'string') return url;

    // Non-navigable schemes
    if (/^(data:|blob:|javascript:|mailto:|tel:)/.test(url)) return url;

    // Pure hash change — don't proxy, just navigate within current page
    if (url.startsWith('#')) return url;

    // Decode double-encoding
    let clean = url;
    for (let i = 0; i < 3; i++) {
      try {
        const d = decodeURIComponent(clean);
        if (d === clean) break;
        if (!/^https?:\/\//i.test(d) && !d.startsWith('/') && !d.startsWith('.') && !d.startsWith('?') && !d.startsWith('#')) break;
        clean = d;
      } catch(e) { break; }
    }

    // Already correctly proxied — normalise to avoid double-encoding
    if (clean.startsWith(PROXY_PATH)) {
      try {
        const inner = new URLSearchParams(clean.slice(PROXY_PATH.length - 1)).get('url');
        if (inner) {
          const decoded = fullyDecode(inner);
          new URL(decoded);
          return PROXY_PATH + encodeURIComponent(decoded);
        }
      } catch(e) {}
      return clean;
    }
    if (clean.startsWith(MY_ORIGIN + PROXY_PATH)) return clean.slice(MY_ORIGIN.length);

    // Absolute http/https
    if (/^https?:\/\//i.test(clean)) return PROXY_PATH + encodeURIComponent(clean);

    // Protocol-relative
    if (clean.startsWith('//')) return PROXY_PATH + encodeURIComponent('https:' + clean);

    // Pure query string or hash on current page — don't rewrite
    if (clean.startsWith('?') || clean.startsWith('#')) return clean;

    // Relative path — resolve against CURRENT real base (dynamic, not cached)
    const realBase = getRealBase();
    if (realBase) {
      try {
        const abs = new URL(clean, realBase).href;
        return PROXY_PATH + encodeURIComponent(abs);
      } catch(e) {}
    }

    return url;
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

  // ── Patch location.href ────────────────────────────────────────────────
  try {
    const desc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
    if (desc && desc.set) {
      Object.defineProperty(Location.prototype, 'href', {
        set(v) {
          const p = toProxy(String(v));
          desc.set.call(this, p);
        },
        get() { return desc.get.call(this); },
        configurable: true,
      });
    }
  } catch(e) {}

  // ── Patch location.assign / replace ───────────────────────────────────
  try {
    const _a = Location.prototype.assign;
    const _r = Location.prototype.replace;
    Location.prototype.assign  = function(u) { _a.call(this, toProxy(String(u))); };
    Location.prototype.replace = function(u) { _r.call(this, toProxy(String(u))); };
  } catch(e) {}

  // ── Patch history.pushState / replaceState ─────────────────────────────
  // IMPORTANT: Sites use pushState for SPA navigation (React Router, Next.js etc.)
  // We rewrite the URL so the browser's address bar shows /proxy?url=...
  // and getRealBase() correctly returns the new URL on subsequent calls.
  const _push = history.pushState.bind(history);
  const _rep  = history.replaceState.bind(history);
  history.pushState = function(s, t, u) {
    if (u == null) return _push(s, t, u);
    const str = String(u);
    // Don't rewrite if it's already a proxy URL
    if (str.startsWith(PROXY_PATH) || str.startsWith(MY_ORIGIN + PROXY_PATH)) {
      return _push(s, t, str);
    }
    _push(s, t, toProxy(str));
  };
  history.replaceState = function(s, t, u) {
    if (u == null) return _rep(s, t, u);
    const str = String(u);
    if (str.startsWith(PROXY_PATH) || str.startsWith(MY_ORIGIN + PROXY_PATH)) {
      return _rep(s, t, str);
    }
    _rep(s, t, toProxy(str));
  };

  // ── Patch fetch() ──────────────────────────────────────────────────────
  const _fetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    try {
      if (input instanceof Request) {
        const p = toProxy(input.url);
        if (p !== input.url) {
          input = new Request(p, {
            method:      input.method,
            headers:     input.headers,
            body:        input.body,
            mode:        'cors',
            credentials: 'omit',
          });
        }
      } else {
        input = toProxy(String(input));
      }
    } catch(e) {}
    return _fetch(input, init);
  };

  // ── Patch XMLHttpRequest ───────────────────────────────────────────────
  const _xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    let proxied = url;
    try { proxied = toProxy(String(url)); } catch(e) {}
    return _xhrOpen.call(this, method, proxied, ...rest);
  };

  // ── Patch window.open ──────────────────────────────────────────────────
  const _wopen = window.open.bind(window);
  window.open = function(u, ...args) {
    return _wopen(u ? toProxy(String(u)) : u, ...args);
  };

  // ── Intercept <a> clicks ───────────────────────────────────────────────
  document.addEventListener('click', function(e) {
    // Don't intercept if modifier keys held (open in new tab etc.)
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;

    const a = e.target.closest('a[href]');
    if (!a) return;

    const rawHref = a.getAttribute('href');
    if (!rawHref) return;
    if (/^(#|javascript:|mailto:|tel:)/.test(rawHref)) return;

    // Use a.href (browser-resolved, considering <base> tag) for accuracy
    const resolved = a.href;
    if (!resolved) return;

    // If it already points to our proxy, let it go normally
    if (resolved.startsWith(MY_ORIGIN + PROXY_PATH)) return;

    // If it points elsewhere, proxy it
    const proxied = toProxy(resolved);
    if (proxied !== resolved) {
      e.preventDefault();
      e.stopPropagation();
      window.location.href = proxied;
    }
  }, true);

  // ── Intercept <form> submissions ───────────────────────────────────────
  document.addEventListener('submit', function(e) {
    const form = e.target;
    if (!form) return;
    const action = form.action;
    if (!action) return;
    if (action.startsWith(MY_ORIGIN + PROXY_PATH)) return;
    const proxied = toProxy(action);
    if (proxied !== action) form.action = proxied;
  }, true);

  // ── Patch document.createElement ──────────────────────────────────────
  const _createElement = document.createElement.bind(document);
  document.createElement = function(tag, ...args) {
    const el = _createElement(tag, ...args);
    const t = String(tag).toLowerCase();

    if (t === 'script' || t === 'img' || t === 'iframe' || t === 'video' || t === 'audio' || t === 'source') {
      try {
        const proto = Object.getPrototypeOf(el);
        const d = Object.getOwnPropertyDescriptor(proto, 'src');
        if (d && d.set) {
          Object.defineProperty(el, 'src', {
            set(v) { d.set.call(this, toProxy(String(v))); },
            get()  { return d.get.call(this); },
            configurable: true,
          });
        }
      } catch(e) {}
    }

    if (t === 'link' || t === 'a') {
      try {
        const proto = Object.getPrototypeOf(el);
        const d = Object.getOwnPropertyDescriptor(proto, 'href');
        if (d && d.set) {
          Object.defineProperty(el, 'href', {
            set(v) { d.set.call(this, toProxy(String(v))); },
            get()  { return d.get.call(this); },
            configurable: true,
          });
        }
      } catch(e) {}
    }

    return el;
  };

  // ── Patch WebSocket (can't proxy, fail gracefully) ─────────────────────
  try {
    const _WS = window.WebSocket;
    window.WebSocket = function(url, protocols) {
      const fakeWs = Object.create(_WS.prototype);
      Object.assign(fakeWs, {
        readyState: 3, send() {}, close() {},
        addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
      });
      setTimeout(() => {
        if (typeof fakeWs.onerror === 'function') fakeWs.onerror(new Event('error'));
        if (typeof fakeWs.onclose === 'function') fakeWs.onclose({ code: 1001, reason: 'Proxy' });
      }, 0);
      return fakeWs;
    };
    Object.assign(window.WebSocket, { CONNECTING:0, OPEN:1, CLOSING:2, CLOSED:3, prototype: _WS.prototype });
  } catch(e) {}

  // ── MutationObserver: patch dynamically added <a> and <img> ───────────
  // Catches cases where framework renders links/images after initial load
  try {
    const observer = new MutationObserver(function(mutations) {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          // Check the node itself and its descendants
          const els = [node, ...node.querySelectorAll('a[href], img[src], script[src], link[href], iframe[src]')];
          for (const el of els) {
            const tag = el.tagName ? el.tagName.toLowerCase() : '';
            if ((tag === 'a' || tag === 'link') && el.getAttribute('href')) {
              const raw = el.getAttribute('href');
              const p = toProxy(raw);
              if (p !== raw) el.setAttribute('href', p);
            }
            if (['img','script','iframe','source'].includes(tag) && el.getAttribute('src')) {
              const raw = el.getAttribute('src');
              const p = toProxy(raw);
              if (p !== raw) el.setAttribute('src', p);
            }
          }
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } catch(e) {}

})();
