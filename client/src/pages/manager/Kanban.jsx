import { useEffect, useMemo, useState, useCallback } from "react";
import "../../styles/manager-femly.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

// DEMO DATA: fallback task set used only when the API returns nothing.
const DEMO_TASKS = [
  { id: "t1", task_code: "TK-101", title: "Redesign student dashboard", workflow_status: "Assigned", student_name: "Aria Patel", priority: "high", due_date: "2026-11-05" },
  { id: "t2", task_code: "TK-102", title: "Integrate payment webhooks", workflow_status: "In Progress", student_name: "Jordan Lee", priority: "critical", due_date: "2026-11-07" },
  { id: "t3", task_code: "TK-103", title: "Write API docs", workflow_status: "Under Review", student_name: "Sam Rivera", priority: "medium", due_date: "2026-11-03" },
  { id: "t4", task_code: "TK-104", title: "Fix login redirect", workflow_status: "Acknowledged", student_name: "Tina Okafor", priority: "low", due_date: "2026-11-02" },
  { id: "t5", task_code: "TK-105", title: "Export to Excel", workflow_status: "Approved", student_name: "Aria Patel", priority: "medium", due_date: "2026-10-30" },
];

const COLUMNS = [
  { key: "todo", label: "To do", statuses: ["Assigned", "Acknowledged"] },
  { key: "inprogress", label: "In progress", statuses: ["In Progress"] },
  { key: "inreview", label: "In review", statuses: ["Under Review", "Revision Required", "Resubmitted"] },
  { key: "done", label: "Done", statuses: ["Approved", "Submitted"] },
];

function columnKeyFor(status) {
  for (const col of COLUMNS) if (col.statuses.includes(status)) return col.key;
  return "todo";
}

export default function Kanban() {
  const [columns, setColumns] = useState({});
  const [dragging, setDragging] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const build = (list) => {
      const next = {};
      COLUMNS.forEach((c) => { next[c.key] = []; });
      const filtered = filter === "all" ? list : list.filter((t) => (t.student_name || "").toLowerCase().includes(filter));
      filtered.forEach((t) => { next[columnKeyFor(t.workflow_status)].push(t); });
      return { columns: next, tasks: list };
    };
    fetch(`${API_URL}/api/tasks`, { headers: auth() })
      .then((r) => r.json())
      .then((data) => {
        const list = (data.success ? data.tasks : data) || DEMO_TASKS;
        const { columns: nextCols } = build(list);
        setColumns(nextCols);
      })
      .catch(() => {
        const { columns: nextCols } = build(DEMO_TASKS);
        setColumns(nextCols);
      });
  }, [filter]);

  const moveTask = useCallback((taskId, toKey) => {
    setColumns((prev) => {
      const next = { ...prev };
      Object.values(next).flat().forEach((t) => { if (t.id === taskId) { t._dragging = false; } });
      // remove from all
      Object.keys(next).forEach((k) => { next[k] = next[k].filter((t) => t.id !== taskId); });
      const task = Object.values(prev).flat().find((t) => t.id === taskId);
      if (task) next[toKey].push(task);
      setDragOverCol(null);
      setDragging(null);
      // Best-effort server status sync (does not block UI).
      const col = COLUMNS.find((c) => c.key === toKey);
      const targetStatus = col ? col.statuses[0] : task.workflow_status;
      if (task && targetStatus !== task.workflow_status) {
        fetch(`${API_URL}/api/tasks/${task.id}`, {
          method: "PATCH",
          headers: { ...auth(), "Content-Type": "application/json" },
          body: JSON.stringify({ workflow_status: targetStatus }),
        }).catch(() => { /* best effort */ });
      }
      return next;
    });
  }, []);

  const onDragStart = (e, taskId) => {
    setDragging(taskId);
    e.dataTransfer.setData("text/plain", taskId);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragEnd = () => { setDragging(null); setDragOverCol(null); };

  const counts = useMemo(() => {
    const c = {};
    COLUMNS.forEach((col) => { c[col.key] = columns[col.key]?.length || 0; });
    return c;
  }, [columns]);

  return (
    <div className="manager-page page-enter" style={{ paddingBottom: 40 }}>
      <div className="simple-head">
        <span>TASKS KANBAN</span>
        <h2>Task board</h2>
        <p>Drag tasks between columns to change their status.</p>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {["all", ...COLUMNS.map((c) => c.key)].map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`femly-btn ${filter === k ? "femly-btn--primary" : "femly-btn--secondary"}`}
            style={{ fontSize: 12, height: 30, padding: "0 12px" }}
          >
            {k === "all" ? "All" : COLUMNS.find((c) => c.key === k).label} <span style={{ opacity: 0.7 }}>({counts[k] || 0})</span>
          </button>
        ))}
      </div>

      <div className="panel" style={{ overflow: "visible" }}>
        <div className="panel-head"><div><span className="section-kicker">KANBAN BOARD</span><h3>Tasks by status</h3></div></div>
        <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 12, alignItems: "flex-start" }}>
          {COLUMNS.map((col) => (
            <div
              key={col.key}
              className={`kanban-col ${dragOverCol === col.key ? "drag-over" : ""}`}
              style={{
                flex: "0 0 300px", minWidth: 300, display: "flex", flexDirection: "column",
                background: "var(--card)", border: "1px solid var(--line)", borderRadius: 14, padding: 10, transition: "border-color 250ms ease, background-color 250ms ease",
              }}
              onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.key); }}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); if (id && dragging) moveTask(id, col.key); }}
              onDragEnd={onDragEnd}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.02em" }}>{col.label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--a)", background: "var(--a4)", padding: "2px 8px", borderRadius: 999 }}>{columns[col.key]?.length || 0}</span>
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                {(columns[col.key] || []).map((t) => (
                  <div
                    key={t.id}
                    draggable
                    className={`kanban-card ${dragging === t.id ? "dragging" : ""}`}
                    onDragStart={(e) => onDragStart(e, t.id)}
                    onDragEnd={onDragEnd}
                    style={{
                      background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 10, cursor: "grab",
                      opacity: dragging === t.id ? 0.4 : 1,
                      transform: dragging === t.id ? "rotate(2deg)" : "none",
                      transition: dragging === t.id ? "none" : "opacity 200ms ease, transform 200ms ease",
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 800, color: "var(--a)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>{t.task_code || `T-${t.id}`}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{t.title}</div>
                    <div style={{ fontSize: 11, color: "var(--mut)", marginTop: 6 }}>{t.student_name}</div>
                    <div style={{ marginTop: 8, fontSize: 10, color: "var(--mut)" }}>{t.due_date || "—"}</div>
                  </div>
                ))}
                {(columns[col.key] || []).length === 0 && <div style={{ fontSize: 12, color: "var(--mut)", padding: "20px 0", textAlign: "center" }}>Empty</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
