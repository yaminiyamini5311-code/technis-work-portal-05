import { useCallback, useEffect, useMemo, useState } from "react";
import "../../styles/admin.css";
import "./performance.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

/* Task states come from the server (utils/studentReport.js) so the CEO view
   and the stored per-student/per-task records can never disagree. */
const STATE_LABELS = {
  approved: "Approved",
  submitted: "Submitted",
  revision_required: "Revision Required",
  in_progress: "In Progress",
  not_started: "Not Started",
};

function fmtDate(value) {
  if (!value) return "—";
  try { return new Date(value).toLocaleString(); } catch { return String(value); }
}

export default function Performance() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${API_URL}/api/performance`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${response.status}`);
      }
      const data = await response.json();
      if (data.success && Array.isArray(data.students)) setItems(data.students);
      else { console.error("Unexpected API response:", data); setItems([]); }
    } catch (err) {
      console.error("Failed to load performance data:", err);
      setError(err.message || "Unable to load performance data");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((x) => {
      const s = [x.student?.name, x.student?.email, x.student?.id, x.student?.student_id,
        x.student?.program, x.student?.department, x.student?.batch_name]
        .filter(Boolean).join(" ").toLowerCase();
      return s.includes(q);
    });
  }, [items, search]);

  const toggle = (id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  if (loading) {
    return (
      <div className="admin-simple">
        <div className="simple-head">
          <span>PRIVATE PERFORMANCE</span>
          <h2>Student Performance</h2>
          <p>Loading task-wise performance…</p>
        </div>
        <div className="empty-state">Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-simple">
        <div className="simple-head">
          <span>PRIVATE PERFORMANCE</span>
          <h2>Student Performance</h2>
          <p>Progress is calculated from real tasks, missions and daily activities.</p>
        </div>
        <div className="empty-state" style={{ color: "#d32f2f" }}>
          Error: {error}
          <button onClick={load} style={{ marginTop: "1rem", padding: "0.5rem 1rem", cursor: "pointer" }}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-simple">
      <div className="simple-head">
        <span>PRIVATE PERFORMANCE</span>
        <h2>Student Performance</h2>
        <p>Task-wise results come from each student's own submissions and reviews. Scores appear only after evaluation.</p>
      </div>

      <div className="perf-search-bar">
        <input
          type="search"
          aria-label="Search students"
          placeholder="Search by student name, email, ID, program or batch…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && <button type="button" onClick={() => setSearch("")}>Clear</button>}
      </div>

      <div className="performance-admin-grid">
        {filtered.map((x) => {
          const c = x.counts || {};
          const s = x.scoring || {};
          const open = !!expanded[x.student.id];
          return (
            <div className="panel perf-card" key={x.student.id}>
              <div className="panel-head">
                <div>
                  <h3>{x.student.name}</h3>
                  <small>{x.student.email}</small>
                  <small style={{ display: "block", marginTop: "0.25rem", opacity: 0.75 }}>
                    ID: {x.student.student_id || x.student.id}
                    {x.student.program ? ` · ${x.student.program}` : ""}
                    {x.student.department ? ` · ${x.student.department}` : ""}
                    {x.student.batch_name ? ` · ${x.student.batch_name}` : ""}
                  </small>
                </div>
                <strong title="Approval-based completion across tasks and missions">{x.progress}%</strong>
              </div>

              <div className="perf-score-block">
                <div>
                  <small>Overall score</small>
                  {s.overall_percentage == null
                    ? <strong className="muted">Not evaluated</strong>
                    : <strong>{s.overall_percentage}%</strong>}
                  {s.has_scores && (
                    <small className="perf-score-basis">
                      {s.scored_tasks} scored task{s.scored_tasks === 1 ? "" : "s"} · {s.total_earned}/{s.total_max} marks
                    </small>
                  )}
                  {!s.has_scores && (
                    <small className="perf-score-basis">
                      {c.total || 0} task{(c.total || 0) === 1 ? "" : "s"} assigned · no scores recorded yet
                    </small>
                  )}
                </div>
                {x.score != null && (
                  <div className="perf-eval-score">
                    <small>Latest review</small>
                    <strong>{x.score}%</strong>
                    <small>{x.lastReviewed ? fmtDate(x.lastReviewed) : ""}</small>
                  </div>
                )}
              </div>

              <div className="perf-counts">
                <span className="perf-chip total">Total <b>{c.total || 0}</b></span>
                <span className="perf-chip approved">Approved <b>{c.approved || 0}</b></span>
                <span className="perf-chip submitted">Submitted <b>{c.submitted || 0}</b></span>
                <span className="perf-chip pending">Pending <b>{c.pending || 0}</b></span>
                {c.revision_required > 0 && <span className="perf-chip revision">Revision <b>{c.revision_required}</b></span>}
                {c.overdue > 0 && <span className="perf-chip overdue">Overdue <b>{c.overdue}</b></span>}
              </div>

              <div className="perf-line"><span>Missions</span><b>{x.completedMissions}/{x.totalMissions}</b></div>
              <div className="admin-progress"><i style={{ width: `${x.progress}%` }} /></div>

              <button className="perf-expand" type="button" onClick={() => toggle(x.student.id)} aria-expanded={open}>
                {open ? "Hide task-wise results" : `View task-wise results (${(x.tasks || []).length})`}
              </button>

              {open && (
                (x.tasks || []).length === 0 ? (
                  <div className="perf-empty">No tasks assigned to this student yet.</div>
                ) : (
                  <div className="perf-table-wrap">
                    <table className="perf-table">
                      <thead>
                        <tr>
                          <th>Task</th><th>Status</th><th>Score</th><th>Submitted</th><th>Reviewed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {x.tasks.map((t) => (
                          <tr key={t.task_id} className={t.overdue ? "overdue" : ""}>
                            <td>
                              <strong>{t.title || "Untitled task"}</strong>
                              <small>{t.task_code || t.task_id}{t.day != null ? ` · Day ${String(t.day).padStart(2, "0")}` : ""}</small>
                            </td>
                            <td>
                              <span className={`perf-state ${t.state}`}>
                                {STATE_LABELS[t.state] || t.state}
                              </span>
                              {t.overdue && <span className="perf-state overdue">Overdue</span>}
                            </td>
                            <td>
                              {t.has_score
                                ? <span className="perf-score-cell">{t.score}/{t.max_marks}</span>
                                : <span className="muted" title="No score has been recorded for this task">
                                    {t.awaiting_evaluation ? "Awaiting evaluation" : "—"}
                                  </span>}
                            </td>
                            <td>{fmtDate(t.submission?.submitted_at)}</td>
                            <td>
                              {t.submission?.reviewed_at ? (
                                <span title={t.submission?.review_comments || ""}>
                                  {fmtDate(t.submission.reviewed_at)}
                                  {t.submission?.reviewer_name ? ` · ${t.submission.reviewer_name}` : ""}
                                </span>
                              ) : <span className="muted">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>
          );
        })}
      </div>

      {!items.length && (
        <div className="empty-state">
          No student performance data yet. Students will appear here once they are assigned tasks or missions.
        </div>
      )}
      {items.length > 0 && filtered.length === 0 && (
        <div className="empty-state">No students match “{search}”.</div>
      )}
    </div>
  );
}