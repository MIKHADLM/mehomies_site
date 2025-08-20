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
      }
    })
    .catch(() => {});
})();
