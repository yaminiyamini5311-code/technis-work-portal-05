import { useEffect, useState, useCallback } from "react";
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
  const [batches, setBatches] = useState([]);
  const [mode, setMode] = useState("individual"); // "individual" | "group"
  const [form, setForm] = useState({ title: "", description: "", assigned_to: "", batch_id: "", due_date: "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [groupPreview, setGroupPreview] = useState(null); // { total, alreadyAssigned, newAssignments }

  const authHeaders = () => ({
    Authorization: `Bearer ${localStorage.getItem("token")}`,
  });

  const load = async () => {
    try {
      setLoadError("");
      const [a, b, c] = await Promise.all([
        fetch(`${API_URL}/api/missions`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/students`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/batches`, { headers: authHeaders() }),
      ]);
      const ad = await a.json().catch(() => ({}));
      const bd = await b.json().catch(() => ({}));
      const cd = await c.json().catch(() => ({}));
      if (!a.ok) throw new Error(ad.message || "Unable to load missions");
      setMissions(ad.missions || []);
      setStudents(bd.students || []);
      setBatches(cd.batches || []);
    } catch (e) {
      setLoadError(e.message || "Unable to load missions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Compute group preview when batch is selected
  const computeGroupPreview = useCallback((batchId) => {
    if (!batchId) { setGroupPreview(null); return; }
    const batchStudents = students.filter(s => String(s.batch_id) === String(batchId));
    if (batchStudents.length === 0) {
      setGroupPreview({ total: 0, alreadyAssigned: 0, newAssignments: 0, empty: true });
      return;
    }
    // Check which students already have this mission (by title match since missions don't have batch_id)
    const existingTitles = new Set(missions.map(m => m.title.toLowerCase()));
    const alreadyAssigned = batchStudents.filter(s => existingTitles.has(form.title.trim().toLowerCase())).length;
    setGroupPreview({
      total: batchStudents.length,
      alreadyAssigned,
      newAssignments: batchStudents.length - alreadyAssigned,
      empty: false,
    });
  }, [students, missions, form.title]);

  const updateField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((e) => ({ ...e, [key]: "" }));
    setServerError("");
    setSuccessMsg("");
    if (key === "batch_id") {
      computeGroupPreview(value);
    }
  };

  const switchMode = (newMode) => {
    setMode(newMode);
    setForm((f) => ({ ...f, assigned_to: "", batch_id: "" }));
    setFieldErrors({});
    setServerError("");
    setSuccessMsg("");
    setGroupPreview(null);
  };

  const validate = () => {
    const errs = {};
    if (!form.title.trim()) errs.title = "Mission title is required";
    if (mode === "individual" && !form.assigned_to) errs.assigned_to = "Please select a student";
    if (mode === "group" && !form.batch_id) errs.batch_id = "Please select a batch";
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
      const payload = {
        title: form.title.trim(),
        description: form.description.trim(),
        due_date: form.due_date || undefined,
      };
      let url = `${API_URL}/api/missions`;
      if (mode === "individual") {
        payload.assigned_to = form.assigned_to;
      } else {
        payload.batch_id = form.batch_id;
      }
      const r = await fetch(url, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setServerError(d.message || "Unable to create mission");
        return;
      }
      if (mode === "group") {
        setSuccessMsg(`Mission assigned to ${d.assigned_count || "all"} student(s) in batch.`);
      } else {
        setSuccessMsg("Mission created successfully.");
      }
      setForm({ title: "", description: "", assigned_to: "", batch_id: "", due_date: "" });
      setFieldErrors({});
      setGroupPreview(null);
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
        <p>Create missions and assign to students individually or by batch.</p>
      </div>

      {serverError && <div className="error-msg" role="alert">{serverError}</div>}
      {successMsg && <div className="success-msg" role="status">{successMsg}</div>}

      {/* Assignment Mode Selector */}
      <div className="mission-mode-selector">
        <button
          type="button"
          className={`mode-btn ${mode === "individual" ? "active" : ""}`}
          onClick={() => switchMode("individual")}
        >
          <TechinsIcon name="user" size={16} variant="dark" />
          Individual Student
        </button>
        <button
          type="button"
          className={`mode-btn ${mode === "group" ? "active" : ""}`}
          onClick={() => switchMode("group")}
        >
          <TechinsIcon name="users" size={16} variant="dark" />
          Group / Batch
        </button>
      </div>

      <form className="panel form-grid-admin" onSubmit={create} noValidate>
        <div className="field field-full">
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

        {mode === "individual" ? (
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
        ) : (
          <div className="field">
            <label className="field-label" htmlFor="mission-batch">Select Batch <span className="req">*</span></label>
            <select
              id="mission-batch"
              name="mission-batch"
              value={form.batch_id}
              onChange={(e) => updateField("batch_id", e.target.value)}
              required
              aria-invalid={!!fieldErrors.batch_id}
              aria-describedby={fieldErrors.batch_id ? "mission-batch-error" : undefined}
            >
              <option value="">Select batch</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            {fieldErrors.batch_id && <small className="field-error" id="mission-batch-error" role="alert">{fieldErrors.batch_id}</small>}
          </div>
        )}

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

        {/* Group assignment confirmation summary */}
        {mode === "group" && groupPreview && (
          <div className="field field-full">
            <div className="group-preview">
              {groupPreview.empty ? (
                <p className="group-preview-warning">No active students in this batch.</p>
              ) : (
                <>
                  <p><strong>Assignment Summary:</strong></p>
                  <ul>
                    <li>Batch: <strong>{batches.find(b => b.id === form.batch_id)?.name || "Unknown"}</strong></li>
                    <li>Total students in batch: <strong>{groupPreview.total}</strong></li>
                    <li>Already have this mission: <strong>{groupPreview.alreadyAssigned}</strong> (will be skipped)</li>
                    <li>New assignments: <strong>{groupPreview.newAssignments}</strong></li>
                  </ul>
                </>
              )}
            </div>
          </div>
        )}

        <div className="field field-full">
          <button className="gold-btn" type="submit" disabled={submitting}>
            {submitting ? "Creating…" : mode === "group" ? "Assign to Batch" : "Create Mission"}
          </button>
        </div>
      </form>

      {loadError && <div className="error-msg" role="alert">{loadError}</div>}

      {/* Missions list */}
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
