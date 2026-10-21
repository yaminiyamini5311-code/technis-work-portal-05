import { useEffect, useState } from "react";

export default function NewProjectModal({ open, onClose, onAdd }) {
  const [form, setForm] = useState({ name: "", dueDate: "" });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setForm({ name: "", dueDate: "" });
  }, [open]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSubmitting(true);
    const project = {
      id: "p" + Date.now(),
      title: form.name.trim(),
      domain: "edutins",
      progress: 0,
      status: "Pending",
      updated: "Just now",
    };
    onAdd(project);
    setSubmitting(false);
    onClose();
  };

  if (!open) return null;

  return (
    <div className={`femly-modal-overlay ${open ? "femly-modal-overlay--show" : ""}`} onClick={onClose}>
      <div className={`femly-modal-dialog ${open ? "femly-modal-dialog--show" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="femly-modal-head">
          <span className="section-kicker">NEW PROJECT</span>
          <h3>Add project</h3>
          <button className="femly-btn femly-btn--secondary" onClick={onClose}>Cancel</button>
        </div>
        <form onSubmit={handleSubmit} className="femly-modal-body">
          <div className="field">
            <label className="field-label">Project name</label>
            <input
              name="name"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. EduTins Portal"
              required
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label className="field-label">Due date</label>
            <input
              name="dueDate"
              type="date"
              value={form.dueDate}
              onChange={e => setForm({ ...form, dueDate: e.target.value })}
            />
          </div>
          <button className="femly-btn femly-btn--primary" type="submit" disabled={submitting}>
            {submitting ? "Adding…" : "Add project"}
          </button>
        </form>
      </div>
    </div>
  );
}
