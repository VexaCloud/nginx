// proxy-bootstrap.js
(function () {
  const params = new URLSearchParams(location.search);
  const realUrl = params.get('url');
  if (!realUrl) return;

  const realBase = realUrl;

  function toProxy(url) {
    if (!url || typeof url !== 'string' || url.includes('/proxy?url=')) return url;
    if (/^(data:|blob:|javascript:|#|mailto:)/i.test(url)) return url;

    try {
      if (url.startsWith('//')) url = 'https:' + url;
      const abs = /^https?:\/\//i.test(url) ? url : new URL(url, realBase).href;
      return '/proxy?url=' + encodeURIComponent(abs);
    } catch { return url; }
  }

  // Send real base to Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        const sw = reg.installing || reg.waiting || reg.active;
        if (sw) sw.postMessage({ type: 'SET_CONTEXT', base: realBase });
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'SET_CONTEXT', base: realBase });
        }
      });
  }

  // Click protection
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
