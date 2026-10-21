import { useEffect, useMemo, useState } from "react";
import "../../styles/manager-femly.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

export default function Calendar() {
  const [tasks, setTasks] = useState([]);
  const [viewDate, setViewDate] = useState(new Date());

  useEffect(() => {
    fetch(`${API_URL}/api/tasks`, { headers: auth() })
      .then((r) => r.json())
      .then((data) => setTasks((data.success ? data.tasks : data) || []))
      .catch(() => setTasks([]));
  }, []);

  const y = viewDate.getFullYear();
  const m = viewDate.getMonth();
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const firstDay = new Date(y, m, 1).getDay();
  const totalDays = daysInMonth(y, m);

  const eventsByDay = useMemo(() => {
    const map = {};
    tasks.forEach((t) => {
      if (t.due_date) {
        const key = t.due_date.slice(0, 7) === `${y}-${String(m + 1).padStart(2, "0")}` ? t.due_date : null;
        if (key) { (map[key] = map[key] || []).push(t); }
      }
    });
    return map;
  }, [tasks, y, m]);

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const upcoming = useMemo(() => {
    return [...tasks]
      .filter((t) => t.due_date && t.due_date >= todayStr)
      .sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""))
      .slice(0, 6);
  }, [tasks, todayStr]);

  const todayEvents = useMemo(() => upcoming.filter((t) => t.due_date === todayStr), [upcoming, todayStr]);

  const changeMonth = (delta) => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1));

  const days = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let d = 1; d <= totalDays; d++) days.push(d);

  return (
    <div className="manager-page page-enter" style={{ paddingBottom: 40 }}>
      <div className="simple-head">
        <span>CALENDAR</span>
        <h2>Team calendar</h2>
        <p>Month view with task due dates. Today is highlighted.</p>
      </div>

      <div className="panel" style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, padding: "0 4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button className="femly-btn femly-btn--secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => changeMonth(-1)}>‹</button>
              <span style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)" }}>{monthNames[m]} {y}</span>
              <button className="femly-btn femly-btn--secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => changeMonth(1)}>›</button>
            </div>
            <button className="femly-btn femly-btn--primary" style={{ fontSize: 12, padding: "6px 14px" }} onClick={() => setViewDate(new Date())}>Today</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--line)" }}>
            {WEEKDAYS.map((w) => (
              <div key={w} style={{ fontSize: 10, fontWeight: 800, color: "var(--mut)", textTransform: "uppercase", padding: "8px 4px" }}>{w}</div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {days.map((day, i) => {
              const isEmpty = day === null;
              const dateStr = isEmpty ? null : `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const isToday = dateStr === todayStr;
              const dayEvents = dateStr ? eventsByDay[dateStr] || [] : [];
              return (
                <div
                  key={i}
                  style={{
                    minHeight: 90, border: "1px solid var(--line)", borderRadius: 10,
                    background: isToday ? "var(--a4)" : "var(--card)",
                    position: "relative", padding: 6, display: "flex", flexDirection: "column", gap: 2,
                    ...(isEmpty ? { visibility: "hidden", border: "none", boxShadow: "none" } : {}),
                  }}
                >
                  {!isEmpty && (
                    <>
                      <div style={{ fontSize: 12, fontWeight: isToday ? 800 : 600, color: isToday ? "var(--a)" : "var(--ink)" }}>{day}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                        {dayEvents.slice(0, 3).map((t) => (
                          <div key={t.id} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 999, background: "var(--a)", color: "#fff", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.task_code || `T-${t.id}`}</div>
                        ))}
                        {dayEvents.length > 3 && <div style={{ fontSize: 9, color: "var(--mut)" }}>{dayEvents.length - 3} more</div>}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ width: 300, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="panel" style={{ padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--ink)", marginBottom: 6 }}>Today’s card</div>
            <div style={{ fontSize: 11, color: "var(--mut)", marginBottom: 8 }}>{today.toLocaleDateString()}</div>
            {todayEvents.length > 0
              ? todayEvents.map((t) => (<div key={t.id} style={{ fontSize: 12, color: "var(--ink)", marginBottom: 6 }}>{t.title}</div>))
              : <div style={{ fontSize: 12, color: "var(--mut)" }}>No tasks due today.</div>}
          </div>

          <div className="panel" style={{ padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--ink)", marginBottom: 8 }}>Coming up</div>
            {upcoming.length > 0
              ? upcoming.map((t) => (
                  <div key={t.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--ink)", marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid var(--line)" }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{t.title}</div>
                      <div style={{ fontSize: 10, color: "var(--mut)" }}>{t.task_code || `T-${t.id}`}</div>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--a)", fontWeight: 800 }}>{t.due_date}</div>
                  </div>
                ))
              : <div style={{ fontSize: 12, color: "var(--mut)" }}>Nothing coming up.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
