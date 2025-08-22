// Auto-gap and seamless ticker with a single authored content block
(function () {
  const wrap = document.querySelector('.ticker__wrap');
  const inner = document.querySelector('.ticker__inner');
  const content = inner ? inner.querySelector('.ticker__content') : null;
  if (!wrap || !inner || !content) return;

  function recalc() {
    // Pause animation to avoid visible jumps during layout changes
    const prevState = inner.style.animationPlayState;
    inner.style.animationPlayState = 'paused';

    const items = Array.from(content.children);
    if (items.length === 0) return;

    const wrapWidth = wrap.clientWidth;
    const itemWidths = items.map((el) => el.getBoundingClientRect().width);
    const totalItemsWidth = itemWidths.reduce((a, b) => a + b, 0);
    const count = items.length;

    // Base gap: fill remaining space evenly if content is narrower than the wrap
    let gap = 24; // default when already wider than wrap
    if (totalItemsWidth < wrapWidth) {
      gap = Math.max(12, Math.floor((wrapWidth - totalItemsWidth) / count));
    }

    // No gap between the two content blocks (jointure)
    inner.style.gap = '0px';
    content.style.gap = gap + 'px';

    // If still not wide enough (due to rounding), increase gap slightly
    const currentWidth = content.scrollWidth;
    if (currentWidth < wrapWidth) {
      const extra = Math.ceil((wrapWidth - currentWidth) / count);
      const newGap = gap + extra;
      content.style.gap = newGap + 'px';
    }

    // Remove previous clones and append exactly one clone
    inner.querySelectorAll('.ticker__content[aria-hidden="true"]').forEach((n) => n.remove());
    const clone = content.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    // Ensure the space between last and first equals the item gap
    const computedGap = getComputedStyle(content).gap || (gap + 'px');
    clone.style.marginLeft = computedGap;
    inner.appendChild(clone);

    // Force reflow then resume animation
    void inner.offsetWidth;
    inner.style.animationPlayState = prevState || 'running';
  }

  function onReady(fn) {
    if (document.readyState === 'complete') fn();
    else window.addEventListener('load', fn);
  }

  onReady(recalc);

  // Recalculate when webfonts finish loading to avoid width shifts mid-animation
  if (document.fonts && typeof document.fonts.ready?.then === 'function') {
    document.fonts.ready.then(recalc).catch(() => {});
    if (typeof document.fonts.addEventListener === 'function') {
      document.fonts.addEventListener('loadingdone', recalc);
    }
  }

  let t;
  const onResize = () => {
    window.clearTimeout(t);
    t = window.setTimeout(recalc, 120);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
})();
