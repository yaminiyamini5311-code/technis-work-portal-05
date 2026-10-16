import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import TechinsIcon from "./TechinsIcon";
import useModalBehavior from "./useModalBehavior";
import "./SubmissionsView.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

function formatBytes(n) {
  if (n === null || n === undefined) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(v) {
  if (!v) return "—";
  try { return new Date(v).toLocaleString("en-US", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return String(v); }
}

async function downloadFile(file, onError) {
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

async function fetchPreviewUrl(file, onError) {
  try {
    const res = await fetch(`${API_URL}${file.download_url}`, { headers: auth() });
    if (!res.ok) {
      let msg = "Unable to preview file";
      try { msg = (await res.json()).message || msg; } catch {}
      onError(msg);
      return null;
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    onError("Unable to preview file. Check your connection.");
    return null;
  }
}

function canPreview(mime) {
  return mime && (
    mime.startsWith('image/') ||
    mime === 'application/pdf' ||
    mime === 'text/plain' ||
    mime === 'text/html'
  );
}

function DetailModal({ item, onClose, onReviewed, inline = false }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [reviewing, setReviewing] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const closePreview = () => { setPreviewUrl(null); setPreviewFile(null); };
  const dialogRef = useModalBehavior(!inline, onClose);
  const previewRef = useModalBehavior(Boolean(previewUrl), closePreview);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/tasks/${item.task_id}`, { headers: auth() });
        const data = await res.json();
        if (!cancelled && res.ok) setDetail(data);
        else if (!cancelled) setError(data.message || "Unable to load details");
      } catch {
        if (!cancelled) setError("Unable to load details. Check your connection.");
      }
    })();
    return () => { cancelled = true; };
  }, [item.task_id]);

  const history = detail?.history || [];
  const versions = useMemo(() => {
    const list = detail?.submissions?.length ? detail.submissions : [item];
    return [...list].sort((a, b) => (b.version || 0) - (a.version || 0));
  }, [detail, item]);
  const assignment = (detail?.assignments || []).find(a => String(a.student_id) === String(item.student_id));
  const progress = item.assignment_progress ?? assignment?.progress ?? null;

  const content = (
    <>
      {error && <div className="error-msg">{error}</div>}

      <section className="panel">
        <div className="panel-head"><div><span className="section-kicker">STUDENT</span><h3>{item.student_name || "—"}</h3></div><span className={`pill ${(item.status || "").toLowerCase().replace(/\s+/g, "_")}`}>{item.status || "Submitted"}</span></div>
        <p><strong>Email:</strong> {item.student_email || "—"}<br />
        <strong>Phone:</strong> {item.student_phone || "—"}<br />
        <strong>Program:</strong> {item.student_program || "—"}<br />
        <strong>Batch:</strong> {item.batch_name || "—"}<br />
        <strong>Student ID:</strong> {item.student_id || "—"}</p>
      </section>

      <section className="panel">
        <div className="panel-head"><div><span className="section-kicker">TASK</span><h3>{item.task_code || ""} · {item.task_title || item.title || ""}</h3></div></div>
        <p>{item.task_description || detail?.task?.description || "No description provided."}</p>
        <p><strong>Workflow:</strong> {item.workflow_status || detail?.task?.workflow_status || "—"}</p>
      </section>

      <section className="panel">
        <div className="panel-head"><div><span className="section-kicker">SUBMITTED WORK</span><h3>Version history & files</h3></div></div>
        {versions.map(v => (
          <div className="submission-row" key={v.id || v.version} style={{ marginBottom: '1rem', borderBottom: '1px solid #e0e0e0', paddingBottom: '1rem' }}>
            <div className="submission-avatar">{(item.student_name || "S").charAt(0).toUpperCase()}</div>
            <div>
              <strong>Version {v.version} · {v.submission_code || ""}</strong>
              <small>{formatDateTime(v.submitted_at)} · {v.status}</small>
              {v.comment ? <p style={{ margin: '0.5rem 0', padding: '0.5rem', background: '#f5f5f5', borderRadius: '4px' }}><strong>Comment:</strong> {v.comment}</p> : null}
              {(v.files || []).length ? (
                <div className="quick-actions" style={{ marginTop: '0.5rem' }}>
                  {v.files.map(f => (
                    <div key={f.id} style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                      <span className="file-name-line"><TechinsIcon name="folder" size={14} variant="light" ariaHidden /> {f.name}</span>
                      {f.size && <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>({formatBytes(f.size)})</span>}
                      {canPreview(f.mime) && (
                        <button onClick={async () => {
                          const url = await fetchPreviewUrl(f, setError);
                          if (url) {
                            setPreviewUrl(url);
                            setPreviewFile(f);
                          }
                        }} style={{ padding: '0.25rem 0.75rem', fontSize: '0.85rem' }}>
                            <TechinsIcon name="eye" size={13} variant="light" ariaHidden /> Preview
                          </button>
                      )}
                      <button onClick={() => downloadFile(f, setError)} style={{ padding: '0.25rem 0.75rem', fontSize: '0.85rem' }}>
                        <TechinsIcon name="download" size={13} variant="light" ariaHidden /> Download
                      </button>
                    </div>
                  ))}
                </div>
              ) : <small>No files attached to this version.</small>}
            </div>
            <span>{v.file_count ?? (v.files || []).length} file{(v.file_count ?? (v.files || []).length) === 1 ? "" : "s"}</span>
          </div>
        ))}
      </section>

      {previewUrl && previewFile && (
        <div className="review-modal" ref={previewRef} style={{ zIndex: 2000 }} onClick={(e) => { if (e.target === e.currentTarget) closePreview(); }}>
          <div className="panel" style={{ maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto' }}>
            <div className="panel-head">
              <div>
                <span className="section-kicker">FILE PREVIEW</span>
                <h3>{previewFile.name}</h3>
              </div>
              <button onClick={() => { setPreviewUrl(null); setPreviewFile(null); }}>Close</button>
            </div>
            {previewFile.mime?.startsWith('image/') ? (
              <img src={previewUrl} alt={previewFile.name} style={{ maxWidth: '100%', height: 'auto' }} />
            ) : previewFile.mime === 'application/pdf' ? (
              <iframe src={previewUrl} style={{ width: '100%', height: '70vh', border: 'none' }} title={previewFile.name} />
            ) : previewFile.mime?.startsWith('text/') ? (
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '70vh', overflow: 'auto' }}>
                {previewFile.name}
              </pre>
            ) : (
              <p>Preview not available for this file type. Please download to view.</p>
            )}
          </div>
        </div>
      )}

      <section className="panel">
        <div className="panel-head"><div><span className="section-kicker">PROGRESS</span><h3>Student progress</h3></div></div>
        <p><strong>Assignment:</strong> {item.assignment_status || assignment?.status || "—"}{progress !== null && progress !== undefined ? ` · ${progress}%` : ""}</p>
        {history.length ? (
          <div className="submission-list">
            {history.map(h => (
              <div className="submission-row" key={h.id || h.created_at}>
                <div><strong>{h.from_status} → {h.to_status}</strong><small>{h.changed_by_name || ""} · {formatDateTime(h.created_at)}</small>{h.comment ? <p>{h.comment}</p> : null}</div>
              </div>
            ))}
          </div>
        ) : <div className="empty-state">No progress history recorded yet.</div>}
      </section>

      <section className="panel">
        <div className="panel-head"><div><span className="section-kicker">FEEDBACK & REVIEW</span><h3>Evaluation status</h3></div></div>
        <p><strong>Reviewer:</strong> {item.reviewer_name || "Not reviewed yet"}<br />
        <strong>Reviewed at:</strong> {item.reviewed_at ? formatDateTime(item.reviewed_at) : "—"}<br />
        <strong>Review comments:</strong> {item.review_comments || "—"}</p>
        <p><strong>Task feedback:</strong> {item.task_feedback || detail?.task?.feedback || "No feedback given yet."}</p>
        <p><strong>Status:</strong> {item.status || "Submitted"} — drafts and submitted work are distinguished by this status.</p>
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 700 }}>
            Review comment (required to approve or request revision)
            <textarea
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              placeholder="Explain the decision for the student…"
              rows={3}
            />
          </label>
          <div className="quick-actions" style={{ marginTop: 0 }}>
            <button
              disabled={!!reviewing}
              onClick={() => submitReview("approve")}
            >{reviewing === "approve" ? "Approving…" : "Approve"}</button>
            <button
              disabled={!!reviewing}
              onClick={() => submitReview("revision")}
            >{reviewing === "revision" ? "Sending…" : "Request revision"}</button>
          </div>
        </div>
      </section>
    </>
  );

  async function submitReview(decision) {
    if (reviewing) return;
    if (!reviewComment.trim()) {
      setError("Add a review comment before approving or requesting revision.");
      return;
    }
    try {
      setReviewing(decision);
      setError("");
      const res = await fetch(`${API_URL}/api/tasks/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth() },
        body: JSON.stringify({ submission_id: item.id, decision, comment: reviewComment.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Unable to save review");
      onReviewed?.(data.status || (decision === "approve" ? "Approved" : "Revision Required"));
    } catch (e) {
      setError(e.message || "Unable to save review. Check your connection.");
    } finally {
      setReviewing(null);
    }
  }

  if (inline) {
    return (
      <>
        <div className="panel-head" style={{ marginBottom: '1rem' }}>
          <div>
            <span className="section-kicker">SUBMISSION {item.submission_code || ""}</span>
            <h3>{item.task_title || item.title || "Submission"}</h3>
            <p>{item.student_name || "Student"} · Version {item.version || 1} · {formatDateTime(item.submitted_at)}</p>
          </div>
        </div>
        {content}
      </>
    );
  }

  return (
    <div className="review-modal" ref={dialogRef} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel">
        <div className="panel-head">
          <div>
            <span className="section-kicker">SUBMISSION {item.submission_code || ""}</span>
            <h3>{item.task_title || item.title || "Submission"}</h3>
            <p>{item.student_name || "Student"} · Version {item.version || 1} · {formatDateTime(item.submitted_at)}</p>
          </div>
          <button onClick={onClose}>Close</button>
        </div>
        {content}
      </div>
    </div>
  );
}

export default function SubmissionsView({ eyebrow, title, subtitle }) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterBatch, setFilterBatch] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  // Requirement modal state
  const [requirementTarget, setRequirementTarget] = useState(null);
  const [requirementDesc, setRequirementDesc] = useState("");
  const [requirementError, setRequirementError] = useState("");
  const [submittingRequirement, setSubmittingRequirement] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch(`${API_URL}/api/tasks/submissions?limit=500`, { headers: auth() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Unable to load submissions");
      setItems(data.submissions || []);
    } catch (e) {
      setError(e.message || "Unable to load submissions. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const exportToExcel = async () => {
    if (exporting) return;
    try {
      setExporting(true);
      setError("");
      const params = new URLSearchParams();
      if (filterStatus !== "all") params.append("status", filterStatus);
      if (filterBatch !== "all") params.append("batch_name", filterBatch);
      const queryString = params.toString();
      const url = `${API_URL}/api/admin/export/task-wise${queryString ? `?${queryString}` : ""}`;
      const res = await fetch(url, { headers: auth() });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Unable to export submissions");
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
      setNotice("Excel file downloaded successfully (task-wise report).");
    } catch (e) {
      setError(e.message || "Unable to export submissions. Check your connection.");
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => { load(); }, []);

  const statuses = useMemo(() =>
    ["all", ...new Set(items.map(i => i.status).filter(Boolean))],
    [items]
  );

  const batches = useMemo(() => {
    const batchSet = new Set(items.map(i => i.batch_name).filter(Boolean));
    return ["all", ...Array.from(batchSet)];
  }, [items]);

  const filteredSubmissions = useMemo(() => {
    let filtered = [...items];
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter(item =>
        (item.student_name || "").toLowerCase().includes(q) ||
        (item.student_email || "").toLowerCase().includes(q) ||
        (item.task_title || "").toLowerCase().includes(q) ||
        (item.task_code || "").toLowerCase().includes(q) ||
        (item.submission_code || "").toLowerCase().includes(q) ||
        (item.student_id || "").toLowerCase().includes(q)
      );
    }
    if (filterStatus !== "all") {
      filtered = filtered.filter(item => item.status === filterStatus);
    }
    if (filterBatch !== "all") {
      filtered = filtered.filter(item => item.batch_name === filterBatch);
    }
    const sortFn = {
      newest: (a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0),
      oldest: (a, b) => new Date(a.submitted_at || 0) - new Date(b.submitted_at || 0),
      student: (a, b) => (a.student_name || "").localeCompare(b.student_name || ""),
      task: (a, b) => (a.task_title || "").localeCompare(b.task_title || ""),
      status: (a, b) => (a.status || "").localeCompare(b.status || ""),
    }[sortBy] || (() => 0);
    return filtered.sort(sortFn);
  }, [items, searchQuery, filterStatus, filterBatch, sortBy]);

  const handleViewDetails = (submission) => {
    // B-1: Navigate to full-page student details
    navigate(`/admin/students/${submission.student_id}`);
  };

  const handleCloseDetails = () => {
    setSelectedSubmission(null);
    setNotice("");
  };

  const handleReviewed = (nextStatus) => {
    setSelectedSubmission(null);
    setNotice(`Review saved (${nextStatus}). List refreshed.`);
    load();
  };

  // B: Delete student
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch(`${API_URL}/api/admin/students/${deleteTarget.student_id}`, {
        method: "DELETE",
        headers: auth()
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Unable to delete student");
        setDeleteTarget(null);
        return;
      }
      setMsg(`${deleteTarget.student_name} deleted.`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err.message || "An error occurred");
    } finally {
      setDeleting(false);
    }
  };

  const [msg, setMsg] = useState("");

  // C: Requirement
  const submitRequirement = async (e) => {
    e.preventDefault();
    if (!requirementTarget) return;
    setSubmittingRequirement(true);
    setRequirementError("");
    setError("");
    setMsg("");
    try {
      const res = await fetch(`${API_URL}/api/admin/students/${requirementTarget.student_id}/requirements`, {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ description: requirementDesc })
      });
      const data = await res.json();
      if (!res.ok) {
        setRequirementError(data.message || "Unable to create requirement");
        return;
      }
      setMsg(`Requirement created for ${requirementTarget.student_name}.`);
      setRequirementTarget(null);
      setRequirementDesc("");
    } catch (err) {
      setRequirementError(err.message || "An error occurred");
    } finally {
      setSubmittingRequirement(false);
    }
  };

  const deleteModalRef = useModalBehavior(!!deleteTarget, () => setDeleteTarget(null));
  const requirementModalRef = useModalBehavior(!!requirementTarget, () => { setRequirementTarget(null); setRequirementDesc(""); setRequirementError(""); });

  if (loading) {
    return (
      <div className="portal-loading">
        <div className="loader-dot" />
        <h2>Loading submissions</h2>
        <p>Fetching student work.</p>
      </div>
    );
  }

  return (
    <div className="admin-simple page-enter">
      <div className="simple-head">
        <span>{eyebrow}</span>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>

      {error && (
        <div className="error-msg">
          {error} <button onClick={load}>Retry</button>
        </div>
      )}

      {notice && <div className="info-msg">{notice}</div>}

      {/* Filters and Controls */}
      <section className="panel">
        <div className="panel-head chart-head">
          <div>
            <span className="section-kicker">SUBMISSION RECORDS</span>
            <h3>{filteredSubmissions.length} submission{filteredSubmissions.length === 1 ? '' : 's'}</h3>
          </div>
          <div className="chart-tabs">
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search student, task, email…"
              aria-label="Search submissions"
              style={{ minWidth: '200px' }}
            />
            <select
              value={filterBatch}
              onChange={e => setFilterBatch(e.target.value)}
              aria-label="Filter by batch"
            >
              <option value="all">All batches</option>
              {batches.filter(b => b !== "all").map(b =>
                <option key={b} value={b}>{b}</option>
              )}
            </select>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              aria-label="Filter by status"
            >
              {statuses.map(s =>
                <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>
              )}
            </select>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              aria-label="Sort by"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="student">Student A–Z</option>
              <option value="task">Task A–Z</option>
              <option value="status">Status A–Z</option>
            </select>
            <button onClick={load} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </button>
            <button
              className="export-excel-btn"
              onClick={exportToExcel}
              disabled={exporting || loading}
            >
              {exporting ? "Exporting…" : (
                <>
                  <TechinsIcon name="chart" size={18} ariaHidden />
                  <span>Export to Excel</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Submissions Table */}
        {filteredSubmissions.length > 0 ? (
          <div className="submissions-table-wrapper">
            <table className="submissions-table">
              <thead>
                <tr>
                  <th>Student Name</th>
                  <th>Student Details</th>
                  <th>Task</th>
                  <th>Response</th>
                  <th>Files</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSubmissions.map(item => (
                  <tr key={item.id}>
                    <td className="student-name">
                      <div className="student-avatar">
                        {(item.student_name || "S").charAt(0).toUpperCase()}
                      </div>
                      <strong>{item.student_name || "Unknown"}</strong>
                    </td>
                    <td className="student-details">
                      <div className="detail-line">
                        <span className="label">Email:</span> <span className="value" title={item.student_email}>{item.student_email ? (item.student_email.length > 25 ? item.student_email.slice(0, 25) + "…" : item.student_email) : "—"}</span>
                      </div>
                      <div className="detail-line">
                        <span className="label">ID:</span> <span className="value">{item.student_id || "—"}</span>
                      </div>
                      <div className="detail-line">
                        <span className="label">Program:</span> <span className="value">{item.student_program || "—"}</span>
                      </div>
                      <div className="detail-line">
                        <span className="label">Batch:</span> <span className="value">{item.batch_name || "—"}</span>
                      </div>
                    </td>
                    <td className="task-info">
                      <strong>{item.task_code || "No code"}</strong>
                      <div className="task-title">{item.task_title || "Untitled task"}</div>
                      {item.task_description && (
                        <div className="task-desc">
                          {item.task_description.slice(0, 80)}
                          {item.task_description.length > 80 ? '…' : ''}
                        </div>
                      )}
                    </td>
                    <td className="response-column">
                      {item.comment ? (
                        <div className="response-text">
                          {item.comment.slice(0, 100)}
                          {item.comment.length > 100 ? '…' : ''}
                        </div>
                      ) : (
                        <span className="no-response">No written response</span>
                      )}
                      <div className="submission-meta">
                        v{item.version || 1} · {item.submission_code || "—"}
                      </div>
                    </td>
                    <td className="files-column">
                      {item.file_count > 0 ? (
                        <div className="file-count">
                          <TechinsIcon name="folder" size={13} variant="light" ariaHidden /> {item.file_count} file{item.file_count === 1 ? '' : 's'}
                        </div>
                      ) : (
                        <span className="no-files">No files</span>
                      )}
                    </td>
                    <td className="timestamp-column">
                      {formatDateTime(item.submitted_at)}
                    </td>
                    <td className="status-column">
                      <span className={`pill ${(item.status || '').toLowerCase().replace(/\s+/g, '_')}`}>
                        {item.status || 'Submitted'}
                      </span>
                    </td>
                    <td className="actions-column">
                      <div className="actions-buttons">
                        <button
                          className="view-details-btn"
                          onClick={() => handleViewDetails(item)}
                        >
                          View Details
                        </button>
                        <button
                          className="delete-btn"
                          onClick={() => setDeleteTarget(item)}
                        >
                          Delete
                        </button>
                        <button
                          className="requirement-btn"
                          onClick={() => setRequirementTarget(item)}
                        >
                          Requirement
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            {items.length
              ? "No submissions match your filters."
              : "No student submissions yet. Submitted work will appear here."}
          </div>
        )}
      </section>

      {/* Detail Modal (submission-level review) */}
      {selectedSubmission && (
        <DetailModal
          item={selectedSubmission}
          onClose={handleCloseDetails}
          onReviewed={handleReviewed}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="review-modal" ref={deleteModalRef} onClick={() => setDeleteTarget(null)}>
          <div className="panel" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="panel-head">
              <h3>Delete Student</h3>
              <button onClick={() => setDeleteTarget(null)}>Close</button>
            </div>
            <div style={{ padding: "0 0 16px" }}>
              <p style={{ fontSize: 14, lineHeight: 1.6, margin: "0 0 16px" }}>
                Are you sure you want to delete <strong>{deleteTarget.student_name}</strong> ({deleteTarget.student_id || deleteTarget.student_email})?
                {" "}This action cannot be undone.
              </p>
              <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 20px" }}>
                If the student has related records (tasks, submissions, missions), deletion will be blocked and you will be asked to deactivate instead.
              </p>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="gold-btn" onClick={confirmDelete} disabled={deleting} style={{ background: "#d32f2f", borderColor: "#d32f2f" }}>
                  {deleting ? "Deleting…" : "Delete"}
                </button>
                <button className="gold-btn" onClick={() => setDeleteTarget(null)} style={{ background: "#6b7280", borderColor: "#6b7280" }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Requirement Modal */}
      {requirementTarget && (
        <div className="review-modal" ref={requirementModalRef} onClick={() => { setRequirementTarget(null); setRequirementDesc(""); setRequirementError(""); }}>
          <div className="panel" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="panel-head">
              <h3>Student Requirement</h3>
              <button onClick={() => { setRequirementTarget(null); setRequirementDesc(""); setRequirementError(""); }}>Close</button>
            </div>
            <form onSubmit={submitRequirement} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <p style={{ fontSize: 14, margin: 0 }}>
                Student: <strong>{requirementTarget.student_name}</strong> ({requirementTarget.student_id || requirementTarget.student_email})
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
              <button className="gold-btn" type="submit" disabled={submittingRequirement}>
                {submittingRequirement ? "Submitting…" : "Submit Requirement"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export { downloadFile };
