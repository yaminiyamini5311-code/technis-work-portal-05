import { useEffect, useRef } from 'react';

/**
 * TECHINS Space Effect - Scroll-driven depth reveal hook
 * Cards/sections fade in and scale up as they enter viewport
 */

export function useScrollReveal(selector = '.reveal-card', options = {}) {
  const observerRef = useRef(null);
  const {
    threshold = 0.1,
    rootMargin = '-50px 0px',
    stagger = 60
  } = options;

  useEffect(() => {
    // Check for reduced motion preference
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    
    if (prefersReducedMotion) {
      // Just show elements immediately without animation
      document.querySelectorAll(selector).forEach(el => {
        el.style.opacity = '1';
        el.style.transform = 'none';
      });
      return;
    }

    const elements = document.querySelectorAll(selector);
    
    if (!elements.length) return;

    observerRef.current = new IntersectionObserver((entries) => {
      entries.forEach((entry, index) => {
        if (entry.isIntersecting) {
          // Stagger animation based on element order
          const delay = index * stagger;
          setTimeout(() => {
            entry.target.classList.add('revealed');
          }, delay);
        } else {
          // Optionally remove class when scrolling back up
          // entry.target.classList.remove('revealed');
        }
      });
    }, {
      threshold,
      rootMargin
    });

    elements.forEach(el => {
      // Set initial state
      if (!el.classList.contains('revealed') && !el.style.opacity) {
        el.style.opacity = '0';
        el.style.transform = 'scale(0.94) translateY(30px)';
        el.style.transition = 'opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1), transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
      }
      observerRef.current.observe(el);
    });

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [selector, threshold, rootMargin, stagger]);
}

// Helper to manually trigger reveal on mount
export function revealOnMount(selector) {
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    
    const elements = document.querySelectorAll(selector);
    elements.forEach((el, index) => {
      if (prefersReducedMotion) {
        el.style.opacity = '1';
        el.style.transform = 'none';
      } else {
        setTimeout(() => {
          el.classList.add('revealed');
        }, index * 60);
      }
    });
  }, [selector]);
}
