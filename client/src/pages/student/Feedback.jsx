import { useCallback, useEffect, useState } from "react";
import TechinsIcon from "../../components/TechinsIcon";
import "../../styles/admin.css";
import "../admin/feedback.css";
import "../admin/performance.css";
import "./StudentDashboard.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

// FIX S-8: single consistent date format
function fmtDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
  } catch { return String(value); }
}

function pluralise(n, word) {
  return n === 1 ? `${n} ${word}` : `${n} ${word}s`;
}

export default function Feedback() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/student/feedback`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Unable to load feedback");

      // Performance entries include task-linked reviews (task_id/task_code);
      // legacy task.feedback rows are kept as task feedback.
      const performanceFeedback = (d.feedback || []).map(item => {
        const isTaskLinked = Boolean(item.task_id || item.task_code || item.task_title);
        // FIX S-9: single clear title — mission/task name or "General feedback"
        const displayTitle = isTaskLinked
          ? (item.task_title || item.task_code || "Task feedback")
          : "General feedback";
        return {
          ...item,
          type: 'performance',
          displayTitle,
          taskLinked: isTaskLinked,
        };
      });

      const taskFeedback = (d.taskFeedback || []).map(item => ({
        ...item,
        type: 'task',
        displayTitle: item.title || item.task_code || "Task feedback",
        feedback: item.feedback,
        taskLinked: true,
      }));

      const allFeedback = [...performanceFeedback, ...taskFeedback]
        .sort((a, b) => new Date(b.created_at || b.updated_at || 0) - new Date(a.created_at || a.updated_at || 0));

      setItems(allFeedback);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="student-dashboard-page page-enter">
      {/* FIX S-7: user-facing copy instead of developer text */}
      <div className="simple-head">
        <span>PRIVATE FEEDBACK</span>
        <h2>My Feedback</h2>
        <p>Feedback from your reviewers on your work.</p>
      </div>

      <div className="fb-toolbar">
        <button type="button" onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
        {items.length > 0 && <span className="fb-count">{pluralise(items.length, "entry")}</span>}
      </div>

      {error && <div className="error-msg" role="alert">{error} <button type="button" onClick={load}>Retry</button></div>}

      {loading ? (
        <div className="portal-loading small">
          <div className="loader-dot" />
          <p>Loading feedback...</p>
        </div>
      ) : items.length ? (
        /* FIX S-10: constrain width like the dashboard */
        <div className="fb-students" style={{ maxWidth: 1100, margin: "0 auto" }}>
          <section className="panel fb-student perf-card" aria-label="My feedback entries">
            {items.map(x => (
              <article className="fb-entry" key={`${x.type}-${x.id}`}>
                {/* FIX S-9: single clear title */}
                <p><strong>{x.displayTitle}</strong></p>
                <p>{x.feedback || "No feedback text recorded."}</p>
                <div className="fb-meta">
                  {/* FIX S-8: show reviewer name or "—" */}
                  <span>{x.reviewer_name ? `By ${x.reviewer_name}` : "—"}</span>
                  {/* FIX S-8: single date format */}
                  <span>{fmtDate(x.created_at || x.updated_at)}</span>
                  {x.score != null && <span className="fb-score">Score {x.score}</span>}
                  <span className="fb-status">{x.status || "recorded"}</span>
                </div>
                {x.strengths && <div className="fb-line"><b>Strengths:</b> {Array.isArray(x.strengths) ? x.strengths.join(", ") : x.strengths}</div>}
                {(x.improvements || x.improvement) && <div className="fb-line"><b>Improvement areas:</b> {Array.isArray(x.improvements || x.improvement) ? (x.improvements || x.improvement).join(", ") : (x.improvements || x.improvement)}</div>}
              </article>
            ))}
          </section>
        </div>
      ) : (
        <div className="workspace-empty">
          <TechinsIcon name="comment" size={40} variant="light" className="icon-sway portal-icon" />
          <strong>No feedback has been added yet</strong>
          <span>Feedback from your work will appear here.</span>
        </div>
      )}
    </div>
  );
}
