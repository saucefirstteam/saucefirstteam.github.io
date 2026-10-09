(() => {
  'use strict';

  const onMediaChange = (media, listener) => {
    if (media.addEventListener) media.addEventListener('change', listener);
    else media.addListener(listener);
  };

  function initializeMenu(menu) {
    if (menu.dataset.siteMenuReady === 'true') return;
    const summary = menu.querySelector('summary');
    const nav = menu.querySelector('nav');
    const header = menu.closest('.site-header');
    if (!summary || !nav || !header) return;
    menu.dataset.siteMenuReady = 'true';

    const mobile = matchMedia('(max-width: 991px)');
    let lastHeaderFocus = header.contains(document.activeElement) ? document.activeElement : null;
    const syncExpanded = () => summary.setAttribute('aria-expanded', String(menu.open));
    if (nav.id) summary.setAttribute('aria-controls', nav.id);

    function close(restoreFocus = false) {
      if (!menu.open) return;
      menu.open = false;
      syncExpanded();
      if (restoreFocus && mobile.matches) summary.focus({ preventScroll: true });
    }

    menu.addEventListener('toggle', syncExpanded);
    summary.addEventListener('click', () => queueMicrotask(syncExpanded));
    menu.addEventListener('focusout', event => {
      if (menu.contains(event.relatedTarget)) return;
      if (event.relatedTarget) {
        close();
        return;
      }
      requestAnimationFrame(() => {
        if (menu.open && !menu.contains(document.activeElement)) close();
      });
    });
    document.addEventListener('focusin', event => {
      lastHeaderFocus = header.contains(event.target) ? event.target : null;
      if (menu.open && !menu.contains(event.target)) close();
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || event.defaultPrevented || !menu.open) return;
      event.preventDefault();
      close(true);
    });
    document.addEventListener('pointerdown', event => {
      if (menu.open && !menu.contains(event.target)) close(nav.contains(document.activeElement));
    });
    nav.addEventListener('click', event => {
      const link = event.target?.closest?.('a[href]');
      if (link && nav.contains(link)) close(nav.contains(document.activeElement));
    });

    onMediaChange(mobile, () => {
      const active = document.activeElement;
      const previous = active === document.body ? lastHeaderFocus : active;
      if (!mobile.matches) {
        const moveFocus = menu.contains(previous);
        const href = previous?.closest?.('a[href]')?.href;
        close();
        if (moveFocus) {
          const matching = [...header.querySelectorAll('.desktop-nav a, .header-actions a')]
            .find(link => href && link.href === href && link.getClientRects().length);
          (matching || header.querySelector('.brand'))?.focus({ preventScroll: true });
        }
      } else if (previous?.closest?.('.desktop-nav, .header-actions') && header.contains(previous)) {
        summary.focus({ preventScroll: true });
      }
    });
    if (!mobile.matches) close();
    syncExpanded();
  }

  function initializeCarousel(track) {
    if (track.dataset.siteCarouselReady === 'true') return;
    const section = track.closest('section');
    if (!section) return;
    const slides = [...track.querySelectorAll('.operating-principle')];
    const prev = section.querySelector('[data-carousel-prev]');
    const next = section.querySelector('[data-carousel-next]');
    const status = section.querySelector('[data-carousel-status]');
    const dots = [...section.querySelectorAll('[data-carousel-index]')].map(button => ({
      button,
      index: Number(button.dataset.carouselIndex)
    }));
    if (!slides.length || !prev || !next || !status || dots.length !== slides.length ||
        new Set(dots.map(dot => dot.index)).size !== slides.length ||
        dots.some(dot => !Number.isInteger(dot.index) || dot.index < 0 || dot.index >= slides.length)) return;
    track.dataset.siteCarouselReady = 'true';

    const desktop = matchMedia('(min-width: 992px)');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const lastIndex = slides.length - 1;
    const titles = slides.map(slide => slide.querySelector('p')?.textContent.trim() || '');
    const statusLabel = track.getAttribute('aria-label') ||
      document.getElementById(track.getAttribute('aria-labelledby'))?.textContent.trim() || '';
    let settledIndex = desktop.matches ? Math.min(1, lastIndex) : 0;
    let requestedIndex = null;
    let observedIndex = settledIndex;
    let phase = 'idle';
    let revision = 0;
    let announcePending = false;
    let settleTimer = 0;
    let finishFrame = 0;
    let finishSource = '';
    let resizeFrame = 0;
    let repairedRequest = false;
    let touchCount = 0;
    const pointers = new Set();
    const clampIndex = index => Math.max(0, Math.min(lastIndex, index));
    const interacting = () => pointers.size > 0 || touchCount > 0;

    status.textContent = '';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    for (const button of [prev, next]) {
      button.disabled = false;
      button.removeAttribute('disabled');
      if (track.id) button.setAttribute('aria-controls', track.id);
    }
    for (const { button, index } of dots) {
      const number = button.textContent.trim() || String(index + 1).padStart(2, '0');
      button.setAttribute('aria-label', `${number} ${titles[index]}`.trim());
      if (slides[index].id || track.id) button.setAttribute('aria-controls', slides[index].id || track.id);
      slides[index].setAttribute('aria-label', `${index + 1} / ${slides.length}: ${titles[index]}`.trim());
    }

    function targetLeft(index) {
      const trackRect = track.getBoundingClientRect();
      const slideRect = slides[index].getBoundingClientRect();
      const centered = track.scrollLeft + slideRect.left - trackRect.left - track.clientLeft +
        (slideRect.width - track.clientWidth) / 2;
      return Math.max(0, Math.min(Math.max(0, track.scrollWidth - track.clientWidth), centered));
    }

    function nearestIndex() {
      let nearest = clampIndex(observedIndex);
      let distance = Math.abs(track.scrollLeft - targetLeft(nearest));
      for (let index = 0; index < slides.length; index++) {
        const candidate = Math.abs(track.scrollLeft - targetLeft(index));
        if (candidate < distance) {
          nearest = index;
          distance = candidate;
        }
      }
      return nearest;
    }

    function controlIndex() {
      return requestedIndex ?? (phase === 'manual' ? nearestIndex() : settledIndex);
    }

    function renderControls() {
      const selected = requestedIndex ?? settledIndex;
      for (const dot of dots) dot.button.setAttribute('aria-pressed', String(dot.index === selected));
      const base = controlIndex();
      prev.setAttribute('aria-disabled', String(base === 0));
      next.setAttribute('aria-disabled', String(base === lastIndex));
    }

    function clearCompletion() {
      clearTimeout(settleTimer);
      cancelAnimationFrame(finishFrame);
      settleTimer = 0;
      finishFrame = 0;
      finishSource = '';
    }

    function commit(index) {
      const changed = index !== settledIndex;
      const announce = announcePending && changed;
      settledIndex = index;
      observedIndex = index;
      requestedIndex = null;
      phase = 'idle';
      announcePending = false;
      clearCompletion();
      renderControls();
      if (announce) status.textContent = `${statusLabel} ${index + 1} / ${slides.length}: ${titles[index]}`.trim();
    }

    function scheduleSettle() {
      clearTimeout(settleTimer);
      const expectedRevision = revision;
      settleTimer = setTimeout(() => {
        settleTimer = 0;
        if (expectedRevision === revision) queueFinish('fallback');
      }, 150);
    }

    function queueFinish(source) {
      if (finishFrame) {
        if (source === 'fallback') finishSource = source;
        return;
      }
      const expectedRevision = revision;
      const position = track.scrollLeft;
      finishSource = source;
      finishFrame = requestAnimationFrame(() => {
        finishFrame = 0;
        const completionSource = finishSource;
        finishSource = '';
        if (expectedRevision !== revision || phase === 'idle' || interacting() || !track.clientWidth) return;
        if (Math.abs(track.scrollLeft - position) > 0.5) {
          scheduleSettle();
          return;
        }
        if (phase === 'programmatic' && Math.abs(track.scrollLeft - targetLeft(requestedIndex)) > 2) {
          // A stale scrollend cannot settle a newer request. A quiet interrupted request gets one repair.
          if (completionSource === 'fallback' && !repairedRequest) {
            repairedRequest = true;
            track.scrollTo({ left: targetLeft(requestedIndex), behavior: 'instant' });
            queueFinish('instant');
            scheduleSettle();
          }
          return;
        }
        commit(phase === 'programmatic' ? requestedIndex : nearestIndex());
      });
    }

    function requestIndex(index, { behavior, announce = true, force = false } = {}) {
      index = clampIndex(index);
      if (!force && ((phase === 'programmatic' && requestedIndex === index) ||
          (phase === 'idle' && settledIndex === index && Math.abs(track.scrollLeft - targetLeft(index)) <= 2))) return;
      revision++;
      clearCompletion();
      requestedIndex = index;
      phase = 'programmatic';
      announcePending = announce;
      repairedRequest = false;
      renderControls();
      const left = targetLeft(index);
      const motion = behavior || (reduced.matches ? 'instant' : 'smooth');
      track.scrollTo({ left, behavior: motion });
      if (motion === 'instant' || Math.abs(track.scrollLeft - left) <= 2) queueFinish('instant');
      scheduleSettle();
    }

    function beginManual() {
      const wasProgrammatic = phase === 'programmatic';
      revision++;
      clearCompletion();
      requestedIndex = null;
      phase = 'manual';
      announcePending = true;
      if (wasProgrammatic) track.scrollTo({ left: track.scrollLeft, behavior: 'instant' });
      observedIndex = nearestIndex();
      renderControls();
      scheduleSettle();
    }

    prev.addEventListener('click', () => {
      const base = controlIndex();
      if (base > 0) requestIndex(base - 1);
    });
    next.addEventListener('click', () => {
      const base = controlIndex();
      if (base < lastIndex) requestIndex(base + 1);
    });
    for (const { button, index } of dots) button.addEventListener('click', () => requestIndex(index));
    track.addEventListener('keydown', event => {
      if (event.target !== track || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const base = controlIndex();
      const index = event.key === 'ArrowRight' ? base + 1 : event.key === 'ArrowLeft' ? base - 1 :
        event.key === 'Home' ? 0 : event.key === 'End' ? lastIndex : null;
      if (index !== null) {
        event.preventDefault();
        requestIndex(index);
      }
    });
    track.addEventListener('scroll', () => {
      if (phase === 'idle' && !resizeFrame) {
        revision++;
        phase = 'manual';
        announcePending = true;
      }
      observedIndex = nearestIndex();
      if (phase === 'manual') renderControls();
      scheduleSettle();
    }, { passive: true });
    track.addEventListener('scrollend', event => {
      if (event.target === track) queueFinish('scrollend');
    });
    track.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      pointers.add(event.pointerId);
      beginManual();
    }, { passive: true });
    track.addEventListener('pointermove', event => {
      if (pointers.has(event.pointerId) && phase === 'programmatic' && (event.movementX || event.movementY)) beginManual();
    }, { passive: true });
    const releasePointer = event => {
      if (pointers.delete(event.pointerId)) scheduleSettle();
    };
    document.addEventListener('pointerup', releasePointer, { passive: true });
    document.addEventListener('pointercancel', releasePointer, { passive: true });
    track.addEventListener('touchstart', event => {
      touchCount = event.touches.length;
      beginManual();
    }, { passive: true });
    track.addEventListener('touchmove', () => {
      if (touchCount && phase === 'programmatic') beginManual();
    }, { passive: true });
    const releaseTouch = event => {
      if (!touchCount) return;
      touchCount = event.touches.length;
      if (!touchCount) scheduleSettle();
    };
    document.addEventListener('touchend', releaseTouch, { passive: true });
    document.addEventListener('touchcancel', releaseTouch, { passive: true });
    track.addEventListener('wheel', beginManual, { passive: true });

    function scheduleAlignment() {
      if (resizeFrame) return;
      const preservedIndex = requestedIndex ?? (phase === 'manual' ? observedIndex : settledIndex);
      const preservedAnnouncement = announcePending;
      const expectedRevision = revision;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        const index = expectedRevision === revision ? preservedIndex :
          requestedIndex ?? (phase === 'manual' ? observedIndex : settledIndex);
        const announce = expectedRevision === revision ? preservedAnnouncement : announcePending;
        requestIndex(index, { behavior: 'instant', announce, force: true });
      });
    }
    window.addEventListener('resize', scheduleAlignment, { passive: true });
    onMediaChange(desktop, scheduleAlignment);
    onMediaChange(reduced, () => {
      if (reduced.matches && requestedIndex !== null) {
        requestIndex(requestedIndex, { behavior: 'instant', announce: announcePending, force: true });
      }
    });
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(scheduleAlignment);
      observer.observe(track);
      for (const slide of slides) observer.observe(slide);
    }
    requestIndex(settledIndex, { behavior: 'instant', announce: false, force: true });
  }

  function initialize() {
    document.querySelectorAll('.mobile-menu').forEach(initializeMenu);
    document.querySelectorAll('[data-principle-carousel]').forEach(initializeCarousel);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
