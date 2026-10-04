import { useEffect, useState } from "react";
import "../../styles/admin.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

export default function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [students, setStudents] = useState([]);
  const [form, setForm] = useState({ title: "", description: "", assigned_to: "", priority: "medium", due_date: "", category: "General", program: "TECHINS", team: "General", expected_output: "", submission_requirements: "" });
  const [selected, setSelected] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [review, setReview] = useState({ decision: "revision", comment: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const h = auth();
      const [tasksRes, studentsRes] = await Promise.all([fetch(`${API_URL}/api/tasks`, { headers: h }), fetch(`${API_URL}/api/students`, { headers: h })]);
      const [taskData, studentData] = await Promise.all([tasksRes.json(), studentsRes.json()]);
      if (!tasksRes.ok) throw new Error(taskData.message || "Unable to load tasks");
      setTasks(taskData.tasks || []); setStudents(studentData.students || []); setError("");
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);

  const create = async (event) => {
    event.preventDefault(); setMessage(""); setError("");
    const res = await fetch(`${API_URL}/api/tasks`, { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify({ ...form, assigned_to: Number(form.assigned_to) }) });
    const data = await res.json();
    if (!res.ok) return setError(data.message || "Unable to create task");
    setMessage(`Task ${data.taskCode} assigned successfully.`);
    setForm({ title: "", description: "", assigned_to: "", priority: "medium", due_date: "", category: "General", program: "TECHINS", team: "General", expected_output: "", submission_requirements: "" });
    load();
  };

  const openReview = async (task) => {
    setSelected(task); setSubmissions([]); setReview({ decision: "revision", comment: "" });
    const res = await fetch(`${API_URL}/api/tasks/${task.id}/submissions`, { headers: auth() });
    const data = await res.json();
    setSubmissions(data.submissions || []);
  };

  const submitReview = async (decision = review.decision) => {
    const latest = submissions[0];
    if (!latest) return setError("No submission is available for review.");
    if (!review.comment.trim()) return setError("Review comments are required.");
    const res = await fetch(`${API_URL}/api/tasks/review`, { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify({ submission_id: latest.id, decision, comment: review.comment }) });
    const data = await res.json();
    if (!res.ok) return setError(data.message || "Unable to review submission");
    setMessage(data.message); setSelected(null); load();
  };

  return <div className="admin-simple page-enter">
    <div className="simple-head"><span>ASSIGNMENT CONTROL</span><h2>Tasks & Reviews</h2><p>Create assignments, track lifecycle status and review submitted versions.</p></div>
    {error && <div className="error-msg">{error}</div>}{message && <div className="success-msg">{message}</div>}
    <form className="panel form-grid-admin" onSubmit={create}>
      <input placeholder="Task title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
      <select value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })} required><option value="">Select student</option>{students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}><option>low</option><option>medium</option><option>high</option><option>critical</option></select>
      <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
      <input placeholder="Category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} />
      <input placeholder="Program" value={form.program} onChange={e => setForm({ ...form, program: e.target.value })} />
      <input placeholder="Team" value={form.team} onChange={e => setForm({ ...form, team: e.target.value })} />
      <textarea placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
      <textarea placeholder="Expected output" value={form.expected_output} onChange={e => setForm({ ...form, expected_output: e.target.value })} />
      <textarea placeholder="Submission requirements" value={form.submission_requirements} onChange={e => setForm({ ...form, submission_requirements: e.target.value })} />
      <button className="gold-btn">Assign Task</button>
    </form>

    <div className="panel table-wrap"><div className="panel-head"><div><span className="section-kicker">LIVE TASKS</span><h3>All assignments</h3></div><button onClick={load}>Refresh</button></div>
      <table><thead><tr><th>Task</th><th>Student</th><th>Workflow</th><th>Priority</th><th>Due</th><th>Submissions</th><th>Action</th></tr></thead><tbody>
        {tasks.map(t => <tr key={t.id}><td><strong>{t.task_code || `T-${t.id}`}</strong><small>{t.title}</small></td><td>{t.student_name}</td><td><span className={`pill ${t.status}`}>{t.workflow_status || t.status}</span></td><td>{t.priority}</td><td>{t.due_date || "—"}</td><td>{t.submission_count || 0}</td><td><button onClick={() => openReview(t)}>Review</button></td></tr>)}
      </tbody></table>{!tasks.length && <div className="empty-state">No tasks yet.</div>}
    </div>

    {selected && <div className="review-modal"><div className="panel"><div className="panel-head"><div><span className="section-kicker">SUBMISSION REVIEW</span><h3>{selected.task_code || "Task"} · {selected.title}</h3><p>{selected.student_name}</p></div><button onClick={() => setSelected(null)}>Close</button></div>
      {submissions.length ? <><div className="submission-manager"><div><strong>Version {submissions[0].version}</strong><small>{submissions[0].submission_code} · {new Date(submissions[0].submitted_at).toLocaleString()}</small><p>{submissions[0].comment || "No submission comment."}</p></div><span className="pill completed">{submissions[0].status}</span></div>
        <textarea value={review.comment} onChange={e => setReview({ ...review, comment: e.target.value })} placeholder="Review comments / revision reason" />
        <div className="quick-actions"><button onClick={() => submitReview("revision")}>Request Revision</button><button className="gold-btn" onClick={() => submitReview("approve")}>Approve</button></div>
      </> : <div className="empty-state">No submission versions are available for this task.</div>}
    </div></div>}
  </div>;
}
