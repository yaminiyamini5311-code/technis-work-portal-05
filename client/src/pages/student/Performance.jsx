import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import TechinsIcon from "../../components/TechinsIcon";
import { useScrollReveal } from "../../components/useScrollReveal";
import "../../styles/admin.css";
import "../admin/performance.css";
import "./Performance.css";

const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5000";

/* Same task states as the CEO performance page (utils/studentReport.js) so
   both portals can never disagree on what a state means. */
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

function Performance() {
  const navigate = useNavigate();

  const [performance, setPerformance] = useState(null);
  const [report, setReport] = useState(null);
  const [showTasks, setShowTasks] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const token = localStorage.getItem("token");

  const user = JSON.parse(
    localStorage.getItem("user") || "{}"
  );

  useScrollReveal('.reveal-card', {
    stagger: 60,
    initialScale: 0.96,
    initialOpacity: 0.15,
    initialTranslateY: 24,
    initialBlur: 0
  });

  const loadPerformance = async () => {
    if (!token) {
      navigate("/login");
      return;
    }

    try {
      setLoading(true);
      setError("");
      // Summary (progress, score, missions, strengths, feedback) comes from
      // /api/student/dashboard; the task-wise breakdown uses the same
      // builder as the CEO page via /api/student/report (own data only).
      const headers = { Authorization: `Bearer ${token}` };
      const [dashRes, reportRes] = await Promise.all([
        axios.get(`${API_URL}/api/student/dashboard`, { headers }),
        axios.get(`${API_URL}/api/student/report`, { headers }).catch(() => ({ data: null })),
      ]);

      setPerformance(dashRes.data);
      if (reportRes?.data?.success) setReport(reportRes.data);
      else setReport(null);
    } catch (err) {
      console.error("Performance error:", err);

      if (err.response?.status === 401) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        navigate("/login");
        return;
      }

      setError(
        err.response?.data?.message ||
          "Unable to load your performance."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPerformance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (loading) {
    return (
      <div className="student-performance-page">
        <div className="loading-box">
          <div className="loader"></div>
          <h2>Loading your performance...</h2>
          <p>Please wait.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="student-performance-page">
        <div className="error-box">
          <h2>Private Performance</h2>
          <p>{error}</p>

          <button
            onClick={() => navigate("/student")}
            className="back-button"
          >
            <TechinsIcon name="chevron" size={14} variant="light" ariaHidden style={{ transform: "rotate(180deg)" }} /> Back to Dashboard
          </button>
          <button onClick={loadPerformance} className="back-button" style={{ marginLeft: 8 }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const progress = Number(performance?.progress ?? report?.progress ?? 0) || 0;
  // FIX S-2: Use task-based score from report (consistent with task-wise results card)
  const score = scoring.overall_percentage ?? null;
  const completed = performance?.completedMissions ?? report?.completedMissions ?? 0;
  const total = performance?.totalMissions ?? report?.totalMissions ?? 0;
  const counts = report?.counts || {};
  const scoring = report?.scoring || {};
  const tasks = report?.tasks || [];

  const missionPercentage =
    total > 0
      ? Math.round((completed / total) * 100)
      : 0;

  return (
    <div className="student-performance-page">
      {/* STUDENT INFORMATION */}

      <main className="performance-container">

        <section className="student-profile">

          <div className="student-avatar">
            {(user.name || "S")
              .charAt(0)
              .toUpperCase()}
          </div>

          <div>
            <h2>
              {user.name || "Student"}
            </h2>

            <p>
              {user.email || "Student account"}
            </p>

            <span>
              Role: {user.role || "student"}
            </span>
          </div>

        </section>


        {/* MAIN PERFORMANCE */}

        <section className="student-performance-grid">

          {/* PROGRESS */}

          <div className="student-performance-card reveal-card">

            <div className="card-top">
              <span className="card-icon">
                <TechinsIcon name="chart" size={28} variant="light" className="portal-icon" />
              </span>

              <span className="card-label">
                PROGRESS
              </span>
            </div>

            <h2>{progress}%</h2>

            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: `${progress}%`,
                }}
              ></div>
            </div>

            <p>
              Your current learning progress
            </p>

          </div>


          {/* SCORE */}

          <div className="student-performance-card reveal-card">

            <div className="card-top">
              <span className="card-icon">
                <TechinsIcon name="trophy" size={28} variant="light" className="portal-icon" />
              </span>

              <span className="card-label">
                SCORE
              </span>
            </div>

            <h2>{score == null ? "—" : `${score}%`}</h2>

            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: `${score == null ? 0 : score}%`,
                }}
              ></div>
            </div>

            <p>
              {score == null ? "Not evaluated yet" : "Your overall performance score"}
            </p>

          </div>


          {/* COMPLETED MISSIONS */}

          <div className="student-performance-card reveal-card">

            <div className="card-top">
              <span className="card-icon">
                <TechinsIcon name="check" size={28} variant="light" className="portal-icon" />
              </span>

              <span className="card-label">
                MISSIONS
              </span>
            </div>

            <h2>
              {completed} / {total}
            </h2>

            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: `${missionPercentage}%`,
                }}
              ></div>
            </div>

            <p>
              Missions completed
            </p>

          </div>

        </section>

        {/* TASK-WISE BREAKDOWN — same visual language as the CEO page */}
        {report && (
          <section className="panel perf-card reveal-card" aria-label="Task-wise results">
            <div className="panel-head">
              <div>
                <h3>Task-wise results</h3>
                <small>
                  {counts.total || 0} task{(counts.total || 0) === 1 ? "" : "s"} assigned
                  {scoring.has_scores
                    ? ` · ${scoring.scored_tasks} scored · ${scoring.total_earned}/${scoring.total_max} marks`
                    : " · no scores recorded yet"}
                </small>
              </div>
              <strong title="Approval-based completion across tasks and missions">{progress}%</strong>
            </div>

            <div className="perf-score-block">
              <div>
                <small>Overall score</small>
                {scoring.overall_percentage == null
                  ? <strong className="muted">Not evaluated</strong>
                  : <strong>{scoring.overall_percentage}%</strong>}
              </div>
            </div>

            <div className="perf-counts">
              <span className="perf-chip total">Total <b>{counts.total || 0}</b></span>
              <span className="perf-chip approved">Approved <b>{counts.approved || 0}</b></span>
              <span className="perf-chip submitted">Submitted <b>{counts.submitted || 0}</b></span>
              <span className="perf-chip pending">Pending <b>{counts.pending || 0}</b></span>
              {(counts.revision_required || 0) > 0 && <span className="perf-chip revision">Revision <b>{counts.revision_required}</b></span>}
              {(counts.overdue || 0) > 0 && <span className="perf-chip overdue">Overdue <b>{counts.overdue}</b></span>}
            </div>

            <div className="perf-line"><span>Missions</span><b>{completed}/{total}</b></div>
            <div className="admin-progress"><i style={{ width: `${progress}%` }} /></div>

            <button
              className="perf-expand"
              type="button"
              onClick={() => setShowTasks((v) => !v)}
              aria-expanded={showTasks}
            >
              {showTasks ? "Hide task-wise results" : `View task-wise results (${tasks.length})`}
            </button>

            {showTasks && (
              tasks.length === 0 ? (
                <div className="perf-empty">No tasks assigned to you yet.</div>
              ) : (
                <div className="perf-table-wrap">
                  <table className="perf-table">
                    <thead>
                      <tr>
                        <th>Task</th><th>Status</th><th>Score</th><th>Submitted</th><th>Reviewed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map((t) => (
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
          </section>
        )}


        {/* DETAILS */}

        <section className="details-grid">

          {/* STRENGTHS */}

          <div className="detail-card reveal-card">

            <div className="detail-heading">
              <span><TechinsIcon name="strength" size={24} variant="light" className="portal-icon" /></span>
              <h3>Strengths</h3>
            </div>

            {performance?.strengths?.length > 0 ? (
              <ul>
                {performance.strengths.map(
                  (item, index) => (
                    <li key={index}>
                      {item}
                    </li>
                  )
                )}
              </ul>
            ) : (
              <p className="student-empty-text">
                No strengths added yet.
              </p>
            )}

          </div>


          {/* IMPROVEMENT */}

          <div className="detail-card reveal-card">

            <div className="detail-heading">
              <span><TechinsIcon name="improve" size={24} variant="light" className="portal-icon" /></span>
              <h3>Areas to Improve</h3>
            </div>

            {performance?.improvement?.length > 0 ? (
              <ul>
                {performance.improvement.map(
                  (item, index) => (
                    <li key={index}>
                      {item}
                    </li>
                  )
                )}
              </ul>
            ) : (
              <p className="student-empty-text">
                No improvement areas added yet.
              </p>
            )}

          </div>


          {/* FEEDBACK */}

          <div className="detail-card reveal-card">

            <div className="detail-heading">
              <span><TechinsIcon name="comment" size={24} variant="light" className="portal-icon" /></span>
              <h3>Feedback</h3>
            </div>

            <div className="feedback-card">
              <p>{performance?.feedback || "No feedback recorded yet."}</p>
            </div>

          </div>

        </section>


        {/* PRIVACY MESSAGE */}

        <div className="privacy-message">
          <TechinsIcon name="lock" size={16} variant="light" /> This performance information is private
          and belongs only to your student account.
        </div>

      </main>

    </div>
  );
}

export default Performance;
