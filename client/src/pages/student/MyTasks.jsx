import { useEffect, useRef, useState } from "react";
import axios from "axios";
import TechinsIcon from "../../components/TechinsIcon";
import { useScrollReveal } from "../../components/useScrollReveal";
import "./MyTasks.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

const DOMAINS = [
  { value: "edutins", label: "EduTins" },
  { value: "resins", label: "ResIns" },
  { value: "innovins", label: "InnoVins" },
  { value: "systins", label: "SysTins" },
  { value: "program", label: "Program" }
];

const formatDate = (dateStr) => {
  if (!dateStr) return "Not set";
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return "Not set";
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function MyTasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState({});
  const [comments, setComments] = useState({});
  const [domainFilter, setDomainFilter] = useState("");
  const previousApproved = useRef(null);

  // Scroll reveal effect for space theme - sophisticated animation
  useScrollReveal('.reveal-card', { 
    stagger: 110,
    initialScale: 0.85,
    initialOpacity: 0.1,
    initialTranslateY: 50,
    initialBlur: 5
  });

  const load = async () => {
    try {
      setLoading(true);
      const { data } = await axios.get(`${API_URL}/api/tasks/my`, { headers: auth() });
      const next = data.tasks || [];
      const approved = next.filter((task) => task.workflow_status === "Approved" || task.status === "completed").length;
      previousApproved.current = approved;
      setTasks(next);
      setError("");
    } catch (err) {
      setError(err.response?.data?.message || "Unable to load your tasks.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 20000);
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
    const files = selectedFiles[task.id] || [];
    const comment = String(comments[task.id] || "").trim();
    if (!files.length && !comment) {
      setError("Add at least one file or a submission comment before submitting.");
      return;
    }
    try {
      setBusy(task.id);
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
    }
  };

  const completed = tasks.filter((t) => t.workflow_status === "Approved" || t.status === "completed").length;
  const pending = tasks.filter((t) => ["Assigned", "Scheduled", "pending"].includes(t.workflow_status) || t.status === "pending").length;
  const inProgress = tasks.filter((t) => ["In Progress", "Acknowledged", "Revision Required"].includes(t.workflow_status) || t.status === "in_progress").length;
  const review = tasks.filter((t) => ["Submitted", "Under Review", "Resubmitted"].includes(t.workflow_status)).length;
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
                background: 'rgba(255,255,255,0.08)',
                color: '#F5F8FF',
                fontSize: '13px',
                backdropFilter: 'blur(8px)'
              }}
            >
              <option value="">All Domains</option>
              {DOMAINS.map(d => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
            <button className="refresh-button" onClick={load} disabled={loading}>↻ Refresh</button>
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
            const canSubmit = ["In Progress", "Revision Required", "Acknowledged", "Assigned"].includes(workflow);
            
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
                <div className="task-card-top"><div><span className="task-label">{task.task_code || "TASK"}</span><h2>{task.title}</h2><p>{task.description || "No description provided."}</p></div><span className={`status ${task.status} ${isOverdue ? 'overdue-badge' : ''}`}>{isOverdue ? '⚠ Overdue' : workflow}</span></div>
                <div className="task-meta-grid">
                  <div><span>Priority</span><strong className={`priority ${task.priority}`}>{task.priority || "medium"}</strong></div>
                  {task.domain && <div><span>Domain</span><strong style={{ textTransform: 'capitalize' }}>{task.domain}</strong></div>}
                  {task.start_date && <div><span>Start</span><strong>{formatDate(task.start_date)}</strong></div>}
                  <div><span>End</span><strong>{task.due_date ? formatDate(task.due_date) : "No deadline"}</strong></div>
                  <div><span>Assigned by</span><strong>{task.assigned_by_name || "Management"}</strong></div>
                  <div><span>Versions</span><strong>{task.latest_version || 0}</strong></div>
                </div>
                <div className="task-actions">
                  {(workflow === "Assigned" || task.status === "pending") && <button className="action-progress" disabled={busy === task.id} onClick={() => startTask(task.id)}>{busy === task.id ? "Updating…" : "Start Task"}</button>}
                  {workflow === "Under Review" || workflow === "Submitted" || workflow === "Resubmitted" ? <div className="completed-label">Submission received · awaiting review</div> : null}
                  {workflow === "Approved" && <div className="completed-label"><TechinsIcon name="check" size={16} variant="light" /> Task approved and recorded</div>}
                </div>
                {task.workflow_status === "Revision Required" && <div className="feedback-box"><strong>Revision requested</strong><p>{task.feedback || "Review the manager feedback and submit a new version."}</p></div>}
                {canSubmit && <div className="upload-box">
                  <div><strong>{workflow === "Revision Required" ? "Submit revised work" : "Submit task work"}</strong><small>PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, ZIP, PNG, JPG · max 10 MB each</small></div>
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
