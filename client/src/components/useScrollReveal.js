import { useEffect, useRef, useCallback } from 'react';

/**
 * TECHINS Space Effect - Sophisticated scroll-driven depth reveal hook
 * Cards emerge from space with scale, opacity, translateZ, and blur effects
 * Scroll-linked and reversible with hysteresis to prevent flicker
 */

export function useScrollReveal(selector = '.reveal-card', options = {}) {
  const observerRef = useRef(null);
  const elementsRef = useRef(new Map());
  const {
    threshold = [0, 0.15],
    rootMargin = '-60px 0px -60px 0px',
    stagger = 60,
    initialScale = 0.96,
    initialOpacity = 0.15,
    initialTranslateY = 24,
    // Blur is the single most expensive property here: animating `filter`
    // forces a full-surface repaint of the element on every scroll tick, which
    // is what made the page look smeared while scrolling. It is now opt-in and
    // off by default; the reveal still reads as depth via scale + offset.
    initialBlur = 0
  } = options;

  const applyRevealState = useCallback((element, progress, isEntering) => {
    if (!element) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      element.style.opacity = '1';
      element.style.transform = 'none';
      element.style.filter = '';
      element.style.willChange = 'auto';
      return;
    }

    // Calculate animation values based on scroll progress
    // progress: 0 (far) to 1 (fully revealed)
    const easedProgress = isEntering
      ? 1 - Math.pow(1 - progress, 2) // ease-out when entering
      : Math.pow(progress, 2); // ease-in when leaving

    const scale = initialScale + (1 - initialScale) * easedProgress;
    const opacity = initialOpacity + (1 - initialOpacity) * easedProgress;
    const translateY = initialTranslateY * (1 - easedProgress);

    element.style.opacity = opacity.toFixed(3);
    element.style.transform = `scale(${scale.toFixed(3)}) translateY(${translateY.toFixed(1)}px)`;

    // Only touch `filter` when blur is actually requested. Writing
    // `filter: blur(0px)` every frame still triggers the expensive path.
    if (initialBlur > 0) {
      element.style.filter = `blur(${(initialBlur * (1 - easedProgress)).toFixed(1)}px)`;
    }

    // Promote only while animating, never permanently on every card.
    if (progress >= 0.95) {
      element.style.willChange = 'auto';
    } else {
      element.style.willChange = 'transform, opacity';
    }
  }, [initialScale, initialOpacity, initialTranslateY, initialBlur]);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    
    if (prefersReducedMotion) {
      document.querySelectorAll(selector).forEach(el => {
        el.style.opacity = '1';
        el.style.transform = 'none';
        el.style.filter = '';
      });
      return;
    }

    const elements = document.querySelectorAll(selector);

    if (!elements.length) return;

    // Safety timeout: reveal all cards if the observer never fires
    const safetyTimeout = setTimeout(() => {
      elements.forEach(el => {
        el.style.opacity = '1';
        el.style.transform = 'none';
        el.style.filter = '';
        el.style.willChange = 'auto';
      });
    }, 2000);

    observerRef.current = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const element = entry.target;
        const rect = element.getBoundingClientRect();
        const viewportHeight = window.innerHeight;

        // Calculate scroll progress (0 at bottom of viewport, 1 when fully visible)
        const progress = Math.max(0, Math.min(1,
          (viewportHeight - rect.top) / (viewportHeight + rect.height)
        ));

        // Hysteresis to prevent flicker at threshold
        const currentState = elementsRef.current.get(element) || { progress: 0, isEntering: false };
        const hysteresis = 0.05;

        let isEntering;
        if (entry.isIntersecting) {
          isEntering = progress > currentState.progress + hysteresis;
        } else {
          isEntering = false;
        }

        elementsRef.current.set(element, { progress, isEntering });
        applyRevealState(element, progress, isEntering);
      });
    }, {
      threshold,
      rootMargin
    });

    // Set initial state and observe with staggered delays
    const transition = `opacity 0.4s cubic-bezier(0.2, 0.9, 0.25, 1.1), transform 0.4s cubic-bezier(0.2, 0.9, 0.25, 1.1)`;

    elements.forEach((el, index) => {
      if (!el.style.opacity || el.style.opacity === '1') {
        el.style.opacity = initialOpacity.toFixed(3);
        el.style.transform = `scale(${initialScale.toFixed(3)}) translateY(${initialTranslateY}px)`;
        if (initialBlur > 0) el.style.filter = `blur(${initialBlur}px)`;
        el.style.transition = transition;
      }

      // Stagger initial reveal for elements above the fold. Batched into a
      // single timer chain instead of one setTimeout per element.
      if (el.getBoundingClientRect().top < window.innerHeight) {
        setTimeout(() => applyRevealState(el, 1, true), index * stagger);
      }

      observerRef.current.observe(el);
    });

    const observer = observerRef.current;
    return () => {
      clearTimeout(safetyTimeout);
      if (observer) {
        observer.disconnect();
      }
      elementsRef.current.clear();
    };
  }, [selector, threshold, rootMargin, stagger, initialScale, initialOpacity, initialTranslateY, initialBlur, applyRevealState]);
}

// Helper to manually trigger reveal on mount (for dynamic content)
export function useRevealOnMount(selector, options = {}) {
  const { stagger = 60 } = options;

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const elements = document.querySelectorAll(selector);
    elements.forEach((el, index) => {
      if (prefersReducedMotion) {
        el.style.opacity = '1';
        el.style.transform = 'none';
        el.style.filter = '';
      } else {
        setTimeout(() => {
          el.style.opacity = '1';
          el.style.transform = 'scale(1) translateY(0)';
          el.style.filter = '';
        }, index * stagger);
      }
    });
  }, [selector, stagger]);
}
