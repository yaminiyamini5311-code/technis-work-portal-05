import { useEffect, useState, useCallback } from "react";
import useModalBehavior from "../../components/useModalBehavior";
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

function fmtDate(value) {
  if (!value) return "—";
  try { return new Date(value).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }); } catch { return String(value); }
}

export default function Students() {
  const [students, setStudents] = useState([]);
  const [total, setTotal] = useState(0);
  const [maxStudents, setMaxStudents] = useState(100);
  const [search, setSearch] = useState("");
  const [batchFilter, setBatchFilter] = useState("");
  const [batches, setBatches] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [batchTarget, setBatchTarget] = useState(null);
  // Section 3: Three actions state
  const [detailsTarget, setDetailsTarget] = useState(null);
  const [detailsData, setDetailsData] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [requirementTarget, setRequirementTarget] = useState(null);
  const [requirementDesc, setRequirementDesc] = useState("");
  const [requirementError, setRequirementError] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ page, limit: 10 });
      if (search.trim()) params.set("search", search.trim());
      if (batchFilter) params.set("batch", batchFilter);
      const res = await fetch(`${API_URL}/api/admin/students?${params}`, { headers: auth() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Unable to load students");
      setStudents(data.students || []);
      setTotal(data.total || 0);
      setMaxStudents(data.limit || 100);
      setTotalPages(data.total_pages || 1);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, search, batchFilter]);

  const loadBatches = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/batches`, { headers: auth() });
      const data = await res.json();
      setBatches(data.batches || []);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { loadBatches(); }, [loadBatches]);
  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setMsg("");
    setError("");
    setSubmitting(true);
    const form = e.target;
    const name = form.studentName.value.trim();
    const email = form.studentEmail.value.trim();
    const password = form.studentPassword.value;
    const batchId = form.studentBatch.value;
    if (!name || !email || !password) {
      setError("Name, email and password are required.");
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/admin/students`, {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, batchId: batchId || undefined })
      });
      const data = await res.json();
      if (!res.ok) return setError(data.message || "Unable to create ID");
      setMsg("Student added successfully.");
      form.reset();
      await load();
    } catch (err) {
      setError(err.message || "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    if (!editTarget) return;
    setSubmitting(true);
    setError("");
    setMsg("");
    const form = e.target;
    try {
      const res = await fetch(`${API_URL}/api/admin/students/${editTarget.id}`, {
        method: "PUT",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.editName.value.trim(),
          email: form.editEmail.value.trim(),
          phone: form.editPhone.value.trim() || null,
          department: form.editDepartment.value || null
        })
      });
      const data = await res.json();
      if (!res.ok) return setError(data.message || "Unable to update student");
      setMsg("Student updated successfully.");
      setEditTarget(null);
      await load();
    } catch (err) {
      setError(err.message || "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  const changeBatch = async (e) => {
    e.preventDefault();
    if (!batchTarget) return;
    const newBatchId = e.target.newBatch.value;
    if (!newBatchId) return setError("Select a batch.");
    setSubmitting(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch(`${API_URL}/api/admin/students/${batchTarget.id}/batch`, {
        method: "PATCH",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: newBatchId })
      });
      const data = await res.json();
      if (!res.ok) return setError(data.message || "Unable to change batch");
      setMsg("Batch changed successfully.");
      setBatchTarget(null);
      await load();
    } catch (err) {
      setError(err.message || "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (student) => {
    const action = student.active === 1 ? "deactivate" : "reactivate";
    if (!window.confirm(`Are you sure you want to ${action} ${student.name}?`)) return;
    setError("");
    setMsg("");
    try {
      const res = await fetch(`${API_URL}/api/admin/students/${student.id}/${action}`, {
        method: "PATCH",
        headers: auth()
      });
      const data = await res.json();
      if (!res.ok) return setError(data.message || `Unable to ${action} student`);
      setMsg(`${student.name} ${action}d.`);
      await load();
    } catch (err) {
      setError(err.message || "An error occurred");
    }
  };

  const removeFromBatch = async (student) => {
    if (!window.confirm(`Remove ${student.name} from their batch? Their task history and submissions are preserved.`)) return;
    setError("");
    setMsg("");
    try {
      const res = await fetch(`${API_URL}/api/admin/students/${student.id}/remove-batch`, {
        method: "PATCH",
        headers: auth()
      });
      const data = await res.json();
      if (!res.ok) return setError(data.message || "Unable to remove from batch");
      setMsg(`${student.name} removed from batch.`);
      await load();
    } catch (err) {
      setError(err.message || "An error occurred");
    }
  };

  // Section 3A: View Details
  const openDetails = async (student) => {
    setDetailsTarget(student);
    setDetailsData(null);
    setDetailsError("");
    setDetailsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/students/${student.id}/details`, { headers: auth() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Unable to load details");
      setDetailsData(data);
      setDetailsError("");
    } catch (e) {
      setDetailsError(e.message);
    } finally {
      setDetailsLoading(false);
    }
  };

  // Section 3B: Delete
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch(`${API_URL}/api/admin/students/${deleteTarget.id}`, {
        method: "DELETE",
        headers: auth()
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Unable to delete student");
        setDeleteTarget(null);
        return;
      }
      setMsg(`${deleteTarget.name} deleted.`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err.message || "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  // Section 3C: Requirement
  const submitRequirement = async (e) => {
    e.preventDefault();
    if (!requirementTarget) return;
    setSubmitting(true);
    setRequirementError("");
    setError("");
    setMsg("");
    try {
      const res = await fetch(`${API_URL}/api/admin/students/${requirementTarget.id}/requirements`, {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ description: requirementDesc })
      });
      const data = await res.json();
      if (!res.ok) {
        setRequirementError(data.message || "Unable to create requirement");
        return;
      }
      setMsg(`Requirement created for ${requirementTarget.name}.`);
      setRequirementTarget(null);
      setRequirementDesc("");
    } catch (err) {
      setRequirementError(err.message || "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  // Section 4: Export task-wise Excel report
  const [exporting, setExporting] = useState(false);
  const exportTaskWise = async () => {
    setExporting(true);
    setError("");
    setMsg("");
    try {
      const params = new URLSearchParams();
      if (batchFilter) params.set("batch", batchFilter);
      const queryString = params.toString();
      const url = `${API_URL}/api/admin/export/task-wise${queryString ? `?${queryString}` : ""}`;
      const res = await fetch(url, { headers: auth() });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Unable to export");
      }
      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      const today = new Date().toISOString().split("T")[0];
      a.download = `TECHINS_Student_Task_Submissions_${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(downloadUrl);
      setMsg("Excel file downloaded successfully.");
    } catch (e) {
      setError(e.message || "Unable to export");
    } finally {
      setExporting(false);
    }
  };

  const isLimitReached = total >= maxStudents;

  const approvalLabel = (s) => {
    const reg = String(s.registration_status || "approved").toLowerCase();
    if (reg === "pending") return "Pending approval";
    if (reg === "rejected") return "Rejected";
    return s.active === 1 ? "Approved" : "Deactivated";
  };
  const approvalClass = (s) => {
    const reg = String(s.registration_status || "approved").toLowerCase();
    if (reg === "pending") return "pending";
    if (reg === "rejected") return "rejected";
    return s.active === 1 ? "approved" : "inactive";
  };

  const closeEdit = useCallback(() => setEditTarget(null), []);
  const closeBatch = useCallback(() => setBatchTarget(null), []);
  const editModalRef = useModalBehavior(!!editTarget, closeEdit);
  const batchModalRef = useModalBehavior(!!batchTarget, closeBatch);
  const detailsModalRef = useModalBehavior(!!detailsTarget, () => setDetailsTarget(null));
  const deleteModalRef = useModalBehavior(!!deleteTarget, () => setDeleteTarget(null));
  const requirementModalRef = useModalBehavior(!!requirementTarget, () => { setRequirementTarget(null); setRequirementDesc(""); setRequirementError(""); });

  return (
    <div className="admin-simple page-enter">
      <div className="simple-head">
        <span>TEAM MANAGEMENT</span>
        <h2>Students</h2>
        <p>{total} / {maxStudents} student accounts.</p>
      </div>

      {/* Section 4: Export task-wise report */}
      <div style={{ marginBottom: 16 }}>
        <button
          className="gold-btn"
          onClick={exportTaskWise}
          disabled={exporting || loading || students.length === 0}
          style={{ width: "auto" }}
        >
          {exporting ? "Exporting…" : "Export Task-wise Report (Excel)"}
        </button>
      </div>

      {error && <div className="error-msg">{error}</div>}
      {msg && <div className="success-msg">{msg}</div>}

      <div className="admin-two">
        <form className="panel" onSubmit={create} autoComplete="off">
          <h3>Add Student</h3>
          <div className="field">
            <label className="field-label" htmlFor="studentName">Full name</label>
            <input id="studentName" name="studentName" placeholder="Full name" required autoComplete="off" />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="studentEmail">Email</label>
            <input id="studentEmail" name="studentEmail" type="email" placeholder="Email" required autoComplete="off" />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="studentPassword">Temporary password</label>
            <input id="studentPassword" name="studentPassword" type="password" placeholder="Temporary password" required autoComplete="new-password" />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="studentBatch">Batch</label>
            <select id="studentBatch" name="studentBatch">
              <option value="">No batch</option>
              {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <button className="gold-btn" type="submit" disabled={submitting || isLimitReached}>
            {submitting ? "Adding…" : "Add Student"}
          </button>
          {isLimitReached && (
            <div className="error-msg">Student limit of {maxStudents} reached.</div>
          )}
        </form>

        <div className="panel">
          <div className="panel-head">
            <h3>Registered Students</h3>
            <button onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
          </div>

          <div style={{ display: "flex", gap: "10px", marginBottom: "14px", flexWrap: "wrap" }}>
            <input
              type="search"
              placeholder="Search name or email…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              style={{ flex: 1, minWidth: 180, padding: "8px 12px", borderRadius: 8, border: "1px solid #D0D0D0", fontSize: 13 }}
            />
            <select
              value={batchFilter}
              onChange={e => { setBatchFilter(e.target.value); setPage(1); }}
              style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #D0D0D0", fontSize: 13 }}
            >
              <option value="">All batches</option>
              {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>

          {loading ? (
            <div className="empty-state">Loading students…</div>
          ) : students.length === 0 ? (
            <div className="empty-state">No students found.</div>
          ) : (
            <>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "2px solid #E5E5E5" }}>
                      <th style={{ padding: "8px" }}>Name</th>
                      <th style={{ padding: "8px" }}>Email</th>
                      <th style={{ padding: "8px" }}>Batch</th>
                      <th style={{ padding: "8px" }}>Status</th>
                      <th style={{ padding: "8px" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map(s => (
                      <tr key={s.id} style={{ borderBottom: "1px solid #F0F0F0" }}>
                        <td style={{ padding: "8px" }}><strong>{s.name}</strong></td>
                        <td style={{ padding: "8px" }}>{s.email}</td>
                        <td style={{ padding: "8px" }}>{s.batch?.name || "—"}</td>
                        <td style={{ padding: "8px" }}>
                          <span className={`pill ${approvalClass(s)}`}>
                            {approvalLabel(s)}
                          </span>
                        </td>
                        <td style={{ padding: "8px" }}>
                          <div className="student-actions">
                            <button onClick={() => openDetails(s)} title="View Details">View Details</button>
                            <button onClick={() => setEditTarget(s)}>Edit</button>
                            <button onClick={() => setBatchTarget(s)}>Change Batch</button>
                            <button onClick={() => setDeleteTarget(s)}>Delete</button>
                            <button onClick={() => setRequirementTarget(s)}>Requirement</button>
                            {s.batch_id && <button onClick={() => removeFromBatch(s)}>Remove</button>}
                            <button onClick={() => toggleActive(s)}>
                              {s.active === 1 ? "Deactivate" : "Reactivate"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div style={{ display: "flex", gap: "8px", marginTop: 14, alignItems: "center", justifyContent: "center" }}>
                  <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
                  <span style={{ fontSize: 13 }}>Page {page} of {totalPages}</span>
                  <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editTarget && (
        <div className="review-modal" ref={editModalRef} onClick={() => setEditTarget(null)}>
          <div className="panel" onClick={e => e.stopPropagation()}>
            <div className="panel-head">
              <h3>Edit Student</h3>
              <button onClick={() => setEditTarget(null)}>Close</button>
            </div>
            <form onSubmit={saveEdit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label>Name
                <input name="editName" defaultValue={editTarget.name} required />
              </label>
              <label>Email
                <input name="editEmail" type="email" defaultValue={editTarget.email} required />
              </label>
              <label>Phone
                <input name="editPhone" defaultValue={editTarget.phone || ""} />
              </label>
              <label>Department
                <input name="editDepartment" defaultValue={editTarget.department || ""} />
              </label>
              <button className="gold-btn" type="submit" disabled={submitting}>
                {submitting ? "Saving…" : "Save Changes"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Change Batch Modal */}
      {batchTarget && (
        <div className="review-modal" ref={batchModalRef} onClick={() => setBatchTarget(null)}>
          <div className="panel" onClick={e => e.stopPropagation()}>
            <div className="panel-head">
              <h3>Change Batch — {batchTarget.name}</h3>
              <button onClick={() => setBatchTarget(null)}>Close</button>
            </div>
            <form onSubmit={changeBatch} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <p style={{ fontSize: 13, margin: 0 }}>
                Current batch: <strong>{batchTarget.batch?.name || "None"}</strong>.
                Task history and submissions are preserved.
              </p>
              <label>New batch
                <select name="newBatch" required>
                  <option value="">Select batch</option>
                  {batches.filter(b => b.id !== batchTarget.batch_id).map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </label>
              <button className="gold-btn" type="submit" disabled={submitting}>
                {submitting ? "Changing…" : "Change Batch"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Section 3A: View Details Modal */}
      {detailsTarget && (
        <div className="review-modal" ref={detailsModalRef} onClick={() => setDetailsTarget(null)}>
          <div className="panel" onClick={e => e.stopPropagation()} style={{ maxWidth: 800, maxHeight: "80vh", overflowY: "auto" }}>
            <div className="panel-head">
              <h3>Student Details — {detailsTarget.name}</h3>
              <button onClick={() => setDetailsTarget(null)}>Close</button>
            </div>
            {detailsLoading && <div className="empty-state">Loading details…</div>}
            {detailsError && <div className="error-msg">{detailsError}</div>}
            {detailsData && (
              <div className="student-details">
                {/* Student Info */}
                <div className="details-section">
                  <h4>Student Information</h4>
                  <div className="details-grid">
                    <div><span>Name</span><strong>{detailsData.student.name}</strong></div>
                    <div><span>Email</span><strong>{detailsData.student.email}</strong></div>
                    <div><span>TECHINS ID</span><strong>{detailsData.student.student_id || "—"}</strong></div>
                    <div><span>Batch</span><strong>{detailsData.student.batch || "—"}</strong></div>
                    <div><span>Phone</span><strong>{detailsData.student.phone || "—"}</strong></div>
                    <div><span>Department</span><strong>{detailsData.student.department || "—"}</strong></div>
                    <div><span>Program</span><strong>{detailsData.student.program || "—"}</strong></div>
                    <div><span>Status</span><strong>{approvalLabel(detailsTarget)}</strong></div>
                  </div>
                </div>

                {/* Missions */}
                <div className="details-section">
                  <h4>Assigned Missions ({detailsData.missions.length})</h4>
                  {detailsData.missions.length === 0 ? (
                    <p className="empty-text">No missions assigned.</p>
                  ) : (
                    <ul>
                      {detailsData.missions.map(m => (
                        <li key={m.id}>
                          <strong>{m.title}</strong> — <span className={`pill ${m.status === "completed" ? "approved" : "pending"}`}>{m.status}</span> {m.progress}% {m.due_date && <small>(Due: {fmtDate(m.due_date)})</small>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Tasks */}
                <div className="details-section">
                  <h4>Assigned Tasks ({detailsData.tasks.length})</h4>
                  {detailsData.tasks.length === 0 ? (
                    <p className="empty-text">No tasks assigned.</p>
                  ) : (
                    <ul>
                      {detailsData.tasks.map(t => (
                        <li key={t.id}>
                          <strong>{t.title || "Untitled"}</strong> {t.task_code && <small>({t.task_code})</small>} — <span className={`pill ${t.workflow_status === "Approved" ? "approved" : "pending"}`}>{t.workflow_status || t.status}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Submissions */}
                <div className="details-section">
                  <h4>Submissions ({detailsData.submissions.length})</h4>
                  {detailsData.submissions.length === 0 ? (
                    <p className="empty-text">Not submitted</p>
                  ) : (
                    <ul>
                      {detailsData.submissions.map(s => (
                        <li key={s.id}>
                          <strong>{s.task_title}</strong> — <span className={`pill ${s.status === "Approved" ? "approved" : s.status === "Submitted" ? "pending" : ""}`}>{s.status}</span> <small>{fmtDate(s.submitted_at)}</small>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Section 3B: Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="review-modal" ref={deleteModalRef} onClick={() => setDeleteTarget(null)}>
          <div className="panel" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="panel-head">
              <h3>Delete Student</h3>
              <button onClick={() => setDeleteTarget(null)}>Close</button>
            </div>
            <div style={{ padding: "0 0 16px" }}>
              <p style={{ fontSize: 14, lineHeight: 1.6, margin: "0 0 16px" }}>
                Are you sure you want to delete <strong>{deleteTarget.name}</strong> ({deleteTarget.student_id || deleteTarget.email})?
                {" "}This action cannot be undone.
              </p>
              <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 20px" }}>
                If the student has related records (tasks, submissions, missions), deletion will be blocked and you will be asked to deactivate instead.
              </p>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="gold-btn" onClick={confirmDelete} disabled={submitting} style={{ background: "#d32f2f", borderColor: "#d32f2f" }}>
                  {submitting ? "Deleting…" : "Delete"}
                </button>
                <button className="gold-btn" onClick={() => setDeleteTarget(null)} style={{ background: "#6b7280", borderColor: "#6b7280" }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Section 3C: Requirement Modal */}
      {requirementTarget && (
        <div className="review-modal" ref={requirementModalRef} onClick={() => { setRequirementTarget(null); setRequirementDesc(""); setRequirementError(""); }}>
          <div className="panel" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="panel-head">
              <h3>Student Requirement</h3>
              <button onClick={() => { setRequirementTarget(null); setRequirementDesc(""); setRequirementError(""); }}>Close</button>
            </div>
            <form onSubmit={submitRequirement} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <p style={{ fontSize: 14, margin: 0 }}>
                Student: <strong>{requirementTarget.name}</strong> ({requirementTarget.student_id || requirementTarget.email})
              </p>
              <label>Description <span className="req">*</span></label>
              <textarea
                value={requirementDesc}
                onChange={(e) => setRequirementDesc(e.target.value)}
                placeholder="Describe the requirement or issue…"
                rows={4}
                required
                maxLength={1000}
              />
              {requirementError && <small className="field-error">{requirementError}</small>}
              <button className="gold-btn" type="submit" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit Requirement"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
