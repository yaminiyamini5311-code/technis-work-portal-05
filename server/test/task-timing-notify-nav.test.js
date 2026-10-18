"use strict";
/**
 * Task timing, submission lock, task-edit notifications and student navigation
 * — end-to-end tests.
 *
 * WHAT THIS COVERS
 *  1. The timer is SERVER-owned: Start writes `started_at` on the server, is
 *     idempotent (repeat Start / refresh / second tab keep the ORIGINAL time),
 *     and a student cannot forge a timestamp or a duration.
 *  2. The timer survives a re-login and drives `/api/tasks/my` and
 *     `/:id/session`.
 *  3. Submitting stops the timer and snapshots `task_started_at`,
 *     `task_submitted_at` and the real `duration_seconds` onto that version.
 *  4. The CEO/manager submissions list and detail expose that timing, and a
 *     legacy row without timing reads as null ("Not recorded") instead of "0".
 *  5. A student can create exactly ONE first version: a second submit is a 409
 *     ALREADY_SUBMITTED, and the unique partial index that enforces it exists.
 *  6. Editing a task with no real change sends NO notification.
 *  7. A real edit notifies only the students ASSIGNED to that task and the
 *     message names the actual field diff.
 *  8. Re-applying the SAME change is de-duplicated by the change hash.
 *  9. The student deep link in the notification points at the task page, and
 *     the client routes exist for both the canonical and alias paths.
 * 10. The duration and date formatters produce the exact required strings.
 * 11. The starfield keeps its stars but scrolls more slowly and more smoothly.
 *
 * SAFETY — TEST DATABASE ONLY
 *  This suite REFUSES to run against a non-test database. It targets a database
 *  whose name ends in "_test" (default `techins_test`) unless MONGODB_URI_TEST
 *  is provided. It never writes to the development database; the only read of
 *  the dev database is copying the admin login document into the test database
 *  so the suite can authenticate. Everything it creates is tracked and removed
 *  in teardown. Google Drive is forced to MOCK mode.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// Load the developer environment for JWT_SECRET / MONGODB_URI. This does NOT
// authorise writing to the dev database — the guard below decides the target.
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

/* ─── TEST-DATABASE GUARD ───────────────────────────────────────────────────
 * Two safe ways to run:
 *   a) MONGODB_URI_TEST=<...>            (its own cluster / database)
 *   b) MONGODB_TEST_DB_NAME ending in _test   (default: techins_test)
 * Anything else throws before a single connection is opened.
 * ────────────────────────────────────────────────────────────────────────── */
const HAS_TEST_URI = Boolean(process.env.MONGODB_URI_TEST);
const TEST_DB_NAME = process.env.MONGODB_TEST_DB_NAME || "techins_test";
const DEV_DB_NAME = process.env.MONGODB_DB_NAME || "techins";
if (!HAS_TEST_URI && !/_test$/.test(TEST_DB_NAME)) {
  throw new Error(
    `Refusing to run: target database "${TEST_DB_NAME}" is not a test database. ` +
      `Set MONGODB_TEST_DB_NAME to a name ending in "_test" (e.g. techins_test), ` +
      `or provide MONGODB_URI_TEST.`
  );
}
const TEST_URI = process.env.MONGODB_URI_TEST || process.env.MONGODB_URI;

const PORT = Number(process.env.TASK_TIMING_PORT || 5096);
const BASE = `http://127.0.0.1:${PORT}`;
const TAG = `tt-${Date.now()}`;
const TEST_PASSWORD = "TaskTiming-Test-Pass-2026";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@techins.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin@123";

let serverProcess = null;
let serverLogs = "";
let adminToken = "";
let batchId = null;

const created = { userIds: [], taskIds: [], submissionIds: [], batchIds: [] };
const ctx = {};

async function api(method, urlPath, { token, body, form, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${urlPath}`, { method, headers: h, body: payload });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON (file streams) */ }
  return { status: res.status, headers: res.headers, json, res };
}

async function waitForServer(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const health = await fetch(`${BASE}/api/health`);
      if (health.ok) {
        const probe = await fetch(`${BASE}/api/batches`);
        if (probe.ok) return;
      }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Server not healthy in ${timeoutMs}ms.\n${serverLogs.slice(-2000)}`);
}

/** Open the TEST database. Always close the client. */
async function tdb() {
  const { MongoClient } = require("mongodb");
  const client = new MongoClient(TEST_URI, { serverSelectionTimeoutMS: 6000 });
  await client.connect();
  return { client, database: client.db(TEST_DB_NAME) };
}

/** Copy the admin login into the test DB so the suite can authenticate. */
async function seedAdmin() {
  const { MongoClient } = require("mongodb");
  const dev = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 6000 });
  const t = new MongoClient(TEST_URI, { serverSelectionTimeoutMS: 6000 });
  await Promise.all([dev.connect(), t.connect()]);
  try {
    const testUsers = t.db(TEST_DB_NAME).collection("users");
    const existing = await testUsers.findOne({ email: ADMIN_EMAIL });
    if (existing) return;
    const admin = await dev.db(DEV_DB_NAME).collection("users").findOne({ email: ADMIN_EMAIL });
    assert.ok(admin, `admin ${ADMIN_EMAIL} not found in ${DEV_DB_NAME}; cannot seed the test database`);
    await testUsers.insertOne(admin);
  } finally {
    await dev.close();
    await t.close();
  }
}

const pdfForm = (comment, name = "work.pdf") => {
  const form = new FormData();
  form.append("comment", comment);
  form.append("files", new Blob([Buffer.from(`%PDF-1.4 ${comment} ${name}`)], { type: "application/pdf" }), name);
  return form;
};

const IN_RANGE = (value, lo, hi) => typeof value === "number" && value >= lo && value <= hi;

/* ─── Setup ──────────────────────────────────────────────────────────────── */
test.before(async () => {
  await seedAdmin();

  serverProcess = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      MONGODB_DB_NAME: TEST_DB_NAME,
      GOOGLE_DRIVE_MOCK: "true",
      // Point the server at the explicit test URI when one was supplied.
      ...(HAS_TEST_URI ? { MONGODB_URI: process.env.MONGODB_URI_TEST } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout.on("data", (d) => { serverLogs += d.toString(); });
  serverProcess.stderr.on("data", (d) => { serverLogs += d.toString(); });
  await waitForServer();

  const login = await api("POST", "/api/auth/login", { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  assert.equal(login.status, 200, `admin login failed: ${JSON.stringify(login.json)}\n${serverLogs.slice(-1500)}`);
  adminToken = login.json.token;

  // Dedicated batch + two approved students.
  const { client, database } = await tdb();
  const batchName = `${TAG} batch`;
  await database.collection("batches").insertOne({ name: batchName, active: true, created_at: new Date().toISOString() });
  const batch = await database.collection("batches").findOne({ name: batchName });
  batchId = String(batch._id);
  created.batchIds.push(batchId);
  await client.close();

  for (const who of ["alice", "bob"]) {
    const signup = await api("POST", "/api/auth/signup", {
      body: { name: `${TAG} ${who}`, email: `${TAG}-${who}@example.invalid`, password: TEST_PASSWORD, role: "student", phone: "9876543210", batchId },
    });
    assert.equal(signup.status, 201, `signup ${who}: ${JSON.stringify(signup.json)}`);
    created.userIds.push(signup.json.userId);

    const loginRes = await api("POST", "/api/auth/login", { body: { email: `${TAG}-${who}@example.invalid`, password: TEST_PASSWORD } });
    const approve = await api("POST", `/api/admin/approve-registration/${loginRes.json.user.id}`, { token: adminToken });
    assert.equal(approve.status, 200, `approve ${who}: ${JSON.stringify(approve.json)}`);
  }

  for (const who of ["alice", "bob"]) {
    const l = await api("POST", "/api/auth/login", { body: { email: `${TAG}-${who}@example.invalid`, password: TEST_PASSWORD } });
    assert.equal(l.status, 200);
    ctx[who] = { token: l.json.token, id: l.json.user.id, name: `${TAG} ${who}` };
  }

  // One batch task covering both students.
  const task = await api("POST", "/api/tasks", {
    token: adminToken,
    body: {
      title: `${TAG} | Timing`,
      description: "Task timing / submission lock test",
      domain: "edutins",
      target_type: "batch",
      batch_id: batchId,
      priority: "high",
      start_date: "2020-01-01",
      due_date: "2099-01-01",
    },
  });
  assert.equal(task.status, 201, `task create: ${JSON.stringify(task.json)}`);
  ctx.taskId = task.json.taskId;
  created.taskIds.push(ctx.taskId);
});

test.after(async () => {
  if (serverProcess) serverProcess.kill();
  try {
    const { client, database } = await tdb();
    const { ObjectId } = require("mongodb");
    const oid = (v) => { try { return new ObjectId(String(v)); } catch { return null; } };

    if (created.taskIds.length) {
      await database.collection("task_assignments").deleteMany({ task_id: { $in: created.taskIds } });
      await database.collection("task_status_history").deleteMany({ task_id: { $in: created.taskIds } });
      await database.collection("task_sessions").deleteMany({ task_id: { $in: created.taskIds } });
      await database.collection("notifications").deleteMany({ task_id: { $in: created.taskIds } });
    }
    if (created.submissionIds.length) {
      await database.collection("submission_files").deleteMany({ submission_id: { $in: created.submissionIds } });
      await database.collection("submissions").deleteMany({ _id: { $in: created.submissionIds.map(oid).filter(Boolean) } });
    }
    if (created.userIds.length) {
      await database.collection("task_assignments").deleteMany({ student_id: { $in: created.userIds } });
      await database.collection("task_sessions").deleteMany({ student_id: { $in: created.userIds } });
      await database.collection("notifications").deleteMany({ user_id: { $in: created.userIds } });
      await database.collection("submissions").deleteMany({ student_id: { $in: created.userIds } });
      await database.collection("performance").deleteMany({ user_id: { $in: created.userIds } });
      await database.collection("users").deleteMany({ _id: { $in: created.userIds.map(oid).filter(Boolean) } });
    }
    if (created.taskIds.length) {
      await database.collection("tasks").deleteMany({ _id: { $in: created.taskIds.map(oid).filter(Boolean) } });
    }
    if (created.batchIds.length) {
      await database.collection("batches").deleteMany({ _id: { $in: created.batchIds.map(oid).filter(Boolean) } });
    }
    await client.close();
    console.log(
      `[task-timing] cleanup on "${TEST_DB_NAME}": ${created.userIds.length} users, ` +
        `${created.taskIds.length} tasks, ${created.submissionIds.length} submissions, ${created.batchIds.length} batch removed`
    );
  } catch (e) {
    console.error("[task-timing] cleanup error:", e.message);
  }
});

/* ─── 0. Formatting contracts (pure, run against the real source) ─────────── */
test("0. the shared formatters produce the exact required strings", async () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "utils", "dateHelper.js"), "utf8");
  const mod = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));

  // "1 hour, 25 minutes, 30 seconds" with correct singular / plural.
  assert.equal(mod.formatDuration(5130), "1 hour, 25 minutes, 30 seconds");
  assert.equal(mod.formatDuration(1), "1 second");
  assert.equal(mod.formatDuration(60), "1 minute");
  assert.equal(mod.formatDuration(3600), "1 hour");
  assert.equal(mod.formatDuration(0), "0 seconds");
  assert.equal(mod.formatDuration(null), null, "a missing duration must stay null so the UI shows 'Not recorded'");

  // ONE date format, Asia/Kolkata, seconds, upper-case meridiem.
  // 18 Oct 2026 10:00:00 IST == 04:30:00 UTC.
  assert.equal(mod.formatWorkspaceDateTime("2026-10-18T04:30:00.000Z"), "18 Oct 2026, 10:00:00 AM");
});

/* ─── 1–4. Server-owned timer ─────────────────────────────────────────────── */
test("1. Start creates a SERVER-owned session and a forged timestamp in the body is ignored", async () => {
  const before = Date.now();
  const res = await api("POST", `/api/tasks/${ctx.taskId}/start`, {
    token: ctx.alice.token,
    // A student must never be able to influence the clock.
    body: { started_at: "2000-01-01T00:00:00.000Z", duration_seconds: 999999 },
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const s = res.json.data;

  assert.equal(s.running, true);
  assert.ok(s.started_at, "the server must record started_at");
  assert.ok(s.session_id, "a session id must come back");
  assert.equal(s.duration_seconds, null, "a running session has no duration yet");

  const startedMs = new Date(s.started_at).getTime();
  assert.ok(startedMs >= before - 2000 && startedMs <= Date.now() + 2000,
    `started_at must be server 'now', not the forged value (got ${s.started_at})`);
  assert.ok(s.server_now, "the server clock must be returned for the live display");

  // The student's assignment is now in progress.
  const st = await api("GET", `/api/tasks/${ctx.taskId}/my-submission-status`, { token: ctx.alice.token });
  assert.equal(st.status, 200, JSON.stringify(st.json));
  assert.equal((st.json.data || st.json).status, "in_progress");

  ctx.sessionId = s.session_id;
  ctx.startedAt = s.started_at;
});

test("2. Start is idempotent — a second click / refresh keeps the ORIGINAL started_at", async () => {
  const again = await api("POST", `/api/tasks/${ctx.taskId}/start`, { token: ctx.alice.token });
  assert.equal(again.status, 200, JSON.stringify(again.json));
  assert.equal(again.json.data.started_at, ctx.startedAt, "repeat Start must reuse the running session");
  assert.equal(again.json.data.session_id, ctx.sessionId);

  // Only ONE active session exists for this student + task.
  const { client, database } = await tdb();
  const activeCount = await database.collection("task_sessions").countDocuments({
    student_id: ctx.alice.id, task_id: ctx.taskId, status: "active",
  });
  await client.close();
  assert.equal(activeCount, 1, "exactly one active session per student + task");
});

test("3. the timer is exposed through /:id/session and /api/tasks/my and survives re-login", async () => {
  const sess = await api("GET", `/api/tasks/${ctx.taskId}/session`, { token: ctx.alice.token });
  assert.equal(sess.status, 200, JSON.stringify(sess.json));
  assert.equal(sess.json.data.running, true);
  assert.equal(sess.json.data.started_at, ctx.startedAt);
  assert.ok(sess.json.data.elapsed_seconds >= 0);

  const my = await api("GET", "/api/tasks/my", { token: ctx.alice.token });
  assert.equal(my.status, 200, JSON.stringify(my.json));
  assert.ok(my.json.server_now, "/my must return the server clock");
  const row = my.json.tasks.find((t) => t.id === ctx.taskId);
  assert.ok(row, "the task must be in the student's list");
  assert.equal(row.session.started_at, ctx.startedAt, "the list must carry the running session");
  assert.equal(row.session.running, true);

  // Refresh: a brand new token sees the exact same start instant.
  const relogin = await api("POST", "/api/auth/login", { body: { email: `${TAG}-alice@example.invalid`, password: TEST_PASSWORD } });
  const after = await api("GET", `/api/tasks/${ctx.taskId}/session`, { token: relogin.json.token });
  assert.equal(after.json.data.started_at, ctx.startedAt, "re-login must not restart the clock");
});

/* ─── 6–7. Submission snapshot + lock ────────────────────────────────────── */
test("4. submitting stops the timer and snapshots the real duration onto v1", async () => {
  // "Time passes": move the stored start 90s into the past. This is exactly
  // what the server sees 90 seconds later, without waiting.
  const { client, database } = await tdb();
  await database.collection("task_sessions").updateOne(
    { student_id: ctx.alice.id, task_id: ctx.taskId, status: "active" },
    { $set: { started_at: new Date(Date.now() - 90000).toISOString() } }
  );
  await client.close();

  const sub = await api("POST", `/api/tasks/${ctx.taskId}/submit`, { token: ctx.alice.token, form: pdfForm("Alice timing v1") });
  assert.equal(sub.status, 201, JSON.stringify(sub.json));
  assert.equal(sub.json.version, 1);
  created.submissionIds.push(sub.json.submissionId);
  ctx.submissionId = sub.json.submissionId;

  assert.ok(sub.json.data.task_started_at, "the snapshot must carry the start time");
  assert.ok(IN_RANGE(sub.json.data.duration_seconds, 88, 96),
    `duration must reflect the real elapsed time (~90s), got ${sub.json.data.duration_seconds}`);

  // The session is closed and its duration is frozen.
  const sess = await api("GET", `/api/tasks/${ctx.taskId}/session`, { token: ctx.alice.token });
  assert.equal(sess.json.data.running, false, "submitting must stop the timer");
  assert.ok(IN_RANGE(sess.json.data.duration_seconds, 88, 96), `stored duration ~90s, got ${sess.json.data.duration_seconds}`);
  assert.equal(sess.json.data.ended_at != null, true);

  // And the version row itself keeps the snapshot.
  const { client: c2, database: d2 } = await tdb();
  const doc = await d2.collection("submissions").findOne({ task_id: ctx.taskId, student_id: ctx.alice.id, version: 1 });
  await c2.close();
  assert.ok(IN_RANGE(doc.duration_seconds, 88, 96), "the duration must be persisted on the submission row");
  assert.ok(doc.task_started_at && doc.task_submitted_at);
});

test("5. a student can create exactly ONE first version — a second submit is 409 ALREADY_SUBMITTED", async () => {
  const dup = await api("POST", `/api/tasks/${ctx.taskId}/submit`, { token: ctx.alice.token, form: pdfForm("Alice duplicate") });
  assert.equal(dup.status, 409, JSON.stringify(dup.json));
  assert.equal(dup.json.error.code, "ALREADY_SUBMITTED");

  // The database-level guarantee is actually installed on the test database.
  const { client, database } = await tdb();
  const indexes = await database.collection("submissions").indexes();
  await client.close();
  const guard = indexes.find((i) => i.name === "submission_first_version_unique");
  assert.ok(guard, "the unique partial index enforcing one v1 must exist");
  assert.equal(guard.unique, true);
  assert.deepEqual(guard.partialFilterExpression, { version: 1 });
});

test("5b. only ONE active task session is possible — the unique partial index is installed", async () => {
  const { client, database } = await tdb();
  const indexes = await database.collection("task_sessions").indexes();
  await client.close();
  const guard = indexes.find((i) => i.name === "task_session_active_unique");
  assert.ok(guard, "the unique partial index enforcing one active session must exist");
  assert.equal(guard.unique, true);
  assert.deepEqual(guard.partialFilterExpression, { status: "active" });
});

/* ─── 3. CEO / manager timing column ─────────────────────────────────────── */
test("6. the CEO submissions list and detail expose the server timing", async () => {
  const list = await api("GET", `/api/tasks/submissions?task_id=${ctx.taskId}`, { token: adminToken });
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const row = list.json.submissions.find((s) => s.id === ctx.submissionId);
  assert.ok(row, "the submission must appear for the reviewer");
  assert.ok(row.task_started_at, "list must expose task_started_at");
  assert.ok(row.task_submitted_at, "list must expose task_submitted_at");
  assert.ok(IN_RANGE(row.duration_seconds, 88, 96), `list duration ~90s, got ${row.duration_seconds}`);

  const detail = await api("GET", `/api/tasks/submissions/${ctx.submissionId}`, { token: adminToken });
  assert.equal(detail.status, 200, JSON.stringify(detail.json));
  const d = detail.json.data?.submission || detail.json.data || detail.json;
  assert.ok(IN_RANGE(d.duration_seconds, 88, 96), `detail duration ~90s, got ${d.duration_seconds}`);
  assert.ok(d.task_started_at && d.task_submitted_at);
});

test("6b. a legacy submission without timing reads as null (\"Not recorded\"), never 0", async () => {
  // A task for Bob only, with a hand-inserted v1 row that predates this
  // feature (no timing fields at all).
  const task = await api("POST", "/api/tasks", {
    token: adminToken,
    body: { title: `${TAG} legacy`, domain: "edutins", assigned_to: ctx.bob.id, student_ids: [ctx.bob.id] },
  });
  assert.equal(task.status, 201, JSON.stringify(task.json));
  created.taskIds.push(task.json.taskId);

  const { client, database } = await tdb();
  const { ObjectId } = require("mongodb");
  const insert = await database.collection("submissions").insertOne({
    task_id: task.json.taskId,
    student_id: ctx.bob.id,
    version: 1,
    status: "submitted",
    submission_code: `${TAG}-LEGACY`,
    comment: "pre-existing row",
    submitted_at: new Date().toISOString(),
  });
  const legacyId = String(insert.insertedId);
  created.submissionIds.push(legacyId);
  await client.close();

  const list = await api("GET", `/api/tasks/submissions?task_id=${task.json.taskId}`, { token: adminToken });
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const row = list.json.submissions.find((s) => s.id === legacyId);
  assert.ok(row, "the legacy row must be returned");
  assert.equal(row.task_started_at, null, "no start time recorded -> null");
  assert.equal(row.duration_seconds, null, "no duration recorded -> null (renders 'Not recorded')");
  assert.ok(row.task_submitted_at, "task_submitted_at falls back to submitted_at");
});

/* ─── 8–10. Task edit notifications ──────────────────────────────────────── */
test("7. re-saving a task with no real change sends no notification and does not bump updated_at", async () => {
  const task = await api("POST", "/api/tasks", {
    token: adminToken,
    body: { title: `${TAG} edit`, description: "original", domain: "edutins", priority: "low", assigned_to: ctx.alice.id, student_ids: [ctx.alice.id], due_date: "2020-01-01" },
  });
  assert.equal(task.status, 201, JSON.stringify(task.json));
  ctx.editTaskId = task.json.taskId;
  created.taskIds.push(ctx.editTaskId);

  const before = await api("GET", `/api/tasks/${ctx.editTaskId}`, { token: adminToken });
  const current = before.json.task;
  const updatedAtBefore = current.updated_at;

  // Re-save with the SAME values the task already holds.
  const noop = await api("PUT", `/api/tasks/${ctx.editTaskId}`, {
    token: adminToken,
    body: { title: current.title, description: current.description || "", priority: current.priority || "low" },
  });
  assert.equal(noop.status, 200, JSON.stringify(noop.json));
  assert.equal(noop.json.changed, false);
  assert.deepEqual(noop.json.updated, []);

  const after = await api("GET", `/api/tasks/${ctx.editTaskId}`, { token: adminToken });
  assert.equal(after.json.task.updated_at, updatedAtBefore, "a no-op save must not bump updated_at");

  const aliceNotifs = await api("GET", "/api/notifications", { token: ctx.alice.token });
  const count = aliceNotifs.json.notifications.filter((n) => n.type === "task_updated" && n.task_id === ctx.editTaskId).length;
  assert.equal(count, 0, "a no-op save must not notify anyone");
});

test("8. a real edit notifies ONLY the assigned students, naming the real field diff", async () => {
  const edit = await api("PUT", `/api/tasks/${ctx.editTaskId}`, {
    token: adminToken,
    body: { due_date: "2026-10-20" },
  });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));
  assert.equal(edit.json.changed, true);
  assert.ok(edit.json.updated.includes("due_date"));

  const aliceNotifs = await api("GET", "/api/notifications", { token: ctx.alice.token });
  const mine = aliceNotifs.json.notifications.filter((n) => n.type === "task_updated" && n.task_id === ctx.editTaskId);
  assert.equal(mine.length, 1);
  const n = mine[0];
  assert.match(n.message, /Deadline changed from 1 Jan 2020 to 20 Oct 2026/,
    `the message must contain the real before/after values, got: ${n.message}`);
  assert.match(n.message, /was updated by an administrator/);
  assert.equal(n.task_id, ctx.editTaskId);
  assert.equal(n.deep_link, `/student/tasks/${ctx.editTaskId}`, "the deep link must open the task page");
  assert.equal(n.read, 0);

  // Bob is not assigned to this task, so he hears nothing.
  const bobNotifs = await api("GET", "/api/notifications", { token: ctx.bob.token });
  assert.equal(bobNotifs.json.notifications.filter((x) => x.type === "task_updated" && x.task_id === ctx.editTaskId).length, 0,
    "only assigned students may be notified");
});

test("9. re-applying the SAME change is de-duplicated by the change hash", async () => {
  const count = async () => {
    const res = await api("GET", "/api/notifications", { token: ctx.alice.token });
    return res.json.notifications.filter((n) => n.type === "task_updated" && n.task_id === ctx.editTaskId).length;
  };
  assert.equal(await count(), 1);

  // Change back (different change set -> a new, legitimate notification).
  const back = await api("PUT", `/api/tasks/${ctx.editTaskId}`, { token: adminToken, body: { due_date: "2020-01-01" } });
  assert.equal(back.json.changed, true);
  assert.equal(await count(), 2);

  // Apply the FIRST change again: same (field, old, new) -> same hash -> deduped.
  const again = await api("PUT", `/api/tasks/${ctx.editTaskId}`, { token: adminToken, body: { due_date: "2026-10-20" } });
  assert.equal(again.json.changed, true);
  assert.equal(await count(), 2, "an identical repeat change must not create a second notification");
});

/* ─── 11. Student navigation ─────────────────────────────────────────────── */
test("10. the student task page and its alias are registered client-side", () => {
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "App.jsx"), "utf8");
  assert.match(appSrc, /path="\/student\/tasks\/:taskId"/, "the canonical student task route must exist");
  assert.match(appSrc, /path="\/tasks\/:taskId"/, "the /tasks/:taskId alias must exist");
  assert.match(appSrc, /<TaskDetail\s*\/>/, "the canonical route must render TaskDetail");

  // Notifications point students at that page (server side).
  const notifSrc = fs.readFileSync(path.join(__dirname, "..", "utils", "notifications.js"), "utf8");
  assert.match(notifSrc, /\/student\/tasks\/\$\{taskId\}/, "student notifications must deep link to the task page");

  // And the notification bell follows it.
  const bellSrc = fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "components", "NotificationBell.jsx"), "utf8");
  assert.match(bellSrc, /student\/tasks/, "the notification bell must route students to the task page");
});

/* ─── 12. Starfield smoothing ────────────────────────────────────────────── */
test("11. the starfield keeps its stars but scrolls more slowly and smoothly", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "components", "space-field.js"), "utf8");

  // No stars were removed: the same count expression is intact.
  assert.match(src, /coarse \? 100 : 240/, "the star count must be unchanged");

  // A single gain now scales every scroll input down (30–50% slower).
  assert.match(src, /const SCROLL_GAIN = 0\.\d+;/, "a scroll-speed gain constant must exist");
  const gain = Number(src.match(/const SCROLL_GAIN = ([\d.]+);/)[1]);
  assert.ok(gain >= 0.5 && gain <= 0.7, `gain must slow the field by 30–50%, got ${gain}`);
  assert.match(src, /scrollPending \+= \(y - prev\) \* SCROLL_GAIN/);
  assert.match(src, /wheelPending \+= e\.deltaY \* 0\.6 \* SCROLL_GAIN/);
  assert.match(src, /wheelPending \+= \(touchY - y\) \* 0\.9 \* SCROLL_GAIN/);

  // Smoothness + safety nets stay in place.
  assert.match(src, /v \+= \(target - v\) \*/, "the velocity lerp must remain");
  assert.match(src, /passive: true/, "scroll listeners must stay passive");
  assert.match(src, /prefers-reduced-motion: reduce/, "reduced-motion must still be honoured");
  assert.match(src, /visibilitychange/, "the field must still pause on hidden tabs");
  assert.match(src, /cancelAnimationFrame\(raf\)/, "the animation frame must still be cancellable");
});
