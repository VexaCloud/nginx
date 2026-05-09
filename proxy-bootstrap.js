// proxy-bootstrap.js
// Injected into every proxied HTML page via nginx sub_filter '<head>'.
// Works alongside the <base> tag (also injected by nginx) and the Service Worker.
//
// Architecture:
//   nginx injects: <base href="https://real-origin/"> — makes relative URLs absolute to real site
//   SW intercepts: those absolute external requests and proxies them
//   Bootstrap patches: JS navigation, fetch, XHR, clicks so they all stay in proxy
//   Bootstrap also: handles the SW first-install reload

(function () {
  'use strict';

  // ── Get the real URL this page represents ───────────────────────────────
  // Our page URL is always /proxy?url=<encoded-target>
  function getRealParsed() {
    try {
      const raw = new URLSearchParams(window.location.search).get('url');
      if (!raw) return null;
      // Decode carefully — avoid double-decoding non-URL strings
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
  const realOrigin = realParsed ? realParsed.origin : null; // https://www.crazygames.com
  const realBase   = realParsed ? realParsed.href   : null; // full URL for relative resolution
  const MY_ORIGIN  = window.location.origin;
  const PROXY_PATH = '/proxy?url=';

  // ── Ensure <base> tag points to real origin ──────────────────────────────
  // nginx injects <base href="origin/"> but the page may have its own <base> tag after ours.
  // Remove any duplicate base tags (keep only the first one we injected).
  if (realOrigin) {
    const bases = document.querySelectorAll('base');
    // Keep first, remove rest
    for (let i = 1; i < bases.length; i++) bases[i].remove();
    // Make sure the first one has the right href
    if (bases.length > 0) bases[0].href = realOrigin + '/';
  }

  // ── Register Service Worker ──────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        if (reg.installing) {
          // SW is brand new — wait for it to activate then reload so it can
          // intercept all sub-resource requests on the next page load
          reg.installing.addEventListener('statechange', function() {
            if (this.state === 'activated') {
              window.location.reload();
            }
          });
        }
      })
      .catch(() => {
        // SW unavailable (HTTP, private mode, etc.) — bootstrap JS patches cover it
      });
  }

  // ── Core URL rewriter ────────────────────────────────────────────────────
  function toProxy(url) {
    if (!url || typeof url !== 'string') return url;

    // Leave non-navigable schemes alone
    if (/^(data:|blob:|javascript:|mailto:|tel:|#)/.test(url)) return url;

    // Decode any double-encoding
    let clean = url;
    for (let i = 0; i < 3; i++) {
      try {
        const d = decodeURIComponent(clean);
        if (d === clean) break;
        // Only keep decoding if result looks like a URL or path
        if (!/^https?:\/\//i.test(d) && !d.startsWith('/') && !d.startsWith('.') && !d.startsWith('?')) break;
        clean = d;
      } catch(e) { break; }
    }

    // Already correctly proxied — normalise to avoid double-encoding
    if (clean.startsWith(PROXY_PATH)) {
      try {
        const qs = clean.slice(PROXY_PATH.length - 1);  // "?url=..."
        const inner = new URLSearchParams('?' + qs.slice(1)).get('url');
        if (inner) {
          const decoded = fullyDecode(inner);
          new URL(decoded); // validate it's a real URL
          return PROXY_PATH + encodeURIComponent(decoded);
        }
      } catch(e) {}
      return clean;
    }

    // Strip our own origin prefix if present
    if (clean.startsWith(MY_ORIGIN + PROXY_PATH)) {
      return clean.slice(MY_ORIGIN.length);
    }

    // Absolute http/https
    if (/^https?:\/\//i.test(clean)) {
      return PROXY_PATH + encodeURIComponent(clean);
    }

    // Protocol-relative //example.com/path
    if (clean.startsWith('//')) {
      return PROXY_PATH + encodeURIComponent('https:' + clean);
    }

    // Relative path — resolve against real page base URL
    if (realBase) {
      try {
        const abs = new URL(clean, realBase).href;
        return PROXY_PATH + encodeURIComponent(abs);
      } catch(e) {}
    }

    return url; // can't determine how to proxy, leave as-is
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

  // ── Patch window.location.href ───────────────────────────────────────────
  try {
    const desc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
    if (desc && desc.set) {
      Object.defineProperty(Location.prototype, 'href', {
        set(v) { desc.set.call(this, toProxy(String(v))); },
        get()  { return desc.get.call(this); },
        configurable: true,
      });
    }
  } catch(e) {}

  // ── Patch location.assign and location.replace ───────────────────────────
  try {
    const _assign  = Location.prototype.assign;
    const _replace = Location.prototype.replace;
    Location.prototype.assign  = function(u) { _assign.call(this,  toProxy(String(u))); };
    Location.prototype.replace = function(u) { _replace.call(this, toProxy(String(u))); };
  } catch(e) {}

  // ── Patch history.pushState / replaceState ───────────────────────────────
  // Sites use these for SPA navigation (React Router, Next.js, etc.)
  const _push = history.pushState.bind(history);
  const _rep  = history.replaceState.bind(history);
  history.pushState    = (s, t, u) => _push(s, t, u != null ? toProxy(String(u)) : u);
  history.replaceState = (s, t, u) => _rep(s,  t, u != null ? toProxy(String(u)) : u);

  // ── Patch fetch() ────────────────────────────────────────────────────────
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

  // ── Patch XMLHttpRequest ─────────────────────────────────────────────────
  const _xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    let proxied = url;
    try { proxied = toProxy(String(url)); } catch(e) {}
    return _xhrOpen.call(this, method, proxied, ...rest);
  };

  // ── Patch window.open ────────────────────────────────────────────────────
  const _wopen = window.open.bind(window);
  window.open = function(u, ...args) {
    return _wopen(u ? toProxy(String(u)) : u, ...args);
  };

  // ── Intercept <a> clicks BEFORE the browser navigates ───────────────────
  // Use capture phase so we run before the page's own click handlers
  document.addEventListener('click', function(e) {
    // Walk up from target in case click was on a child element of <a>
    const a = e.target.closest('a[href]');
    if (!a) return;

    const href = a.getAttribute('href');
    if (!href) return;
    if (/^(#|javascript:|mailto:|tel:)/.test(href)) return;

    // With <base> tag, a.href gives us the already-resolved absolute URL
    // Use that instead of the raw attribute for accuracy
    const resolved = a.href || href;
    const proxied = toProxy(resolved);

    if (proxied !== resolved && proxied !== href) {
      e.preventDefault();
      e.stopPropagation();
      window.location.href = proxied;
    }
  }, true); // capture = true: fires before page handlers

  // ── Intercept <form> submissions ─────────────────────────────────────────
  document.addEventListener('submit', function(e) {
    const form = e.target;
    if (!form) return;
    // form.action gives the resolved absolute URL (like a.href)
    const action = form.action || '';
    if (action && !action.startsWith(MY_ORIGIN + PROXY_PATH)) {
      const proxied = toProxy(action);
      if (proxied !== action) form.action = proxied;
    }
  }, true);

  // ── Patch document.createElement for dynamic elements ───────────────────
  // Catches scripts/images/iframes created and src-set dynamically by JS
  const _createElement = document.createElement.bind(document);
  document.createElement = function(tag, ...args) {
    const el = _createElement(tag, ...args);
    const t = String(tag).toLowerCase();

    if (t === 'script' || t === 'img' || t === 'iframe' || t === 'video' || t === 'audio') {
      try {
        const proto = Object.getPrototypeOf(el);
        const srcDesc = Object.getOwnPropertyDescriptor(proto, 'src')
          || Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'src');
        if (srcDesc && srcDesc.set) {
          Object.defineProperty(el, 'src', {
            set(v) { srcDesc.set.call(this, toProxy(String(v))); },
            get()  { return srcDesc.get.call(this); },
            configurable: true,
          });
        }
      } catch(e) {}
    }

    if (t === 'link') {
      try {
        const hrefDesc = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'href');
        if (hrefDesc && hrefDesc.set) {
          Object.defineProperty(el, 'href', {
            set(v) { hrefDesc.set.call(this, toProxy(String(v))); },
            get()  { return hrefDesc.get.call(this); },
            configurable: true,
          });
        }
      } catch(e) {}
    }

    if (t === 'a') {
      try {
        const hrefDesc = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'href');
        if (hrefDesc && hrefDesc.set) {
          Object.defineProperty(el, 'href', {
            set(v) { hrefDesc.set.call(this, toProxy(String(v))); },
            get()  { return hrefDesc.get.call(this); },
            configurable: true,
          });
        }
      } catch(e) {}
    }

    return el;
  };

  // ── Patch WebSocket ──────────────────────────────────────────────────────
  // Proxy can't tunnel WebSockets, so intercept and let it fail gracefully
  // rather than connecting directly to the real site
  const _WebSocket = window.WebSocket;
  if (_WebSocket) {
    window.WebSocket = function(url, protocols) {
      // Convert ws:// and wss:// to https:// proxy URL
      // Most sites degrade gracefully if WS fails
      try {
        const wsUrl = String(url).replace(/^wss?:\/\//, (m) =>
          m === 'wss://' ? 'https://' : 'http://'
        );
        // We can't truly proxy WebSockets through nginx without extra modules
        // Return a fake closed WebSocket so the page doesn't crash
        const fakeWs = {
          readyState: 3, // CLOSED
          send: () => {},
          close: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
          CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3,
        };
        setTimeout(() => {
          if (typeof fakeWs.onclose === 'function') fakeWs.onclose({ code: 1001 });
          if (typeof fakeWs.onerror === 'function') fakeWs.onerror(new Event('error'));
        }, 0);
        return fakeWs;
      } catch(e) {
        return new _WebSocket(url, protocols);
      }
    };
    window.WebSocket.prototype = _WebSocket.prototype;
    window.WebSocket.CONNECTING = 0;
    window.WebSocket.OPEN = 1;
    window.WebSocket.CLOSING = 2;
    window.WebSocket.CLOSED = 3;
  }

})();
