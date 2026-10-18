/**
 * Shared per-student task status model.
 *
 * ONE enum is used by the database (task_assignments.status /
 * submissions.status), the API, the admin Task Manager and the student
 * portal, so a value can never mean two different things in two places.
 *
 * The values are mutually exclusive by construction: every helper below
 * returns exactly one of them, and the aggregation in
 * utils/submissionStatus.js buckets each assignee into exactly one bucket,
 * so counts can never be double counted.
 *
 * "Overdue" is deliberately NOT a status. It is a derived flag computed from
 * the task deadline at read time (see isOverdue).
 *
 * Legacy values written by older code ("assigned", "Assigned",
 * "In Progress", "Revision Required", "completed", ...) are mapped through
 * LEGACY_STATUS_MAP so old records keep working and are never dropped.
 */

const TASK_STATUS = Object.freeze([
  "pending",
  "in_progress",
  "submitted",
  "approved",
  "revision_required",
  "resubmission_expired",
]);

/** Value stored on submissions[].status for each shared status. */
const SUBMISSION_STATUS = Object.freeze({
  pending: "Submitted",
  in_progress: "Submitted",
  submitted: "Submitted",
  approved: "Approved",
  revision_required: "Revision Required",
  resubmission_expired: "Revision Required",
});

/** Human labels used by both portals and by notification copy. */
const STATUS_LABELS = Object.freeze({
  pending: "Pending",
  in_progress: "In Progress",
  submitted: "Submitted",
  approved: "Approved",
  revision_required: "Revision Required",
  resubmission_expired: "Resubmission Expired",
});

/** UI grouping: tabs of the Task Manager, in display order. */
const STATUS_GROUPS = Object.freeze({
  pending: "pending",
  in_progress: "in_progress",
  submitted: "submitted",
  approved: "approved",
  revision_required: "revision_required",
  resubmission_expired: "resubmission_expired",
});

/**
 * Legacy -> canonical mapping. Keys are compared lowercased with spaces
 * collapsed to underscores, so "Revision Required", "revision_required" and
 * "Revision  Required" all resolve.
 */
const LEGACY_STATUS_MAP = Object.freeze({
  // never started
  draft: "pending",
  scheduled: "pending",
  assigned: "pending",
  pending: "pending",
  // work started, explicitly
  acknowledged: "in_progress",
  "in_progress": "in_progress",
  "in progress": "in_progress",
  "under review": "in_progress",
  // handed in
  submitted: "submitted",
  resubmitted: "submitted",
  // reviewed
  approved: "approved",
  completed: "approved",
  archived: "approved",
  // revisions
  revision_required: "revision_required",
  "revision required": "revision_required",
  resubmission_expired: "resubmission_expired",
  // not part of the lifecycle
  cancelled: "pending",
});

/**
 * Map any stored/legacy status to the canonical enum.
 * Unknown values fall back to "pending" so an unexpected record can never
 * disappear from the counts.
 */
function normalizeStatus(value) {
  if (!value) return "pending";
  const raw = String(value).trim().toLowerCase();
  if (TASK_STATUS.includes(raw)) return raw;
  if (LEGACY_STATUS_MAP[raw]) return LEGACY_STATUS_MAP[raw];
  const collapsed = raw.replace(/\s+/g, "_");
  if (TASK_STATUS.includes(collapsed)) return collapsed;
  if (LEGACY_STATUS_MAP[collapsed]) return LEGACY_STATUS_MAP[collapsed];
  return "pending";
}

/** Submission-record status -> canonical status. */
function normalizeSubmissionStatus(value) {
  if (!value) return "submitted";
  return normalizeStatus(value);
}

/**
 * Length of the resubmission window in hours.
 *
 * Production default is 24. Tests override RESUBMISSION_WINDOW_HOURS to
 * exercise expiry without waiting (see test/task-review.test.js); production
 * code never overrides it.
 */
function resubmissionWindowHours() {
  const raw = Number(process.env.RESUBMISSION_WINDOW_HOURS);
  if (!Number.isFinite(raw) || raw <= 0) return 24;
  return raw;
}

/**
 * Overdue is derived, never stored: a student-task that is not approved and
 * whose task deadline has already passed.
 */
function isOverdue(status, dueAt, now = new Date()) {
  const canonical = normalizeStatus(status);
  if (canonical === "approved") return false;
  if (!dueAt) return false;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return false;
  return now.getTime() > due.getTime();
}

/**
 * Minimum characters required when an admin requests a revision.
 * Overridable only through configuration; the value is a product rule, so a
 * caller can never pass a shorter one in a request body.
 */
function revisionFeedbackMin() {
  const raw = Number(process.env.REVISION_FEEDBACK_MIN_CHARS);
  if (!Number.isFinite(raw) || raw < 1) return 10;
  return Math.floor(raw);
}

const REVISION_FEEDBACK_MIN = revisionFeedbackMin();

module.exports = {
  TASK_STATUS,
  SUBMISSION_STATUS,
  STATUS_LABELS,
  STATUS_GROUPS,
  LEGACY_STATUS_MAP,
  REVISION_FEEDBACK_MIN,
  revisionFeedbackMin,
  normalizeStatus,
  normalizeSubmissionStatus,
  resubmissionWindowHours,
  isOverdue,
};