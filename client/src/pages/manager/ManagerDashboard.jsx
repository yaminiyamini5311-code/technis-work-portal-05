import { useEffect, useCallback, useState, useRef } from "react";
import useModalBehavior from "../../components/useModalBehavior";
import { StatNumber } from "../../components/useCountUp";
import NewProjectModal from "./NewProjectModal";
import "../../styles/manager-femly.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

async function downloadSubmissionFile(file, onError) {
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

const PROGRAMS = [
  { value: "techins 60", label: "Techins 60" },
  { value: "ai ally", label: "AI Ally" },
  { value: "life wise", label: "Life Wise" },
  { value: "foundation x", label: "Foundation X" },
  { value: "concept to carrier", label: "Concept to Carrier" },
  { value: "unlock", label: "Unlock" }
];

const DOMAINS = [
  { value: "edutins", label: "EduTins" },
  { value: "resins", label: "ResIns" },
  { value: "innovins", label: "InnoVins" },
  { value: "systins", label: "SysTins" },
  { value: "program", label: "Program" }
];

// DEMO DATA — seeded only when the API returns nothing.
const DEMO_PROJECTS = [
  { id: "p1", title: "EduTins Portal Redesign", domain: "edutins", progress: 72, status: "In progress", updated: "2 hrs ago" },
  { id: "p2", title: "AI Ally Onboarding", domain: "ai ally", progress: 45, status: "Pending", updated: "1 day ago" },
  { id: "p3", title: "Life Wise Reporting", domain: "life wise", progress: 90, status: "Completed", updated: "3 days ago" },
];

const DEMO_TEAM = [
  { name: "Aria Patel", role: "Engineering", load: 68, status: "Active" },
  { name: "Jordan Lee", role: "Design", load: 42, status: "Active" },
  { name: "Sam Rivera", role: "Marketing", load: 81, status: "Busy" },
  { name: "Tina Okafor", role: "Management", load: 55, status: "Active" },
];

function Gauge({ percent, label }) {
  const pathRef = useRef(null);
  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    const length = path.getTotalLength();
    path.style.strokeDasharray = length;
    path.style.strokeDashoffset = length;
    requestAnimationFrame(() => {
      path.style.transition = "stroke-dashoffset 1000ms ease";
      path.style.strokeDashoffset = length * (1 - percent / 100);
    });
  }, [percent]);
  return (
    <div className="femly-card gauge-card" style={{ padding: 10 }}>
      <div className="gauge-head">
        <span className="section-kicker">TEAM VELOCITY</span>
        <strong className="gauge-value">{percent}%</strong>
      </div>
      <svg viewBox="0 0 100 50" className="gauge-svg" aria-label={label} role="img">
        <path d="M15 45 A 70 70 0 0 1 85 45" fill="none" stroke="var(--line)" strokeWidth="9" strokeLinecap="round" />
        <path
          ref={pathRef}
          d="M15 45 A 70 70 0 0 1 85 45"
          fill="none"
          stroke="var(--a)"
          strokeWidth="9"
          strokeLinecap="round"
          className="gauge-progress"
        />
      </svg>
      <p style={{ marginTop: 8, fontSize: 12, color: "var(--mut)", textAlign: "center" }}>{label}</p>
    </div>
  );
}

function TimerCard() {
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const iv = useRef(null);

  const format = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  const toggle = () => {
    if (running) {
      setRunning(false);
      if (iv.current) clearInterval(iv.current);
      setZoomed(false);
    } else {
      setRunning(true);
      setZoomed(true);
      iv.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    }
  };
  const stop = () => {
    setRunning(false);
    setSeconds(0);
    setZoomed(false);
    if (iv.current) clearInterval(iv.current);
  };
  useEffect(() => () => { if (iv.current) clearInterval(iv.current); }, []);

  return (
    <div className="femly-card timer-card" style={{ transform: zoomed ? "scale(1.04)" : "none", transition: "transform .3s ease" }}>
      <div className="timer-head">
        <span className="section-kicker">TIME TRACKER</span>
        <button className="femly-btn femly-btn--secondary" onClick={toggle} title={running ? "Pause" : "Play"}>
          {running ? "⏸" : "▶"}
        </button>
      </div>
      <div className="timer-value" style={{ fontVariantNumeric: "tabular-nums" }}>{format(seconds)}</div>
      <div className="timer-actions">
        <button className="femly-btn femly-btn--danger" onClick={stop} title="Stop">Stop</button>
      </div>
    </div>
  );
}

export default function ManagerDashboard() {
  const [tab, setTab] = useState("overview");
  const [stats, setStats] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [students, setStudents] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState(null);
  const [subList, setSubList] = useState([]);
  const [review, setReview] = useState({ decision: "revision", comment: "" });
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const toastRef = useRef(null);

  // Manager-only project state (localStorage persisted, demo-seeded).
  const [projects, setProjects] = useState(() => {
    try { const raw = localStorage.getItem("femly-projects"); if (raw) return JSON.parse(raw); } catch {}
    return DEMO_PROJECTS;
  });
  useEffect(() => {
    try { localStorage.setItem("femly-projects", JSON.stringify(projects)); } catch {}
  }, [projects]);

  const closeReview = useCallback(() => setSelected(null), []);
  const reviewModalRef = useModalBehavior(!!selected, closeReview);

  // Task form state
  const [form, setForm] = useState({
    title: "", description: "", priority: "medium",
    start_date: "", start_time: "", due_date: "", due_time: "", day_number: "", domain: "edutins",
    how_to_do: "", expected_output: "", submission_requirements: ""
  });
  const [assignMode, setAssignMode] = useState("student");
  const [studentId, setStudentId] = useState("");
  const [program, setProgram] = useState("");

  const load = async () => {
    try {
      setError("");
      const h = auth();
      const [statsRes, tasksRes, studentsRes, subsRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/stats`, { headers: h }),
        fetch(`${API_URL}/api/tasks`, { headers: h }),
        fetch(`${API_URL}/api/tasks/students`, { headers: h }),
        fetch(`${API_URL}/api/tasks/submissions`, { headers: h })
      ]);
      const [sd, td, stud, sub] = await Promise.all([
        statsRes.json(), tasksRes.json(), studentsRes.json(), subsRes.json()
      ]);
      if (sd.success) setStats(sd.stats);
      if (td.success) setTasks(td.tasks || []);
      if (stud.success) setStudents(stud.students || []);
      if (sub.success) setSubmissions(sub.submissions || []);
    } catch (e) {
      setError("Unable to load dashboard data. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => () => { if (toastRef.current) clearTimeout(toastRef.current); }, []);

  const createTask = async (e) => {
    e.preventDefault();
    setMessage(""); setError("");
    if (assignMode === "student" && !studentId) return setError("Select a student.");
    if (assignMode === "program" && !program) return setError("Select a program.");
    if (form.start_date && form.due_date && form.start_date > form.due_date) {
      return setError("Starting Date cannot be after Ending Date.");
    }
    const payload = {
      ...form,
      assigned_to: assignMode === "student" ? studentId : null,
      program: assignMode === "program" ? program : null,
    };
    const res = await fetch(`${API_URL}/api/tasks`, {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) return setError(data.message || "Unable to create task");
    setMessage(`Task ${data.taskCode} assigned successfully.`);
    setForm({ title: "", description: "", priority: "medium", start_date: "", start_time: "", due_date: "", due_time: "", day_number: "", domain: "edutins", how_to_do: "", expected_output: "", submission_requirements: "" });
    setStudentId(""); setProgram("");
    load();
  };

  const addProject = (project) => {
    setProjects([project, ...projects]);
    setMessage(`Project "${project.title}" added.`);
    setToast({ id: Date.now(), text: `Project "${project.title}" added.` });
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 2200);
    setNewProjectOpen(false);
  };

  const openReview = async (task) => {
    setSelected(task); setSubList([]); setReview({ decision: "revision", comment: "" });
    const res = await fetch(`${API_URL}/api/tasks/${task.id}/submissions`, { headers: auth() });
    const data = await res.json();
    setSubList(data.submissions || []);
  };

  const submitReview = async (decision = review.decision) => {
    const latest = subList[0];
    if (!latest) return setError("No submission available for review.");
    if (!review.comment.trim()) return setError("Review comment is required.");
    const res = await fetch(`${API_URL}/api/tasks/review`, {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ submission_id: latest.id, decision, comment: review.comment })
    });
    const data = await res.json();
    if (!res.ok) return setError(data.message || "Unable to review submission");
    setMessage(data.message); setSelected(null); load();
  };

  if (loading && !stats) return <div className="portal-loading"><div className="loader-dot"/><h2>Loading Manager workspace</h2><p>Syncing team data...</p></div>;

  const pending = tasks.filter(t => ["Assigned", "Acknowledged"].includes(t.workflow_status)).length;
  const inProg = tasks.filter(t => ["In Progress", "Submitted", "Under Review", "Revision Required", "Resubmitted"].includes(t.workflow_status)).length;
  const approved = tasks.filter(t => t.workflow_status === "Approved").length;
  const total = tasks.length;

  const recentTasks = tasks.slice(0, 6);

  return (
    <div className="admin-simple page-enter">
      <div className="simple-head">
        <span>MANAGEMENT PORTAL</span>
        <h2>Manager Dashboard</h2>
        <p>Monitor team activity, assign tasks, and review student submissions.</p>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <button className="femly-btn femly-btn--primary" onClick={() => setNewProjectOpen(true)}>+ Add Project</button>
        {message && <span style={{ fontSize: 12, color: "var(--a)", fontWeight: 600, background: "var(--a4)", padding: "4px 10px", borderRadius: 999 }}>{message}</span>}
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          ["overview", "Overview"],
          ["tasks", "Tasks & Assignment"],
          ["students", "Students"],
          ["submissions", "Submissions"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`femly-btn ${tab === key ? "femly-btn--primary" : "femly-btn--secondary"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {tab === "overview" && (
        <>
          <div className="admin-stat-grid">
            <div className="admin-stat stat-highlight">
              <small>01</small><span>Students</span><StatNumber value={stats?.students || 0} />
            </div>
            <div className="admin-stat">
              <small>02</small><span>Total Tasks</span><StatNumber value={total} />
            </div>
            <div className="admin-stat">
              <small>03</small><span>Pending</span><StatNumber value={pending} />
            </div>
            <div className="admin-stat">
              <small>04</small><span>In Progress</span><StatNumber value={inProg} />
            </div>
          </div>

          <div className="dashboard-wrap" style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, marginTop: 16 }}>
            <div className="dashboard-main" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="panel" style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
                <Gauge percent={total ? Math.round((approved / total) * 100) : 0} label="Approved share of assigned tasks" />
                <TimerCard />
              </div>

              <div className="panel">
                <div className="panel-head"><div><span className="section-kicker">PROJECTS</span><h3>Active projects</h3></div></div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {projects.map((proj) => (
                    <div key={proj.id} className="project-row" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{proj.title}</span>
                        <span className={`pill ${proj.status.toLowerCase().includes("completed") ? "completed" : proj.status.toLowerCase().includes("progress") ? "in_progress" : "pending"}`}>{proj.status}</span>
                      </div>
                      <div className="bar-pill-track" style={{ height: 8 }}>
                        <div className="bar-pill-inactive" />
                        <div className="bar-pill-active" style={{ width: `${proj.progress}%`, background: "var(--a)", transformOrigin: "bottom", animation: "femly-bar-fill 800ms cubic-bezier(.2,.8,.2,1) forwards" }} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--mut)" }}>
                        <span>{proj.domain}</span>
                        <span>{proj.progress}% · {proj.updated}</span>
                      </div>
                    </div>
                  ))}
                  {projects.length === 0 && <div className="empty-state">No projects yet.</div>}
                </div>
              </div>

              <div className="panel">
                <div className="panel-head"><div><span className="section-kicker">REMINDERS</span><h3>Needs your attention</h3></div></div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    { text: "3 submissions await review", count: pending },
                    { text: "2 tasks due today", count: inProg },
                    { text: "1 team member at full capacity", count: 1 }
                  ].map((r, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
                      <span style={{ fontSize: 12, color: "var(--ink)" }}>{r.text}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--a)", fontVariantNumeric: "tabular-nums" }}>{r.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <aside className="dashboard-side" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Gauge percent={total ? Math.round((inProg / total) * 100) : 0} label="In-progress share" />
              <div className="panel">
                <div className="panel-head"><div><span className="section-kicker">TEAM</span><h3>Team collaboration</h3></div></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {DEMO_TEAM.map((m) => (
                    <div key={m.name} className="team-card" style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                      border: "1px solid var(--line)", borderRadius: 10, background: "var(--card)"
                    }}>
                      <span style={{ fontWeight: 800, color: "var(--ink)" }}>{m.name.charAt(0)}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</div>
                        <div style={{ fontSize: 11, color: "var(--mut)" }}>{m.role}</div>
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--mut)", fontVariantNumeric: "tabular-nums" }}>{m.load}%</div>
                      <span className={`pill ${m.status.toLowerCase() === "busy" ? "pending" : "completed"}`}>{m.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>

          <div className="panel table-wrap" style={{ marginTop: 16 }}>
            <div className="panel-head">
              <div><span className="section-kicker">LIVE TASKS</span><h3>All assignments</h3></div>
              <button onClick={load} className="femly-btn femly-btn--secondary">Refresh</button>
            </div>
            <table>
              <thead><tr><th>Task</th><th>Domain</th><th>Student</th><th>Program</th><th>Status</th><th>Priority</th><th>Due</th><th>Action</th></tr></thead>
              <tbody>
                {recentTasks.map(t => (
                  <tr key={t.id}>
                    <td><strong>{t.task_code || `T-${t.id}`}</strong><small style={{ display: "block" }}>{t.title}</small></td>
                    <td><span className="pill" style={{ background: "var(--a4)", color: "var(--a)", border: "none", fontSize: 10, padding: "3px 8px" }}>{t.domain ? DOMAINS.find(d => d.value === t.domain)?.label || t.domain : "—"}</span></td>
                    <td>{t.student_name}</td>
                    <td>{t.program ? t.program.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") : "—"}</td>
                    <td><span className={`pill ${t.status}`}>{t.workflow_status || t.status}</span></td>
                    <td>{t.priority}</td>
                    <td>{t.due_date || "—"}</td>
                    <td><button className="femly-btn femly-btn--secondary" onClick={() => openReview(t)}>Review</button></td>
                  </tr>
                ))}
                {!recentTasks.length && <tr><td colSpan={8} className="empty-state" style={{ padding: 20 }}>No tasks yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* TASKS TAB */}
      {tab === "tasks" && (
        <>
          <form className="panel form-grid-admin" onSubmit={createTask} autoComplete="off">
            <div className="field">
              <label className="field-label" htmlFor="m-task-title">Task title</label>
              <input id="m-task-title" name="m-task-title" placeholder="Task title" value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })} required autoComplete="off" />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label className="field-label">Assignment Mode</label>
              <div style={{ display: "flex", gap: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" name="assignMode" value="student" checked={assignMode === "student"}
                    onChange={() => { setAssignMode("student"); setProgram(""); }} /> Individual Student
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" name="assignMode" value="program" checked={assignMode === "program"}
                    onChange={() => { setAssignMode("program"); setStudentId(""); }} /> Group / Program
                </label>
              </div>
            </div>

            {assignMode === "student" ? (
              <div className="field">
                <label className="field-label" htmlFor="m-task-student">Select Student</label>
                <select id="m-task-student" name="m-task-student" value={studentId} onChange={e => setStudentId(e.target.value)} required>
                  <option value="">Select student</option>
                  {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            ) : (
              <div className="field">
                <label className="field-label" htmlFor="m-task-program">Select Program / Group</label>
                <select id="m-task-program" name="m-task-program" value={program} onChange={e => setProgram(e.target.value)} required>
                  <option value="">Select program</option>
                  {PROGRAMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            )}

            <div className="field">
              <label className="field-label" htmlFor="m-task-priority">Priority</label>
              <select id="m-task-priority" name="m-task-priority" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                <option>low</option><option>medium</option><option>high</option><option>critical</option>
              </select>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="m-task-domain">Domain <span style={{ color: "var(--a)" }}>*</span></label>
              <select id="m-task-domain" name="m-task-domain" value={form.domain} onChange={e => setForm({ ...form, domain: e.target.value })} required>
                {DOMAINS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="m-task-day">Day (1-60)</label>
              <input id="m-task-day" name="m-task-day" type="number" min="1" max="60" value={form.day_number} onChange={e => setForm({ ...form, day_number: e.target.value })} />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="m-task-start">Starting Date</label>
              <input id="m-task-start" name="m-task-start" type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
              <input id="m-task-start-time" name="m-task-start-time" type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="m-task-due">Ending Date</label>
              <input id="m-task-due" name="m-task-due" type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
              <input id="m-task-due-time" name="m-task-due-time" type="time" value={form.due_time} onChange={e => setForm({ ...form, due_time: e.target.value })} />
            </div>

            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label className="field-label" htmlFor="m-task-desc">Description</label>
              <textarea id="m-task-desc" name="m-task-desc" placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label className="field-label" htmlFor="m-task-how">How to Do</label>
              <textarea id="m-task-how" name="m-task-how" placeholder="How to Do" value={form.how_to_do} onChange={e => setForm({ ...form, how_to_do: e.target.value })} />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label className="field-label" htmlFor="m-task-output">Expected output</label>
              <textarea id="m-task-output" name="m-task-output" placeholder="Expected output" value={form.expected_output} onChange={e => setForm({ ...form, expected_output: e.target.value })} />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label className="field-label" htmlFor="m-task-reqs">Submission requirements</label>
              <textarea id="m-task-reqs" name="m-task-reqs" placeholder="Submission requirements" value={form.submission_requirements} onChange={e => setForm({ ...form, submission_requirements: e.target.value })} />
            </div>

            <button className="femly-btn femly-btn--primary" type="submit">Assign Task</button>
          </form>

          <div className="panel table-wrap" style={{ marginTop: "24px" }}>
            <div className="panel-head">
              <div><span className="section-kicker">LIVE TASKS</span><h3>All assignments</h3></div>
              <button onClick={load} className="femly-btn femly-btn--secondary">Refresh</button>
            </div>
            <table className="table-wrap">
              <thead><tr><th>Task</th><th>Domain</th><th>Student</th><th>Program</th><th>Status</th><th>Priority</th><th>Due</th><th>Action</th></tr></thead>
              <tbody>
                {tasks.map(t => (
                  <tr key={t.id}>
                    <td><strong>{t.task_code || `T-${t.id}`}</strong><small style={{ display: "block" }}>{t.title}</small></td>
                    <td><span className="pill" style={{ background: "var(--a4)", color: "var(--a)", border: "none", fontSize: 10, padding: "3px 8px" }}>{t.domain ? DOMAINS.find(d => d.value === t.domain)?.label || t.domain : "—"}</span></td>
                    <td>{t.student_name}</td>
                    <td>{t.program ? t.program.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") : "—"}</td>
                    <td><span className={`pill ${t.status}`}>{t.workflow_status || t.status}</span></td>
                    <td>{t.priority}</td>
                    <td>{t.due_date || "—"}</td>
                    <td><button className="femly-btn femly-btn--secondary" onClick={() => openReview(t)}>Review</button></td>
                  </tr>
                ))}
                {!tasks.length && <tr><td colSpan={8} className="empty-state" style={{ padding: 20 }}>No tasks yet.</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Review Modal */}
          {selected && (
            <div className={`review-modal review-modal--show`} ref={reviewModalRef}>
              <div className={`panel panel--show`}>
                <div className="panel-head">
                  <div><span className="section-kicker">SUBMISSION REVIEW</span><h3>{selected.task_code || "Task"} · {selected.title}</h3><p>{selected.student_name}</p></div>
                  <button onClick={() => setSelected(null)}>Close</button>
                </div>
                {subList.length ? (
                  <>
                    <div className="submission-manager">
                      <div>
                        <strong>Version {subList[0].version}</strong>
                        <small>{subList[0].submission_code} · {new Date(subList[0].submitted_at).toLocaleString()}</small>
                        <p>{subList[0].comment || "No submission comment."}</p>
                        {(subList[0].files || []).length ? (
                          <div className="quick-actions">
                            {subList[0].files.map(f => (
                              <button key={f.id} onClick={() => downloadSubmissionFile(f, setError)} className="femly-btn femly-btn--secondary">
                                {f.name}{f.size ? ` (${f.size < 1024 ? `${f.size} B` : `${(f.size / 1024).toFixed(1)} KB`})` : ""}
                              </button>
                            ))}
                          </div>
                        ) : <small>No files attached to this version.</small>}
                      </div>
                      <span className="pill completed">{subList[0].status}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "20px" }}>
                      <label htmlFor="m-review-comment" style={{ fontSize: "12px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--mut)" }}>
                        Review comments <span style={{ color: "var(--a)" }}>*</span>
                      </label>
                      <textarea id="m-review-comment" value={review.comment} onChange={e => setReview({ ...review, comment: e.target.value })}
                        placeholder="Review comments / revision reason" required style={{ minHeight: "120px", padding: "12px 14px", fontSize: "14px", width: "100%", boxSizing: "border-box" }} />
                    </div>
                    <div className="quick-actions">
                      <button className="femly-btn femly-btn--secondary" onClick={() => submitReview("revision")}>Request Revision</button>
                      <button className="femly-btn femly-btn--primary" onClick={() => submitReview("approve")}>Approve</button>
                    </div>
                  </>
                ) : <div className="empty-state">No submission versions available for this task.</div>}
              </div>
            </div>
          )}
        </>
      )}

      {/* STUDENTS TAB */}
      {tab === "students" && (
        <div className="panel table-wrap">
          <div className="panel-head">
            <div><span className="section-kicker">STUDENT ROSTER</span><h3>All registered students</h3></div>
            <button onClick={load} className="femly-btn femly-btn--secondary">Refresh</button>
          </div>
          <table className="table-wrap">
            <thead><tr><th>Name</th><th>Email</th><th>Department</th><th>Program</th><th>Joined</th></tr></thead>
            <tbody>
              {students.map(s => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.email}</td>
                  <td>{s.department || "—"}</td>
                  <td>{s.program || "—"}</td>
                  <td>{s.created_at ? new Date(s.created_at).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
              {!students.length && <tr><td colSpan={5} className="empty-state" style={{ padding: 20 }}>No students found.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* SUBMISSIONS TAB */}
      {tab === "submissions" && (
        <div className="panel">
          <div className="panel-head">
            <div><span className="section-kicker">SUBMITTED WORK</span><h3>Student reports & files</h3></div>
            <button onClick={load} className="femly-btn femly-btn--secondary">Refresh</button>
          </div>
          {submissions.length ? submissions.map(item => (
            <div className="submission-manager" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <small>{item.student_name} · {item.file_count || 0} file{item.file_count === 1 ? "" : "s"} · {item.outcome ? "Outcome submitted" : "File submitted"}</small>
                {item.outcome && <p>{item.outcome}</p>}
              </div>
              <span className="pill completed">{item.workflow_status || item.status}</span>
            </div>
          )) : <div className="empty-state">No submitted work yet.</div>}
        </div>
      )}

      {/* New project modal */}
      <NewProjectModal open={newProjectOpen} onClose={() => setNewProjectOpen(false)} onAdd={addProject} />

      {toast && (
        <div className="femly-toast femly-toast--show" role="status" aria-live="polite">
          {toast.text}
        </div>
      )}

    </div>
  );
}
