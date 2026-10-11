const API = "http://localhost:5000";
async function req(m, p, { token, body } = {}) {
  const h = { "Content-Type": "application/json" };
  if (token) h.Authorization = "Bearer " + token;
  const r = await fetch(API + p, { method: m, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, body: d };
}
const PW = "Password123!";
const stamp = Date.now();
(async () => {
  const b = await req("GET", "/api/batches");
  const T60 = b.body.batches.find(x => x.name === "Techins 60");
  const UNLOCK = b.body.batches.find(x => x.name === "Unlock");
  console.log("[1] six names present:", ["AI Ally","Concept to Carrier","Foundation X","Life Wise","Techins 60","Unlock"]
    .every(n => b.body.batches.some(x => x.name === n)));

  const admin = await req("POST", "/api/auth/login", { body: { email: "admin@techins.com", password: "Admin@123" } });
  const ceo   = await req("POST", "/api/auth/login", { body: { email: "ceo@techins.com", password: "CeoTest@2026!Portal" } });

  // Two students: one in Techins 60, one in Unlock
  const sA = await req("POST", "/api/auth/signup", { body: { name: "Batch A Student", email: `ba.${stamp}@example.com`, password: PW, role: "student", phone: "1", batchId: T60.id } });
  const sB = await req("POST", "/api/auth/signup", { body: { name: "Batch B Student", email: `bb.${stamp}@example.com`, password: PW, role: "student", phone: "2", batchId: UNLOCK.id } });
  console.log("[2] signup Techins 60 ->", sA.status, "| signup Unlock ->", sB.status);

  // missing / invalid batch -> 400
  const noBatch = await req("POST", "/api/auth/signup", { body: { name: "X", email: `x.${stamp}@example.com`, password: PW, role: "student" } });
  const badBatch = await req("POST", "/api/auth/signup", { body: { name: "X", email: `y.${stamp}@example.com`, password: PW, role: "student", batchId: "000000000000000000000000" } });
  console.log("[3] signup no batch ->", noBatch.status, JSON.stringify(noBatch.body).slice(0,80));
  console.log("    signup bad batch ->", badBatch.status, JSON.stringify(badBatch.body).slice(0,80));

  // both students share the SAME Techins 60 record? (check two Techins60 students)
  const sA2 = await req("POST", "/api/auth/signup", { body: { name: "Batch A2", email: `ba2.${stamp}@example.com`, password: PW, role: "student", phone: "3", batchId: T60.id } });
  const { MongoClient } = require("mongodb");
  const c = new MongoClient("mongodb://127.0.0.1:27017"); await c.connect();
  const db = c.db("techins");
  const a1 = await db.collection("users").findOne({ email: `ba.${stamp}@example.com` });
  const a2 = await db.collection("users").findOne({ email: `ba2.${stamp}@example.com` });
  console.log("[4] two Techins60 students share one batch record:", a1.batch_id === a2.batch_id, `(${a1.batch_id})`);

  // approve registrations
  for (const id of [sA.body.userId, sA2.body.userId, sB.body.userId]) {
    await req("POST", `/api/admin/approve-registration/${id}`, { token: admin.body.token });
  }

  const tokA = (await req("POST", "/api/auth/login", { body: { email: `ba.${stamp}@example.com`, password: PW } })).body.token;
  const tokB = (await req("POST", "/api/auth/login", { body: { email: `bb.${stamp}@example.com`, password: PW } })).body.token;

  // /me carries the batch
  const meA = await req("GET", "/api/auth/me", { token: tokA });
  console.log("[5] /me batch for A ->", JSON.stringify(meA.body.user.batch));

  // CEO assigns a task to Techins 60 by ID
  const task = await req("POST", "/api/tasks", { token: ceo.body.token, body: {
    title: `Isolation ${stamp}`, description: "v", priority: "medium", domain: "edutins",
    target_type: "batch", batch_id: T60.id } });
  console.log("[6] CEO assign to batch ->", task.status, "| taskId:", task.body.taskId);
  const taskId = task.body.taskId;

  // A (in batch) sees it
  const myA = await req("GET", "/api/tasks/my", { token: tokA });
  console.log("[7] A (Techins 60) sees task:", (myA.body.tasks || []).some(x => x.id === taskId));

  // B (other batch) must NOT see it, and direct access denied
  const myB = await req("GET", "/api/tasks/my", { token: tokB });
  console.log("[8] B (Unlock) sees task:", (myB.body.tasks || []).some(x => x.id === taskId), "(expected false)");
  const direct = await req("GET", `/api/tasks/${taskId}`, { token: tokB });
  console.log("    B direct GET ->", direct.status, JSON.stringify(direct.body).slice(0,90));

  // A submits; B unaffected
  const subA = await req("POST", `/api/tasks/${taskId}/submit`, { token: tokA, body: { comment: "A done" } });
  console.log("[9] A submits ->", subA.status);
  const asg = await req("GET", `/api/tasks/${taskId}/assignments`, { token: admin.body.token });
  const bUser = await db.collection("users").findOne({ email: `bb.${stamp}@example.com` });
  const rowA = (asg.body.assignments || []).find(x => x.student_id === a1._id.toString());
  const rowB = (asg.body.assignments || []).find(x => x.student_id === bUser._id.toString());
  console.log("    A assignment status:", rowA?.status, "| B assignment present:", Boolean(rowB), "(B was never assigned)");

  // duplicate submission attempt -> same task, no dupes
  const dup = await req("POST", "/api/tasks", { token: ceo.body.token, body: {
    title: `Isolation ${stamp}`, description: "v", priority: "medium", domain: "edutins",
    target_type: "batch", batch_id: T60.id } });
  const rows = (await req("GET", `/api/tasks/${task.body.taskId}/assignments`, { token: admin.body.token })).body.assignments || [];
  const ids = rows.map(x => x.student_id);
  console.log("[10] repeat assign ->", dup.status, "(new task created; per-task assignment rows unique:",
              ids.length === new Set(ids).size, "count:", ids.length, ")");

  await c.close();
})();