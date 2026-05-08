// proxy-bootstrap.js
(function () {
  const params = new URLSearchParams(location.search);
  const realUrl = params.get('url');
  if (!realUrl) return;

  const real = new URL(realUrl);
  const realOrigin = real.origin;
  const realHref = real.href;
  const PREFIX = '/proxy?url=';

  function toProxy(u) {
    if (!u || typeof u !== 'string' || u.includes(PREFIX)) return u;
    if (/^(data:|blob:|javascript:|#|mailto:)/i.test(u)) return u;

    try {
      if (u.startsWith('//')) u = 'https:' + u;
      const abs = /^https?:\/\//i.test(u) ? u : new URL(u, realHref).href;
      return PREFIX + encodeURIComponent(abs);
    } catch { return u; }
  }

  // Spoof location
  const locProxy = new Proxy(location, {
    get(t, p) {
      if (p === 'href') return realHref;
      if (p === 'origin') return realOrigin;
      if (p === 'hostname' || p === 'host') return real.hostname;
      return t[p];
    },
    set(t, p, v) {
      if (p === 'href') { location.assign(v); return true; }
      t[p] = v; return true;
    }
  });
  Object.defineProperty(window, 'location', { value: locProxy, configurable: true });

  // Patch navigation
  const _assign = Location.prototype.assign;
  Location.prototype.assign = function(u) { _assign.call(this, toProxy(u)); };
  Location.prototype.replace = Location.prototype.assign;

  history.pushState = (s, t, u) => History.prototype.pushState.call(history, s, t, u ? toProxy(u) : u);
  history.replaceState = (s, t, u) => History.prototype.replaceState.call(history, s, t, u ? toProxy(u) : u);

  // fetch + XHR + clicks
  const _fetch = window.fetch;
  window.fetch = (input, init) => _fetch(toProxy(input), init);

  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, url) { _open.call(this, m, toProxy(url)); };

  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (a) {
      const h = a.getAttribute('href');
      if (h && !/^(#|javascript:|mailto:)/i.test(h)) {
        e.preventDefault(); e.stopImmediatePropagation();
        location.href = toProxy(h);
      }
    }
  }, true);

  // Register SW
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', {scope: '/'})
      .then(r => r.active && r.active.postMessage({type: 'SET_CONTEXT', base: realHref}));
  }
})();
