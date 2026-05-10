// proxy-bootstrap.js — injected into every proxied HTML page via nginx sub_filter
(function () {
  'use strict';

  var MY_ORIGIN  = window.location.origin;
  var PROXY_PATH = '/proxy?url=';

  // ── Dynamic real URL (re-read on every call, not cached) ─────────────
  // Must be dynamic because history.pushState changes window.location
  function getRealBase() {
    try {
      var params = new URLSearchParams(window.location.search);
      var raw = params.get('url');
      if (!raw) return null;
      var u = raw;
      for (var i = 0; i < 3; i++) {
        var d = decodeURIComponent(u);
        if (d === u) break;
        if (!/^https?:\/\//i.test(d)) break;
        u = d;
      }
      return new URL(u).href;
    } catch(e) { return null; }
  }

  function getRealOrigin() {
    var base = getRealBase();
    if (!base) return null;
    try { return new URL(base).origin; } catch(e) { return null; }
  }

  // ── Fix duplicate <base> tags ────────────────────────────────────────
  function fixBaseTags() {
    var bases = document.querySelectorAll('base');
    var origin = getRealOrigin();
    if (bases.length > 0 && origin) {
      bases[0].href = origin + '/';
      for (var i = 1; i < bases.length; i++) bases[i].remove();
    }
  }
  fixBaseTags();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fixBaseTags);
  }

  // ── Register Service Worker ──────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(function(reg) {
        if (reg.installing) {
          reg.installing.addEventListener('statechange', function() {
            if (this.state === 'activated') window.location.reload();
          });
        }
      })
      .catch(function() {});
  }

  // ── Core URL rewriter ────────────────────────────────────────────────
  function toProxy(url) {
    if (!url || typeof url !== 'string') return url;

    // Non-navigable — leave alone
    if (/^(data:|blob:|javascript:|mailto:|tel:)/.test(url)) return url;

    // Hash-only change — never proxy, stay on current page
    if (url.charAt(0) === '#') return url;

    // Decode any double-encoding from nginx proxy_redirect etc.
    var clean = url;
    for (var i = 0; i < 3; i++) {
      try {
        var d = decodeURIComponent(clean);
        if (d === clean) break;
        if (!/^https?:\/\//i.test(d) &&
            d.charAt(0) !== '/' &&
            d.charAt(0) !== '.' &&
            d.charAt(0) !== '?') break;
        clean = d;
      } catch(e) { break; }
    }

    // Already proxied correctly
    if (clean.indexOf(PROXY_PATH) === 0) {
      return normalizeProxied(clean);
    }
    if (clean.indexOf(MY_ORIGIN + PROXY_PATH) === 0) {
      return clean.slice(MY_ORIGIN.length);
    }

    // Absolute http/https
    if (/^https?:\/\//i.test(clean)) {
      return PROXY_PATH + encodeURIComponent(clean);
    }

    // Protocol-relative //example.com/path
    if (clean.indexOf('//') === 0) {
      return PROXY_PATH + encodeURIComponent('https:' + clean);
    }

    // Pure query string — stays on same page, no proxy needed
    if (clean.charAt(0) === '?') return clean;

    // Relative path — resolve against current real base
    var realBase = getRealBase();
    if (realBase) {
      try {
        var abs = new URL(clean, realBase).href;
        return PROXY_PATH + encodeURIComponent(abs);
      } catch(e) {}
    }

    return url;
  }

  function normalizeProxied(clean) {
    try {
      var qs = clean.slice(PROXY_PATH.length - 1);
      var inner = new URLSearchParams('?' + qs.slice(1)).get('url');
      if (inner) {
        var decoded = fullyDecode(inner);
        new URL(decoded); // validate
        return PROXY_PATH + encodeURIComponent(decoded);
      }
    } catch(e) {}
    return clean;
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

  // ── Patch location.href ──────────────────────────────────────────────
  try {
    var locDesc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
    if (locDesc && locDesc.set) {
      Object.defineProperty(Location.prototype, 'href', {
        set: function(v) { locDesc.set.call(this, toProxy(String(v))); },
        get: function()  { return locDesc.get.call(this); },
        configurable: true,
      });
    }
  } catch(e) {}

  // ── Patch location.assign / replace ─────────────────────────────────
  try {
    var _locAssign  = Location.prototype.assign;
    var _locReplace = Location.prototype.replace;
    Location.prototype.assign  = function(u) { _locAssign.call(this,  toProxy(String(u))); };
    Location.prototype.replace = function(u) { _locReplace.call(this, toProxy(String(u))); };
  } catch(e) {}

  // ── Patch history.pushState / replaceState ───────────────────────────
  var _push = history.pushState.bind(history);
  var _rep  = history.replaceState.bind(history);
  history.pushState = function(s, t, u) {
    if (u == null) return _push(s, t, u);
    var str = String(u);
    if (str.indexOf(PROXY_PATH) === 0 || str.indexOf(MY_ORIGIN + PROXY_PATH) === 0) {
      return _push(s, t, str);
    }
    return _push(s, t, toProxy(str));
  };
  history.replaceState = function(s, t, u) {
    if (u == null) return _rep(s, t, u);
    var str = String(u);
    if (str.indexOf(PROXY_PATH) === 0 || str.indexOf(MY_ORIGIN + PROXY_PATH) === 0) {
      return _rep(s, t, str);
    }
    return _rep(s, t, toProxy(str));
  };

  // ── Patch fetch() ────────────────────────────────────────────────────
  var _fetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    try {
      if (input instanceof Request) {
        var p = toProxy(input.url);
        if (p !== input.url) {
          input = new Request(p, {
            method: input.method, headers: input.headers,
            body: input.body, mode: 'cors', credentials: 'omit',
          });
        }
      } else {
        input = toProxy(String(input));
      }
    } catch(e) {}
    return _fetch(input, init);
  };

  // ── Patch XMLHttpRequest ─────────────────────────────────────────────
  var _xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, async, user, pass) {
    var proxied = url;
    try { proxied = toProxy(String(url)); } catch(e) {}
    return _xhrOpen.call(this, method, proxied,
      async !== undefined ? async : true,
      user, pass);
  };

  // ── Patch window.open ────────────────────────────────────────────────
  var _wopen = window.open.bind(window);
  window.open = function(u, target, features) {
    return _wopen(u ? toProxy(String(u)) : u, target, features);
  };

  // ── Intercept <a> clicks ─────────────────────────────────────────────
  document.addEventListener('click', function(e) {
    // Never intercept modified clicks (new tab, etc.)
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

    // CRITICAL: never intercept if the actual target is an interactive element
    // This prevents the search bar focus from being stolen
    var target = e.target;
    var tag = target ? target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') return;

    // Walk up to find the <a> ancestor
    var a = target ? target.closest('a[href]') : null;
    if (!a) return;

    var rawHref = a.getAttribute('href');
    if (!rawHref) return;
    if (/^(#|javascript:|mailto:|tel:)/.test(rawHref)) return;

    // Use a.href (browser-resolved with <base> tag) for accuracy
    var resolved = a.href;
    if (!resolved) return;

    // Already going to our proxy
    if (resolved.indexOf(MY_ORIGIN + PROXY_PATH) === 0) return;
    // Already a relative proxy path
    if (resolved === MY_ORIGIN + rawHref && rawHref.indexOf(PROXY_PATH) === 0) return;

    var proxied = toProxy(resolved);
    if (proxied !== resolved) {
      e.preventDefault();
      e.stopPropagation();
      window.location.href = proxied;
    }
  }, true);

  // ── Intercept <form> submissions ─────────────────────────────────────
  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (!form || !form.action) return;
    var action = form.action;
    if (action.indexOf(MY_ORIGIN + PROXY_PATH) === 0) return;
    var proxied = toProxy(action);
    if (proxied !== action) form.action = proxied;
  }, true);

  // ── Patch createElement ──────────────────────────────────────────────
  var _createElement = document.createElement.bind(document);
  document.createElement = function(tag) {
    var el = _createElement.apply(document, arguments);
    var t = String(tag).toLowerCase();

    if (t === 'script' || t === 'img' || t === 'iframe' ||
        t === 'video'  || t === 'audio' || t === 'source') {
      try {
        var proto = Object.getPrototypeOf(el);
        var d = Object.getOwnPropertyDescriptor(proto, 'src');
        if (d && d.set) {
          Object.defineProperty(el, 'src', {
            set: function(v) { d.set.call(this, toProxy(String(v))); },
            get: function()  { return d.get.call(this); },
            configurable: true,
          });
        }
      } catch(e) {}
    }

    if (t === 'link' || t === 'a') {
      try {
        var hProto = Object.getPrototypeOf(el);
        var hd = Object.getOwnPropertyDescriptor(hProto, 'href');
        if (hd && hd.set) {
          Object.defineProperty(el, 'href', {
            set: function(v) { hd.set.call(this, toProxy(String(v))); },
            get: function()  { return hd.get.call(this); },
            configurable: true,
          });
        }
      } catch(e) {}
    }

    return el;
  };

  // ── MutationObserver for dynamically added elements ──────────────────
  // Batched and async to avoid DOM thrash that causes focus loss
  var pendingMutations = [];
  var mutationTimer = null;

  function processMutations() {
    mutationTimer = null;
    var nodes = pendingMutations.slice();
    pendingMutations = [];

    nodes.forEach(function(node) {
      if (node.nodeType !== 1) return; // elements only

      // Process node and its descendants
      var candidates = [];
      try { candidates = Array.from(node.querySelectorAll('a[href],img[src],script[src],link[href],iframe[src],source[src]')); } catch(e) {}
      // Include node itself
      candidates.unshift(node);

      candidates.forEach(function(el) {
        if (!el || el.nodeType !== 1) return;
        var elTag = (el.tagName || '').toLowerCase();

        // Rewrite href on a/link
        if ((elTag === 'a' || elTag === 'link') && el.hasAttribute('href')) {
          var raw = el.getAttribute('href');
          if (raw && raw.charAt(0) !== '#' && !/^javascript:/i.test(raw)) {
            var p = toProxy(raw);
            // Only setAttribute if changed AND it won't cause infinite loop
            if (p !== raw && el.getAttribute('href') !== p) {
              try { el.setAttribute('href', p); } catch(e) {}
            }
          }
        }

        // Rewrite src on img/script/iframe/etc
        if (['img','script','iframe','source','video','audio'].indexOf(elTag) !== -1 &&
            el.hasAttribute('src')) {
          var rawSrc = el.getAttribute('src');
          if (rawSrc && !/^(data:|blob:)/.test(rawSrc)) {
            var ps = toProxy(rawSrc);
            if (ps !== rawSrc && el.getAttribute('src') !== ps) {
              try { el.setAttribute('src', ps); } catch(e) {}
            }
          }
        }
      });
    });
  }

  try {
    var observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        m.addedNodes.forEach(function(node) {
          pendingMutations.push(node);
        });
      });
      // Debounce: process in next microtask, not synchronously
      // This prevents DOM thrash from causing input focus loss
      if (!mutationTimer) {
        mutationTimer = Promise.resolve().then(processMutations);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } catch(e) {}

  // ── Patch WebSocket (graceful failure) ──────────────────────────────
  try {
    var _WS = window.WebSocket;
    window.WebSocket = function(url, protocols) {
      var fakeWs = {
        readyState: 3, // CLOSED
        send: function() {},
        close: function() {},
        addEventListener: function() {},
        removeEventListener: function() {},
        dispatchEvent: function() { return false; },
        CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3,
      };
      setTimeout(function() {
        if (typeof fakeWs.onerror === 'function') fakeWs.onerror(new Event('error'));
        if (typeof fakeWs.onclose === 'function') fakeWs.onclose({ code: 1001, reason: 'Proxy' });
      }, 0);
      return fakeWs;
    };
    window.WebSocket.CONNECTING = 0;
    window.WebSocket.OPEN = 1;
    window.WebSocket.CLOSING = 2;
    window.WebSocket.CLOSED = 3;
    window.WebSocket.prototype = _WS.prototype;
  } catch(e) {}

})();
