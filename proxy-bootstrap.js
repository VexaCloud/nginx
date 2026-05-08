// proxy-bootstrap.js
(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const realUrl = params.get('url');
  if (!realUrl) return;

  const realParsed = new URL(realUrl);
  const realOrigin = realParsed.origin;
  const realHref = realParsed.href;
  const PROXY_PREFIX = '/proxy?url=';

  function toProxy(url) {
    if (!url || typeof url !== 'string' || url.includes(PROXY_PREFIX)) return url;
    if (/^(data:|blob:|javascript:|mailto:|tel:|#)/i.test(url)) return url;

    try {
      if (url.startsWith('//')) url = 'https:' + url;
      const absolute = /^https?:\/\//i.test(url) ? url : new URL(url, realHref).href;
      return PROXY_PREFIX + encodeURIComponent(absolute);
    } catch (e) { return url; }
  }

  // === AGGRESSIVE LOCATION SPOOFING ===
  Object.defineProperty(window, 'location', {
    value: new Proxy(window.location, {
      get(target, prop) {
        if (prop === 'href') return realHref;
        if (prop === 'origin') return realOrigin;
        if (prop === 'hostname') return realParsed.hostname;
        if (prop === 'host') return realParsed.host;
        return target[prop];
      },
      set(target, prop, value) {
        if (prop === 'href') {
          window.location.assign(value);
          return true;
        }
        target[prop] = value;
        return true;
      }
    }),
    configurable: true
  });

  const _assign = Location.prototype.assign;
  Location.prototype.assign = function(url) { _assign.call(this, toProxy(url)); };
  Location.prototype.replace = function(url) { Location.prototype.assign.call(this, url); };

  window.location.assign = Location.prototype.assign;
  window.location.replace = Location.prototype.replace;

  // History API
  const _push = history.pushState;
  history.pushState = (s,t,url) => _push.call(history, s, t, url ? toProxy(url) : url);

  // fetch, XHR, open, clicks
  const _fetch = window.fetch;
  window.fetch = (input, init) => _fetch(toProxy(input), init);

  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, url, ...r) { _open.call(this, m, toProxy(url), ...r); };

  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (a) {
      const href = a.getAttribute('href');
      if (href && !/^(#|javascript:|mailto:)/i.test(href)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        window.location.href = toProxy(href);
      }
    }
  }, true);

  // Register SW
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' });
  }
})();
