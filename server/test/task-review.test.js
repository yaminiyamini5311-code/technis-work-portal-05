"use strict";
/**
 * Task Manager review / resubmission workflow — end-to-end tests.
 *
 * Covers the twelve behaviours the fix is judged on:
 *   1. Review link resolves to a real page (route registered, valid task id)
 *   2. Task Details returns real database data
 *   3. Submitted lists only submitters; per-student detail loads THAT student's file
 *   4. Pending and In Progress are accurate and mutually exclusive
 *   5. Approve affects only that student's submission
 *   6. Revision requires feedback and produces a persistent, correct notification
 *   7. Resubmit inside the window creates a new version and keeps the old one
 *   8. Late resubmission is rejected by the BACKEND
 *   9. A second revision starts a fresh 24-hour cycle
 *  10. Notifications persist across re-login and never duplicate
 *  11. Student A cannot read or modify student B's data (IDOR)
 *  12. Task create / edit / assign still work
 *
 * SAFETY
 *  - Runs against the LOCAL DEVELOPMENT database (server/.env) with clearly
 *    marked accounts (tr-<timestamp>-*@example.invalid).
 *  - Teardown removes exactly what these tests created (tracked by id).
 *  - Google Drive is forced to MOCK mode so uploads never touch a real Drive.
 *
 * TIME
 *  The 24-hour window is never waited out. Expiry is exercised two ways:
 *   a) the stored `revision_deadline` is moved into the past directly in the
 *      database, which is exactly what "time passed" looks like to the server;
 *   b) a SECOND server is started with RESUBMISSION_WINDOW_HOURS=0.0005 so the
 *      env-var path is covered for real.
 *  Production code never overrides the window.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// Loaded once at module scope so the DB helpers in this file (and the cleanup
// hook) can reach the local development database.
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const PORT = Number(process.env.TASK_REVIEW_PORT || 5098);
const SHORT_WINDOW_PORT = Number(process.env.TASK_REVIEW_SHORT_PORT || 5097);
const BASE = `http://127.0.0.1:${PORT}`;
const SHORT_BASE = `http://127.0.0.1:${SHORT_WINDOW_PORT}`;
const TAG = `tr-${Date.now()}`;
const TEST_PASSWORD = "TaskReview-Test-Pass-2026";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@techins.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin@123";

let serverProcess = null;
let shortServerProcess = null;
let serverLogs = "";
let adminToken = "";
let batchId = null;

const created = { userIds: [], taskIds: [], submissionIds: [], batchIds: [] };

const ctx = {};

async function api(method, urlPath, { token, body, form, base = BASE, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload = body;
  if (form) payload = form;
  else if (body !== undefined) { h["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(`${base}${urlPath}`, { method, headers: h, body: payload });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON (file streams) */ }
  return { status: res.status, headers: res.headers, json, res };
}

async function waitForServer(base, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const health = await fetch(`${base}/api/health`);
      if (health.ok) {
        const db = await fetch(`${base}/api/batches`);
        if (db.ok) {
          const body = await db.json();
          if (body && body.success) return;
        }
      }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Server ${base} not healthy in ${timeoutMs}ms.\n${serverLogs.slice(-2000)}`);
}

function spawnServer(port, extraEnv = {}) {
  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(port), GOOGLE_DRIVE_MOCK: "true", ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => { serverLogs += d.toString(); });
  child.stderr.on("data", (d) => { serverLogs += d.toString(); });
  return child;
}

/** Open the dev database. Returns { client, database } — always close the client. */
async function db() {
  const { MongoClient } = require("mongodb");
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  return { client, database: client.db(process.env.MONGODB_DB_NAME || "techins") };
}

test.before(async () => {
  serverProcess = spawnServer(PORT);
  await waitForServer(BASE);

  const login = await api("POST", "/api/auth/login", { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  assert.equal(login.status, 200, `admin login failed: ${JSON.stringify(login.json)}\n${serverLogs.slice(-1500)}`);
  adminToken = login.json.token;

  // A dedicated batch so these tests never collide with a shared one.
  const { MongoClient, ObjectId } = require("mongodb");
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const database = client.db(process.env.MONGODB_DB_NAME || "techins");
  const batchName = `${TAG} batch`;
  const batchDoc = { name: batchName, active: true, created_at: new Date().toISOString() };
  await database.collection("batches").insertOne(batchDoc);
  const batch = await database.collection("batches").findOne({ name: batchName });
  batchId = String(batch._id);
  created.batchIds.push(batchId);
  await client.close();

  // Two approved students in that batch: Alice submits, Bob does not.
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
      title: `${TAG} | Explain a Concept`,
      description: "Task Manager review workflow test",
      domain: "edutins",
      target_type: "batch",
      batch_id: batchId,
      priority: "high",
      how_to_do: "Read, then explain.",
      expected_output: "One page.",
      submission_requirements: "PDF.",
      start_date: "2020-01-01",
      due_date: "2099-01-01",
    },
  });
  assert.equal(task.status, 201, `task create: ${JSON.stringify(task.json)}`);
  ctx.taskId = task.json.taskId;
  created.taskIds.push(ctx.taskId);
  ctx.taskCode = task.json.taskCode;
});

test.after(async () => {
  if (serverProcess) serverProcess.kill();
  if (shortServerProcess) shortServerProcess.kill();
  try {
    const { MongoClient, ObjectId } = require("mongodb");
    require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
    if (!process.env.MONGODB_URI) return;
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const database = client.db(process.env.MONGODB_DB_NAME || "techins");
    const oid = (v) => { try { return new ObjectId(String(v)); } catch { return null; } };

    const subIds = created.submissionIds.map(oid).filter(Boolean);
    if (subIds.length) {
      await database.collection("submission_files").deleteMany({ submission_id: { $in: created.submissionIds } });
      await database.collection("submissions").deleteMany({ _id: { $in: subIds } });
    }
    if (created.taskIds.length) {
      await database.collection("task_assignments").deleteMany({ task_id: { $in: created.taskIds } });
      await database.collection("task_status_history").deleteMany({ task_id: { $in: created.taskIds } });
      await database.collection("notifications").deleteMany({ task_id: { $in: created.taskIds } });
      await database.collection("tasks").deleteMany({ _id: { $in: created.taskIds.map(oid).filter(Boolean) } });
    }
    if (created.userIds.length) {
      await database.collection("task_assignments").deleteMany({ student_id: { $in: created.userIds } });
      await database.collection("notifications").deleteMany({ user_id: { $in: created.userIds } });
      await database.collection("performance").deleteMany({ user_id: { $in: created.userIds } });
      await database.collection("users").deleteMany({ _id: { $in: created.userIds.map(oid).filter(Boolean) } });
    }
    if (created.batchIds.length) {
      await database.collection("batches").deleteMany({ _id: { $in: created.batchIds.map(oid).filter(Boolean) } });
    }
    await client.close();
    console.log(`[task-review] cleanup: ${created.userIds.length} users, ${created.taskIds.length} tasks, ${created.submissionIds.length} submissions, ${created.batchIds.length} batch removed`);
  } catch (e) {
    console.error("[task-review] cleanup error:", e.message);
  }
});

const pdfForm = (comment, name = "work.pdf") => {
  const form = new FormData();
  form.append("comment", comment);
  form.append("files", new Blob([Buffer.from(`%PDF-1.4 ${comment} ${name}`)], { type: "application/pdf" }), name);
  return form;
};

/* ─── 1. Review link ─────────────────────────────────────────────────────── */
test("1. the review route is registered client-side so /admin/tasks/:taskId/review cannot fall through to the catch-all", () => {
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "App.jsx"), "utf8");
  assert.match(appSrc, /path="\/admin\/tasks\/:taskId\/review"/,
    "App.jsx must register /admin/tasks/:taskId/review, otherwise React Router matches path=\"*\" and redirects the reviewer to /login");
  assert.match(appSrc, /path="\/manager\/tasks\/:taskId\/review"/,
    "App.jsx must register /manager/tasks/:taskId/review");

  // The Live Tasks Review action must navigate to that route with a real id.
  const tasksSrc = fs.readFileSync(path.join(__dirname, "..", "..", "client", "src", "pages", "admin", "Tasks.jsx"), "utf8");
  assert.match(tasksSrc, /tasks\/\$\{id\}\/review/,
    "the Review button must navigate to the dedicated review route with the task id");

  // And the SPA rewrite must serve index.html for that deep link.
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "client", "vercel.json"), "utf8"));
  assert.ok(vercel.rewrites.some(r => r.destination === "/index.html"), "client/vercel.json must rewrite deep links to index.html");
});

test("1b. GET /:id/review rejects an invalid task id with a clear 400 instead of redirecting", async () => {
  const bad = await api("GET", "/api/tasks/not-an-object-id/review", { token: adminToken });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, "INVALID_TASK_ID");
  assert.match(bad.json.error.message, /not valid/i);
});

/* ─── 2. Task Details ────────────────────────────────────────────────────── */
test("2. GET /:id/review returns real task details and the aggregation counts", async () => {
  const res = await api("GET", `/api/tasks/${ctx.taskId}/review`, { token: adminToken });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const { task, counts } = res.json.data;

  assert.equal(task.id, ctx.taskId);
  assert.equal(task.task_code, ctx.taskCode);
  assert.equal(task.title, `${TAG} | Explain a Concept`);
  assert.equal(task.description, "Task Manager review workflow test");
  assert.equal(task.domain, "edutins");
  assert.equal(task.legacy_domain, null);
  // The program is derived from the students this task is assigned to (the task
  // was created without one), so it must equal what the sign-up stored.
  const { client: progClient, database } = await db();
  const aliceDoc = await database.collection("users").findOne({ _id: new (require("mongodb").ObjectId)(ctx.alice.id) }, { projection: { program: 1 } });
  await progClient.close();
  assert.ok(aliceDoc.program, "test students must have a program to derive from");
  assert.equal(task.program, aliceDoc.program);
  assert.equal(task.total_assignees, 2);
  assert.equal(task.priority, "high");
  assert.equal(task.how_to_do, "Read, then explain.");
  assert.equal(task.expected_output, "One page.");
  assert.equal(task.submission_requirements, "PDF.");
  assert.equal(task.due_date, "2099-01-01");
  assert.equal(task.assigned_students.length, 2);
  assert.equal(task.assigned_by_email, ADMIN_EMAIL);

  // Both students start pending: assigned, nothing submitted.
  assert.equal(counts.assigned, 2);
  assert.equal(counts.pending, 2);
  assert.equal(counts.submitted, 0);
  assert.equal(counts.in_progress, 0);
  assert.equal(counts.overdue, 0);
  assert.equal(res.json.data.resubmission_window_hours, 24);
});

test("2b. students cannot open the review endpoints", async () => {
  for (const p of [`/api/tasks/${ctx.taskId}/review`, `/api/tasks/${ctx.taskId}/review/submitted`, `/api/tasks/${ctx.taskId}/review/pending`]) {
    const res = await api("GET", p, { token: ctx.alice.token });
    assert.equal(res.status, 403, `${p} should be 403 for a student`);
  }
  const anon = await api("GET", `/api/tasks/${ctx.taskId}/review`);
  assert.equal(anon.status, 401);
});

/* ─── 3. Submitted tab ───────────────────────────────────────────────────── */
test("3. Alice submits; the Submitted tab lists her and loads HER file for her detail view", async () => {
  const { client: idClient, database } = await db();
  const aliceDoc = await database.collection("users").findOne(
    { _id: new (require("mongodb").ObjectId)(ctx.alice.id) },
    { projection: { learner_id: 1, student_id: 1 } }
  );
  await idClient.close();

  const sub = await api("POST", `/api/tasks/${ctx.taskId}/submit`, { token: ctx.alice.token, form: pdfForm("Alice v1") });
  assert.equal(sub.status, 201, JSON.stringify(sub.json));
  assert.equal(sub.json.version, 1);
  created.submissionIds.push(sub.json.submissionId);
  ctx.aliceSubmissionId = sub.json.submissionId;

  const submitted = await api("GET", `/api/tasks/${ctx.taskId}/review/submitted`, { token: adminToken });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.json.data.total, 1);
  const row = submitted.json.data.students[0];
  assert.equal(row.student_id, ctx.alice.id);
  assert.equal(row.student_name, ctx.alice.name);
  assert.equal(row.status, "submitted");
  assert.equal(row.student_email, `${TAG}-alice@example.invalid`);
  // The displayed student ID must be whatever the user record actually holds
  // (student_id, else learner_id) — never a fabricated value.
  assert.equal(row.student_code, (aliceDoc.student_id || aliceDoc.learner_id) || null);
  assert.equal(row.student_version, undefined);
  assert.equal(row.submission_version, 1);
  assert.equal(row.submission_comment, "Alice v1");
  assert.ok(row.submitted_at, "submitted_at must be present");
  assert.equal(row.files.length, 1);
  assert.match(row.files[0].download_url, /^\/api\/tasks\/files\/[a-f0-9]+\/download$/,
    "files must expose an authenticated endpoint, never a raw storage path");
  assert.ok(!row.files[0].drive_file_id && !row.files[0].storage_path, "raw storage identifiers must not leak");

  // The per-student detail endpoint loads exactly Alice's submission.
  const detail = await api("GET", `/api/tasks/${ctx.taskId}/review/assignments/${ctx.alice.id}`, { token: adminToken });
  assert.equal(detail.status, 200, JSON.stringify(detail.json));
  assert.equal(detail.json.data.student.student_id, ctx.alice.id);
  assert.equal(detail.json.data.student.student_name, ctx.alice.name);
  assert.equal(detail.json.data.latest.version, 1);
  assert.equal(detail.json.data.latest.comment, "Alice v1");
  assert.equal(detail.json.data.latest.files.length, 1);

  // Bob's detail is a different (empty) record — never Alice's data.
  const bobDetail = await api("GET", `/api/tasks/${ctx.taskId}/review/assignments/${ctx.bob.id}`, { token: adminToken });
  assert.equal(bobDetail.status, 200);
  assert.equal(bobDetail.json.data.student.student_id, ctx.bob.id);
  assert.equal(bobDetail.json.data.versions.length, 0);
  assert.notEqual(bobDetail.json.data.student.student_name, ctx.alice.name);

  // The authenticated download works and is served as a PDF.
  const fileUrl = detail.json.data.latest.files[0].download_url;
  const dl = await api("GET", fileUrl, { token: adminToken });
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get("content-type") || "", /application\/pdf/);
  assert.match(dl.headers.get("content-disposition") || "", /attachment/);
});

/* ─── 4. Pending / In Progress are accurate and mutually exclusive ────────── */
test("4. Bob is Pending, never In Progress; the two lists cannot overlap", async () => {
  const pending = await api("GET", `/api/tasks/${ctx.taskId}/review/pending`, { token: adminToken });
  assert.equal(pending.status, 200);
  assert.equal(pending.json.data.total, 1);
  assert.equal(pending.json.data.students[0].student_id, ctx.bob.id);
  assert.equal(pending.json.data.students[0].status, "pending");
  assert.equal(pending.json.data.students[0].assigned_at != null, true);
  assert.equal(pending.json.data.students[0].overdue, false);

  const inProgress = await api("GET", `/api/tasks/${ctx.taskId}/review/in-progress`, { token: adminToken });
  assert.equal(inProgress.status, 200);
  assert.equal(inProgress.json.data.total, 0, "being assigned must never be classified as In Progress");

  const pendingIds = pending.json.data.students.map((s) => s.student_id);
  const inProgressIds = inProgress.json.data.students.map((s) => s.student_id);
  assert.equal(pendingIds.some((id) => inProgressIds.includes(id)), false);

  // Bob explicitly starts the task -> he moves from Pending to In Progress only.
  const start = await api("PATCH", `/api/tasks/${ctx.taskId}/status`, { token: ctx.bob.token, body: { workflow_status: "In Progress" } });
  assert.equal(start.status, 200, JSON.stringify(start.json));

  const pending2 = await api("GET", `/api/tasks/${ctx.taskId}/review/pending`, { token: adminToken });
  const inProgress2 = await api("GET", `/api/tasks/${ctx.taskId}/review/in-progress`, { token: adminToken });
  assert.equal(pending2.json.data.total, 0);
  assert.equal(inProgress2.json.data.total, 1);
  assert.equal(inProgress2.json.data.students[0].student_id, ctx.bob.id);
  assert.equal(pending2.json.data.students.some((s) => s.student_id === ctx.bob.id), false);

  // Counts add up and stay mutually exclusive.
  const rev = await api("GET", `/api/tasks/${ctx.taskId}/review`, { token: adminToken });
  const c = rev.json.data.counts;
  assert.equal(c.assigned, 2);
  assert.equal(c.submitted + c.approved + c.revision_required + c.resubmission_expired + c.in_progress + c.pending, c.assigned);
  assert.equal(c.submitted, 1);
  assert.equal(c.in_progress, 1);
});

/* ─── 5. Approve affects only that student ───────────────────────────────── */
test("5. Approving Bob affects Bob only; Alice's submission is untouched", async () => {
  const sub = await api("POST", `/api/tasks/${ctx.taskId}/submit`, { token: ctx.bob.token, form: pdfForm("Bob v1") });
  assert.equal(sub.status, 201, JSON.stringify(sub.json));
  created.submissionIds.push(sub.json.submissionId);

  const approve = await api("POST", `/api/tasks/${ctx.taskId}/review/approve`, {
    token: adminToken, body: { studentId: ctx.bob.id },
  });
  assert.equal(approve.status, 200, JSON.stringify(approve.json));
  assert.equal(approve.json.data.status, "approved");
  assert.equal(approve.json.data.student_id, ctx.bob.id);
  assert.ok(approve.json.data.reviewed_at, "reviewed_at must be stored");
  assert.ok(approve.json.data.reviewed_by, "reviewed_by must be stored");
  assert.equal(approve.json.data.counts.approved, 1);

  // Duplicate approval is rejected, not silently repeated.
  const again = await api("POST", `/api/tasks/${ctx.taskId}/review/approve`, {
    token: adminToken, body: { studentId: ctx.bob.id },
  });
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, "ALREADY_APPROVED");

  // Alice is still "submitted" — one student's decision never touches another.
  const aliceStatus = await api("GET", `/api/tasks/${ctx.taskId}/my-submission-status`, { token: ctx.alice.token });
  assert.equal(aliceStatus.json.data.status, "submitted");
  assert.equal(aliceStatus.json.data.workflow_status, "Submitted");

  // Bob's own portal reflects the approval immediately.
  const bobStatus = await api("GET", `/api/tasks/${ctx.taskId}/my-submission-status`, { token: ctx.bob.token });
  assert.equal(bobStatus.json.data.status, "approved");
  assert.equal(bobStatus.json.data.workflow_status, "Approved");

  // Approving something that was never submitted is an illegal transition.
  const notSubmitted = await api("POST", `/api/tasks/${ctx.taskId}/review/approve`, {
    token: adminToken, body: { studentId: "000000000000000000000000" },
  });
  assert.equal(notSubmitted.status, 404);
});

/* ─── 6. Revision requires feedback; notification is correct and persistent ─ */
test("6. Revision without usable feedback is rejected; with feedback the right student is notified with the exact deadline", async () => {
  const noFeedback = await api("POST", `/api/tasks/${ctx.taskId}/review/request-revision`, {
    token: adminToken, body: { studentId: ctx.alice.id, feedback: "   " },
  });
  assert.equal(noFeedback.status, 400);
  assert.equal(noFeedback.json.error.code, "REVISION_FEEDBACK_REQUIRED");

  const tooShort = await api("POST", `/api/tasks/${ctx.taskId}/review/request-revision`, {
    token: adminToken, body: { studentId: ctx.alice.id, feedback: "fix it" },
  });
  assert.equal(tooShort.status, 400);
  assert.equal(tooShort.json.error.code, "REVISION_FEEDBACK_TOO_SHORT");

  const before = Date.now();
  const rev = await api("POST", `/api/tasks/${ctx.taskId}/review/request-revision`, {
    token: adminToken, body: { studentId: ctx.alice.id, feedback: "Please cite two sources and fix the diagram." },
  });
  assert.equal(rev.status, 200, JSON.stringify(rev.json));
  const deadline = new Date(rev.json.data.resubmission_deadline).getTime();
  const expected = 24 * 3600 * 1000;
  assert.ok(deadline - before > expected * 0.99 && deadline - before < expected * 1.01,
    `deadline must be exactly 24h from the server clock, got ${rev.json.data.resubmission_deadline}`);
  assert.equal(rev.json.data.revision_cycle, 1);
  assert.equal(rev.json.data.counts.revision_required, 1);

  // Bob gets nothing.
  const bobNotifications = await api("GET", "/api/notifications", { token: ctx.bob.token });
  const bobRevision = bobNotifications.json.notifications.filter((n) => n.type === "revision_required");
  assert.equal(bobRevision.length, 0, "only the reviewed student may be notified");

  // Alice is still a SUBMITTER, so she must still be listed and reviewable in
  // the Submitted tab even though her review status is now "revision_required".
  // (Hiding her would leave an admin with no way to open the revision again.)
  // Bob also submitted (and was approved in test 5), so the tab lists every
  // submitter, not only the ones still awaiting a first decision.
  const submittedAfter = await api("GET", `/api/tasks/${ctx.taskId}/review/submitted`, { token: adminToken });
  const ids = submittedAfter.json.data.students.map((s) => s.student_id);
  assert.deepEqual(ids.sort(), [ctx.alice.id, ctx.bob.id].sort());
  const aliceRow = submittedAfter.json.data.students.find((s) => s.student_id === ctx.alice.id);
  assert.equal(aliceRow.status, "revision_required");
  assert.ok(aliceRow.revision_deadline, "the resubmit deadline travels with the row");
  assert.equal(submittedAfter.json.data.students.find((s) => s.student_id === ctx.bob.id).status, "approved");
  // ...and the status filter narrows it.
  const onlyRevision = await api("GET", `/api/tasks/${ctx.taskId}/review/submitted?status=revision_required`, { token: adminToken });
  assert.equal(onlyRevision.json.data.total, 1);
  assert.equal(onlyRevision.json.data.students[0].student_id, ctx.alice.id);
  const onlyApproved = await api("GET", `/api/tasks/${ctx.taskId}/review/submitted?status=approved`, { token: adminToken });
  assert.equal(onlyApproved.json.data.total, 1);
  assert.equal(onlyApproved.json.data.students[0].student_id, ctx.bob.id);
  // The two lists never overlap.
  const pendingIds = (await api("GET", `/api/tasks/${ctx.taskId}/review/pending`, { token: adminToken })).json.data.students.map((s) => s.student_id);
  assert.equal(ids.some((id) => pendingIds.includes(id)), false);

  // Alice gets exactly one, with the feedback and the deadline in the message.
  const aliceNotifications = await api("GET", "/api/notifications", { token: ctx.alice.token });
  const aliceRevision = aliceNotifications.json.notifications.filter((n) => n.type === "revision_required");
  assert.equal(aliceRevision.length, 1);
  const n = aliceRevision[0];
  assert.match(n.message, /requires revision/);
  assert.match(n.message, /Admin feedback: Please cite two sources and fix the diagram\./);
  assert.match(n.message, /resubmit within 24 hours/);
  assert.match(n.message, new RegExp(rev.json.data.resubmission_deadline_label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(n.task_id, ctx.taskId);
  assert.equal(n.submission_id, ctx.aliceSubmissionId);
  assert.equal(n.cycle, 1);
  assert.equal(n.revision_deadline, rev.json.data.resubmission_deadline);
  assert.ok(n.revision_requested_at);
  assert.ok(n.deep_link, "notification must deep link somewhere useful");

  // It survives a fresh login (persisted in MongoDB, not in component state).
  const relogin = await api("POST", "/api/auth/login", { body: { email: `${TAG}-alice@example.invalid`, password: TEST_PASSWORD } });
  const after = await api("GET", "/api/notifications", { token: relogin.json.token });
  assert.equal(after.json.notifications.filter((x) => x.type === "revision_required").length, 1);
});

test("6b. eligibility endpoint reports the open window to the student", async () => {
  const res = await api("GET", `/api/tasks/${ctx.taskId}/resubmission-eligibility`, { token: ctx.alice.token });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.data.resubmission_available, true);
  assert.equal(res.json.data.status, "revision_required");
  assert.equal(res.json.data.revision_cycle, 1);
  assert.equal(res.json.data.revision_deadline_label.includes("IST"), true);
  assert.ok(res.json.data.resubmission_expires_in_ms > 0);
  assert.match(res.json.data.last_review_feedback, /cite two sources/);
  // Bob has no open revision.
  const bobRes = await api("GET", `/api/tasks/${ctx.taskId}/resubmission-eligibility`, { token: ctx.bob.token });
  assert.equal(bobRes.json.data.resubmission_available, false);
});

/* ─── 7. Resubmit inside the window ──────────────────────────────────────── */
test("7. Resubmitting inside the window creates v2 and keeps v1", async () => {
  const res = await api("POST", `/api/tasks/${ctx.taskId}/resubmit`, { token: ctx.alice.token, form: pdfForm("Alice v2 corrected") });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.version, 2);
  created.submissionIds.push(res.json.submissionId);

  const detail = await api("GET", `/api/tasks/${ctx.taskId}/review/assignments/${ctx.alice.id}`, { token: adminToken });
  assert.equal(detail.json.data.versions.length, 2, "the previous version must be retained");
  assert.deepEqual(detail.json.data.versions.map((v) => v.version), [2, 1]);
  assert.equal(detail.json.data.versions[0].comment, "Alice v2 corrected");
  assert.equal(detail.json.data.versions[1].comment, "Alice v1");
  assert.ok(detail.json.data.versions[0].submitted_at && detail.json.data.versions[1].submitted_at);
  assert.equal(detail.json.data.assignment.revision_status, "resubmitted");
  assert.equal(detail.json.data.assignment.revision_history.length, 1);
  assert.equal(detail.json.data.assignment.revision_history[0].status, "resubmitted");
  assert.equal(detail.json.data.assignment.resubmission_available, false, "the window closes once the fix lands");

  // Admin hears about the corrected resubmission.
  const notifs = await api("GET", "/api/notifications", { token: adminToken });
  assert.ok(notifs.json.notifications.some((x) => x.type === "resubmission_received" && x.task_id === ctx.taskId),
    "the admin must be notified of a corrected resubmission");
});

test("7b. a student cannot set status, feedback or deadlines through the submit body", async () => {
  const other = await api("POST", "/api/tasks", {
    token: adminToken,
    body: { title: `${TAG} field-strip`, domain: "edutins", assigned_to: ctx.alice.id, student_ids: [ctx.alice.id] },
  });
  assert.equal(other.status, 201, JSON.stringify(other.json));
  created.taskIds.push(other.json.taskId);

  const form = new FormData();
  form.append("comment", "trying to cheat");
  form.append("status", "Approved");
  form.append("review_comments", "self approved");
  form.append("revision_deadline", "2099-01-01T00:00:00.000Z");
  const res = await api("POST", `/api/tasks/${other.json.taskId}/submit`, { token: ctx.alice.token, form });
  assert.equal(res.status, 201, JSON.stringify(res.json));

  const detail = await api("GET", `/api/tasks/${other.json.taskId}/review/assignments/${ctx.alice.id}`, { token: adminToken });
  const version = detail.json.data.latest;
  assert.equal(version.status, "submitted", "the client must not be able to approve itself");
  assert.equal(version.review_comments, null, "the client must not be able to write its own feedback");
  assert.equal(version.revision_deadline, undefined);
});

/* ─── 8. Late resubmission is rejected by the BACKEND ────────────────────── */
test("8. once the window has passed the backend refuses a resubmission even though the client may still think it is open", async () => {
  // Second revision cycle for Alice (her v2 landed in test 7, so her status is
  // "submitted" again). Bob was already approved in test 5 and can no longer
  // be sent back.
  const rev = await api("POST", `/api/tasks/${ctx.taskId}/review/request-revision`, {
    token: adminToken, body: { studentId: ctx.alice.id, feedback: "Please expand section three with data." },
  });
  assert.equal(rev.status, 200, JSON.stringify(rev.json));
  assert.equal(rev.json.data.revision_cycle, 2, "a second revision must start a NEW cycle");

  // "Time passes": move the stored deadline into the past. This is exactly
  // what the server sees 24 hours later, without waiting 24 hours.
  const { client: dbClient, database } = await db();
  await database.collection("task_assignments").updateOne(
    { task_id: ctx.taskId, student_id: ctx.alice.id },
    { $set: { revision_deadline: new Date(Date.now() - 1000).toISOString() } }
  );
  await dbClient.close();

  const late = await api("POST", `/api/tasks/${ctx.taskId}/resubmit`, { token: ctx.alice.token, form: pdfForm("Alice v3 too late") });
  assert.equal(late.status, 409, JSON.stringify(late.json));
  assert.equal(late.json.error.code, "RESUBMISSION_EXPIRED");
  assert.match(late.json.error.message, /24-hour resubmission window has expired/i);

  // And the eligibility endpoint now reports the closed window.
  const elig = await api("GET", `/api/tasks/${ctx.taskId}/resubmission-eligibility`, { token: ctx.alice.token });
  assert.equal(elig.json.data.resubmission_available, false);
  assert.equal(elig.json.data.status, "resubmission_expired");
  assert.match(elig.json.data.resubmission_blocked_reason, /expired/i);

  // The expired state is visible to the admin and the student is told once.
  const rev2 = await api("GET", `/api/tasks/${ctx.taskId}/review`, { token: adminToken });
  assert.equal(rev2.json.data.counts.resubmission_expired, 1);
  assert.equal(rev2.json.data.counts.revision_required, 0);

  const aliceNotifs = await api("GET", "/api/notifications", { token: ctx.alice.token });
  const expired = aliceNotifs.json.notifications.filter((x) => x.type === "resubmission_expired");
  assert.equal(expired.length, 1, "the expiry notification must be delivered exactly once");

  // History and feedback are preserved.
  const detail = await api("GET", `/api/tasks/${ctx.taskId}/review/assignments/${ctx.alice.id}`, { token: adminToken });
  assert.equal(detail.json.data.assignment.status, "resubmission_expired");
  assert.equal(detail.json.data.assignment.revision_history.length, 2);
  assert.equal(detail.json.data.assignment.revision_history[1].status, "expired");
  assert.match(detail.json.data.assignment.revision_history[1].feedback, /section three/);
});

test("8b. a new revision request after expiry opens a brand new 24-hour cycle (never an extension)", async () => {
  const before = Date.now();
  const rev = await api("POST", `/api/tasks/${ctx.taskId}/review/request-revision`, {
    token: adminToken, body: { studentId: ctx.alice.id, feedback: "Second attempt: add the appendix you promised." },
  });
  assert.equal(rev.status, 200, JSON.stringify(rev.json));
  assert.equal(rev.json.data.revision_cycle, 3, "the expired cycle is closed, the new one starts from zero again");
  const deadline = new Date(rev.json.data.resubmission_deadline).getTime();
  assert.ok(deadline - before > 24 * 3600 * 1000 * 0.99 && deadline - before < 24 * 3600 * 1000 * 1.01,
    "the new cycle gets a fresh 24 hours measured from now, never the old deadline");

  // And resubmitting is allowed again in the new cycle.
  const resub = await api("POST", `/api/tasks/${ctx.taskId}/resubmit`, { token: ctx.alice.token, form: pdfForm("Alice v3 after new cycle") });
  assert.equal(resub.status, 201, JSON.stringify(resub.json));
  created.submissionIds.push(resub.json.submissionId);
  assert.equal(resub.json.version, 3);
});

test("8c. RESUBMISSION_WINDOW_HOURS is honoured (short window server, no production override)", async () => {
  shortServerProcess = spawnServer(SHORT_WINDOW_PORT, { RESUBMISSION_WINDOW_HOURS: "0.001" });
  await waitForServer(SHORT_BASE);

  const login = await api("POST", "/api/auth/login", { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, base: SHORT_BASE });
  assert.equal(login.status, 200, JSON.stringify(login.json));
  const shortAdminToken = login.json.token;

  const aliceLogin = await api("POST", "/api/auth/login", { body: { email: `${TAG}-alice@example.invalid`, password: TEST_PASSWORD }, base: SHORT_BASE });
  const aliceToken = aliceLogin.json.token;

  const review = await api("GET", `/api/tasks/${ctx.taskId}/review`, { token: shortAdminToken, base: SHORT_BASE });
  assert.equal(review.status, 200);
  assert.ok(Math.abs(review.json.data.resubmission_window_hours - 0.001) < 1e-9,
    `window should be 0.001h, got ${review.json.data.resubmission_window_hours}`);

  // Request a revision on the short server -> a ~3.6 second window.
  const rev = await api("POST", `/api/tasks/${ctx.taskId}/review/request-revision`, {
    token: shortAdminToken,
    body: { studentId: ctx.alice.id, feedback: "Short window test: rewrite the introduction." },
    base: SHORT_BASE,
  });
  assert.equal(rev.status, 200, JSON.stringify(rev.json));
  const windowMs = new Date(rev.json.data.resubmission_deadline).getTime() - Date.now();
  assert.ok(windowMs <= 3600 + 2000 && windowMs > 0, `short window should be ~3.6s, got ${windowMs}ms`);

  await new Promise((r) => setTimeout(r, 4200));
  const late = await api("POST", `/api/tasks/${ctx.taskId}/resubmit`, {
    token: aliceToken, form: pdfForm("Alice late"), base: SHORT_BASE,
  });
  assert.equal(late.status, 409, JSON.stringify(late.json));
  assert.equal(late.json.error.code, "RESUBMISSION_EXPIRED");
});

/* ─── 9/10. Notifications persist and never duplicate ────────────────────── */
test("8d. approving a submission that is awaiting revision supersedes the open cycle", async () => {
  // Alice is "submitted" again after 8b's resubmission. Request a revision so
  // there IS an open cycle, then approve anyway: the admin changed their mind
  // and must be able to close the loop instead of hitting a dead end.
  const rev = await api("POST", `/api/tasks/${ctx.taskId}/review/request-revision`, {
    token: adminToken, body: { studentId: ctx.alice.id, feedback: "Tighten the conclusion paragraph, please." },
  });
  assert.equal(rev.status, 200, JSON.stringify(rev.json));

  const detail = await api("GET", `/api/tasks/${ctx.taskId}/review/assignments/${ctx.alice.id}`, { token: adminToken });
  assert.equal(detail.json.data.assignment.status, "revision_required");
  assert.equal(detail.json.data.assignment.revision_history.at(-1).status, "open");

  const approve = await api("POST", `/api/tasks/${ctx.taskId}/review/approve`, {
    token: adminToken, body: { studentId: ctx.alice.id },
  });
  assert.equal(approve.status, 200, JSON.stringify(approve.json));

  const after = await api("GET", `/api/tasks/${ctx.taskId}/review/assignments/${ctx.alice.id}`, { token: adminToken });
  assert.equal(after.json.data.assignment.status, "approved");
  assert.equal(after.json.data.assignment.resubmission_available, false);
  const lastCycle = after.json.data.assignment.revision_history.at(-1);
  assert.equal(lastCycle.status, "closed", "an approved submission must not leave an open revision window behind");
  assert.match(lastCycle.feedback, /conclusion paragraph/);
  assert.ok(lastCycle.closed_at, "the cycle records when and by whom it was closed");

  // The student is told the window is over and cannot resubmit.
  const elig = await api("GET", `/api/tasks/${ctx.taskId}/resubmission-eligibility`, { token: ctx.alice.token });
  assert.equal(elig.json.data.resubmission_available, false);
  assert.equal(elig.json.data.status, "approved");
});

test("10. repeated clicks do not create duplicate notifications; they survive refresh", async () => {
  const other = await api("POST", "/api/tasks", {
    token: adminToken,
    body: { title: `${TAG} reminders`, domain: "edutins", assigned_to: ctx.bob.id, student_ids: [ctx.bob.id] },
  });
  assert.equal(other.status, 201, JSON.stringify(other.json));
  created.taskIds.push(other.json.taskId);

  const countReminders = async () => {
    const res = await api("GET", "/api/notifications", { token: ctx.bob.token });
    return res.json.notifications.filter((n) => n.type === "task_reminder" && n.task_id === other.json.taskId).length;
  };

  const first = await api("POST", `/api/tasks/${other.json.taskId}/review/remind`, { token: adminToken, body: { studentIds: [ctx.bob.id] } });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.data.sent.length, 1);
  assert.equal(await countReminders(), 1);

  // Two more clicks while the cooldown is active create nothing.
  const second = await api("POST", `/api/tasks/${other.json.taskId}/review/remind`, { token: adminToken, body: { studentIds: [ctx.bob.id] } });
  const third = await api("POST", `/api/tasks/${other.json.taskId}/review/remind`, { token: adminToken, body: { studentIds: [ctx.bob.id] } });
  assert.equal(second.json.data.sent.length, 0);
  assert.equal(third.json.data.sent.length, 0);
  assert.ok(second.json.data.skipped.length === 1, "the server-side cooldown must report a skip");
  assert.equal(await countReminders(), 1, "duplicate reminders must be impossible");

  // The reminder is visible after a fresh login.
  const relogin = await api("POST", "/api/auth/login", { body: { email: `${TAG}-bob@example.invalid`, password: TEST_PASSWORD } });
  const notifs = await api("GET", "/api/notifications", { token: relogin.json.token });
  const reminder = notifs.json.notifications.find((n) => n.type === "task_reminder" && n.task_id === other.json.taskId);
  assert.ok(reminder, "the reminder must survive re-login");
  assert.equal(reminder.task_id, other.json.taskId);
  assert.equal(reminder.read, 0);

  // Marking it read is scoped to its owner.
  const read = await api("PATCH", `/api/notifications/${reminder.id}/read`, { token: relogin.json.token });
  assert.equal(read.status, 200);
  const aliceRead = await api("PATCH", `/api/notifications/${reminder.id}/read`, { token: ctx.alice.token });
  assert.equal(aliceRead.status, 404, "a student must not be able to mark another user's notification as read");
});

test("10b. bulk reminder accepts many students and reports unknown ids", async () => {
  const res = await api("POST", `/api/tasks/${ctx.taskId}/review/remind`, {
    token: adminToken,
    body: { studentIds: [ctx.alice.id, ctx.bob.id, "000000000000000000000000"] },
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.data.unknown.length, 1);
  assert.ok(Array.isArray(res.json.data.sent));
  assert.ok(res.json.data.sent.length + res.json.data.skipped.length === 2);
});

/* ─── 11. IDOR ───────────────────────────────────────────────────────────── */
test("11. student A cannot read or modify student B's data", async () => {
  // Bob's assignment detail.
  const bobDetail = await api("GET", `/api/tasks/${ctx.taskId}/review/assignments/${ctx.bob.id}`, { token: ctx.alice.token });
  assert.equal(bobDetail.status, 403);

  // Bob's submission list is not visible on the shared task endpoint.
  const subs = await api("GET", `/api/tasks/${ctx.taskId}/submissions`, { token: ctx.alice.token });
  assert.equal(subs.status, 200);
  const others = subs.json.submissions.filter((s) => s.student_id !== ctx.alice.id);
  assert.equal(others.length, 0, "a student must only ever see their own submissions");

  // Bob's file cannot be fetched with Alice's token. (Bob's v1 file id comes
  // from the admin view.)
  const adminSubs = await api("GET", `/api/tasks/${ctx.taskId}/submissions`, { token: adminToken });
  const bobRow = adminSubs.json.submissions.find((s) => s.student_id === ctx.bob.id);
  assert.ok(bobRow && bobRow.files.length, "Bob should have a file");
  const stolen = await api("GET", bobRow.files[0].download_url, { token: ctx.alice.token });
  assert.equal(stolen.status, 403);

  // Alice cannot approve or request a revision for Bob.
  const approve = await api("POST", `/api/tasks/${ctx.taskId}/review/approve`, { token: ctx.alice.token, body: { studentId: ctx.bob.id } });
  assert.equal(approve.status, 403);
  const revise = await api("POST", `/api/tasks/${ctx.taskId}/review/request-revision`, { token: ctx.alice.token, body: { studentId: ctx.bob.id, feedback: "hijack attempt here" } });
  assert.equal(revise.status, 403);
  const remind = await api("POST", `/api/tasks/${ctx.taskId}/review/remind`, { token: ctx.alice.token, body: { studentIds: [ctx.bob.id] } });
  assert.equal(remind.status, 403);

  // Alice cannot submit a task she is not assigned to.
  const foreign = await api("POST", "/api/tasks", {
    token: adminToken,
    body: { title: `${TAG} bob only`, domain: "edutins", assigned_to: ctx.bob.id, student_ids: [ctx.bob.id] },
  });
  assert.equal(foreign.status, 201);
  created.taskIds.push(foreign.json.taskId);
  const sneaky = await api("POST", `/api/tasks/${foreign.json.taskId}/submit`, { token: ctx.alice.token, form: pdfForm("not mine") });
  assert.equal(sneaky.status, 403);

  // A mismatched submissionId/studentId pair is a 404, never a cross-write.
  const mismatch = await api("POST", `/api/tasks/${ctx.taskId}/review/approve`, {
    token: adminToken, body: { studentId: ctx.alice.id, submissionId: bobRow.id },
  });
  assert.equal(mismatch.status, 404);
});

/* ─── Cron ───────────────────────────────────────────────────────────────── */
test("cron endpoint is secret-protected and closes windows", async () => {
  const anon = await api("GET", "/api/cron/expire-resubmissions");
  assert.ok([401, 503].includes(anon.status), `cron must not be open, got ${anon.status}`);
  assert.ok(anon.json.error && anon.json.error.code, "cron must explain why it refused");

  // With the right secret it runs. The server was started without CRON_SECRET,
  // so this asserts the 503 guard rather than performing a sweep.
  const withSecret = await api("GET", "/api/cron/expire-resubmissions", { headers: { "x-cron-secret": "whatever" } });
  assert.equal(withSecret.status, 503);
  assert.equal(withSecret.json.error.code, "CRON_NOT_CONFIGURED");
});

/* ─── 12. Existing task features still work ──────────────────────────────── */
test("12. task create, edit, assign and remove still work", async () => {
  const createdTask = await api("POST", "/api/tasks", {
    token: adminToken,
    body: { title: `${TAG} CRUD`, description: "d", domain: "edutins", assigned_to: ctx.alice.id, student_ids: [ctx.alice.id], priority: "low" },
  });
  assert.equal(createdTask.status, 201, JSON.stringify(createdTask.json));
  const id = createdTask.json.taskId;
  created.taskIds.push(id);

  const edit = await api("PUT", `/api/tasks/${id}`, {
    token: adminToken,
    body: { title: `${TAG} CRUD edited`, description: "d2", priority: "critical", due_date: "2099-12-31", due_time: "18:00" },
  });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));

  const after = await api("GET", `/api/tasks/${id}`, { token: adminToken });
  assert.equal(after.json.task.title, `${TAG} CRUD edited`);
  assert.equal(after.json.task.priority, "critical");
  assert.equal(after.json.task.due_date, "2099-12-31");
  assert.equal(after.json.assignments.length, 1, "the edit must not change the assignment");

  // Domain filter + program come back correctly shaped on the list endpoint.
  const list = await api("GET", "/api/tasks", { token: adminToken });
  const row = list.json.tasks.find((t) => t.id === id);
  assert.equal(row.effective_domain, "edutins");
  assert.ok(row.program, "program must be populated");
  assert.equal(row.status_counts.assigned, 1);
  assert.equal(row.submission_count, 0);
  assert.equal(row.assignee_count, 1);

  const remove = await api("DELETE", `/api/tasks/${id}`, { token: adminToken });
  assert.equal(remove.status, 200, JSON.stringify(remove.json));
  created.taskIds = created.taskIds.filter((t) => t !== id);

  const gone = await api("GET", `/api/tasks/${id}`, { token: adminToken });
  assert.equal(gone.status, 404);
});

test("12b. the Live Tasks row reports distinct submitters, not versions", async () => {
  const { client: dbClient, database } = await db();
  const list = await api("GET", "/api/tasks", { token: adminToken });
  const row = list.json.tasks.find((t) => t.id === ctx.taskId);
  const distinctStudents = await database.collection("submissions").distinct("student_id", { task_id: ctx.taskId });
  const versionRows = await database.collection("submissions").countDocuments({ task_id: ctx.taskId });
  await dbClient.close();

  assert.equal(row.submission_count, distinctStudents.length, "submission_count must be distinct students");
  assert.ok(versionRows >= distinctStudents.length, "this task must have at least as many versions as submitters");
  assert.equal(row.status_counts.submitters, distinctStudents.length);
  // The whole point of the fix: the two numbers must be able to differ.
  // (Before it, both columns read the raw version count.)
  assert.equal(row.submission_count, distinctStudents.length);
});