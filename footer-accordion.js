// Mobile accordion behavior for footer sections
(function () {
  function setupAccordion() {
    const accordions = Array.from(document.querySelectorAll('#footer .accordion'));
    if (!accordions.length) return;

    // Helper: is mobile viewport
    const isMobile = () => window.matchMedia('(max-width: 600px)').matches;

    // Initialize: ensure closed on mobile, open state controlled by CSS on desktop
    function applyInitialState() {
      if (!isMobile()) {
        // Remove JS-driven classes on desktop to let CSS handle open state
        accordions.forEach(acc => acc.classList.remove('open'));
        return;
      }
      // Start collapsed on mobile
      accordions.forEach(acc => acc.classList.remove('open'));
    }

    function toggle(acc) {
      if (!isMobile()) return; // only interactive on mobile
      const isOpen = acc.classList.contains('open');
      // Optional: close others for a cleaner mobile experience
      accordions.forEach(a => a.classList.remove('open'));
      if (!isOpen) acc.classList.add('open');
    }

    accordions.forEach(acc => {
      const title = acc.querySelector('.accordion-title');
      if (!title) return;
      // Click/tap
      title.addEventListener('click', () => toggle(acc));
      // Keyboard accessibility
      title.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle(acc);
        }
      });
    });

    applyInitialState();
    // Re-evaluate on resize
    let t;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(applyInitialState, 150);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('footer:loaded', setupAccordion, { once: true });
  } else {
    setupAccordion();
  }
})();
