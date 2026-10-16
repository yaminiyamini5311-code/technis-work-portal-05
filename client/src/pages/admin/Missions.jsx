import { useEffect, useState } from "react";
import TechinsIcon from "../../components/TechinsIcon";
import "../../styles/admin.css";
import "./Missions.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

function fmtDate(value) {
  if (!value) return "—";
  try { return new Date(value).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }); } catch { return String(value); }
}

export default function Missions() {
  const [missions, setMissions] = useState([]);
  const [students, setStudents] = useState([]);
  const [form, setForm] = useState({ title: "", description: "", assigned_to: "", due_date: "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState("");

  const authHeaders = () => ({
    Authorization: `Bearer ${localStorage.getItem("token")}`,
  });

  const load = async () => {
    try {
      setLoadError("");
      const [a, b] = await Promise.all([
        fetch(`${API_URL}/api/missions`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/students`, { headers: authHeaders() }),
      ]);
      const ad = await a.json().catch(() => ({}));
      const bd = await b.json().catch(() => ({}));
      if (!a.ok) throw new Error(ad.message || "Unable to load missions");
      setMissions(ad.missions || []);
      setStudents(bd.students || []);
    } catch (e) {
      setLoadError(e.message || "Unable to load missions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Clear field errors when the user edits a field
  const updateField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((e) => ({ ...e, [key]: "" }));
    setServerError("");
    setSuccessMsg("");
  };

  const validate = () => {
    const errs = {};
    if (!form.title.trim()) errs.title = "Mission title is required";
    if (!form.assigned_to) errs.assigned_to = "Please select a student";
    return errs;
  };

  const create = async (e) => {
    e.preventDefault();
    if (submitting) return;
    const errs = validate();
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      setServerError("");
      return;
    }
    setServerError("");
    setSuccessMsg("");
    setSubmitting(true);
    try {
      const r = await fetch(`${API_URL}/api/missions`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        // FIX C-1/C-2: send assigned_to as the raw string ObjectId, NOT Number()
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          assigned_to: form.assigned_to,
          due_date: form.due_date || undefined,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setServerError(d.message || "Unable to create mission");
        return;
      }
      setSuccessMsg("Mission created successfully.");
      setForm({ title: "", description: "", assigned_to: "", due_date: "" });
      setFieldErrors({});
      await load();
    } catch (err) {
      setServerError("An error occurred while creating the mission");
    } finally {
      setSubmitting(false);
    }
  };

  const deleteMission = async (id) => {
    if (!confirm("Delete this mission?")) return;
    try {
      const r = await fetch(`${API_URL}/api/missions/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (r.ok) load();
    } catch { /* ignore */ }
  };

  if (loading) {
    return (
      <div className="admin-simple page-enter">
        <div className="simple-head">
          <span>MISSION CONTROL</span>
          <h2>Missions</h2>
          <p>Loading missions…</p>
        </div>
        <div className="empty-state">Loading…</div>
      </div>
    );
  }

  return (
    <div className="admin-simple page-enter">
      <div className="simple-head">
        <span>MISSION CONTROL</span>
        <h2>Missions</h2>
        <p>Create missions and track progress.</p>
      </div>

      {/* FIX C-6: server error shown separately, only after submit */}
      {serverError && <div className="error-msg" role="alert">{serverError}</div>}
      {successMsg && <div className="success-msg" role="status">{successMsg}</div>}

      <form className="panel form-grid-admin" onSubmit={create} noValidate>
        {/* FIX C-3: proper dark input styling via .field input */}
        <div className="field">
          <label className="field-label" htmlFor="mission-title">Mission Title <span className="req">*</span></label>
          <input
            id="mission-title"
            name="mission-title"
            placeholder="Mission title"
            value={form.title}
            onChange={(e) => updateField("title", e.target.value)}
            required
            aria-invalid={!!fieldErrors.title}
            aria-describedby={fieldErrors.title ? "mission-title-error" : undefined}
          />
          {fieldErrors.title && <small className="field-error" id="mission-title-error" role="alert">{fieldErrors.title}</small>}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="mission-student">Assign Student <span className="req">*</span></label>
          <select
            id="mission-student"
            name="mission-student"
            value={form.assigned_to}
            onChange={(e) => updateField("assigned_to", e.target.value)}
            required
            aria-invalid={!!fieldErrors.assigned_to}
            aria-describedby={fieldErrors.assigned_to ? "mission-student-error" : undefined}
          >
            <option value="">Select student</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {fieldErrors.assigned_to && <small className="field-error" id="mission-student-error" role="alert">{fieldErrors.assigned_to}</small>}
        </div>

        <div className="field">
          <label className="field-label" htmlFor="mission-due-date">Due Date</label>
          <input
            id="mission-due-date"
            name="mission-due-date"
            type="date"
            value={form.due_date}
            onChange={(e) => updateField("due_date", e.target.value)}
          />
        </div>

        <div className="field field-full">
          <label className="field-label" htmlFor="mission-description">Description</label>
          <textarea
            id="mission-description"
            name="mission-description"
            placeholder="Describe the mission…"
            rows={3}
            value={form.description}
            onChange={(e) => updateField("description", e.target.value)}
          />
        </div>

        {/* FIX C-4: proper gold-btn with focus-visible style */}
        <div className="field field-full">
          <button className="gold-btn" type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create Mission"}
          </button>
        </div>
      </form>

      {loadError && <div className="error-msg" role="alert">{loadError}</div>}

      {/* FIX C-5: show missions list */}
      <div className="missions-list">
        <h3 style={{ margin: "24px 0 12px", fontSize: 18, fontWeight: 700 }}>All Missions</h3>
        {missions.length === 0 ? (
          <div className="empty-state">No missions yet. Create your first mission above.</div>
        ) : (
          <div className="missions-grid">
            {missions.map((m) => (
              <div className="panel mission-card" key={m.id}>
                <div className="mission-card-head">
                  <div>
                    <h4>{m.title || "Untitled Mission"}</h4>
                    <small>Assigned to: {m.student_name || "Unknown"}</small>
                    {m.due_date && <small>Due: {fmtDate(m.due_date)}</small>}
                  </div>
                  <span className={`mission-status ${(m.status || "assigned").toLowerCase()}`}>
                    {(m.status || "assigned").replace(/_/g, " ")}
                  </span>
                </div>
                {m.description && <p>{m.description}</p>}
                <div className="mission-progress">
                  <div className="admin-progress"><i style={{ width: `${Math.min(100, Number(m.progress || 0))}%` }} /></div>
                  <span>{Math.min(100, Number(m.progress || 0))}%</span>
                </div>
                <button className="link-button" onClick={() => deleteMission(m.id)}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
