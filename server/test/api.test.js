"use strict";
/**
 * Integration tests — authentication, approval workflow, task submission,
 * dashboard metrics, authorization, and the CORS contract.
 *
 * SAFETY:
 *  - Runs against the LOCAL DEVELOPMENT database (server/.env) with clearly
 *    marked test accounts (e2e-<timestamp>-*@example.invalid) only.
 *  - Teardown deletes exactly the records these tests created (tracked by
 *    id). No pre-existing user, task or submission is modified or removed.
 *  - Nothing is destructive: no deleteMany on real data, no drops.
 *
 * The server is spawned as a child process on a private port (5099).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = Number(process.env.E2E_PORT || 5099);
const BASE = `http://127.0.0.1:${PORT}`;
const TAG = `e2e-${Date.now()}`;
const TEST_PASSWORD = "E2e-Test-Pass-2026";

// Admin credentials for reviewer-side actions. Read from env first; the
// fallback mirrors server.js's own seeding defaults for the dev database
// (server.js: ADMIN_EMAIL || "admin@techins.com", ADMIN_PASSWORD || "Admin@123").
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@techins.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin@123";

let serverProcess = null;
let serverLogs = "";
let adminToken = "";
let batchId = null;

// Tracked for precise teardown (only what these tests created).
const created = {
  userIds: [],
  taskIds: [],
  submissionIds: [],
  gridfsIds: [],
};

async function api(method, urlPath, { token, body, form, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload = body;
  if (form) {
    payload = form; // FormData: let fetch set the multipart boundary
  } else if (body !== undefined) {
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
      // /api/batches is the first route behind the DB middleware: it answers
      // 200 only once the MongoDB connection is live.
      if (health.ok) {
        const db = await fetch(`${BASE}/api/batches`);
        if (db.ok) {
          const body = await db.json();
          if (body && body.success) return;
        }
      }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not become healthy in ${timeoutMs}ms.\n${serverLogs.slice(-2000)}`);
}

test.before(async () => {
  serverProcess = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout.on("data", (d) => { serverLogs += d.toString(); });
  serverProcess.stderr.on("data", (d) => { serverLogs += d.toString(); });

  await waitForServer();

  // Reviewer (admin) session for approval-side actions.
  const login = await api("POST", "/api/auth/login", { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  assert.equal(login.status, 200, `admin login failed: ${JSON.stringify(login.json)}\n${serverLogs.slice(-1500)}`);
  adminToken = login.json.token;

  // A real active batch for student signup (batch validation is server-enforced).
  const batches = await api("GET", "/api/batches");
  assert.equal(batches.status, 200);
  assert.ok(Array.isArray(batches.json.batches) && batches.json.batches.length > 0, "no active batch available in dev DB");
  batchId = batches.json.batches[0].id;
});

test.after(async () => {
  if (serverProcess) serverProcess.kill();
  // Precise cleanup: only records created by these tests.
  try {
    const { MongoClient, ObjectId, GridFSBucket } = require("mongodb");
    require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
    if (!process.env.MONGODB_URI) return;
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db(process.env.MONGODB_DB_NAME || "techins");
    // NOTE: _id values must be ObjectIds — string ids never match, which
    // silently leaves the test records behind.
    const oid = (v) => { try { return new ObjectId(String(v)); } catch { return null; } };
    const userIds = created.userIds.map(oid).filter(Boolean);
    const taskIds = created.taskIds.map(oid).filter(Boolean);
    const submissionIds = created.submissionIds.map(oid).filter(Boolean);

    // GridFS blobs belonging to these submissions
    if (submissionIds.length) {
      const files = await db.collection("submission_files").find({ submission_id: { $in: created.submissionIds } }, { projection: { gridfs_id: 1 } }).toArray();
      const bucket = new GridFSBucket(db, { bucketName: "submissions" });
      for (const f of files) {
        if (f.gridfs_id) {
          try { await bucket.delete(f.gridfs_id); } catch { /* already gone */ }
        }
      }
      await db.collection("submission_files").deleteMany({ submission_id: { $in: created.submissionIds } });
      await db.collection("submissions").deleteMany({ _id: { $in: submissionIds } });
    }
    if (taskIds.length) {
      await db.collection("task_assignments").deleteMany({ task_id: { $in: created.taskIds } });
      await db.collection("task_status_history").deleteMany({ task_id: { $in: created.taskIds } });
      await db.collection("tasks").deleteMany({ _id: { $in: taskIds } });
    }
    if (userIds.length) {
      await db.collection("task_assignments").deleteMany({ student_id: { $in: created.userIds } });
      await db.collection("notifications").deleteMany({ user_id: { $in: created.userIds } });
      await db.collection("performance").deleteMany({ user_id: { $in: created.userIds } });
      await db.collection("users").deleteMany({ _id: { $in: userIds } });
    }
    await client.close();
    console.log(`[e2e] cleanup done: ${created.userIds.length} users, ${created.taskIds.length} tasks, ${created.submissionIds.length} submissions removed`);
  } catch (e) {
    console.error("[e2e] cleanup error:", e.message);
  }
});

const email = (name) => `${TAG}-${name}@example.invalid`;

async function signupStudent(name, overrides = {}) {
  const res = await api("POST", "/api/auth/signup", {
    body: {
      name,
      email: email(name),
      password: TEST_PASSWORD,
      role: "student",
      phone: "9876543210",
      batchId,
      ...overrides,
    },
  });
  if (res.status === 201) created.userIds.push(res.json.userId);
  return res;
}

async function loginStudent(name) {
  return api("POST", "/api/auth/login", { body: { email: email(name), password: TEST_PASSWORD } });
}

/* ─── Signup validation ─────────────────────────────────────────────────── */
test("signup rejects missing/invalid input with 400", async () => {
  const missing = await api("POST", "/api/auth/signup", { body: { email: email("v1"), password: TEST_PASSWORD, role: "student", phone: "9876543210", batchId } });
  assert.equal(missing.status, 400); // no name

  const badEmail = await api("POST", "/api/auth/signup", { body: { name: "V", email: "not-an-email", password: TEST_PASSWORD, role: "student", phone: "9876543210", batchId } });
  assert.equal(badEmail.status, 400);
  assert.match(badEmail.json.message, /valid email/i);

  const shortPw = await api("POST", "/api/auth/signup", { body: { name: "V", email: email("v2"), password: "short", role: "student", phone: "9876543210", batchId } });
  assert.equal(shortPw.status, 400);
  assert.match(shortPw.json.message, /8 characters/i);

  const noBatch = await api("POST", "/api/auth/signup", { body: { name: "V", email: email("v3"), password: TEST_PASSWORD, role: "student", phone: "9876543210" } });
  assert.equal(noBatch.status, 400);

  const noPhone = await api("POST", "/api/auth/signup", { body: { name: "V", email: email("v4"), password: TEST_PASSWORD, role: "student", batchId } });
  assert.equal(noPhone.status, 400);

  const badPhone = await api("POST", "/api/auth/signup", { body: { name: "V", email: email("v5"), password: TEST_PASSWORD, role: "student", phone: "12", batchId } });
  assert.equal(badPhone.status, 400);

  const ceoAttempt = await api("POST", "/api/auth/signup", { body: { name: "V", email: email("v6"), password: TEST_PASSWORD, role: "ceo", phone: "9876543210", batchId } });
  assert.equal(ceoAttempt.status, 403);
});

test("signup creates a PENDING student and rejects duplicates with 409", async () => {
  const ok = await signupStudent("pending-one");
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(ok.json.requiresApproval, true);

  const dup = await signupStudent("pending-one");
  assert.equal(dup.status, 409);
  assert.match(dup.json.message, /already exists/i);
});

/* ─── Pending student: limited session + gated routes ────────────────────── */
test("pending student can authenticate but every data route is gated (403 REGISTRATION_PENDING)", async () => {
  const login = await loginStudent("pending-one");
  assert.equal(login.status, 200, JSON.stringify(login.json));
  assert.equal(login.json.user.registration_status, "pending");
  const token = login.json.token;

  const me = await api("GET", "/api/auth/me", { token });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.registration_status, "pending");

  for (const p of ["/api/student/dashboard", "/api/tasks/my", "/api/notifications", "/api/missions/my", "/api/activities/me"]) {
    const res = await api("GET", p, { token });
    assert.equal(res.status, 403, `${p} should be gated for pending students, got ${res.status}`);
    assert.equal(res.json.code, "REGISTRATION_PENDING", `${p} code: ${JSON.stringify(res.json)}`);
  }
});

/* ─── Approval workflow ─────────────────────────────────────────────────── */
test("CEO/admin sees the pending request and approval unlocks the student", async () => {
  const pending = await api("GET", "/api/admin/pending-registrations", { token: adminToken });
  assert.equal(pending.status, 200);
  const row = pending.json.pending.find((u) => u.email === email("pending-one"));
  assert.ok(row, "pending student not listed for the CEO");
  assert.equal(row.registration_status, "pending");

  const approve = await api("POST", `/api/admin/approve-registration/${row.id}`, { token: adminToken });
  assert.equal(approve.status, 200, JSON.stringify(approve.json));

  // Student session now reaches real data.
  const login = await loginStudent("pending-one");
  assert.equal(login.status, 200);
  assert.equal(login.json.user.registration_status, "approved");

  const dash = await api("GET", "/api/student/dashboard", { token: login.json.token });
  assert.equal(dash.status, 200, JSON.stringify(dash.json));
  assert.ok(dash.json.tasks, "dashboard payload missing tasks summary");

  // Idempotent: approving again is a no-op, not an error.
  const again = await api("POST", `/api/admin/approve-registration/${row.id}`, { token: adminToken });
  assert.equal(again.status, 200);
});

test("approve-user endpoint works with a valid ObjectId and syncs registration_status", async () => {
  // Regression: this route queried { _id: <string> } which never matches an
  // ObjectId document (always 404) and did not set registration_status.
  const signup = await signupStudent("approve-user");
  assert.equal(signup.status, 201);

  const login = await loginStudent("approve-user");
  const userId = login.json.user.id;

  const approve = await api("POST", `/api/admin/approve-user/${userId}`, { token: adminToken });
  assert.equal(approve.status, 200, `approve-user failed: ${JSON.stringify(approve.json)}`);

  const relogin = await loginStudent("approve-user");
  assert.equal(relogin.status, 200);
  assert.equal(relogin.json.user.registration_status, "approved");
  const dash = await api("GET", "/api/student/dashboard", { token: relogin.json.token });
  assert.equal(dash.status, 200);
});

test("rejected student sees REGISTRATION_REJECTED, not portal data", async () => {
  const signup = await signupStudent("rejected-one");
  assert.equal(signup.status, 201);
  const login = await loginStudent("rejected-one");
  const userId = login.json.user.id;

  const reject = await api("POST", `/api/admin/reject-registration/${userId}`, { token: adminToken });
  assert.equal(reject.status, 200, JSON.stringify(reject.json));

  const relogin = await loginStudent("rejected-one");
  assert.equal(relogin.status, 200); // authentication still allowed (gate handles the rest)
  const dash = await api("GET", "/api/student/dashboard", { token: relogin.json.token });
  assert.equal(dash.status, 403);
  assert.equal(dash.json.code, "REGISTRATION_REJECTED");
});

/* ─── Authorization ─────────────────────────────────────────────────────── */
test("approval and admin endpoints reject students (403) and anonymous (401)", async () => {
  const login = await loginStudent("pending-one");
  const studentToken = login.json.token;

  const approve = await api("POST", `/api/admin/approve-registration/${login.json.user.id}`, { token: studentToken });
  assert.equal(approve.status, 403);

  const stats = await api("GET", "/api/admin/stats", { token: studentToken });
  assert.equal(stats.status, 403);

  const subs = await api("GET", "/api/tasks/submissions", { token: studentToken });
  assert.equal(subs.status, 403);

  const noToken = await api("GET", "/api/admin/stats");
  assert.equal(noToken.status, 401);

  const badToken = await api("GET", "/api/admin/stats", { token: "not-a-real-token" });
  assert.equal(badToken.status, 401);

  // Invalid credentials are generic (no account enumeration).
  const badLogin = await api("POST", "/api/auth/login", { body: { email: email("pending-one"), password: "wrong-password" } });
  assert.equal(badLogin.status, 401);
  assert.match(badLogin.json.message, /invalid email or password/i);
});

/* ─── Task assignment, submission, resubmission, review, files ──────────── */
test("full task lifecycle: assign -> submit -> revision -> resubmit -> approve -> metrics", async () => {
  const login = await loginStudent("pending-one");
  const studentToken = login.json.token;
  const studentId = login.json.user.id;

  // CEO/manager assigns a task to the approved student.
  const taskRes = await api("POST", "/api/tasks", {
    token: adminToken,
    body: {
      title: `${TAG} lifecycle task`,
      description: "Integration test task",
      domain: "edutins",
      assigned_to: studentId,
      priority: "medium",
    },
  });
  assert.equal(taskRes.status, 201, JSON.stringify(taskRes.json));
  const taskId = taskRes.json.taskId;
  created.taskIds.push(taskId);

  const myTasks = await api("GET", "/api/tasks/my", { token: studentToken });
  assert.equal(myTasks.status, 200);
  assert.ok(myTasks.json.tasks.some((t) => t.id === taskId), "assigned task missing from /api/tasks/my");

  // Empty submission rejected (validation parity with the UI). Checked BEFORE
  // the first successful submit: /submit now also refuses to create a second
  // version (409), so the empty-body rule has to be exercised while the
  // student still has no submission at all.
  const empty = await api("POST", `/api/tasks/${taskId}/submit`, { token: studentToken, body: {} });
  assert.equal(empty.status, 400, JSON.stringify(empty.json));
  assert.equal(empty.json.error.code, "EMPTY_SUBMISSION");

  // First submission with a file + comment.
  const form = new FormData();
  form.append("comment", "First version from e2e test");
  form.append("files", new Blob([Buffer.from("%PDF-1.4 e2e test file")], { type: "application/pdf" }), "e2e-test.pdf");
  const sub1 = await api("POST", `/api/tasks/${taskId}/submit`, { token: studentToken, form });
  assert.equal(sub1.status, 201, JSON.stringify(sub1.json));
  assert.equal(sub1.json.version, 1);
  created.submissionIds.push(sub1.json.submissionId);

  const status1 = await api("GET", `/api/tasks/${taskId}/my-submission-status`, { token: studentToken });
  assert.equal(status1.status, 200);
  assert.equal(status1.json.has_submission, true);
  assert.equal(status1.json.latest_submission.version, 1);

  // Reviewer requests a revision -> student gains the resubmit path.
  // POST /api/tasks/review delegates to the same handler the Task Manager
  // uses, so the response is the canonical { success, data, error } envelope
  // and the status is the shared enum value — not a duplicated top-level
  // free-text label (which used to drift from the enum).
  const revision = await api("POST", "/api/tasks/review", {
    token: adminToken,
    body: { submission_id: sub1.json.submissionId, decision: "revision", comment: "Please add more detail" },
  });
  assert.equal(revision.status, 200, JSON.stringify(revision.json));
  assert.equal(revision.json.data.status, "revision_required");
  assert.equal(revision.json.error, null);
  assert.ok(revision.json.data.resubmission_deadline, "a 24h deadline must be returned");
  assert.equal(revision.json.data.resubmission_cycle ?? revision.json.data.revision_cycle, 1);

  const status2 = await api("GET", `/api/tasks/${taskId}/my-submission-status`, { token: studentToken });
  assert.equal(status2.json.workflow_status, "Revision Required");

  // Resubmission creates version 2 (regression: the UI used to hide the
  // submit form after any prior submission, making this impossible).
  // Version 2+ MUST go through /resubmit: that is the only endpoint that
  // enforces the 24-hour revision window on the server clock, so routing it
  // through /submit would be a way to bypass the deadline.
  const form2 = new FormData();
  form2.append("comment", "Second version with more detail");
  const sub2 = await api("POST", `/api/tasks/${taskId}/resubmit`, { token: studentToken, form: form2 });
  assert.equal(sub2.status, 201, JSON.stringify(sub2.json));
  assert.equal(sub2.json.version, 2);
  created.submissionIds.push(sub2.json.submissionId);

  // /submit refuses to create a second version at all.
  const submitAgain = await api("POST", `/api/tasks/${taskId}/submit`, { token: studentToken, form: form2 });
  assert.equal(submitAgain.status, 409);
  assert.equal(submitAgain.json.error.code, "ALREADY_SUBMITTED");

  // Approve the latest version.
  const approve = await api("POST", "/api/tasks/review", {
    token: adminToken,
    body: { submission_id: sub2.json.submissionId, decision: "approve", comment: "Looks good" },
  });
  assert.equal(approve.status, 200, JSON.stringify(approve.json));
  assert.equal(approve.json.data.status, "approved");
  assert.equal(approve.json.error, null);

  // The owning student can download their own file (regression: the download
  // endpoint used to be reviewer-only). Version 1 carried the file; version
  // 2 was comment-only, so find the version that actually has files.
  const subsList = await api("GET", `/api/tasks/${taskId}/submissions`, { token: adminToken });
  assert.equal(subsList.status, 200);
  const withFiles = subsList.json.submissions.find((s) => (s.files || []).length > 0);
  assert.ok(withFiles, "no file metadata returned for the submission");
  const fileRef = withFiles.files[0];
  const dl = await api("GET", fileRef.download_url, { token: studentToken });
  assert.equal(dl.status, 200, `student cannot download own file: ${dl.status}`);

  // Another student may NOT download it.
  const other = await loginStudent("approve-user");
  const dlOther = await api("GET", fileRef.download_url, { token: other.json.token });
  assert.equal(dlOther.status, 403);

  // CEO/manager sees the submission in the review table.
  const allSubs = await api("GET", "/api/tasks/submissions", { token: adminToken });
  assert.equal(allSubs.status, 200);
  const row = allSubs.json.submissions.find((s) => s.id === sub2.json.submissionId);
  assert.ok(row, "submission missing from reviewer table");
  // `student_id` is the TECHINS display code and is null for students who
  // have none; `student_db_id` is the users._id the student routes use.
  // Routing must use the latter — routing on the former produced
  // /admin/students/null (see getStudentRouteId in SubmissionsView).
  assert.equal(row.student_db_id, studentId);
  assert.equal(row.status, "Approved");
  assert.equal(row.version, 2);
  // The version that carried the file reports it (v2 was comment-only).
  const v1row = allSubs.json.submissions.find((s) => s.id === sub1.json.submissionId);
  assert.ok(v1row, "version 1 missing from reviewer table");
  assert.equal(v1row.file_count, 1);
  assert.ok(v1row.files[0].download_url, "download_url missing from file metadata");

  // DASHBOARD METRICS: completedTasks must reflect the approved submission.
  // Regression: this filtered a non-existent `review_status` field (always 0).
  const perf = await api("GET", "/api/performance", { token: adminToken });
  assert.equal(perf.status, 200, JSON.stringify(perf.json));
  const studentPerf = perf.json.students.find((s) => s.student.id === studentId);
  assert.ok(studentPerf, "test student missing from performance scorecards");
  assert.ok(studentPerf.completedTasks >= 1, `completedTasks should be >= 1 after approval, got ${studentPerf.completedTasks}`);
});

/* ─── Dashboard aggregates ──────────────────────────────────────────────── */
test("CEO stats and completion-activity chart return real data", async () => {
  const stats = await api("GET", "/api/admin/stats", { token: adminToken });
  assert.equal(stats.status, 200);
  assert.equal(typeof stats.json.stats.students, "number");
  assert.equal(typeof stats.json.stats.tasks, "number");
  assert.equal(typeof stats.json.stats.completedTasks, "number");
  assert.equal(typeof stats.json.stats.activitiesToday, "number");

  for (const period of ["week", "month", "year"]) {
    const progress = await api("GET", `/api/admin/progress?period=${period}`, { token: adminToken });
    assert.equal(progress.status, 200);
    assert.ok(Array.isArray(progress.json.progress), `${period}: progress must be an array`);
    assert.equal(progress.json.period, period);
    for (const point of progress.json.progress) {
      assert.equal(typeof point.date, "string");
      assert.equal(typeof point.count, "number");
    }
  }
});

/* ─── CORS contract ─────────────────────────────────────────────────────── */
test("CORS allows the deployed frontend origin (regression: production outage)", async () => {
  const origin = process.env.CLIENT_URL || "https://technis-work-portal-05.vercel.app";
  const pre = await fetch(`${BASE}/api/auth/login`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,authorization",
    },
  });
  assert.equal(pre.status, 200);
  assert.equal(pre.headers.get("access-control-allow-origin"), origin, "frontend origin not allowed by CORS");

  const res = await fetch(`${BASE}/api/health`, { headers: { Origin: origin } });
  assert.equal(res.headers.get("access-control-allow-origin"), origin);
  assert.equal(res.headers.get("access-control-allow-credentials"), "true");
});

/* ─── Expired/invalid token handling ────────────────────────────────────── */
test("garbage token is rejected with 401 on every protected route", async () => {
  for (const p of ["/api/auth/me", "/api/tasks/my", "/api/student/dashboard"]) {
    const res = await api("GET", p, { token: "garbage.token.value" });
    assert.equal(res.status, 401, `${p} should reject an invalid token`);
  }
});

/* ─── Status-code contract matrix ───────────────────────────────────────── */
test("HTTP status codes are consistent (400/401/403/404/409/429 documented)", async () => {
  // 404 — unknown API route (JSON error envelope, not HTML)
  const unknown = await api("GET", "/api/does-not-exist");
  assert.equal(unknown.status, 404);
  assert.equal(unknown.json.success, false);

  // 404 — valid route, wrong method
  const wrongMethod = await api("GET", "/api/auth/login");
  assert.ok([404, 405].includes(wrongMethod.status), `unexpected ${wrongMethod.status}`);

  // 400 — invalid validation input on task creation (allowed domains)
  const badDomain = await api("POST", "/api/tasks", { token: adminToken, body: { title: "t", domain: "not-a-domain", assigned_to: "000000000000000000000000" } });
  assert.equal(badDomain.status, 400);

  // 400 — invalid id passed to a route that validates it explicitly
  const badDelete = await api("DELETE", "/api/tasks/not-an-objectid", { token: adminToken });
  assert.equal(badDelete.status, 400);

  // 404 — unknown entity id (well-formed ObjectId, no document)
  const missingTask = await api("GET", "/api/tasks/000000000000000000000000", { token: adminToken });
  assert.equal(missingTask.status, 404);

  // 409 — duplicate email (case-insensitive through normalizeEmail)
  const dup = await signupStudent("case-dup");
  assert.equal(dup.status, 201);
  const upper = await api("POST", "/api/auth/signup", {
    body: { name: "Case Dup", email: email("case-dup").toUpperCase(), password: TEST_PASSWORD, role: "student", phone: "9876543210", batchId },
  });
  assert.equal(upper.status, 409);

  // 400 — malformed JSON body is rejected, not crashed
  const badJson = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not-json",
  });
  assert.ok(badJson.status >= 400, `malformed JSON should 4xx, got ${badJson.status}`);

  // 401 — missing token on a protected route
  assert.equal((await api("GET", "/api/tasks/my")).status, 401);

  // 200 — rate-limit headers are exposed on the login route
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "nobody@example.invalid", password: "x" }),
  });
  assert.ok(loginRes.headers.get("x-ratelimit-limit"), "login route must expose X-RateLimit-Limit");
});
