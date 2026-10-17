/**
 * Per-student task state — the single source of truth behind the Task Manager.
 *
 * Why this module exists
 * ---------------------
 * The portal stores state in two places that were previously read
 * independently and disagreed with each other:
 *   - `task_assignments`  one row per (task, student): who was assigned, how
 *                         far they got, the review state for THAT student.
 *   - `submissions`       one row per (task, student, version): the uploaded
 *                         work and the reviewer's decision.
 *
 * `tasks.workflow_status` is a single task-wide value that flips as soon as ANY
 * student acts, so it can never be used to describe a task with 38 assignees.
 * Everything in the Task Manager therefore comes from here instead.
 *
 * Guarantees
 * ----------
 *  - Every assignee resolves to exactly ONE canonical status (see
 *    config/taskStatus.js) so tab counts can never double count.
 *  - "Overdue" is derived from the task deadline at read time, never stored.
 *  - Revision windows expire lazily on read (expireStaleRevisionWindows), which
 *    is also what the Vercel Cron endpoint calls, so both paths share one
 *    implementation.
 *  - Assignees are the UNION of the assignment snapshot and the live batch
 *    membership, so a student who joined the batch after the task was created
 *    is counted and a student who left it is not double counted.
 */

const { ObjectId } = require("mongodb");
const {
  normalizeStatus,
  normalizeSubmissionStatus,
  resubmissionWindowHours,
  isOverdue,
  revisionFeedbackMin,
} = require("../config/taskStatus");

function toId(id) {
  try { return new ObjectId(String(id)); } catch { return id; }
}

function taskDueAt(task) {
  return task?.due_at || (task?.due_date ? `${task.due_date}T${task.due_time || "23:59"}:00` : null);
}

/* ── Domain / program resolution ────────────────────────────────────────
 * `program` was historically offered as a DOMAIN in the create form, so most
 * production tasks carry domain:"program" and a null `program` field. That is
 * a scope, not a domain: program-level work (TECHINS 60 and friends) belongs
 * to EduTins. LegacyDomainFor() maps the old bucket to the real domain and
 * the migration script persists the same mapping, so the UI can render a real
 * domain before and after the migration.
 */
const LEGACY_SCOPE_DOMAIN = "program";
const SCOPE_DOMAIN_FALLBACK = "edutins";

function legacyDomainFor(domain) {
  return String(domain || "").trim().toLowerCase() === LEGACY_SCOPE_DOMAIN
    ? SCOPE_DOMAIN_FALLBACK
    : null;
}

/** Effective domain for display/filtering, keeping the legacy bucket visible. */
function resolveDomain(task) {
  const raw = task?.domain ? String(task.domain).trim().toLowerCase() : null;
  const legacy = legacyDomainFor(raw);
  return {
    domain: raw,
    legacy_domain: legacy ? raw : null,
    effective_domain: legacy || raw || null,
  };
}

/**
 * The real program for a task, resolved in order of authority:
 *   1. the task's own `program` field (explicitly set at create/edit time)
 *   2. the program shared by its assignees
 * Nothing is invented: if neither exists the program is null and the UI shows
 * an em dash rather than a guess.
 */
async function resolveProgram(db, task, assigneeDocs) {
  const explicit = task?.program ? String(task.program).trim() : "";
  if (explicit) return explicit;
  const fromStudents = assigneeDocs.map((s) => (s?.program ? String(s.program).trim() : "")).filter(Boolean);
  if (!fromStudents.length) return null;
  const counts = new Map();
  for (const p of fromStudents) counts.set(p.toLowerCase(), (counts.get(p.toLowerCase()) || 0) + 1);
  let best = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) { best = key; bestCount = count; }
  }
  return fromStudents.find((p) => p.toLowerCase() === best) || null;
}

/* ── Assignee resolution ────────────────────────────────────────────────── */

/**
 * Every student the task belongs to, as { student_id, student, assignment,
 * snapshot_only, live_only }.
 *
 * - `snapshot` = the task_assignments rows created when the task was assigned
 *   (may include students who have since left the batch)
 * - `live`     = current active students of the batch (includes students who
 *                joined after the task was created)
 * The union is returned, so assignee counts stop disagreeing between tasks of
 * the same batch.
 */
async function loadTaskAssignees(db, task) {
  const taskKey = String(task._id);
  const snapshot = await db.collection("task_assignments")
    .find({ task_id: taskKey })
    .toArray();
  const snapshotByStudent = new Map(snapshot.map((a) => [String(a.student_id), a]));

  let liveDocs = [];
  if (task.batch_id) {
    liveDocs = await db.collection("users")
      .find({ batch_id: String(task.batch_id), role: "student", active: 1 })
      .toArray();
  }

  const ids = new Set([...snapshotByStudent.keys(), ...liveDocs.map((s) => String(s._id))]);
  const studentDocs = ids.size
    ? await db.collection("users")
        .find({ _id: { $in: [...ids].map(toId) } })
        .toArray()
    : [];
  const studentById = new Map(studentDocs.map((s) => [String(s._id), s]));

  let batchName = null;
  if (task.batch_id) {
    const batch = await db.collection("batches").findOne({ _id: toId(task.batch_id) }, { projection: { name: 1, program: 1 } });
    batchName = batch?.name || null;
  }

  const rows = [];
  for (const id of ids) {
    const student = studentById.get(id) || null;
    rows.push({
      student_id: id,
      student,
      assignment: snapshotByStudent.get(id) || null,
      snapshot_only: snapshotByStudent.has(id) && !liveDocs.some((s) => String(s._id) === id),
      live_only: !snapshotByStudent.has(id) && Boolean(student),
      student_name: student?.name || null,
      student_email: student?.email || null,
      student_code: student?.student_id || student?.learner_id || null,
      student_department: student?.department || null,
      student_program: student?.program || null,
      batch_id: student?.batch_id || task.batch_id || null,
      batch_name: batchName,
      active: student ? student.active !== 0 : false,
    });
  }
  rows.sort((a, b) => (a.student_name || "").localeCompare(b.student_name || ""));
  return rows;
}

/* ── Per-student status resolution ──────────────────────────────────────── */

/**
 * Resolve one assignee into exactly one canonical status.
 * `latest` is that student's highest-version submission for the task.
 */
function resolveStatus(assignment, latest, now) {
  const hasSubmission = Boolean(latest);

  // A persisted expiry (written by lazy expiry or the cron job) wins until a
  // new submission arrives, which cannot happen while the window is closed.
  if (!hasSubmission && assignment && normalizeStatus(assignment.status) === "resubmission_expired") {
    return "resubmission_expired";
  }

  if (hasSubmission) {
    const submissionStatus = normalizeSubmissionStatus(latest.status);
    if (submissionStatus === "approved") return "approved";
    if (submissionStatus === "revision_required") {
      const deadline = assignment?.revision_deadline || null;
      const cycleStatus = assignment?.revision_status || null;
      if (deadline && cycleStatus !== "resubmitted") {
        const due = new Date(deadline);
        if (!Number.isNaN(due.getTime()) && now.getTime() > due.getTime()) {
          return "resubmission_expired";
        }
      }
      return "revision_required";
    }
    return "submitted";
  }

  // No submission: only an EXPLICIT in_progress counts as started work.
  // Being assigned is never "in progress".
  const assignmentStatus = normalizeStatus(assignment?.status);
  if (assignmentStatus === "in_progress") return "in_progress";
  return "pending";
}

function emptyCounts() {
  return {
    assigned: 0,
    pending: 0,
    in_progress: 0,
    submitted: 0,
    approved: 0,
    revision_required: 0,
    resubmission_expired: 0,
    overdue: 0,
    submitters: 0,
  };
}

/**
 * Build the full per-student picture for one task.
 *
 * Returns { counts, rows, assigneeCount } where every row carries its single
 * canonical `status`, the derived `overdue` flag, its latest submission and
 * the revision cycle that applies to it.
 */
async function buildTaskStudentState(db, task, { now = new Date() } = {}) {
  const taskKey = String(task._id);
  const assignees = await loadTaskAssignees(db, task);
  const counts = emptyCounts();
  counts.assigned = assignees.length;

  if (!assignees.length) return { counts, rows: [], assigneeCount: 0, assignees: [] };

  const studentIds = assignees.map((a) => a.student_id);
  const submissions = await db.collection("submissions")
    .find({ task_id: taskKey, student_id: { $in: studentIds } })
    .sort({ version: 1 })
    .toArray();

  const byStudent = new Map();
  for (const s of submissions) {
    const key = String(s.student_id);
    const current = byStudent.get(key);
    if (!current || Number(s.version || 1) >= Number(current.version || 1)) byStudent.set(key, s);
  }

  const dueAt = taskDueAt(task);
  const rows = assignees.map((a) => {
    const latest = byStudent.get(a.student_id) || null;
    const status = resolveStatus(a.assignment, latest, now);
    const overdue = isOverdue(status, dueAt, now);

    counts[status] += 1;
    if (latest) counts.submitters += 1;
    if (overdue) counts.overdue += 1;

    return {
      student_id: a.student_id,
      student_db_id: a.student_id,
      student_code: a.student_code,
      student_name: a.student_name,
      student_email: a.student_email,
      student_department: a.student_department,
      student_program: a.student_program,
      batch_id: a.batch_id,
      batch_name: a.batch_name,
      assignment_id: a.assignment ? String(a.assignment._id) : null,
      assignment_status: a.assignment ? normalizeStatus(a.assignment.status) : null,
      in_assignment_snapshot: Boolean(a.assignment),
      in_live_batch: !a.snapshot_only,
      status,
      overdue,
      assigned_at: a.assignment?.created_at || null,
      last_activity_at: a.assignment?.updated_at || null,
      submission_version: latest?.version || null,
      submission_id: latest ? String(latest._id) : null,
      submission_code: latest?.submission_code || null,
      submitted_at: latest?.submitted_at || null,
      submission_comment: latest?.comment || null,
      reviewed_at: latest?.reviewed_at || null,
      review_comments: latest?.review_comments || null,
      reviewer_id: latest?.reviewer_id || null,
      revision_cycle: a.assignment?.revision_cycle || null,
      revision_requested_at: a.assignment?.revision_requested_at || null,
      revision_deadline: a.assignment?.revision_deadline || null,
      resubmission_available: false,
      resubmission_expires_in_ms: 0,
    };
  });

  for (const row of rows) {
    const eligibility = resubmissionEligibility(row, now);
    row.resubmission_available = eligibility.allowed;
    row.resubmission_expires_in_ms = eligibility.expires_in_ms;
  }

  return { counts, rows, assigneeCount: assignees.length, assignees };
}

/**
 * Whether a student may resubmit RIGHT NOW, according to the server clock.
 * Exported so the student eligibility endpoint and the resubmit endpoint share
 * one rule; the client only renders the result.
 */
function resubmissionEligibility(row, now = new Date()) {
  const status = row?.status || "pending";
  if (status !== "revision_required") {
    return {
      allowed: false,
      reason: status === "resubmission_expired"
        ? "The 24-hour resubmission window has expired."
        : "This task is not awaiting a revision.",
      expires_in_ms: 0,
      deadline: row?.revision_deadline || null,
    };
  }
  const deadline = row?.revision_deadline || null;
  if (!deadline) {
    // Legacy revision requested before the window existed: still resubmittable,
    // but we cannot show a deadline, so the UI says so instead of faking one.
    return { allowed: true, reason: null, expires_in_ms: 0, deadline: null };
  }
  const due = new Date(deadline);
  const ms = due.getTime() - now.getTime();
  if (Number.isNaN(due.getTime())) {
    return { allowed: false, reason: "The 24-hour resubmission window has expired.", expires_in_ms: 0, deadline };
  }
  if (ms <= 0) {
    return { allowed: false, reason: "The 24-hour resubmission window has expired.", expires_in_ms: 0, deadline };
  }
  return { allowed: true, reason: null, expires_in_ms: ms, deadline };
}

/**
 * Validate admin revision feedback. Mandatory, minimum length, enforced on the
 * server exactly as the client enforces it.
 */
function validateRevisionFeedback(feedback) {
  const value = String(feedback ?? "").trim();
  const min = revisionFeedbackMin();
  if (!value) {
    return { ok: false, code: "REVISION_FEEDBACK_REQUIRED", message: "Feedback is required when requesting a revision." };
  }
  if (value.length < min) {
    return {
      ok: false,
      code: "REVISION_FEEDBACK_TOO_SHORT",
      message: `Feedback must be at least ${min} characters so the student knows what to correct.`,
    };
  }
  return { ok: true, value };
}

/**
 * Persist an expiry for every open revision window that has passed.
 *
 * Called lazily from every read of the Task Manager and by the cron endpoint,
 * so a window closes on time even when nobody looks at the page. Notification
 * failures never abort the sweep: the state change is the source of truth.
 */
async function expireStaleRevisionWindows(db, { now = new Date(), notify = null } = {}) {
  const nowIso = now.toISOString();
  const stale = await db.collection("task_assignments")
    .find({
      status: "revision_required",
      revision_deadline: { $ne: null, $lte: nowIso },
      revision_status: "open",
    })
    .toArray();

  const expired = [];
  for (const assignment of stale) {
    const result = await db.collection("task_assignments").updateOne(
      { _id: assignment._id },
      {
        $set: { status: "resubmission_expired", revision_status: "expired", updated_at: nowIso },
      }
    );
    if (!result.modifiedCount) continue;

    // Close the matching open entry in revisionHistory.
    const history = Array.isArray(assignment.revision_history) ? assignment.revision_history : [];
    const idx = history.findIndex((h) => h && h.cycle === assignment.revision_cycle && h.status === "open");
    const nextHistory = history.slice();
    if (idx >= 0) nextHistory[idx] = { ...nextHistory[idx], status: "expired", expired_at: nowIso };

    await db.collection("task_assignments").updateOne(
      { _id: assignment._id },
      { $set: { revision_history: nextHistory } }
    );

    const task = await db.collection("tasks").findOne({ _id: toId(assignment.task_id) });
    if (task) {
      await db.collection("submissions").updateMany(
        { task_id: String(task._id), student_id: String(assignment.student_id), status: "Revision Required" },
        { $set: { status: "Revision Required", window_expired_at: nowIso } }
      );
    }

    expired.push({
      task_id: String(assignment.task_id),
      student_id: String(assignment.student_id),
      cycle: assignment.revision_cycle || null,
      deadline: assignment.revision_deadline || null,
      task_title: task?.title || null,
    });

    if (typeof notify === "function" && task) {
      try {
        await notify({ task, assignment, deadline: assignment.revision_deadline, now: nowIso });
      } catch (e) {
        console.error("[RevisionWindow] expiry notification failed:", e.message);
      }
    }
  }
  return expired;
}

module.exports = {
  LEGACY_SCOPE_DOMAIN,
  SCOPE_DOMAIN_FALLBACK,
  legacyDomainFor,
  resolveDomain,
  resolveProgram,
  loadTaskAssignees,
  resolveStatus,
  buildTaskStudentState,
  resubmissionEligibility,
  validateRevisionFeedback,
  expireStaleRevisionWindows,
  emptyCounts,
  taskDueAt,
  resubmissionWindowHours,
  toId,
};