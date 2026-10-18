/**
 * Task sessions — the server-side source of truth for how long a student has
 * been working on a task.
 *
 * Why a separate collection instead of a counter in the browser
 * ------------------------------------------------------------
 * A frontend counter resets on refresh, is lost when the student navigates
 * away, changes with the client clock and can be forged. A TaskSession is
 * written once by the SERVER, carries `started_at` in UTC, and is the only
 * value the submission snapshot is derived from. The browser never sends a
 * timestamp or a duration.
 *
 * Idempotency
 * -----------
 * A UNIQUE PARTIAL index on { student_id, task_id } where status = "active"
 * (created in mongodb.js ensureIndexes) makes "one active session per student
 * per task" a database guarantee — not a best-effort check. A double click,
 * two tabs or a repeated request all converge on the same session: the loser
 * of the race gets E11000 and simply re-reads the winner's row.
 *
 * Backward compatibility
 * ----------------------
 * Nothing here mutates `task_assignments`, `tasks` or `submissions` beyond
 * adding the optional timing snapshot to a NEW submission row, so every
 * existing record keeps working and old submissions without timing read as
 * "Not recorded" in the UI.
 */

const { ObjectId } = require("mongodb");

const ACTIVE = "active";
const COMPLETED = "completed";

function toId(id) {
  try { return new ObjectId(String(id)); } catch { return id; }
}

function nowIso() {
  return new Date().toISOString();
}

/** Whole seconds between two ISO instants, never negative, never NaN. */
function secondsBetween(startIso, endIso) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 1000));
}

/** Live elapsed seconds for a still-running session. */
function elapsedSeconds(startedAt, now = new Date()) {
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return 0;
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (Number.isNaN(nowMs)) return 0;
  return Math.max(0, Math.floor((nowMs - start) / 1000));
}

/** The one active session for a (student, task) pair, if any. */
async function getActiveSession(db, studentId, taskId) {
  return db.collection("task_sessions").findOne({
    student_id: String(studentId),
    task_id: String(taskId),
    status: ACTIVE,
  });
}

/** The most recently created session for a (student, task) pair, if any. */
async function latestSession(db, studentId, taskId) {
  const rows = await db.collection("task_sessions")
    .find({ student_id: String(studentId), task_id: String(taskId) })
    .sort({ created_at: -1 })
    .limit(1)
    .toArray();
  return rows[0] || null;
}

/** Active session if one exists, otherwise the latest (usually completed) one. */
async function currentSession(db, studentId, taskId) {
  const active = await getActiveSession(db, studentId, taskId);
  if (active) return active;
  return latestSession(db, studentId, taskId);
}

/**
 * Start (or reuse) the active session. Idempotent:
 *  - an existing active session is returned untouched (repeat Start, refresh,
 *    second tab, re-login all keep the ORIGINAL started_at);
 *  - two concurrent inserts race and the unique partial index lets exactly one
 *    through; the other re-reads it.
 */
async function startSession(db, { studentId, taskId, revisionCycle = 0 }) {
  const sid = String(studentId);
  const tid = String(taskId);

  const existing = await getActiveSession(db, sid, tid);
  if (existing) return existing;

  const now = nowIso();
  const doc = {
    student_id: sid,
    task_id: tid,
    status: ACTIVE,
    started_at: now,       // SERVER UTC time — never a client value
    ended_at: null,
    duration_seconds: null,
    revision_cycle: Number(revisionCycle) || 0,
    submission_id: null,
    created_at: now,
    updated_at: now,
  };

  try {
    const res = await db.collection("task_sessions").insertOne(doc);
    return { ...doc, _id: res.insertedId };
  } catch (err) {
    if (err && err.code === 11000) {
      // Lost the race: the other request created the session. Reuse it.
      const winner = await getActiveSession(db, sid, tid);
      if (winner) return winner;
    }
    throw err;
  }
}

/**
 * Close the active session (if any) and return it with its stored duration.
 * Returns null when there is nothing running, so a caller can tell "stopped a
 * timer" from "there was no timer".
 */
async function stopActiveSession(db, { studentId, taskId, endedAt = nowIso() }) {
  const sid = String(studentId);
  const tid = String(taskId);
  const active = await getActiveSession(db, sid, tid);
  if (!active) return null;

  const duration = secondsBetween(active.started_at, endedAt);
  await db.collection("task_sessions").updateOne(
    { _id: active._id, status: ACTIVE },
    { $set: { status: COMPLETED, ended_at: endedAt, duration_seconds: duration, updated_at: endedAt } }
  );
  return { ...active, status: COMPLETED, ended_at: endedAt, duration_seconds: duration };
}

/**
 * Build the timing snapshot a submission stores.
 *
 *  - If a session is running, it is stopped at `submittedAt` in the SAME
 *    operation (per the product rule: the timer stops only once the
 *    submission is saved).
 *  - If nothing is running (e.g. a revision resubmission, where the first
 *    session was already closed at v1), the latest session for this student
 *    and task is used so the version still carries a start time.
 *  - If there is no session at all, every field is null and the UI shows
 *    "Not recorded".
 *
 * The original v1 snapshot is never touched — a resubmission writes its own
 * values onto its OWN submission row.
 */
async function timingSnapshot(db, { studentId, taskId, submittedAt }) {
  const sid = String(studentId);
  const tid = String(taskId);

  let session = await getActiveSession(db, sid, tid);
  if (session) {
    session = (await stopActiveSession(db, { studentId: sid, taskId: tid, endedAt: submittedAt })) || session;
  } else {
    session = await latestSession(db, sid, tid);
  }

  if (!session || !session.started_at) {
    return { session_id: null, task_started_at: null, duration_seconds: null };
  }

  return {
    session_id: session._id ? String(session._id) : null,
    task_started_at: session.started_at,
    duration_seconds: secondsBetween(session.started_at, submittedAt),
  };
}

/** Wire shape for the API — never leaks Mongo internals beyond the string id. */
function sessionView(session, now = new Date()) {
  if (!session) {
    return {
      session_id: null,
      task_id: null,
      status: null,
      started_at: null,
      ended_at: null,
      duration_seconds: null,
      revision_cycle: 0,
      elapsed_seconds: 0,
      running: false,
    };
  }
  return {
    session_id: session._id ? String(session._id) : null,
    task_id: session.task_id || null,
    status: session.status || null,
    started_at: session.started_at || null,
    ended_at: session.ended_at || null,
    duration_seconds: session.duration_seconds ?? null,
    revision_cycle: session.revision_cycle ?? 0,
    elapsed_seconds: session.status === ACTIVE
      ? elapsedSeconds(session.started_at, now)
      : (session.duration_seconds ?? 0),
    running: session.status === ACTIVE,
  };
}

module.exports = {
  ACTIVE,
  COMPLETED,
  toId,
  secondsBetween,
  elapsedSeconds,
  getActiveSession,
  latestSession,
  currentSession,
  startSession,
  stopActiveSession,
  timingSnapshot,
  sessionView,
};
