// Le Noyer : en-tête discret, panneau de réservation, profondeur des photos.
(() => {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const header = document.querySelector('.site-header');
  const darkZones = [...document.querySelectorAll('[data-header-over]')];
  const nav = header?.querySelector('.mobile-nav');

  /* En-tête : se cache en descendant, revient en remontant, transparent sur le relief. */
  let lastY = scrollY;
  const updateHeader = () => {
    if (!header) return;
    const y = scrollY;
    if (!nav?.open) {
      if (y > lastY + 6 && y > 140) header.classList.add('is-hidden');
      else if (y < lastY - 6 || y < 140) header.classList.remove('is-hidden');
    }
    lastY = y;
    const h = header.offsetHeight;
    header.classList.toggle('is-over', darkZones.some((z) => { const r = z.getBoundingClientRect(); return r.top <= h / 2 && r.bottom > h; }));
  };

  /* Profondeur légère des photos encadrées. */
  const depthImages = [...document.querySelectorAll('[data-depth]')];
  const updateDepth = () => {
    if (reduceMotion) return;
    const mid = innerHeight / 2;
    for (const img of depthImages) {
      const r = img.parentElement.getBoundingClientRect();
      if (r.bottom < -100 || r.top > innerHeight + 100) continue;
      const offset = (r.top + r.height / 2 - mid) / innerHeight;
      img.style.setProperty('--shift', `${(offset * -0.07 * r.height).toFixed(1)}px`);
    }
  };

  let ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { updateHeader(); updateDepth(); ticking = false; });
  }, { passive: true });
  addEventListener('resize', updateDepth);
  updateHeader();
  updateDepth();

  /* Fondu des grandes photos à leur arrivée. */
  if (!reduceMotion && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -10% 0px' });
    document.querySelectorAll('.frame').forEach((el) => {
      if (el.getBoundingClientRect().top < innerHeight) return;
      el.classList.add('reveal');
      io.observe(el);
    });
  }

  /* Panneau de réservation (accueil). Ailleurs, les liens mènent à /#reserver. */
  const panel = document.getElementById('reserver');
  if (!(panel instanceof HTMLDialogElement)) return;
  let opener = null;
  const open = () => {
    if (panel.open) return;
    opener = document.activeElement;
    if (nav) nav.open = false;
    panel.showModal();
    panel.scrollTop = 0;
    if (location.hash !== '#reserver') history.replaceState(null, '', '#reserver');
  };
  const close = () => panel.open && panel.close();
  panel.addEventListener('close', () => {
    if (location.hash === '#reserver') history.replaceState(null, '', location.pathname + location.search);
    opener?.focus?.();
  });
  document.querySelectorAll('[data-open-booking]').forEach((link) => link.addEventListener('click', (e) => { e.preventDefault(); open(); }));
  panel.querySelectorAll('[data-close-booking]').forEach((b) => b.addEventListener('click', close));
  panel.addEventListener('click', (e) => {
    const r = panel.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
  });
  addEventListener('hashchange', () => { if (location.hash === '#reserver') open(); });
  if (location.hash === '#reserver') open();
})();
