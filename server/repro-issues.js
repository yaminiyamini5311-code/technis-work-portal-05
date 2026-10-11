/* Phase 0 reproduction script — exercises the five production issues via the real API.
   Prints request payloads, HTTP status, and response bodies as evidence. */
const API = "http://localhost:5000";

function log(title) { console.log("\n" + "=".repeat(72) + "\n" + title + "\n" + "=".repeat(72)); }

async function req(method, path, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(API + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  const text = await res.text();
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, body: data };
}

(async () => {
  // ── CEO login (local test password) ──────────────────────────────
  log("CEO LOGIN (ceo@techins.com)");
  const ceoLogin = await req("POST", "/api/auth/login", {
    body: { email: "ceo@techins.com", password: process.env.CEO_PW || "CeoTest@2026!Portal" },
  });
  console.log("status:", ceoLogin.status);
  console.log("body:", JSON.stringify(ceoLogin.body).slice(0, 300));
  const ceoToken = ceoLogin.body?.token;

  // ── Admin login ────────────────────────────────────────────────
  const adminLogin = await req("POST", "/api/auth/login", {
    body: { email: "admin@techins.com", password: "Admin@123" },
  });
  const adminToken = adminLogin.body?.token;
  console.log("\nAdmin login status:", adminLogin.status);

  // ── ISSUE 1: CEO task assignment to an individual student ──────
  log("ISSUE 1 — CEO assigns task to one student (payload exactly as admin/Tasks.jsx builds it)");
  // The frontend does: assigned_to: student ? Number(student) : null
  // student ids are ObjectId strings, so Number(...) === NaN -> JSON null
  const fakeStudentId = "6acb4f0276018d1b9417e7bb"; // admin id, stands in for a student ObjectId
  const frontendPayload = {
    title: "Repro task 1",
    description: "CEO task repro",
    priority: "medium",
    domain: "edutins",
    assigned_to: Number(fakeStudentId), // <- what Tasks.jsx sends
    program: null,
  };
  console.log("request payload:", JSON.stringify(frontendPayload));
  const r1 = await req("POST", "/api/tasks", { token: ceoToken, body: frontendPayload });
  console.log("status:", r1.status);
  console.log("response:", JSON.stringify(r1.body));

  log("ISSUE 1b — CEO assigns task with correct string assigned_to");
  const r1b = await req("POST", "/api/tasks", {
    token: ceoToken,
    body: { ...frontendPayload, assigned_to: fakeStudentId },
  });
  console.log("status:", r1b.status);
  console.log("response:", JSON.stringify(r1b.body));

  log("ISSUE 1c — CEO assigns task to program 'techins 60' (batch-like)");
  const r1c = await req("POST", "/api/tasks", {
    token: ceoToken,
    body: { title: "Repro program task", description: "x", domain: "edutins", program: "techins 60" },
  });
  console.log("status:", r1c.status);
  console.log("response:", JSON.stringify(r1c.body));

  // ── ISSUE 2: public batches endpoint ─────────────────────────────
  log("ISSUE 2 — GET /api/batches (public)");
  const r2 = await req("GET", "/api/batches");
  console.log("status:", r2.status);
  console.log("response:", JSON.stringify(r2.body));

  // ── ISSUE 2/3: signup carries no batch ──────────────────────────
  log("ISSUE 2/3 — public signup payload has no batch field at all");
  const r3 = await req("POST", "/api/auth/signup", {
    body: { name: "Batch Tester", email: "batch.tester@example.com", password: "Password123!", role: "student", phone: "123" },
  });
  console.log("status:", r3.status);
  console.log("response:", JSON.stringify(r3.body));

  // ── ISSUE 4: student management surface ─────────────────────────
  log("ISSUE 4 — admin student management endpoints");
  for (const [m, p] of [
    ["GET", "/api/admin/students?search=abc"],
    ["GET", "/api/admin/students?batch=techins60"],
    ["PUT", "/api/admin/students/someid"],
    ["PATCH", "/api/admin/students/someid/batch"],
    ["PATCH", "/api/admin/students/someid/deactivate"],
    ["DELETE", "/api/admin/students/someid"],
  ]) {
    const r = await req(m, p, { token: adminToken, body: m === "GET" ? undefined : {} });
    console.log(`${m} ${p} -> ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  }

  // ── ISSUE 5: auth persistence probes ────────────────────────────
  log("ISSUE 5 — /me with an expired/invalid token");
  const r5 = await req("GET", "/api/auth/me", { token: "eyJhbGciOiJIUzI1NiJ9.e30.faketoken" });
  console.log("status:", r5.status, "body:", JSON.stringify(r5.body));

  log("ISSUE 5 — login rate limit probe (25 rapid attempts)");
  const codes = [];
  for (let i = 0; i < 25; i++) {
    const r = await req("POST", "/api/auth/login", { body: { email: "nope@example.com", password: "wrong" } });
    codes.push(r.status);
  }
  console.log("status codes:", codes.join(","));
})();
