/**
 * TaskAssignment model — per-student assignment state.
 *
 * One TaskAssignment per (task, student), enforced by the unique
 * index on { task_id, student_id }. All writes are idempotent
 * upserts, so retrying an assignment never duplicates rows.
 *
 * MongoDB note: the local/standalone mongod does not support
 * multi-document transactions (they require a replica set), so
 * batch assignment uses idempotent per-document upserts instead
 * of a session transaction. Each upsert is atomic; a retry
 * converges to the same state. The unique index is the hard
 * guard against duplicates.
 */

/** Upsert a single assignment. Returns "created" | "existing". */
async function upsertAssignment(db, { task_id, student_id, status = "assigned", progress = 0 }) {
  const now = new Date().toISOString();
  const res = await db.collection("task_assignments").updateOne(
    { task_id: String(task_id), student_id: String(student_id) },
    {
      $set: { updated_at: now },
      $setOnInsert: {
        status,
        progress,
        submission_version: null,
        submission_comment: null,
        submitted_at: null,
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
      status: opts.status || "assigned",
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
      student_id: String(studentId),
      status: "assigned",
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

/** Update per-student state (status/progress/submission snapshot). */
async function updateAssignment(db, taskId, studentId, updates) {
  const clean = {};
  for (const k of ["status", "progress", "submission_version", "submission_comment", "submitted_at"]) {
    if (updates[k] !== undefined) clean[k] = updates[k];
  }
  if (!Object.keys(clean).length) return null;
  clean.updated_at = new Date().toISOString();
  return db.collection("task_assignments").updateOne(
    { task_id: String(taskId), student_id: String(studentId) },
    { $set: clean },
    { upsert: false }
  );
}

/** List assignments for a task with student details (CEO/admin/manager). */
async function listAssignmentsForTask(db, taskId) {
  const rows = await db.collection("task_assignments")
    .find({ task_id: String(taskId) })
    .sort({ created_at: 1 })
    .toArray();
  return Promise.all(rows.map(async a => {
    const u = await db.collection("users").findOne(
      { _id: { $in: [a.student_id].map(s => { try { return require("mongodb").ObjectId(s); } catch { return s; } }) } },
      { projection: { name: 1, email: 1, batch_id: 1 } }
    );
    return {
      id: String(a._id),
      task_id: a.task_id,
      student_id: a.student_id,
      student_name: u?.name || null,
      student_email: u?.email || null,
      student_batch_id: u?.batch_id || null,
      status: a.status,
      progress: a.progress,
      submission_version: a.submission_version || null,
      submission_comment: a.submission_comment || null,
      submitted_at: a.submitted_at || null,
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
  updateAssignment,
  listAssignmentsForTask,
};
