// Load header and footer (extracted from inline scripts in index.html)
(function () {
  // Load header
  fetch('header.html')
    .then(response => response.text())
    .then(data => {
      const headerEl = document.getElementById('header');
      if (headerEl) {
        headerEl.innerHTML = data;
      }
      if (typeof window.updateCartCount === 'function') {
        window.updateCartCount();
      }
    })
    .catch(() => {});

  // Load footer
  fetch('footer.html')
    .then(response => response.text())
    .then(data => {
      const footerEl = document.getElementById('footer');
      if (footerEl) {
        footerEl.innerHTML = data;
        // Notify listeners that footer content has been injected
        try { document.dispatchEvent(new CustomEvent('footer:loaded')); } catch(_) {}
        // Lazy-load newsletter logic once footer is present
        try { import('/newsletter.js'); } catch(_) {}
        // Lazy-load footer accordion behavior for mobile
        try { import('/footer-accordion.js'); } catch(_) {}
      }
    })
    .catch(() => {});
})();
