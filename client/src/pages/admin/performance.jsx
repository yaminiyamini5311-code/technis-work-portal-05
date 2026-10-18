import { useCallback, useEffect, useMemo, useState } from "react";
import StatusBadge from "../../components/StatusBadge";
import { formatWorkspaceDateTime, pluralise } from "../../utils/dateHelper";
import "../../styles/admin.css";
import "../../styles/ceo-ui.css";
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

/** A Mongo ObjectId rendered as a bare 24-character hex string. */
const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * The student's display code, or null when the endpoint only gave us a raw
 * database id.
 *
 * GET /api/performance returns `student.id` and `student.student_id`, but
 * server/utils/studentReport.js:199 reads `student.student_id` from the users
 * collection while TECHINS stores that code in `learner_id`. The field is
 * therefore always undefined server-side and the expression falls back to the
 * ObjectId, which is why the card used to show "ID: 6acf831d7f1e…".
 *
 * The frontend does not invent a code it was not given. It shows the value when
 * it is a real code and otherwise says so, keeping the raw id in the tooltip so
 * nothing is hidden. The backend mapping is reported rather than worked around.
 */
function displayStudentCode(student) {
  const candidate = student.student_id || student.student_code || "";
  if (!candidate || OBJECT_ID.test(candidate)) return null;
  return candidate;
}

/**
 * Program and batch, de-duplicated.
 * These collections hold the same string for most students, which rendered as
 * "Techins 60 · Techins 60". When they are equal the batch is dropped and the
 * value is labelled; when they differ both are labelled so neither is ambiguous.
 */
function programAndBatch(student) {
  const program = (student.program || "").trim();
  const batch = (student.batch_name || student.batch || "").trim();
  const parts = [];
  if (program) parts.push(`Program: ${program}`);
  if (batch && batch.toLowerCase() !== program.toLowerCase()) parts.push(`Batch: ${batch}`);
  return parts.join(" · ");
}

/* Task states come from the server (utils/studentReport.js) so the CEO view
   and the stored per-student/per-task records can never disagree. */
function stateLabel(state) {
  return STATE_LABELS[state] || state || "Unknown";
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

      <div className="perf-search-bar ui-toolbar">
        <input
          className="ui-input"
          type="search"
          aria-label="Search students"
          placeholder="Search by student name, email, ID, program or batch…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button type="button" className="ui-btn ui-btn--neutral" onClick={() => setSearch("")}>Clear</button>
        )}
      </div>

      {/* align-items:start lives in performance.css. Grid items default to
          stretch, so one expanded card used to stretch its whole row and leave
          its neighbours with a tall empty gap. */}
      <div className="performance-admin-grid">
        {filtered.map((x) => {
          const c = x.counts || {};
          const s = x.scoring || {};
          const open = !!expanded[x.student.id];
          const code = displayStudentCode(x.student);
          const cohort = programAndBatch(x.student);
          return (
            <div className="panel perf-card" key={x.student.id}>
              {/* Fixed three-cell grid: identity | progress | spacer. The
                  progress percentage stays in the same place on every card
                  regardless of how long the name or email is. */}
              <div className="panel-head perf-card-head">
                <div className="perf-identity">
                  <h3>{x.student.name}</h3>
                  <small>{x.student.email}</small>
                  <small className="perf-identity-meta">
                    {code
                      ? <>ID: <b>{code}</b></>
                      : (
                        <>
                          ID: <span className="ui-na" title={`Only a database id is available: ${x.student.id}`}>Not available</span>
                        </>
                      )}
                    {cohort ? <> · {cohort}</> : null}
                  </small>
                </div>
                <strong
                  className="perf-progress-value"
                  title="Approval-based completion across tasks and missions"
                >
                  {x.progress}%
                </strong>
              </div>

              {/* Two fixed columns. A card with no Latest review leaves that
                  cell empty instead of shifting "Overall score" left. */}
              <div className="perf-score-block">
                <div className="perf-score-cell-main">
                  <small>Overall score</small>
                  {s.overall_percentage == null
                    ? <strong className="muted">Not evaluated</strong>
                    : <strong>{s.overall_percentage}%</strong>}
                  {s.has_scores && (
                    <small className="perf-score-basis">
                      {pluralise(s.scored_tasks || 0, "scored task")} · {s.total_earned}/{s.total_max} marks
                    </small>
                  )}
                  {!s.has_scores && (
                    <small className="perf-score-basis">
                      {pluralise(c.total || 0, "task")} assigned · no scores recorded yet
                    </small>
                  )}
                </div>
                <div className="perf-eval-score">
                  <small>Latest review</small>
                  {x.score != null ? (
                    <>
                      <strong>{x.score}%</strong>
                      <small>{x.lastReviewed ? formatWorkspaceDateTime(x.lastReviewed) : ""}</small>
                    </>
                  ) : (
                    <strong className="muted">—</strong>
                  )}
                </div>
              </div>

              {/* Count chips from the shared status palette. */}
              <div className="perf-counts ui-chip-group">
                <span className="ui-chip ui-chip--submitted">Total <b>{c.total || 0}</b></span>
                <StatusBadge status="approved" count={c.approved || 0} label="Approved" />
                <StatusBadge status="submitted" count={c.submitted || 0} label="Submitted" />
                <StatusBadge status="pending" count={c.pending || 0} label="Pending" />
                {c.revision_required > 0 && (
                  <StatusBadge status="revision_required" count={c.revision_required} label="Revision" />
                )}
                {c.overdue > 0 && <StatusBadge status="overdue" count={c.overdue} label="Overdue" />}
              </div>

              {/* Label, count and bar on one aligned row. */}
              <div className="perf-line">
                <span>Missions</span>
                <b>{x.completedMissions}/{x.totalMissions}</b>
              </div>
              <div className="admin-progress"><i style={{ width: `${x.progress}%` }} /></div>

              {/* Same position in every card, neutral grey. */}
              <button className="ui-btn ui-btn--neutral perf-expand" type="button" onClick={() => toggle(x.student.id)} aria-expanded={open}>
                {open ? "Hide task-wise results" : `View task-wise results (${(x.tasks || []).length})`}
              </button>

              {open && (
                (x.tasks || []).length === 0 ? (
                  <div className="perf-empty">No tasks assigned to this student yet.</div>
                ) : (
                  /* The wrapper scrolls; the card itself never overflows. */
                  <div className="perf-table-wrap ui-table-wrap">
                    <table className="perf-table ui-table">
                      <colgroup>
                        <col style={{ width: "38%" }} />
                        <col style={{ width: "20%" }} />
                        <col style={{ width: "12%" }} />
                        <col style={{ width: "15%" }} />
                        <col style={{ width: "15%" }} />
                      </colgroup>
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
                              <div className="ui-chip-group">
                                <StatusBadge status={t.state} label={stateLabel(t.state)} />
                                {t.overdue && <StatusBadge status="overdue" label="Overdue" />}
                              </div>
                            </td>
                            <td>
                              {t.has_score
                                ? <span className="perf-score-cell">{t.score}/{t.max_marks}</span>
                                : <span className="muted" title="No score has been recorded for this task">
                                    {t.awaiting_evaluation ? "Awaiting evaluation" : "—"}
                                  </span>}
                            </td>
                            {/* Shared formatter; never truncated. */}
                            <td className="perf-date">{formatWorkspaceDateTime(t.submission?.submitted_at)}</td>
                            <td className="perf-date">
                              {t.submission?.reviewed_at ? (
                                <span title={t.submission?.review_comments || ""}>
                                  {formatWorkspaceDateTime(t.submission.reviewed_at)}
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