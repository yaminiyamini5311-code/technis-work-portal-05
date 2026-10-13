import { useEffect, useMemo, useState } from "react";

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
  try { return new Date(v).toLocaleString(); } catch { return String(v); }
}

/* Download through fetch so the Authorization header travels with the
   request (a plain anchor cannot send it). Blob URL is revoked after use. */
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

/* Preview file - returns blob URL for image/PDF preview */
async function previewFile(file, onError) {
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

/* Check if file type supports preview */
function canPreview(mime) {
  return mime && (
    mime.startsWith('image/') ||
    mime === 'application/pdf' ||
    mime === 'text/plain' ||
    mime === 'text/html'
  );
}

function DetailModal({ item, onClose, onReviewed }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [reviewing, setReviewing] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);

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

  return (
    <div className="review-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel">
        <div className="panel-head">
          <div>
            <span className="section-kicker">SUBMISSION {item.submission_code || ""}</span>
            <h3>{item.task_title || item.title || "Submission"}</h3>
            <p>{item.student_name || "Student"} · Version {item.version || 1} · {formatDateTime(item.submitted_at)}</p>
          </div>
          <button onClick={onClose}>Close</button>
        </div>
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
            <div className="submission-row" key={v.id || v.version}>
              <div className="submission-avatar">{(item.student_name || "S").charAt(0).toUpperCase()}</div>
              <div>
                <strong>Version {v.version} · {v.submission_code || ""}</strong>
                <small>{formatDateTime(v.submitted_at)} · {v.status}</small>
                {v.comment ? <p>{v.comment}</p> : null}
                {(v.files || []).length ? (
                  <div className="quick-actions">
                    {v.files.map(f => (
                      <div key={f.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        {canPreview(f.mime) && (
                          <button onClick={async () => {
                            const url = await previewFile(f, setError);
                            if (url) {
                              setPreviewUrl(url);
                              setPreviewFile(f);
                            }
                          }}>
                            👁 Preview {f.name}
                          </button>
                        )}
                        <button onClick={() => downloadFile(f, setError)}>
                          ⬇ Download {f.name} {f.size ? `(${formatBytes(f.size)})` : ""}
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

        {/* File Preview Modal */}
        {previewUrl && previewFile && (
          <div className="review-modal" style={{ zIndex: 2000 }} onClick={(e) => { if (e.target === e.currentTarget) { setPreviewUrl(null); setPreviewFile(null); } }}>
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
                <iframe src={previewUrl} style={{ width: '100%', height: '70vh', border: 'none' }} />
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
      </div>
    </div>
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
}

export default function SubmissionsView({ eyebrow, title, subtitle }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("newest");
  const [selected, setSelected] = useState(null);

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch(`${API_URL}/api/tasks/submissions?limit=200`, { headers: auth() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Unable to load submissions");
      setItems(data.submissions || []);
    } catch (e) {
      setError(e.message || "Unable to load submissions. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const statuses = useMemo(() => ["all", ...new Set(items.map(i => i.status).filter(Boolean))], [items]);
  const filtered = useMemo(() => {
    const rows = items.filter(i => {
      if (status !== "all" && i.status !== status) return false;
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      return [i.student_name, i.student_email, i.task_title, i.title, i.task_code, i.submission_code]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(q));
    });
    const by = {
      newest: (a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0),
      oldest: (a, b) => new Date(a.submitted_at || 0) - new Date(b.submitted_at || 0),
      student: (a, b) => String(a.student_name || "").localeCompare(String(b.student_name || "")),
      task: (a, b) => String(a.task_title || a.title || "").localeCompare(String(b.task_title || b.title || "")),
      status: (a, b) => String(a.status || "").localeCompare(String(b.status || "")),
    }[sort] || (() => 0);
    return [...rows].sort(by);
  }, [items, query, status, sort]);

  if (loading) return <div className="portal-loading"><div className="loader-dot" /><h2>Loading submissions</h2><p>Fetching student work.</p></div>;

  return (
    <div className="admin-simple page-enter">
      <div className="simple-head"><span>{eyebrow}</span><h2>{title}</h2><p>{subtitle}</p></div>
      {error && <div className="error-msg">{error} <button onClick={load}>Retry</button></div>}
      <section className="panel">
        <div className="panel-head chart-head">
          <div><span className="section-kicker">SUBMITTED WORK</span><h3>{filtered.length} submission{filtered.length === 1 ? "" : "s"}</h3></div>
          <div className="chart-tabs">
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search student, task, code…" aria-label="Search submissions" />
            <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by status">
              {statuses.map(s => <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>)}
            </select>
            <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort submissions">
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="student">Student A–Z</option>
              <option value="task">Task A–Z</option>
              <option value="status">Status A–Z</option>
            </select>
            <button onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
          </div>
        </div>
        {filtered.length ? (
          <div className="submission-list">
            {filtered.map(item => (
              <button className="submission-row" key={item.id} onClick={() => setSelected(item)} style={{ width: "100%", textAlign: "left", cursor: "pointer" }}>
                <div className="submission-avatar">{(item.student_name || "S").charAt(0).toUpperCase()}</div>
                <div>
                  <strong>{item.task_title || item.title || "Untitled task"}</strong>
                  <small>{item.student_name || "Unknown student"} · {item.submission_code || ""} · v{item.version || 1} · {formatDateTime(item.submitted_at)}</small>
                  <small>{item.file_count || 0} file{(item.file_count || 0) === 1 ? "" : "s"}{item.comment ? ` · ${item.comment.slice(0, 80)}` : ""}</small>
                </div>
                <span className={`pill ${(item.status || "").toLowerCase().replace(/\s+/g, "_")}`}>{item.status || "Submitted"}</span>
              </button>
            ))}
          </div>
        ) : <div className="empty-state">{items.length ? "No submissions match your filters." : "No student submissions yet. Submitted work will appear here."}</div>}
      </section>
      {notice && <div className="info-msg">{notice}</div>}
      {selected && <DetailModal item={selected} onClose={() => { setSelected(null); setNotice(""); }} onReviewed={(nextStatus) => { setSelected(null); setNotice(`Review saved (${nextStatus}). List refreshed.`); load(); }} />}
    </div>
  );
}

export { downloadFile };
