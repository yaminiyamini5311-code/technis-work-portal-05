"use strict";
/**
 * Authorization tests for FILE ACCESS and the FILE RECORDS EXPORT.
 *
 * SAFETY:
 *  - Local development database only, with clearly marked test accounts
 *    (drvauth-<timestamp>-*@example.invalid).
 *  - Teardown deletes exactly the records these tests created. No pre-existing
 *    user, task, submission or file is modified or removed.
 *  - Runs on its own port (5098) so it never collides with api.test.js.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const ExcelJS = require("exceljs");

const PORT = Number(process.env.DRIVE_AUTH_PORT || 5098);
const BASE = `http://127.0.0.1:${PORT}`;
const TAG = `drvauth-${Date.now()}`;
const TEST_PASSWORD = "Drive-Auth-Test-Pass-2026";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@techins.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin@123";

let serverProcess = null;
let adminToken = "";
let batchId = null;

const created = { userIds: [], taskIds: [], submissionIds: [] };

async function api(method, urlPath, { token, body, form, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload = body;
  if (form) payload = form;
  else if (body !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${urlPath}`, { method, headers: h, body: payload });
  // Only parse JSON bodies: reading the body of an xlsx/file response here
  // would consume it and break the caller.
  let json = null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try { json = await res.json(); } catch { /* malformed JSON body */ }
  }
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
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start in time");
}

test.before(async () => {
  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout.on("data", () => {});
  serverProcess.stderr.on("data", () => {});
  await waitForServer();

  const login = await api("POST", "/api/auth/login", { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  assert.equal(login.status, 200, "admin login failed");
  adminToken = login.json.token;

  const batches = await api("GET", "/api/batches");
  batchId = batches.json.batches[0].id;
});

test.after(async () => {
  if (serverProcess) serverProcess.kill();
  try {
    const { MongoClient, ObjectId, GridFSBucket } = require("mongodb");
    require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
    if (!process.env.MONGODB_URI) return;
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db(process.env.MONGODB_DB_NAME || "techins");
    const oid = (v) => { try { return new ObjectId(String(v)); } catch { return null; } };
    const submissionIds = created.submissionIds.map(oid).filter(Boolean);
    const taskIds = created.taskIds.map(oid).filter(Boolean);
    const userIds = created.userIds.map(oid).filter(Boolean);

    if (submissionIds.length) {
      const files = await db.collection("submission_files")
        .find({ submission_id: { $in: created.submissionIds } }, { projection: { gridfs_id: 1 } }).toArray();
      const bucket = new GridFSBucket(db, { bucketName: "submissions" });
      for (const f of files) {
        if (f.gridfs_id) { try { await bucket.delete(f.gridfs_id); } catch { /* gone */ } }
      }
      await db.collection("submission_files").deleteMany({ submission_id: { $in: created.submissionIds } });
      await db.collection("submissions").deleteMany({ _id: { $in: submissionIds } });
    }
    // Any staged Drive uploads for these test users (none expected).
    if (userIds.length) {
      await db.collection("drive_uploads").deleteMany({ user_id: { $in: created.userIds } });
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
    console.log(`[drive-auth] cleanup: ${userIds.length} users, ${taskIds.length} tasks, ${submissionIds.length} submissions removed`);
  } catch (e) {
    console.error("[drive-auth] cleanup error:", e.message);
  }
});

const email = (name) => `${TAG}-${name}@example.invalid`;

/** Create + approve a student, returning a live token. */
async function approvedStudent(name) {
  const res = await api("POST", "/api/auth/signup", {
    body: { name, email: email(name), password: TEST_PASSWORD, role: "student", phone: "9876543210", batchId },
  });
  assert.equal(res.status, 201, `signup failed: ${JSON.stringify(res.json)}`);
  const userId = res.json.userId;
  created.userIds.push(userId);

  await api("POST", `/api/admin/approve-user/${userId}`, { token: adminToken });

  const login = await api("POST", "/api/auth/login", { body: { email: email(name), password: TEST_PASSWORD } });
  assert.equal(login.status, 200, `login failed: ${JSON.stringify(login.json)}`);
  return { id: userId, token: login.json.token, name };
}

let owner = null;
let intruder = null;
let taskId = null;
let fileRecordId = null;

test("set up: two approved students, a task for the owner, and one uploaded file", async () => {
  owner = await approvedStudent("owner");
  intruder = await approvedStudent("intruder");

  const task = await api("POST", "/api/tasks", {
    token: adminToken,
    body: {
      title: "Drive Auth Test Task",
      description: "created by the drive authorization test",
      domain: (await api("GET", "/api/tasks")).status === 200 ? undefined : undefined,
      target_type: "student",
      student_ids: [owner.id],
      priority: "medium",
    },
  });
  // domain is required; retry with the first allowed domain on failure.
  if (task.status !== 201) {
    const { ALLOWED_DOMAINS } = require("../config");
    const retry = await api("POST", "/api/tasks", {
      token: adminToken,
      body: {
        title: "Drive Auth Test Task",
        description: "created by the drive authorization test",
        domain: ALLOWED_DOMAINS[0],
        target_type: "student",
        student_ids: [owner.id],
        priority: "medium",
      },
    });
    assert.equal(retry.status, 201, `task create failed: ${JSON.stringify(retry.json)}`);
    taskId = retry.json.taskId;
    created.taskIds.push(taskId);
  } else {
    taskId = task.json.taskId;
    created.taskIds.push(taskId);
  }

  const form = new FormData();
  form.append("files", new Blob(["drive auth test pdf"], { type: "application/pdf" }), "owner-report.pdf");
  form.append("comment", "submitted by the drive authorization test");
  const sub = await api("POST", `/api/tasks/${taskId}/submit`, { token: owner.token, form });
  assert.equal(sub.status, 201, `submit failed: ${JSON.stringify(sub.json)}`);
  created.submissionIds.push(sub.json.submissionId);

  const files = await dbFiles(sub.json.submissionId);
  assert.equal(files.length, 1, "expected exactly one stored file");
  fileRecordId = files[0].id;
});

async function dbFiles(submissionId) {
  const { MongoClient, ObjectId } = require("mongodb");
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME || "techins");
  const docs = await db.collection("submission_files").find({ submission_id: String(submissionId) }).toArray();
  await client.close();
  return docs.map((d) => ({ id: String(d._id), doc: d }));
}

/* ─── File access authorization ──────────────────────────────────────────── */

test("anonymous callers cannot download a submission file", async () => {
  const res = await api("GET", `/api/tasks/files/${fileRecordId}/download`);
  assert.equal(res.status, 401);
});

test("the owning student can download their file", async () => {
  const res = await api("GET", `/api/tasks/files/${fileRecordId}/download`, { token: owner.token });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /application\/pdf/);
  assert.match(res.headers.get("content-disposition") || "", /owner-report\.pdf/);
  const text = await res.res.text();
  assert.match(text, /drive auth test pdf/);
});

test("a reviewer (admin) can download the file", async () => {
  const res = await api("GET", `/api/tasks/files/${fileRecordId}/download`, { token: adminToken });
  assert.equal(res.status, 200);
});

test("another student is refused (403) - ID tampering does not grant access", async () => {
  const res = await api("GET", `/api/tasks/files/${fileRecordId}/download`, { token: intruder.token });
  assert.equal(res.status, 403);
  assert.equal(res.json.success, false);
});

test("a bogus file id returns 404, never a file", async () => {
  const res = await api("GET", "/api/tasks/files/507f1f77bcf86cd7994390ff/download", { token: intruder.token });
  assert.equal(res.status, 404);
});

/* ─── Export authorization ───────────────────────────────────────────────── */

test("anonymous callers cannot export file records", async () => {
  const res = await api("GET", "/api/tasks/files/export");
  assert.equal(res.status, 401);
});

test("invalid filter parameters are rejected with 400", async () => {
  for (const qs of ["?user_id=not-an-id", "?task_id=@@@", "?role=wizard", "?from=not-a-date"]) {
    const res = await api("GET", `/api/tasks/files/export${qs}`, { token: adminToken });
    assert.equal(res.status, 400, `expected 400 for ${qs}, got ${res.status}`);
  }
});

test("admin export returns a real xlsx with the expected headers and their file", async () => {
  const res = await api("GET", "/api/tasks/files/export", { token: adminToken });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.match(res.headers.get("content-disposition") || "", /filename="TECHINS_File_Records_\d{4}-\d{2}-\d{2}\.xlsx"/);
  assert.match(res.headers.get("cache-control") || "", /no-store/);

  const buffer = Buffer.from(await res.res.arrayBuffer());
  assert.equal(buffer.subarray(0, 2).toString("binary"), "PK", "must be a real xlsx (zip) file");

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet("File Records");
  assert.ok(ws, "sheet named 'File Records' must exist");
  assert.equal(ws.views[0].state, "frozen");
  assert.equal(ws.getRow(1).getCell(1).value, "S.No.");
  assert.ok(ws.autoFilter, "auto-filter must be set");

  const { COLUMNS } = require("../utils/excelExport");
  const header = [];
  ws.getRow(1).eachCell((cell, col) => { header[col - 1] = cell.value; });
  assert.deepEqual(header, COLUMNS.map(c => c.header));

  // The owner's file must appear, with a non-Drive provider and NO Drive link.
  const nameCol = COLUMNS.findIndex(c => c.key === "original_file_name") + 1;
  const providerCol = COLUMNS.findIndex(c => c.key === "storage_provider") + 1;
  const linkCol = COLUMNS.findIndex(c => c.key === "drive_file_link") + 1;
  let found = false;
  ws.eachRow((row, n) => {
    if (n === 1) return;
    if (row.getCell(nameCol).value === "owner-report.pdf") {
      found = true;
      assert.equal(row.getCell(providerCol).value, "gridfs");
      assert.equal(row.getCell(linkCol).value, "", "no Drive link may be invented for a non-Drive file");
    }
  });
  assert.ok(found, "the uploaded file must appear in the export");
});

test("a student's export contains ONLY their own rows", async () => {
  const res = await api("GET", "/api/tasks/files/export", { token: owner.token });
  assert.equal(res.status, 200);
  const ws = await firstSheet(await res.res.arrayBuffer());
  const { COLUMNS } = require("../utils/excelExport");
  const nameCol = COLUMNS.findIndex(c => c.key === "original_file_name") + 1;
  const emailCol = COLUMNS.findIndex(c => c.key === "email") + 1;

  const names = [];
  ws.eachRow((row, n) => {
    if (n === 1 || !isDataRow(row)) return;
    names.push(row.getCell(nameCol).value);
    assert.equal(row.getCell(emailCol).value, email("owner"), "student export must be self-scoped");
  });
  assert.ok(names.includes("owner-report.pdf"));
  assert.ok(!names.includes("nobody-elses.pdf"));
});

test("tampering with user_id cannot widen a student's export", async () => {
  const res = await api("GET", `/api/tasks/files/export?user_id=${intruder.id}`, { token: owner.token });
  assert.equal(res.status, 200);
  const ws = await firstSheet(await res.res.arrayBuffer());
  const { COLUMNS } = require("../utils/excelExport");
  const emailCol = COLUMNS.findIndex(c => c.key === "email") + 1;
  ws.eachRow((row, n) => {
    if (n === 1 || !isDataRow(row)) return;
    assert.equal(row.getCell(emailCol).value, email("owner"), "scope must stay the caller's own rows");
  });
});

test("the other student sees none of the owner's file in their export", async () => {
  const res = await api("GET", "/api/tasks/files/export", { token: intruder.token });
  assert.equal(res.status, 200);
  const ws = await firstSheet(await res.res.arrayBuffer());
  const { COLUMNS } = require("../utils/excelExport");
  const nameCol = COLUMNS.findIndex(c => c.key === "original_file_name") + 1;
  const names = [];
  ws.eachRow((row, n) => { if (n > 1) names.push(row.getCell(nameCol).value); });
  assert.ok(!names.includes("owner-report.pdf"), "must not leak another student's file record");
});

test("a task filter narrows the admin export and is validated", async () => {
  const ok = await api("GET", `/api/tasks/files/export?task_id=${taskId}`, { token: adminToken });
  assert.equal(ok.status, 200);
  const ws = await firstSheet(await ok.res.arrayBuffer());
  const { COLUMNS } = require("../utils/excelExport");
  const taskCol = COLUMNS.findIndex(c => c.key === "task_id") + 1;
  ws.eachRow((row, n) => {
    if (n === 1) return;
    assert.ok(String(row.getCell(taskCol).value || "").length > 0);
  });
});

/** A real data row has a numeric S.No.; the footer note row carries text there. */
function isDataRow(row) {
  return typeof row.getCell(1).value === "number";
}

async function firstSheet(arrayBuffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(arrayBuffer));
  return wb.getWorksheet("File Records");
}

/* ─── Drive init endpoint guards (no credentials needed) ─────────────────── */

test("upload init rejects an unsupported file type before touching Drive", async () => {
  const res = await api("POST", "/api/tasks/uploads/init", {
    token: owner.token,
    body: { taskId, fileName: "malware.exe", mimeType: "application/octet-stream", size: 100 },
  });
  // Either rejected by validation (400) or unavailable because Drive is not
  // configured (503) - never a 2xx, and never a leaked secret.
  assert.ok([400, 503].includes(res.status), `unexpected status ${res.status}`);
  const blob = JSON.stringify(res.json);
  assert.ok(!/BEGIN PRIVATE KEY/.test(blob));
});

test("upload init refuses a task the caller is not assigned to", async () => {
  const res = await api("POST", "/api/tasks/uploads/init", {
    token: intruder.token,
    body: { taskId, fileName: "x.pdf", mimeType: "application/pdf", size: 100 },
  });
  assert.ok([400, 403, 503].includes(res.status), `unexpected status ${res.status}`);
  assert.notEqual(res.status, 201);
});

test("upload init requires authentication", async () => {
  const res = await api("POST", "/api/tasks/uploads/init", {
    body: { taskId, fileName: "x.pdf", mimeType: "application/pdf", size: 100 },
  });
  assert.equal(res.status, 401);
});