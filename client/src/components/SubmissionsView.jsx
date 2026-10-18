import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import TechinsIcon from "./TechinsIcon";
import FixedOverlay from "./FixedOverlay";
import FilePreview, { isPreviewable } from "./FilePreview";
import SubmissionDetailDialog from "./SubmissionDetailDialog";
import { formatWorkspaceDateTime, pluralise } from "../utils/dateHelper";
import { STATUS_LABEL, API_URL, apiFetch, downloadFile, taskTitle } from "../utils/api";
import StatusBadge from "./StatusBadge";
import "../styles/ceo-ui.css";
import "./SubmissionsView.css";

/**
 * CEO Student Submissions page.
 *
 * Every value on screen comes from GET /api/tasks/submissions. The page never
 * derives a status, an identifier or a count itself: a missing value renders as
 * an em dash, never as a fabricated one.
 *
 * Rows are grouped by student + task so one learner's three versions read as
 * one block instead of three unexplained repeats, while every version still
 * keeps its own row. View Details opens SubmissionDetailDialog, which loads by
 * the submission's own id.
 */

/**
 * Return the DB ObjectId for routing/API calls.
 * The TECHINS display code is for display only and may be null; the DB ObjectId
 * is the stable identifier for lookups.
 *
 * Guards the string forms of "no id" as well: a submission whose student
 * reference is missing serializes to the literal text "null"/"undefined",
 * which is truthy and would otherwise be sent on as a real id and produce
 * /admin/students/null. Returns null in every unusable case so the caller can
 * show an error instead of calling the API.
 */
export function getStudentRouteId(submission) {
  const raw = submission?.student_db_id || submission?.student_id || "";
  const id = String(raw).trim();
  if (!id || id === "null" || id === "undefined") return null;
  return id;
}

/** Stable key for one student's work on one task. */
const groupKey = (item) => `${item.student_db_id || item.student_id || "unknown"}::${item.task_id || "unknown"}`;

/**
 * One em dash for every absent value, never a placeholder string.
 *
 * `Not available` is reserved for a field the API does not carry for this
 * record at all. GET /api/tasks/submissions does return student_id,
 * student_code, student_name, student_email, student_department,
 * student_program and batch_name — but every one of them is null when the
 * submission points at a student record that has since been deleted. That is
 * genuinely missing data, so it is stated plainly rather than shown as a bare
 * dash the reader has to interpret.
 */
const dash = (value) => (value === null || value === undefined || value === "" ? "—" : value);
const NA = <span className="ui-na">Not available</span>;
const meta = (value) => (value === null || value === undefined || value === "" ? NA : value);

export default function SubmissionsView({ eyebrow, title, subtitle }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterBatch, setFilterBatch] = useState("all");
  const [filterStudent, setFilterStudent] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [requirementTarget, setRequirementTarget] = useState(null);
  const [requirementDesc, setRequirementDesc] = useState("");
  const [requirementError, setRequirementError] = useState("");
  const [submittingRequirement, setSubmittingRequirement] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  /**
   * Which response cells are expanded past the clamp. Keyed by submission id so
   * two rows never share a toggle. Starts closed: every response renders at the
   * same 3-line height, which is what made the column line up row to row.
   */
  const [expanded, setExpanded] = useState(() => new Set());

  const toggleExpanded = (id) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/tasks/submissions?limit=500");
      setItems(res?.data?.submissions ?? res?.submissions ?? []);
    } catch (e) {
      setError(e.message || "Unable to load submissions. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const exportToExcel = async () => {
    if (exporting) return;
    setExporting(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filterStatus !== "all") params.append("status", filterStatus);
      if (filterBatch !== "all") params.append("batch_name", filterBatch);
      const queryString = params.toString();
      // The workbook is binary, so it is fetched with the Authorization header
      // and saved as a blob rather than run through apiFetch (which parses JSON).
      const res = await fetch(`${API_URL}/api/admin/export/task-wise${queryString ? `?${queryString}` : ""}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (!res.ok) {
        let message = `Export failed (${res.status}).`;
        try { message = (await res.json()).message || message; } catch { /* keep default */ }
        throw new Error(message);
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `TECHINS_Student_Task_Submissions_${new Date().toISOString().split("T")[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setNotice("Excel file downloaded successfully (task-wise report).");
    } catch (e) {
      setError(e.message || "Unable to export submissions. Check your connection.");
    } finally {
      setExporting(false);
    }
  };

  const statuses = useMemo(() => {
    const set = new Set(items.map(i => i.status).filter(Boolean));
    return ["all", ...Array.from(set)];
  }, [items]);

  const batches = useMemo(() => {
    const set = new Set(items.map(i => i.batch_name).filter(Boolean));
    return ["all", ...Array.from(set)];
  }, [items]);

  const students = useMemo(() => {
    const map = new Map();
    for (const i of items) {
      const key = i.student_db_id || i.student_id;
      if (!key) continue;
      if (!map.has(key)) map.set(key, { key, name: i.student_name || "Unknown", code: i.student_id });
    }
    return Array.from(map.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [items]);

  const filteredSubmissions = useMemo(() => {
    let filtered = [...items];
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter(item =>
        (item.student_name || "").toLowerCase().includes(q)
        || (item.student_email || "").toLowerCase().includes(q)
        || (item.task_title || "").toLowerCase().includes(q)
        || (item.task_code || "").toLowerCase().includes(q)
        || (item.submission_code || "").toLowerCase().includes(q)
        || (item.student_id || "").toLowerCase().includes(q)
      );
    }
    if (filterStatus !== "all") filtered = filtered.filter(item => item.status === filterStatus);
    if (filterBatch !== "all") filtered = filtered.filter(item => item.batch_name === filterBatch);
    if (filterStudent !== "all") filtered = filtered.filter(item => (item.student_db_id || item.student_id) === filterStudent);
    const sortFn = {
      newest: (a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0),
      oldest: (a, b) => new Date(a.submitted_at || 0) - new Date(b.submitted_at || 0),
      student: (a, b) => (a.student_name || "").localeCompare(b.student_name || "") || (a.version || 0) - (b.version || 0),
      task: (a, b) => (a.task_title || "").localeCompare(b.task_title || "") || (a.student_name || "").localeCompare(b.student_name || ""),
      status: (a, b) => (a.status || "").localeCompare(b.status || ""),
    }[sortBy] || (() => 0);
    return filtered.sort(sortFn);
  }, [items, searchQuery, filterStatus, filterBatch, filterStudent, sortBy]);

  /**
   * Group into student + task blocks. Every version keeps its own row, and the
   * block header carries the identity once so a learner with three versions is
   * not confusingly repeated three times over.
   */
  const groups = useMemo(() => {
    const map = new Map();
    for (const item of filteredSubmissions) {
      const key = groupKey(item);
      if (!map.has(key)) {
        map.set(key, {
          key,
          student: item,
          versions: [item],
          latest: item.version || 1,
          hasFiles: (item.file_count || 0) > 0,
        });
      } else {
        const g = map.get(key);
        g.versions.push(item);
        if ((item.version || 1) > g.latest) g.latest = item.version || 1;
        if ((item.file_count || 0) > 0) g.hasFiles = true;
      }
    }
    return Array.from(map.values());
  }, [filteredSubmissions]);

  const toggleGroup = (key) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError("");
    try {
      const routeId = getStudentRouteId(deleteTarget);
      if (!routeId) {
        setError("This submission has no linked student record.");
        setDeleteTarget(null);
        return;
      }
      await apiFetch(`/api/admin/students/${encodeURIComponent(routeId)}`, { method: "DELETE" });
      setNotice(`${deleteTarget.student_name} deleted.`);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(e.message || "An error occurred");
    } finally {
      setDeleting(false);
    }
  };

  const submitRequirement = async (e) => {
    e.preventDefault();
    if (!requirementTarget) return;
    setSubmittingRequirement(true);
    setRequirementError("");
    setError("");
    try {
      const routeId = getStudentRouteId(requirementTarget);
      if (!routeId) {
        setRequirementError("This submission has no linked student record.");
        setRequirementTarget(null);
        return;
      }
      await apiFetch(`/api/admin/students/${encodeURIComponent(routeId)}/requirement`, {
        method: "POST",
        body: { description: requirementDesc },
      });
      setNotice(`Requirement created for ${requirementTarget.student_name}.`);
      setRequirementTarget(null);
      setRequirementDesc("");
    } catch (err) {
      setRequirementError(err.message || "Unable to create the requirement.");
    } finally {
      setSubmittingRequirement(false);
    }
  };

  const handleDownload = async (file) => {
    try {
      await downloadFile(file);
    } catch (e) {
      setError(e.message || "Unable to download this file.");
    }
  };

  /**
   * Status chip from the shared vocabulary. `review_status` wins over `status`
   * when present because it is the reviewer's verdict; `status` is the
   * submission's own. The underlying value is never rewritten — only the tone
   * and the label are chosen.
   */
  const statusPill = (item) => (
    <StatusBadge
      status={item.review_status || item.status}
      label={item.status || STATUS_LABEL[item.review_status] || "Submitted"}
    />
  );

  return (
    <div className="admin-simple page-enter">
      <div className="simple-head">
        <span>{eyebrow}</span>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>

      {error && (
        <div className="error-msg" role="alert">
          <span>{error}</span>
          <button type="button" onClick={load}>Retry</button>
        </div>
      )}

      {notice && <div className="info-msg" role="status">{notice}</div>}

      <section className="panel">
        {/* Search, filters and Refresh share one wrapping row at one control
            height. */}
        <div className="panel-head ui-toolbar">
          <div>
            <span className="section-kicker">SUBMISSION RECORDS</span>
            <h3>
              {pluralise(filteredSubmissions.length, "submission")}
              {" · "}
              {pluralise(groups.length, "student/task group")}
            </h3>
          </div>
          <div className="chart-tabs ui-toolbar-controls">
            <input
              className="ui-input"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search student, task, email…"
              aria-label="Search submissions"
            />
            <select className="ui-select" value={filterStudent} onChange={e => setFilterStudent(e.target.value)} aria-label="Filter by student">
              <option value="all">All students</option>
              {students.map(s => <option key={s.key} value={s.key}>{s.code ? `${s.name} (${s.code})` : s.name}</option>)}
            </select>
            <select className="ui-select" value={filterBatch} onChange={e => setFilterBatch(e.target.value)} aria-label="Filter by batch">
              <option value="all">All batches</option>
              {batches.filter(b => b !== "all").map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <select className="ui-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} aria-label="Filter by status">
              {statuses.map(s => <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>)}
            </select>
            <select className="ui-select" value={sortBy} onChange={e => setSortBy(e.target.value)} aria-label="Sort by">
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="student">Student A–Z</option>
              <option value="task">Task A–Z</option>
              <option value="status">Status A–Z</option>
            </select>
            <button type="button" className="ui-btn ui-btn--neutral" onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
            <button type="button" className="ui-btn ui-btn--info" onClick={exportToExcel} disabled={exporting || loading}>
              <TechinsIcon name="chart" size={15} variant="light" ariaHidden />
              <span>{exporting ? "Exporting…" : "Export to Excel"}</span>
            </button>
          </div>
        </div>

        {loading && items.length === 0 && (
          <div className="submissions-skeleton" aria-hidden="true">
            {Array.from({ length: 5 }).map((_, n) => <div key={n} className="sk-row" />)}
          </div>
        )}

        {!loading && filteredSubmissions.length > 0 && (
          <div className="submissions-table-wrapper ui-table-wrap">
            <table className="submissions-table ui-table">
              {/* Explicit widths. With `table-layout: auto` the browser gave the
                  Response and Files columns whatever width was left over, so
                  the Actions column ran past the right edge of the viewport
                  and "Delete" was clipped. Fixed layout + min-width means the
                  wrapper scrolls instead. */}
              <colgroup>
                <col className="col-student-name" />
                <col className="col-task" />
                <col className="col-response" />
                <col className="col-files" />
                <col className="col-submitted" />
                <col className="col-status" />
                <col className="col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>Version / ID</th>
                  <th>Task</th>
                  <th>Response</th>
                  <th>Files</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(group => {
                  const head = group.student;
                  const isCollapsed = collapsed.has(group.key);
                  return (
                    /* A Fragment, not a nested <tbody>: nested table sections are
                       invalid HTML and the parser hoists them out of the table. */
                    <Fragment key={group.key}>
                      {/* Identity row: name + code + department/program/batch + version count */}
                      <tr className="sv-group-head">
                        <td colSpan={7}>
                          <div className="sv-group-lead">
                            <div className="student-avatar">{((head.student_name || "S").charAt(0) || "S").toUpperCase()}</div>
                            <div className="sv-group-identity">
                              <strong>{head.student_name || "Unknown student"}</strong>
                              {/* Wrapping label:value pairs. The values were
                                  #6b7691 on a #0d1220 surface — about 3.4:1,
                                  below AA for body text. */}
                              <span className="sv-group-meta">
                                <span>ID: <b>{meta(head.student_id)}</b></span>
                                <span>Email: <b>{meta(head.student_email)}</b></span>
                                <span>Department: <b>{meta(head.student_department)}</b></span>
                                <span>Program: <b>{meta(head.student_program)}</b></span>
                                <span>Batch: <b>{meta(head.batch_name)}</b></span>
                              </span>
                            </div>
                            {/* `flex: 0 0 auto` on .sv-group-right plus the
                                head cell's own right padding is what keeps the
                                version badge fully inside the header; it used
                                to be cut off by the table's right edge. */}
                            <div className="sv-group-right">
                              <span className="sv-version-badge">
                                {pluralise(group.versions.length, "version")}
                                {" · latest v"}{group.latest}
                              </span>
                              {group.versions.length > 1 && (
                                <button type="button" className="ui-btn ui-btn--neutral" onClick={() => toggleGroup(group.key)} aria-expanded={!isCollapsed}>
                                  {isCollapsed ? "Show versions" : "Hide versions"}
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="sv-group-task">
                            {head.task_code && <span className="task-code">{head.task_code}</span>}
                            <span className="sv-group-task-title" title={head.task_title || "Untitled task"}>{taskTitle(head.task_title) || "Untitled task"}</span>
                          </div>
                        </td>
                      </tr>

                      {!isCollapsed && group.versions.map(item => (
                        <tr key={item.id} className="sv-version-row">
                          <td className="student-name">
                            <div className="student-name-text">
                              <strong>v{item.version || 1}</strong>
                              <small className="sv-wrap" title={item.submission_code || ""}>{item.submission_code || "—"}</small>
                            </div>
                          </td>
                          <td className="task-info">
                            <div className="task-code">{item.task_code || "No code"}</div>
                            {/* Full title in the tooltip; wraps instead of truncating. */}
                            <div className="task-title sv-wrap" title={item.task_title || "Untitled task"}>
                              {taskTitle(item.task_title) || "Untitled task"}
                            </div>
                          </td>
                          <td className="response-column">
                            {/* A uniform 3-line clamp with an explicit toggle.
                                This was a per-row <textarea> with a fixed
                                height and `overflow:auto`, so every row had its
                                own internal scrollbar at a different height
                                and short responses still reserved full box
                                space. A clamp needs no nested scrolling. */}
                            {item.comment ? (
                              <>
                                <p className={`response-text ui-clamp${expanded.has(item.id) ? " is-open" : ""}`} style={{ "--ui-clamp-lines": 3 }}>
                                  {taskTitle(item.comment)}
                                </p>
                                <button
                                  type="button"
                                  className="ui-toggle"
                                  onClick={() => toggleExpanded(item.id)}
                                  aria-expanded={expanded.has(item.id)}
                                >
                                  {expanded.has(item.id) ? "Show less" : "Show more"}
                                </button>
                              </>
                            ) : (
                              <span className="no-response">No written response</span>
                            )}
                            {item.assignment_status && (
                              <div className="submission-meta">Assignment: {item.assignment_status}</div>
                            )}
                            {item.revision_deadline && (
                              <div className="submission-meta">Resubmit by {formatWorkspaceDateTime(item.revision_deadline)}</div>
                            )}
                          </td>
                          <td className="files-column">
                            {item.file_count > 0 ? (
                              <div className="files-cell">
                                {/* A muted label, not a button. This was a
                                    full-width purple pill that read as a
                                    primary action and competed with the real
                                    action buttons in the last column. */}
                                <div className="file-count">
                                  <TechinsIcon name="folder" size={12} variant="light" ariaHidden />
                                  <span>{pluralise(item.file_count, "file")}</span>
                                </div>
                                <div className="file-list">
                                  {(item.files || []).slice(0, 3).map(f => (
                                    <div key={f.id} className="file-item">
                                      {/* Ellipsis in CSS with the full name in
                                          the tooltip; the name itself is never
                                          truncated in the data. */}
                                      <span className="file-name" title={f.name}>{f.name}</span>
                                      <div className="file-actions">
                                        <button
                                          type="button"
                                          className="file-action-btn"
                                          onClick={() => setPreviewFile(f)}
                                          title={isPreviewable(f.mime) ? `Preview ${f.name}` : `${f.name} cannot be previewed — download instead`}
                                        >
                                          <TechinsIcon name="eye" size={12} variant="light" ariaHidden />
                                          <span className="sr-only">Preview {f.name}</span>
                                        </button>
                                        <button type="button" className="file-action-btn" onClick={() => handleDownload(f)} title={`Download ${f.name}`}>
                                          <TechinsIcon name="download" size={12} variant="light" ariaHidden />
                                          <span className="sr-only">Download {f.name}</span>
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                  {item.file_count > 3 && (
                                    <button type="button" className="ui-toggle" onClick={() => setPreviewFile((item.files || [])[0])}>
                                      Show all {item.file_count} files
                                    </button>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <span className="no-files">No attachments</span>
                            )}
                          </td>
                          {/* One shared formatter, never truncated. The previous
                              `formatISTDateTime` emitted
                              "Thursday, 15 October 2026, 12:33 pm" inside a
                              nowrap cell and was cut mid-word. */}
                          <td className="timestamp-column">{formatWorkspaceDateTime(item.submitted_at)}</td>
                          <td className="status-column">{statusPill(item)}</td>
                          <td className="actions-column">
                            {/* Equal-height group, fixed order, even wrap.
                                Requirement used to drop onto a line of its own
                                because the column was too narrow for three
                                word-length labels. */}
                            <div className="ui-actions">
                              <button type="button" className="ui-btn ui-btn--primary" onClick={() => setDetailId(item.id)}>
                                View Details
                              </button>
                              <button type="button" className="ui-btn ui-btn--info" onClick={() => setRequirementTarget(item)}>
                                Requirement
                              </button>
                              <button type="button" className="ui-btn ui-btn--danger" onClick={() => setDeleteTarget(item)}>
                                <TechinsIcon name="trash" size={13} variant="light" ariaHidden />
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && filteredSubmissions.length === 0 && (
          <div className="empty-state">
            {items.length
              ? "No submissions match your filters."
              : "No student submissions yet. Submitted work will appear here."}
          </div>
        )}
      </section>

      {detailId && (
        <SubmissionDetailDialog
          submissionId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => load()}
        />
      )}

      {previewFile && <FilePreview file={previewFile} onClose={() => setPreviewFile(null)} />}

      {/* Delete confirmation — danger outlined, names exactly what will go. */}
      <FixedOverlay
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        label="Confirm delete student"
        panelClassName="fixed-overlay-panel sv-dialog"
        zIndex={1200}
      >
        <div className="panel-head">
          <h3>Delete Student</h3>
          <button type="button" className="sv-dialog-btn" onClick={() => setDeleteTarget(null)}>Close</button>
        </div>
        <div className="panel-body">
          <p className="sv-dialog-text">
            Are you sure you want to delete <strong>{deleteTarget?.student_name}</strong>
            {deleteTarget?.student_id ? ` (${deleteTarget.student_id})` : ""}?
            {" "}This action cannot be undone.
          </p>
          <p className="sv-dialog-text sv-dialog-muted">
            If the student has related records (tasks, submissions, missions), deletion will be blocked and you
            will be asked to deactivate instead.
          </p>
        </div>
        <div className="panel-foot">
          <button type="button" className="sv-dialog-btn" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</button>
          <button type="button" className="sv-dialog-btn sv-dialog-btn-danger" onClick={confirmDelete} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete student"}
          </button>
        </div>
      </FixedOverlay>

      {/* Requirement dialog */}
      <FixedOverlay
        open={Boolean(requirementTarget)}
        onClose={() => { setRequirementTarget(null); setRequirementDesc(""); setRequirementError(""); }}
        label="Create a requirement for this student"
        panelClassName="fixed-overlay-panel sv-dialog"
        zIndex={1200}
      >
        <div className="panel-head">
          <h3>Student Requirement</h3>
          <button type="button" className="sv-dialog-btn" onClick={() => { setRequirementTarget(null); setRequirementDesc(""); setRequirementError(""); }}>Close</button>
        </div>
        <form onSubmit={submitRequirement} className="panel-body sv-form">
          <p className="sv-dialog-text">
            Student: <strong>{requirementTarget?.student_name}</strong>
            {requirementTarget?.student_id ? ` (${requirementTarget.student_id})` : ""}
          </p>
          <label className="sv-dialog-label" htmlFor="sv-requirement">Description <span className="sv-req">*</span></label>
          <textarea
            id="sv-requirement"
            value={requirementDesc}
            onChange={(e) => { setRequirementDesc(e.target.value); setRequirementError(""); }}
            placeholder="Describe the requirement or issue…"
            rows={4}
            required
            maxLength={1000}
          />
          {requirementError && <small className="field-error">{requirementError}</small>}
          <div className="sv-form-actions">
            <button type="submit" className="sv-dialog-btn sv-dialog-btn-primary" disabled={submittingRequirement}>
              {submittingRequirement ? "Submitting…" : "Submit Requirement"}
            </button>
          </div>
        </form>
      </FixedOverlay>
    </div>
  );
}