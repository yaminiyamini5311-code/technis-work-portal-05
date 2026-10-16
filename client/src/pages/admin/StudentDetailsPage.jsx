import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import TechinsIcon from "../../components/TechinsIcon";
import "./StudentDetailsPage.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

function fmtDate(value) {
  if (!value) return "—";
  try { return new Date(value).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }); } catch { return String(value); }
}

function fmtDateTime(value) {
  if (!value) return "—";
  try { return new Date(value).toLocaleString("en-US", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return String(value); }
}

function formatBytes(n) {
  if (n === null || n === undefined) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function canPreview(mime) {
  return mime && (
    mime.startsWith('image/') ||
    mime === 'application/pdf' ||
    mime === 'text/plain' ||
    mime === 'text/html'
  );
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

export default function StudentDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    // Validate id before making any API call
    if (!id || id === "null" || id === "undefined") {
      setError("Invalid student identifier. Please go back and try again.");
      setErrorStatus(400);
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError("");
        setErrorStatus(null);
        const res = await fetch(`${API_URL}/api/admin/students/${id}/details`, { headers: auth() });
        const json = await res.json();
        if (!cancelled && res.ok) {
          setData(json);
          setError("");
          setErrorStatus(null);
        } else if (!cancelled) {
          // Distinguish error types
          if (res.status === 400) {
            setError("Invalid student identifier.");
          } else if (res.status === 401 || res.status === 403) {
            setError("You don't have permission to view this student.");
          } else if (res.status === 404) {
            setError("Student not found.");
          } else {
            setError(json.message || "Unable to load student details. Please try again.");
          }
          setErrorStatus(res.status);
        }
      } catch (e) {
        if (!cancelled) {
          setError("Unable to load student details. Check your connection.");
          setErrorStatus(500);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const handlePreviewFile = async (file) => {
    setPreviewError("");
    const url = await fetchPreviewUrl(file, setPreviewError);
    if (url) {
      setPreviewUrl(url);
      setPreviewFile(file);
    }
  };

  if (loading) {
    return (
      <div className="student-details-page">
        <div className="portal-loading">
          <div className="loader-dot" />
          <h2>Loading student details…</h2>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="student-details-page">
        <div className="portal-error">
          <h2>Unable to load student details</h2>
          <p>{error}</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            {errorStatus >= 500 && (
              <button onClick={() => window.location.reload()} className="back-btn">Retry</button>
            )}
            <button onClick={() => navigate("/admin/submissions")} className="back-btn">← Back to Student Submissions</button>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { student, missions, tasks, submissions } = data;

  return (
    <div className="student-details-page">
      <div className="details-header">
        <button onClick={() => navigate("/admin/submissions")} className="back-btn">
          <TechinsIcon name="chevron" size={16} variant="light" ariaHidden /> Back to Student Submissions
        </button>
        <div className="simple-head" style={{ marginBottom: 0 }}>
          <span>STUDENT PROFILE</span>
          <h2>{student.name}</h2>
        </div>
      </div>

      {/* Profile Section */}
      <section className="panel details-section">
        <div className="panel-head">
          <div>
            <span className="section-kicker">PROFILE</span>
            <h3>Student Information</h3>
          </div>
        </div>
        <div className="details-grid">
          <div className="detail-item">
            <span className="label">Name</span>
            <strong>{student.name}</strong>
          </div>
          <div className="detail-item">
            <span className="label">TECHINS ID</span>
            <strong>{student.student_id || "—"}</strong>
          </div>
          <div className="detail-item">
            <span className="label">Email</span>
            <strong>{student.email}</strong>
          </div>
          <div className="detail-item">
            <span className="label">Phone</span>
            <strong>{student.phone || "—"}</strong>
          </div>
          <div className="detail-item">
            <span className="label">Program</span>
            <strong>{student.program || "—"}</strong>
          </div>
          <div className="detail-item">
            <span className="label">Batch</span>
            <strong>{student.batch || "—"}</strong>
          </div>
          <div className="detail-item">
            <span className="label">Department</span>
            <strong>{student.department || "Not provided"}</strong>
          </div>
          <div className="detail-item">
            <span className="label">Status</span>
            <strong>{student.registration_status || (student.active === 1 ? "Approved" : "Deactivated")}</strong>
          </div>
        </div>
      </section>

      {/* Assigned Missions */}
      <section className="panel details-section">
        <div className="panel-head">
          <div>
            <span className="section-kicker">MISSIONS</span>
            <h3>Assigned Missions ({missions.length})</h3>
          </div>
        </div>
        {missions.length === 0 ? (
          <p className="empty-text">No missions assigned.</p>
        ) : (
          <ul className="details-list">
            {missions.map(m => (
              <li key={m.id}>
                <strong>{m.title}</strong>
                <span className={`pill ${m.status === "completed" ? "approved" : "pending"}`}>{m.status}</span>
                <span>{m.progress}%</span>
                {m.due_date && <small>Due: {fmtDate(m.due_date)}</small>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Assigned Tasks */}
      <section className="panel details-section">
        <div className="panel-head">
          <div>
            <span className="section-kicker">TASKS</span>
            <h3>Assigned Tasks ({tasks.length})</h3>
          </div>
        </div>
        {tasks.length === 0 ? (
          <p className="empty-text">No tasks assigned.</p>
        ) : (
          <ul className="details-list">
            {tasks.map(t => (
              <li key={t.id}>
                <strong>{t.title || "Untitled"}</strong>
                {t.task_code && <small>(Task ID: {t.task_code})</small>}
                <span className={`pill ${t.workflow_status === "Approved" ? "approved" : "pending"}`}>{t.workflow_status || t.status}</span>
                {t.due_date && <small>Due: {fmtDate(t.due_date)}</small>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Submissions with full details */}
      <section className="panel details-section">
        <div className="panel-head">
          <div>
            <span className="section-kicker">SUBMISSIONS</span>
            <h3>All Submissions ({submissions.length})</h3>
          </div>
        </div>
        {submissions.length === 0 ? (
          <p className="empty-text">Not submitted</p>
        ) : (
          <div className="submissions-list">
            {submissions.map(s => (
              <div key={s.id} className="submission-card">
                <div className="submission-card-header">
                  <div>
                    <strong>{s.task_title}</strong>
                    {s.task_code && <small>(Task ID: {s.task_code})</small>}
                  </div>
                  <span className={`pill ${s.status === "Approved" ? "approved" : s.status === "Submitted" ? "pending" : ""}`}>{s.status}</span>
                </div>
                <div className="submission-card-meta">
                  <span>Submitted: {fmtDateTime(s.submitted_at)}</span>
                  {s.version && <span>Version {s.version}</span>}
                </div>
                {s.comment && (
                  <div className="submission-response">
                    <span className="response-label">Response:</span>
                    <p className="response-text">{s.comment}</p>
                  </div>
                )}
                {s.files && s.files.length > 0 && (
                  <div className="submission-files">
                    <span className="files-label">Attachments ({s.files.length}):</span>
                    <div className="files-list">
                      {s.files.map(f => (
                        <div key={f.id} className="file-item">
                          <div className="file-info">
                            <TechinsIcon name="folder" size={14} variant="light" ariaHidden />
                            <span className="file-name" title={f.name}>{f.name}</span>
                            {f.size && <span className="file-size">({formatBytes(f.size)})</span>}
                          </div>
                          <div className="file-actions">
                            {canPreview(f.mime) && (
                              <button className="file-action-btn" onClick={() => handlePreviewFile(f)} title="Preview">
                                <TechinsIcon name="eye" size={14} variant="light" ariaHidden />
                                <span>Preview</span>
                              </button>
                            )}
                            <button className="file-action-btn" onClick={() => downloadFile(f, setError)} title="Download">
                              <TechinsIcon name="download" size={14} variant="light" ariaHidden />
                              <span>Download</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {s.reviewer_name && (
                  <div className="submission-review">
                    <span className="review-label">Reviewer:</span> {s.reviewer_name}
                    {s.reviewed_at && <span>Reviewed: {fmtDateTime(s.reviewed_at)}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* File Preview Modal */}
      {previewUrl && previewFile && (
        <div className="review-modal" onClick={(e) => { if (e.target === e.currentTarget) { setPreviewUrl(null); setPreviewFile(null); } }}>
          <div className="panel" style={{ maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto' }}>
            <div className="panel-head">
              <div>
                <span className="section-kicker">FILE PREVIEW</span>
                <h3>{previewFile.name}</h3>
              </div>
              <button onClick={() => { setPreviewUrl(null); setPreviewFile(null); }}>Close</button>
            </div>
            {previewError && <div className="error-msg">{previewError}</div>}
            {previewFile.mime?.startsWith('image/') ? (
              <img src={previewUrl} alt={previewFile.name} style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }} />
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
    </div>
  );
}
