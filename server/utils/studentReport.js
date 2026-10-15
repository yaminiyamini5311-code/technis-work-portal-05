/**
 * Student report builder — shared by the CEO/manager Performance and
 * Feedback reports.
 *
 * DESIGN RULES
 *  - Every record is resolved per (student_id, task_id). Nothing here can
 *    leak one student's submission, score or feedback into another's.
 *  - Scores are OPTIONAL. The schema has no mandatory score/max_marks pair,
 *    so nothing is invented: a task without a stored numeric score is
 *    reported as "awaiting evaluation" and excluded from the totals.
 *  - Overall percentage is only produced when at least one scored task
 *    carries a valid, positive max_marks value. Otherwise it stays null so
 *    the UI can honestly say the student has not been evaluated.
 */

function toId(id) { try { return new ObjectId(id); } catch { return id; } }

const { ObjectId } = require("mongodb");

/** Normalise a value to a finite number or null. */
function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isPositive(n) { return n !== null && n > 0; }

/** Derive the per-student, per-task state from real records only. */
function deriveState({ assignment, submission, endAt, now }) {
  const aStatus = String(assignment?.status || "").toLowerCase();
  const sStatus = String(submission?.status || "");
  const sStatusLc = sStatus.toLowerCase();

  if (sStatusLc === "approved" || aStatus === "approved") return "approved";
  if (sStatusLc === "revision required" || aStatus === "revision_required") return "revision_required";
  if (submission) return "submitted";
  if (aStatus === "in_progress") return "in_progress";
  return "not_started";
}

function isOverdue({ state, endAt, now }) {
  if (!endAt || state === "approved") return false;
  const end = new Date(endAt);
  return !Number.isNaN(end.getTime()) && end.getTime() < now.getTime();
}

/**
 * Build the full report for one student.
 * @param {import("mongodb").Db} db
 * @param {object} student  student document (role: student)
 */
async function buildStudentReport(db, student) {
  const studentId = String(student._id);
  const now = new Date();

  const assignments = await db.collection("task_assignments")
    .find({ student_id: studentId })
    .toArray();

  const taskIds = assignments.map((a) => String(a.task_id));

  // Legacy tasks assigned directly via tasks.assigned_to (no assignment row).
  const legacyTasks = await db.collection("tasks")
    .find({ assigned_to: studentId })
    .toArray();
  for (const t of legacyTasks) {
    const id = String(t._id);
    if (!taskIds.includes(id)) taskIds.push(id);
  }

  const objectIds = taskIds.map(toId);
  const tasks = taskIds.length
    ? await db.collection("tasks").find({ _id: { $in: objectIds } }).toArray()
    : [];
  const taskById = new Map(tasks.map((t) => [String(t._id), t]));

  const submissions = taskIds.length
    ? await db.collection("submissions")
        .find({ task_id: { $in: taskIds }, student_id: studentId })
        .toArray()
    : [];

  // Latest version per task (highest version, then newest).
  const latestByTask = new Map();
  for (const s of submissions) {
    const key = String(s.task_id);
    const cur = latestByTask.get(key);
    if (!cur || (s.version || 0) > (cur.version || 0) ||
        (s.version || 0) === (cur.version || 0) && String(s.submitted_at || "") > String(cur.submitted_at || "")) {
      latestByTask.set(key, s);
    }
  }

  // Reviewer names (deduplicated).
  const reviewerIds = [...new Set(submissions.map((s) => s.reviewer_id).filter(Boolean).map(String))];
  const reviewers = reviewerIds.length
    ? await db.collection("users").find({ _id: { $in: reviewerIds.map(toId) } }, { projection: { name: 1 } }).toArray()
    : [];
  const reviewerName = new Map(reviewers.map((r) => [String(r._id), r.name]));

  const assignmentByTask = new Map(assignments.map((a) => [String(a.task_id), a]));

  const endAtOf = (t) => t.due_at || (t.due_date ? `${t.due_date}T${t.due_time || "23:59"}:00` : null);

  const taskRows = tasks
    .filter((t) => taskById.has(String(t._id)))
    .map((t) => {
      const tid = String(t._id);
      const assignment = assignmentByTask.get(tid) || null;
      const submission = latestByTask.get(tid) || null;
      const state = deriveState({ assignment, submission, endAt: endAtOf(t), now });
      const overdue = isOverdue({ state, endAt: endAtOf(t), now });
      const score = numOrNull(submission?.score);
      const maxMarks = numOrNull(submission?.max_marks);
      const hasScore = isPositive(maxMarks) && numOrNull(submission?.earned_score ?? submission?.score) !== null;
      return {
        task_id: tid,
        task_code: t.task_code || null,
        title: t.title || null,
        day: t.day_number ?? t.day ?? null,
        domain: t.domain || null,
        priority: t.priority || null,
        due_at: endAtOf(t),
        start_at: t.start_at || (t.start_date ? `${t.start_date}T${t.start_time || "00:00"}:00` : null),
        state,
        overdue,
        progress: numOrNull(assignment?.progress),
        assignment_status: assignment?.status || null,
        submission: submission ? {
          id: String(submission._id),
          submission_code: submission.submission_code || null,
          version: submission.version ?? null,
          status: submission.status || null,
          submitted_at: submission.submitted_at || null,
          reviewed_at: submission.reviewed_at || null,
          reviewer_name: submission.reviewer_id ? (reviewerName.get(String(submission.reviewer_id)) || null) : null,
          review_comments: submission.review_comments || null,
          comment: submission.comment || null,
          file_count: 0,
        } : null,
        score: hasScore ? score : null,
        max_marks: hasScore ? maxMarks : null,
        has_score: Boolean(hasScore),
        awaiting_evaluation: Boolean(submission) && !hasScore,
      };
    })
    .sort((a, b) => {
      if (a.day !== null && b.day !== null) return a.day - b.day;
      if (a.day !== null) return -1;
      if (b.day !== null) return 1;
      return String(a.task_code || a.task_id).localeCompare(String(b.task_code || b.task_id));
    });

  // File counts per latest submission (batch query, no N+1 in the hot path).
  const subIds = taskRows.map((r) => r.submission?.id).filter(Boolean);
  if (subIds.length) {
    const counts = await db.collection("submission_files")
      .aggregate([{ $match: { submission_id: { $in: subIds } } }, { $group: { _id: "$submission_id", n: { $sum: 1 } } }])
      .toArray();
    const byId = new Map(counts.map((c) => [String(c._id), c.n]));
    for (const r of taskRows) if (r.submission) r.submission.file_count = byId.get(r.submission.id) || 0;
  }

  const counts = {
    total: taskRows.length,
    approved: taskRows.filter((r) => r.state === "approved").length,
    submitted: taskRows.filter((r) => r.state === "submitted").length,
    revision_required: taskRows.filter((r) => r.state === "revision_required").length,
    in_progress: taskRows.filter((r) => r.state === "in_progress").length,
    not_started: taskRows.filter((r) => r.state === "not_started").length,
    overdue: taskRows.filter((r) => r.overdue).length,
    pending: taskRows.filter((r) => r.state === "not_started" || r.state === "in_progress").length,
    scored: taskRows.filter((r) => r.has_score).length,
    awaiting_evaluation: taskRows.filter((r) => r.awaiting_evaluation).length,
  };

  const scored = taskRows.filter((r) => r.has_score);
  const totalEarned = scored.reduce((sum, r) => sum + (r.score ?? 0), 0);
  const totalMax = scored.reduce((sum, r) => sum + (r.max_marks ?? 0), 0);
  const scoring = {
    scored_tasks: scored.length,
    total_earned: scored.length ? Number(totalEarned.toFixed(2)) : 0,
    total_max: scored.length ? Number(totalMax.toFixed(2)) : 0,
    overall_percentage: totalMax > 0 ? Number(((totalEarned / totalMax) * 100).toFixed(2)) : null,
    has_scores: scored.length > 0,
    basis: scored.length ? "task_scores" : "none",
  };

  let batchName = null;
  if (student.batch_id) {
    const b = await db.collection("batches").findOne({ _id: toId(student.batch_id) }, { projection: { name: 1 } });
    batchName = b?.name || null;
  }

  return {
    student: {
      id: studentId,
      student_id: student.student_id || studentId,
      name: student.name,
      email: student.email,
      department: student.department || null,
      program: student.program || null,
      batch: student.batch_id,
      batch_name: batchName,
    },
    tasks: taskRows,
    counts,
    scoring,
  };
}

module.exports = { buildStudentReport, deriveState, numOrNull };