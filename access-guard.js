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
    // If not granted access via session, redirect to coming soon
    var hasAccess = null;
    try { hasAccess = window.sessionStorage.getItem('hasAccess'); } catch (_) { hasAccess = null; }
    if (hasAccess !== 'true') {
      window.location.replace('/coming-soon.html');
    }
  } catch (_) {
    // no-op: fail closed on errors is fine
  }
})();
