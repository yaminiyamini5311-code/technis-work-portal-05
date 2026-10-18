import { useCallback, useEffect, useMemo, useState } from "react";
import FixedOverlay from "../../components/FixedOverlay";
import { apiFetch } from "../../utils/api";
import "../../styles/admin.css";
import "./feedback.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

function fmtDate(value) {
  if (!value) return "—";
  try { return new Date(value).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }); } catch { return String(value); }
}

function pluralise(n, word) {
  return n === 1 ? `${n} ${word}` : `${n} ${word}s`;
}

export default function Feedback() {
  const [students, setStudents] = useState([]);
  const [studentTasks, setStudentTasks] = useState([]);
  const [entries, setEntries] = useState([]);
  const [form, setForm] = useState({ user_id: "", task_id: "", score: "", feedback: "", strengths: "", improvements: "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Edit / delete dialogs.
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ feedback: "", score: "", strengths: "", improvements: "" });
  const [editErrors, setEditErrors] = useState({});
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

  const loadEntries = useCallback(async () => {
    setDataLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/feedback/tasks`, { headers: authHeaders() });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.success) throw new Error(d.message || "Unable to load feedback");
      setEntries(Array.isArray(d.entries) ? d.entries : []);
      setLoadError("");
    } catch (e) {
      setEntries([]);
      setLoadError(e.message || "Unable to load feedback");
    } finally {
      setDataLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const h = authHeaders();
      const [a, b] = await Promise.all([
        fetch(`${API_URL}/api/admin/students`, { headers: h }),
        fetch(`${API_URL}/api/tasks`, { headers: h })
      ]);
      const ad = await a.json().catch(() => ({}));
      const bd = await b.json().catch(() => ({}));
      setStudents(ad.students || []);
      setStudentTasks(bd.tasks || []);
    } catch (e) {
      console.error("Failed to load feedback data:", e);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadEntries(); }, [loadEntries]);

  // FIX C-7: Tasks are ALWAYS derived from the selected student's own assignments
  // (task_assignments via assignee_ids), so feedback can never be filed against
  // a task the student was not assigned.
  const assignedTasks = useMemo(() => {
    if (!form.user_id) return [];
    const wanted = String(form.user_id);
    return studentTasks.filter((t) =>
      Array.isArray(t.assignee_ids)
        ? t.assignee_ids.map(String).includes(wanted)
        : String(t.assigned_to || "") === wanted
    );
  }, [form.user_id, studentTasks]);

  // Group: student -> task -> entries. Legacy records without a stored
  // task_id are kept under a clearly-labelled "General feedback" group.
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byStudent = new Map();
    for (const e of entries) {
      if (q) {
        const hay = `${e.student_name || ""} ${e.student_code || ""} ${e.task_title || ""} ${e.task_code || ""} ${e.feedback || ""}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      const sKey = e.student_id;
      if (!byStudent.has(sKey)) byStudent.set(sKey, { student: e, tasks: new Map() });
      const student = byStudent.get(sKey);
      const tKey = e.task_id || "__general__";
      if (!student.tasks.has(tKey)) {
        student.tasks.set(tKey, {
          task_id: e.task_id,
          task_code: e.task_code,
          task_title: e.task_title || (e.task_id ? "Removed task" : "General feedback"),
          task_day: e.task_day,
          task_missing: e.task_missing,
          entries: [],
        });
      }
      student.tasks.get(tKey).entries.push(e);
    }
    return [...byStudent.values()].sort((a, b) => String(a.student.student_name || "").localeCompare(String(b.student.student_name || "")));
  }, [entries, search]);

  // FIX C-12: client-side validation
  const validate = () => {
    const errs = {};
    if (!form.user_id) errs.user_id = "Please select a student";
    if (!form.feedback.trim()) errs.feedback = "Feedback text is required";
    if (form.score !== "") {
      const n = Number(form.score);
      if (!Number.isFinite(n) || n < 0 || n > 100) errs.score = "Score must be between 0 and 100";
    }
    return errs;
  };

  const updateField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((e) => ({ ...e, [key]: "" }));
    setServerError("");
    setSuccessMsg("");
  };

  /* ── Edit ─────────────────────────────────────────────────────────────── */

  const openEdit = (entry) => {
    setEditing(entry);
    setEditError("");
    setEditErrors({});
    setEditForm({
      feedback: entry.feedback || "",
      score: entry.score == null ? "" : String(entry.score),
      strengths: entry.strengths || "",
      improvements: entry.improvements || "",
    });
  };

  const closeEdit = () => {
    setEditing(null);
    setEditForm({ feedback: "", score: "", strengths: "", improvements: "" });
    setEditError("");
    setEditErrors({});
  };

  const validateEdit = () => {
    const errs = {};
    if (!editForm.feedback.trim()) errs.feedback = "Feedback text is required";
    if (editForm.score !== "") {
      const n = Number(editForm.score);
      if (!Number.isFinite(n) || n < 0 || n > 100) errs.score = "Score must be between 0 and 100";
    }
    return errs;
  };

  const saveEdit = async () => {
    if (!editing || savingEdit) return;
    const errs = validateEdit();
    if (Object.keys(errs).length) {
      setEditErrors(errs);
      return;
    }
    setSavingEdit(true);
    setEditError("");
    try {
      await apiFetch(`/api/admin/feedback/${encodeURIComponent(editing.id)}`, {
        method: "PUT",
        body: {
          feedback: editForm.feedback.trim(),
          score: editForm.score === "" ? null : Number(editForm.score),
          strengths: editForm.strengths.split(",").map((v) => v.trim()).filter(Boolean),
          improvements: editForm.improvements.split(",").map((v) => v.trim()).filter(Boolean),
        },
      });
      setSuccessMsg("Feedback updated.");
      closeEdit();
      await loadEntries();
    } catch (err) {
      // Show the server's own message (403 / 409 / validation), never a fake one.
      setEditError(err.message || "Unable to update feedback");
    } finally {
      setSavingEdit(false);
    }
  };

  /* ── Delete ───────────────────────────────────────────────────────────── */

  const openDelete = (entry) => {
    setDeleting(entry);
    setDeleteError("");
    setConfirmDelete(false);
  };

  const closeDelete = () => {
    setDeleting(null);
    setDeleteError("");
    setConfirmDelete(false);
  };

  const runDelete = async () => {
    if (!deleting) return;
    setDeleteError("");
    try {
      await apiFetch(`/api/admin/feedback/${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
      setSuccessMsg("Feedback deleted.");
      closeDelete();
      await loadEntries();
    } catch (err) {
      setDeleteError(err.message || "Unable to delete feedback");
    }
  };

  /** Short excerpt used to name the entry in the confirmation dialog. */
  const snippet = (entry) => {
    const text = String(entry?.feedback || "").trim().replace(/\s+/g, " ");
    if (!text) return "(no text)";
    return text.length > 90 ? `${text.slice(0, 90)}…` : text;
  };

  const submit = async (ev) => {
    ev.preventDefault();
    if (loading) return;
    const errs = validate();
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      setServerError("");
      return;
    }
    setServerError("");
    setSuccessMsg("");
    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/admin/feedback`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: form.user_id,
          task_id: form.task_id || undefined,
          feedback: form.feedback,
          score: form.score === "" ? undefined : Number(form.score),
          strengths: form.strengths.split(",").map((v) => v.trim()).filter(Boolean),
          improvements: form.improvements.split(",").map((v) => v.trim()).filter(Boolean),
        })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setServerError(d.message || "Unable to save feedback");
        return;
      }
      setSuccessMsg("Feedback saved.");
      setForm({ user_id: "", task_id: "", score: "", feedback: "", strengths: "", improvements: "" });
      setFieldErrors({});
      await loadEntries();
    } catch (err) {
      setServerError("An error occurred while saving feedback");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-simple page-enter">
      <div className="simple-head">
        <span>MENTORING</span>
        <h2>Task Feedback</h2>
        <p>Give task-specific feedback to a student. Each entry is stored against that student and that task.</p>
      </div>

      {serverError && <div className="error-msg" role="alert">{serverError}</div>}
      {successMsg && <div className="success-msg" role="status">{successMsg}</div>}

      <form className="panel form-grid-admin" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="feedback-student" className="field-label">Student <span className="req">*</span></label>
          <select
            id="feedback-student"
            name="feedback-student"
            value={form.user_id}
            required
            autoComplete="off"
            aria-invalid={!!fieldErrors.user_id}
            onChange={(e) => updateField("user_id", e.target.value)}
          >
            <option value="">Select student</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {fieldErrors.user_id && <small className="field-error" role="alert">{fieldErrors.user_id}</small>}
        </div>

        <div className="field">
          <label htmlFor="feedback-task" className="field-label">Task (optional)</label>
          <select
            id="feedback-task"
            name="feedback-task"
            value={form.task_id}
            disabled={!form.user_id}
            autoComplete="off"
            onChange={(e) => updateField("task_id", e.target.value)}
          >
            <option value="">General feedback (not task-specific)</option>
            {assignedTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.day_number != null ? `Day ${String(t.day_number).padStart(2, "0")} · ` : ""}{t.task_code ? `${t.task_code} · ` : ""}{t.title}
              </option>
            ))}
          </select>
          <small className="field-hint">
            {form.user_id
              ? (assignedTasks.length ? `${assignedTasks.length} task(s) assigned to this student` : "No tasks assigned to this student yet")
              : "Select a student to see their tasks"}
          </small>
        </div>

        <div className="field">
          <label htmlFor="feedback-score" className="field-label">Score (0–100, optional)</label>
          <input
            id="feedback-score"
            name="feedback-score"
            type="number"
            min="0"
            max="100"
            placeholder="Score (optional)"
            value={form.score}
            onChange={(e) => updateField("score", e.target.value)}
            autoComplete="off"
            aria-invalid={!!fieldErrors.score}
          />
          {fieldErrors.score && <small className="field-error" role="alert">{fieldErrors.score}</small>}
        </div>

        <div className="field">
          <label htmlFor="feedback-strengths" className="field-label">Strengths</label>
          <input
            id="feedback-strengths"
            name="feedback-strengths"
            placeholder="Strengths (comma separated)"
            value={form.strengths}
            onChange={(e) => updateField("strengths", e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label htmlFor="feedback-improvements" className="field-label">Improvement areas</label>
          <input
            id="feedback-improvements"
            name="feedback-improvements"
            placeholder="Improvement areas (comma separated)"
            value={form.improvements}
            onChange={(e) => updateField("improvements", e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="field field-full">
          <label htmlFor="feedback-text" className="field-label">Feedback <span className="req">*</span></label>
          <textarea
            id="feedback-text"
            name="feedback-text"
            placeholder="Feedback"
            required
            rows={3}
            value={form.feedback}
            onChange={(e) => updateField("feedback", e.target.value)}
            autoComplete="off"
            aria-invalid={!!fieldErrors.feedback}
          />
          {fieldErrors.feedback && <small className="field-error" role="alert">{fieldErrors.feedback}</small>}
        </div>

        <div className="field field-full">
          <button className="gold-btn" type="submit" disabled={loading}>{loading ? "Saving…" : "Save Feedback"}</button>
        </div>
      </form>

      <div className="fb-toolbar">
        <input type="search" aria-label="Search feedback" placeholder="Search by student, task or feedback text…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        {search && <button type="button" onClick={() => setSearch("")}>Clear</button>}
        <button type="button" onClick={loadEntries} disabled={dataLoading}>{dataLoading ? "Loading…" : "Refresh"}</button>
      </div>

      {loadError && <div className="error-msg">{loadError}</div>}

      {dataLoading ? (
        <div className="empty-state">Loading feedback…</div>
      ) : grouped.length === 0 ? (
        <div className="empty-state">
          {entries.length === 0
            ? "No feedback has been recorded yet."
            : `No feedback matches "${search}".`}
        </div>
      ) : (
        <div className="fb-students">
          {grouped.map((g) => {
            const entryCount = [...g.tasks.values()].reduce((n, t) => n + t.entries.length, 0);
            return (
              <section className="panel fb-student perf-card" key={g.student.student_id}>
                <header className="fb-student-head">
                  <div>
                    <h3>{g.student.student_name || "Unknown student"}</h3>
                    <small>
                      ID: {g.student.student_code}
                      {g.student.student_email ? ` · ${g.student.student_email}` : ""}
                    </small>
                  </div>
                  {/* FIX C-9: proper pluralisation */}
                  <span className="fb-count" title="Feedback entries for this student">
                    {pluralise(entryCount, "entry")}
                  </span>
                </header>

                {[...g.tasks.values()]
                  .sort((a, b) => (a.task_day ?? 999) - (b.task_day ?? 999))
                  .map((t) => (
                    <article className="fb-task" key={t.task_id || "__general__"}>
                      <h4>
                        {t.task_day != null ? `Day ${String(t.task_day).padStart(2, "0")} · ` : ""}
                        {t.task_title}
                        {t.task_code ? <small> · {t.task_code}</small> : null}
                        {t.task_missing ? <span className="fb-warn">task record missing</span> : null}
                      </h4>
                      {t.entries.length === 0 ? (
                        <p className="fb-empty">No feedback for this task yet.</p>
                      ) : t.entries.map((e) => (
                        <div className="fb-entry" key={e.id}>
                          <p>{e.feedback}</p>
                          <div className="fb-meta">
                            {/* FIX C-11: show reviewer name or "—" */}
                            <span>{e.reviewer_name ? `By ${e.reviewer_name}` : "—"}</span>
                            <span>{fmtDate(e.created_at)}</span>
                            {e.updated_at && e.updated_at !== e.created_at && <span>Updated {fmtDate(e.updated_at)}</span>}
                            {e.score != null && <span className="fb-score">Score {e.score}</span>}
                            {/* Every entry was "recorded", so the chip said
                                RECORDED on every row and carried no
                                information. It now states the state that
                                actually varies: whether it was edited. */}
                            <span className={`fb-status ${e.updated_at && e.updated_at !== e.created_at ? "fb-status-updated" : ""}`}>
                              {e.updated_at && e.updated_at !== e.created_at ? "Updated" : "Recorded"}
                            </span>
                          </div>
                          {e.strengths && <div className="fb-line"><b>Strengths:</b> {e.strengths}</div>}
                          {e.improvements && <div className="fb-line"><b>Improvements:</b> {e.improvements}</div>}

                          {/* Actions appear only when the backend says this
                              user may make the change (admin/CEO always; a
                              manager only their own entries). */}
                          {(e.can_edit || e.can_delete) && (
                            <div className="fb-entry-actions">
                              {e.can_edit && (
                                <button type="button" className="fb-action" onClick={() => openEdit(e)}>Edit</button>
                              )}
                              {e.can_delete && (
                                <button type="button" className="fb-action fb-action-danger" onClick={() => openDelete(e)}>Delete</button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </article>
                  ))}
              </section>
            );
          })}
        </div>
      )}

      {/* ── Edit feedback ───────────────────────────────────────────────── */}
      <FixedOverlay
        open={Boolean(editing)}
        onClose={closeEdit}
        label="Edit feedback"
        panelClassName="fixed-overlay-panel fbd"
        zIndex={1000}
      >
        <div className="panel-head">
          <div>
            <span className="section-kicker">EDIT FEEDBACK</span>
            <h3>
              {editing?.student_name || "Student"}
              {editing?.student_code ? ` · ${editing.student_code}` : ""}
            </h3>
            <p>{editing?.task_title || "General feedback"}</p>
          </div>
          <button type="button" className="fbd-btn" onClick={closeEdit}>Close</button>
        </div>

        <div className="panel-body">
          <div className="fbd-provenance">
            Recorded by {editing?.reviewer_name || "an unknown reviewer"} on {fmtDate(editing?.created_at)}.
            {editing?.updated_at && editing.updated_at !== editing.created_at
              ? ` Last updated ${fmtDate(editing.updated_at)}.`
              : ""}
            {" "}The original reviewer and date are kept when you save.
          </div>

          <label className="fbd-label" htmlFor="fbd-feedback">Feedback <span className="fbd-req">required</span></label>
          <textarea
            id="fbd-feedback"
            className="fbd-input"
            rows={4}
            value={editForm.feedback}
            onChange={(e) => { setEditForm(f => ({ ...f, feedback: e.target.value })); setEditErrors(x => ({ ...x, feedback: "" })); }}
            aria-invalid={!!editErrors.feedback}
            data-autofocus
          />
          {editErrors.feedback && <small className="fbd-error" role="alert">{editErrors.feedback}</small>}

          <div className="fbd-grid">
            <div>
              <label className="fbd-label" htmlFor="fbd-score">Score (0–100)</label>
              <input
                id="fbd-score"
                className="fbd-input"
                type="number"
                min="0"
                max="100"
                value={editForm.score}
                onChange={(e) => { setEditForm(f => ({ ...f, score: e.target.value })); setEditErrors(x => ({ ...x, score: "" })); }}
                aria-invalid={!!editErrors.score}
              />
              {editErrors.score && <small className="fbd-error" role="alert">{editErrors.score}</small>}
            </div>
            <div>
              <label className="fbd-label" htmlFor="fbd-strengths">Strengths</label>
              <input
                id="fbd-strengths"
                className="fbd-input"
                placeholder="Comma separated"
                value={editForm.strengths}
                onChange={(e) => setEditForm(f => ({ ...f, strengths: e.target.value }))}
              />
            </div>
            <div>
              <label className="fbd-label" htmlFor="fbd-improvements">Improvement areas</label>
              <input
                id="fbd-improvements"
                className="fbd-input"
                placeholder="Comma separated"
                value={editForm.improvements}
                onChange={(e) => setEditForm(f => ({ ...f, improvements: e.target.value }))}
              />
            </div>
          </div>

          {editError && <div className="fbd-message fbd-message-error" role="alert">{editError}</div>}
        </div>

        <div className="panel-foot">
          <button type="button" className="fbd-btn" onClick={closeEdit} disabled={savingEdit}>Cancel</button>
          <button type="button" className="fbd-btn fbd-btn-primary" onClick={saveEdit} disabled={savingEdit}>
            {savingEdit ? "Saving…" : "Save changes"}
          </button>
        </div>
      </FixedOverlay>

      {/* ── Delete feedback ─────────────────────────────────────────────── */}
      <FixedOverlay
        open={Boolean(deleting)}
        onClose={closeDelete}
        label="Confirm delete feedback"
        panelClassName="fixed-overlay-panel fbd"
        zIndex={1200}
      >
        <div className="panel-head">
          <div>
            <span className="section-kicker">DELETE FEEDBACK</span>
            <h3>Delete this feedback entry?</h3>
          </div>
          <button type="button" className="fbd-btn" onClick={closeDelete}>Close</button>
        </div>

        <div className="panel-body">
          <dl className="fbd-target">
            <div><dt>Student</dt><dd>{deleting?.student_name || "—"}{deleting?.student_code ? ` (${deleting.student_code})` : ""}</dd></div>
            <div><dt>Task</dt><dd>{deleting?.task_title || "General feedback"}</dd></div>
            <div><dt>Recorded</dt><dd>{fmtDate(deleting?.created_at)}</dd></div>
            <div><dt>Reviewer</dt><dd>{deleting?.reviewer_name || "—"}</dd></div>
            <div className="fbd-target-snippet"><dt>Feedback</dt><dd>{snippet(deleting)}</dd></div>
          </dl>

          <p className="fbd-hint">
            Only this one entry is affected. The record is soft-deleted, so it disappears from the list but the
            audit trail keeps who removed it and when.
          </p>

          <label className="fbd-confirm-label" htmlFor="fbd-confirm">
            <input
              id="fbd-confirm"
              type="checkbox"
              checked={confirmDelete}
              onChange={(e) => setConfirmDelete(e.target.checked)}
            />
            I understand this will remove this feedback entry.
          </label>

          {deleteError && <div className="fbd-message fbd-message-error" role="alert">{deleteError}</div>}
        </div>

        <div className="panel-foot">
          <button type="button" className="fbd-btn" onClick={closeDelete}>Cancel</button>
          <button
            type="button"
            className="fbd-btn fbd-btn-danger"
            onClick={runDelete}
            disabled={!confirmDelete}
            title={!confirmDelete ? "Tick the confirmation box first" : undefined}
          >
            Delete feedback
          </button>
        </div>
      </FixedOverlay>
    </div>
  );
}
