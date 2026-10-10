import { useEffect, useMemo, useState } from "react";
import "../admin/AdminDashboard.css";
import "../../styles/admin.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

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

  // Task form state
  const [form, setForm] = useState({
    title: "", description: "", priority: "medium",
    start_date: "", due_date: "", domain: "edutins",
    how_to_do: "", expected_output: "", submission_requirements: ""
  });
  const [assignMode, setAssignMode] = useState("student"); // "student" | "program"
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
    setForm({ title: "", description: "", priority: "medium", start_date: "", due_date: "", domain: "edutins", how_to_do: "", expected_output: "", submission_requirements: "" });
    setStudentId(""); setProgram("");
    load();
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

  return (
    <div className="admin-simple page-enter">
      <div className="simple-head">
        <span>MANAGEMENT PORTAL</span>
        <h2>Manager Dashboard</h2>
        <p>Monitor team activity, assign tasks, and review student submissions.</p>
      </div>

      {/* Tab Navigation */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "24px", flexWrap: "wrap" }}>
        {[["overview","Overview"],["tasks","Tasks & Assignment"],["students","Students"],["submissions","Submissions"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            padding: "8px 18px", borderRadius: "8px", border: "none", cursor: "pointer",
            background: tab === key ? "var(--color-gold, #F5A623)" : "#f3f4f6",
            color: tab === key ? "#fff" : "#333", fontWeight: tab === key ? "700" : "500", fontSize: "13px"
          }}>{label}</button>
        ))}
      </div>

      {error && <div className="error-msg">{error}</div>}
      {message && <div className="success-msg">{message}</div>}

      {/* OVERVIEW TAB */}
      {tab === "overview" && (
        <>
          <div className="admin-stat-grid">
            {[
              ["Students", stats?.students || 0, "01"],
              ["Total Tasks", stats?.tasks || 0, "02"],
              ["Pending", pending, "03"],
              ["In Progress", inProg, "04"],
              ["Approved", approved, "05"],
              ["Today's Activity", stats?.activitiesToday || 0, "06"]
            ].map(([label, value, no]) => (
              <div className="admin-stat" key={label}>
                <small>{no}</small><span>{label}</span><strong>{value}</strong>
              </div>
            ))}
          </div>

          <div className="panel" style={{ marginTop: "24px" }}>
            <div className="panel-head">
              <div><span className="section-kicker">RECENT TASKS</span><h3>Latest assignments</h3></div>
              <button onClick={load}>Refresh</button>
            </div>
            <table>
              <thead><tr><th>Task</th><th>Student</th><th>Status</th><th>Priority</th><th>Due</th><th>Action</th></tr></thead>
              <tbody>
                {tasks.slice(0, 10).map(t => (
                  <tr key={t.id}>
                    <td><strong>{t.task_code || `T-${t.id}`}</strong><small style={{ display: "block" }}>{t.title}</small></td>
                    <td>{t.student_name}</td>
                    <td><span className={`pill ${t.status}`}>{t.workflow_status || t.status}</span></td>
                    <td>{t.priority}</td>
                    <td>{t.due_date || "—"}</td>
                    <td><button onClick={() => { setTab("tasks"); openReview(t); }}>Review</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!tasks.length && <div className="empty-state">No tasks yet.</div>}
          </div>
        </>
      )}

      {/* TASKS TAB */}
      {tab === "tasks" && (
        <>
          <form className="panel form-grid-admin" onSubmit={createTask} autoComplete="off">
            <input id="m-task-title" name="m-task-title" placeholder="Task title" value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })} required autoComplete="off" />

            {/* Assignment Mode Toggle */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "11px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", color: "#5f625f" }}>Assignment Mode</label>
              <div style={{ display: "flex", gap: "8px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                  <input type="radio" name="assignMode" value="student" checked={assignMode === "student"}
                    onChange={() => { setAssignMode("student"); setProgram(""); }} /> Individual Student
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                  <input type="radio" name="assignMode" value="program" checked={assignMode === "program"}
                    onChange={() => { setAssignMode("program"); setStudentId(""); }} /> Group / Program
                </label>
              </div>
            </div>

            {assignMode === "student" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label htmlFor="m-task-student" style={{ fontSize: "11px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", color: "#5f625f" }}>Select Student</label>
                <select id="m-task-student" name="m-task-student" value={studentId} onChange={e => setStudentId(e.target.value)} required>
                  <option value="">Select student</option>
                  {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label htmlFor="m-task-program" style={{ fontSize: "11px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", color: "#5f625f" }}>Select Program / Group</label>
                <select id="m-task-program" name="m-task-program" value={program} onChange={e => setProgram(e.target.value)} required>
                  <option value="">Select program</option>
                  {PROGRAMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            )}

            <select id="m-task-priority" name="m-task-priority" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
              <option>low</option><option>medium</option><option>high</option><option>critical</option>
            </select>

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label htmlFor="m-task-domain" style={{ fontSize: "11px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", color: "#5f625f" }}>Domain <span style={{ color: "#FA9A02" }}>*</span></label>
              <select id="m-task-domain" name="m-task-domain" value={form.domain} onChange={e => setForm({ ...form, domain: e.target.value })} required>
                {DOMAINS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label htmlFor="m-task-start" style={{ fontSize: "11px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", color: "#5f625f" }}>Starting Date</label>
              <input id="m-task-start" name="m-task-start" type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label htmlFor="m-task-due" style={{ fontSize: "11px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", color: "#5f625f" }}>Ending Date</label>
              <input id="m-task-due" name="m-task-due" type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
            </div>

            <textarea id="m-task-desc" name="m-task-desc" placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            <textarea id="m-task-how" name="m-task-how" placeholder="How to Do" value={form.how_to_do} onChange={e => setForm({ ...form, how_to_do: e.target.value })} />
            <textarea id="m-task-output" name="m-task-output" placeholder="Expected output" value={form.expected_output} onChange={e => setForm({ ...form, expected_output: e.target.value })} />
            <textarea id="m-task-reqs" name="m-task-reqs" placeholder="Submission requirements" value={form.submission_requirements} onChange={e => setForm({ ...form, submission_requirements: e.target.value })} />

            <button className="gold-btn" type="submit">Assign Task</button>
          </form>

          <div className="panel table-wrap" style={{ marginTop: "24px" }}>
            <div className="panel-head">
              <div><span className="section-kicker">LIVE TASKS</span><h3>All assignments</h3></div>
              <button onClick={load}>Refresh</button>
            </div>
            <table>
              <thead><tr><th>Task</th><th>Domain</th><th>Student</th><th>Program</th><th>Status</th><th>Priority</th><th>Due</th><th>Action</th></tr></thead>
              <tbody>
                {tasks.map(t => (
                  <tr key={t.id}>
                    <td><strong>{t.task_code || `T-${t.id}`}</strong><small style={{ display: "block" }}>{t.title}</small></td>
                    <td><span style={{ padding: "4px 10px", borderRadius: "20px", background: "#f7f7f7", fontSize: "11px", fontWeight: "700" }}>{t.domain ? DOMAINS.find(d => d.value === t.domain)?.label || t.domain : "—"}</span></td>
                    <td>{t.student_name}</td>
                    <td>{t.program ? t.program.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") : "—"}</td>
                    <td><span className={`pill ${t.status}`}>{t.workflow_status || t.status}</span></td>
                    <td>{t.priority}</td>
                    <td>{t.due_date || "—"}</td>
                    <td><button onClick={() => openReview(t)}>Review</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!tasks.length && <div className="empty-state">No tasks yet.</div>}
          </div>

          {/* Review Modal */}
          {selected && (
            <div className="review-modal">
              <div className="panel">
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
                      </div>
                      <span className="pill completed">{subList[0].status}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "20px" }}>
                      <label htmlFor="m-review-comment" style={{ fontSize: "12px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", color: "#5F625F" }}>
                        Review comments <span style={{ color: "#FA9A02" }}>*</span>
                      </label>
                      <textarea id="m-review-comment" value={review.comment} onChange={e => setReview({ ...review, comment: e.target.value })}
                        placeholder="Review comments / revision reason" required style={{ minHeight: "120px", padding: "12px 14px", fontSize: "14px" }} />
                    </div>
                    <div className="quick-actions">
                      <button onClick={() => submitReview("revision")}>Request Revision</button>
                      <button className="gold-btn" onClick={() => submitReview("approve")}>Approve</button>
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
            <button onClick={load}>Refresh</button>
          </div>
          <table>
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
            </tbody>
          </table>
          {!students.length && <div className="empty-state">No students found.</div>}
        </div>
      )}

      {/* SUBMISSIONS TAB */}
      {tab === "submissions" && (
        <div className="panel">
          <div className="panel-head">
            <div><span className="section-kicker">SUBMITTED WORK</span><h3>Student reports & files</h3></div>
            <button onClick={load}>Refresh</button>
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
    </div>
  );
}
