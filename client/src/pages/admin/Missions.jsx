import { useEffect, useState, useCallback, useMemo } from "react";
import TechinsIcon from "../../components/TechinsIcon";
import FixedOverlay from "../../components/FixedOverlay";
import { apiFetch, taskTitle } from "../../utils/api";
import { formatISTDateTime } from "../../utils/dateHelper";
import "../../styles/admin.css";
import "./Missions.css";

/**
 * Mission control.
 *
 * Scheduling: both forms now carry a real window — start date + start time and
 * end date + end time — instead of a single due date. The browser sends the
 * minutes its clock is ahead of UTC, so a mission entered in IST is stored as
 * the same instant in UTC and read back in IST for everybody. The server
 * validates `end > start` on both create and edit and is the authority.
 *
 * "All Missions" is a real list: title, assignee or batch, start, end,
 * description, status and a detail view, with an edit action that updates the
 * same mission (never creating a second one).
 */

const dash = (v) => (v === null || v === undefined || v === "" ? "—" : v);

const EMPTY_FORM = {
  title: "", description: "", assigned_to: "", batch_id: "",
  start_date: "", start_time: "", end_date: "", end_time: "",
};

/** Minutes the browser's clock is ahead of UTC right now. */
function localOffsetMinutes() {
  return -new Date().getTimezoneOffset();
}

const SCHEDULE_LABEL = {
  upcoming: "Scheduled",
  active: "In progress window",
  overdue: "Past deadline",
  completed: "Completed",
};

export default function Missions() {
  const [missions, setMissions] = useState([]);
  const [students, setStudents] = useState([]);
  const [batches, setBatches] = useState([]);
  const [mode, setMode] = useState("individual");
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [groupPreview, setGroupPreview] = useState(null);
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoadError("");
      const [m, s, b] = await Promise.all([
        apiFetch("/api/missions"),
        fetch(`${import.meta.env.VITE_API_URL || "http://localhost:5000"}/api/students`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }).then(r => r.json()).catch(() => ({})),
        fetch(`${import.meta.env.VITE_API_URL || "http://localhost:5000"}/api/batches`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }).then(r => r.json()).catch(() => ({})),
      ]);
      setMissions(m?.data?.missions ?? m?.missions ?? []);
      setStudents(s.students || []);
      setBatches(b.batches || []);
    } catch (e) {
      setLoadError(e.message || "Unable to load missions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const computeGroupPreview = useCallback((batchId) => {
    if (!batchId) { setGroupPreview(null); return; }
    const batchStudents = students.filter(s => String(s.batch_id) === String(batchId));
    if (batchStudents.length === 0) {
      setGroupPreview({ total: 0, alreadyAssigned: 0, newAssignments: 0, empty: true });
      return;
    }
    const title = form.title.trim().toLowerCase();
    const existingTitles = new Set(missions.map(m => String(m.title || "").toLowerCase()));
    const alreadyAssigned = title && existingTitles.has(title) ? batchStudents.length : 0;
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
    if (key === "batch_id") computeGroupPreview(value);
  };

  const switchMode = (newMode) => {
    setMode(newMode);
    setForm((f) => ({ ...f, assigned_to: "", batch_id: "" }));
    setFieldErrors({});
    setServerError("");
    setSuccessMsg("");
    setGroupPreview(null);
  };

  /** end > start, checked client-side so the message is instant; the server repeats it. */
  const validate = () => {
    const errs = {};
    if (!form.title.trim()) errs.title = "Mission title is required";
    if (mode === "individual" && !form.assigned_to) errs.assigned_to = "Please select a student";
    if (mode === "group" && !form.batch_id) errs.batch_id = "Please select a batch";
    if (!form.start_date) errs.start_date = "Start date is required";
    if (!form.start_time) errs.start_time = "Start time is required";
    if (!form.end_date) errs.end_date = "End date is required";
    if (!form.end_time) errs.end_time = "End time is required";
    if (form.start_date && form.start_time && form.end_date && form.end_time) {
      const start = new Date(`${form.start_date}T${form.start_time}`);
      const end = new Date(`${form.end_date}T${form.end_time}`);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        errs.end_date = "Enter a valid date and time";
      } else if (end <= start) {
        errs.end_date = "The end date and time must be after the start date and time";
      }
    }
    return errs;
  };

  const schedulePayload = () => ({
    start_date: form.start_date,
    start_time: form.start_time,
    end_date: form.end_date,
    end_time: form.end_time,
    offset_minutes: localOffsetMinutes(),
  });

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
        ...schedulePayload(),
        ...(mode === "individual" ? { assigned_to: form.assigned_to } : { batch_id: form.batch_id }),
      };
      const res = await apiFetch("/api/missions", { method: "POST", body: payload });
      const data = res?.data ?? res;
      setSuccessMsg(
        mode === "group"
          ? `Mission assigned to ${data?.assigned_count ?? "all"} student(s) in batch.`
          : "Mission created successfully.",
      );
      setForm(EMPTY_FORM);
      setFieldErrors({});
      setGroupPreview(null);
      await load();
    } catch (err) {
      setServerError(err.message || "Unable to create mission");
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (mission) => {
    setEditing(mission);
    setEditError("");
    const start = mission.start_at ? new Date(mission.start_at) : null;
    const end = mission.end_at ? new Date(mission.end_at) : null;
    const pad = (n) => String(n).padStart(2, "0");
    const localInput = (d) => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : "");
    const localTime = (d) => (d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : "");
    setEditForm({
      title: mission.title || "",
      description: mission.description || "",
      start_date: localInput(start),
      start_time: localTime(start),
      end_date: localInput(end),
      end_time: localTime(end),
    });
  };

  const saveEdit = async () => {
    if (!editing || savingEdit) return;
    setSavingEdit(true);
    setEditError("");
    try {
      // Updates the SAME mission — the backend never inserts a second one.
      const res = await apiFetch(`/api/missions/${encodeURIComponent(editing.id)}`, {
        method: "PUT",
        body: {
          title: editForm.title.trim(),
          description: editForm.description.trim(),
          start_date: editForm.start_date,
          start_time: editForm.start_time,
          end_date: editForm.end_date,
          end_time: editForm.end_time,
          offset_minutes: localOffsetMinutes(),
        },
      });
      const data = res?.data ?? res;
      setSuccessMsg(data?.message || "Mission updated.");
      setEditing(null);
      setEditForm(null);
      await load();
    } catch (err) {
      setEditError(err.message || "Unable to update mission");
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteMission = async (id) => {
    try {
      await apiFetch(`/api/missions/${encodeURIComponent(id)}`, { method: "DELETE" });
      setSuccessMsg("Mission deleted.");
      await load();
    } catch (err) {
      setLoadError(err.message || "Unable to delete mission");
    }
  };

  const byBatch = useMemo(() => {
    const map = new Map();
    for (const m of missions) {
      const key = m.batch_id || "individual";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(m);
    }
    return map;
  }, [missions]);

  const startField = (
    dateKey, timeKey, dateId, timeId, label
  ) => (
    <>
      <div className="field">
        <label className="field-label" htmlFor={dateId}>{label} Date <span className="req">*</span></label>
        <input
          id={dateId}
          type="date"
          value={form[dateKey]}
          onChange={(e) => updateField(dateKey, e.target.value)}
          required
          aria-invalid={!!fieldErrors[dateKey]}
          aria-describedby={fieldErrors[dateKey] ? `${dateId}-error` : undefined}
        />
        {fieldErrors[dateKey] && <small className="field-error" id={`${dateId}-error`} role="alert">{fieldErrors[dateKey]}</small>}
      </div>
      <div className="field">
        <label className="field-label" htmlFor={timeId}>{label} Time <span className="req">*</span></label>
        <input
          id={timeId}
          type="time"
          value={form[timeKey]}
          onChange={(e) => updateField(timeKey, e.target.value)}
          required
          aria-invalid={!!fieldErrors[timeKey]}
          aria-describedby={fieldErrors[timeKey] ? `${timeId}-error` : undefined}
        />
        {fieldErrors[timeKey] && <small className="field-error" id={`${timeId}-error`} role="alert">{fieldErrors[timeKey]}</small>}
      </div>
    </>
  );

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
        <p>Create missions with a real schedule and assign them to students individually or by batch.</p>
      </div>

      {serverError && <div className="error-msg" role="alert">{serverError}</div>}
      {successMsg && <div className="success-msg" role="status">{successMsg}</div>}
      {loadError && <div className="error-msg" role="alert">{loadError}</div>}

      <div className="mission-mode-selector" role="tablist" aria-label="Assignment mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "individual"}
          className={`mode-btn ${mode === "individual" ? "active" : ""}`}
          onClick={() => switchMode("individual")}
        >
          <TechinsIcon name="user" size={16} variant="dark" />
          Individual Student
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "group"}
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
            <label className="field-label" htmlFor="mission-student">Select student <span className="req">*</span></label>
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
              {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {fieldErrors.assigned_to && <small className="field-error" id="mission-student-error" role="alert">{fieldErrors.assigned_to}</small>}
          </div>
        ) : (
          <div className="field">
            <label className="field-label" htmlFor="mission-batch">Select batch <span className="req">*</span></label>
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
              {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {fieldErrors.batch_id && <small className="field-error" id="mission-batch-error" role="alert">{fieldErrors.batch_id}</small>}
          </div>
        )}

        {startField("start_date", "start_time", "mission-start-date", "mission-start-time", "Start")}
        {startField("end_date", "end_time", "mission-end-date", "mission-end-time", "End")}

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

      {/* All Missions */}
      <section className="panel">
        <div className="panel-head">
          <div>
            <span className="section-kicker">ALL MISSIONS</span>
            <h3>{missions.length} mission{missions.length === 1 ? "" : "s"}</h3>
          </div>
          <button type="button" onClick={load}>Refresh</button>
        </div>

        {missions.length === 0 ? (
          <div className="empty-state">No missions yet. Create your first mission above.</div>
        ) : (
          <div className="missions-grid">
            {missions.map((m) => (
              <article className="panel mission-card" key={m.id}>
                <div className="mission-card-head">
                  <div>
                    <h4>{taskTitle(m.title) || "Untitled Mission"}</h4>
                    <small>Assigned to: {m.student_name || "Unknown"}{m.student_code ? ` (${m.student_code})` : ""}</small>
                    {m.batch_name && <small>Batch: {m.batch_name}</small>}
                  </div>
                  <span className={`mission-status ${(m.status || "assigned").toLowerCase()}`}>
                    {(m.status || "assigned").replace(/_/g, " ")}
                  </span>
                </div>

                <dl className="mission-schedule">
                  <div><dt>Starts</dt><dd>{m.start_at ? formatISTDateTime(m.start_at) : "—"}</dd></div>
                  <div><dt>Ends</dt><dd>{m.end_at ? formatISTDateTime(m.end_at) : "—"}</dd></div>
                  <div>
                    <dt>Schedule</dt>
                    <dd>
                      <span className={`mission-schedule-state ${m.schedule_status || "scheduled"}`}>
                        {SCHEDULE_LABEL[m.schedule_status] || m.schedule_status || "Scheduled"}
                      </span>
                    </dd>
                  </div>
                </dl>

                {m.description && <p className="mission-description">{taskTitle(m.description)}</p>}

                <div className="mission-progress">
                  <div className="admin-progress"><i style={{ width: `${Math.min(100, Number(m.progress || 0))}%` }} /></div>
                  <span>{Math.min(100, Number(m.progress || 0))}%</span>
                </div>

                <div className="mission-card-actions">
                  <button type="button" className="link-button" onClick={() => setDetail(m)}>View details</button>
                  <button type="button" className="link-button" onClick={() => openEdit(m)}>Edit</button>
                  <button type="button" className="link-button mission-delete" onClick={() => deleteMission(m.id)}>Delete</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Detail view */}
      <FixedOverlay
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        label="Mission details"
        panelClassName="fixed-overlay-panel ms-dialog"
        zIndex={1000}
      >
        <div className="panel-head">
          <div>
            <span className="section-kicker">MISSION DETAILS</span>
            <h3>{taskTitle(detail?.title) || "Mission"}</h3>
          </div>
          <button type="button" className="ms-btn" onClick={() => setDetail(null)}>Close</button>
        </div>
        <div className="panel-body">
          <dl className="sdd-grid">
            <div className="sdd-field"><span className="sdd-label">Assigned to</span><span className="sdd-value">{dash(detail?.student_name)}{detail?.student_code ? ` (${detail.student_code})` : ""}</span></div>
            <div className="sdd-field"><span className="sdd-label">Batch</span><span className="sdd-value">{dash(detail?.batch_name)}</span></div>
            <div className="sdd-field"><span className="sdd-label">Starts</span><span className="sdd-value">{detail?.start_at ? formatISTDateTime(detail.start_at) : "—"}</span></div>
            <div className="sdd-field"><span className="sdd-label">Ends</span><span className="sdd-value">{detail?.end_at ? formatISTDateTime(detail.end_at) : "—"}</span></div>
            <div className="sdd-field"><span className="sdd-label">Status</span><span className="sdd-value">{(detail?.status || "assigned").replace(/_/g, " ")}</span></div>
            <div className="sdd-field"><span className="sdd-label">Progress</span><span className="sdd-value">{Math.min(100, Number(detail?.progress || 0))}%</span></div>
          </dl>
          <div>
            <span className="sdd-label">Description</span>
            {detail?.description
              ? <p className="sdd-comment">{taskTitle(detail.description)}</p>
              : <p className="sdd-empty">No description was provided.</p>}
          </div>
        </div>
        <div className="panel-foot">
          <button
            type="button"
            className="ms-btn"
            onClick={() => { openEdit(detail); setDetail(null); }}
          >
            Edit schedule
          </button>
          <button type="button" className="ms-btn" onClick={() => setDetail(null)}>Close</button>
        </div>
      </FixedOverlay>

      {/* Edit schedule — updates the same mission */}
      <FixedOverlay
        open={Boolean(editing)}
        onClose={() => { setEditing(null); setEditForm(null); setEditError(""); }}
        label="Edit mission schedule"
        panelClassName="fixed-overlay-panel ms-dialog"
        zIndex={1200}
      >
        <div className="panel-head">
          <div>
            <span className="section-kicker">EDIT MISSION</span>
            <h3>{taskTitle(editing?.title) || "Mission"}</h3>
          </div>
          <button type="button" className="ms-btn" onClick={() => { setEditing(null); setEditForm(null); }}>Close</button>
        </div>

        {editForm && (
          <>
            <div className="panel-body">
              <label className="ms-label" htmlFor="ms-edit-title">Mission Title <span className="req">*</span></label>
              <input id="ms-edit-title" className="ms-input" value={editForm.title} onChange={(e) => setEditForm(f => ({ ...f, title: e.target.value }))} />

              <div className="ms-grid">
                <div>
                  <label className="ms-label" htmlFor="ms-edit-start-date">Start Date <span className="req">*</span></label>
                  <input id="ms-edit-start-date" className="ms-input" type="date" value={editForm.start_date} onChange={(e) => setEditForm(f => ({ ...f, start_date: e.target.value }))} />
                </div>
                <div>
                  <label className="ms-label" htmlFor="ms-edit-start-time">Start Time <span className="req">*</span></label>
                  <input id="ms-edit-start-time" className="ms-input" type="time" value={editForm.start_time} onChange={(e) => setEditForm(f => ({ ...f, start_time: e.target.value }))} />
                </div>
                <div>
                  <label className="ms-label" htmlFor="ms-edit-end-date">End Date <span className="req">*</span></label>
                  <input id="ms-edit-end-date" className="ms-input" type="date" value={editForm.end_date} onChange={(e) => setEditForm(f => ({ ...f, end_date: e.target.value }))} />
                </div>
                <div>
                  <label className="ms-label" htmlFor="ms-edit-end-time">End Time <span className="req">*</span></label>
                  <input id="ms-edit-end-time" className="ms-input" type="time" value={editForm.end_time} onChange={(e) => setEditForm(f => ({ ...f, end_time: e.target.value }))} />
                </div>
              </div>

              <label className="ms-label" htmlFor="ms-edit-description">Description</label>
              <textarea id="ms-edit-description" className="ms-input" rows={3} value={editForm.description} onChange={(e) => setEditForm(f => ({ ...f, description: e.target.value }))} />

              <p className="ms-hint">
                Moving the start or end notifies the affected student — once per new schedule, never twice for the
                same one.
              </p>
              {editError && <div className="sdd-message sdd-message-error" role="alert">{editError}</div>}
            </div>
            <div className="panel-foot">
              <button type="button" className="ms-btn" onClick={() => { setEditing(null); setEditForm(null); }} disabled={savingEdit}>Cancel</button>
              <button type="button" className="ms-btn ms-btn-primary" onClick={saveEdit} disabled={savingEdit}>
                {savingEdit ? "Saving…" : "Save changes"}
              </button>
            </div>
          </>
        )}
      </FixedOverlay>
    </div>
  );
}