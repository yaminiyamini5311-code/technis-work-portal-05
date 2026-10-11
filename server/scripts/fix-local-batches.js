/**
 * LOCAL-ONLY: rename batch "Techis60" -> "Techins 60" (in place, no duplicate),
 * and remove the test batches created during reproduction.
 *
 * Safety:
 *  - Refuses to run unless MONGODB_URI points at localhost (production guard).
 *  - Renames the EXISTING record; never inserts a second batch.
 *  - Only deletes a test batch when it has 0 tasks and 0 task_assignments.
 *  - Deleting a test batch also removes the test users that referenced it,
 *    so no dangling batch_id is left behind.
 *  - Run with --dry-run to preview.
 *
 * Backup must already exist (see scripts/audit-batches.js).
 */
const { MongoClient } = require("mongodb");

const MONGODB_URI = (process.env.MONGODB_URI || "mongodb://127.0.0.1:27017").trim();
const DB_NAME = (process.env.MONGODB_DB_NAME || "techins").trim();
const DRY_RUN = process.argv.includes("--dry-run");

const OLD_NAME = "Techis60";
const NEW_NAME = "Techins 60";
const TEST_BATCH_NAMES = [
  "Other Batch",
  "Debug Batch",
  "Other Batch 1791712229911",
  "Other Batch 1791712339207",
  "Other Batch 1791714167682",
  "Other Batch 1791715754029",
];

const norm = n => String(n || "").trim().toLowerCase();

(async () => {
  // ── Production guard ───────────────────────────────────────
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)/.test(MONGODB_URI)) {
    console.error("REFUSING TO RUN: MONGODB_URI is not a local MongoDB.");
    console.error("  This script is authorized for the LOCAL database only.");
    process.exit(1);
  }
  console.log(`Target: ${MONGODB_URI} / ${DB_NAME}   dry-run=${DRY_RUN}\n`);

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  // ── 1. RENAME (in place) ────────────────────────────────────
  const existing = await db.collection("batches").findOne({ name: OLD_NAME });
  if (!existing) {
    console.log(`[rename] no batch named "${OLD_NAME}" found — nothing to rename.`);
  } else {
    const clash = await db.collection("batches").findOne({ name: NEW_NAME });
    if (clash) {
      // Merge rather than duplicate: repoint references, drop the old record.
      console.log(`[rename] "${NEW_NAME}" already exists (${clash._id}); merging into it.`);
      if (!DRY_RUN) {
        await db.collection("users").updateMany(
          { batch_id: String(existing._id) },
          { $set: { batch_id: String(clash._id), program: NEW_NAME } }
        );
        await db.collection("tasks").updateMany(
          { batch_id: String(existing._id) },
          { $set: { batch_id: String(clash._id) } }
        );
        await db.collection("batches").deleteOne({ _id: existing._id });
      }
      console.log(`[rename] merged ${OLD_NAME} -> ${NEW_NAME} (no duplicate created)`);
    } else {
      console.log(`[rename] ${OLD_NAME} (${existing._id}) -> "${NEW_NAME}" (same record)`);
      if (!DRY_RUN) {
        const r = await db.collection("batches").updateOne(
          { _id: existing._id },
          { $set: { name: NEW_NAME } }
        );
        console.log(`[rename] modifiedCount=${r.modifiedCount}`);
        // Keep users.program consistent with the canonical batch name
        const u = await db.collection("users").updateMany(
          { batch_id: String(existing._id), program: OLD_NAME },
          { $set: { program: NEW_NAME.toLowerCase() } }
        );
        console.log(`[rename] users.program normalized for ${u.modifiedCount} user(s)`);
      }
    }
  }

  // ── 2. DELETE TEST BATCHES (local only, guarded) ────────────
  for (const name of TEST_BATCH_NAMES) {
    const b = await db.collection("batches").findOne({ name });
    if (!b) { console.log(`[delete] "${name}" not found — skip`); continue; }
    const id = String(b._id);

    const taskCount = await db.collection("tasks").countDocuments({ batch_id: id });
    const assignCount = await db.collection("task_assignments").countDocuments({
      task_id: { $in: (await db.collection("tasks").find({ batch_id: id }).toArray()).map(t => String(t._id)) }
    });
    const users = await db.collection("users").find({ batch_id: id }, { projection: { email: 1 } }).toArray();

    console.log(`\n[delete] "${name}" (${id})`);
    console.log(`   tasks=${taskCount} assignments=${assignCount} users=${users.length}`);
    users.forEach(u => console.log(`     user: ${u.email}`));

    if (taskCount > 0 || assignCount > 0) {
      console.log(`   SKIPPED: batch has related records — not deleting.`);
      continue;
    }
    if (DRY_RUN) { console.log(`   would delete (dry-run)`); continue; }

    // Remove the test users that referenced it, so no dangling batch_id remains
    if (users.length) {
      const emails = users.map(u => u.email);
      const du = await db.collection("users").deleteMany({ email: { $in: emails } });
      console.log(`   removed ${du.deletedCount} test user(s): ${emails.join(", ")}`);
    }
    const dr = await db.collection("batches").deleteOne({ _id: b._id });
    console.log(`   deleted batch (deletedCount=${dr.deletedCount})`);
  }

  // ── 3. Final state ─────────────────────────────────────────
  const finalBatches = await db.collection("batches").find({}).toArray();
  console.log("\n=== FINAL batches ===");
  finalBatches.forEach(b => console.log(`  "${b.name}"  id=${b._id}`));

  const dangling = await db.collection("users").aggregate([
    { $match: { batch_id: { $ne: null } } },
    { $lookup: { from: "batches", localField: "batch_id", foreignField: "_id", as: "b" } },
    { $match: { b: { $size: 0 } } },
    { $count: "n" }
  ]).toArray();
  console.log("users with a dangling batch_id:", dangling[0]?.n || 0);

  await client.close();
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });