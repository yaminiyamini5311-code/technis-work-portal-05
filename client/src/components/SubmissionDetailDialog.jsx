import { useCallback, useEffect, useState } from "react";
import FixedOverlay from "./FixedOverlay";
import FilePreview, { isPreviewable } from "./FilePreview";
import TechinsIcon from "./TechinsIcon";
import { formatWorkspaceDateTime, formatDuration } from "../utils/dateHelper";
import { STATUS_LABEL, apiFetch, downloadFile, formatBytes, statusClass, taskTitle } from "../utils/api";
import "./SubmissionDetailDialog.css";

/**
 * Submission review dialog for the CEO Student Submissions page.
 *
 * Loaded by the submission's own id (GET /api/tasks/submissions/:submissionId),
 * so everything on screen comes from one submission row: the student, the task,
 * this version's files and every sibling version. There is no second lookup
 * that could mix in another student's data.
 *
 * Approve and Request Resubmission call the SAME endpoints the Task Manager
 * uses (POST /api/tasks/review), which now delegates to the single shared
 * approve/revision implementation. That means one 24-hour window rule, one
 * transition rule and one notification per event across the whole app.
 *
 * After an action the list refreshes in place — there is no navigation away
 * from this page.
 */

const MIN_FEEDBACK = 10; // mirrors server/utils/submissionStatus.js

function Row({ label, children }) {
  return (
    <div className="sdd-field">
      <span className="sdd-label">{label}</span>
      <span className="sdd-value">{children === null || children === undefined || children === "" ? <em>Not recorded</em> : children}</span>
    </div>
  );
}

function Section({ kicker, title, children, action }) {
  return (
    <section className="sdd-section">
      <header className="sdd-section-head">
        <div>
          <span className="section-kicker">{kicker}</span>
          <h3>{title}</h3>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export default function SubmissionDetailDialog({ submissionId, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorMeta, setErrorMeta] = useState(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [dialogMode, setDialogMode] = useState(null); // "approve" | "revision"
  const [comment, setComment] = useState("");
  const [dialogError, setDialogError] = useState("");
  
  // Edit comment state
  const [editingComment, setEditingComment] = useState(false);
  const [editedCommentText, setEditedCommentText] = useState("");
  const [editCommentError, setEditCommentError] = useState("");
  const [savingComment, setSavingComment] = useState(false);

  // Get current user ID from localStorage
  const currentUserId = (() => {
    try {
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      return String(user.id || "");
    } catch {
      return "";
    }
  })();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setErrorMeta(null);
    try {
      const res = await apiFetch(`/api/tasks/submissions/${encodeURIComponent(submissionId)}`);
      setDetail(res?.data ?? null);
    } catch (e) {
      const permanent = [403, 404].includes(e?.status) || ["FORBIDDEN", "NOT_FOUND", "SUBMISSION_NOT_FOUND", "TASK_NOT_FOUND", "ASSIGNMENT_NOT_FOUND", "INVALID_STUDENT_ID"].includes(e?.code);
      setError(e.message || "Unable to load this submission.");
      setErrorMeta({ status: e?.status, code: e?.code, permanent });
    } finally {
      setLoading(false);
    }
  }, [submissionId]);

  useEffect(() => {
    if (!submissionId) return;
    const run = async () => { await load(); };
    run();
  }, [load, submissionId]);

  function openDecision(mode) {
    setDialogMode(mode);
    setComment("");
    setDialogError("");
    setNotice("");
    setError("");
  }

  function closeDecision() {
    setDialogMode(null);
    setComment("");
    setDialogError("");
  }

  async function submitDecision() {
    if (!dialogMode || busy) return;
    const text = comment.trim();
    // Frontend validation mirrors the server, which is the actual authority.
    if (dialogMode === "revision" && text.length < MIN_FEEDBACK) {
      setDialogError(`Explain what needs to change — at least ${MIN_FEEDBACK} characters so the student knows what to fix.`);
      return;
    }
    setBusy(dialogMode);
    setDialogError("");
    try {
      const res = await apiFetch("/api/tasks/review", {
        method: "POST",
        body: { submission_id: submissionId, decision: dialogMode === "approve" ? "approve" : "revision", comment: text },
      });
      const payload = res?.data ?? res;
      const deadline = payload?.resubmission_deadline;
      setNotice(
        dialogMode === "approve"
          ? (payload?.message || "Submission approved.")
          : `${payload?.message || "Revision requested."}${deadline ? ` Resubmit by ${formatWorkspaceDateTime(deadline)}.` : ""}`,
      );
      closeDecision();
      // Refresh in place: the dialog and the list behind it both re-read.
      await load();
      onChanged?.();
    } catch (e) {
      // Show the server's exact message (409 duplicate / illegal transition /
      // forbidden), never a generic "something went wrong".
      setDialogError(e.message || "Unable to save the review decision.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDownload(file) {
    try {
      await downloadFile(file);
    } catch (e) {
      setError(e.message || "Unable to download this file.");
    }
  }

  function startEditingComment() {
    setEditingComment(true);
    setEditedCommentText(submission?.review_comments || "");
    setEditCommentError("");
    setNotice("");
  }

  function cancelEditingComment() {
    setEditingComment(false);
    setEditedCommentText("");
    setEditCommentError("");
  }

  async function saveEditedComment() {
    if (savingComment) return;
    
    const text = editedCommentText.trim();
    
    // Validation
    if (!text) {
      setEditCommentError("Review comment cannot be empty.");
      return;
    }
    
    if (text.length > 500) {
      setEditCommentError("Review comment must be 500 characters or less.");
      return;
    }
    
    // Check if unchanged
    if (text === (submission?.review_comments || "").trim()) {
      cancelEditingComment();
      return;
    }
    
    setSavingComment(true);
    setEditCommentError("");
    
    try {
      const res = await apiFetch(`/api/tasks/submissions/${encodeURIComponent(submissionId)}/review-comment`, {
        method: "PATCH",
        body: { review_comment: text },
      });
      
      setNotice("Review comment updated successfully.");
      setEditingComment(false);
      setEditedCommentText("");
      
      // Refresh the submission data to show the updated comment
      await load();
      onChanged?.();
    } catch (e) {
      setEditCommentError(e.message || "Unable to update review comment. Please try again.");
    } finally {
      setSavingComment(false);
    }
  }

  const submission = detail?.submission;
  const student = detail?.student;
  const task = detail?.task;
  const files = detail?.files || [];
  const versions = detail?.versions || [];
  const currentStatus = submission?.review_status;
  const hasMissingRelatedRecord = Boolean(detail?.taskMissing || detail?.studentMissing);
  const effectiveStudentName = student?.name || (detail?.studentMissing ? "Deleted student" : "Student");
  const effectiveTaskTitle = taskTitle(task?.title) || (detail?.taskMissing ? "Deleted task" : "Task");
  const canRetry = !(errorMeta && errorMeta.permanent);

  return (
    <>
      <FixedOverlay
        open={Boolean(submissionId)}
        onClose={onClose}
        label="Submission review"
        panelClassName="fixed-overlay-panel sdd-panel"
        zIndex={1000}
      >
        <div className="panel-head">
          <div className="sdd-title">
            <span className="section-kicker">SUBMISSION {submission?.submission_code || ""}</span>
            {/* taskTitle() returns the stored string verbatim and the CSS sets
                white-space: pre-wrap, so a title containing "|", "—" or "’"
                can never be re-encoded or collapsed. */}
            <h3 className="sdd-task-title">{effectiveTaskTitle}</h3>
            <p className="sdd-sub">
              {effectiveStudentName}
              {student?.code ? ` · ${student.code}` : ""}
              {submission?.version ? ` · Version ${submission.version}` : ""}
            </p>
          </div>
          <div className="sdd-head-actions">
            {currentStatus && (
              <span className={`pill ${statusClass(currentStatus)}`}>
                {submission?.review_status_label || STATUS_LABEL[currentStatus] || currentStatus}
              </span>
            )}
            <button type="button" className="sdd-btn" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="panel-body">
          {loading && <div className="sdd-loading" role="status">Loading submission…</div>}

          {!loading && error && (
            <div className="sdd-message sdd-message-error" role="alert">
              <span>{error}</span>
              {canRetry && <button type="button" className="sdd-btn" onClick={load}>Retry</button>}
            </div>
          )}

          {!loading && notice && <div className="sdd-message sdd-message-ok" role="status">{notice}</div>}

          {!loading && detail && hasMissingRelatedRecord && (
            <div className="sdd-message sdd-message-warning" role="status">
              {detail.taskMissing && detail.studentMissing
                ? "The task and student records for this submission were deleted. Displaying snapshot data captured at submission time."
                : detail.taskMissing
                  ? "The task for this submission was deleted. Displaying snapshot data captured at submission time."
                  : "The student record for this submission was deleted. Review data is limited to the submission record itself."}
            </div>
          )}

          {!loading && !error && detail && (
            <>
              <Section kicker="STUDENT DETAILS" title={student?.name || "Student"}>
                <div className="sdd-grid">
                  <Row label="Full name">{student?.name}</Row>
                  <Row label="Student ID">{student?.code}</Row>
                  <Row label="Email">{student?.email}</Row>
                  <Row label="Phone">{student?.phone}</Row>
                  <Row label="Department">{student?.department}</Row>
                  <Row label="Program">{student?.program}</Row>
                  <Row label="Batch">{student?.batch}</Row>
                  <Row label="Joined">{student?.joined_at ? formatWorkspaceDateTime(student.joined_at) : null}</Row>
                </div>
              </Section>

              <Section kicker="TASK DETAILS" title={taskTitle(task?.title) || "Task"}>
                <div className="sdd-grid">
                  <Row label="Task ID">{task?.code}</Row>
                  <Row label="Version">v{submission?.version || 1}</Row>
                  <Row label="Assigned">{task?.assigned_at ? formatWorkspaceDateTime(task.assigned_at) : null}</Row>
                  <Row label="Deadline">{task?.due_date ? formatWorkspaceDateTime(task.due_date) : null}</Row>
                  <Row label="Submitted">{submission?.submitted_at ? formatWorkspaceDateTime(submission.submitted_at) : null}</Row>
                  <Row label="Task started">{submission?.task_started_at ? formatWorkspaceDateTime(submission.task_started_at) : null}</Row>
                  <Row label="Task submitted">{submission?.task_submitted_at || submission?.submitted_at ? formatWorkspaceDateTime(submission.task_submitted_at || submission.submitted_at) : null}</Row>
                  <Row label="Total time taken">{formatDuration(submission?.duration_seconds)}</Row>
                  <Row label="Reviewed">{submission?.reviewed_at ? formatWorkspaceDateTime(submission.reviewed_at) : null}</Row>
                </div>
                {task?.description && <p className="sdd-prose">{taskTitle(task.description)}</p>}
                {task?.instructions && (
                  <div className="sdd-prose sdd-prose-muted">
                    <strong>Instructions</strong>
                    {taskTitle(task.instructions)}
                  </div>
                )}
                <div className="sdd-comments">
                  <div>
                    <span className="sdd-label">Student&apos;s written comment</span>
                    {submission?.comment
                      ? <p className="sdd-comment">{taskTitle(submission.comment)}</p>
                      : <p className="sdd-empty">The student did not add a written response to this version.</p>}
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span className="sdd-label">Admin review comments</span>
                      {submission?.review_comments && submission?.reviewer_id === currentUserId && !editingComment && (
                        <button 
                          type="button" 
                          className="sdd-btn sdd-btn-edit"
                          onClick={startEditingComment}
                          title="Edit your review comment"
                          style={{ 
                            padding: '4px 10px', 
                            fontSize: '11px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <TechinsIcon name="edit" size={12} variant="light" ariaHidden />
                          Edit
                        </button>
                      )}
                    </div>
                    {!editingComment ? (
                      <>
                        {submission?.review_comments ? (
                          <div>
                            <p className="sdd-comment sdd-comment-review">{taskTitle(submission.review_comments)}</p>
                            {submission?.review_comment_edited_at && (
                              <small style={{ color: '#93a1c2', fontSize: '10.5px', fontStyle: 'italic', marginTop: '4px', display: 'block' }}>
                                Edited {formatWorkspaceDateTime(submission.review_comment_edited_at)}
                              </small>
                            )}
                          </div>
                        ) : (
                          <p className="sdd-empty">No admin review comment yet.</p>
                        )}
                      </>
                    ) : (
                      <div style={{ marginTop: '8px' }}>
                        <textarea
                          className="sdd-textarea"
                          value={editedCommentText}
                          onChange={(e) => { setEditedCommentText(e.target.value); setEditCommentError(""); }}
                          placeholder="Review comment..."
                          rows={4}
                          maxLength={500}
                          autoFocus
                          style={{ width: '100%', marginBottom: '6px' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <small style={{ color: editedCommentText.trim().length > 500 ? '#f87171' : '#93a1c2', fontSize: '11px' }}>
                            {editedCommentText.trim().length}/500 characters
                          </small>
                        </div>
                        {editCommentError && (
                          <div className="sdd-message sdd-message-error" role="alert" style={{ marginBottom: '8px', padding: '8px 12px', fontSize: '12px' }}>
                            {editCommentError}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            type="button"
                            className="sdd-btn"
                            onClick={cancelEditingComment}
                            disabled={savingComment}
                            style={{ flex: 1 }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="sdd-btn sdd-btn-primary"
                            onClick={saveEditedComment}
                            disabled={savingComment || !editedCommentText.trim() || editedCommentText.trim() === submission?.review_comments || editedCommentText.trim().length > 500}
                            style={{ flex: 1 }}
                          >
                            {savingComment ? "Saving..." : "Save Changes"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {detail.assignment?.revision_deadline && (
                  <p className="sdd-deadline">
                    Resubmission window: closes {formatWorkspaceDateTime(detail.assignment.revision_deadline)}
                    {detail.assignment.revision_status === "open" ? " (open)" : ` (${detail.assignment.revision_status || "closed"})`}
                  </p>
                )}
              </Section>

              <Section kicker="UPLOADED FILES" title={`${files.length} file${files.length === 1 ? "" : "s"} on this version`}>
                {files.length ? (
                  <ul className="sdd-files">
                    {files.map(f => (
                      <li key={f.id} className="sdd-file">
                        <span className="sdd-file-name" title={f.name}>{f.name}</span>
                        <span className="sdd-file-meta">{f.mime || "unknown type"}{f.size ? ` · ${formatBytes(f.size)}` : ""}</span>
                        <span className="sdd-file-actions">
                          <button
                            type="button"
                            className="sdd-btn"
                            onClick={() => setPreviewFile({ ...f, preview_url: f.preview_url })}
                            title={isPreviewable(f.mime) ? "Preview this file" : "This file type cannot be previewed"}
                          >
                            <TechinsIcon name="eye" size={13} variant="light" ariaHidden /> Preview
                          </button>
                          <button type="button" className="sdd-btn" onClick={() => handleDownload(f)}>
                            <TechinsIcon name="download" size={13} variant="light" ariaHidden /> Download
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="sdd-empty">No files were attached to this version.</p>
                )}
              </Section>

              <Section kicker="REVIEW HISTORY" title={`${versions.length} version${versions.length === 1 ? "" : "s"} on record`}>
                <ol className="sdd-history">
                  {versions.map(v => (
                    <li key={v.id} className={v.is_current ? "sdd-version sdd-version-current" : "sdd-version"}>
                      <div className="sdd-version-head">
                        <strong>Version {v.version}{v.is_current ? " · this submission" : ""}</strong>
                        <span className={`pill ${statusClass(v.status)}`}>{v.status_label || STATUS_LABEL[v.status] || v.status}</span>
                      </div>
                      <div className="sdd-version-meta">
                        <span>{v.submitted_at ? formatWorkspaceDateTime(v.submitted_at) : "—"}</span>
                        <span>Reviewer: {v.reviewer_name || "Not reviewed yet"}</span>
                        {v.reviewed_at && <span>Reviewed {formatWorkspaceDateTime(v.reviewed_at)}</span>}
                      </div>
                      {v.comment && <p className="sdd-comment">{taskTitle(v.comment)}</p>}
                      {v.review_comments && <p className="sdd-comment sdd-comment-review">{taskTitle(v.review_comments)}</p>}
                      {v.file_count > 0 && <small className="sdd-version-files">{v.file_count} file{v.file_count === 1 ? "" : "s"}</small>}
                    </li>
                  ))}
                </ol>
              </Section>
            </>
          )}
        </div>

        {!loading && !error && detail && (
          <div className="panel-foot">
            <button
              type="button"
              className="sdd-btn sdd-btn-danger"
              onClick={() => openDecision("revision")}
              disabled={!detail.can_request_revision}
              title={detail.can_request_revision ? undefined : "This submission cannot be sent back for revision."}
            >
              Request Resubmission
            </button>
            <button
              type="button"
              className="sdd-btn sdd-btn-primary"
              onClick={() => openDecision("approve")}
              disabled={!detail.can_approve}
              title={detail.can_approve ? undefined : "Only a submitted version can be approved."}
            >
              Approve
            </button>
          </div>
        )}
      </FixedOverlay>

      {previewFile && (
        <FilePreview file={previewFile} onClose={() => setPreviewFile(null)} />
      )}

      {/* Decision dialog */}
      <FixedOverlay
        open={Boolean(dialogMode)}
        onClose={closeDecision}
        label={dialogMode === "approve" ? "Approve submission" : "Request resubmission"}
        panelClassName="fixed-overlay-panel sdd-decision"
        zIndex={1200}
      >
        <div className="panel-head">
          <div>
            <span className="section-kicker">{dialogMode === "approve" ? "APPROVE SUBMISSION" : "REQUEST RESUBMISSION"}</span>
            <h3>
              {dialogMode === "approve"
                ? `Approve ${student?.name || "this student"}'s submission?`
                : `Send ${student?.name || "this student"}'s work back for revision`}
            </h3>
          </div>
          <button type="button" className="sdd-btn" onClick={closeDecision}>Close</button>
        </div>

        <div className="panel-body">
          {dialogMode === "revision" && (
            <p className="sdd-hint">
              The student gets a fresh <strong>24-hour window</strong> measured from our server clock. The
              original submission and every earlier version are kept — a resubmission is saved as a new version.
            </p>
          )}
          <label className="sdd-field-label" htmlFor="sdd-review-comment">
            Review comment {dialogMode === "revision" ? <span className="sdd-req">required</span> : <span className="sdd-opt">optional</span>}
          </label>
          <textarea
            id="sdd-review-comment"
            className="sdd-textarea"
            value={comment}
            onChange={(e) => { setComment(e.target.value); setDialogError(""); }}
            placeholder={dialogMode === "approve"
              ? "Optional note shown to the student…"
              : "Explain exactly what needs to change so the student can fix it…"}
            rows={4}
            data-autofocus
            aria-describedby={dialogMode === "revision" ? "sdd-feedback-hint" : undefined}
          />
          {dialogMode === "revision" && (
            <small id="sdd-feedback-hint" className={comment.trim().length > 0 && comment.trim().length < MIN_FEEDBACK ? "sdd-hint-warn" : "sdd-hint-ok"}>
              {comment.trim().length < MIN_FEEDBACK
                ? `${MIN_FEEDBACK - comment.trim().length} more character${MIN_FEEDBACK - comment.trim().length === 1 ? "" : "s"} needed.`
                : "Looks good to send."}
            </small>
          )}
          {dialogError && <div className="sdd-message sdd-message-error" role="alert">{dialogError}</div>}
        </div>

        <div className="panel-foot">
          <button type="button" className="sdd-btn" onClick={closeDecision} disabled={Boolean(busy)}>Cancel</button>
          <button
            type="button"
            className={dialogMode === "approve" ? "sdd-btn sdd-btn-primary" : "sdd-btn sdd-btn-danger"}
            onClick={submitDecision}
            disabled={Boolean(busy) || (dialogMode === "revision" && comment.trim().length < MIN_FEEDBACK)}
          >
            {busy ? "Saving…" : dialogMode === "approve" ? "Confirm approval" : "Send revision request"}
          </button>
        </div>
      </FixedOverlay>
    </>
  );
}