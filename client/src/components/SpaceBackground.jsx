import { useEffect, useRef, useState } from 'react';
import './SpaceBackground.css';

/**
 * TECHINS Space Background - Cosmic backdrop for Student Portal
 * Scroll-driven 3D depth effect with stars, particles and ambient elements
 */

export default function SpaceBackground() {
  const canvasRef = useRef(null);
  const starsRef = useRef([]);
  const scrollVelocityRef = useRef(0);
  const lastScrollRef = useRef(0);
  const animationFrameRef = useRef(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    // Check for reduced motion preference
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mediaQuery.matches);
    
    const handleChange = (e) => setReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handleChange);
    
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    
    // Responsive star count based on viewport and device
    const getStarCount = () => {
      const area = window.innerWidth * window.innerHeight;
      const cores = navigator.hardwareConcurrency || 4;
      const baseCount = area < 500000 ? 80 : area < 1000000 ? 150 : 250;
      return Math.floor(baseCount * Math.min(cores / 4, 1.5));
    };

    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.scale(dpr, dpr);
      initStars();
    };

    const initStars = () => {
      const count = getStarCount();
      starsRef.current = Array.from({ length: count }, () => ({
        // Layer: 0=far, 1=mid, 2=near
        layer: Math.floor(Math.random() * 3),
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        z: Math.random(), // depth 0-1
        size: Math.random() * 2 + 0.5,
        brightness: Math.random() * 0.8 + 0.2,
        twinklePhase: Math.random() * Math.PI * 2,
        twinkleSpeed: Math.random() * 0.02 + 0.01,
        vx: 0,
        vy: 0
      }));
    };

    const lerp = (a, b, t) => a + (b - a) * t;

    const draw = (time) => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      // Cosmic gradient background
      const gradient = ctx.createRadialGradient(
        window.innerWidth / 2,
        window.innerHeight / 2,
        0,
        window.innerWidth / 2,
        window.innerHeight / 2,
        Math.max(window.innerWidth, window.innerHeight)
      );
      gradient.addColorStop(0, '#0A0F0A'); // Dark green-black center
      gradient.addColorStop(0.5, '#050805'); // Deeper black
      gradient.addColorStop(1, '#020502'); // Edge darkness
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

      // Nebula glow accents
      ctx.globalCompositeOperation = 'screen';
      
      // Amber nebula
      const amberGlow = ctx.createRadialGradient(
        window.innerWidth * 0.7,
        window.innerHeight * 0.3,
        0,
        window.innerWidth * 0.7,
        window.innerHeight * 0.3,
        window.innerWidth * 0.4
      );
      amberGlow.addColorStop(0, 'rgba(250, 154, 2, 0.03)');
      amberGlow.addColorStop(0.5, 'rgba(250, 154, 2, 0.01)');
      amberGlow.addColorStop(1, 'rgba(250, 154, 2, 0)');
      ctx.fillStyle = amberGlow;
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

      // Cool blue depth
      const blueGlow = ctx.createRadialGradient(
        window.innerWidth * 0.2,
        window.innerHeight * 0.7,
        0,
        window.innerWidth * 0.2,
        window.innerHeight * 0.7,
        window.innerWidth * 0.3
      );
      blueGlow.addColorStop(0, 'rgba(100, 150, 200, 0.02)');
      blueGlow.addColorStop(0.5, 'rgba(100, 150, 200, 0.01)');
      blueGlow.addColorStop(1, 'rgba(100, 150, 200, 0)');
      ctx.fillStyle = blueGlow;
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

      ctx.globalCompositeOperation = 'source-over';

      // Smooth scroll velocity (with damping)
      scrollVelocityRef.current = lerp(scrollVelocityRef.current, 0, 0.92);

      // Draw stars with depth
      starsRef.current.forEach((star) => {
        if (reducedMotion) {
          // Static twinkle only
          const twinkle = Math.sin(star.twinklePhase) * 0.15 + 0.85;
          star.twinklePhase += star.twinkleSpeed * 0.3; // Slower
          
          ctx.fillStyle = `rgba(255, 255, 255, ${star.brightness * twinkle * 0.9})`;
          ctx.beginPath();
          ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Scroll-driven motion
          const depthFactor = [0.3, 0.6, 1.0][star.layer]; // Layer speed multiplier
          const velocity = scrollVelocityRef.current * depthFactor;
          
          // Move star based on scroll
          star.vy = lerp(star.vy, velocity * 15, 0.1);
          star.y += star.vy;

          // Wrap around
          if (star.y > window.innerHeight + 50) {
            star.y = -50;
            star.x = Math.random() * window.innerWidth;
          } else if (star.y < -50) {
            star.y = window.innerHeight + 50;
            star.x = Math.random() * window.innerWidth;
          }

          // Twinkle effect
          const twinkle = Math.sin(star.twinklePhase) * 0.2 + 0.8;
          star.twinklePhase += star.twinkleSpeed;

          // Star streaks when moving fast
          const speed = Math.abs(star.vy);
          const stretch = Math.min(speed * 0.8, 20);

          if (stretch > 2) {
            // Draw streak
            const gradient = ctx.createLinearGradient(
              star.x,
              star.y - stretch,
              star.x,
              star.y + stretch
            );
            gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
            gradient.addColorStop(0.5, `rgba(255, 255, 255, ${star.brightness * twinkle * 0.6})`);
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            
            ctx.strokeStyle = gradient;
            ctx.lineWidth = star.size * 0.5;
            ctx.beginPath();
            ctx.moveTo(star.x, star.y - stretch);
            ctx.lineTo(star.x, star.y + stretch);
            ctx.stroke();
          }

          // Draw star
          const layerBrightness = [0.5, 0.7, 1.0][star.layer];
          ctx.fillStyle = `rgba(255, 255, 255, ${star.brightness * twinkle * layerBrightness})`;
          ctx.shadowBlur = star.layer === 2 ? 4 : 2;
          ctx.shadowColor = `rgba(255, 255, 255, ${star.brightness * 0.8})`;
          ctx.beginPath();
          ctx.arc(star.x, star.y, star.size * (1 + speed * 0.02), 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      });

      animationFrameRef.current = requestAnimationFrame(draw);
    };

    const handleScroll = () => {
      const currentScroll = window.scrollY;
      const delta = currentScroll - lastScrollRef.current;
      lastScrollRef.current = currentScroll;
      
      // Normalize velocity (-1 to 1)
      scrollVelocityRef.current = Math.max(-1, Math.min(1, delta / 20));
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', handleScroll, { passive: true });
    
    animationFrameRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', handleScroll);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [reducedMotion]);

  return (
    <div className="space-background" aria-hidden="true">
      <canvas ref={canvasRef} className="space-canvas" />
    </div>
  );
}
