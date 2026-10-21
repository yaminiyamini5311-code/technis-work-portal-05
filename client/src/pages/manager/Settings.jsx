import { useEffect, useState } from "react";
import "../../styles/manager-femly.css";

const ACCENTS = [
  { key: "forest", label: "Forest", color: "#115130" },
  { key: "ocean", label: "Ocean", color: "#1e4fa8" },
  { key: "plum", label: "Plum", color: "#5b2f8f" },
  { key: "ember", label: "Ember", color: "#a8421a" },
];

export default function Settings() {
  const [accent, setAccent] = useState(() => {
    try { return localStorage.getItem("femly-accent") || "forest"; } catch { return "forest"; }
  });
  const [weekStartsMonday, setWeekStartsMonday] = useState(() => {
    try { return localStorage.getItem("femly-week-start") === "monday"; } catch { return false; }
  });

  useEffect(() => {
    document.documentElement.dataset.accent = accent;
    try { localStorage.setItem("femly-accent", accent); } catch {}
  }, [accent]);

  const applyAccent = (key) => { setAccent(key); };

  return (
    <div className="manager-page page-enter" style={{ paddingBottom: 40, maxWidth: 700 }}>
      <div className="simple-head">
        <span>SETTINGS</span>
        <h2>Appearance</h2>
        <p>Choose the manager portal accent colour and week start day.</p>
      </div>

      <div className="panel">
        <div className="panel-head"><div><span className="section-kicker">ACCENT COLOUR</span><h3>Portal theme</h3></div></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginTop: 10 }}>
          {ACCENTS.map((a) => {
            const active = accent === a.key;
            return (
              <div key={a.key} style={{ border: `2px solid ${active ? a.color : "var(--line)" }`, borderRadius: 12, padding: 12, cursor: "pointer", transition: "border-color .3s ease, box-shadow .3s ease", background: active ? (a.key === "forest" ? "#e3f1e8" : a.key === "ocean" ? "#e3ecfb" : a.key === "plum" ? "#ece3f7" : "#f9e6dc") : "var(--card)" }}
                onClick={() => applyAccent(a.key)}
              >
                <div style={{ width: 30, height: 30, borderRadius: 999, background: a.color, marginBottom: 8, border: "1px solid var(--line)" }} />
                <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>{a.label}</div>
                <div style={{ fontSize: 11, color: "var(--mut)" }}>{active ? "Active" : "Switch"}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head"><div><span className="section-kicker">CALENDAR</span><h3>Week start</h3></div></div>
        <div style={{ padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <input id="week-start" type="checkbox" checked={weekStartsMonday} onChange={(e) => { setWeekStartsMonday(e.target.checked); try { localStorage.setItem("femly-week-start", e.target.checked ? "monday" : "sunday"); } catch {} }} />
          <label htmlFor="week-start" style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", cursor: "pointer", margin: 0 }}>
            {weekStartsMonday ? "Week starts on Monday" : "Week starts on Sunday"}
          </label>
        </div>
      </div>
    </div>
  );
}
