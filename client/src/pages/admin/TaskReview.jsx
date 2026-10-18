import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import TechinsIcon from "../../components/TechinsIcon";
import useModalBehavior from "../../components/useModalBehavior";
import { formatISTDateTime, formatISTDateShort } from "../../utils/dateHelper";
import {
  STATUS_LABEL,
  apiFetch,
  downloadFile,
  fetchFileObjectUrl,
  formatBytes,
  remainingTime,
  statusClass,
  taskTitle,
  titleCase,
  unwrap,
} from "../../utils/api";
import "../../styles/admin.css";
import "./TaskReview.css";

/**
 * TASK MANAGER — dedicated review page.
 *
 * Reached from /admin/tasks (and /manager/tasks) through the row action. It is
 * a ROUTE, not a modal over the Assign Task form, so:
 *   - it has its own URL that survives a refresh and can be shared/bookmarked;
 *   - it is never confused with the create/edit form behind it;
 *   - the dialogs it does open (Request Revision, confirmations, file preview)
 *     use the shared modal hook: Escape closes, focus is trapped and moved,
 *     the body scroll is locked, and focus returns to the trigger on close.
 *
 * Every number and every row comes from the backend aggregation
 * (GET /api/tasks/:taskId/review and its tab endpoints). The page never
 * derives a count, a status or a deadline itself.
 */

const TABS = [
  { key: "details", label: "Task Details", endpoint: null },
  { key: "submitted", label: "Submitted", endpoint: "submitted", bucket: "submitted" },
  { key: "pending", label: "Pending", endpoint: "pending", bucket: "pending" },
  { key: "in-progress", label: "In Progress", endpoint: "in-progress", bucket: "in_progress" },
];

/** tab -> which counts[] its badge reads.
 *  The Submitted tab lists every student who handed work in (whatever their
 *  review status), so its badge reads `submitters` — the distinct-submitter
 *  count — not the `submitted` bucket, which excludes students already sent
 *  back for revision. Approved / Revision / Expired have their own chips in
 *  the header and their own filter inside the Submitted tab. */
const TAB_COUNT_KEY = {
  submitted: "submitters",
  pending: "pending",
  "in-progress": "in_progress",
};

const PREVIEWABLE = (mime) =>
  /^image\/(png|jpeg|gif|webp)$/.test(mime || "") || mime === "application/pdf";

function SkeletonRows({ count = 5 }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => <div className="tm-skeleton-row" key={i} />)}
    </div>
  );
}

function StatusChip({ status }) {
  return <span className={`st ${statusClass(status)}`}>{STATUS_LABEL[status] || STATUS_LABEL.pending}</span>;
}

function ErrorState({ message, onRetry, busy }) {
  return (
    <div className="tm-error" role="alert">
      <div>
        <strong>Something went wrong</strong>
        <span>{message}</span>
      </div>
      {onRetry && (
        <button type="button" className="tm-btn" onClick={onRetry} disabled={busy}>
          {busy ? "Retrying…" : "Retry"}
        </button>
      )}
    </div>
  );
}

/* ── Request Revision dialog ────────────────────────────────────────────────
 * Feedback is MANDATORY here (min 10 characters). Approve never needs it.
 * The same minimum is enforced on the server, so this is UX, not security.
 */
function RevisionDialog({ studentName, onClose, onSubmit }) {
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useModalBehavior(true, onClose);
  const MIN = 10;

  const submit = async () => {
    const value = feedback.trim();
    if (!value) return setError("Tell the student what needs to change.");
    if (value.length < MIN) return setError(`Write at least ${MIN} characters so the student knows what to fix (currently ${value.length}).`);
    setBusy(true);
    setError("");
    try {
      await onSubmit(value);
    } catch (e) {
      setError(e.message || "Unable to request the revision.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tm-dialog-backdrop" ref={dialogRef} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tm-dialog" role="dialog" aria-modal="true" aria-labelledby="tm-rev-dialog-title">
        <h3 id="tm-rev-dialog-title">Request a revision</h3>
        <p>
          {studentName} keeps their original submission and all its history. They will be able to
          resubmit once, within 24 hours of this request.
        </p>
        <label className="tm-label" htmlFor="tm-rev-feedback">Feedback for the student (required)</label>
        <textarea
          id="tm-rev-feedback"
          className="tm-textarea"
          value={feedback}
          onChange={(e) => { setFeedback(e.target.value); if (error) setError(""); }}
          placeholder="Explain exactly what must be corrected…"
          aria-describedby="tm-rev-hint"
        />
        <p className={`tm-hint ${error ? "tm-hint-error" : feedback.trim().length >= MIN ? "tm-hint-ok" : ""}`} id="tm-rev-hint">
          {error || `${feedback.trim().length}/${MIN} characters minimum.`}
        </p>
        <div className="tm-dialog-actions">
          <button type="button" className="tm-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="tm-btn tm-btn-revise" onClick={submit} disabled={busy}>
            {busy ? "Sending…" : "Request revision"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Confirmation dialog ──────────────────────────────────────────────────── */
function ConfirmDialog({ title, description, confirmLabel, destructive, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useModalBehavior(true, onClose);

  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch (e) {
      setError(e.message || "The action could not be completed.");
      setBusy(false);
    }
  };

  return (
    <div className="tm-dialog-backdrop" ref={dialogRef} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="tm-confirm-title">
        <h3 id="tm-confirm-title">{title}</h3>
        <p>{description}</p>
        {error && <div className="tm-error" role="alert"><span>{error}</span></div>}
        <div className="tm-dialog-actions">
          <button type="button" className="tm-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            className={`tm-btn ${destructive ? "tm-btn-danger" : "tm-btn-primary"}`}
            onClick={confirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── File preview dialog ────────────────────────────────────────────────────
 * Bytes always come from the authenticated endpoint, so nothing is ever
 * loaded from a public storage URL.
 */
function PreviewDialog({ file, onClose }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const objectUrlRef = useRef(null);
  const dialogRef = useModalBehavior(true, onClose);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const objectUrl = await fetchFileObjectUrl(file.preview_url || file.download_url);
        if (cancelled) { URL.revokeObjectURL(objectUrl); return; }
        objectUrlRef.current = objectUrl;
        setUrl(objectUrl);
      } catch (e) {
        if (!cancelled) setError(e.message || "Unable to preview this file.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current); };
  }, [file]);

  const isImage = /^image\//.test(file.mime || "");

  return (
    <div className="tm-dialog-backdrop" ref={dialogRef} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tm-dialog" style={{ width: "min(1000px, 100%)" }} role="dialog" aria-modal="true" aria-labelledby="tm-preview-title">
        <div className="panel-head" style={{ marginBottom: 12 }}>
          <div>
            <span className="section-kicker">FILE PREVIEW</span>
            <h3 id="tm-preview-title" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{file.name}</h3>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="tm-btn" onClick={() => downloadFile(file).catch((e) => setError(e.message))}>
              <TechinsIcon name="download" size={13} variant="light" ariaHidden /> Download
            </button>
            <button type="button" className="tm-btn" onClick={onClose}>Close</button>
          </div>
        </div>

        {loading && <SkeletonRows count={3} />}
        {!loading && error && <div className="tm-error" role="alert"><span>{error}</span></div>}
        {!loading && !error && url && (
          <div className="tm-preview">
            <div className="tm-preview-head">
              <span>{file.name}{file.size ? ` · ${formatBytes(file.size)}` : ""}</span>
              <span>{file.mime}</span>
            </div>
            <div className="tm-preview-body">
              {isImage
                ? <img src={url} alt={file.name} />
                : file.mime === "application/pdf"
                  ? <iframe src={url} title={`Preview of ${file.name}`} />
                  : /^text\/plain$/.test(file.mime || "")
                    ? <TextPreview url={url} />
                    : <p style={{ padding: 16, color: "#9aa6c2", fontSize: 13 }}>
                        This file type cannot be shown inline. Use Download to open it.
                      </p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Plain-text preview: read the blob we already hold, never a second request. */
function TextPreview({ url }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((r) => r.text())
      .then((t) => { if (!cancelled) setText(t.slice(0, 200000)); })
      .catch(() => { if (!cancelled) setError("Unable to read this text file."); });
    return () => { cancelled = true; };
  }, [url]);
  if (error) return <p style={{ padding: 16, color: "#ffd9e2", fontSize: 13 }}>{error}</p>;
  return <pre>{text}</pre>;
}

/* ── Submission viewer (one student's exact submission) ──────────────────── */
function SubmissionViewer({ taskId, studentId, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(null);
  const [revisionFor, setRevisionFor] = useState(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const dialogRef = useModalBehavior(true, onClose);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/tasks/${taskId}/review/assignments/${studentId}`);
      setDetail(unwrap(res));
    } catch (e) {
      setError(e.message);
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [taskId, studentId]);

  useEffect(() => { load(); }, [load]);

  const latest = detail?.latest || null;
  const assignment = detail?.assignment || null;
  const student = detail?.student || null;
  const status = assignment?.status;

  const doApprove = async () => {
    setBusy("approve");
    try {
      const res = await apiFetch(`/api/tasks/${taskId}/review/approve`, { method: "POST", body: { studentId } });
      setNotice(unwrap(res)?.message || "Submission approved.");
      setConfirmApprove(false);
      await load();
      onChanged?.();
    } finally {
      setBusy(null);
    }
  };

  const doRevision = async (feedback) => {
    setBusy("revision");
    const res = await apiFetch(`/api/tasks/${taskId}/review/request-revision`, {
      method: "POST",
      body: { studentId, feedback },
    });
    setRevisionFor(null);
    setNotice(unwrap(res)?.message || "Revision requested.");
    await load();
    onChanged?.();
    setBusy(null);
  };

  return (
    <div className="tm-dialog-backdrop" ref={dialogRef} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tm-dialog" style={{ width: "min(1120px, 100%)" }} role="dialog" aria-modal="true" aria-labelledby="tm-viewer-title">
        <div className="panel-head" style={{ marginBottom: 14 }}>
          <div style={{ minWidth: 0 }}>
            <span className="section-kicker">SUBMISSION REVIEW</span>
            <h3 id="tm-viewer-title" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {student?.student_name || "Student"}
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#9aa6c2" }}>
              {student?.student_code || "—"} · {student?.student_email || "—"}
              {student?.student_department ? ` · ${student.student_department}` : ""}
              {student?.student_program ? ` · ${titleCase(student.student_program)}` : ""}
              {student?.batch_name ? ` · ${student.batch_name}` : ""}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {status && <StatusChip status={status} />}
            {assignment?.overdue && <span className="tm-chip tm-chip-overdue">Overdue</span>}
            <button type="button" className="tm-btn" onClick={onClose}>Close</button>
          </div>
        </div>

        {notice && <div className="tm-notice" role="status" style={{ marginBottom: 12 }}>{notice}</div>}
        {fileError && <div style={{ marginBottom: 12 }}><ErrorState message={fileError} onRetry={() => setFileError("")} /></div>}
        {loading && <SkeletonRows count={4} />}
        {!loading && error && <ErrorState message={error} onRetry={load} busy={loading} />}

        {!loading && !error && detail && (
          <div className="tm-viewer">
            <div className="tm-viewer-grid">
              {/* LEFT: what the student handed in */}
              <div>
                <div className="tm-section">
                  <h4>Latest submission</h4>
                  {!latest ? (
                    <div className="tm-empty">
                      <strong>Nothing submitted yet</strong>
                      <p>This student has not handed in any work for this task.</p>
                    </div>
                  ) : (
                    <>
                      <div className="tm-grid" style={{ marginBottom: 12 }}>
                        <div className="tm-field"><span>Version</span><strong>v{latest.version}</strong></div>
                        <div className="tm-field"><span>Submission code</span><strong>{latest.submission_code || "—"}</strong></div>
                        <div className="tm-field"><span>Submitted at</span><strong>{formatISTDateTime(latest.submitted_at)}</strong></div>
                        <div className="tm-field"><span>Review status</span><strong>{latest.status_label || STATUS_LABEL[latest.status]}</strong></div>
                      </div>

                      <span className="tm-comment-label">Submission comment</span>
                      <p className="tm-comment">{latest.comment || "No submission comment was provided."}</p>

                      <div style={{ marginTop: 14 }}>
                        <span className="tm-comment-label">Files ({latest.files.length})</span>
                        {latest.files.length === 0 && <p className="tm-hint">No files were attached to this version.</p>}
                        {latest.files.map((f) => (
                          <div className="tm-file" key={f.id}>
                            <TechinsIcon name="folder" size={14} variant="light" ariaHidden />
                            <span className="tm-file-name">{f.name}</span>
                            {f.size ? <span className="tm-file-size">{formatBytes(f.size)}</span> : null}
                            <span style={{ display: "flex", gap: 6 }}>
                              {PREVIEWABLE(f.mime) && (
                                <button type="button" className="tm-icon-btn" onClick={() => setPreviewFile(f)}>
                                  <TechinsIcon name="eye" size={13} variant="light" ariaHidden /> Preview
                                </button>
                              )}
                              <button
                                type="button"
                                className="tm-icon-btn"
                                onClick={() => downloadFile(f).catch((e) => setFileError(e.message))}
                              >
                                <TechinsIcon name="download" size={13} variant="light" ariaHidden /> Download
                              </button>
                            </span>
                          </div>
                        ))}
                      </div>

                      {latest.review_comments && (
                        <div style={{ marginTop: 14 }}>
                          <span className="tm-comment-label">Reviewer feedback on this version</span>
                          <p className="tm-comment tm-feedback">{latest.review_comments}</p>
                          <p className="tm-hint">
                            {latest.reviewer_name || "Reviewer"} · {formatISTDateTime(latest.reviewed_at)}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Version history: every version is kept, newest first. */}
                {detail.versions.length > 1 && (
                  <div className="tm-section">
                    <h4>Version history ({detail.versions.length})</h4>
                    <ul className="tm-timeline">
                      {detail.versions.map((v) => (
                        <li key={v.id}>
                          <strong>v{v.version} · {v.status_label || STATUS_LABEL[v.status]}</strong>
                          <small>
                            {formatISTDateTime(v.submitted_at)}
                            {v.submission_code ? ` · ${v.submission_code}` : ""}
                            {(v.files || []).length ? ` · ${v.files.length} file${v.files.length === 1 ? "" : "s"}` : " · no files"}
                          </small>
                          {v.comment && <p className="tm-comment" style={{ marginTop: 8 }}>{v.comment}</p>}
                          {(v.files || []).length > 0 && (
                            <div style={{ marginTop: 8 }}>
                              {v.files.map((f) => (
                                <div className="tm-file" key={f.id} style={{ marginBottom: 6 }}>
                                  <span className="tm-file-name">{f.name}</span>
                                  {PREVIEWABLE(f.mime) && (
                                    <button type="button" className="tm-icon-btn" onClick={() => setPreviewFile(f)}>Preview</button>
                                  )}
                                  <button
                                    type="button"
                                    className="tm-icon-btn"
                                    onClick={() => downloadFile(f).catch((e) => setFileError(e.message))}
                                  >Download</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* RIGHT: assignment state + revision cycles + actions */}
              <div>
                <div className="tm-section">
                  <h4>Assignment</h4>
                  <div className="tm-grid">
                    <div className="tm-field"><span>Assigned at</span><strong>{formatISTDateTime(assignment?.assigned_at)}</strong></div>
                    <div className="tm-field"><span>Last activity</span><strong>{formatISTDateTime(assignment?.submitted_at)}</strong></div>
                    <div className="tm-field"><span>Versions submitted</span><strong>{detail.versions.length}</strong></div>
                    <div className="tm-field"><span>Revision cycles</span><strong>{assignment?.revision_cycle ?? 0}</strong></div>
                  </div>
                </div>

                {(assignment?.status === "revision_required" || assignment?.status === "resubmission_expired") && (
                  <div className={`tm-deadline ${assignment?.status === "resubmission_expired" ? "tm-deadline-closed" : ""}`}>
                    {assignment?.status === "resubmission_expired"
                      ? <span><strong>Resubmission window expired.</strong> The 24-hour window closed on {formatISTDateTime(assignment.revision_deadline)}. A new revision request will open a fresh 24-hour cycle.</span>
                      : (
                        <>
                          <span><strong>Resubmission window open.</strong> Deadline {formatISTDateTime(assignment.revision_deadline)}</span>
                          {remainingTime(assignment.revision_deadline) && (
                            <span className="tm-countdown">{remainingTime(assignment.revision_deadline).label}</span>
                          )}
                        </>
                      )}
                  </div>
                )}

                {assignment?.revision_history?.length > 0 && (
                  <div className="tm-section" style={{ marginTop: 14 }}>
                    <h4>Revision history</h4>
                    <ul className="tm-timeline">
                      {[...assignment.revision_history].reverse().map((h, i) => (
                        <li key={`${h.cycle}-${i}`}>
                          <strong>Cycle {h.cycle} · {h.status}</strong>
                          <small>
                            {/* The stored field is camelCase (requestedAt); the
                                snake_case alias is accepted so rows written by
                                any future writer still render. */}
                            Requested {formatISTDateTime(h.requestedAt || h.requested_at)} · deadline {formatISTDateTime(h.deadline)}
                            {h.resubmitted_at ? ` · resubmitted ${formatISTDateTime(h.resubmitted_at)}` : ""}
                            {h.expired_at ? ` · expired ${formatISTDateTime(h.expired_at)}` : ""}
                          </small>
                          {h.feedback && <p className="tm-comment tm-feedback" style={{ marginTop: 8 }}>{h.feedback}</p>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="tm-section" style={{ marginTop: 14 }}>
                  <h4>Actions</h4>
                  {latest ? (
                    <>
                      <p className="tm-hint" style={{ marginTop: 0, marginBottom: 12 }}>
                        These actions affect this student's submission only. They never change another student's state.
                      </p>
                      <div className="tm-row-actions" style={{ justifyContent: "flex-start" }}>
                        <button
                          type="button"
                          className="tm-btn tm-btn-approve"
                          disabled={busy !== null || status === "approved"}
                          onClick={() => setConfirmApprove(true)}
                          title={status === "approved" ? "This submission is already approved." : "Approve this student's submission"}
                        >
                          {busy === "approve" ? "Approving…" : "Approve"}
                        </button>
                        <button
                          type="button"
                          className="tm-btn tm-btn-revise"
                          disabled={busy !== null || status === "approved" || status === "revision_required"}
                          onClick={() => setRevisionFor(student)}
                        >
                          {busy === "revision" ? "Sending…" : "Request revision"}
                        </button>
                      </div>
                      {status === "revision_required" && (
                        <p className="tm-hint">A revision is already open for this student. Wait for their resubmission or let the window expire.</p>
                      )}
                      {status === "resubmission_expired" && (
                        <p className="tm-hint">The window expired. Requesting a revision again opens a NEW 24-hour cycle.</p>
                      )}
                    </>
                  ) : (
                    <p className="tm-hint" style={{ marginTop: 0 }}>Nothing to review until this student submits.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {revisionFor && (
        <RevisionDialog
          studentName={student?.student_name || "This student"}
          onClose={() => setRevisionFor(null)}
          onSubmit={doRevision}
        />
      )}
      {confirmApprove && (
        <ConfirmDialog
          title="Approve this submission?"
          description={`${student?.student_name || "This student"}'s version ${latest?.version} will be marked approved. Only their submission is affected — the other students on this task keep their own status.`}
          confirmLabel="Yes, approve"
          onClose={() => setConfirmApprove(false)}
          onConfirm={doApprove}
        />
      )}
      {previewFile && <PreviewDialog file={previewFile} onClose={() => setPreviewFile(null)} />}
    </div>
  );
}

/* ── Student detail (for Pending / In Progress rows) ─────────────────────── */
function AssignmentDetail({ taskId, studentId, onClose, onRemind, reminding }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const dialogRef = useModalBehavior(true, onClose);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDetail(unwrap(await apiFetch(`/api/tasks/${taskId}/review/assignments/${studentId}`)));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [taskId, studentId]);

  useEffect(() => { load(); }, [load]);

  const a = detail?.assignment || null;
  const s = detail?.student || null;
  const remaining = a ? remainingTime(detail.task?.due_at) : null;

  return (
    <div className="tm-dialog-backdrop" ref={dialogRef} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tm-dialog" style={{ width: "min(760px, 100%)" }} role="dialog" aria-modal="true" aria-labelledby="tm-detail-title">
        <div className="panel-head" style={{ marginBottom: 14 }}>
          <div>
            <span className="section-kicker">STUDENT &amp; ASSIGNMENT</span>
            <h3 id="tm-detail-title">{s?.student_name || "Student"}</h3>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {a && <StatusChip status={a.status} />}
            <button type="button" className="tm-btn" onClick={onClose}>Close</button>
          </div>
        </div>

        {loading && <SkeletonRows count={3} />}
        {!loading && error && <ErrorState message={error} onRetry={load} busy={loading} />}

        {!loading && !error && detail && (
          <>
            <div className="tm-section">
              <h4>Student</h4>
              <div className="tm-grid">
                <div className="tm-field"><span>Name</span><strong>{s?.student_name || "—"}</strong></div>
                <div className="tm-field"><span>Student ID</span><strong>{s?.student_code || "—"}</strong></div>
                <div className="tm-field"><span>Email</span><strong>{s?.student_email || "—"}</strong></div>
                <div className="tm-field"><span>Department</span><strong>{s?.student_department || "—"}</strong></div>
                <div className="tm-field"><span>Program</span><strong>{titleCase(s?.student_program) || "—"}</strong></div>
                <div className="tm-field"><span>Batch</span><strong>{s?.batch_name || "—"}</strong></div>
              </div>
            </div>

            <div className="tm-section">
              <h4>Task</h4>
              <div className="tm-grid">
                <div className="tm-field"><span>Task ID</span><strong>{detail.task?.task_code || "—"}</strong></div>
                <div className="tm-field"><span>Title</span><strong>{taskTitle(detail.task?.title)}</strong></div>
                <div className="tm-field"><span>Domain</span><strong>{titleCase(detail.task?.domain) || "—"}</strong></div>
                <div className="tm-field"><span>Deadline</span><strong>{formatISTDateShort(detail.task?.due_at || detail.task?.due_date)}</strong></div>
                <div className="tm-field">
                  <span>Time remaining</span>
                  <strong>{remaining ? remaining.label : "No deadline"}</strong>
                </div>
              </div>
            </div>

            <div className="tm-section">
              <h4>Assignment</h4>
              <div className="tm-grid">
                <div className="tm-field"><span>Status</span><strong>{STATUS_LABEL[a?.status] || "—"}</strong></div>
                <div className="tm-field"><span>Assigned at</span><strong>{formatISTDateTime(a?.assigned_at)}</strong></div>
                <div className="tm-field"><span>Versions submitted</span><strong>{a?.submission_version ?? 0}</strong></div>
                <div className="tm-field"><span>Last activity</span><strong>{formatISTDateTime(a?.submitted_at)}</strong></div>
              </div>
              {a?.submission_comment && (
                <div style={{ marginTop: 12 }}>
                  <span className="tm-comment-label">Last submission comment</span>
                  <p className="tm-comment">{a.submission_comment}</p>
                </div>
              )}
              {!a?.submission_comment && a?.last_activity_at == null && (
                <p className="tm-hint">No work has been started on this assignment yet.</p>
              )}
            </div>

            <div className="tm-dialog-actions">
              <button type="button" className="tm-btn" onClick={onClose}>Close</button>
              <button
                type="button"
                className="tm-btn tm-btn-primary"
                disabled={reminding}
                onClick={() => onRemind(s.student_id)}
              >
                {reminding ? "Sending…" : "Send reminder"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */
export default function TaskReview() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const [review, setReview] = useState(null);       // { task, counts, ... }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [tab, setTab] = useState("details");
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState("");
  const [batchFilter, setBatchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState("");

  const [viewer, setViewer] = useState(null);       // studentId
  const [detailFor, setDetailFor] = useState(null); // studentId
  const [selected, setSelected] = useState([]);     // pending bulk selection
  const [reminding, setReminding] = useState(false);
  const [tick, setTick] = useState(0);              // countdown refresh

  const invalidId = !taskId || taskId === "null" || taskId === "undefined";

  /* Header + counts. This is the ONLY source of the tab badges. */
  const loadReview = useCallback(async () => {
    if (invalidId) {
      setError("This review link is not valid. Open a task from the task list and try again.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setReview(unwrap(await apiFetch(`/api/tasks/${taskId}/review`)));
    } catch (e) {
      setError(e.message);
      setReview(null);
    } finally {
      setLoading(false);
    }
  }, [taskId, invalidId]);

  useEffect(() => { loadReview(); }, [loadReview, tick]);

  /* Tab rows */
  const endpoint = TABS.find((t) => t.key === tab)?.endpoint;
  const loadRows = useCallback(async () => {
    if (!endpoint || invalidId) return;
    setRowsLoading(true);
    setRowsError("");
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter) params.set("status", statusFilter);
      const data = unwrap(await apiFetch(`/api/tasks/${taskId}/review/${endpoint}?${params}`));
      setRows(data.students || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch (e) {
      setRowsError(e.message);
      setRows([]);
      setTotal(0);
    } finally {
      setRowsLoading(false);
    }
  }, [taskId, endpoint, page, search, statusFilter, invalidId]);

  useEffect(() => { loadRows(); }, [loadRows]);

  // Switching tab resets the filters that only make sense for one of them.
  useEffect(() => { setStatusFilter(""); setBatchFilter(""); setPage(1); }, [tab]);

  /* Display-only countdown for open revision windows: the deadline itself
     comes from the server and is never recomputed here. */
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  /* Refresh the aggregates after ANY action, without a full page reload. */
  const refreshAll = useCallback(async () => {
    await loadReview();
    await loadRows();
  }, [loadReview, loadRows]);

  const remind = async (studentIds) => {
    setReminding(true);
    setNotice("");
    try {
      const res = await apiFetch(`/api/tasks/${taskId}/review/remind`, {
        method: "POST",
        body: { studentIds: Array.isArray(studentIds) ? studentIds : [studentIds] },
      });
      const data = unwrap(res);
      setNotice(data?.message || "Reminder sent.");
      await loadRows();
      return data;
    } catch (e) {
      setNotice(e.message);
      throw e;
    } finally {
      setReminding(false);
      setSelected([]);
    }
  };

  const counts = review?.counts || {};
  const task = review?.task || null;
  const batchOptions = useMemo(() => {
    const names = new Set(rows.map((r) => r.batch_name).filter(Boolean));
    return [...names].sort();
  }, [rows]);

  const visibleRows = useMemo(
    () => (batchFilter ? rows.filter((r) => r.batch_name === batchFilter) : rows),
    [rows, batchFilter]
  );

  const goBack = () => {
    navigate(pathname.startsWith("/manager") ? "/manager/tasks" : "/admin/tasks");
  };

  if (invalidId) {
    return (
      <div className="tm-review">
        <div className="tm-panel">
          <ErrorState
            message="This review link is not valid. Open the task from the task list and try again."
            onRetry={() => navigate("/admin/tasks")}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="tm-review">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="tm-header">
        <button type="button" className="tm-back" onClick={goBack}>← Back to tasks</button>
        <div className="tm-header-row">
          <div style={{ minWidth: 0 }}>
            <span className="tm-code">{task?.task_code || (loading ? "Loading…" : "TASK")}</span>
            <h1 className="tm-title">{taskTitle(task?.title) || (loading ? "Loading task…" : "Untitled task")}</h1>
            <div className="tm-meta">
              {task?.domain && <span className="tm-chip">Domain <strong>{titleCase(task.domain)}</strong></span>}
              {task?.program && <span className="tm-chip">Program <strong>{titleCase(task.program)}</strong></span>}
              {task?.target_type === "batch" && task?.batch_name && <span className="tm-chip">Batch <strong>{task.batch_name}</strong></span>}
              {task?.priority && <span className="tm-chip">Priority <strong>{titleCase(task.priority)}</strong></span>}
              <span className="tm-chip">Deadline <strong>{formatISTDateTime(task?.due_at || task?.due_date)}</strong></span>
              {remainingTime(task?.due_at || task?.due_date) && (
                <span className={`tm-chip ${remainingTime(task.due_at || task.due_date).overdue ? "tm-chip-overdue" : ""}`}>
                  {remainingTime(task.due_at || task.due_date).label}
                </span>
              )}
            </div>
          </div>
          <button type="button" className="tm-btn" onClick={refreshAll} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {error && <ErrorState message={error} onRetry={loadReview} busy={loading} />}
      {notice && <div className="tm-notice" role="status">{notice}</div>}

      {/* ── Counts: one row, one source ─────────────────────────────────── */}
      {review && (
        <div className="tm-counts" aria-label="Task status counts">
          {[
            ["Assigned", counts.assigned, null],
            ["Pending", counts.pending, "pending"],
            ["In Progress", counts.in_progress, "in-progress"],
            ["Submitted", counts.submitted, "submitted"],
            ["Approved", counts.approved, "submitted"],
            ["Revision Required", counts.revision_required, "submitted"],
            ["Resubmission Expired", counts.resubmission_expired, "submitted"],
            ["Overdue", counts.overdue, null],
          ].map(([label, value, targetTab]) => (
            <button
              key={label}
              type="button"
              className="tm-count"
              onClick={() => { if (targetTab) { setTab(targetTab); setPage(1); } }}
              disabled={!targetTab}
              style={targetTab ? undefined : { cursor: "default" }}
              title={targetTab ? `Show ${label.toLowerCase()}` : undefined}
            >
              <span>{label}</span>
              <strong>{value ?? 0}</strong>
            </button>
          ))}
        </div>
      )}

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <div className="tm-tabs" role="tablist" aria-label="Task review sections">
        {TABS.map((t) => {
          const count = t.endpoint ? counts[TAB_COUNT_KEY[t.key]] : null;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`tm-tab-${t.key}`}
              aria-controls={`tm-panel-${t.key}`}
              aria-selected={tab === t.key}
              className="tm-tab"
              onClick={() => { setTab(t.key); setPage(1); }}
            >
              {t.label}
              {t.endpoint && (
                <span className="tm-tab-count" data-zero={(count ?? 0) === 0}>{count ?? 0}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Tab panels ──────────────────────────────────────────────────── */}
      <section
        role="tabpanel"
        id={`tm-panel-${tab}`}
        aria-labelledby={`tm-tab-${tab}`}
        className="tm-panel"
      >
        {tab === "details" && (
          <TaskDetails task={task} review={review} loading={loading} />
        )}

        {tab !== "details" && (
          <>
            <div className="tm-toolbar">
              <input
                className="tm-input"
                type="search"
                placeholder="Search name, ID, email or batch…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                aria-label="Search students"
              />
              {tab === "submitted" && (
                <select
                  className="tm-select"
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                  aria-label="Filter by review status"
                >
                  <option value="">All review statuses</option>
                  <option value="submitted">Awaiting review</option>
                  <option value="revision_required">Revision requested</option>
                  <option value="resubmission_expired">Resubmission expired</option>
                  <option value="approved">Approved</option>
                </select>
              )}
              {batchOptions.length > 1 && (
                <select
                  className="tm-select"
                  value={batchFilter}
                  onChange={(e) => setBatchFilter(e.target.value)}
                  aria-label="Filter by batch"
                >
                  <option value="">All batches</option>
                  {batchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              )}
              {tab === "pending" && visibleRows.length > 0 && (
                <button
                  type="button"
                  className="tm-btn tm-btn-primary"
                  disabled={reminding}
                  onClick={() => remind(selected.length ? selected : visibleRows.map((r) => r.student_id)).catch(() => {})}
                >
                  {reminding ? "Sending…" : `Send reminder to ${selected.length || visibleRows.length} student${(selected.length || visibleRows.length) === 1 ? "" : "s"}`}
                </button>
              )}
              <span className="tm-toolbar-spacer" />
              <span className="tm-pager">
                {total} student{total === 1 ? "" : "s"} · page {page} of {pages}
              </span>
              <button type="button" className="tm-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
              <button type="button" className="tm-btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>

            {rowsLoading && <SkeletonRows count={6} />}
            {!rowsLoading && rowsError && <ErrorState message={rowsError} onRetry={loadRows} />}
            {!rowsLoading && !rowsError && visibleRows.length === 0 && (
              <div className="tm-empty">
                <strong>{total === 0 ? EMPTY_COPY[tab].title : "No student matches this filter"}</strong>
                <p>{total === 0 ? EMPTY_COPY[tab].body : "Try a different search term or clear the batch filter."}</p>
                {(search || batchFilter || statusFilter) && (
                  <button type="button" className="tm-btn" onClick={() => { setSearch(""); setBatchFilter(""); setStatusFilter(""); setPage(1); }}>
                    Clear filters
                  </button>
                )}
              </div>
            )}
            {!rowsLoading && !rowsError && visibleRows.length > 0 && (
              <StudentTable
                tab={tab}
                rows={visibleRows}
                selected={selected}
                onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
                onToggleAll={() => setSelected((s) => (s.length === visibleRows.length ? [] : visibleRows.map((r) => r.student_id)))}
                onView={(r) => setViewer(r.student_id)}
                onRemind={(id) => remind(id).catch(() => {})}
                reminding={reminding}
              />
            )}
          </>
        )}
      </section>

      {viewer && (
        <SubmissionViewer
          taskId={taskId}
          studentId={viewer}
          onClose={() => setViewer(null)}
          onChanged={refreshAll}
        />
      )}
      {detailFor && (
        <AssignmentDetail
          taskId={taskId}
          studentId={detailFor}
          reminding={reminding}
          onRemind={(id) => remind(id).catch(() => {})}
          onClose={() => setDetailFor(null)}
        />
      )}
    </div>
  );
}

const EMPTY_COPY = {
  submitted: { title: "No submissions yet", body: "Nothing has been handed in for this task so far." },
  pending: { title: "No pending students", body: "Every assignee has either started or submitted their work." },
  "in-progress": { title: "Nobody has started yet", body: "No student has explicitly marked this task in progress. Students appear here only after they start work." },
};

function TaskDetails({ task, review, loading }) {
  if (loading && !task) return <SkeletonRows count={5} />;
  if (!task) return null;
  const counts = review?.counts || {};

  return (
    <>
      <h3>Task Details</h3>
      <p className="tm-panel-sub">Every value below is read from the database for this task.</p>

      <div className="tm-section">
        <h4>Overview</h4>
        <div className="tm-grid">
          <div className="tm-field"><span>Task ID</span><strong>{task.task_code || "—"}</strong></div>
          <div className="tm-field"><span>Database ID</span><strong>{task.id}</strong></div>
          <div className="tm-field"><span>Domain</span><strong>{titleCase(task.domain) || "—"}</strong></div>
          <div className="tm-field"><span>Program</span><strong>{titleCase(task.program) || "—"}</strong></div>
          <div className="tm-field"><span>Priority</span><strong>{titleCase(task.priority) || "—"}</strong></div>
          <div className="tm-field"><span>Assigned to</span><strong>{task.target_type === "batch" ? (task.batch_name || "Batch") : "Individual student"}</strong></div>
          <div className="tm-field"><span>Total assignees</span><strong>{task.total_assignees ?? 0}</strong></div>
          <div className="tm-field"><span>Start date</span><strong>{formatISTDateShort(task.start_date)}{task.start_time ? ` ${task.start_time}` : ""}</strong></div>
          <div className="tm-field"><span>Deadline</span><strong>{formatISTDateTime(task.due_at || task.due_date)}</strong></div>
          <div className="tm-field"><span>Current status</span><strong>{titleCase(task.workflow_status) || "—"}</strong></div>
        </div>
      </div>

      <div className="tm-section">
        <h4>Assigned students ({task.assigned_students?.length ?? 0})</h4>
        {(!task.assigned_students || task.assigned_students.length === 0) ? (
          <p className="tm-hint">No students are assigned to this task.</p>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {task.assigned_students.map((s) => (
              <span key={s.id} className="tm-chip">
                {s.name || "Unknown"}{s.code ? ` · ${s.code}` : ""}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="tm-section">
        <h4>Description</h4>
        <p className="tm-prose">{task.description || "No description was provided."}</p>
      </div>

      <div className="tm-section">
        <h4>How to Do</h4>
        <p className="tm-prose">{task.how_to_do || "No instructions were provided."}</p>
      </div>

      <div className="tm-section">
        <h4>Expected Output</h4>
        <p className="tm-prose">{task.expected_output || "No expected output was provided."}</p>
      </div>

      <div className="tm-section">
        <h4>Submission Requirements</h4>
        <p className="tm-prose">{task.submission_requirements || "No submission requirements were provided."}</p>
      </div>

      <div className="tm-section">
        <h4>Submission statistics</h4>
        <div className="tm-grid">
          <div className="tm-field"><span>Submitted</span><strong>{counts.submitted ?? 0}</strong></div>
          <div className="tm-field"><span>Pending</span><strong>{counts.pending ?? 0}</strong></div>
          <div className="tm-field"><span>In progress</span><strong>{counts.in_progress ?? 0}</strong></div>
          <div className="tm-field"><span>Approved</span><strong>{counts.approved ?? 0}</strong></div>
          <div className="tm-field"><span>Revision required</span><strong>{counts.revision_required ?? 0}</strong></div>
          <div className="tm-field"><span>Resubmission expired</span><strong>{counts.resubmission_expired ?? 0}</strong></div>
          <div className="tm-field"><span>Overdue</span><strong>{counts.overdue ?? 0}</strong></div>
          <div className="tm-field"><span>Submitters (unique)</span><strong>{counts.submitters ?? 0}</strong></div>
        </div>
      </div>
    </>
  );
}

function StudentTable({ tab, rows, selected, onToggle, onToggleAll, onView, onRemind, reminding }) {
  const showReviewStatus = tab === "submitted";
  const showPick = tab === "pending";

  return (
    <div className="tm-table-wrap">
      <table className="tm-table">
        <caption className="tm-visually-hidden" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          {tab === "submitted" ? "Students who submitted work for this task" : tab === "pending" ? "Students with no submission and no work started" : "Students who started work but have not submitted"}
        </caption>
        <thead>
          <tr>
            {showPick && (
              <th scope="col" style={{ width: 36 }}>
                <input
                  type="checkbox"
                  checked={rows.length > 0 && selected.length === rows.length}
                  onChange={onToggleAll}
                  aria-label="Select all students on this page"
                />
              </th>
            )}
            <th scope="col">Student</th>
            <th scope="col">Student ID</th>
            <th scope="col">Email</th>
            <th scope="col">Department</th>
            <th scope="col">Program</th>
            <th scope="col">Batch</th>
            <th scope="col">Task</th>
            {tab === "submitted" ? (
              <>
                <th scope="col">Submitted at</th>
                <th scope="col">Version</th>
                <th scope="col">Review status</th>
                <th scope="col">Files</th>
              </>
            ) : tab === "pending" ? (
              <>
                <th scope="col">Assigned at</th>
                <th scope="col">Deadline</th>
                <th scope="col">Time remaining</th>
                <th scope="col">Status</th>
              </>
            ) : (
              <>
                <th scope="col">Status</th>
                <th scope="col">Last activity</th>
                <th scope="col">Deadline</th>
                <th scope="col">Time remaining</th>
              </>
            )}
            <th scope="col"><span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.student_id}>
              {showPick && (
                <td>
                  <input
                    type="checkbox"
                    checked={selected.includes(r.student_id)}
                    onChange={() => onToggle(r.student_id)}
                    aria-label={`Select ${r.student_name}`}
                  />
                </td>
              )}
              <td className="tm-cell-strong">
                <button type="button" className="tm-name-btn" onClick={() => onView(r)}>{r.student_name || "Unnamed student"}</button>
              </td>
              <td>{r.student_code || "—"}</td>
              <td>{r.student_email || "—"}</td>
              <td>{titleCase(r.student_department) || "—"}</td>
              <td>{titleCase(r.student_program) || "—"}</td>
              <td>{r.batch_name || "—"}</td>
              <td><span className="tm-cell-sub">{taskTitle(r.task_title)}</span></td>
                {showReviewStatus ? (
                  <>
                    <td>{formatISTDateTime(r.submitted_at)}</td>
                    <td>v{r.submission_version ?? 1}</td>
                    <td>
                      <StatusChip status={r.status} />
                      {r.overdue && <span className="tm-chip tm-chip-overdue" style={{ marginLeft: 6 }}>Overdue</span>}
                      {r.revision_deadline && r.status === "revision_required" && (
                        <span className="tm-cell-sub">Resubmit by {formatISTDateTime(r.revision_deadline)}</span>
                      )}
                    </td>
                    <td>
                      {(r.files || []).length === 0
                        ? <span className="tm-cell-sub">No files</span>
                        : (
                          <>
                            <span className="tm-cell-strong">{r.files.length}</span>
                            <span className="tm-cell-sub">{(r.files || []).map((f) => f.name).join(", ")}</span>
                          </>
                        )}
                    </td>
                  </>
                ) : tab === "pending" ? (
                  <>
                    <td>{formatISTDateTime(r.assigned_at)}</td>
                    <td>{formatISTDateShort(r.task_due_at) || "—"}</td>
                    <td><DeadlineCell deadline={r.task_due_at} fallback="No deadline" /></td>
                    <td><StatusChip status={r.status} /></td>
                  </>
                ) : (
                  <>
                    <td><StatusChip status={r.status} /></td>
                    <td>{r.last_activity_at ? formatISTDateTime(r.last_activity_at) : <span className="tm-cell-sub">No activity recorded</span>}</td>
                    <td>{formatISTDateShort(r.task_due_at) || "—"}</td>
                    <td><DeadlineCell deadline={r.task_due_at} fallback="No deadline" /></td>
                  </>
                )}
                <td>
                  <div className="tm-row-actions">
                    {tab === "pending" && (
                      <button type="button" className="tm-icon-btn" disabled={reminding} onClick={() => onRemind(r.student_id)}>
                        <TechinsIcon name="bell" size={13} variant="light" ariaHidden /> Remind
                      </button>
                    )}
                    <button
                      type="button"
                      className="tm-icon-btn"
                      onClick={() => onView(r)}
                      aria-label={`${showReviewStatus ? "View submission" : "View details"} for ${r.student_name}`}
                      title={showReviewStatus ? "View submission" : "View details"}
                    >
                      <TechinsIcon name="eye" size={13} variant="light" ariaHidden />
                      {showReviewStatus ? "View submission" : "View details"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

function DeadlineCell({ deadline, fallback }) {
  const info = remainingTime(deadline);
  if (!info) return <span className="tm-cell-sub">{fallback}</span>;
  return <span className={info.overdue ? "tm-chip tm-chip-overdue" : "tm-chip"}>{info.label}</span>;
}