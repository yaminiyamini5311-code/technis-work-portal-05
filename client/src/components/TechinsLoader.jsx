import { useEffect, useRef, useState } from "react";
import "./TechinsLoader.css";

/**
 * Full-screen brand loader — "hexagon portal" reference animation,
 * compressed to a single 3.5s play.
 *
 * Reference (Screen Recording 2026-10-13, 17.62s @30fps, 424x658):
 *  - Deep-navy background, neon-blue glowing hexagon outline centered
 *    (flat top/bottom edges, pointed left/right vertices).
 *  - Six particle streams radiate from the hexagon's edge midpoints:
 *    straight up, straight down, and four diagonals (~60 deg apart).
 *    Streams are thin glowing blue filaments with bright dots flowing
 *    outward; density/brightness builds over the clip, peaks around
 *    60-65% (very bright, dense), dips briefly (~67%), then settles.
 *  - The hexagon interior stays dark/empty — the existing TECHINS logo
 *    badge is placed there, centered horizontally + vertically.
 *
 * Compressed timeline (ORIGINAL 17.62s -> BASE 3.5s, factor ~0.199),
 * followed by a 3.0s outward wave. Total 6.5s:
 *  - 0.00-0.50s: faint streams fade in (unchanged)
 *  - 0.50-2.40s: streams intensify (unchanged)
 *  - ~2.30s:     peak flash, brief dip (unchanged)
 *  - 2.40-3.50s: settle (unchanged)
 *  - 3.50-6.10s: streams fade out; blue wave expands from the center
 *                 until it covers the whole viewport
 *  - 6.10-6.50s: exit fade, hand off to next page
 * (Glowing outline shape removed; the centered circular logo,
 *  streams, flash, and wave are unchanged.)
 *
 * Rendered once per app boot. The parent (App.jsx) keeps this mounted until
 * BOTH the minimum display time (LOADER_DURATION_MS) has elapsed (signalled
 * via `onDone`) AND its own auth check has finished, so the loading screen
 * plays exactly once, for the full duration, then hands off.
 */

export const LOADER_DURATION_MS = 6500;
export const LOADER_BASE_MS = 3500; // original hexagon-portal sequence (unchanged)
const EXIT_FADE_MS = 400;

export default function TechinsLoader({ duration = LOADER_DURATION_MS, onDone }) {
  const [leaving, setLeaving] = useState(false);
  const canvasRef = useRef(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  /* ---- auto-transition: exit fade, then notify parent (timers cleaned) ---- */
  useEffect(() => {
    // Start the exit fade just before the end of the animation.
    const t1 = setTimeout(() => setLeaving(true), Math.max(0, duration - EXIT_FADE_MS));
    // Signal completion exactly at the end of the duration.
    const t2 = setTimeout(() => doneRef.current?.(), duration);

    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [duration]);

  /* ---- hexagon-portal particle streams (canvas, GPU-friendly, rAF) ---- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return; // static fallback

    const ctx = canvas.getContext("2d");
    let raf = 0;
    let w = 0, h = 0, cx = 0, cy = 0, hexR = 0;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const bw = Math.round(rect.width * DPR), bh = Math.round(rect.height * DPR);
      if (canvas.width === bw && canvas.height === bh && w === rect.width && h === rect.height) return;
      w = rect.width; h = rect.height;
      canvas.width = Math.max(1, bw);
      canvas.height = Math.max(1, bh);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      cx = w / 2; cy = h / 2;
      hexR = Math.min(w, h) * 0.23; // invisible anchor ring for the streams
    };
    resize();
    window.addEventListener("resize", resize);
    // Re-sync when layout/CSS settles after mount (stylesheet may apply
    // after the first effect run, leaving the canvas at its 300x150 default).
    let ro = null;
    if (window.ResizeObserver) { ro = new ResizeObserver(resize); ro.observe(canvas); }

    // Six edge-midpoint normals: up, down + four diagonals (every 60deg from up)
    const NORMALS = Array.from({ length: 6 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 3;
      return { nx: Math.cos(a), ny: Math.sin(a), tx: -Math.sin(a), ty: Math.cos(a) };
    });
    const TINTS = ["#d8f1ff", "#9fdcff", "#5ec8ff", "#3f8fff"];

    const smooth = (a, b, x) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const bump = (x, c, s) => Math.exp(-((x - c) * (x - c)) / (2 * s * s));

    // Intensity envelope: the original 3.5s sequence plays unchanged over
    // the base section, then streams fade out as the wave section takes over.
    const base01 = Math.min(1, LOADER_BASE_MS / duration);
    const baseEnvelope = (u) => {
      const fade = smooth(0, 0.12, u);
      const ramp = 0.35 + 0.65 * smooth(0.08, 0.68, u);
      const peak = 1 + 0.9 * bump(u, 0.62, 0.045) - 0.45 * bump(u, 0.7, 0.04);
      return Math.min(1.6, Math.max(0, fade * ramp * peak));
    };
    const baseEnd = baseEnvelope(1);
    const intensityAt = (t01) => {
      if (t01 <= base01) return baseEnvelope(t01 / base01);
      const w = (t01 - base01) / (1 - base01); // 0..1 across the wave section
      return baseEnd * Math.max(0, 1 - w / 0.25); // streams out over ~first quarter
    };

    const parts = [];
    const leavingRef = { current: false };
    const start = performance.now();
    const rand = (a, b) => a + Math.random() * (b - a);
    const scale = () => Math.min(w, h) / 800;

    const spawn = (n, e) => {
      const s = scale();
      const spread = hexR * 0.42; // filaments spread along the edge tangent
      const ex = cx + n.nx * hexR, ey = cy + n.ny * hexR;
      const off = rand(-spread, spread);
      const speed = rand(60, 150) * s * (0.7 + 0.6 * e);
      parts.push({
        x: ex + n.tx * off + n.nx * rand(0, 6),
        y: ey + n.ty * off + n.ny * rand(0, 6),
        vx: n.nx * speed + n.tx * rand(-22, 22) * s,
        vy: n.ny * speed + n.ty * rand(-22, 22) * s,
        life: 0, maxLife: rand(0.9, 1.6),
        size: rand(0.8, 2.2) * s + 0.6,
        tint: TINTS[(Math.random() * TINTS.length) | 0],
        alpha: rand(0.5, 1) * (0.55 + 0.45 * e),
      });
    };

    const frame = (now) => {
      const elapsed = (now - start) / 1000;
      const t01 = Math.min(1, elapsed / (duration / 1000));
      const e = intensityAt(t01);

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = 1;

      // spawn ~ intensity-scaled filaments on all six edges
      const per = Math.round(3 + e * 12);
      for (const n of NORMALS) for (let i = 0; i < per; i++) spawn(n, e);
      if (parts.length > 1400) parts.splice(0, parts.length - 1400);

      const dt = 1 / 60;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life += dt;
        if (p.life >= p.maxLife) { parts.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        const fade = 1 - p.life / p.maxLife;
        const a = p.alpha * fade;
        // filament trail (velocity-stretched, like the reference streams)
        ctx.strokeStyle = p.tint;
        ctx.globalAlpha = a * 0.55;
        ctx.beginPath();
        ctx.moveTo(p.x - p.vx * 0.09, p.y - p.vy * 0.09);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        // bright head dot
        ctx.globalAlpha = Math.min(1, a + 0.15);
        ctx.fillStyle = p.tint;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (t01 < 1 && !leavingRef.current) raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => { leavingRef.current = true; cancelAnimationFrame(raf); window.removeEventListener("resize", resize); ro?.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  return (
    <div
      className={`tl ${leaving ? "tl--out" : ""}`}
      style={{ "--loader-duration": `${duration}ms` }}
      role="status"
      aria-label="Loading"
    >
      <canvas className="tl__fx" ref={canvasRef} aria-hidden="true" />
      <div className="tl__vignette" aria-hidden="true" />
      <div className="tl__wave" aria-hidden="true" />
      <div className="tl__wave tl__wave--ring" aria-hidden="true" />
      <div className="tl__center">
        <div className="tl__logo"><img src="/techins-logo-full.jpg" alt="TECHINS" /></div>
        <div className="tl__flash" aria-hidden="true" />
      </div>
    </div>
  );
}
