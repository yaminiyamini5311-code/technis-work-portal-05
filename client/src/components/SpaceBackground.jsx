import { useEffect } from 'react';
import { mountSpace } from './space-field';

/**
 * TECHINS Space Background - Cosmic backdrop for Student Portal
 * Scroll-driven 3D depth effect with stars, particles and ambient elements
 */

export default function SpaceBackground() {
  useEffect(() => {
    const force = new URLSearchParams(location.search).get('space') === 'force';
    const cleanup = mountSpace({ force });
    return cleanup;
  }, []);

  return null;
}
