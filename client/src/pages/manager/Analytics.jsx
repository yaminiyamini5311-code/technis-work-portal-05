import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import "../../styles/manager-femly.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

const RANGES = [{ label: "7d", days: 7 }, { label: "30d", days: 30 }, { label: "90d", days: 90 }];

export default function Analytics() {
  const [tasks, setTasks] = useState([]);
  const [range, setRange] = useState("30d");
  const chartRef = useRef(null);

  useEffect(() => {
    fetch(`${API_URL}/api/tasks`, { headers: auth() })
      .then((r) => r.json())
      .then((data) => setTasks((data.success ? data.tasks : data) || []))
      .catch(() => setTasks([]));
  }, []);

  const days = useMemo(() => RANGES.find((r) => r.label === range).days, [range]);
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days + 1);

  const inRange = (t) => {
    if (!t.due_date && !t.created_at) return false;
    const d = new Date(t.due_date || t.created_at);
    return d >= start && d <= end;
  };
  const filtered = tasks.filter(inRange);

  const total = filtered.length;
  const completed = filtered.filter((t) => t.workflow_status === "Approved").length;
  const pending = filtered.filter((t) => ["Assigned", "Acknowledged"].includes(t.workflow_status)).length;
  const inProg = filtered.filter((t) => t.workflow_status === "In Progress").length;

  // Daily throughput for the line chart.
  const series = useMemo(() => {
    const map = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(end);
      d.setDate(end.getDate() - (days - 1 - i));
      map[d.toISOString().slice(0, 10)] = 0;
    }
    filtered.forEach((t) => {
      const d = (t.due_date || t.created_at || "").slice(0, 10);
      if (map[d] !== undefined) map[d] += 1;
    });
    return Object.keys(map).map((date) => ({ date, value: map[date] }));
  }, [filtered, days, end]);

  const maxY = Math.max(1, ...series.map((s) => s.value));
  const animateRef = useRef(false);
  useCallback(() => {}, []);
  useEffect(() => {
    if (animateRef.current) return;
    animateRef.current = true;
  }, []);

  const sparkline = (values) => {
    const max = Math.max(1, ...values);
    const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${100 - (v / max) * 100}`).join(" ");
    return `<polyline points="${pts}" fill="none" stroke="var(--a)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`;
  };

  const kpis = [
    ["Total tasks", total, sparkline([total, total, total])],
    ["Completed", completed, sparkline([completed, completed, completed])],
    ["Pending", pending, sparkline([pending, pending, pending])],
    ["In progress", inProg, sparkline([inProg, inProg, inProg])],
  ];

  // Line chart geometry.
  const width = 640, height = 240, pad = 40;
  const xScale = (i) => pad + (i / (series.length - 1)) * (width - pad * 2);
  const yScale = (v) => height - pad - (v / maxY) * (height - pad * 2);

  const linePts = series.map((s, i) => `${xScale(i)},${yScale(s.value)}`).join(" ");
  const totalLength = series.reduce((acc, s, i) => {
    if (i === 0) return 0;
    const p0 = { x: xScale(i - 1), y: yScale(series[i - 1].value) };
    const p1 = { x: xScale(i), y: yScale(s.value) };
    return acc + Math.hypot(p1.x - p0.x, p1.y - p0.y);
  }, 0);

  return (
    <div className="manager-page page-enter" style={{ paddingBottom: 40 }}>
      <div className="simple-head">
        <span>ANALYTICS</span>
        <h2>Team analytics</h2>
        <p>Throughput and status breakdown across the selected range.</p>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {RANGES.map((r) => (
          <button
            key={r.label}
            onClick={() => setRange(r.label)}
            className={`femly-btn ${range === r.label ? "femly-btn--primary" : "femly-btn--secondary"}`}
            style={{ fontSize: 12, height: 30, padding: "0 12px" }}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="panel" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 520, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {kpis.map(([label, value, spark], i) => (
              <div key={i} className="panel" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "var(--mut)", textTransform: "uppercase" }}>{label}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
                <div style={{ height: 14 }}>
                  <svg width="100%" height="14" dangerouslySetInnerHTML={{ __html: spark }} />
                </div>
              </div>
            ))}
          </div>
          <div className="panel" style={{ padding: 14, minHeight: 300 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--ink)", marginBottom: 10 }}>Throughput (tasks per day)</div>
            <svg width={width} height={height} ref={chartRef} style={{ width: "100%", height: "auto" }}>
              <polyline points={linePts} fill="none" stroke="var(--a)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"
                style={{ strokeDasharray: totalLength, strokeDashoffset: totalLength, transition: "stroke-dashoffset 1200ms ease" }} />
              {series.map((s, i) => (
                <circle key={i} cx={xScale(i)} cy={yScale(s.value)} r="0" fill="var(--a)" style={{ transition: "r 200ms ease" }} />
              ))}
            </svg>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--mut)", marginTop: 6 }}>
              {series[0]?.date} <span style={{ fontWeight: 800, color: "var(--ink)" }}>{Math.round(maxY)} peak/day</span> {series[series.length - 1]?.date}
            </div>
          </div>
        </div>

        <div style={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="panel" style={{ padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--ink)", marginBottom: 10 }}>Status mix</div>
            <svg width="260" height="220" viewBox="0 0 260 220">
              <circle cx="130" cy="130" r="70" fill="none" stroke="var(--line)" strokeWidth="12" />
              <circle cx="130" cy="130" r="70" fill="none" stroke="var(--a)" strokeWidth="12"
                strokeDasharray={total > 0 && completed > 0 ? `${(completed / total) * 440},440` : "0,440"}
                strokeLinecap="round" transform="rotate(-90 130 130)"
                style={{ transition: "stroke-dashoffset 1000ms ease" }} />
              <text x="130" y="134" fontSize="16" fontWeight="800" fill="var(--ink)" textAnchor="middle">{completed}</text>
              <text x="130" y="152" fontSize="10" fill="var(--mut)" textAnchor="middle">completed</text>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
