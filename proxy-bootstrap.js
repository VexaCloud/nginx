// proxy-bootstrap.js — injected into every proxied HTML page
(function () {
  'use strict';

  var MY_ORIGIN  = window.location.origin;
  var PROXY_PATH = '/proxy?url=';

  // Dynamic — re-read on every call because history.pushState changes window.location
  function getRealBase() {
    try {
      var raw = new URLSearchParams(window.location.search).get('url');
      if (!raw) return null;
      var u = raw;
      for (var i = 0; i < 3; i++) {
        var d = decodeURIComponent(u);
        if (d === u || !/^https?:\/\//i.test(d)) break;
        u = d;
      }
      return new URL(u).href;
    } catch(e) { return null; }
  }

  function getRealOrigin() {
    try { var b = getRealBase(); return b ? new URL(b).origin : null; } catch(e) { return null; }
  }

  // Fix <base> tags — keep ours (first), remove any the page added
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

  // Inject favicon through proxy
  function injectFavicon() {
    var origin = getRealOrigin();
    if (!origin) return;
    var existing = document.querySelector('link[rel~="icon"]');
    if (existing) {
      var href = existing.getAttribute('href') || '';
      if (href && href.indexOf(PROXY_PATH) === -1 && href.indexOf('data:') !== 0) {
        try {
          var abs = new URL(href, origin + '/').href;
          existing.setAttribute('href', PROXY_PATH + encodeURIComponent(abs));
        } catch(e) {}
      }
      return;
    }
    var link = document.createElement('link');
    link.rel = 'icon';
    link.setAttribute('href', PROXY_PATH + encodeURIComponent(origin + '/favicon.ico'));
    document.head.appendChild(link);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectFavicon);
  } else {
    injectFavicon();
  }

  // Register Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(function(reg) {
        if (reg.installing) {
          reg.installing.addEventListener('statechange', function() {
            if (this.state === 'activated') window.location.reload();
          });
        }
      }).catch(function() {});
  }

  // ── Core URL rewriter ─────────────────────────────────────────────────
  function toProxy(url) {
    if (!url || typeof url !== 'string') return url;
    if (/^(data:|blob:|javascript:|mailto:|tel:)/.test(url)) return url;
    if (url.charAt(0) === '#') return url;

    // Decode any double-encoding
    var clean = url;
    for (var i = 0; i < 3; i++) {
      try {
        var d = decodeURIComponent(clean);
        if (d === clean) break;
        if (!/^https?:\/\//i.test(d) && d.charAt(0) !== '/' &&
            d.charAt(0) !== '.' && d.charAt(0) !== '?') break;
        clean = d;
      } catch(e) { break; }
    }

    // Already a proxy path — return as-is (don't double-proxy)
    if (clean.indexOf(PROXY_PATH) === 0) return clean;
    if (clean.indexOf(MY_ORIGIN + PROXY_PATH) === 0) return clean.slice(MY_ORIGIN.length);

    // Absolute http/https
    if (/^https?:\/\//i.test(clean)) return PROXY_PATH + encodeURIComponent(clean);

    // Protocol-relative
    if (clean.indexOf('//') === 0) return PROXY_PATH + encodeURIComponent('https:' + clean);

    // Pure query string — stays on same page
    if (clean.charAt(0) === '?') return clean;

    // Relative path — resolve against current real base
    var base = getRealBase();
    if (base) {
      try { return PROXY_PATH + encodeURIComponent(new URL(clean, base).href); } catch(e) {}
    }
    return url;
  }

  // Patch location.href
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

  // Patch location.assign / replace
  try {
    var _la = Location.prototype.assign;
    var _lr = Location.prototype.replace;
    Location.prototype.assign  = function(u) { _la.call(this, toProxy(String(u))); };
    Location.prototype.replace = function(u) { _lr.call(this, toProxy(String(u))); };
  } catch(e) {}

  // Patch history
  var _push = history.pushState.bind(history);
  var _rep  = history.replaceState.bind(history);
  history.pushState = function(s, t, u) {
    if (u == null) return _push(s, t, u);
    var str = String(u);
    if (str.indexOf(PROXY_PATH) === 0 || str.indexOf(MY_ORIGIN + PROXY_PATH) === 0) return _push(s, t, str);
    return _push(s, t, toProxy(str));
  };
  history.replaceState = function(s, t, u) {
    if (u == null) return _rep(s, t, u);
    var str = String(u);
    if (str.indexOf(PROXY_PATH) === 0 || str.indexOf(MY_ORIGIN + PROXY_PATH) === 0) return _rep(s, t, str);
    return _rep(s, t, toProxy(str));
  };

  // Patch fetch
  var _fetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    try {
      if (input instanceof Request) {
        var p = toProxy(input.url);
        if (p !== input.url) input = new Request(p, { method: input.method, headers: input.headers, body: input.body, mode: 'cors', credentials: 'omit' });
      } else { input = toProxy(String(input)); }
    } catch(e) {}
    return _fetch(input, init);
  };

  // Patch XHR
  var _xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, async, user, pass) {
    var p = url; try { p = toProxy(String(url)); } catch(e) {}
    return _xhrOpen.call(this, method, p, async !== undefined ? async : true, user, pass);
  };

  // Patch window.open
  var _wopen = window.open.bind(window);
  window.open = function(u, t, f) { return _wopen(u ? toProxy(String(u)) : u, t, f); };

  // ── Intercept <a> clicks ──────────────────────────────────────────────
  document.addEventListener('click', function(e) {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

    var tgt = e.target;
    if (!tgt) return;
    var tname = (tgt.tagName || '').toLowerCase();
    // Don't intercept interactive elements — prevents search bar focus loss
    if (tname === 'input' || tname === 'textarea' ||
        tname === 'select' || tname === 'button') return;

    var a = tgt.closest('a[href]');
    if (!a) return;

    // CRITICAL FIX: use getAttribute (raw value) NOT a.href (base-resolved).
    // a.href with <base href="https://site.com/"> resolves /proxy?url=... to
    // https://site.com/proxy?url=... causing double-proxying.
    var rawHref = a.getAttribute('href');
    if (!rawHref || /^(#|javascript:|mailto:|tel:)/.test(rawHref)) return;

    // If it's already a proxy path, let it through normally
    if (rawHref.indexOf(PROXY_PATH) === 0) return;

    // If it's an absolute URL pointing to our own proxy, let it through
    if (rawHref.indexOf(MY_ORIGIN + PROXY_PATH) === 0) return;

    var proxied = toProxy(rawHref);
    if (proxied !== rawHref) {
      e.preventDefault();
      e.stopPropagation();
      window.location.href = proxied;
    }
  }, true);

  // Intercept form submits
  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (!form || !form.action) return;
    if (form.action.indexOf(MY_ORIGIN + PROXY_PATH) === 0) return;
    var p = toProxy(form.action);
    if (p !== form.action) form.action = p;
  }, true);

  // Patch createElement
  var _ce = document.createElement.bind(document);
  document.createElement = function(tag) {
    var el = _ce.apply(document, arguments);
    var t = String(tag).toLowerCase();
    if (t === 'script' || t === 'img' || t === 'iframe' ||
        t === 'video'  || t === 'audio' || t === 'source') {
      try {
        var pd = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'src');
        if (pd && pd.set) Object.defineProperty(el, 'src', {
          set: function(v) { pd.set.call(this, toProxy(String(v))); },
          get: function()  { return pd.get.call(this); },
          configurable: true,
        });
      } catch(e) {}
    }
    if (t === 'link' || t === 'a') {
      try {
        var hd = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'href');
        if (hd && hd.set) Object.defineProperty(el, 'href', {
          set: function(v) { hd.set.call(this, toProxy(String(v))); },
          get: function()  { return hd.get.call(this); },
          configurable: true,
        });
      } catch(e) {}
    }
    return el;
  };

  // MutationObserver — debounced via microtask to prevent focus loss
  var _pending = [], _timer = null;
  function _flush() {
    _timer = null;
    var nodes = _pending.splice(0);
    nodes.forEach(function(node) {
      if (node.nodeType !== 1) return;
      var els = [node];
      try { Array.prototype.push.apply(els, node.querySelectorAll('a[href],img[src],script[src],link[href],iframe[src],source[src]')); } catch(e) {}
      els.forEach(function(el) {
        if (!el || el.nodeType !== 1) return;
        var et = (el.tagName || '').toLowerCase();
        if ((et === 'a' || et === 'link') && el.hasAttribute('href')) {
          var raw = el.getAttribute('href');
          // Use raw attribute — don't use el.href which is base-resolved
          if (raw && raw.charAt(0) !== '#' && !/^javascript:/i.test(raw) &&
              raw.indexOf(PROXY_PATH) !== 0 && raw.indexOf(MY_ORIGIN) !== 0) {
            var p = toProxy(raw);
            if (p !== raw) try { el.setAttribute('href', p); } catch(e) {}
          }
        }
        if (['img','script','iframe','source','video','audio'].indexOf(et) !== -1 &&
            el.hasAttribute('src')) {
          var rs = el.getAttribute('src');
          if (rs && !/^(data:|blob:)/.test(rs) && rs.indexOf(PROXY_PATH) !== 0) {
            var ps = toProxy(rs);
            if (ps !== rs) try { el.setAttribute('src', ps); } catch(e) {}
          }
        }
      });
    });
  }
  try {
    new MutationObserver(function(muts) {
      muts.forEach(function(m) {
        m.addedNodes.forEach(function(n) { _pending.push(n); });
      });
      if (!_timer) _timer = Promise.resolve().then(_flush);
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch(e) {}

  // WebSocket — graceful failure
  try {
    var _WS = window.WebSocket;
    window.WebSocket = function() {
      var ws = { readyState: 3, send:function(){}, close:function(){},
        addEventListener:function(){}, removeEventListener:function(){},
        dispatchEvent:function(){return false;},
        CONNECTING:0, OPEN:1, CLOSING:2, CLOSED:3 };
      setTimeout(function() {
        if (typeof ws.onerror === 'function') ws.onerror(new Event('error'));
        if (typeof ws.onclose === 'function') ws.onclose({code:1001,reason:'Proxy'});
      }, 0);
      return ws;
    };
    window.WebSocket.CONNECTING=0; window.WebSocket.OPEN=1;
    window.WebSocket.CLOSING=2;   window.WebSocket.CLOSED=3;
    window.WebSocket.prototype = _WS.prototype;
  } catch(e) {}

})();
