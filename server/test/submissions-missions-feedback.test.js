"use strict";
/**
 * Submissions review, mission scheduling and feedback edit/delete — end-to-end
 * tests for the fixes made on fix/ui-submissions-missions-feedback-navbar.
 *
 * Each test maps to one reported defect:
 *   A. Student identifiers resolve (the users.student_id vs learner_id bug)
 *   B. GET /api/tasks/submissions/:id returns the whole structured record and
 *      only for the requested submission
 *   C. Approve / Request Resubmission on the submission-id route: legal
 *      transitions only, 409 on duplicates, one notification each
 *   D. Mission scheduling: start/end validation, IST->UTC conversion, edit
 *      updates the same mission, dedup of reschedule notifications
 *   E. Feedback: real student id, edit persists, delete is confirmed + soft,
 *      and a manager cannot touch someone else's feedback (403)
 *   F. IDOR: a student can read none of this, and not another student's file
 *
 * SAFETY
 *  - Runs against the LOCAL DEVELOPMENT database (server/.env) with clearly
 *    marked accounts (sf-<timestamp>-*@example.invalid).
 *  - Teardown removes exactly what these tests created, tracked by id.
 *  - Google Drive is forced to MOCK mode so uploads never touch a real Drive.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const PORT = Number(process.env.UI_FIX_PORT || 5096);
const BASE = `http://127.0.0.1:${PORT}`;
const TAG = `sf-${Date.now()}`;
const TEST_PASSWORD = "SubmissionsFix-Test-Pass-2026";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@techins.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin@123";
const MANAGER_EMAIL = process.env.MANAGER_EMAIL || "manager@techins.com";
const MANAGER_PASSWORD = process.env.MANAGER_PASSWORD || "Manager@123";

let serverProcess = null;
let serverLogs = "";
let adminToken = "";
let managerToken = "";
let managerId = "";
let batchId = "";

const created = { userIds: [], taskIds: [], submissionIds: [], batchIds: [], missionIds: [], feedbackIds: [] };
const ctx = {};

async function api(method, urlPath, { token, body, form, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload = body;
  if (form) payload = form;
  else if (body !== undefined) { h["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
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
        const db = await fetch(`${BASE}/api/batches`);
        if (db.ok) {
          const body = await db.json();
          if (body && body.success) return;
        }
      }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Server ${BASE} not healthy in ${timeoutMs}ms.\n${serverLogs.slice(-2000)}`);
}

async function db() {
  const { MongoClient } = require("mongodb");
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  return { client, database: client.db(process.env.MONGODB_DB_NAME || "techins") };
}

/** Minimal but VALID one-page PDF so the file path is exercised for real. */
function pdfForm(comment) {
  const pdf = Buffer.from([
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj",
    "4 0 obj<</Length 62>>stream",
    `BT /F1 18 Tf 60 760 Td (${comment}) Tj ET`,
    "endstream endobj",
    "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
    "xref 0 6", "0000000000 65535 f ", "trailer<</Size 6/Root 1 0 R>>",
    "startxref", "0", "%%EOF",
  ].join("\n"), "latin1");
  const form = new FormData();
  form.append("files", new Blob([pdf], { type: "application/pdf" }), "submission-proof.pdf");
  if (comment) form.append("comment", comment);
  return form;
}

test.before(async () => {
  serverProcess = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(PORT), GOOGLE_DRIVE_MOCK: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout.on("data", (d) => { serverLogs += d.toString(); });
  serverProcess.stderr.on("data", (d) => { serverLogs += d.toString(); });
  await waitForServer();

  const login = await api("POST", "/api/auth/login", { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  assert.equal(login.status, 200, `admin login failed: ${JSON.stringify(login.json)}\n${serverLogs.slice(-1500)}`);
  adminToken = login.json.token;

  const { client, database } = await db();
  const batchName = `${TAG} batch`;
  await database.collection("batches").insertOne({ name: batchName, active: true, created_at: new Date().toISOString() });
  batchId = String((await database.collection("batches").findOne({ name: batchName }))._id);
  created.batchIds.push(batchId);

  // Two students. Their TECHINS display codes live in `learner_id`, which is
  // exactly what the identifier bug was about, so the test asserts against the
  // value stored there and never a fabricated one.
  const { ObjectId } = require("mongodb");
  for (const who of ["carol", "dave"]) {
    const learnerId = `${TAG.split("-")[1]}-${who}`.toUpperCase();
    const signup = await api("POST", "/api/auth/signup", {
      body: { name: `${TAG} ${who}`, email: `${TAG}-${who}@example.invalid`, password: TEST_PASSWORD, role: "student", phone: "9876543210", batchId },
    });
    assert.equal(signup.status, 201, `signup ${who}: ${JSON.stringify(signup.json)}`);
    created.userIds.push(signup.json.userId);
    const l = await api("POST", "/api/auth/login", { body: { email: `${TAG}-${who}@example.invalid`, password: TEST_PASSWORD } });
    await api("POST", `/api/admin/approve-registration/${l.json.user.id}`, { token: adminToken });
    // signup.json.userId is a STRING; it must be coerced to an ObjectId or the
    // filter matches nothing and the code is never stored.
    const write = await database.collection("users").updateOne(
      { _id: new ObjectId(signup.json.userId) },
      { $set: { learner_id: learnerId } },
    );
    assert.equal(write.matchedCount, 1, `learner_id not stored for ${who}`);
    ctx[who] = { token: l.json.token, id: l.json.user.id, learnerId, name: `${TAG} ${who}` };
  }

  // A manager account for the feedback permission rules.
  const bcrypt = require("bcryptjs");
  await database.collection("users").updateOne({ email: MANAGER_EMAIL }, { $set: { password: await bcrypt.hash(MANAGER_PASSWORD, 10), active: 1 } });
  const managerDoc = await database.collection("users").findOne({ email: MANAGER_EMAIL });
  if (managerDoc) {
    managerId = String(managerDoc._id);
    const ml = await api("POST", "/api/auth/login", { body: { email: MANAGER_EMAIL, password: MANAGER_PASSWORD } });
    managerToken = ml.json?.token || "";
  }
  await client.close();

  const task = await api("POST", "/api/tasks", {
    token: adminToken,
    body: {
      title: `${TAG} | Explain a Concept`,
      description: "Submissions fix test",
      domain: "edutins",
      target_type: "batch",
      batch_id: batchId,
      priority: "high",
      how_to_do: "Read, then explain.",
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
    const { client, database } = await db();
    const ids = (v) => (Array.isArray(v) ? v.map((x) => new (require("mongodb").ObjectId)(x)) : []);
    if (created.taskIds.length) {
      const t = ids(created.taskIds);
      await database.collection("submissions").deleteMany({ task_id: { $in: created.taskIds } });
      await database.collection("task_assignments").deleteMany({ task_id: { $in: created.taskIds } });
      await database.collection("tasks").deleteMany({ _id: { $in: t } });
      await database.collection("notification_history").deleteMany({ related_task_id: { $in: created.taskIds } });
    }
    if (created.submissionIds.length) {
      await database.collection("notification_history").deleteMany({ submission_id: { $in: created.submissionIds } });
    }
    if (created.missionIds.length) await database.collection("missions").deleteMany({ _id: { $in: ids(created.missionIds) } });
    if (created.feedbackIds.length) await database.collection("performance").deleteMany({ _id: { $in: ids(created.feedbackIds) } });
    if (created.userIds.length) await database.collection("users").deleteMany({ _id: { $in: ids(created.userIds) } });
    if (created.batchIds.length) await database.collection("batches").deleteMany({ _id: { $in: ids(created.batchIds) } });
    await database.collection("notifications").deleteMany({ user_id: { $in: created.userIds } });
    await client.close();
    console.log(`[submissions-fix] cleanup: ${created.userIds.length} users, ${created.taskIds.length} tasks, ${created.missionIds.length} missions, ${created.feedbackIds.length} feedback`);
  } catch (e) {
    console.error("[submissions-fix] cleanup failed:", e.message);
  }
});

/* ═══ A. Student identifiers resolve ══════════════════════════════════════ */

test("A1. /api/tasks/submissions returns the student's real TECHINS code, not an em dash", async () => {
  const sub = await api("POST", `/api/tasks/${ctx.taskId}/submit`, { token: ctx.carol.token, form: pdfForm("Carol v1") });
  assert.equal(sub.status, 201, JSON.stringify(sub.json));
  created.submissionIds.push(sub.json.submissionId);
  ctx.carolSubmissionId = sub.json.submissionId;

  const list = await api("GET", "/api/tasks/submissions", { token: adminToken });
  assert.equal(list.status, 200);
  const row = list.json.submissions.find((s) => s.id === sub.json.submissionId);
  assert.ok(row, "submission missing from the list");
  // The whole defect: this used to read users.student_id, which no document
  // carries, and render as "—".
  assert.equal(row.student_id, ctx.carol.learnerId, "student_id must be the learner_id value");
  assert.equal(row.student_code, ctx.carol.learnerId);
  assert.equal(row.student_name, ctx.carol.name);
  assert.equal(row.student_db_id, ctx.carol.id);
  assert.ok(row.student_email, "email must be returned");
  assert.ok("student_department" in row && "student_program" in row && "batch_name" in row,
    "department, program and batch must all be returned so the table can show them");
  assert.equal(row.file_count, 1);
  assert.equal(row.version, 1);
});

test("A2. GET /api/tasks/submissions/:id returns the full structured record for THAT submission", async () => {
  const res = await api("GET", `/api/tasks/submissions/${ctx.carolSubmissionId}`, { token: adminToken });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const d = res.json.data;

  assert.equal(d.submission.id, ctx.carolSubmissionId);
  assert.equal(d.student.id, ctx.carol.id);
  assert.equal(d.student.code, ctx.carol.learnerId);
  assert.equal(d.student.name, ctx.carol.name);
  assert.ok(d.student.email && d.student.department !== undefined && d.student.program !== undefined, "student profile fields present");
  assert.equal(d.task.id, ctx.taskId);
  assert.ok(d.task.title, "task title present");
  assert.ok("due_date" in d.task && "assigned_at" in d.task, "task window fields present");
  assert.equal(d.files.length, 1);
  assert.equal(d.files[0].name, "submission-proof.pdf");
  assert.equal(d.files[0].mime, "application/pdf");
  assert.ok(d.files[0].size > 0, "file size returned");
  // Never a raw storage path: both links must be authenticated endpoints.
  assert.match(d.files[0].download_url, /^\/api\/tasks\/files\/[a-f0-9]+\/download$/);
  assert.match(d.files[0].preview_url, /^\/api\/tasks\/files\/[a-f0-9]+\/download\?disposition=inline$/);
  assert.ok(Array.isArray(d.versions) && d.versions.length >= 1, "review history returned");
  assert.equal(d.can_approve, true);
  assert.equal(d.can_request_revision, true);
  // No raw JSON blobs: every field the UI renders is a named value.
  assert.equal(typeof d.student.code, "string");
  assert.equal(typeof d.submission.comment, "string");
});

test("A3. An unknown submission id is a 404, never another student's record", async () => {
  const res = await api("GET", "/api/tasks/submissions/000000000000000000000000", { token: adminToken });
  assert.equal(res.status, 404);
  assert.equal(res.json.error.code, "SUBMISSION_NOT_FOUND");
  assert.equal(res.json.data, null);
});

/* ═══ C. Approve / Request Resubmission ══════════════════════════════════ */

test("C1. Revision without a usable comment is rejected by the BACKEND", async () => {
  const empty = await api("POST", "/api/tasks/review", {
    token: adminToken, body: { submission_id: ctx.carolSubmissionId, decision: "revision", comment: "   " },
  });
  assert.equal(empty.status, 400);
  assert.equal(empty.json.error.code, "REVISION_FEEDBACK_REQUIRED");

  const short = await api("POST", "/api/tasks/review", {
    token: adminToken, body: { submission_id: ctx.carolSubmissionId, decision: "revision", comment: "fix" },
  });
  assert.equal(short.status, 400);
  assert.equal(short.json.error.code, "REVISION_FEEDBACK_TOO_SHORT");
});

test("C2. A valid revision opens cycle 1 with a 24h deadline and one notification", async () => {
  const res = await api("POST", "/api/tasks/review", {
    token: adminToken,
    body: { submission_id: ctx.carolSubmissionId, decision: "revision", comment: "Please cite the source in section 2." },
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.data.status, "revision_required");
  assert.equal(res.json.data.revision_cycle, 1);
  assert.equal(res.json.data.window_hours, 24);
  const deadline = new Date(res.json.data.resubmission_deadline).getTime();
  const requestedAt = new Date(res.json.data.revision_requested_at).getTime();
  assert.ok(deadline > requestedAt, "deadline must be after the request");
  assert.ok(Math.abs((deadline - requestedAt) - 24 * 3600 * 1000) < 5000, "window must be 24h from the server clock");

  const detail = await api("GET", `/api/tasks/submissions/${ctx.carolSubmissionId}`, { token: adminToken });
  assert.equal(detail.json.data.submission.review_status, "revision_required");
  assert.equal(detail.json.data.submission.review_comments, "Please cite the source in section 2.");
  assert.ok(detail.json.data.submission.reviewer_name, "reviewer recorded");

  const notifs = await api("GET", "/api/notifications", { token: ctx.carol.token });
  const mine = notifs.json.notifications.filter((n) => n.type === "revision_required");
  assert.equal(mine.length, 1, "exactly one revision notification");

  // Re-requesting while a cycle is open is a 409, not a second window.
  const again = await api("POST", "/api/tasks/review", {
    token: adminToken, body: { submission_id: ctx.carolSubmissionId, decision: "revision", comment: "Trying again with more detail." },
  });
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, "REVISION_ALREADY_OPEN");
});

test("C3. The student sees the exact comment and deadline in their own portal", async () => {
  const status = await api("GET", `/api/tasks/${ctx.taskId}/my-submission-status`, { token: ctx.carol.token });
  assert.equal(status.status, 200);
  assert.equal(status.json.workflow_status, "Revision Required");

  const eligibility = await api("GET", `/api/tasks/${ctx.taskId}/resubmission-eligibility`, { token: ctx.carol.token });
  assert.equal(eligibility.status, 200, JSON.stringify(eligibility.json));
  assert.equal(eligibility.json.data.status, "revision_required");
  assert.equal(eligibility.json.data.resubmission_available, true, "the Resubmit action is enabled");
  assert.ok(eligibility.json.data.revision_deadline, "the exact deadline is exposed to the student");
  assert.equal(eligibility.json.data.last_review_feedback, "Please cite the source in section 2.",
    "the student sees the reviewer's exact comment");
  assert.ok(eligibility.json.data.window_hours, "the window length is reported");
});

test("C4. Resubmission inside the window creates version 2 and keeps version 1", async () => {
  const form = new FormData();
  form.append("comment", "Corrected version with the source cited.");
  form.append("files", new Blob([Buffer.from("%PDF-1.4\n%%EOF\n")], { type: "application/pdf" }), "corrected.pdf");
  const res = await api("POST", `/api/tasks/${ctx.taskId}/resubmit`, { token: ctx.carol.token, form });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.data.version, 2);
  ctx.carolV2 = res.json.data.submissionId;
  created.submissionIds.push(ctx.carolV2);

  const detail = await api("GET", `/api/tasks/submissions/${ctx.carolV2}`, { token: adminToken });
  const versions = detail.json.data.versions;
  assert.equal(versions.length, 2, "the original version is never deleted");
  assert.deepEqual(versions.map((v) => v.version).sort(), [1, 2]);
});

test("C5. Approve sets approved, records the reviewer, and a second approve is 409", async () => {
  const first = await api("POST", "/api/tasks/review", {
    token: adminToken, body: { submission_id: ctx.carolV2, decision: "approve", comment: "Clear and complete." },
  });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.data.status, "approved");
  assert.ok(first.json.data.reviewed_at && first.json.data.reviewed_by, "reviewer + timestamp stored");

  const second = await api("POST", "/api/tasks/review", {
    token: adminToken, body: { submission_id: ctx.carolV2, decision: "approve", comment: "Again." },
  });
  assert.equal(second.status, 409);
  assert.equal(second.json.error.code, "ALREADY_APPROVED");

  // Requesting a revision on an approved submission is also illegal.
  const revise = await api("POST", "/api/tasks/review", {
    token: adminToken, body: { submission_id: ctx.carolV2, decision: "revision", comment: "Changing my mind now." },
  });
  assert.equal(revise.status, 409);

  const detail = await api("GET", `/api/tasks/submissions/${ctx.carolV2}`, { token: adminToken });
  assert.equal(detail.json.data.can_approve, false, "an approved submission can no longer be approved");
  assert.equal(detail.json.data.assignment.revision_status, "closed", "approval closes the open revision cycle");

  const notifs = await api("GET", "/api/notifications", { token: ctx.carol.token });
  assert.equal(notifs.json.notifications.filter((n) => n.type === "task_approved").length, 1, "one approval notification");
});

test("C6. An unknown decision and an unknown submission are rejected", async () => {
  const bad = await api("POST", "/api/tasks/review", {
    token: adminToken, body: { submission_id: ctx.carolV2, decision: "banana", comment: "x" },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, "BAD_DECISION");

  const missing = await api("POST", "/api/tasks/review", {
    token: adminToken, body: { submission_id: "000000000000000000000000", decision: "approve", comment: "x" },
  });
  assert.equal(missing.status, 404);
});

test("C7. A late resubmission is rejected by the BACKEND (deadline moved into the past)", async () => {
  const sub = await api("POST", `/api/tasks/${ctx.taskId}/submit`, { token: ctx.dave.token, form: pdfForm("Dave v1") });
  assert.equal(sub.status, 201, JSON.stringify(sub.json));
  ctx.daveSubmissionId = sub.json.submissionId;
  created.submissionIds.push(ctx.daveSubmissionId);

  await api("POST", "/api/tasks/review", {
    token: adminToken, body: { submission_id: ctx.daveSubmissionId, decision: "revision", comment: "Please add a summary section." },
  });

  // Exactly what "24 hours passed" looks like to the server.
  const { client, database } = await db();
  await database.collection("task_assignments").updateMany(
    { task_id: ctx.taskId, student_id: ctx.dave.id },
    { $set: { revision_deadline: new Date(Date.now() - 60 * 1000).toISOString() } },
  );
  await client.close();

  const late = await api("POST", `/api/tasks/${ctx.taskId}/resubmit`, {
    token: ctx.dave.token, form: (() => { const f = new FormData(); f.append("comment", "Too late."); return f; })(),
  });
  assert.equal(late.status, 409, JSON.stringify(late.json));
  assert.match(late.json.error.message, /24-hour resubmission window has expired/i);

  const eligibility = await api("GET", `/api/tasks/${ctx.taskId}/resubmission-eligibility`, { token: ctx.dave.token });
  assert.equal(eligibility.status, 200, JSON.stringify(eligibility.json));
  assert.equal(eligibility.json.data.resubmission_available, false, "the student's Resubmit button must be disabled");
  assert.equal(eligibility.json.data.status, "resubmission_expired");
});

/* ═══ F. IDOR / roles ════════════════════════════════════════════════════ */

test("F1. A student can read none of the review endpoints (403)", async () => {
  for (const path of [
    "/api/tasks/submissions",
    `/api/tasks/submissions/${ctx.carolV2}`,
    `/api/tasks/${ctx.taskId}/review`,
  ]) {
    const res = await api("GET", path, { token: ctx.dave.token });
    assert.equal(res.status, 403, `${path} must be 403 for a student`);
  }
});

test("F2. A student cannot approve, request a revision or create feedback for anyone", async () => {
  const approve = await api("POST", "/api/tasks/review", {
    token: ctx.dave.token, body: { submission_id: ctx.carolV2, decision: "approve", comment: "me" },
  });
  assert.equal(approve.status, 403);

  const revise = await api("POST", "/api/tasks/review", {
    token: ctx.dave.token, body: { submission_id: ctx.carolV2, decision: "revision", comment: "me please" },
  });
  assert.equal(revise.status, 403);

  const feedback = await api("POST", "/api/admin/feedback", {
    token: ctx.dave.token, body: { user_id: ctx.dave.id, feedback: "me writing feedback" },
  });
  assert.equal(feedback.status, 403);
});

test("F3. One student cannot download another student's file", async () => {
  const detail = await api("GET", `/api/tasks/submissions/${ctx.carolV2}`, { token: adminToken });
  const url = detail.json.data.files[0].download_url;
  const own = await api("GET", url, { token: ctx.carol.token });
  assert.equal(own.status, 200, "the owner can download their own file");
  assert.match(own.headers.get("content-disposition") || "", /^attachment/, "downloads are attachments, never inline");

  const other = await api("GET", url, { token: ctx.dave.token });
  assert.equal(other.status, 403, "a different student must be refused");
});

/* ═══ D. Mission scheduling ══════════════════════════════════════════════ */

test("D1. A mission window must be valid and is stored as UTC from the admin's offset", async () => {
  const endFirst = await api("POST", "/api/missions", {
    token: adminToken,
    body: { title: `${TAG} bad-window`, assigned_to: ctx.carol.id, start_date: "2026-10-20", start_time: "10:00", end_date: "2026-10-19", end_time: "09:00", offset_minutes: 330 },
  });
  assert.equal(endFirst.status, 400);
  assert.equal(endFirst.json.error.code, "INVALID_WINDOW");

  const missingEnd = await api("POST", "/api/missions", {
    token: adminToken,
    body: { title: `${TAG} no-end`, assigned_to: ctx.carol.id, start_date: "2026-10-20", start_time: "10:00", offset_minutes: 330 },
  });
  assert.equal(missingEnd.status, 400);
  assert.equal(missingEnd.json.error.code, "MISSING_END_FIELDS");

  const missingStart = await api("POST", "/api/missions", {
    token: adminToken,
    body: { title: `${TAG} no-start`, assigned_to: ctx.carol.id, end_date: "2026-10-20", end_time: "09:00", offset_minutes: 330 },
  });
  assert.equal(missingStart.status, 400);
  assert.equal(missingStart.json.error.code, "MISSING_START_FIELDS");

  // 09:00 IST (UTC+5:30) on 2026-10-20 is 03:30Z.
  const ok = await api("POST", "/api/missions", {
    token: adminToken,
    body: {
      title: `${TAG} windowed mission`,
      description: "Scheduling test",
      assigned_to: ctx.carol.id,
      start_date: "2026-10-20", start_time: "09:00",
      end_date: "2026-10-20", end_time: "18:00",
      offset_minutes: 330,
    },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  ctx.missionId = ok.json.missionId;
  created.missionIds.push(ctx.missionId);
  assert.equal(ok.json.data.start_at, "2026-10-20T03:30:00.000Z");
  assert.equal(ok.json.data.end_at, "2026-10-20T12:30:00.000Z");
});

test("D2. The mission list reports start, end, schedule state and the student code", async () => {
  const res = await api("GET", "/api/missions", { token: adminToken });
  assert.equal(res.status, 200);
  const m = res.json.missions.find((x) => x.id === ctx.missionId);
  assert.ok(m, "new mission missing from the list");
  assert.ok(m.start_at && m.end_at, "the list exposes the window");
  assert.ok(["upcoming", "active", "overdue", "completed"].includes(m.schedule_status), "schedule state derived");
  assert.equal(m.student_name, ctx.carol.name);
  assert.equal(m.student_code, ctx.carol.learnerId);
  // Legacy due_date stays in sync so older readers keep working.
  assert.equal(m.due_date, m.end_at);
});

test("D3. Editing a mission updates the SAME record and notifies only when the window moves", async () => {
  const before = await api("GET", "/api/missions", { token: adminToken });
  const countBefore = before.json.missions.length;

  const moved = await api("PUT", `/api/missions/${ctx.missionId}`, {
    token: adminToken,
    body: {
      title: `${TAG} windowed mission`,
      description: "Rescheduled",
      start_date: "2026-11-02", start_time: "11:00",
      end_date: "2026-11-03", end_time: "16:45",
      offset_minutes: 330,
    },
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
  assert.equal(moved.json.data.notified, true, "a material schedule change notifies");

  const after = await api("GET", "/api/missions", { token: adminToken });
  assert.equal(after.json.missions.length, countBefore, "editing must not create a second mission");
  const m = after.json.missions.find((x) => x.id === ctx.missionId);
  assert.equal(m.start_at, "2026-11-02T05:30:00.000Z");
  assert.equal(m.end_at, "2026-11-03T11:15:00.000Z");
  assert.equal(m.description, "Rescheduled");

  // Same schedule again: no second notification.
  const same = await api("PUT", `/api/missions/${ctx.missionId}`, {
    token: adminToken,
    body: {
      title: m.title, description: m.description,
      start_date: "2026-11-02", start_time: "11:00",
      end_date: "2026-11-03", end_time: "16:45",
      offset_minutes: 330,
    },
  });
  assert.equal(same.status, 200);
  assert.equal(same.json.data.notified, false, "an unchanged schedule must not re-notify");

  const notifs = await api("GET", "/api/notifications", { token: ctx.carol.token });
  assert.equal(notifs.json.notifications.filter((n) => n.type === "mission_rescheduled").length, 1,
    "exactly one reschedule notification for one schedule change");
});

test("D4. An invalid edit window is rejected and the mission is unchanged", async () => {
  const before = await api("GET", "/api/missions", { token: adminToken });
  const snapshot = before.json.missions.find((x) => x.id === ctx.missionId);
  const res = await api("PUT", `/api/missions/${ctx.missionId}`, {
    token: adminToken,
    body: { start_date: "2026-11-03", start_time: "18:00", end_date: "2026-11-02", end_time: "09:00", offset_minutes: 330 },
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.error.code, "INVALID_WINDOW");
  const after = await api("GET", "/api/missions", { token: adminToken });
  const now = after.json.missions.find((x) => x.id === ctx.missionId);
  assert.equal(now.start_at, snapshot.start_at, "a rejected edit leaves the window untouched");
  assert.equal(now.end_at, snapshot.end_at);
});

test("D5. A student sees their own mission window and nothing else", async () => {
  const mine = await api("GET", "/api/missions/my", { token: ctx.carol.token });
  assert.equal(mine.status, 200);
  const m = mine.json.missions.find((x) => x.id === ctx.missionId);
  assert.ok(m, "the assigned mission is visible to its student");
  assert.ok(m.start_at && m.end_at, "student view carries the window");
  assert.ok(m.description, "student view carries the description");

  const other = await api("GET", "/api/missions/my", { token: ctx.dave.token });
  assert.equal(other.json.missions.find((x) => x.id === ctx.missionId), undefined,
    "another student never sees it");
});

test("D6. The mission migration is idempotent and keeps existing missions", async () => {
  const { client, database } = await db();
  await database.collection("missions").insertOne({
    title: `${TAG} legacy-due-only`,
    assigned_to: ctx.carol.id,
    assigned_by: adminToken ? ctx.carol.id : ctx.carol.id,
    status: "assigned", progress: 0,
    due_date: "2026-10-25T10:00:00.000Z",
    created_at: new Date().toISOString(),
  });
  const legacyId = (await database.collection("missions").findOne({ title: `${TAG} legacy-due-only` }))._id;
  created.missionIds.push(String(legacyId));

  const { spawnSync } = require("node:child_process");
  const run = () => spawnSync(process.execPath, [path.join(__dirname, "..", "scripts", "migrate-mission-schedule.js")], {
    env: process.env, encoding: "utf8",
  });

  const first = run();
  assert.equal(first.status, 0, first.stderr);
  let doc = await database.collection("missions").findOne({ _id: legacyId });
  assert.ok(doc.end_at, "end_at backfilled from due_date");
  assert.equal(doc.due_date, "2026-10-25T10:00:00.000Z", "the legacy due_date is preserved, not overwritten");
  assert.equal(new Date(doc.start_at).getTime(), new Date(doc.end_at).getTime() - 86400000, "start is one day before end");
  const endAfterFirst = doc.end_at;

  const second = run();
  assert.equal(second.status, 0, second.stderr);
  doc = await database.collection("missions").findOne({ _id: legacyId });
  assert.equal(doc.end_at, endAfterFirst, "a second run changes nothing");
  assert.ok(await database.collection("missions").countDocuments({ _id: legacyId }) === 1, "no mission was lost or duplicated");

  // Dry run must not write.
  const dry = spawnSync(process.execPath, [path.join(__dirname, "..", "scripts", "migrate-mission-schedule.js"), "--dry-run"], {
    env: process.env, encoding: "utf8",
  });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /nothing was written/i);
  await client.close();
});

/* ═══ E. Feedback ════════════════════════════════════════════════════════ */

test("E1. Feedback entries report the real student code, and expose can_edit / can_delete", async () => {
  const created1 = await api("POST", "/api/admin/feedback", {
    token: adminToken,
    body: { user_id: ctx.carol.id, feedback: "Strong work overall.", score: 82, strengths: "Clear structure", improvements: "Cite sources" },
  });
  assert.equal(created1.status, 201, JSON.stringify(created1.json));
  ctx.feedbackId = created1.json.feedbackId;
  created.feedbackIds.push(ctx.feedbackId);

  const list = await api("GET", "/api/admin/feedback/tasks", { token: adminToken });
  assert.equal(list.status, 200);
  const entry = list.json.entries.find((e) => e.id === ctx.feedbackId);
  assert.ok(entry, "entry missing from the list");
  // The defect: this read users.student_id and rendered "ID: —".
  assert.equal(entry.student_code, ctx.carol.learnerId, "the real student ID is shown");
  assert.notEqual(entry.student_code, "—");
  assert.equal(entry.student_name, ctx.carol.name);
  assert.equal(entry.can_edit, true);
  assert.equal(entry.can_delete, true);
  assert.equal(entry.score, 82);
  assert.equal(entry.status, "recorded");
});

test("E2. Editing feedback persists and preserves the reviewer and created_at", async () => {
  const { client, database } = await db();
  const before = await database.collection("performance").findOne({ _id: new (require("mongodb").ObjectId)(ctx.feedbackId) });
  await client.close();
  const originalReviewer = String(before.reviewed_by);
  const originalCreated = before.created_at;

  const res = await api("PUT", `/api/admin/feedback/${ctx.feedbackId}`, {
    token: adminToken,
    body: { feedback: "Edited feedback text.", score: 91, strengths: "Edited one, edited two", improvements: "Only improvement" },
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));

  const list = await api("GET", "/api/admin/feedback/tasks", { token: adminToken });
  const entry = list.json.entries.find((e) => e.id === ctx.feedbackId);
  assert.equal(entry.feedback, "Edited feedback text.");
  assert.equal(entry.score, 91);
  assert.equal(entry.strengths, "Edited one, edited two");
  assert.equal(entry.improvements, "Only improvement");

  const c = await db();
  const after = await c.database.collection("performance").findOne({ _id: new (require("mongodb").ObjectId)(ctx.feedbackId) });
  await c.client.close();
  assert.equal(String(after.reviewed_by), originalReviewer, "the original reviewer is immutable");
  assert.equal(after.created_at, originalCreated, "created_at is immutable");
  assert.ok(after.updated_by, "updated_by recorded");
  assert.ok(after.updated_at, "updated_at recorded");
});

test("E3. Empty feedback and an out-of-range score are rejected", async () => {
  const empty = await api("PUT", `/api/admin/feedback/${ctx.feedbackId}`, { token: adminToken, body: { feedback: "   " } });
  assert.equal(empty.status, 400);
  assert.equal(empty.json.error.code, "FEEDBACK_REQUIRED");

  const score = await api("PUT", `/api/admin/feedback/${ctx.feedbackId}`, { token: adminToken, body: { feedback: "Fine text", score: 101 } });
  assert.equal(score.status, 400);
  assert.equal(score.json.error.code, "INVALID_SCORE");

  const negative = await api("PUT", `/api/admin/feedback/${ctx.feedbackId}`, { token: adminToken, body: { feedback: "Fine text", score: -5 } });
  assert.equal(negative.status, 400);
});

test("E4. Delete is a soft delete: the row survives, the list stops showing it", async () => {
  const throwaway = await api("POST", "/api/admin/feedback", {
    token: adminToken, body: { user_id: ctx.dave.id, feedback: "Delete me please." },
  });
  assert.equal(throwaway.status, 201);
  const id = throwaway.json.feedbackId;
  created.feedbackIds.push(id);

  const res = await api("DELETE", `/api/admin/feedback/${id}`, { token: adminToken });
  assert.equal(res.status, 200, JSON.stringify(res.json));

  const list = await api("GET", "/api/admin/feedback/tasks", { token: adminToken });
  assert.equal(list.json.entries.find((e) => e.id === id), undefined, "it is gone from the list");

  const c = await db();
  const doc = await c.database.collection("performance").findOne({ _id: new (require("mongodb").ObjectId)(id) });
  await c.client.close();
  assert.ok(doc, "the audit record survives the soft delete");
  assert.ok(doc.deleted_at && doc.deleted_by, "who deleted it and when are recorded");

  // Deleting or editing it again is a 409, not a second delete.
  const again = await api("DELETE", `/api/admin/feedback/${id}`, { token: adminToken });
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, "ALREADY_DELETED");
  const edit = await api("PUT", `/api/admin/feedback/${id}`, { token: adminToken, body: { feedback: "after delete" } });
  assert.equal(edit.status, 409);

  // And it cannot be deleted twice by mistake in a way that touches others.
  const list2 = await api("GET", "/api/admin/feedback/tasks", { token: adminToken });
  assert.ok(list2.json.entries.find((e) => e.id === ctx.feedbackId), "the other entry is untouched");
});

test("E5. A manager may only edit and delete feedback they recorded themselves", async (t) => {
  if (!managerToken) { t.skip("no manager account available"); return; }

  const c = await db();
  const now = new Date().toISOString();
  const byManager = await c.database.collection("performance").insertOne({
    user_id: ctx.carol.id, period: "2026-10", score: 60,
    strengths: "C", improvements: "D",
    feedback: `${TAG} authored by the manager.`,
    reviewed_by: managerId, created_by: managerId,
    task_id: null, submission_id: null, status: "recorded",
    created_at: now, updated_at: now,
  });
  const byAdmin = await c.database.collection("performance").insertOne({
    user_id: ctx.carol.id, period: "2026-10", score: 70,
    strengths: "A", improvements: "B",
    feedback: `${TAG} authored by the admin.`,
    reviewed_by: "ceo", created_by: "ceo",
    task_id: null, submission_id: null, status: "recorded",
    created_at: now, updated_at: now,
  });
  created.feedbackIds.push(String(byManager.insertedId), String(byAdmin.insertedId));
  await c.client.close();

  const list = await api("GET", "/api/admin/feedback/tasks", { token: managerToken });
  assert.equal(list.status, 200);
  assert.equal(list.json.entries.find((e) => e.id === String(byAdmin.insertedId)).can_edit, false,
    "the UI must not offer Edit on someone else's entry");
  assert.equal(list.json.entries.find((e) => e.id === String(byManager.insertedId)).can_edit, true);

  const forbiddenEdit = await api("PUT", `/api/admin/feedback/${byAdmin.insertedId}`, {
    token: managerToken, body: { feedback: "manager overreach" },
  });
  assert.equal(forbiddenEdit.status, 403, "a manager cannot edit another reviewer's feedback");

  const forbiddenDelete = await api("DELETE", `/api/admin/feedback/${byAdmin.insertedId}`, { token: managerToken });
  assert.equal(forbiddenDelete.status, 403, "a manager cannot delete another reviewer's feedback");

  const allowed = await api("PUT", `/api/admin/feedback/${byManager.insertedId}`, {
    token: managerToken, body: { feedback: `${TAG} manager edited their own entry.` },
  });
  assert.equal(allowed.status, 200);
});

test("E6. Feedback endpoints require a role and reject an unknown id", async () => {
  const noToken = await fetch(`${BASE}/api/admin/feedback/tasks`);
  assert.equal(noToken.status, 401);

  const unknown = await api("PUT", "/api/admin/feedback/000000000000000000000000", { token: adminToken, body: { feedback: "x" } });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.json.error.code, "NOT_FOUND");

  const unknownDelete = await api("DELETE", "/api/admin/feedback/000000000000000000000000", { token: adminToken });
  assert.equal(unknownDelete.status, 404);
});