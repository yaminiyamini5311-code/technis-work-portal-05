import { useEffect, useState } from "react";
import TechinsIcon from "../../components/TechinsIcon";
import "./StudentDashboard.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export default function Feedback() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const res = await fetch(`${API_URL}/api/student/feedback`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || "Unable to load feedback");

      // Combine performance feedback and task feedback
      const performanceFeedback = (d.feedback || []).map(item => ({
        ...item,
        type: 'performance',
        title: `Performance Review - ${item.period}`,
        displayTitle: 'Performance Review'
      }));

      const taskFeedback = (d.taskFeedback || []).map(item => ({
        ...item,
        type: 'task',
        displayTitle: item.task_code || 'Task'
      }));

      const allFeedback = [...performanceFeedback, ...taskFeedback]
        .sort((a, b) => new Date(b.created_at || b.updated_at) - new Date(a.created_at || a.updated_at));

      setItems(allFeedback);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const formatDate = (dateStr) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <div className="student-dashboard-page page-enter">
      <div className="simple-head">
        <span>PRIVATE FEEDBACK</span>
        <h2>My Feedback</h2>
        <p>Feedback shared with your student account.</p>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {loading ? (
        <div className="portal-loading small">
          <div className="loader-dot" />
          <p>Loading feedback...</p>
        </div>
      ) : items.length ? (
        <div className="workspace-card">
          {items.map(x => (
            <article className="feedback-item" key={`${x.type}-${x.id}`} style={{
              padding: '16px',
              borderBottom: '1px solid var(--border-light)',
              display: 'flex',
              gap: '12px',
              alignItems: 'flex-start'
            }}>
              <div className="feedback-item-icon" style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: 'rgba(250,154,2,0.12)',
                color: '#FA9A02',
                display: 'grid',
                placeItems: 'center',
                flex: 'none'
              }}>
                <TechinsIcon name="comment" size={18} variant="light" className="portal-icon" />
              </div>
              <div className="feedback-item-content" style={{ flex: 1, minWidth: 0 }}>
                <div style={{ marginBottom: '8px' }}>
                  <strong style={{ display: 'block', fontSize: '13px', color: '#FFFFFF' }}>
                    {x.displayTitle}
                  </strong>
                  <small style={{ color: '#C0C0C0', fontSize: '11px' }}>
                    {formatDate(x.created_at || x.updated_at)}
                  </small>
                </div>
                <p style={{ color: '#C0C0C0', fontSize: '12px', lineHeight: '1.6', margin: '0 0 8px 0' }}>
                  {x.feedback}
                </p>
                {x.score != null && (
                  <span className="score-chip" style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 10px',
                    background: 'rgba(250,154,2,0.15)',
                    borderRadius: '20px',
                    color: '#FA9A02',
                    fontSize: '11px',
                    fontWeight: '700'
                  }}>
                    <TechinsIcon name="trophy" size={14} variant="light" className="portal-icon" />
                    Score {x.score}%
                  </span>
                )}
                {x.strengths && (
                  <div style={{ marginTop: '8px' }}>
                    <small style={{ color: '#FA9A02', fontSize: '10px', fontWeight: '700', textTransform: 'uppercase' }}>Strengths:</small>
                    <p style={{ color: '#C0C0C0', fontSize: '11px', margin: '4px 0 0 0' }}>{x.strengths}</p>
                  </div>
                )}
                {x.improvements && (
                  <div style={{ marginTop: '8px' }}>
                    <small style={{ color: '#FA9A02', fontSize: '10px', fontWeight: '700', textTransform: 'uppercase' }}>Improvement areas:</small>
                    <p style={{ color: '#C0C0C0', fontSize: '11px', margin: '4px 0 0 0' }}>{x.improvements}</p>
                  </div>
                )}
              </div>
            </article>
          ))}
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
