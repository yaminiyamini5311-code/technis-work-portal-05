/* Issue 1 focused reproduction — CEO task assignment */
const API = "http://localhost:5000";
async function req(method, path, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, body: data };
}
(async () => {
  const ceo = await req("POST", "/api/auth/login", { body: { email: "ceo@techins.com", password: process.env.CEO_PW || "CeoTest@2026!Portal" } });
  console.log("CEO login:", ceo.status, ceo.status === 200 ? "token issued, role=" + ceo.body.user.role : JSON.stringify(ceo.body));
  const ceoToken = ceo.body?.token;

  // Create two students via admin API for assignment targets
  const admin = await req("POST", "/api/auth/login", { body: { email: "admin@techins.com", password: "Admin@123" } });
  const adminToken = admin.body?.token;
  const s1 = await req("POST", "/api/admin/students", { token: adminToken, body: { name: "Repro One", email: "repro.one@example.com", password: "Password123!", department: "edutins" } });
  const s2 = await req("POST", "/api/admin/students", { token: adminToken, body: { name: "Repro Two", email: "repro.two@example.com", password: "Password123!", department: "edutins" } });
  console.log("student1:", s1.status, s1.body?.studentId || JSON.stringify(s1.body));
  console.log("student2:", s2.status, s2.body?.studentId || JSON.stringify(s2.body));
  const studentId = s1.body?.studentId;

  console.log("\n--- 1a: payload exactly as client/admin Tasks.jsx builds it (Number() conversion) ---");
  const payload = { title: "CEO Repro Task", description: "d", domain: "edutins", priority: "medium", assigned_to: studentId ? Number(studentId) : null, program: null };
  console.log("payload:", JSON.stringify(payload));
  const r1 = await req("POST", "/api/tasks", { token: ceoToken, body: payload });
  console.log("status:", r1.status, "response:", JSON.stringify(r1.body));

  console.log("\n--- 1b: same but assigned_to kept as string ---");
  const r2 = await req("POST", "/api/tasks", { token: ceoToken, body: { ...payload, assigned_to: studentId } });
  console.log("status:", r2.status, "response:", JSON.stringify(r2.body));

  console.log("\n--- 1c: program assignment 'techins 60' ---");
  const r3 = await req("POST", "/api/tasks", { token: ceoToken, body: { title: "Program Repro", description: "d", domain: "edutins", program: "techins 60" } });
  console.log("status:", r3.status, "response:", JSON.stringify(r3.body));

  console.log("\n--- 1d: student sees own tasks (GET /api/tasks/my) ---");
  const stuLogin = await req("POST", "/api/auth/login", { body: { email: "repro.one@example.com", password: "Password123!" } });
  const stuToken = stuLogin.body?.token;
  const my = await req("GET", "/api/tasks/my", { token: stuToken });
  console.log("status:", my.status, "task count:", (my.body?.tasks || []).length);
  console.log("tasks:", JSON.stringify((my.body?.tasks || []).map(t => ({ id: t.id, title: t.title, assigned_to: t.assigned_to })), null, 1));

  console.log("\n--- 1e: tasks query param target check: batch-assigned visibility ---");
  console.log("(no batch concept exists — program task was materialized per student only if users.program matched)");
  const count = await (await fetch(API + "/api/tasks", { headers: { Authorization: "Bearer " + ceoToken } })).json();
  console.log("total tasks visible to CEO:", (count.tasks || []).length);
})();
