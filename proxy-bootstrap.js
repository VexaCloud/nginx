// proxy-bootstrap.js
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const realUrl = params.get('url');
  if (!realUrl) return;

  const realBase = realUrl;
  const PREFIX = '/proxy?url=';

  function toProxy(url) {
    if (!url || typeof url !== 'string' || url.includes(PREFIX)) return url;
    if (/^(data:|blob:|javascript:|#|mailto:)/i.test(url)) return url;

    try {
      if (url.startsWith('//')) url = 'https:' + url;
      const abs = /^https?:\/\//i.test(url) ? url : new URL(url, realBase).href;
      return PREFIX + encodeURIComponent(abs);
    } catch { return url; }
  }

  // Register SW + send real base
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        const msg = { type: 'SET_CONTEXT', base: realBase };
        const sw = reg.installing || reg.waiting || reg.active;
        if (sw) sw.postMessage(msg);
        if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage(msg);
      });
  }

  // Basic navigation protection
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (a) {
      const href = a.getAttribute('href');
      if (href && !/^(#|javascript:|mailto:)/i.test(href)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        location.href = toProxy(href);
      }
    }
  }, true);
})();
