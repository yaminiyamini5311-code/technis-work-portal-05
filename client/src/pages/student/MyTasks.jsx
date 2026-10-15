import { useEffect, useRef, useState } from "react";
import axios from "axios";
import TechinsIcon from "../../components/TechinsIcon";
import { useScrollReveal } from "../../components/useScrollReveal";
import "./MyTasks.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

function formatDateTime(value) {
  if (!value) return "—";
  try { return new Date(value).toLocaleString(); } catch { return String(value); }
}

function formatBytes(n) {
  if (n === null || n === undefined) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/* Downloads through fetch so the Authorization header travels with the
   request (a plain anchor cannot send it), then saves the blob locally. */
async function downloadOwnFile(file, onError) {
  try {
    const res = await fetch(`${API_URL}${file.download_url}`, { headers: auth() });
    if (!res.ok) {
      let msg = "Unable to download file";
      try { msg = (await res.json()).message || msg; } catch {}
      onError(msg);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name || "submission-file";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch {
    onError("Unable to download file. Check your connection.");
  }
}

const DOMAINS = [
  { value: "edutins", label: "EduTins" },
  { value: "resins", label: "ResIns" },
  { value: "innovins", label: "InnoVins" },
  { value: "systins", label: "SysTins" },
  { value: "program", label: "Program" }
];

export default function MyTasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState({});
  const [comments, setComments] = useState({});
  const [domainFilter, setDomainFilter] = useState("");
  // Submission history per task (fetched on demand, never in the list call)
  const [history, setHistory] = useState({});
  const previousApproved = useRef(null);
  // Synchronous guards: React state updates are async, so a fast second
  // click could still observe stale `busy`/`loading` values and fire a
  // duplicate request. Refs are read synchronously in the same tick.
  const submittingRef = useRef(false);
  const loadingRef = useRef(false);

  // Scroll reveal effect for space theme - sophisticated animation
  useScrollReveal('.reveal-card', {
    stagger: 60,
    initialScale: 0.96,
    initialOpacity: 0.15,
    initialTranslateY: 24,
    initialBlur: 0
  });

  const load = async () => {
    // Guard overlapping polls/refetches (the 20s interval can fire while a
    // slow request is still in flight).
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      setLoading(true);
      const { data } = await axios.get(`${API_URL}/api/tasks/my`, { headers: auth() });
      const next = data.tasks || [];
      
      // Fetch per-student submission status for each task
      const tasksWithSubmissionStatus = await Promise.all(
        next.map(async (task) => {
          try {
            const { data: subData } = await axios.get(
              `${API_URL}/api/tasks/${task.id}/my-submission-status`,
              { headers: auth() }
            );
            return {
              ...task,
              has_submission: subData.has_submission || false,
              student_workflow_status: subData.workflow_status || null,
              latest_submission: subData.latest_submission || null
            };
          } catch (err) {
            // If endpoint fails, fall back to task data
            return task;
          }
        })
      );
      
      const approved = tasksWithSubmissionStatus.filter((task) => (task.student_workflow_status || task.workflow_status) === "Approved" || task.status === "completed").length;
      previousApproved.current = approved;
      setTasks(tasksWithSubmissionStatus);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Unable to load your tasks.");
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(() => {
      // Pause polling while the tab is hidden; resume on visibility.
      if (document.hidden) return;
      load();
    }, 20000);
    return () => clearInterval(id);
  }, []);

  const startTask = async (id) => {
    try {
      setBusy(id);
      await axios.patch(`${API_URL}/api/tasks/${id}/status`, { workflow_status: "In Progress" }, { headers: auth() });
      setMessage("Task started.");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Unable to start task.");
    } finally {
      setBusy(null);
    }
  };

  const submitTask = async (task) => {
    // Synchronous duplicate-submit guard (double-click / retry): the ref is
    // set before the first await, so a second click in the same tick is a
    // no-op. React state (`busy`) only drives the button's disabled look.
    if (submittingRef.current) return;
    const files = selectedFiles[task.id] || [];
    const comment = String(comments[task.id] || "").trim();
    if (!files.length && !comment) {
      setError("Add at least one file or a submission comment before submitting.");
      return;
    }
    // Client-side file validation mirrors the server (multer) rules so the
    // student gets instant feedback instead of a failed upload.
    const allowedExt = new Set([".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".zip", ".png", ".jpg", ".jpeg"]);
    const maxFiles = 5;
    // Must match the server's multer limit AND Vercel's ~4.5 MB serverless
    // request-body cap: anything larger fails at the platform.
    const maxBytes = 4 * 1024 * 1024;
    if (files.length > maxFiles) {
      setError(`Select at most ${maxFiles} files per submission.`);
      return;
    }
    for (const f of files) {
      const ext = (f.name.match(/\.[^.]+$/) || [""])[0].toLowerCase();
      if (!allowedExt.has(ext)) {
        setError(`Unsupported file type: ${f.name}. Allowed: PDF, DOC, PPT, XLS, ZIP, PNG, JPG.`);
        return;
      }
      if (f.size > maxBytes) {
        setError(`File too large: ${f.name} (max 4 MB each).`);
        return;
      }
    }
    try {
      setBusy(task.id);
      submittingRef.current = true;
      const form = new FormData();
      files.forEach((file) => form.append("files", file));
      if (comment) form.append("comment", comment);
      await axios.post(`${API_URL}/api/tasks/${task.id}/submit`, form, { headers: auth() });
      setSelectedFiles((value) => ({ ...value, [task.id]: [] }));
      setComments((value) => ({ ...value, [task.id]: "" }));
      setMessage("Submission recorded with a server timestamp.");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Unable to submit the task.");
    } finally {
      setBusy(null);
      submittingRef.current = false;
    }
  };

  const toggleHistory = async (task) => {
    // Collapse when already open; otherwise fetch the versions on demand.
    if (history[task.id]) {
      setHistory((prev) => { const next = { ...prev }; delete next[task.id]; return next; });
      return;
    }
    setHistory((prev) => ({ ...prev, [task.id]: { loading: true } }));
    try {
      const { data } = await axios.get(`${API_URL}/api/tasks/${task.id}`, { headers: auth() });
      const versions = (data.submissions || [])
        .slice()
        .sort((a, b) => (b.version || 0) - (a.version || 0));
      setHistory((prev) => ({ ...prev, [task.id]: { versions } }));
    } catch (err) {
      setError(err.response?.data?.message || "Unable to load your submission history.");
      setHistory((prev) => { const next = { ...prev }; delete next[task.id]; return next; });
    }
  };

  const ts = (t) => t.student_workflow_status || t.workflow_status;
  const completed = tasks.filter((t) => ts(t) === "Approved" || t.status === "completed").length;
  const pending = tasks.filter((t) => ["Assigned", "Scheduled", "pending"].includes(ts(t)) || t.status === "pending").length;
  const inProgress = tasks.filter((t) => ["In Progress", "Acknowledged", "Revision Required"].includes(ts(t)) || t.status === "in_progress").length;
  const review = tasks.filter((t) => ["Submitted", "Under Review", "Resubmitted"].includes(ts(t))).length;
  const percent = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;

  if (loading && !tasks.length) return <div className="portal-loading"><div className="loader-dot" /><h2>Loading your tasks</h2><p>Syncing your latest assignments.</p></div>;

  return (
    <div className="my-tasks-page page-enter">
      <div className="tasks-container">
        <div className="page-header">
          <div><p className="page-label">STUDENT WORKSPACE</p><h1>My Tasks</h1><p className="page-description">Execute assignments, submit proof and follow every review step.</p></div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <select
              value={domainFilter}
              onChange={e => setDomainFilter(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.28)',
                background: 'rgba(255,255,255,0.15)',
                color: '#F5F8FF',
                fontSize: '13px'
              }}
            >
              <option value="">All Domains</option>
              {DOMAINS.map(d => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
            <button className="refresh-button" onClick={load} disabled={loading}><TechinsIcon name="refresh" size={14} variant="light" /> Refresh</button>
          </div>
        </div>
        {error && <div className="task-alert">{error}</div>}
        {message && <div className="info-msg">{message}</div>}

        <div className="task-summary">
          {[
            ["Total Tasks", tasks.length, "clipboard"],
            ["Pending", pending, "clock"],
            ["In Progress", inProgress, "progress"],
            ["Under Review", review, "search"],
            ["Approved", completed, "check"]
          ].map(([label, value, iconName]) => (
            <div className="summary-card reveal-card" key={label} data-space-depth>
              <div className="summary-icon"><TechinsIcon name={iconName} size={22} variant="light" className="portal-icon" /></div>
              <div><span>{label}</span><strong>{value}</strong></div>
            </div>
          ))}
        </div>

        <div className="overall-progress"><div className="progress-heading"><div><h2>Verified Task Progress</h2><p>Only approved tasks count as completed.</p></div><strong>{percent}%</strong></div><div className="progress-track"><div className="progress-fill" style={{ width: `${percent}%` }} /></div></div>

        <div className="tasks-list">
          {tasks.length ? tasks.filter(t => !domainFilter || t.domain === domainFilter).map((task) => {
            const workflow = task.workflow_status || (task.status === "completed" ? "Approved" : task.status === "in_progress" ? "In Progress" : "Assigned");
            
            // Check if this specific student has submitted - use per-student submission status
            const hasStudentSubmission = task.has_submission === true;
            const studentStatus = task.student_workflow_status || workflow;
            
            const needsRevision = studentStatus === "Revision Required";
            const startAt = task.start_at || (task.start_date ? `${task.start_date}T${task.start_time || "00:00"}:00` : null);
            const endAt = task.due_at || (task.due_date ? `${task.due_date}T${task.due_time || "23:59"}:00` : null);
            const nowDate = new Date();
            const beforeStart = !!startAt && nowDate < new Date(startAt);
            const expired = !!endAt && nowDate > new Date(endAt);
            const isClosed = ["Approved", "Cancelled", "Archived"].includes(studentStatus) || ["Cancelled", "Archived"].includes(workflow) || expired;
            const canSubmit = !isClosed && (!hasStudentSubmission || needsRevision) && (hasStudentSubmission ? needsRevision : true);
            

            // Show "awaiting review" only if this student actually submitted
            const showAwaitingReview = hasStudentSubmission && ["Submitted", "Under Review", "Resubmitted"].includes(studentStatus);
            
            // Check if task is overdue
            const isOverdue = task.due_date && new Date(task.due_date) < new Date() && workflow !== "Approved";
            
            // Format dates for display
            const formatDate = (dateStr) => {
              if (!dateStr) return null;
              const d = new Date(dateStr + 'T00:00:00'); // Avoid timezone shifts
              return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
            };
            
            return (
              <article className={`task-card reveal-card ${task.status} ${isOverdue ? 'overdue' : ''}`} key={task.id}>
                <div className="task-card-top">
                  <div>
                    <span className="task-label">{task.task_code || "TASK"}</span>
                    <h2>{task.title}</h2>
                    {task.description && <div className="task-section"><strong>Description:</strong><p style={{ whiteSpace: 'pre-wrap' }}>{task.description}</p></div>}
                    {task.expected_output && <div className="task-section"><strong>Expected Output:</strong><p style={{ whiteSpace: 'pre-wrap' }}>{task.expected_output}</p></div>}
                    {task.how_to_do && <div className="task-section"><strong>How to Do:</strong><p style={{ whiteSpace: 'pre-wrap' }}>{task.how_to_do}</p></div>}
                    {task.submission_requirements && <div className="task-section"><strong>Submission Requirements:</strong><p style={{ whiteSpace: 'pre-wrap' }}>{task.submission_requirements}</p></div>}
                  </div>
                  <span className={`status ${task.status} ${isOverdue ? 'overdue-badge' : ''}`}>{isOverdue && <TechinsIcon name="alert" size={13} ariaHidden />} {isOverdue ? 'Overdue' : workflow}</span>
                </div>
                <div className="task-meta-grid">
                  <div><span>Priority</span><strong className={`priority ${task.priority}`}>{task.priority || "medium"}</strong></div>
                  {task.domain && <div><span>Domain</span><strong style={{ textTransform: 'capitalize' }}>{task.domain}</strong></div>}
                  {task.start_date && <div><span>Start</span><strong>{formatDate(task.start_date)}{task.start_time ? ` ${task.start_time}` : ""}</strong></div>}
                  <div><span>End</span><strong>{task.due_date ? `${formatDate(task.due_date)}${task.due_time ? ` ${task.due_time}` : ""}` : "No deadline"}</strong></div>
                  <div><span>Assigned by</span><strong>{task.assigned_by_name || "Management"}</strong></div>
                  <div><span>Versions</span><strong>{task.latest_version || 0}</strong></div>
                </div>
                <div className="task-actions">
                  {(!hasStudentSubmission && (studentStatus === "Assigned" || task.status === "pending" || studentStatus === null)) && (beforeStart ? <div className="completed-label">Starts on {startAt ? new Date(startAt).toLocaleString() : "scheduled time"}</div> : <button className="action-progress" disabled={busy === task.id || expired} onClick={() => startTask(task.id)}>{busy === task.id ? "Updating…" : "Start Task"}</button>)}
                  {showAwaitingReview ? <div className="completed-label">Submission received · awaiting review</div> : null}
                  {hasStudentSubmission && (
                    <button className="action-progress" onClick={() => toggleHistory(task)} aria-expanded={!!history[task.id]}>
                      <TechinsIcon name="history" size={14} variant="light" ariaHidden />
                      {history[task.id] ? "Hide my submissions" : "My submissions"}{" "}
                      {task.latest_version ? `(v${task.latest_version})` : ""}
                    </button>
                  )}
                  {studentStatus === "Approved" && <div className="completed-label"><TechinsIcon name="check" size={16} variant="light" /> Task approved and recorded</div>}
                </div>
                {hasStudentSubmission && history[task.id] && (
                  <div className="submission-history">
                    {history[task.id].loading && <small>Loading your submissions…</small>}
                    {history[task.id].versions && history[task.id].versions.length === 0 && (
                      <small>No submission versions recorded yet.</small>
                    )}
                    {(history[task.id].versions || []).map((v) => (
                      <div className="submission-history-row" key={v.id || v.version}>
                        <div>
                          <strong>Version {v.version} · {v.status}</strong>
                          <small>{formatDateTime(v.submitted_at)} · {v.submission_code || "—"}</small>
                          {v.comment && <p>{v.comment}</p>}
                          {v.review_comments && (
                            <p className="submission-history-review">
                              Reviewer feedback: {v.review_comments}
                            </p>
                          )}
                        </div>
                        {(v.files || []).length > 0 ? (
                          <div className="submission-history-files">
                            {v.files.map((f) => (
                              <button key={f.id} className="action-progress" onClick={() => downloadOwnFile(f, setError)}>
                                <TechinsIcon name="download" size={13} variant="light" ariaHidden />
                                {f.name}{f.size ? ` (${formatBytes(f.size)})` : ""}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <small>No files on this version</small>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {task.workflow_status === "Revision Required" && hasStudentSubmission && <div className="feedback-box"><strong>Revision requested</strong><p>{task.feedback || "Review the manager feedback and submit a new version."}</p></div>}
                {canSubmit && <div className="upload-box">
                  <div><strong>{workflow === "Revision Required" ? "Submit revised work" : "Submit task work"}</strong><small>PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, ZIP, PNG, JPG · max 4 MB each</small></div>
                  <textarea value={comments[task.id] || ""} onChange={(e) => setComments((value) => ({ ...value, [task.id]: e.target.value }))} placeholder="Submission comment / outcome (optional if files are selected)" />
                  <label className="upload-button">{selectedFiles[task.id]?.length ? `${selectedFiles[task.id].length} file(s) selected` : "Choose files"}<input type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip,.png,.jpg,.jpeg" onChange={(e) => setSelectedFiles((value) => ({ ...value, [task.id]: Array.from(e.target.files || []) }))} /></label>
                  <button className="gold-btn" disabled={busy === task.id} onClick={() => submitTask(task)}>{busy === task.id ? "Submitting…" : "Submit for Review"}</button>
                </div>}
                {task.feedback && workflow !== "Revision Required" && <div className="feedback-box"><strong>Feedback</strong><p>{task.feedback}</p></div>}
              </article>
            );
          }) : <div className="empty-state">No tasks assigned yet.</div>}
        </div>
      </div>
    </div>
  );
}
