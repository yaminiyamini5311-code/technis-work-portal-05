/**
 * TaskAssignment model — per-student assignment state.
 *
 * One TaskAssignment per (task, student), enforced by the unique
 * index on { task_id, student_id }. All writes are idempotent
 * upserts, so retrying an assignment never duplicates rows.
 *
 * `status` uses the shared enum from config/taskStatus.js:
 *   pending | in_progress | submitted | approved | revision_required |
 *   resubmission_expired
 * Rows written before that enum existed keep their legacy value ("assigned",
 * "Revision Required", ...); readers must run it through normalizeStatus()
 * (utils/submissionStatus.js does this for every Task Manager query).
 *
 * Revision bookkeeping lives here rather than on `submissions` because the
 * window belongs to the (student, task) pair and to a revision CYCLE: the same
 * student can go through several cycles, each with its own 24-hour deadline.
 *
 * MongoDB note: the local/standalone mongod does not support
 * multi-document transactions (they require a replica set), so
 * batch assignment uses idempotent per-document upserts instead
 * of a session transaction. Each upsert is atomic; a retry
 * converges to the same state. The unique index is the hard
 * guard against duplicates.
 */

const { ObjectId } = require("mongodb");
const { normalizeStatus } = require("../config/taskStatus");

function toId(id) {
  try { return new ObjectId(String(id)); } catch { return id; }
}

/** Upsert a single assignment. Returns "created" | "existing". */
async function upsertAssignment(db, { task_id, student_id, status = "pending", progress = 0 }) {
  const now = new Date().toISOString();
  const res = await db.collection("task_assignments").updateOne(
    { task_id: String(task_id), student_id: String(student_id) },
    {
      $set: { updated_at: now },
      $setOnInsert: {
        status: normalizeStatus(status),
        progress,
        submission_version: null,
        submission_comment: null,
        submitted_at: null,
        // Revision-cycle bookkeeping (all optional, so old rows stay valid).
        revision_cycle: 0,
        revision_requested_at: null,
        revision_deadline: null,
        revision_status: null,
        revision_history: [],
        created_at: now,
      },
    },
    { upsert: true }
  );
  return res.upsertedCount > 0 ? "created" : "existing";
}

/**
 * Create one TaskAssignment per student for a task.
 * Idempotent — safe to call again for the same task/students.
 * Returns { created: n, existing: n }.
 */
async function createAssignmentsForStudents(db, taskId, studentIds, opts = {}) {
  let created = 0, existing = 0;
  for (const sid of studentIds) {
    const outcome = await upsertAssignment(db, {
      task_id: taskId,
      student_id: sid,
      status: opts.status || "pending",
      progress: opts.progress || 0,
    });
    if (outcome === "created") created++;
    else existing++;
  }
  return { created, existing };
}

/**
 * A student joined (or moved to) a batch: materialize
 * assignments for every active batch task they do not already
 * have. Existing assignments (and their history) are untouched.
 */
async function createAssignmentsForStudent(db, studentId, batchId) {
  const tasks = await db.collection("tasks").find({
    batch_id: String(batchId),
    target_type: "batch",
  }).toArray();
  let created = 0;
  for (const t of tasks) {
    const outcome = await upsertAssignment(db, {
      task_id: String(t._id),
      student_id: studentId,
      status: "pending",
      progress: 0,
    });
    if (outcome === "created") created++;
  }
  return { created, batch_task_count: tasks.length };
}

/** All task_ids a student has an assignment for. */
async function getStudentTaskIds(db, studentId) {
  const rows = await db.collection("task_assignments")
    .find({ student_id: String(studentId) }, { projection: { task_id: 1 } })
    .toArray();
  return rows.map(r => r.task_id);
}

/** The student's assignment for one task, if any. */
async function getAssignment(db, taskId, studentId) {
  return db.collection("task_assignments").findOne({
    task_id: String(taskId),
    student_id: String(studentId),
  });
}

/**
 * Fields a caller may write through updateAssignment().
 * `status` accepts either the shared enum or a legacy value (normalized here).
 * Review/feedback/deadline fields are deliberately listed so a reviewer action
 * can set them, while students can never reach updateAssignment with them
 * (the submit/resubmit routes strip client-supplied fields first).
 */
const WRITABLE_FIELDS = [
  "progress",
  "submission_version",
  "submission_comment",
  "submitted_at",
  "revision_cycle",
  "revision_requested_at",
  "revision_deadline",
  "revision_status",
  "revision_history",
];

/** Update per-student state (status/progress/submission snapshot). */
async function updateAssignment(db, taskId, studentId, updates) {
  const clean = {};
  if (updates.status !== undefined) clean.status = normalizeStatus(updates.status);
  for (const k of WRITABLE_FIELDS) {
    if (updates[k] !== undefined) clean[k] = updates[k];
  }
  if (!Object.keys(clean).length) return null;
  clean.updated_at = new Date().toISOString();
  
  // Use upsert: true to create the assignment if it doesn't exist yet.
  // This handles "previous tasks" that were assigned via the legacy assigned_to
  // field but don't have a task_assignments record. When the student submits,
  // we need to create the assignment record to properly track the submission status.
  const setOnInsert = {
    task_id: String(taskId),
    student_id: String(studentId),
    progress: 0,
    created_at: new Date().toISOString(),
  };
  
  // Only set status in $setOnInsert if it's not in $set (avoid conflict)
  if (!clean.status) {
    setOnInsert.status = "pending";
  }
  
  const result = await db.collection("task_assignments").updateOne(
    { task_id: String(taskId), student_id: String(studentId) },
    { 
      $set: clean,
      $setOnInsert: setOnInsert
    },
    { upsert: true }
  );
  
  return result;
}

/**
 * Create (or reuse) the assignment row for a (task, student) pair.
 * Reviewer actions must never be blocked by a missing snapshot — a student
 * added to a batch after the task was created still has to be reviewable.
 */
async function ensureAssignment(db, taskId, studentId, { status = "pending", progress = 0 } = {}) {
  const created = await upsertAssignment(db, { task_id: taskId, student_id: studentId, status, progress });
  return { assignment: await getAssignment(db, taskId, studentId), created };
}

/** List assignments for a task with student details (CEO/admin/manager). */
async function listAssignmentsForTask(db, taskId) {
  const rows = await db.collection("task_assignments")
    .find({ task_id: String(taskId) })
    .sort({ created_at: 1 })
    .toArray();
  return Promise.all(rows.map(async a => {
    const u = await db.collection("users").findOne(
      { _id: toId(a.student_id) },
      { projection: { name: 1, email: 1, batch_id: 1, program: 1, department: 1, student_id: 1, learner_id: 1 } }
    );
    return {
      id: String(a._id),
      task_id: a.task_id,
      student_id: a.student_id,
      student_name: u?.name || null,
      student_email: u?.email || null,
      student_code: u?.student_id || u?.learner_id || null,
      student_department: u?.department || null,
      student_program: u?.program || null,
      student_batch_id: u?.batch_id || null,
      status: normalizeStatus(a.status),
      raw_status: a.status || null,
      progress: a.progress,
      submission_version: a.submission_version || null,
      submission_comment: a.submission_comment || null,
      submitted_at: a.submitted_at || null,
      revision_cycle: a.revision_cycle || 0,
      revision_requested_at: a.revision_requested_at || null,
      revision_deadline: a.revision_deadline || null,
      revision_status: a.revision_status || null,
      revision_history: Array.isArray(a.revision_history) ? a.revision_history : [],
      created_at: a.created_at || null,
      updated_at: a.updated_at || null,
    };
  }));
}

module.exports = {
  upsertAssignment,
  createAssignmentsForStudents,
  createAssignmentsForStudent,
  getStudentTaskIds,
  getAssignment,
  ensureAssignment,
  updateAssignment,
  listAssignmentsForTask,
  normalizeStatus,
  WRITABLE_FIELDS,
};