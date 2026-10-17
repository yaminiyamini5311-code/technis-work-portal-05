import { useEffect, useState } from "react";
import { useExclusiveSelect } from "../../hooks/useExclusiveSelect";
import "../../styles/admin.css";
import { formatISTDateShort } from "../../utils/dateHelper";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

/* Fetch-with-auth download: a plain anchor cannot send the Authorization
   header, so files are fetched as blobs and saved via object URL. */
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

// REMOVED: PROGRAMS array now loaded from batches collection (same source as signup dropdown)

const DOMAINS = [
  { value: "edutins", label: "EduTins" },
  { value: "resins", label: "ResIns" },
  { value: "innovins", label: "InnoVins" },
  { value: "systins", label: "SysTins" },
  { value: "program", label: "Program" }
];

/* Blank form for CREATE mode. Editing reuses the same fields, so this object
   is the single definition of "no task selected". */
const EMPTY_FORM = {
  title: "",
  description: "",
  priority: "medium",
  start_date: "",
  start_time: "",
  due_date: "",
  due_time: "",
  day_number: "",
  domain: "edutins",
  how_to_do: "",
  expected_output: "",
  submission_requirements: ""
};

/* Fields the backend accepts on an edit (PUT /api/tasks/:id). Assignment is
   deliberately absent: the Edit action changes a task, it never reassigns it. */
const EDITABLE_FIELDS = [
  "title", "description", "priority", "domain", "day_number",
  "start_date", "start_time", "due_date", "due_time",
  "how_to_do", "expected_output", "submission_requirements"
];

export default function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [students, setStudents] = useState([]);
  const [batches, setBatches] = useState([]);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [batchesError, setBatchesError] = useState("");
  const [domainFilter, setDomainFilter] = useState("");
  const [targetType, setTargetType] = useState("student"); // "student" | "batch" | "program"
  const [batchId, setBatchId] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);

  const { student, setStudent, reset, isStudentDisabled } = useExclusiveSelect();
  const [selected, setSelected] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [review, setReview] = useState({ decision: "revision", comment: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Task edit: `editing` holds the task currently loaded into the form above.
  // When it is null the form behaves exactly as it always has (create mode).
  const [editing, setEditing] = useState(null);
  // Task removal: `confirmDelete` holds the task awaiting confirmation,
  // `deleting` keeps the confirm button disabled while the request is in flight.
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    try {
      const h = auth();
      const [tasksRes, studentsRes, batchesRes] = await Promise.all([
        fetch(`${API_URL}/api/tasks`, { headers: h }),
        fetch(`${API_URL}/api/students`, { headers: h }),
        fetch(`${API_URL}/api/batches`, { headers: h }),
      ]);
      const [taskData, studentData, batchData] = await Promise.all([tasksRes.json(), studentsRes.json(), batchesRes.json()]);
      if (!tasksRes.ok) throw new Error(taskData.message || "Unable to load tasks");
      setTasks(taskData.tasks || []);
      setStudents(studentData.students || []);
      const fetchedBatches = batchData.batches || [];
      setBatches(fetchedBatches);
      setBatchesError("");
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBatchesLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const create = async (event) => {
    event.preventDefault();
    setMessage("");
    setError("");

    // Validate target selection
    if (targetType === "student" && !student) {
      return setError("Select a student");
    }
    if (targetType === "batch" && !batchId) {
      return setError("Select a batch");
    }

    // Validate start/end dates + times
    if (form.start_date && form.due_date) {
      if (form.start_date > form.due_date) return setError("Starting Date cannot be after Ending Date");
      if (form.start_date === form.due_date && form.start_time && form.due_time && form.start_time > form.due_time) return setError("Starting time cannot be after ending time");
    }

    // IDs are ObjectId STRINGS — never convert to Number (that was the bug)
    const payload = {
      ...form,
      target_type: targetType,
      assigned_to: targetType === "student" && student ? student : null,
      student_ids: targetType === "student" && student ? [student] : [],
      batch_id: targetType === "batch" ? batchId : null,
      domain: form.domain
    };

    try {
      setSubmitting(true);
      const res = await fetch(`${API_URL}/api/tasks`, {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok) return setError(data.message || "Unable to create task");

      const parts = [`Task ${data.taskCode} assigned`];
      if (data.assigned_count) parts.push(`to ${data.assigned_count} student${data.assigned_count === 1 ? "" : "s"}`);
      setMessage(parts.join(" ") + ".");
      setForm(EMPTY_FORM);
      reset();
      setBatchId("");
      await load();
    } catch (e) {
      setError(e.message || "Unable to create task");
    } finally {
      setSubmitting(false);
    }
  };

  /* Loads a task into the EXISTING form above, pre-filled with its current
     values, and switches that form into edit mode. Assignment selectors are
     shown for context only and are disabled while editing: this action edits
     the task, it never reassigns it. */
  const openEdit = (task) => {
    setMessage("");
    setError("");
    setConfirmDelete(null);
    setEditing(task);
    setTargetType(task.target_type === "batch" ? "batch" : "student");
    setStudent(task.assigned_to || "");
    setBatchId(task.batch_id || "");
    setForm({
      title: task.title || "",
      description: task.description || "",
      priority: task.priority || "medium",
      start_date: task.start_date || "",
      start_time: task.start_time || "",
      due_date: task.due_date || "",
      due_time: task.due_time || "",
      day_number: task.day_number ?? "",
      domain: task.domain || "edutins",
      how_to_do: task.how_to_do || "",
      expected_output: task.expected_output || "",
      submission_requirements: task.submission_requirements || ""
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Leaves edit mode and restores the blank create form. Nothing is saved.
  const cancelEdit = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setTargetType("student");
    setBatchId("");
    reset();
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    if (!editing) return;
    setMessage("");
    setError("");

    if (!form.title.trim()) return setError("Task title is required");
    // A deadline may be extended, but never moved before the start date.
    if (form.start_date && form.due_date) {
      if (form.start_date > form.due_date) return setError("Starting Date cannot be after Ending Date");
      if (form.start_date === form.due_date && form.start_time && form.due_time && form.start_time > form.due_time) return setError("Starting time cannot be after ending time");
    }

    const taskId = editing.id;
    const taskCode = editing.task_code || editing.title;
    const payload = {};
    for (const field of EDITABLE_FIELDS) payload[field] = form[field];

    try {
      setSubmitting(true);
      const res = await fetch(`${API_URL}/api/tasks/${taskId}`, {
        method: "PUT",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        setError(data.message || "Unable to update task. Please try again.");
        return;
      }

      setMessage(`Task ${taskCode} updated successfully.`);
      cancelEdit();
      await load();
    } catch {
      setError("Unable to update task. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const openReview = async (task) => {
    setSelected(task); 
    setSubmissions([]); 
    setReview({ decision: "revision", comment: "" });
    const res = await fetch(`${API_URL}/api/tasks/${task.id}/submissions`, { headers: auth() });
    const data = await res.json();
    setSubmissions(data.submissions || []);
  };

  // Opens the confirmation popup. Nothing is deleted until confirmDeleteTask runs.
  const askDelete = (task) => {
    setMessage("");
    setError("");
    setConfirmDelete(task);
  };

  // Deletes only after the CEO confirms. The success message is set solely
  // from a confirmed backend response, then the list is refreshed.
  const confirmDeleteTask = async () => {
    const task = confirmDelete;
    if (!task || deleting) return;
    setDeleting(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/tasks/${task.id}`, {
        method: "DELETE",
        headers: auth()
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        setError(data.message || "Task could not be removed. Please try again.");
        setConfirmDelete(null);
        return;
      }

      const removed = data.removed || {};
      const parts = [`Task ${task.task_code || task.title} removed successfully`];
      const extra = [];
      if (removed.assignments) extra.push(`${removed.assignments} student assignment${removed.assignments === 1 ? "" : "s"}`);
      if (removed.submissions) extra.push(`${removed.submissions} submission${removed.submissions === 1 ? "" : "s"}`);
      if (extra.length) parts.push(`with ${extra.join(" and ")}`);

      setMessage(parts.join(" ") + ".");
      setConfirmDelete(null);
      await load();
    } catch (e) {
      setError("Task could not be removed. Please try again.");
      setConfirmDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const submitReview = async (decision = review.decision) => {
    const latest = submissions[0];
    if (!latest) return setError("No submission is available for review.");
    
    // Auto-set comment for approval/revision to avoid requiring manual entry
    // and update the review state so the textarea reflects the auto-generated value
    let comment = review.comment;
    if (decision === "approve") {
      comment = "Approved";
    } else if (decision === "revision") {
      comment = "Revision requested";
    }
    if (!review.comment.trim() && decision !== "approve" && decision !== "revision") {
      return setError("Review comments are required.");
    }
    // Update review state so textarea shows the auto-generated comment
    if ((decision === "approve" || decision === "revision") && comment !== review.comment) {
      setReview({ ...review, comment });
    }
    const res = await fetch(`${API_URL}/api/tasks/review`, { 
      method: "POST", 
      headers: { ...auth(), "Content-Type": "application/json" }, 
      body: JSON.stringify({ submission_id: latest.id, decision, comment }) 
    });
    const data = await res.json();
    
    if (!res.ok) return setError(data.message || "Unable to review submission");
    
    setMessage(data.message); 
    setSelected(null); 
    load();
  };

  return (
    <div className="admin-simple page-enter">
      <div className="simple-head">
        <span>ASSIGNMENT CONTROL</span>
        <h2>Tasks & Reviews</h2>
        <p>Create assignments, track lifecycle status and review submitted versions.</p>
      </div>
      
      {error && <div className="error-msg">{error}</div>}
      {message && <div className="success-msg">{message}</div>}

      {editing && (
        <div className="info-msg">
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span>
              EDITING TASK {editing.task_code || "—"} · {editing.title}
            </span>
            <button type="button" onClick={cancelEdit} disabled={submitting}>Cancel edit</button>
          </div>
        </div>
      )}

      <form className="panel form-grid-admin" onSubmit={editing ? saveEdit : create} autoComplete="off">
        <div className="field">
          <label className="field-label" htmlFor="task-title">Task title <span className="req">*</span></label>
          <input
            id="task-title"
            name="task-title"
            placeholder="Task title"
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            required
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="task-target-type">
            Assign To <span className="req">*</span>
          </label>
          <select
            id="task-target-type"
            name="task-target-type"
            value={targetType}
            onChange={e => setTargetType(e.target.value)}
            required
            disabled={!!editing}
            autoComplete="off"
            title={editing ? "Editing does not change who a task is assigned to" : ""}
          >
            <option value="student">Individual Student</option>
            <option value="batch">Entire Batch</option>
          </select>
          {editing && (
            <small className="field-hint">Assignment cannot be changed while editing</small>
          )}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="task-student">
            Select Student
          </label>
          <select
            id="task-student"
            name="task-student"
            value={student}
            onChange={e => setStudent(e.target.value)}
            disabled={isStudentDisabled || targetType !== "student" || !!editing}
            autoComplete="off"
            style={isStudentDisabled || targetType !== "student" || !!editing ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
            title={editing ? "Editing does not change who a task is assigned to" : isStudentDisabled ? "Disabled because a program is selected" : targetType !== "student" ? "Select 'Individual Student' above" : ""}
            aria-disabled={isStudentDisabled || targetType !== "student" || !!editing}
          >
            <option value="">Select student</option>
            {students.map(s => (
              <option key={s.id} value={s.id}>{s.name}{s.batch_name ? ` (${s.batch_name})` : ""}</option>
            ))}
          </select>
          {targetType !== "student" && (
            <small className="field-hint">Choose “Individual Student” to pick a student</small>
          )}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="task-batch">
            Select Batch
          </label>
          <select
            id="task-batch"
            name="task-batch"
            value={batchId}
            onChange={e => setBatchId(e.target.value)}
            disabled={batchesLoading || targetType !== "batch" || !!editing}
            autoComplete="off"
            style={batchesLoading || targetType !== "batch" || !!editing ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
            title={editing ? "Editing does not change who a task is assigned to" : targetType !== "batch" ? "Select 'Entire Batch' above" : ""}
            aria-disabled={batchesLoading || targetType !== "batch" || !!editing}
          >
            <option value="">{batchesLoading ? "Loading batches..." : "Select batch"}</option>
            {batches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          {batchesError && <small className="field-hint" style={{ color: '#B42318' }}>{batchesError}</small>}
          {targetType === "batch" && !batchesLoading && !batchesError && batches.length === 0 && (
            <small className="field-hint" style={{ color: '#B42318' }}>No batches available</small>
          )}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="task-priority">Priority</label>
          <select
            id="task-priority"
            name="task-priority"
            value={form.priority}
            onChange={e => setForm({ ...form, priority: e.target.value })}
            autoComplete="off"
          >
            <option>low</option>
            <option>medium</option>
            <option>high</option>
            <option>critical</option>
          </select>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="task-domain">
            Domain <span className="req">*</span>
          </label>
          <select
            id="task-domain"
            name="task-domain"
            value={form.domain}
            onChange={e => setForm({ ...form, domain: e.target.value })}
            required
            autoComplete="off"
          >
            {DOMAINS.map(d => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="task-day">Day (1-60)</label>
          <input id="task-day" name="task-day" type="number" min="1" max="60" value={form.day_number} onChange={e => setForm({ ...form, day_number: e.target.value })} autoComplete="off" />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="task-start-date">Starting Date</label>
          <input id="task-start-date" name="task-start-date" type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} autoComplete="off" />
          <input id="task-start-time" name="task-start-time" type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} autoComplete="off" style={{ marginTop: "6px" }} />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="task-due-date">Ending Date</label>
          <input id="task-due-date" name="task-due-date" type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} autoComplete="off" />
          <input id="task-due-time" name="task-due-time" type="time" value={form.due_time} onChange={e => setForm({ ...form, due_time: e.target.value })} autoComplete="off" style={{ marginTop: "6px" }} />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="task-description">Description</label>
          <textarea
            id="task-description"
            name="task-description"
            placeholder="Description"
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="task-how-to-do">How to Do</label>
          <textarea
            id="task-how-to-do"
            name="task-how-to-do"
            placeholder="How to Do"
            value={form.how_to_do}
            onChange={e => setForm({ ...form, how_to_do: e.target.value })}
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="task-expected-output">Expected Output</label>
          <textarea
            id="task-expected-output"
            name="task-expected-output"
            placeholder="Expected output"
            value={form.expected_output}
            onChange={e => setForm({ ...form, expected_output: e.target.value })}
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="task-submission-requirements">Submission Requirements</label>
          <textarea
            id="task-submission-requirements"
            name="task-submission-requirements"
            placeholder="Submission requirements"
            value={form.submission_requirements}
            onChange={e => setForm({ ...form, submission_requirements: e.target.value })}
            autoComplete="off"
          />
        </div>

        <button className="gold-btn" type="submit" disabled={submitting}>
          {editing
            ? (submitting ? "Saving…" : "Save Changes")
            : (submitting ? "Assigning…" : "Assign Task")}
        </button>
      </form>

      <div className="panel table-wrap">
        <div className="panel-head">
          <div>
            <span className="section-kicker">LIVE TASKS</span>
            <h3>All assignments</h3>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <select
              value={domainFilter}
              onChange={e => setDomainFilter(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #D0D0D0', fontSize: '13px' }}
            >
              <option value="">All Domains</option>
              {DOMAINS.map(d => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
            <button onClick={load}>Refresh</button>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Domain</th>
              <th>Student / Batch</th>
              <th>Program</th>
              <th>Workflow</th>
              <th>Priority</th>
              <th>Start</th>
              <th>End</th>
              <th>Submissions</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {tasks.filter(t => !domainFilter || t.domain === domainFilter).map(t => (
              <tr key={t.id}>
                <td>
                  <strong>{t.task_code || `T-${t.id}`}</strong>
                  <small>{t.title}</small>
                </td>
                <td>
                  <span className="domain-chip" style={{
                    padding: '4px 10px',
                    borderRadius: '20px',
                    background: '#F7F7F7',
                    color: '#0C120C',
                    fontSize: '11px',
                    fontWeight: '700',
                    textTransform: 'capitalize'
                  }}>
                    {t.domain ? DOMAINS.find(d => d.value === t.domain)?.label || t.domain : '—'}
                  </span>
                </td>
                <td>
                  {t.target_type === "batch" ? (
                    <>
                      <strong>{t.batch_name || "Batch"}</strong>
                      <small>{t.assignee_count || 0} assignees</small>
                    </>
                  ) : (
                    t.student_name
                  )}
                </td>
                <td>{t.program ? t.program.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '—'}</td>
                <td>
                  <span className={`pill ${t.status}`}>
                    {t.workflow_status || t.status}
                  </span>
                </td>
                <td>{t.priority}</td>
                <td>{t.start_date ? `${t.start_date}${t.start_time ? ` ${t.start_time}` : ""}` : "—"}</td>
                <td>{t.due_date ? formatISTDateShort(t.due_date) : "—"}</td>
                <td>{t.submission_count || 0}</td>
                <td>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => openEdit(t)}
                      disabled={deleting || submitting}
                      aria-label={`Edit task ${t.task_code || t.title}`}
                    >
                      Edit
                    </button>
                    <button onClick={() => openReview(t)}>Review</button>
                    <button
                      onClick={() => askDelete(t)}
                      disabled={deleting}
                      aria-label={`Remove task ${t.task_code || t.title}`}
                      style={{ color: '#B42318', borderColor: '#F0C7C2', background: '#FEF3F2' }}
                    >
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!tasks.filter(t => !domainFilter || t.domain === domainFilter).length && <div className="empty-state">No tasks yet.</div>}
      </div>

      {confirmDelete && (
        <div className="review-modal">
          <div className="panel" role="dialog" aria-modal="true" aria-labelledby="confirm-delete-title">
            <div className="panel-head">
              <div>
                <span className="section-kicker">REMOVE TASK</span>
                <h3 id="confirm-delete-title">
                  {confirmDelete.task_code || "Task"} · {confirmDelete.title}
                </h3>
                <p>
                  {confirmDelete.target_type === "batch"
                    ? `This task is assigned to batch "${confirmDelete.batch_name || "—"}" (${confirmDelete.assignee_count || 0} assignees).`
                    : confirmDelete.student_name
                      ? `Assigned to ${confirmDelete.student_name}.`
                      : "This task has student assignments."}
                </p>
              </div>
              <button onClick={() => setConfirmDelete(null)} disabled={deleting}>Close</button>
            </div>

            <p style={{ marginTop: '16px' }}>
              This permanently removes the task and its student assignments and submissions. This cannot be undone.
            </p>

            <div className="quick-actions">
              <button onClick={() => setConfirmDelete(null)} disabled={deleting}>Cancel</button>
              <button
                className="gold-btn"
                onClick={confirmDeleteTask}
                disabled={deleting}
                style={deleting ? { opacity: 0.6, cursor: 'not-allowed' } : { background: '#B42318', color: '#fff', borderColor: '#B42318' }}
              >
                {deleting ? "Removing…" : "Yes, remove task"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="review-modal">
          <div className="panel">
            <div className="panel-head">
              <div>
                <span className="section-kicker">SUBMISSION REVIEW</span>
                <h3>{selected.task_code || "Task"} · {selected.title}</h3>
                <p>{selected.student_name}</p>
              </div>
              <button onClick={() => setSelected(null)}>Close</button>
            </div>

            {submissions.length ? (
              <>
                <div className="submission-manager">
                  <div>
                    <strong>Version {submissions[0].version}</strong>
                    <small>
                      {submissions[0].submission_code} · {new Date(submissions[0].submitted_at).toLocaleString()}
                    </small>
                    <p>{submissions[0].comment || "No submission comment."}</p>
                    {(submissions[0].files || []).length ? (
                      <div className="quick-actions">
                        {submissions[0].files.map(f => (
                          <button key={f.id} onClick={() => downloadSubmissionFile(f, setError)}>
                            {f.name}{f.size ? ` (${f.size < 1024 ? `${f.size} B` : `${(f.size / 1024).toFixed(1)} KB`})` : ""}
                          </button>
                        ))}
                      </div>
                    ) : <small>No files attached to this version.</small>}
                  </div>
                  <span className="pill completed">{submissions[0].status}</span>
                </div>

                <div className="field" style={{ marginTop: '20px' }}>
                  <label className="field-label" htmlFor="review-comment">
                    Review comments <span className="req">*</span>
                  </label>
                  <textarea
                    id="review-comment"
                    name="review-comment"
                    value={review.comment}
                    onChange={e => setReview({ ...review, comment: e.target.value })}
                    placeholder="Review comments / revision reason"
                    required
                    style={{ minHeight: '120px', padding: '12px 14px', fontSize: '14px', fontWeight: '600' }}
                  />
                </div>

                <div className="quick-actions">
                  <button onClick={() => submitReview("revision")}>Request Revision</button>
                  <button className="gold-btn" onClick={() => submitReview("approve")}>Approve</button>
                </div>
              </>
            ) : (
              <div className="empty-state">No submission versions are available for this task.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
