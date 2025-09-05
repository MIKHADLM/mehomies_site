'use strict';
// Client-side access gating to ensure visitors land on coming-soon unless they have session access
(function () {
  try {
    var path = (window.location && window.location.pathname) || '';
    // Allow the coming soon page and the payment return confirmation page
    if (/coming-soon\.html$/.test(path) || /confirmation\.html$/.test(path)) return;
    // Only gate top-level pages of the site (html or root)
    var isHtmlPage = /\.html$/.test(path) || path === '/' || path === '';
    if (!isHtmlPage) return;
    // Ask server if access cookie is valid
    fetch('/api/check-access', { method: 'GET', credentials: 'include' })
      .then(function (r) { if (r.ok) return; throw new Error('no access'); })
      .catch(function () {
        window.location.replace('/coming-soon.html');
      });
  } catch (_) {
    // no-op: fail closed on errors is fine
  }
})();
