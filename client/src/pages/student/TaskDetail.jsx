import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import axios from "axios";
import TechinsIcon from "../../components/TechinsIcon";
import { formatWorkspaceDateTime, formatDuration } from "../../utils/dateHelper";
import { remainingTime } from "../../utils/api";
import useLiveElapsed from "../../hooks/useLiveElapsed";
import "./MyTasks.css";
import "./TaskDetail.css";

/**
 * Student task detail page — /student/tasks/:taskId.
 *
 * Every value is read from the API for THIS student and THIS task; nothing is
 * derived on the client that the server has not already decided:
 *   - GET /api/tasks/my                  → the task's own fields
 *   - GET /api/tasks/:id/my-submission-status → the authoritative state
 *   - GET /api/tasks/:id/session         → the server-owned running timer
 *
 * The live timer is rendered from `session.started_at` + the server clock, so
 * refresh, Back/Forward, navigation and a skewed client clock all show the
 * same value. Submit is disabled for this student as soon as the server reports
 * a submission, and a duplicate direct API call is rejected with 409.
 */

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

const ALLOWED_EXT = new Set([".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".zip", ".png", ".jpg", ".jpeg"]);
const MAX_FILES = 5;
const MAX_BYTES = 4 * 1024 * 1024;

function formatBytes(n) {
  if (n === null || n === undefined) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function downloadOwnFile(file) {
  const res = await fetch(`${API_URL}${file.download_url}`, { headers: auth() });
  if (!res.ok) throw new Error("Unable to download file");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name || "submission-file";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function TaskDetail() {
  const { taskId } = useParams();

  const [task, setTask] = useState(null);
  const [status, setStatus] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); // { code, message }
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState("");
  const [files, setFiles] = useState([]);
  const [comment, setComment] = useState("");
  const [tick, setTick] = useState(0);

  const submittingRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The list endpoint already carries the per-student state; it is also the
      // ownership check (a task the student is not assigned to is not in it).
      const { data: mine } = await axios.get(`${API_URL}/api/tasks/my`, { headers: auth() });
      const found = (mine?.tasks || []).find(t => String(t.id) === String(taskId));
      if (!found) {
        setTask(null);
        setBlocked(true);
        setError({ code: "NOT_ASSIGNED", message: "This task is not assigned to you, or it no longer exists." });
        return;
      }
      setTask(found);
      setSession(found.session || null);

      // Authoritative status (also enforces ownership server-side).
      const { data: st } = await axios.get(`${API_URL}/api/tasks/${taskId}/my-submission-status`, { headers: auth() });
      setStatus(st?.data || st || null);

      // Fresh session snapshot for the live timer.
      try {
        const { data: se } = await axios.get(`${API_URL}/api/tasks/${taskId}/session`, { headers: auth() });
        setSession(se?.data || se || null);
      } catch { /* no session yet — timer simply not shown */ }

      setBlocked(false);
      setError(null);
    } catch (err) {
      const httpStatus = err.response?.status;
      const code = err.response?.data?.error?.code || err.response?.data?.code || `HTTP_${httpStatus}`;
      if (httpStatus === 403 || httpStatus === 404) {
        setBlocked(true);
        setError({ code, message: err.response?.data?.error?.message || err.response?.data?.message || "This task is not available to you." });
      } else {
        setError({ code, message: err.response?.data?.error?.message || err.response?.data?.message || "Unable to load this task." });
      }
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  // Refetch on focus so an edited deadline / instructions appears immediately.
  useEffect(() => {
    const onFocus = () => { if (!document.hidden) load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // Repaint once a second for the revision countdown (the timer has its own).
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const canonical = status?.status || null;
  const needsRevision = canonical === "revision_required";
  const windowExpired = canonical === "resubmission_expired";
  const hasSubmission = status?.has_submission === true;
  const approved = canonical === "approved" || task?.workflow_status === "Approved";
  const canResubmit = needsRevision && status?.resubmission_available === true;

  const startAt = task?.start_at || (task?.start_date ? `${task.start_date}T${task.start_time || "00:00"}:00` : null);
  const endAt = task?.due_at || (task?.due_date ? `${task.due_date}T${task.due_time || "23:59"}:00` : null);
  const beforeStart = !!startAt && new Date() < new Date(startAt);
  const deadlinePassed = !!endAt && new Date() > new Date(endAt);
  const closed = approved || ["Cancelled", "Archived"].includes(task?.workflow_status) || deadlinePassed;

  const running = session?.running === true && canonical === "in_progress";
  const elapsed = useLiveElapsed(session?.started_at || null, session?.server_now || null, running);

  const countdown = useMemo(() => {
    void tick;
    if (!status?.revision_deadline) return null;
    return remainingTime(status.revision_deadline, Date.now());
  }, [status?.revision_deadline, tick]);

  const validate = () => {
    if (!files.length && !comment.trim()) return "Add at least one file or a submission comment before submitting.";
    if (files.length > MAX_FILES) return `Select at most ${MAX_FILES} files per submission.`;
    for (const f of files) {
      const ext = (f.name.match(/\.[^.]+$/) || [""])[0].toLowerCase();
      if (!ALLOWED_EXT.has(ext)) return `Unsupported file type: ${f.name}.`;
      if (f.size > MAX_BYTES) return `File too large: ${f.name} (max 4 MB each).`;
    }
    return null;
  };

  const send = async (endpoint) => {
    if (submittingRef.current) return;
    const problem = validate();
    if (problem) { setError({ code: "VALIDATION", message: problem }); return; }
    try {
      setBusy(endpoint);
      submittingRef.current = true;
      const form = new FormData();
      files.forEach((file) => form.append("files", file));
      if (comment.trim()) form.append("comment", comment.trim());
      await axios.post(`${API_URL}/api/tasks/${taskId}/${endpoint}`, form, { headers: auth() });
      setFiles([]);
      setComment("");
      setNotice(endpoint === "resubmit" ? "Corrected version submitted." : "Task submitted.");
      setError(null);
      await load();
    } catch (err) {
      setError({ code: err.response?.data?.error?.code || "SUBMIT_FAILED", message: err.response?.data?.error?.message || err.response?.data?.message || "Unable to submit the task." });
      await load();
    } finally {
      setBusy(null);
      submittingRef.current = false;
    }
  };

  const start = async () => {
    try {
      setBusy("start");
      setError(null);
      await axios.post(`${API_URL}/api/tasks/${taskId}/start`, {}, { headers: auth() });
      setNotice("Task started.");
      await load();
    } catch (err) {
      setError({ code: err.response?.data?.error?.code || "START_FAILED", message: err.response?.data?.error?.message || err.response?.data?.message || "Unable to start the task." });
    } finally {
      setBusy(null);
    }
  };

  if (loading && !task && !blocked) {
    return <div className="portal-loading"><div className="loader-dot" /><h2>Loading task</h2><p>Fetching the latest state from the server.</p></div>;
  }

  if (blocked) {
    return (
      <div className="task-detail-page page-enter">
        <div className="td-blocked" role="alert">
          <TechinsIcon name="alert" size={26} variant="light" ariaHidden />
          <h2>Task not available</h2>
          <p>{error?.message || "This task is not assigned to you, or it no longer exists."}</p>
          <Link className="td-back-btn" to="/student/tasks">Back to My Tasks</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="task-detail-page page-enter">
      <div className="td-head">
        <Link className="td-back" to="/student/tasks">← Back to My Tasks</Link>
        <div className="td-head-row">
          <div>
            <span className="task-label">{task?.task_code || "TASK"}</span>
            <h1>{task?.title || "Task"}</h1>
          </div>
          <span className={`status ${task?.status || "pending"}`}>{task?.workflow_status || "Assigned"}</span>
        </div>
      </div>

      {error && !blocked && <div className="task-alert" role="alert">{error.message}</div>}
      {notice && <div className="info-msg" role="status">{notice}</div>}

      <div className="td-meta-grid">
        <div><span>Priority</span><strong className={`priority ${task?.priority}`}>{task?.priority || "medium"}</strong></div>
        {task?.domain && <div><span>Domain</span><strong style={{ textTransform: "capitalize" }}>{task.domain}</strong></div>}
        <div><span>Start</span><strong>{startAt ? formatWorkspaceDateTime(startAt) : "No start date"}</strong></div>
        <div><span>Deadline</span><strong>{endAt ? formatWorkspaceDateTime(endAt) : "No deadline"}</strong></div>
        <div><span>Assigned by</span><strong>{task?.assigned_by_name || "Management"}</strong></div>
        <div><span>Versions</span><strong>{task?.latest_version || 0}</strong></div>
      </div>

      {task?.description && <section className="td-section"><h3>Description</h3><p>{task.description}</p></section>}
      {task?.how_to_do && <section className="td-section"><h3>Instructions</h3><p>{task.how_to_do}</p></section>}
      {task?.expected_output && <section className="td-section"><h3>Expected Output</h3><p>{task.expected_output}</p></section>}
      {task?.submission_requirements && <section className="td-section"><h3>Submission Requirements</h3><p>{task.submission_requirements}</p></section>}

      {/* Live timer — server-owned start time, repainted once a second. */}
      {session?.started_at && (
        <section className="td-section td-timer">
          <h3>{running ? "Time on task" : "Time recorded"}</h3>
          <strong className="td-timer-value">{formatDuration(running ? elapsed : (session.duration_seconds ?? elapsed)) || "0 seconds"}</strong>
          <small>
            Started {formatWorkspaceDateTime(session.started_at)}
            {session.ended_at ? ` · stopped ${formatWorkspaceDateTime(session.ended_at)}` : " · running"}
          </small>
        </section>
      )}

      {/* Revision section: feedback + the server's exact deadline + countdown. */}
      {(needsRevision || windowExpired) && (
        <section className={`feedback-box revision-box ${windowExpired ? "revision-box-expired" : ""}`}>
          <div className="revision-box-head">
            <strong>
              <TechinsIcon name={windowExpired ? "alert" : "history"} size={14} variant="light" ariaHidden />
              {windowExpired ? "Resubmission Window Expired" : "Revision Required"}
            </strong>
            {status?.revision_cycle > 0 && <span className="revision-cycle">Cycle {status.revision_cycle}</span>}
          </div>
          <p className="revision-feedback">{status?.review_feedback || "Review the reviewer feedback and submit a corrected version."}</p>
          {status?.revision_deadline && (
            <p className="revision-deadline">
              {windowExpired ? "The 24-hour window closed on" : "Resubmit within 24 hours, by"}{" "}
              <strong>{status.revision_deadline_label || formatWorkspaceDateTime(status.revision_deadline)}</strong>
              {!windowExpired && countdown && <span className="revision-countdown" aria-live="polite">{countdown.overdue ? countdown.label : `· ${countdown.label}`}</span>}
            </p>
          )}
        </section>
      )}

      {approved && (
        <section className="feedback-box">
          <strong><TechinsIcon name="check" size={15} variant="light" ariaHidden /> Task approved</strong>
          {status?.review_feedback && <p>{status.review_feedback}</p>}
        </section>
      )}

      {/* Submitted state: single source of truth, Submit stays disabled. */}
      {hasSubmission && !needsRevision && !windowExpired && !approved && (
        <section className="td-submitted">
          <strong><TechinsIcon name="check" size={16} variant="light" ariaHidden /> Task Submitted</strong>
          <small>Submitted {formatWorkspaceDateTime(status?.latest_submission?.submitted_at)} · version v{status?.latest_submission?.version || 1}</small>
          <p>Your work is with the reviewer. You will be notified when it is reviewed.</p>
        </section>
      )}

      {/* Actions per state. */}
      <div className="td-actions">
        {!hasSubmission && !closed && !beforeStart && !["in_progress"].includes(canonical) && (
          <button className="action-progress" disabled={busy === "start"} onClick={start}>
            {busy === "start" ? "Starting…" : "Start Task"}
          </button>
        )}
        {beforeStart && !hasSubmission && <div className="completed-label">Starts on {startAt ? formatWorkspaceDateTime(startAt) : "the scheduled time"}</div>}
        {deadlinePassed && !hasSubmission && !uploadAllowed(canonical, hasSubmission) && <div className="completed-label">The task deadline has passed.</div>}
        {["Cancelled", "Archived"].includes(task?.workflow_status) && <div className="completed-label">This task is {String(task.workflow_status).toLowerCase()}.</div>}
      </div>

      {/* Upload form: first submission when in progress, resubmission inside the window. */}
      {!hasSubmission && canonical === "in_progress" && !closed && (
        <SubmitForm
          title="Submit task work"
          hint="PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, ZIP, PNG, JPG · max 4 MB each"
          comment={comment}
          setComment={setComment}
          files={files}
          setFiles={setFiles}
          busy={busy === "submit"}
          label={busy === "submit" ? "Submitting…" : "Submit for Review"}
          onSubmit={() => send("submit")}
        />
      )}

      {canResubmit && (
        <SubmitForm
          revision
          title="Submit your corrected version"
          hint="Your previous submission and every older version are kept · max 4 MB each"
          comment={comment}
          setComment={setComment}
          files={files}
          setFiles={setFiles}
          busy={busy === "resubmit"}
          label={busy === "resubmit" ? "Resubmitting…" : "Resubmit within the window"}
          onSubmit={() => send("resubmit")}
        />
      )}

      {/* Submission history. */}
      <SubmissionHistory taskId={taskId} />

      <div className="td-foot">
        <Link className="td-back-btn" to="/student/tasks">Back to My Tasks</Link>
      </div>
    </div>
  );
}

function uploadAllowed(canonical, hasSubmission) {
  return !hasSubmission && canonical === "in_progress";
}

function SubmitForm({ title, hint, comment, setComment, files, setFiles, busy, label, onSubmit, revision }) {
  return (
    <section className={`upload-box ${revision ? "revision-upload" : ""}`}>
      <div><strong>{title}</strong><small>{hint}</small></div>
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={revision ? "Describe what you changed in response to the feedback…" : "Submission comment / outcome (optional if files are selected)"} />
      <label className="upload-button">
        {files.length ? `${files.length} file(s) selected` : (revision ? "Choose corrected file" : "Choose files")}
        <input type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip,.png,.jpg,.jpeg" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
      </label>
      <button className="gold-btn" disabled={busy} onClick={onSubmit}>{label}</button>
    </section>
  );
}

function SubmissionHistory({ taskId }) {
  const [versions, setVersions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await axios.get(`${API_URL}/api/tasks/${taskId}`, { headers: auth() });
      const rows = (data.submissions || []).slice().sort((a, b) => (b.version || 0) - (a.version || 0));
      setVersions(rows);
    } catch (err) {
      setError(err.response?.data?.message || "Unable to load your submission history.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="td-section td-history">
      <div className="td-history-head">
        <h3>My submissions</h3>
        <button className="action-progress" onClick={load} disabled={loading}>{loading ? "Loading…" : versions ? "Refresh" : "Show versions"}</button>
      </div>
      {error && <div className="task-alert" role="alert">{error}</div>}
      {versions && versions.length === 0 && <p>No submissions recorded yet.</p>}
      {(versions || []).map((v) => (
        <div className="submission-history-row" key={v.id || v.version}>
          <div>
            <strong>Version {v.version} · {v.status}</strong>
            <small>{formatWorkspaceDateTime(v.submitted_at)} · {v.submission_code || "—"}</small>
            {v.duration_seconds !== null && v.duration_seconds !== undefined && (
              <small>Time on task: {formatDuration(v.duration_seconds)}</small>
            )}
            {v.comment && <p>{v.comment}</p>}
            {v.review_comments && <p className="submission-history-review">Reviewer feedback: {v.review_comments}</p>}
          </div>
          {(v.files || []).length > 0 && (
            <div className="submission-history-files">
              {v.files.map((f) => (
                <button key={f.id} className="action-progress" onClick={() => downloadOwnFile(f).catch(() => setError("Unable to download file."))}>
                  <TechinsIcon name="download" size={13} variant="light" ariaHidden />
                  {f.name}{f.size ? ` (${formatBytes(f.size)})` : ""}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
