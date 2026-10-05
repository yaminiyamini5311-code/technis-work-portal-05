/**
 * TECHINS Space Field - Scroll-driven 3D starfield effect
 * Reference implementation adapted for TECHINS Work Portal
 */

export function mountSpace({ force = false } = {}) {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  const reduce = !force && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const debug = /[?&]spacedebug=1/.test(location.search);
  const root = document.documentElement;
  root.setAttribute('data-space', reduce ? 'static' : 'live');

  // Nebula glow layer (CSS gradients, cheap) + star canvas
  const nebula = document.createElement('div');
  nebula.setAttribute('aria-hidden', 'true');
  nebula.dataset.spaceNebula = '1';
  Object.assign(nebula.style, {
    position: 'fixed',
    inset: '-10%',
    zIndex: '0',
    pointerEvents: 'none',
    willChange: 'transform',
    background:
      'radial-gradient(40% 35% at 20% 25%,rgba(250,154,2,.18),transparent 70%),' +
      'radial-gradient(45% 40% at 80% 70%,rgba(56,120,255,.13),transparent 70%),' +
      'radial-gradient(35% 30% at 60% 15%,rgba(16,185,129,.10),transparent 70%)',
  });

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.spaceCanvas = '1';
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    zIndex: '0',
    pointerEvents: 'none',
  });

  document.body.prepend(nebula, canvas);

  const ctx = canvas.getContext('2d');
  let w = 0,
    h = 0;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reduce) draw(0, 0);
  };

  // Stars: x,y in [-1,1] (never too near the center), z in (0,1]; projected = x/z (warp starfield)
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const N = coarse ? 100 : 240;
  const COLORS = ['#ffffff', '#ffffff', '#ffffff', '#ffd08a', '#9ec5ff'];

  const spawn = (s, z) => {
    let x, y;
    do {
      x = Math.random() * 2 - 1;
      y = Math.random() * 2 - 1;
    } while (x * x + y * y < 0.02);
    s.x = x;
    s.y = y;
    s.z = z;
    s.s = 0.6 + Math.random() * 0.8;
    s.c = COLORS[(Math.random() * COLORS.length) | 0];
    s.tw = Math.random() * 6.28;
    return s;
  };

  const stars = Array.from({ length: N }, () => spawn({}, 0.04 + Math.random() * 0.96));

  // Scroll input: capture phase so it works for window AND inner scroll containers; wheel/touch fallback for short pages
  const lastY = new WeakMap();
  let scrollPending = 0,
    wheelPending = 0,
    progress = 0,
    events = 0,
    touchY = null;

  const onScroll = (e) => {
    const t = e.target;
    const el = t === document || t === document.documentElement || t === document.body ? document.scrollingElement : t;
    if (!el || typeof el.scrollTop !== 'number') return;
    const y = el.scrollTop,
      prev = lastY.has(el) ? lastY.get(el) : y;
    lastY.set(el, y);
    scrollPending += y - prev;
    events++;
    const max = el.scrollHeight - el.clientHeight;
    if (max > 0) progress = clamp(y / max, 0, 1);
  };

  const onWheel = (e) => {
    wheelPending += e.deltaY * 0.6;
  };
  const onTouch = (e) => {
    const y = e.touches[0].clientY;
    if (touchY !== null) wheelPending += (touchY - y) * 0.9;
    touchY = y;
  };
  const onTouchEnd = () => {
    touchY = null;
  };

  // Depth transitions for cards/sections marked data-space-depth
  const visible = new Set();
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (en.isIntersecting) {
          visible.add(en.target);
          en.target.style.willChange = 'transform, opacity';
        } else {
          visible.delete(en.target);
          en.target.style.willChange = '';
        }
      }
    },
    { rootMargin: '25% 0px' }
  );

  const seen = new WeakSet();
  const scan = () =>
    document.querySelectorAll('[data-space-depth]').forEach((el) => {
      if (!seen.has(el)) {
        seen.add(el);
        io.observe(el);
      }
    });

  scan();
  const mo = new MutationObserver(() => {
    clearTimeout(mo._t);
    mo._t = setTimeout(scan, 80);
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // Rare soft light streak
  let flare = null,
    flareTimer = 0;
  const scheduleFlare = () => {
    flareTimer = setTimeout(() => {
      const a = Math.random() * 6.28;
      flare = { x: Math.random() * w, y: Math.random() * h * 0.7, a, t: 0 };
      scheduleFlare();
    }, 8000 + Math.random() * 8000);
  };
  if (!reduce) scheduleFlare();

  let v = 0,
    raf = 0,
    lastT = performance.now(),
    fpsT = lastT,
    fpsN = 0,
    fps = 0;

  const badge = debug ? Object.assign(document.createElement('div'), {}) : null;
  if (badge) {
    Object.assign(badge.style, {
      position: 'fixed',
      right: '8px',
      bottom: '8px',
      zIndex: '99999',
      font: '12px monospace',
      background: '#000c',
      color: '#7CFC00',
      padding: '6px 8px',
      borderRadius: '6px',
      pointerEvents: 'none',
    });
    document.body.appendChild(badge);
  }

  function draw(dz, t) {
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2,
      cy = h / 2,
      k = Math.max(w, h) * 0.275;
    const streak = 1 + Math.min(Math.abs(v), 60) * 0.12;

    for (const s of stars) {
      const z0 = s.z;
      s.z += dz * s.s;
      let respawned = false;

      if (s.z > 1) {
        spawn(s, 0.04);
        respawned = true;
      } else if (s.z <= 0.03) {
        spawn(s, 1);
        respawned = true;
      }

      const x1 = cx + (s.x / s.z) * k,
        y1 = cy + (s.y / s.z) * k;

      if (dz < 0 && (Math.abs(x1 - cx) > w * 0.62 || Math.abs(y1 - cy) > h * 0.62)) {
        spawn(s, 1);
        continue;
      }

      if (x1 < -20 || x1 > w + 20 || y1 < -20 || y1 > h + 20) continue;

      const r = 0.4 + (1 - s.z) * 1.7;
      const a = clamp(1.25 - s.z, 0.18, 1) * (0.78 + 0.22 * Math.sin(t * 0.002 + s.tw));

      ctx.globalAlpha = a;
      ctx.strokeStyle = ctx.fillStyle = s.c;

      if (!respawned && Math.abs(v) > 3) {
        const x0 = cx + (s.x / z0) * k,
          y0 = cy + (s.y / z0) * k;
        ctx.lineWidth = r;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1 + (x0 - x1) * streak, y1 + (y0 - y1) * streak);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x1, y1, r, 0, 6.283);
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;

    if (flare) {
      flare.t++;
      const life = 50,
        p = flare.t / life;
      if (p >= 1) flare = null;
      else {
        const len = Math.max(w, h) * 0.35,
          x2 = flare.x + Math.cos(flare.a) * len,
          y2 = flare.y + Math.sin(flare.a) * len;
        const g = ctx.createLinearGradient(flare.x, flare.y, x2, y2);
        g.addColorStop(0, 'rgba(255,200,120,0)');
        g.addColorStop(0.5, 'rgba(255,230,190,0.9)');
        g.addColorStop(1, 'rgba(255,200,120,0)');
        ctx.globalAlpha = Math.sin(Math.PI * p) * 0.28;
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(flare.x, flare.y);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = clamp((t - lastT) / 16.667, 0.5, 3);
    lastT = t;

    const input = scrollPending !== 0 ? scrollPending : wheelPending;
    scrollPending = 0;
    wheelPending = 0;
    const target = clamp(input, -100, 100);
    v += (target - v) * (target !== 0 ? 0.25 : 0.06); // smooth glide in/out
    if (Math.abs(v) < 0.02) v = 0;

    const dz = -(0.0006 + v * 0.00045) * dt; // down = fly forward (zoom in), up = backward (zoom out)
    draw(dz, t);

    nebula.style.transform = `translate3d(0,${(-progress * 80).toFixed(1)}px,0) scale(${(1 + progress * 0.12 + Math.min(Math.abs(v), 60) * 0.0015).toFixed(4)})`;
    root.style.setProperty('--space-progress', progress.toFixed(3));

    for (const el of visible) {
      // depth transitions, reversible with scroll direction
      const r = el.getBoundingClientRect();
      const d = clamp((r.top + r.height / 2 - h / 2) / h, -1.3, 1.3),
        ad = Math.abs(d);
      el.style.transform = `translate3d(0,${(d * 14).toFixed(1)}px,0) scale(${(1 - 0.05 * ad).toFixed(4)})`;
      el.style.opacity = (1 - 0.65 * smooth(0.55, 1.15, ad)).toFixed(3);
    }

    fpsN++;
    if (t - fpsT > 1000) {
      fps = Math.round((fpsN * 1000) / (t - fpsT));
      fpsN = 0;
      fpsT = t;
    }

    window.__SPACE = {
      mode: 'live',
      stars: N,
      fps,
      velocity: +v.toFixed(2),
      scrollEvents: events,
      progress: +progress.toFixed(3),
      depthVisible: visible.size,
    };

    if (badge)
      badge.textContent = `space live | fps ${fps} | v ${v.toFixed(1)} | scroll ev ${events} | depth ${visible.size}`;
  }

  const onVis = () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else if (!reduce) {
      lastT = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };

  window.addEventListener('resize', resize);
  resize();

  if (reduce) {
    window.__SPACE = { mode: 'static', stars: N };
    if (badge) badge.textContent = 'space static (reduced motion)';
  } else {
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('touchmove', onTouch, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('visibilitychange', onVis);
    raf = requestAnimationFrame(frame);
  }

  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(flareTimer);
    document.removeEventListener('scroll', onScroll, { capture: true });
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('touchmove', onTouch);
    window.removeEventListener('touchend', onTouchEnd);
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVis);
    io.disconnect();
    mo.disconnect();
    visible.forEach((el) => {
      el.style.transform = '';
      el.style.opacity = '';
      el.style.willChange = '';
    });
    nebula.remove();
    canvas.remove();
    badge && badge.remove();
    root.removeAttribute('data-space');
  };
}
