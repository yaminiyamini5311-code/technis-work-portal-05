import { useEffect, useRef } from "react";

/* Count-up figures, mirroring the reference film's ticking stat tiles.
   Writes textContent via rAF (no re-renders), honours reduced-motion,
   and pairs with tabular figures (`.stat-count`) so ticking digits never
   shift layout. Data logic is untouched — this only animates the rendered
   number. Shared by the CEO and manager dashboards. */
export function useCountUp(target) {
  const ref = useRef(null);
  const prev = useRef(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const to = Number(target) || 0;
    const from = prev.current;
    prev.current = to;
    if (from === to) { node.textContent = String(to); return; }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      node.textContent = String(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const dur = 900;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = String(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return ref;
}

export function StatNumber({ value }) {
  const ref = useCountUp(value);
  return <strong ref={ref} className="stat-count">{value}</strong>;
}
