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
    threshold = [0, 0.1, 0.25, 0.5],
    rootMargin = '-80px 0px -80px 0px',
    stagger = 110,
    initialScale = 0.85,
    initialOpacity = 0.1,
    initialTranslateY = 50,
    initialBlur = 5
  } = options;

  const applyRevealState = useCallback((element, progress, isEntering) => {
    if (!element) return;
    
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    
    if (prefersReducedMotion) {
      element.style.opacity = '1';
      element.style.transform = 'none';
      element.style.filter = 'none';
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
    const blur = initialBlur * (1 - easedProgress);
    
    element.style.opacity = opacity.toFixed(3);
    element.style.transform = `scale(${scale.toFixed(3)}) translateY(${translateY.toFixed(1)}px)`;
    element.style.filter = `blur(${blur.toFixed(1)}px)`;
    element.style.willChange = 'transform, opacity, filter';
    
    // Remove will-change after animation completes
    if (progress >= 0.95) {
      setTimeout(() => {
        element.style.willChange = 'auto';
      }, 300);
    }
  }, [initialScale, initialOpacity, initialTranslateY, initialBlur]);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    
    if (prefersReducedMotion) {
      document.querySelectorAll(selector).forEach(el => {
        el.style.opacity = '1';
        el.style.transform = 'none';
        el.style.filter = 'none';
      });
      return;
    }

    const elements = document.querySelectorAll(selector);
    
    if (!elements.length) return;

    // Safety timeout: reveal all cards after 3 seconds if observer fails
    const safetyTimeout = setTimeout(() => {
      elements.forEach(el => {
        el.style.opacity = '1';
        el.style.transform = 'none';
        el.style.filter = 'none';
      });
    }, 3000);

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
    elements.forEach((el, index) => {
      if (!el.style.opacity || el.style.opacity === '1') {
        el.style.opacity = initialOpacity.toFixed(3);
        el.style.transform = `scale(${initialScale.toFixed(3)}) translateY(${initialTranslateY}px)`;
        el.style.filter = `blur(${initialBlur}px)`;
        el.style.transition = 'opacity 0.65s cubic-bezier(0.2, 0.9, 0.25, 1.1), transform 0.65s cubic-bezier(0.2, 0.9, 0.25, 1.1), filter 0.65s cubic-bezier(0.2, 0.9, 0.25, 1.1)';
      }
      
      // Stagger initial reveal for elements above the fold
      if (el.getBoundingClientRect().top < window.innerHeight) {
        setTimeout(() => {
          applyRevealState(el, 1, true);
        }, index * stagger);
      }
      
      observerRef.current.observe(el);
    });

    return () => {
      clearTimeout(safetyTimeout);
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
      elementsRef.current.clear();
    };
  }, [selector, threshold, rootMargin, stagger, initialScale, initialOpacity, initialTranslateY, initialBlur, applyRevealState]);
}

// Helper to manually trigger reveal on mount (for dynamic content)
export function revealOnMount(selector, options = {}) {
  const { stagger = 110 } = options;
  
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    
    const elements = document.querySelectorAll(selector);
    elements.forEach((el, index) => {
      if (prefersReducedMotion) {
        el.style.opacity = '1';
        el.style.transform = 'none';
        el.style.filter = 'none';
      } else {
        setTimeout(() => {
          el.style.opacity = '1';
          el.style.transform = 'scale(1) translateY(0)';
          el.style.filter = 'none';
        }, index * stagger);
      }
    });
  }, [selector, stagger]);
}
