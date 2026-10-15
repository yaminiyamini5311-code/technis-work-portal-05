"use strict";
/**
 * CEO Student Report tests — task-wise Performance and task-wise Feedback.
 *
 * Covers:
 *  - dynamic per-student task rows (no hardcoded task counts)
 *  - scoring: valid pairs only, no divide-by-zero, honest nulls
 *  - student isolation: A's submission/score/feedback never appear for B
 *  - feedback task association + legacy (unassigned) feedback preservation
 *
 * Skipped when MONGODB_URI is not configured.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = Number(process.env.REPORT_TEST_PORT || 5095);
const BASE = `http://127.0.0.1:${PORT}`;
const TAG = `e2e-report-${Date.now()}`;
const PASSWORD = "E2e-Report-Pass-2026";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@techins.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin@123";

let serverProcess = null;
let serverLogs = "";
const created = { userIds: [], taskIds: [], submissionIds: [] };

async function api(method, urlPath, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(`${BASE}${urlPath}`, { method, headers, body: payload });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

async function waitForServer(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const h = await fetch(`${BASE}/api/health`);
      if (h.ok) { const b = await fetch(`${BASE}/api/batches`); if (b.ok) { const j = await b.json(); if (j.success) return; } }
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server not healthy\n${serverLogs.slice(-1200)}`);
}

function hasDb() { return !!process.env.MONGODB_URI; }

test.before(async () => {
  serverProcess = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(PORT), GOOGLE_DRIVE_MOCK: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout.on("data", (d) => { serverLogs += d.toString(); });
  serverProcess.stderr.on("data", (d) => { serverLogs += d.toString(); });
  await waitForServer();
});

test.after(async () => {
  if (serverProcess) serverProcess.kill();
  try {
    const { MongoClient, ObjectId } = require("mongodb");
    require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
    if (!process.env.MONGODB_URI) return;
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db(process.env.MONGODB_DB_NAME || "techins");
    const oid = (v) => { try { return new ObjectId(String(v)); } catch { return null; } };
    const uids = created.userIds.map(oid).filter(Boolean);
    const tids = created.taskIds.map(oid).filter(Boolean);
    const sids = created.submissionIds.map(oid).filter(Boolean);
    if (sids.length) await db.collection("submission_files").deleteMany({ submission_id: { $in: sids.map(String) } });
    await db.collection("performance").deleteMany({ user_id: { $in: created.userIds } });
    if (tids.length) {
      await db.collection("task_assignments").deleteMany({ task_id: { $in: tids.map(String) } });
      await db.collection("task_status_history").deleteMany({ task_id: { $in: tids.map(String) } });
    }
    if (sids.length) await db.collection("submissions").deleteMany({ _id: { $in: sids } });
    if (tids.length) await db.collection("tasks").deleteMany({ _id: { $in: tids } });
    if (uids.length) await db.collection("users").deleteMany({ _id: { $in: uids } });
    await client.close();
  } catch (e) { console.error("cleanup failed:", e.message); }
});

test("task-wise performance + task-wise feedback with student isolation", { skip: hasDb() ? false : "MONGODB_URI not configured" }, async () => {
  const login = await api("POST", "/api/auth/login", { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  assert.equal(login.status, 200, JSON.stringify(login.json));
  const admin = login.json.token;

  const batches = await api("GET", "/api/batches");
  const batchId = batches.json.batches[0].id;

  const makeStudent = async (label) => {
    const email = `${TAG}-${label}@example.invalid`;
    const s = await api("POST", "/api/auth/signup", { body: { name: `Report ${label}`, email, password: PASSWORD, role: "student", phone: "9876543210", batchId } });
    assert.equal(s.status, 201, JSON.stringify(s.json));
    created.userIds.push(s.json.userId);
    await api("POST", `/api/admin/approve-registration/${s.json.userId}`, { token: admin });
    const l = await api("POST", "/api/auth/login", { body: { email, password: PASSWORD } });
    assert.equal(l.status, 200);
    return { id: s.json.userId, token: l.json.token };
  };

  const A = await makeStudent("a");
  const B = await makeStudent("b");

  // Two tasks: both students get both; task 1 carries a day number.
  const mkTask = async (title, day) => {
    const r = await api("POST", "/api/tasks", {
      token: admin,
      body: { title: `${TAG} ${title}`, description: "d", domain: "edutins", target_type: "student", student_ids: [A.id, B.id], day_number: day, priority: "medium" },
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    created.taskIds.push(r.json.taskId);
    return r.json.taskId;
  };
  const task1 = await mkTask("task one", 1);
  const task2 = await mkTask("task two", 2);

  const submit = async (token, taskId, label) => {
    const form = new FormData();
    form.append("comment", `submission ${label}`);
    const r = await api("POST", `/api/tasks/${taskId}/submit`, { token, form });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    created.submissionIds.push(r.json.submissionId);
    return r.json.submissionId;
  };

  const subA1 = await submit(A.token, task1, "A1");
  await submit(A.token, task2, "A2");
  await submit(B.token, task1, "B1");
  // B never submits task 2 -> B must show it as not started.

  // Review: A's task1 scored 8/10 and approved; B's task1 approved but NOT scored.
  const approve = async (submissionId, extra = {}) => {
    const r = await api("POST", "/api/tasks/review", { token: admin, body: { submission_id: submissionId, decision: "approve", comment: "ok", ...extra } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  await approve(subA1, { score: 8, max_marks: 10 });
  const bSubs = await api("GET", `/api/tasks/submissions?task_id=${task1}`, { token: admin });
  const bSubRow = bSubs.json.submissions.find((s) => s.student_id === B.id);
  await approve(bSubRow.id);

  // Performance report
  const perf = await api("GET", "/api/performance", { token: admin });
  assert.equal(perf.status, 200);
  const rowA = perf.json.students.find((s) => s.student.id === A.id);
  const rowB = perf.json.students.find((s) => s.student.id === B.id);
  assert.ok(rowA && rowB, "both students must be present");

  // Dynamic tasks (both tasks, no hardcoding)
  assert.equal(rowA.tasks.length, 2, "A should have 2 task rows");
  assert.equal(rowB.tasks.length, 2, "B should have 2 task rows");

  const a1 = rowA.tasks.find((t) => t.task_id === task1);
  const a2 = rowA.tasks.find((t) => t.task_id === task2);
  const b1 = rowB.tasks.find((t) => t.task_id === task1);
  const b2 = rowB.tasks.find((t) => t.task_id === task2);

  assert.equal(a1.state, "approved");
  assert.equal(a1.has_score, true);
  assert.equal(a1.score, 8);
  assert.equal(a1.max_marks, 10);
  assert.ok(a1.submission?.reviewer_name, "reviewer name must be exposed");
  assert.equal(a2.state, "submitted");
  assert.equal(a2.has_score, false);
  assert.equal(a2.awaiting_evaluation, true);

  // B: approved but unscored -> honest null, not 0 and not NaN
  assert.equal(b1.state, "approved");
  assert.equal(b1.has_score, false);
  assert.equal(b1.score, null);
  assert.equal(b1.max_marks, null);
  // B never submitted task 2
  assert.equal(b2.state, "not_started");
  assert.equal(b2.submission, null);

  // Scoring maths
  assert.equal(rowA.scoring.scored_tasks, 1);
  assert.equal(rowA.scoring.total_earned, 8);
  assert.equal(rowA.scoring.total_max, 10);
  assert.equal(rowA.scoring.overall_percentage, 80);
  // B has no scores -> null percentage (no divide-by-zero, no fake zero)
  assert.equal(rowB.scoring.has_scores, false);
  assert.equal(rowB.scoring.overall_percentage, null);
  assert.ok(!Number.isNaN(rowB.scoring.overall_percentage || 0));

  // Isolation: B's row never carries A's score/feedback
  assert.notEqual(b1.score, 8);

  // Feedback: task-linked + legacy general
  const fbLinked = await api("POST", "/api/admin/feedback", {
    token: admin,
    body: { user_id: A.id, task_id: task1, feedback: "Strong structure", score: 9, strengths: ["clarity"], improvements: ["depth"] },
  });
  assert.equal(fbLinked.status, 201, JSON.stringify(fbLinked.json));
  assert.equal(fbLinked.json.task_id, task1);

  const fbGeneral = await api("POST", "/api/admin/feedback", { token: admin, body: { user_id: A.id, feedback: "General note" } });
  assert.equal(fbGeneral.status, 201);
  assert.equal(fbGeneral.json.task_id, null, "legacy/general feedback keeps a null task_id");

  // Cross-student task association must be rejected
  const wrong = await api("POST", "/api/admin/feedback", { token: admin, body: { user_id: B.id, task_id: "000000000000000000000000", feedback: "nope" } });
  assert.equal(wrong.status, 404, "unknown task must 404");
  const { MongoClient } = require("mongodb");
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db(process.env.MONGODB_DB_NAME || "techins");
  const otherTask = await api("POST", "/api/tasks", { token: admin, body: { title: `${TAG} b-only`, description: "d", domain: "edutins", target_type: "student", student_ids: [B.id], priority: "medium" } });
  created.taskIds.push(otherTask.json.taskId);
  await c.close();
  const mismatch = await api("POST", "/api/admin/feedback", { token: admin, body: { user_id: A.id, task_id: otherTask.json.taskId, feedback: "should fail" } });
  assert.equal(mismatch.status, 400, "feedback must not be attached to a task the student is not assigned");

  // Task-wise feedback listing
  const list = await api("GET", "/api/admin/feedback/tasks", { token: admin });
  assert.equal(list.status, 200);
  const mine = list.json.entries.filter((e) => e.student_id === A.id);
  assert.equal(mine.length, 2, "A should have exactly 2 feedback entries");
  const linked = mine.find((e) => e.task_id === task1);
  assert.ok(linked, "task-linked entry present");
  assert.equal(linked.task_title, `${TAG} task one`);
  assert.equal(linked.feedback, "Strong structure");
  assert.equal(linked.score, 9);
  assert.ok(linked.created_at);
  assert.equal(linked.task_missing, false);
  const unassigned = mine.find((e) => !e.task_id);
  assert.ok(unassigned, "legacy/general entry preserved with null task_id");
  assert.equal(unassigned.task_title, null);

  // B never sees A's feedback
  const bEntries = list.json.entries.filter((e) => e.student_id === B.id);
  assert.equal(bEntries.length, 0, "B must have no feedback entries");

  // Feedback endpoints are role-protected
  const anon = await api("GET", "/api/admin/feedback/tasks");
  assert.equal(anon.status, 401);
  const asStudent = await api("GET", "/api/admin/feedback/tasks", { token: A.token });
  assert.equal(asStudent.status, 403);
});