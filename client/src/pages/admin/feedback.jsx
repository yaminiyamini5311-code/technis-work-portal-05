import { useCallback, useEffect, useMemo, useState } from "react";
import "../../styles/admin.css";
import "./feedback.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

function fmtDate(value) {
  if (!value) return "—";
  try { return new Date(value).toLocaleString(); } catch { return String(value); }
}

export default function Feedback() {
  const [students, setStudents] = useState([]);
  const [studentTasks, setStudentTasks] = useState([]);
  const [entries, setEntries] = useState([]);
  const [form, setForm] = useState({ user_id: "", task_id: "", score: "", feedback: "", strengths: "", improvements: "" });
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Headers are built INSIDE each callback (like AdminDashboard.load) so the
  // token is read fresh on every request while the callbacks keep a stable
  // identity — otherwise useEffect would re-run on every render.
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

  // Tasks are ALWAYS derived from the selected student's own assignments
  // (task_assignments), so feedback can never be filed against a task the
  // student was not assigned.
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
  // task_id are kept under a clearly-labelled "Unassigned task" group.
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
      const tKey = e.task_id || "__unassigned__";
      if (!student.tasks.has(tKey)) {
        student.tasks.set(tKey, {
          task_id: e.task_id,
          task_code: e.task_code,
          task_title: e.task_title || (e.task_id ? "Removed task" : "Unassigned task"),
          task_day: e.task_day,
          task_missing: e.task_missing,
          entries: [],
        });
      }
      student.tasks.get(tKey).entries.push(e);
    }
    return [...byStudent.values()].sort((a, b) => String(a.student.student_name || "").localeCompare(String(b.student.student_name || "")));
  }, [entries, search]);

  const submit = async (ev) => {
    ev.preventDefault();
    if (loading) return;
    if (!form.user_id) return setMessage("Select a student");
    if (!form.feedback.trim()) return setMessage("Feedback text is required");
    setMessage("");
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
      setMessage(r.ok ? "Feedback saved." : d.message || "Unable to save feedback");
      if (r.ok) {
        setForm({ user_id: "", task_id: "", score: "", feedback: "", strengths: "", improvements: "" });
        await loadEntries();
      }
    } catch (err) {
      setMessage("An error occurred while saving feedback");
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

      {message && (
        <div className={message.startsWith("Feedback") ? "success-msg" : "error-msg"}>{message}</div>
      )}

      <form className="panel form-grid-admin" onSubmit={submit} autoComplete="off">
        <div className="field">
          <label htmlFor="feedback-student" className="field-label">Student <span className="req">*</span></label>
          <select id="feedback-student" name="feedback-student" value={form.user_id} required autoComplete="off"
            onChange={(e) => setForm({ ...form, user_id: e.target.value, task_id: "", score: "" })}>
            <option value="">Select student</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div className="field">
          <label htmlFor="feedback-task" className="field-label">Task (optional)</label>
          <select id="feedback-task" name="feedback-task" value={form.task_id} disabled={!form.user_id} autoComplete="off"
            onChange={(e) => setForm({ ...form, task_id: e.target.value })}>
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
          <input id="feedback-score" name="feedback-score" type="number" min="0" max="100" placeholder="Score (optional)"
            value={form.score} onChange={(e) => setForm({ ...form, score: e.target.value })} autoComplete="off" />
        </div>

        <div className="field">
          <label htmlFor="feedback-strengths" className="field-label">Strengths</label>
          <input id="feedback-strengths" name="feedback-strengths" placeholder="Strengths (comma separated)"
            value={form.strengths} onChange={(e) => setForm({ ...form, strengths: e.target.value })} autoComplete="off" />
        </div>

        <div className="field">
          <label htmlFor="feedback-improvements" className="field-label">Improvement areas</label>
          <input id="feedback-improvements" name="feedback-improvements" placeholder="Improvement areas (comma separated)"
            value={form.improvements} onChange={(e) => setForm({ ...form, improvements: e.target.value })} autoComplete="off" />
        </div>

        <div className="field">
          <label htmlFor="feedback-text" className="field-label">Feedback <span className="req">*</span></label>
          <textarea id="feedback-text" name="feedback-text" placeholder="Feedback" required
            value={form.feedback} onChange={(e) => setForm({ ...form, feedback: e.target.value })} autoComplete="off" />
        </div>

        <button className="gold-btn" type="submit" disabled={loading}>{loading ? "Saving…" : "Save Feedback"}</button>
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
            : `No feedback matches “${search}”.`}
        </div>
      ) : (
        <div className="fb-students">
          {grouped.map((g) => (
            <section className="panel fb-student" key={g.student.student_id}>
              <header className="fb-student-head">
                <div>
                  <h3>{g.student.student_name || "Unknown student"}</h3>
                  <small>
                    ID: {g.student.student_code}
                    {g.student.student_email ? ` · ${g.student.student_email}` : ""}
                  </small>
                </div>
              </header>

              {[...g.tasks.values()]
                .sort((a, b) => (a.task_day ?? 999) - (b.task_day ?? 999))
                .map((t) => (
                  <article className="fb-task" key={t.task_id || "__unassigned__"}>
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
                          <span>{e.reviewer_name ? `By ${e.reviewer_name}` : "Reviewer unknown"}</span>
                          <span>{fmtDate(e.created_at)}</span>
                          {e.updated_at && e.updated_at !== e.created_at && <span>Updated {fmtDate(e.updated_at)}</span>}
                          {e.score != null && <span className="fb-score">Score {e.score}</span>}
                          <span className="fb-status">{e.status}</span>
                        </div>
                        {e.strengths && <div className="fb-line"><b>Strengths:</b> {e.strengths}</div>}
                        {e.improvements && <div className="fb-line"><b>Improvements:</b> {e.improvements}</div>}
                      </div>
                    ))}
                  </article>
                ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}