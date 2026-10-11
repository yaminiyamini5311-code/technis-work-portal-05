/**
 * Phase 0 step: backup + reference audit BEFORE any rename/delete.
 * Read-only. Creates a backup of batches/users/tasks/task_assignments to JSON.
 */
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const OUT_DIR = path.join(__dirname, "..", "backup");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

function norm(n) { return String(n || "").trim().toLowerCase(); }

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const client = new MongoClient("mongodb://127.0.0.1:27017");
  await client.connect();
  const db = client.db("techins");

  // ── 1. BACKUP ──────────────────────────────────────────────
  const batches = await db.collection("batches").find({}).toArray();
  const users = await db.collection("users").find({}).toArray();
  const tasks = await db.collection("tasks").find({}).toArray();
  const assignments = await db.collection("task_assignments").find({}).toArray();

  const backupFile = path.join(OUT_DIR, `pre-rename-${STAMP}.json`);
  fs.writeFileSync(backupFile, JSON.stringify({
    backed_up_at: new Date().toISOString(),
    batches, users, tasks, task_assignments: assignments
  }, null, 2));
  console.log("BACKUP written:", backupFile);
  console.log("  batches:", batches.length, "users:", users.length,
              "tasks:", tasks.length, "task_assignments:", assignments.length);

  // ── 2. LIST EVERY REFERENCE ────────────────────────────────
  console.log("\n=== BATCHES AND THEIR REFERENCES ===");
  for (const b of batches) {
    const id = String(b._id);
    const usersInBatch = users.filter(u => String(u.batch_id || "") === id);
    const tasksInBatch = tasks.filter(t => String(t.batch_id || "") === id);
    const assignCount = assignments.filter(a =>
      tasksInBatch.some(t => String(t._id) === String(a.task_id))).length;
    const programs = [...new Set(usersInBatch.map(u => u.program).filter(Boolean))];

    console.log(`\nname="${b.name}"  id=${id}  active=${b.active}`);
    console.log(`  users.batch_id -> ${usersInBatch.length}`);
    console.log(`  tasks.batch_id -> ${tasksInBatch.length}`);
    console.log(`  task_assignments (for those tasks) -> ${assignCount}`);
    if (programs.length) console.log(`  their users.program values -> ${JSON.stringify(programs)}`);
    if (usersInBatch.length) {
      console.log(`  sample users: ${usersInBatch.slice(0, 4).map(u => u.email).join(", ")}`);
    }
  }

  // ── 3. WHERE DO THE SIX PROGRAM NAMES LIVE? ───────────────
  console.log("\n=== PROGRAM SOURCE AUDIT ===");
  const SIX = ["techins 60", "ai ally", "life wise", "foundation x", "concept to carrier", "unlock"];
  for (const p of SIX) {
    const n = users.filter(u => norm(u.program) === p).length;
    const asBatch = batches.filter(b => norm(b.name) === p).length;
    console.log(`  "${p}": users.program=${n}   batches.name=${asBatch}`);
  }
  const distinctPrograms = [...new Set(users.map(u => u.program).filter(Boolean).map(norm))];
  console.log("\n  distinct users.program values in DB:", JSON.stringify(distinctPrograms));
  console.log("  distinct batches.name values in DB:", JSON.stringify(batches.map(b => b.name)));

  await client.close();
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });