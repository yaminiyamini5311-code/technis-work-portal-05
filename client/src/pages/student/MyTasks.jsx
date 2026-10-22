import { useEffect, useRef, useState, Fragment } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import TechinsIcon from "../../components/TechinsIcon";
import { useScrollReveal } from "../../components/useScrollReveal";
import { formatISTDateTime, formatISTDate, formatDuration, formatWorkspaceDateTime } from "../../utils/dateHelper";
import { remainingTime } from "../../utils/api";
import "./MyTasks.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

function formatDateTime(value) {
  if (!value) return "—";
  return formatISTDateTime(value);
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
  // Success popup state
  const [submitSuccess, setSubmitSuccess] = useState(null);
  const previousApproved = useRef(null);
  // Synchronous guards: React state updates are async, so a fast second
  // click could still observe stale `busy`/`loading` values and fire a
  // duplicate request. Refs are read synchronously in the same tick.
  const submittingRef = useRef(false);
  const loadingRef = useRef(false);
  // Bumped every minute purely to re-render the revision countdown.
  const [now, setNow] = useState(0);

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
            // The endpoint returns { success, data, error } plus a flat mirror
            // of the same fields. Prefer `data`, fall back to the flat keys so
            // the portal keeps working against either shape.
            const status = subData?.data || subData || {};
            return {
              ...task,
              has_submission: status.has_submission || false,
              student_workflow_status: status.workflow_status || null,
              latest_submission: status.latest_submission || null,
              // Canonical per-student status + the revision window. The
              // backend is the source of truth for every one of these; the
              // portal only renders them.
              student_status: status.status || null,
              revision_cycle: status.revision_cycle ?? 0,
              revision_requested_at: status.revision_requested_at || null,
              revision_deadline: status.revision_deadline || null,
              revision_deadline_label: status.revision_deadline_label || null,
              review_feedback: status.review_feedback || null,
              resubmission_available: status.resubmission_available === true,
              resubmission_blocked_reason: status.resubmission_blocked_reason || null,
              resubmission_expires_in_ms: status.resubmission_expires_in_ms ?? 0,
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

  /**
   * Start the task. The SERVER creates (or reuses) the session and owns
   * `started_at`; the client only renders the state it returns. Re-clicking
   * Start, refreshing or opening a second tab keeps the ORIGINAL start time —
   * the endpoint is idempotent.
   */
  const startTask = async (id) => {
    if (busy) return;
    try {
      setBusy(id);
      setMessage("");
      const { data } = await axios.post(`${API_URL}/api/tasks/${id}/start`, {}, { headers: auth() });
      // Show the started state immediately, before the refetch lands.
      setTasks((prev) => prev.map((t) => (String(t.id) === String(id) ? { ...t, student_status: t.student_status || "in_progress" } : t)));
      setMessage("Task started.");
      await load();
    } catch (err) {
      setError(err.response?.data?.error?.message || err.response?.data?.message || "Unable to start task.");
    } finally {
      setBusy(null);
    }
  };

  /**
   * Submit a FIRST version (POST /submit) or a corrected version
   * (POST /resubmit).
   *
   * The two are deliberately different endpoints on the server: /resubmit is
   * the only one that checks the 24-hour revision window against the server
   * clock, so a version can never be pushed after the deadline by calling the
   * wrong route.
   */
  const sendSubmission = async (task, endpoint) => {
    if (submittingRef.current) return;
    const files = selectedFiles[task.id] || [];
    const comment = String(comments[task.id] || "").trim();
    
    // Validate endpoint choice based on submission status
    const hasExistingSubmission = task.has_submission === true;
    const needsRevision = task.student_status === "revision_required";
    const hasOpenRevisionWindow = task.resubmission_available === true;
    
    // Correct endpoint routing:
    // - Use 'submit' for first-time submissions (no prior submission)
    // - Use 'resubmit' only when there's a prior submission AND an open revision window
    let actualEndpoint = endpoint;
    if (endpoint === "resubmit" && !hasExistingSubmission) {
      // Prevent calling resubmit when there's no prior submission
      actualEndpoint = "submit";
    } else if (endpoint === "resubmit" && !hasOpenRevisionWindow) {
      // Resubmit requested but no open window
      setError("No open revision window. Cannot resubmit at this time.");
      return;
    }
    
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
      // Only the files and the comment are sent. Status, feedback and
      // deadlines are never accepted from a student (the server strips them
      // too), so they cannot be forged from here.
      const response = await axios.post(`${API_URL}/api/tasks/${task.id}/${actualEndpoint}`, form, { headers: auth() });
      setSelectedFiles((value) => ({ ...value, [task.id]: [] }));
      setComments((value) => ({ ...value, [task.id]: "" }));
      // Show professional success popup with actual submission details
      const submissionData = response.data?.data || response.data || {};
      const isResubmission = actualEndpoint === "resubmit";
      setSubmitSuccess({
        taskTitle: task.title,
        submissionCode: submissionData.submissionCode,
        version: submissionData.version,
        submittedAt: submissionData.submittedAt,
        status: isResubmission ? "Resubmitted" : "Submitted",
        message: isResubmission ? "Task resubmitted successfully!" : "Task submitted successfully!"
      });
      setError("");
      await load();
    } catch (err) {
      const errorCode = err.response?.data?.error?.code || err.response?.data?.code;
      const errorMessage = err.response?.data?.error?.message || err.response?.data?.message;
      
      // Provide user-friendly error messages
      let displayMessage = errorMessage || "Unable to submit the task.";
      
      if (errorCode === "NO_PRIOR_SUBMISSION") {
        displayMessage = "You haven't submitted this task yet. Please use the Submit button instead of Resubmit.";
      } else if (errorCode === "ALREADY_SUBMITTED") {
        displayMessage = "You have already submitted this task. If you need to make changes, wait for a revision request.";
      } else if (errorCode === "RESUBMISSION_EXPIRED") {
        displayMessage = "The 24-hour resubmission window has expired. Please contact your instructor for a new revision.";
      } else if (errorCode === "NO_OPEN_REVISION") {
        displayMessage = "No revision was requested for this submission. You cannot resubmit at this time.";
      } else if (errorCode === "DEADLINE_PASSED") {
        displayMessage = "The task deadline has passed. Please contact your instructor if you need to submit late work.";
      }
      
      setError(displayMessage);
      console.error("Submission error:", { code: errorCode, message: errorMessage, response: err.response?.data });
      
      // The window may have closed while the form was open: reload so the
      // button state matches the server.
      if (err.response?.status === 409) await load();
    } finally {
      setBusy(null);
      submittingRef.current = false;
    }
  };

  const submitTask = (task) => sendSubmission(task, "submit");
  const resubmitTask = (task) => sendSubmission(task, "resubmit");

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

  /**
   * DISPLAY-ONLY countdown for an open revision window.
   * It renders the deadline the server already stored; it never grants or
   * refuses permission. The Resubmit button's enabled state comes from
   * `resubmission_available`, which the backend computed on its own clock.
   */
  const countdown = (task) => {
    const remaining = remainingTime(task.revision_deadline, now);
    if (!remaining) return "";
    return remaining.overdue ? remaining.label : `· ${remaining.label}`;
  };

  // Tick once a minute so the countdown stays honest while the page is open.
  useEffect(() => {
    const id = setInterval(() => setNow((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, []);

  if (loading && !tasks.length) return <div className="portal-loading"><div className="loader-dot" /><h2>Loading your tasks</h2><p>Syncing your latest assignments.</p></div>;

  return (
    <Fragment>
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
            // Canonical status from the backend (pending | in_progress |
            // submitted | approved | revision_required | resubmission_expired).
            const canonical = task.student_status || null;

            const needsRevision = canonical === "revision_required";
            const windowExpired = canonical === "resubmission_expired";
            // Resubmission is offered only while the SERVER says the window is
            // open. The countdown below is display-only.
            const canResubmit = needsRevision && task.resubmission_available === true;
            const startAt = task.start_at || (task.start_date ? `${task.start_date}T${task.start_time || "00:00"}:00` : null);
            const endAt = task.due_at || (task.due_date ? `${task.due_date}T${task.due_time || "23:59"}:00` : null);
            const nowDate = new Date();
            const beforeStart = !!startAt && nowDate < new Date(startAt);
            const expired = !!endAt && nowDate > new Date(endAt);
            const isClosed = ["Approved", "Cancelled", "Archived"].includes(studentStatus) || ["Cancelled", "Archived"].includes(workflow) || expired;
            const hasStarted = canonical === "in_progress" || canonical === "submitted" || canonical === "approved" || canonical === "revision_required";
            // Show submit form only when: task window is open, student has started, no existing submission, task not closed
            const canSubmitInline = !isClosed && !hasStudentSubmission && hasStarted && !beforeStart && !expired;
            

            // Show "awaiting review" only if this student actually submitted
            const showAwaitingReview = hasStudentSubmission && ["Submitted", "Under Review", "Resubmitted"].includes(studentStatus);
            
            // Check if task is overdue
            const isOverdue = task.due_date && formatISTDateTime(task.due_date) !== "—" && new Date(task.due_date).toISOString() < new Date().toISOString() && workflow !== "Approved";
            
            // Format dates for display
            const formatDate = (dateStr) => {
              if (!dateStr) return null;
              // Use shared IST formatter for consistent timezone
              return formatISTDate(dateStr);
            };
            
            return (
              <article className={`task-card reveal-card ${task.status} ${isOverdue ? 'overdue' : ''}`} key={task.id}>
                <div className="task-card-top">
                  <div>
                    <span className="task-label">{task.task_code || "TASK"}</span>
                    <h2><Link className="task-title-link" to={`/student/tasks/${task.id}`}>{task.title}</Link></h2>
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
                  {!hasStarted && !hasStudentSubmission && !isClosed && (
                    beforeStart ? (
                      <div className="completed-label">Starts on {startAt ? formatWorkspaceDateTime(startAt) : "scheduled time"}</div>
                    ) : expired ? (
                      <div className="completed-label">The task deadline has passed.</div>
                    ) : (
                      <button className="action-progress" disabled={busy === task.id} onClick={() => startTask(task.id)}>{busy === task.id ? "Starting…" : "Start"}</button>
                    )
                  )}
                  {hasStarted && !hasStudentSubmission && (
                    <div className="completed-label">
                      <TechinsIcon name="check" size={16} variant="light" ariaHidden /> Started
                    </div>
                  )}
                  {showAwaitingReview ? (
                    <div className="completed-label">
                      <TechinsIcon name="check" size={16} variant="light" ariaHidden /> Task Submitted
                      {task.latest_submission?.submitted_at ? ` · ${formatWorkspaceDateTime(task.latest_submission.submitted_at)}` : ""}
                    </div>
                  ) : null}
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
                {/* ── Revision Required section ───────────────────────────────────────
                 * Feedback is shown prominently, the deadline is the exact one
                 * stored by the server, and the countdown is display-only.
                 * Resubmit is enabled only while the server says the window is
                 * open; after that the card says the window expired and the
                 * student has to ask for a new revision.
                 */}
                {(needsRevision || windowExpired) && (
                  <div className={`feedback-box revision-box ${windowExpired ? "revision-box-expired" : ""}`}>
                    <div className="revision-box-head">
                      <strong>
                        <TechinsIcon name={windowExpired ? "alert" : "history"} size={14} variant="light" ariaHidden />
                        {windowExpired ? "Resubmission Window Expired" : "Revision Required"}
                      </strong>
                      {task.revision_cycle > 0 && <span className="revision-cycle">Cycle {task.revision_cycle}</span>}
                    </div>

                    <p className="revision-feedback">{task.review_feedback || "Review the admin feedback and submit a corrected version."}</p>

                    {task.revision_deadline && (
                      <p className="revision-deadline">
                        {windowExpired ? "The 24-hour window closed on" : "Resubmit within 24 hours, by"}{" "}
                        <strong>{task.revision_deadline_label || formatDateTime(task.revision_deadline)}</strong>
                        {!windowExpired && <span className="revision-countdown" aria-live="polite">{countdown(task)}</span>}
                      </p>
                    )}

                    {windowExpired && (
                      <p className="revision-note">
                        This task cannot be resubmitted. Ask your administrator to request a new revision, which
                        opens a fresh 24-hour window.
                      </p>
                    )}
                  </div>
                )}

                {canSubmitInline && <div className="upload-box">
                  <div><strong>Submit task work</strong><small>PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, ZIP, PNG, JPG · max 4 MB each</small></div>
                  <textarea value={comments[task.id] || ""} onChange={(e) => setComments((value) => ({ ...value, [task.id]: e.target.value }))} placeholder="Submission comment / outcome (optional if files are selected)" />
                  <label className="upload-button">{selectedFiles[task.id]?.length ? `${selectedFiles[task.id].length} file(s) selected` : "Choose files"}<input type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip,.png,.jpg,.jpeg" onChange={(e) => setSelectedFiles((value) => ({ ...value, [task.id]: Array.from(e.target.files || []) }))} /></label>
                  <button className="gold-btn" disabled={busy === task.id} onClick={() => submitTask(task)}>{busy === task.id ? "Submitting…" : "Submit for Review"}</button>
                </div>}

                {canResubmit && <div className="upload-box revision-upload">
                  <div>
                    <strong>Submit your corrected version</strong>
                    <small>Your previous submission and every older version are kept. PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, ZIP, PNG, JPG · max 4 MB each</small>
                  </div>
                  <textarea
                    value={comments[task.id] || ""}
                    onChange={(e) => setComments((value) => ({ ...value, [task.id]: e.target.value }))}
                    placeholder="Describe what you changed in response to the feedback…"
                  />
                  <label className="upload-button">{selectedFiles[task.id]?.length ? `${selectedFiles[task.id].length} file(s) selected` : "Choose corrected file"}<input type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip,.png,.jpg,.jpeg" onChange={(e) => setSelectedFiles((value) => ({ ...value, [task.id]: Array.from(e.target.files || []) }))} /></label>
                  <button className="gold-btn" disabled={busy === task.id} onClick={() => resubmitTask(task)}>
                    {busy === task.id ? "Resubmitting…" : "Resubmit within the window"}
                  </button>
                </div>}

                {/* Feedback for a task that has no open revision cycle. */}
                {task.feedback && !needsRevision && !windowExpired && <div className="feedback-box"><strong>Feedback</strong><p>{task.feedback}</p></div>}
              </article>
            );
          }) : <div className="empty-state">No tasks assigned yet.</div>}
        </div>
      </div>
    </div>

      {submitSuccess && (
        <div className="submit-success-overlay" onClick={() => setSubmitSuccess(null)}>
          <div className="submit-success-popup" onClick={(e) => e.stopPropagation()}>
            <div className="submit-success-icon">
              <TechinsIcon name="check" size={40} variant="light" />
            </div>
            <h2>{submitSuccess.message || "Task submitted successfully!"}</h2>
            <p>Your work has been saved and will be reviewed.</p>
            <div className="submit-success-details">
              <div><strong>Task:</strong> {submitSuccess.taskTitle}</div>
              <div><strong>Status:</strong> {submitSuccess.status}</div>
              <div><strong>Submission Code:</strong> {submitSuccess.submissionCode}</div>
              <div><strong>Version:</strong> v{submitSuccess.version}</div>
              <div><strong>Submitted At:</strong> {new Date(submitSuccess.submittedAt).toLocaleString()}</div>
            </div>
            <button className="gold-btn" onClick={() => setSubmitSuccess(null)}>
              Done
            </button>
          </div>
        </div>
      )}
  </Fragment>
  );
}
