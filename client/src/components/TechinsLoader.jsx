import { useEffect, useState } from "react";
import "./TechinsLoader.css";

export default function TechinsLoader({ duration = 3000, onDone }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), duration - 400);
    const t2 = setTimeout(() => onDone?.(), duration);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [duration, onDone]);
  return (
    <div className={`tl ${leaving ? "tl--out" : ""}`} role="status" aria-label="Loading">
      <div className="tl__stars" />
      <div className="tl__center">
        <div className="tl__logo"><img src="/techins-logo-full.jpg" alt="TECHINS" /></div>
        <p className="tl__tag">Where Learning Becomes Ideas</p>
        <div className="tl__bar"><span /></div>
      </div>
    </div>
  );
}
