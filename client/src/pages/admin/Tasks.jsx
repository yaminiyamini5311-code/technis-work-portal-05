import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useExclusiveSelect } from "../../hooks/useExclusiveSelect";
import useModalBehavior from "../../components/useModalBehavior";
import TechinsIcon from "../../components/TechinsIcon";
import "../../styles/admin.css";
import "../../styles/ceo-ui.css";
import { formatWorkspaceDateTimeParts, pluralise } from "../../utils/dateHelper";
import { remainingTime, taskTitle, titleCase } from "../../utils/api";
import StatusBadge from "../../components/StatusBadge";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

// REMOVED: PROGRAMS array now loaded from batches collection (same source as signup dropdown)

/**
 * Real domains only.
 *
 * "Program" used to be listed here as if it were a domain, so every task
 * created through that dropdown stored domain:"program" and the Live Tasks
 * table rendered a "Program" badge in the DOMAIN column while the PROGRAM
 * column showed "—". Program is a separate field and is derived from the
 * assignees; see the Program column below.
 */
const DOMAINS = [
  { value: "edutins", label: "EduTins" },
  { value: "resins", label: "ResIns" },
  { value: "innovins", label: "InnoVins" },
  { value: "systins", label: "SysTins" },
];

/* Status chips rendered in the Workflow column. These are the per-student
   counts returned by the backend aggregation — one row per task used to show a
   single task-wide status, which was wrong as soon as one of 38 students acted. */
const WORKFLOW_CHIPS = [
  { key: "submitted", label: "Submitted", status: "submitted" },
  { key: "pending", label: "Pending", status: "pending" },
  { key: "in_progress", label: "In Progress", status: "in_progress" },
  { key: "revision_required", label: "Revision", status: "revision_required" },
  { key: "resubmission_expired", label: "Expired", status: "resubmission_expired" },
  { key: "approved", label: "Approved", status: "approved" },
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
  const closeDeleteRef = useModalBehavior(Boolean(confirmDelete), () => setConfirmDelete(null));

  const navigate = useNavigate();
  const { pathname } = useLocation();
  const workspace = pathname.startsWith("/manager") ? "manager" : "admin";

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

  /* Domain filter.
     `effective_domain` is what the Domain column shows and what the filter
     matches on, so the legacy "program" pseudo-domain does not silently hide
     every row the moment it is removed from the dropdown. */
  const filteredTasks = useMemo(
    () => tasks.filter(t => !domainFilter || (t.effective_domain || t.domain) === domainFilter),
    [tasks, domainFilter]
  );

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

  /**
   * Open the Task Manager for one task.
   *
   * This is a NAVIGATION to a registered route (`/${workspace}/tasks/:id/review`),
   * not an in-page modal:
   *  - the old modal opened directly over the Assign Task form, so the review
   *    UI and the create/edit form were on screen at the same time with no
   *    scroll lock, focus trap or Escape handling;
   *  - it fetched `submissions[0]` — the highest version of the whole task —
   *    so it showed one arbitrary student even when 20 had submitted;
   *  - it never checked `res.ok`, so an API failure rendered an empty modal
   *    indistinguishable from "no submissions";
   *  - there was no route to navigate to, and any unregistered review URL
   *    fell through to the catch-all that redirects to /login — the reported
   *    "Review takes me to the home page" behaviour.
   *
   * Guarded here so an invalid id produces a visible, actionable message
   * instead of a bad URL.
   */
  const openReview = (task) => {
    setMessage("");
    setError("");
    const id = task && task.id ? String(task.id) : "";
    if (!id || id === "null" || id === "undefined") {
      setError("This task has no valid identifier, so its review page cannot be opened. Refresh the list and try again.");
      return;
    }
    navigate(`/${workspace}/tasks/${id}/review`);
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

  // Review decisions live on the dedicated review route now
  // (pages/admin/TaskReview.jsx), where the target student, the version and the
  // feedback are all explicit. Nothing to do here.

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
          <label className="field-label" htmlFor="task-start-time">Starting Time</label>
          <input id="task-start-time" name="task-start-time" type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} autoComplete="off" />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="task-due-date">Ending Date</label>
          <input id="task-due-date" name="task-due-date" type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} autoComplete="off" />
          <label className="field-label" htmlFor="task-due-time">Ending Time</label>
          <input id="task-due-time" name="task-due-time" type="time" value={form.due_time} onChange={e => setForm({ ...form, due_time: e.target.value })} autoComplete="off" />
        </div>

        {/* The three free-text fields share one row and one min-height so they
            line up. Submission Requirements previously sat alone on a half-width
            row and left a visible hole beside it. */}
        <div className="field">
          <label className="field-label" htmlFor="task-description">Description</label>
          <textarea
            id="task-description"
            name="task-description"
            placeholder="Description"
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            maxLength={500}
            autoComplete="off"
          />
          <small className="field-hint">{form.description.length}/500 characters</small>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="task-how-to-do">How to Do</label>
          <textarea
            id="task-how-to-do"
            name="task-how-to-do"
            placeholder="How to Do"
            value={form.how_to_do}
            onChange={e => setForm({ ...form, how_to_do: e.target.value })}
            maxLength={500}
            autoComplete="off"
          />
          <small className="field-hint">{form.how_to_do.length}/500 characters</small>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="task-expected-output">Expected Output</label>
          <textarea
            id="task-expected-output"
            name="task-expected-output"
            placeholder="Expected output"
            value={form.expected_output}
            onChange={e => setForm({ ...form, expected_output: e.target.value })}
            maxLength={500}
            autoComplete="off"
          />
          <small className="field-hint">{form.expected_output.length}/500 characters</small>
        </div>

        {/* Full width: the last field of the group, so the grid closes cleanly. */}
        <div className="field field-full">
          <label className="field-label" htmlFor="task-submission-requirements">Submission Requirements</label>
          <textarea
            id="task-submission-requirements"
            name="task-submission-requirements"
            placeholder="Submission requirements"
            value={form.submission_requirements}
            onChange={e => setForm({ ...form, submission_requirements: e.target.value })}
            maxLength={500}
            autoComplete="off"
          />
          <small className="field-hint">{form.submission_requirements.length}/500 characters</small>
        </div>

        {/* Left-aligned with the form's fields and a consistent top margin. */}
        <div className="field field-full form-actions">
          <button className="gold-btn" type="submit" disabled={submitting}>
            {editing
              ? (submitting ? "Saving…" : "Save Changes")
              : (submitting ? "Assigning…" : "Assign Task")}
          </button>
        </div>
      </form>

      <div className="panel table-wrap">
        {/* Title, domain filter and Refresh share one row (wrapping on mobile). */}
        <div className="panel-head ui-toolbar">
          <div>
            <span className="section-kicker">LIVE TASKS</span>
            <h3>All assignments</h3>
          </div>
          <div className="ui-toolbar-controls">
            <select
              className="ui-select"
              value={domainFilter}
              onChange={e => setDomainFilter(e.target.value)}
              aria-label="Filter by domain"
            >
              <option value="">All Domains</option>
              {DOMAINS.map(d => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
            <button type="button" className="ui-btn ui-btn--neutral" onClick={load}>Refresh</button>
          </div>
        </div>

        {/* The wrapper is the horizontal scroller. Previously the table had
            `table-layout: auto`, so on a narrow viewport every column was
            squeezed until the content wrapped into a column thousands of
            pixels tall (measured 3092px for 31 rows). */}
        <div className="ui-table-wrap">

        <table className="ui-table tasks-table">
          <colgroup>
            <col style={{ width: "20%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "16%" }} />
          </colgroup>
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
            {filteredTasks.map(t => {
              const counts = t.status_counts || {};
              const deadline = remainingTime(t.due_at || t.due_date);
              return (
              <tr key={t.id}>
                <td>
                  <strong>{t.task_code || `T-${t.id}`}</strong>
                  {/* white-space keeps the stored title verbatim, so a "|"
                      separator stays a pipe instead of reading like an "I". */}
                  <small style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{taskTitle(t.title)}</small>
                </td>
                <td>
                  {/* Themed badge. This was a pure-white pill (#F7F7F7 on a
                      dark canvas) with dark text — unreadable in the CEO
                      workspace. */}
                  <span className="ui-chip ui-chip--pending">
                    {t.effective_domain
                      ? (DOMAINS.find(d => d.value === t.effective_domain)?.label || titleCase(t.effective_domain))
                      : '—'}
                  </span>
                </td>
                <td>
                  {t.target_type === "batch" ? (
                    <>
                      <strong>{t.batch_name || "Batch"}</strong>
                      <small>{pluralise(t.assignee_count || 0, "assignee")}</small>
                    </>
                  ) : (
                    <>
                      <strong>{t.student_name || "—"}</strong>
                      {t.student_code && <small>{t.student_code}</small>}
                    </>
                  )}
                </td>
                {/* Real program: the task's own value, or the one shared by
                    its assignees. Previously this read tasks.program only,
                    which is null for every batch task, so it always showed "—". */}
                <td>{t.program ? titleCase(t.program) : <span className="ui-na">Not available</span>}</td>
                {/* Per-student aggregate. A task with 38 assignees cannot be
                    described by one status, so the backend returns the counts
                    and each non-zero bucket is shown as its own chip. */}
                <td>
                  {/* A wrapping group of equal-height chips in a column with a
                      stable width, so they never wrap unevenly between rows. */}
                  <div className="ui-chip-group">
                    {WORKFLOW_CHIPS.map((chip) => {
                      const value = counts[chip.key] || 0;
                      if (!value) return null;
                      return (
                        <StatusBadge
                          key={chip.key}
                          status={chip.status}
                          label={chip.label}
                          count={value}
                        />
                      );
                    })}
                    {!counts.assigned && <StatusBadge status="pending" label="No assignees" />}
                  </div>
                </td>
                <td>
                  <span className={`ui-chip ui-chip--${t.priority === "high" ? "progress" : t.priority === "low" ? "pending" : "submitted"}`}>
                    {titleCase(t.priority || "medium")}
                  </span>
                </td>
                {/* Both window columns use the shared formatter, so Start and
                    End always show the same shape with a time. Previously Start
                    printed the raw "2026-10-16 00:30" and End printed a date
                    with no time at all. */}
                <td className="cell-date">
                  {formatWorkspaceDateTimeParts(t.start_date, t.start_time) || <span className="ui-na">Not set</span>}
                </td>
                <td className="cell-date">
                  {formatWorkspaceDateTimeParts(t.due_date, t.due_time) || <span className="ui-na">Not set</span>}
                  {/* "Overdue" is a derived flag, not a stored status. */}
                  {deadline && deadline.overdue && (
                    <small className="cell-overdue">{deadline.label}</small>
                  )}
                </td>
                {/* Distinct students who submitted, not versions. */}
                <td>
                  <strong>{t.submission_count || 0}</strong>
                  <small className="cell-sub">
                    of {pluralise(t.assignee_count || 0, "assignee")}
                  </small>
                </td>
                <td>
                  {/* One group, equal height, fixed order Edit · Review ·
                      Remove. Remove no longer drops onto its own line. */}
                  <div className="ui-actions">
                    <button
                      type="button"
                      className="ui-btn ui-btn--neutral"
                      onClick={() => openEdit(t)}
                      disabled={deleting || submitting}
                      aria-label={`Edit task ${t.task_code || t.title}`}
                    >
                      Edit
                    </button>
                    <button type="button" className="ui-btn ui-btn--info" onClick={() => openReview(t)}>
                      Review
                    </button>
                    <button
                      type="button"
                      className="ui-btn ui-btn--danger"
                      onClick={() => askDelete(t)}
                      disabled={deleting}
                      aria-label={`Remove task ${t.task_code || t.title}`}
                    >
                      <TechinsIcon name="trash" size={13} variant="light" ariaHidden />
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        </div>

        {!filteredTasks.length && (
          <div className="empty-state">
            {domainFilter ? `No tasks in ${DOMAINS.find(d => d.value === domainFilter)?.label || domainFilter}.` : "No tasks yet."}
          </div>
        )}
      </div>

      {confirmDelete && (
        <div className="review-modal" ref={closeDeleteRef} onPointerDown={(e) => { if (e.target === e.currentTarget) setConfirmDelete(null); }}>
          <div className="panel" role="alertdialog" aria-modal="true" aria-labelledby="confirm-delete-title">
            <div className="panel-head">
              <div>
                <span className="section-kicker">REMOVE TASK</span>
                <h3 id="confirm-delete-title">
                  {confirmDelete.task_code || "Task"} · {taskTitle(confirmDelete.title)}
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
    </div>
  );
}
