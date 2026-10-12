import { useEffect, useRef, useState } from "react";
import "./TechinsLoader.css";

/**
 * Full-screen brand loader.
 *
 * Rendered once per app boot. `authPending` keeps the loader mounted until
 * the auth check in App.jsx finishes, so the loading screen never hands off to
 * a second instance mid-session. The minimum display time is still honoured
 * even when the auth check resolves instantly.
 */
export default function TechinsLoader({ duration = 1500, onDone, authPending = false }) {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    // Start the minimum-display timer and the exit fade together.
    const t1 = setTimeout(() => setLeaving(true), Math.max(0, duration - 400));

    // Unmount as soon as BOTH conditions are met:
    //   1. the minimum display time has elapsed
    //   2. authPending is no longer true
    const t2 = setInterval(() => {
      if (!authPending) {
        clearInterval(t2);
        // Let the fade-out finish before removing the node.
        setTimeout(() => {
          setGone(true);
          doneRef.current?.();
        }, 400);
      }
    }, 60);

    return () => { clearTimeout(t1); clearInterval(t2); };
  }, [duration, authPending]);

  if (gone) return null;

  return (
    <div
      className={`tl ${leaving ? "tl--out" : ""}`}
      style={{ "--tl-fill": `${duration}ms` }}
      role="status"
      aria-label="Loading"
    >
      <div className="tl__stars" />
      <div className="tl__center">
        <div className="tl__logo"><img src="/techins-logo-full.jpg" alt="TECHINS" /></div>
        <p className="tl__tag">Where Learning Becomes Ideas</p>
        <div className="tl__bar"><span /></div>
      </div>
    </div>
  );
}
