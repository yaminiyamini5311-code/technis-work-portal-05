/**
 * Notification writer for the task workflow.
 *
 * Everything is persisted in MongoDB (the existing `notifications` collection),
 * so a notification survives refresh, a new tab and a fresh login — nothing is
 * kept in component state or localStorage.
 *
 * Deduplication
 * -------------
 * Every workflow notification carries a deterministic `dedupe_key` built from
 * (user, type, task, submission, cycle). A UNIQUE SPARSE index on that field
 * (created in mongodb.js ensureIndexes) turns "don't send it twice" into a
 * database guarantee rather than a best-effort read-then-insert:
 *   - clicking Approve / Request Revision / Send Reminder twice is safe
 *   - the expiry sweep can run every hour without spamming students
 *   - two concurrent requests cannot both insert
 *
 * SPARSE matters: historical rows have no `dedupe_key` at all, so indexing them
 * is skipped and they can never collide with each other or be rejected.
 */

const { ObjectId } = require("mongodb");

function toId(id) {
  try { return new ObjectId(String(id)); } catch { return id; }
}

function buildDedupeKey({ userId, type, taskId = null, submissionId = null, missionId = null, cycle = null, changeHash = null }) {
  return [
    String(userId),
    String(type),
    taskId ? String(taskId) : "",
    submissionId ? String(submissionId) : "",
    missionId ? String(missionId) : "",
    cycle != null ? String(cycle) : "",
    changeHash ? String(changeHash) : "",
  ].join("|");
}

/**
 * Deep link for a notification, so clicking it lands on the exact view that
 * needs attention instead of a generic list.
 */
function buildDeepLink({ recipientRole, type, taskId, submissionId, studentId }) {
  const isAdmin = recipientRole === "admin" || recipientRole === "ceo" || recipientRole === "manager";
  if (isAdmin) {
    if (type === "revision_requested" || type === "submission_received" || type === "resubmission_received") {
      const base = recipientRole === "ceo" ? "admin" : recipientRole;
      return taskId ? `/${base}/tasks/${taskId}/review` : null;
    }
    const base = recipientRole === "ceo" ? "admin" : recipientRole;
    return taskId ? `/${base}/tasks` : null;
  }
  // Students deep link to the task's own page (the route registered in
  // client/src/App.jsx: /student/tasks/:taskId), where the live timer, the
  // resubmit section and the revision countdown live.
  return taskId ? `/student/tasks/${taskId}` : "/student/feedback";
}

/**
 * Insert a notification unless the same (user, type, task, submission, cycle)
 * already exists. Returns { created: boolean, notification }.
 */
async function notifyOnce(db, {
  userId,
  studentId = null,
  type,
  title,
  message,
  taskId = null,
  submissionId = null,
  missionId = null,
  cycle = null,
  changeHash = null,
  recipientRole = null,
  revisionRequestedAt = null,
  revisionDeadline = null,
  actionUrl = null,
  meta = null,
}) {
  if (!db || !userId || !type || !title || !message) return { created: false, notification: null };

  const dedupe_key = buildDedupeKey({ userId, type, taskId, submissionId, missionId, cycle, changeHash });
  const now = new Date().toISOString();
  const doc = {
    user_id: String(userId),
    type: String(type),
    title: String(title),
    message: String(message),
    // related_task_id is the historical field the NotificationBell and the
    // existing queries read; the explicit names are the new, unambiguous ones.
    related_task_id: taskId ? String(taskId) : null,
    task_id: taskId ? String(taskId) : null,
    submission_id: submissionId ? String(submissionId) : null,
    mission_id: missionId ? String(missionId) : null,
    student_id: studentId ? String(studentId) : null,
    cycle: cycle != null ? (Number.isFinite(Number(cycle)) ? Number(cycle) : String(cycle)) : null,
    revision_requested_at: revisionRequestedAt || null,
    revision_deadline: revisionDeadline || null,
    action_url: actionUrl || buildDeepLink({ recipientRole, type, taskId, submissionId, studentId }),
    change_hash: changeHash ? String(changeHash) : null,
    meta: meta || null,
    dedupe_key,
    read_at: null,
    created_at: now,
  };

  try {
    const res = await db.collection("notifications").insertOne(doc);
    return { created: true, notification: { ...doc, id: String(res.insertedId), _id: res.insertedId } };
  } catch (err) {
    // 11000 = the unique index did its job: this exact notification already
    // exists. Returning "not created" is success, not an error.
    if (err && err.code === 11000) return { created: false, notification: null, duplicate: true };
    console.error("[Notifications] insert failed:", err.message);
    return { created: false, notification: null };
  }
}

/** Every active admin/CEO account (the reviewers who need to know). */
async function adminRecipients(db) {
  const admins = await db.collection("users")
    .find({ role: { $in: ["admin", "ceo"] }, active: 1 }, { projection: { _id: 1, role: 1 } })
    .toArray();
  const seen = new Set();
  const unique = [];
  for (const a of admins) {
    const key = String(a._id);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ id: key, role: a.role });
  }
  return unique;
}

/**
 * Fan a notification out to every admin/CEO, deduplicated per recipient.
 * Returns the number of notifications actually created.
 */
async function notifyAdmins(db, payload) {
  const recipients = await adminRecipients(db);
  let created = 0;
  for (const recipient of recipients) {
    const result = await notifyOnce(db, { ...payload, userId: recipient.id, recipientRole: recipient.role });
    if (result.created) created += 1;
  }
  return created;
}

/**
 * The revision message. No hardcoded task or deadline: every value comes from
 * the request that created the revision cycle.
 */
function revisionMessage({ taskTitle, feedback, deadlineLabel }) {
  return `Your submission for ${taskTitle} requires revision. Admin feedback: ${feedback} Please correct your submission and resubmit within 24 hours, by ${deadlineLabel}.`;
}

module.exports = {
  buildDedupeKey,
  buildDeepLink,
  notifyOnce,
  notifyAdmins,
  adminRecipients,
  revisionMessage,
  toId,
};