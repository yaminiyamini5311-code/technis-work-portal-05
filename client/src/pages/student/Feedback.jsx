import { useCallback, useEffect, useState } from "react";
import TechinsIcon from "../../components/TechinsIcon";
import "../../styles/admin.css";
import "../admin/feedback.css";
import "../admin/performance.css";
import "./StudentDashboard.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

function fmtDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return String(value); }
}

function fmtDateTime(value) {
  if (!value) return "—";
  try { return new Date(value).toLocaleString(); } catch { return String(value); }
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
        const taskLabel = item.task_title
          ? `${item.task_code ? `${item.task_code} · ` : ""}${item.task_title}`
          : item.task_code || 'Task';
        return {
          ...item,
          type: 'performance',
          displayTitle: isTaskLinked ? taskLabel : `Performance Review${item.period ? ` - ${item.period}` : ""}`,
          taskLinked: isTaskLinked,
        };
      });

      const taskFeedback = (d.taskFeedback || []).map(item => ({
        ...item,
        type: 'task',
        displayTitle: item.title ? `${item.task_code ? `${item.task_code} · ` : ""}${item.title}` : (item.task_code || 'Task'),
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
      <div className="simple-head">
        <span>PRIVATE FEEDBACK</span>
        <h2>My Feedback</h2>
        <p>Feedback shared with your student account, grouped with the same card design as your performance.</p>
      </div>

      <div className="fb-toolbar">
        <button type="button" onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
        {items.length > 0 && <span className="fb-count">{items.length} entr{items.length === 1 ? "y" : "ies"}</span>}
      </div>

      {error && <div className="error-msg" role="alert">{error} <button type="button" onClick={load}>Retry</button></div>}

      {loading ? (
        <div className="portal-loading small">
          <div className="loader-dot" />
          <p>Loading feedback...</p>
        </div>
      ) : items.length ? (
        <div className="fb-students">
          <section className="panel fb-student perf-card" aria-label="My feedback entries">
            {items.map(x => (
              <article className="fb-entry" key={`${x.type}-${x.id}`}>
                <p><strong>{x.taskLinked ? "Task feedback" : "Performance review"}</strong> · {x.displayTitle}</p>
                <p>{x.feedback || "No feedback text recorded."}</p>
                <div className="fb-meta">
                  <span>{x.reviewer_name ? `By ${x.reviewer_name}` : "Reviewer unknown"}</span>
                  <span>{fmtDateTime(x.created_at || x.updated_at)}</span>
                  {x.updated_at && x.updated_at !== x.created_at && <span>Updated {fmtDateTime(x.updated_at)}</span>}
                  {x.score != null && <span className="fb-score">Score {x.score}</span>}
                  <span className="fb-status">{x.status || (x.taskLinked ? "task" : "recorded")}</span>
                </div>
                {x.strengths && <div className="fb-line"><b>Strengths:</b> {Array.isArray(x.strengths) ? x.strengths.join(", ") : x.strengths}</div>}
                {(x.improvements || x.improvement) && <div className="fb-line"><b>Improvement areas:</b> {Array.isArray(x.improvements || x.improvement) ? (x.improvements || x.improvement).join(", ") : (x.improvements || x.improvement)}</div>}
                <div className="fb-line"><small>{fmtDate(x.created_at || x.updated_at)}</small></div>
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
