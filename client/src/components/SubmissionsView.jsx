import { useEffect, useMemo, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

// View modes
const VIEW_MODES = {
  TASKS: 'tasks',          // Task-wise list (default)
  TASK_STUDENTS: 'task_students',  // Students who submitted a specific task
  STUDENT_DETAIL: 'student_detail' // Individual student submission detail
};

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

function DetailModal({ item, onClose, onReviewed, inline = false }) {
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
                    <div key={f.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.9rem', fontWeight: '500' }}>📎 {f.name}</span>
                      {f.size && <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>({formatBytes(f.size)})</span>}
                      {canPreview(f.mime) && (
                        <button onClick={async () => {
                          const url = await previewFile(f, setError);
                          if (url) {
                            setPreviewUrl(url);
                            setPreviewFile(f);
                          }
                        }} style={{ padding: '0.25rem 0.75rem', fontSize: '0.85rem' }}>
                          👁 Preview
                        </button>
                      )}
                      <button onClick={() => downloadFile(f, setError)} style={{ padding: '0.25rem 0.75rem', fontSize: '0.85rem' }}>
                        ⬇ Download
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
        {content}
      </div>
    </div>
  );
}

export default function SubmissionsView({ eyebrow, title, subtitle }) {
  // Data state
  const [items, setItems] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [batches, setBatches] = useState([]);
  
  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  
  // View state
  const [viewMode, setViewMode] = useState(VIEW_MODES.TASKS);
  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  
  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterTask, setFilterTask] = useState("all");
  const [filterBatch, setFilterBatch] = useState("all");
  const [sortBy, setSortBy] = useState("newest");

  // Load submissions and related data
  const load = async () => {
    try {
      setLoading(true);
      setError("");
      
      const [submissionsRes, tasksRes, batchesRes] = await Promise.all([
        fetch(`${API_URL}/api/tasks/submissions?limit=500`, { headers: auth() }),
        fetch(`${API_URL}/api/tasks`, { headers: auth() }),
        fetch(`${API_URL}/api/batches`, { headers: auth() }).catch(() => ({ ok: false, json: async () => ({ batches: [] }) }))
      ]);
      
      const [submissionsData, tasksData, batchesData] = await Promise.all([
        submissionsRes.json(),
        tasksRes.json(),
        batchesRes.json()
      ]);
      
      if (!submissionsRes.ok) throw new Error(submissionsData.message || "Unable to load submissions");
      
      setItems(submissionsData.submissions || []);
      setTasks(tasksData.tasks || []);
      setBatches(batchesData.batches || []);
    } catch (e) {
      setError(e.message || "Unable to load submissions. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Group submissions by task
  const taskGroups = useMemo(() => {
    const groups = new Map();
    
    items.forEach(submission => {
      const taskId = submission.task_id;
      if (!groups.has(taskId)) {
        groups.set(taskId, {
          task_id: taskId,
          task_code: submission.task_code,
          task_title: submission.task_title || submission.title,
          task_description: submission.task_description,
          workflow_status: submission.workflow_status,
          submissions: [],
          student_count: 0,
          total_files: 0
        });
      }
      
      const group = groups.get(taskId);
      group.submissions.push(submission);
      group.total_files += (submission.file_count || 0);
    });
    
    // Calculate unique students per task
    groups.forEach(group => {
      const uniqueStudents = new Set(group.submissions.map(s => s.student_id));
      group.student_count = uniqueStudents.size;
    });
    
    return Array.from(groups.values());
  }, [items]);

  // Available filter options
  const statuses = useMemo(() => 
    ["all", ...new Set(items.map(i => i.status).filter(Boolean))],
    [items]
  );
  
  const taskOptions = useMemo(() => {
    const options = taskGroups.map(g => ({
      id: g.task_id,
      label: `${g.task_code || ''} - ${g.task_title || 'Untitled'}`
    }));
    return [{ id: "all", label: "All tasks" }, ...options];
  }, [taskGroups]);
  
  const batchOptions = useMemo(() => {
    const batchSet = new Set(items.map(i => i.batch_name).filter(Boolean));
    return ["all", ...Array.from(batchSet)];
  }, [items]);

  // Apply filters and sorting
  const filteredTaskGroups = useMemo(() => {
    let filtered = taskGroups;
    
    // Filter by task
    if (filterTask !== "all") {
      filtered = filtered.filter(g => g.task_id === filterTask);
    }
    
    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter(g =>
        (g.task_title || "").toLowerCase().includes(q) ||
        (g.task_code || "").toLowerCase().includes(q) ||
        g.submissions.some(s =>
          (s.student_name || "").toLowerCase().includes(q) ||
          (s.student_email || "").toLowerCase().includes(q)
        )
      );
    }
    
    // Filter by status (at submission level)
    if (filterStatus !== "all") {
      filtered = filtered.map(g => ({
        ...g,
        submissions: g.submissions.filter(s => s.status === filterStatus)
      })).filter(g => g.submissions.length > 0);
    }
    
    // Filter by batch (at submission level)
    if (filterBatch !== "all") {
      filtered = filtered.map(g => ({
        ...g,
        submissions: g.submissions.filter(s => s.batch_name === filterBatch)
      })).filter(g => g.submissions.length > 0);
    }
    
    // Sort
    const sortFn = {
      newest: (a, b) => {
        const aMax = Math.max(...a.submissions.map(s => new Date(s.submitted_at || 0)));
        const bMax = Math.max(...b.submissions.map(s => new Date(s.submitted_at || 0)));
        return bMax - aMax;
      },
      oldest: (a, b) => {
        const aMin = Math.min(...a.submissions.map(s => new Date(s.submitted_at || 0)));
        const bMin = Math.min(...b.submissions.map(s => new Date(s.submitted_at || 0)));
        return aMin - bMin;
      },
      task: (a, b) => (a.task_title || "").localeCompare(b.task_title || ""),
      students: (a, b) => b.student_count - a.student_count,
    }[sortBy] || (() => 0);
    
    return [...filtered].sort(sortFn);
  }, [taskGroups, searchQuery, filterStatus, filterTask, filterBatch, sortBy]);

  // Get submissions for selected task
  const taskSubmissions = useMemo(() => {
    if (!selectedTask) return [];
    
    const group = taskGroups.find(g => g.task_id === selectedTask.task_id);
    if (!group) return [];
    
    let submissions = [...group.submissions];
    
    // Apply status filter
    if (filterStatus !== "all") {
      submissions = submissions.filter(s => s.status === filterStatus);
    }
    
    // Apply batch filter
    if (filterBatch !== "all") {
      submissions = submissions.filter(s => s.batch_name === filterBatch);
    }
    
    // Apply search filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      submissions = submissions.filter(s =>
        (s.student_name || "").toLowerCase().includes(q) ||
        (s.student_email || "").toLowerCase().includes(q) ||
        (s.submission_code || "").toLowerCase().includes(q)
      );
    }
    
    // Sort
    const sortFn = {
      newest: (a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0),
      oldest: (a, b) => new Date(a.submitted_at || 0) - new Date(b.submitted_at || 0),
      student: (a, b) => (a.student_name || "").localeCompare(b.student_name || ""),
      status: (a, b) => (a.status || "").localeCompare(b.status || ""),
    }[sortBy] || (() => 0);
    
    return submissions.sort(sortFn);
  }, [selectedTask, taskGroups, filterStatus, filterBatch, searchQuery, sortBy]);

  // Navigation handlers
  const handleTaskClick = (taskGroup) => {
    setSelectedTask(taskGroup);
    setViewMode(VIEW_MODES.TASK_STUDENTS);
    setSelectedSubmission(null);
  };

  const handleSubmissionClick = (submission) => {
    setSelectedSubmission(submission);
    setViewMode(VIEW_MODES.STUDENT_DETAIL);
  };

  const handleBack = () => {
    if (viewMode === VIEW_MODES.STUDENT_DETAIL) {
      setViewMode(VIEW_MODES.TASK_STUDENTS);
      setSelectedSubmission(null);
    } else if (viewMode === VIEW_MODES.TASK_STUDENTS) {
      setViewMode(VIEW_MODES.TASKS);
      setSelectedTask(null);
      setSelectedSubmission(null);
    }
  };

  const handleReviewed = (nextStatus) => {
    setViewMode(VIEW_MODES.TASK_STUDENTS);
    setSelectedSubmission(null);
    setNotice(`Review saved (${nextStatus}). List refreshed.`);
    load();
  };

  if (loading) return <div className="portal-loading"><div className="loader-dot" /><h2>Loading submissions</h2><p>Fetching student work.</p></div>;

  return (
    <div className="admin-simple page-enter">
      <div className="simple-head">
        <span>{eyebrow}</span>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      
      {error && <div className="error-msg">{error} <button onClick={load}>Retry</button></div>}
      {notice && <div className="info-msg">{notice}</div>}

      {/* Filters and Search */}
      <section className="panel">
        <div className="panel-head chart-head">
          <div>
            <span className="section-kicker">
              {viewMode === VIEW_MODES.TASKS && "TASK-WISE VIEW"}
              {viewMode === VIEW_MODES.TASK_STUDENTS && `STUDENTS FOR: ${selectedTask?.task_code || ''} ${selectedTask?.task_title || ''}`}
              {viewMode === VIEW_MODES.STUDENT_DETAIL && "SUBMISSION DETAIL"}
            </span>
            <h3>
              {viewMode === VIEW_MODES.TASKS && `${filteredTaskGroups.length} task${filteredTaskGroups.length === 1 ? '' : 's'} with submissions`}
              {viewMode === VIEW_MODES.TASK_STUDENTS && `${taskSubmissions.length} student${taskSubmissions.length === 1 ? '' : 's'}`}
              {viewMode === VIEW_MODES.STUDENT_DETAIL && selectedSubmission?.student_name}
            </h3>
          </div>
          <div className="chart-tabs">
            {(viewMode === VIEW_MODES.TASK_STUDENTS || viewMode === VIEW_MODES.STUDENT_DETAIL) && (
              <button onClick={handleBack}>← Back</button>
            )}
            <input 
              value={searchQuery} 
              onChange={e => setSearchQuery(e.target.value)} 
              placeholder={viewMode === VIEW_MODES.TASKS ? "Search tasks or students…" : "Search students…"} 
              aria-label="Search" 
            />
            {viewMode === VIEW_MODES.TASKS && (
              <select value={filterTask} onChange={e => setFilterTask(e.target.value)} aria-label="Filter by task">
                {taskOptions.map(opt => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
              </select>
            )}
            <select value={filterBatch} onChange={e => setFilterBatch(e.target.value)} aria-label="Filter by batch">
              <option value="all">All batches</option>
              {batchOptions.filter(b => b !== "all").map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} aria-label="Filter by status">
              {statuses.map(s => <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>)}
            </select>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)} aria-label="Sort">
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              {viewMode === VIEW_MODES.TASKS && <option value="students">Most students</option>}
              {viewMode === VIEW_MODES.TASKS && <option value="task">Task A–Z</option>}
              {viewMode === VIEW_MODES.TASK_STUDENTS && <option value="student">Student A–Z</option>}
              {viewMode === VIEW_MODES.TASK_STUDENTS && <option value="status">Status A–Z</option>}
            </select>
            <button onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
          </div>
        </div>

        {/* Task-wise view */}
        {viewMode === VIEW_MODES.TASKS && (
          filteredTaskGroups.length ? (
            <div className="submission-list">
              {filteredTaskGroups.map(taskGroup => (
                <button 
                  className="submission-row" 
                  key={taskGroup.task_id} 
                  onClick={() => handleTaskClick(taskGroup)}
                  style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
                >
                  <div className="submission-avatar">📋</div>
                  <div>
                    <strong>{taskGroup.task_code || 'No code'} - {taskGroup.task_title || 'Untitled task'}</strong>
                    <small>
                      {taskGroup.student_count} student{taskGroup.student_count === 1 ? '' : 's'} submitted · 
                      {taskGroup.submissions.length} total submission{taskGroup.submissions.length === 1 ? '' : 's'} · 
                      {taskGroup.total_files} file{taskGroup.total_files === 1 ? '' : 's'}
                    </small>
                    {taskGroup.task_description && (
                      <small style={{ opacity: 0.7 }}>
                        {taskGroup.task_description.slice(0, 100)}
                        {taskGroup.task_description.length > 100 ? '…' : ''}
                      </small>
                    )}
                  </div>
                  <span className={`pill ${(taskGroup.workflow_status || '').toLowerCase().replace(/\s+/g, '_')}`}>
                    {taskGroup.workflow_status || 'Active'}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              {items.length 
                ? "No tasks match your filters." 
                : "No student submissions yet. Submitted work will appear here."}
            </div>
          )
        )}

        {/* Task students view */}
        {viewMode === VIEW_MODES.TASK_STUDENTS && (
          taskSubmissions.length ? (
            <div className="submission-list">
              {taskSubmissions.map(submission => (
                <button 
                  className="submission-row" 
                  key={submission.id} 
                  onClick={() => handleSubmissionClick(submission)}
                  style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
                >
                  <div className="submission-avatar">
                    {(submission.student_name || "S").charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <strong>{submission.student_name || "Unknown student"}</strong>
                    <small>
                      {submission.student_email || "No email"} · 
                      {submission.batch_name || "No batch"} · 
                      v{submission.version || 1} · 
                      {formatDateTime(submission.submitted_at)}
                    </small>
                    <small>
                      {submission.submission_code || "No code"} · 
                      {submission.file_count || 0} file{(submission.file_count || 0) === 1 ? '' : 's'}
                      {submission.comment && ` · ${submission.comment.slice(0, 60)}${submission.comment.length > 60 ? '…' : ''}`}
                    </small>
                  </div>
                  <span className={`pill ${(submission.status || '').toLowerCase().replace(/\s+/g, '_')}`}>
                    {submission.status || 'Submitted'}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              No students match your filters for this task.
            </div>
          )
        )}

        {/* Student detail view */}
        {viewMode === VIEW_MODES.STUDENT_DETAIL && selectedSubmission && (
          <DetailModal 
            item={selectedSubmission} 
            onClose={handleBack}
            onReviewed={handleReviewed}
            inline={true}
          />
        )}
      </section>
    </div>
  );
}

export { downloadFile };
