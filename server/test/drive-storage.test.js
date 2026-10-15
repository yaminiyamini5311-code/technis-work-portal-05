"use strict";
/**
 * Google Drive storage integration test (mock Drive backend).
 *
 * Runs against the configured MongoDB (MONGODB_URI) with a local Drive mock
 * so the full upload / metadata / download / authorization path is exercised
 * without real Google credentials.
 *
 * Set GOOGLE_DRIVE_MOCK=true OR the test spawns the server with it enabled.
 * The test is skipped when MONGODB_URI is not configured.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = Number(process.env.DRIVE_TEST_PORT || 5098);
const BASE = `http://127.0.0.1:${PORT}`;
const TAG = `e2e-drive-${Date.now()}`;
const PASSWORD = "E2e-Drive-Pass-2026";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@techins.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin@123";

let serverProcess = null;
let serverLogs = "";
const created = { userIds: [], taskIds: [], submissionIds: [] };

async function api(method, urlPath, { token, body, form, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload = body;
  if (form) payload = form;
  else if (body !== undefined) { h["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(`${BASE}${urlPath}`, { method, headers: h, body: payload });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json, res, headers: res.headers };
}

async function waitForServer(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const health = await fetch(`${BASE}/api/health`);
      if (health.ok) {
        const db = await fetch(`${BASE}/api/batches`);
        if (db.ok) { const b = await db.json(); if (b && b.success) return; }
      }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server not healthy\n${serverLogs.slice(-1500)}`);
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
    if (sids.length) {
      await db.collection("submission_files").deleteMany({ submission_id: { $in: sids.map(String) } });
    }
    if (tids.length) {
      await db.collection("task_assignments").deleteMany({ task_id: { $in: tids.map(String) } });
      await db.collection("task_status_history").deleteMany({ task_id: { $in: tids.map(String) } });
    }
    if (sids.length) await db.collection("submissions").deleteMany({ _id: { $in: sids } });
    if (tids.length) await db.collection("tasks").deleteMany({ _id: { $in: tids } });
    if (uids.length) {
      await db.collection("users").deleteMany({ _id: { $in: uids } });
      await db.collection("drive_folders").deleteMany({ $or: [{ key: { $in: uids.flatMap((u) => [`drive:student:${u}`, `drive:student:${u}:day:1`]) } }] });
    }
    await db.collection("drive_orphans").deleteMany({ student_id: { $in: created.userIds } });
    await client.close();
  } catch (e) { console.error("cleanup failed:", e.message); }
});

test("Drive storage: upload -> metadata -> authorized download -> cross-student isolation", { skip: hasDb() ? false : "MONGODB_URI not configured" }, async () => {
  // admin session
  const login = await api("POST", "/api/auth/login", { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  assert.equal(login.status, 200, `admin login failed ${JSON.stringify(login.json)}\n${serverLogs.slice(-1200)}`);
  const adminToken = login.json.token;

  // a real active batch for signup
  const batches = await api("GET", "/api/batches");
  assert.equal(batches.status, 200);
  assert.ok(batches.json.batches.length > 0, "no active batch in test DB");
  const batchId = batches.json.batches[0].id;

  const makeStudent = async (label) => {
    const email = `${TAG}-${label}@example.invalid`;
    const signup = await api("POST", "/api/auth/signup", {
      body: { name: `Drive ${label}`, email, password: PASSWORD, role: "student", phone: "9876543210", batchId },
    });
    assert.equal(signup.status, 201, JSON.stringify(signup.json));
    created.userIds.push(signup.json.userId);
    const approve = await api("POST", `/api/admin/approve-registration/${signup.json.userId}`, { token: adminToken });
    assert.equal(approve.status, 200, JSON.stringify(approve.json));
    const l = await api("POST", "/api/auth/login", { body: { email, password: PASSWORD } });
    assert.equal(l.status, 200, JSON.stringify(l.json));
    return { id: signup.json.userId, token: l.json.token, email };
  };

  const A = await makeStudent("a");
  const B = await makeStudent("b");

  // Task assigned to both students, day 1.
  const taskRes = await api("POST", "/api/tasks", {
    token: adminToken,
    body: {
      title: `${TAG} drive task`,
      description: "Drive storage verification",
      domain: "edutins",
      target_type: "student",
      student_ids: [A.id, B.id],
      day_number: 1,
      priority: "medium",
    },
  });
  assert.equal(taskRes.status, 201, JSON.stringify(taskRes.json));
  const taskId = taskRes.json.taskId;
  created.taskIds.push(taskId);

  // A submits with a real file
  const content = Buffer.from("%PDF-1.4 drive mock submission " + TAG);
  const form = new FormData();
  form.append("comment", "A submission");
  form.append("files", new Blob([content], { type: "application/pdf" }), "a-report.pdf");
  const subA = await api("POST", `/api/tasks/${taskId}/submit`, { token: A.token, form });
  assert.equal(subA.status, 201, JSON.stringify(subA.json));
  created.submissionIds.push(subA.json.submissionId);
  assert.equal(subA.json.version, 1);

  // B submits as well -> each student gets version 1 (per-student versions)
  const formB = new FormData();
  formB.append("comment", "B submission");
  formB.append("files", new Blob([Buffer.from("%PDF-1.4 b report")], { type: "application/pdf" }), "b-report.pdf");
  const subB = await api("POST", `/api/tasks/${taskId}/submit`, { token: B.token, form: formB });
  assert.equal(subB.status, 201, JSON.stringify(subB.json));
  created.submissionIds.push(subB.json.submissionId);
  assert.equal(subB.json.version, 1, "versions must be per student");

  // Both students have their own submission status (isolation)
  const statusA = await api("GET", `/api/tasks/${taskId}/my-submission-status`, { token: A.token });
  const statusB = await api("GET", `/api/tasks/${taskId}/my-submission-status`, { token: B.token });
  assert.equal(statusA.json.has_submission, true);
  assert.equal(statusB.json.has_submission, true);
  assert.equal(statusA.json.workflow_status, "Submitted");
  assert.equal(statusB.json.workflow_status, "Submitted");

  // Admin sees both submissions with drive metadata
  const allSubs = await api("GET", `/api/tasks/submissions?task_id=${taskId}`, { token: adminToken });
  assert.equal(allSubs.status, 200);
  assert.equal(allSubs.json.submissions.length, 2);
  for (const row of allSubs.json.submissions) {
    assert.equal(row.file_count, 1, "each submission should have one file");
    const file = row.files[0];
    assert.match(file.download_url, /\/api\/tasks\/files\/.+\/download/);
  }

  // Verify MongoDB stored Drive metadata (drive_file_id + folder) — not binaries.
  const { MongoClient } = require("mongodb");
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME || "techins");
  const files = await db.collection("submission_files").find({ submission_id: { $in: created.submissionIds.map(String) } }).toArray();
  await client.close();
  assert.equal(files.length, 2);
  for (const f of files) {
    assert.ok(f.drive_file_id, "drive_file_id must be persisted");
    assert.ok(f.drive_folder_id, "parent folder id must be persisted");
    assert.equal(f.storage_type, "drive");
    assert.equal(f.buffer, undefined, "no binary should be stored");
  }
  const folders = await (async () => { const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const d = c.db(process.env.MONGODB_DB_NAME || "techins"); const r = await d.collection("drive_folders").find({ key: /^drive:student:/ }).toArray(); await c.close(); return r; })();
  assert.ok(folders.some((f) => f.key === `drive:student:${A.id}`), "student folder should be recorded");
  assert.ok(folders.some((f) => f.key === `drive:student:${A.id}:day:1`), "day folder should be recorded");

  // A downloads own file; content matches
  const fileA = files.find((f) => String(f.submission_id) === String(subA.json.submissionId));
  const rawDl = await fetch(`${BASE}/api/tasks/files/${fileA._id}/download`, { headers: { Authorization: `Bearer ${A.token}` } });
  assert.equal(rawDl.status, 200);
  const dlText = await rawDl.text();
  assert.equal(dlText, content.toString());

  // B cannot download A's file
  const fileB = files.find((f) => String(f.submission_id) === String(subB.json.submissionId));
  const cross = await api("GET", `/api/tasks/files/${fileA._id}/download`, { token: B.token });
  assert.equal(cross.status, 403, "cross-student download must be forbidden");
  const cross2 = await api("GET", `/api/tasks/files/${fileB._id}/download`, { token: A.token });
  assert.equal(cross2.status, 403);

  // Admin can download
  const adminDl = await api("GET", `/api/tasks/files/${fileA._id}/download`, { token: adminToken });
  assert.equal(adminDl.status, 200);

  // Approve only A -> only A sees Approved
  const approve = await api("POST", "/api/tasks/review", {
    token: adminToken,
    body: { submission_id: subA.json.submissionId, decision: "approve", comment: "Approved for A" },
  });
  assert.equal(approve.status, 200, JSON.stringify(approve.json));
  const afterA = await api("GET", `/api/tasks/${taskId}/my-submission-status`, { token: A.token });
  const afterB = await api("GET", `/api/tasks/${taskId}/my-submission-status`, { token: B.token });
  assert.equal(afterA.json.workflow_status, "Approved");
  assert.notEqual(afterB.json.workflow_status, "Approved", "B must NOT be marked approved");
});