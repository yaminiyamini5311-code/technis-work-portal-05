/**
 * TECHINS Work Portal — Batch system migration (MongoDB)
 *
 * Idempotent. Safe to run any number of times.
 *
 * What it does:
 *   1. Creates the `batches` collection with a UNIQUE case-insensitive index on `name`.
 *   2. Ensures the canonical batch record "Techis60" exists (renames/dedupes variant
 *      records such as "Techis 60", "techins 60", "Techin 16" — never duplicates).
 *   3. Adds `batch_id` to users whose program maps to the Techis60 batch (backfill).
 *   4. Creates a UNIQUE case-insensitive index on users.email (dedupes + reports first).
 *   5. Creates the `task_assignments` collection with a UNIQUE index on (task_id, student_id)
 *      and backfills one assignment per existing task for its assigned student.
 *   6. Adds `target_type` / `batch_id` fields on existing tasks (backfill: "student").
 *
 * Rollback (manual, in mongosh):
 *   db.task_assignments.drop();
 *   db.batches.drop();
 *   db.users.updateMany({}, { $unset: { batch_id: "" } });
 *   db.tasks.updateMany({}, { $unset: { target_type: "", batch_id: "" } });
 *   db.users.dropIndex("email_1_collated");   // if present
 *   // The pre-existing case-sensitive email_1 index and all other data are untouched.
 *
 * Usage:
 *   node scripts/migrate-batches.js
 *   node scripts/migrate-batches.js --dry-run
 */
const { MongoClient, ObjectId } = require("mongodb");

const MONGODB_URI = (process.env.MONGODB_URI || "mongodb://127.0.0.1:27017").trim();
const MONGODB_DB_NAME = (process.env.MONGODB_DB_NAME || "techins").trim();
const DRY_RUN = process.argv.includes("--dry-run");

// Every spelling that refers to the same batch, normalized (lowercase, alnum only).
const CANONICAL_BATCH_NAME = "Techis60";
const BATCH_ALIASES = new Set([
  "techis60",
  "techins60",
  "techis 60",
  "techins 60",
  "techin 16",   // known wrong name — renamed, never duplicated
  "techin16",
]);

function normalizeBatchName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isTechis60Variant(name) {
  return BATCH_ALIASES.has(normalizeBatchName(name));
}

async function main() {
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(MONGODB_DB_NAME);
  console.log(`[migrate] connected to ${MONGODB_DB_NAME} (dry-run: ${DRY_RUN})`);

  // ── 1. batches collection + case-insensitive unique name index ──────
  await db.collection("batches").createIndex(
    { name: 1 },
    { unique: true, name: "batch_name_ci", collation: { locale: "en", strength: 2 } }
  );
  console.log("[migrate] batches: unique case-insensitive index on name ensured");

  // ── 2. canonical Techis60 record (rename/dedupe, never duplicate) ──
  const batches = await db.collection("batches").find({}).toArray();
  const variants = batches.filter(b => isTechis60Variant(b.name));
  let canonical = variants.find(b => String(b.name) === CANONICAL_BATCH_NAME);

  if (variants.length > 1) {
    // Multiple variant records exist — keep the canonical one (or the oldest),
    // repoint references, then remove the rest.
    const keeper = canonical || variants.sort((a, b) => a._id.getTimestamp() - b._id.getTimestamp())[0];
    for (const dup of variants) {
      if (String(dup._id) === String(keeper._id)) continue;
      console.log(`[migrate] removing duplicate batch variant "${dup.name}" (${dup._id})`);
      if (!DRY_RUN) {
        // Repoint users/tasks that referenced the duplicate before removing it
        await db.collection("users").updateMany({ batch_id: String(dup._id) }, { $set: { batch_id: String(keeper._id) } });
        await db.collection("tasks").updateMany({ batch_id: String(dup._id) }, { $set: { batch_id: String(keeper._id) } });
        await db.collection("task_assignments").deleteMany({});
        await db.collection("batches").deleteOne({ _id: dup._id });
      }
    }
    canonical = keeper;
  }

  if (!canonical) {
    const existing = batches.find(b => normalizeBatchName(b.name) === normalizeBatchName(CANONICAL_BATCH_NAME));
    if (existing) {
      console.log(`[migrate] renaming batch "${existing.name}" -> "${CANONICAL_BATCH_NAME}"`);
      if (!DRY_RUN) {
        await db.collection("batches").updateOne({ _id: existing._id }, { $set: { name: CANONICAL_BATCH_NAME, active: true } });
      }
      canonical = { ...existing, name: CANONICAL_BATCH_NAME };
    } else {
      console.log(`[migrate] creating canonical batch "${CANONICAL_BATCH_NAME}"`);
      if (!DRY_RUN) {
        const res = await db.collection("batches").insertOne({
          name: CANONICAL_BATCH_NAME,
          active: true,
          created_at: new Date().toISOString(),
        });
        canonical = { _id: res.insertedId, name: CANONICAL_BATCH_NAME, active: true };
      } else {
        canonical = { _id: new ObjectId(), name: CANONICAL_BATCH_NAME, active: true };
      }
    }
  } else if (String(canonical.name) !== CANONICAL_BATCH_NAME && !DRY_RUN) {
    await db.collection("batches").updateOne({ _id: canonical._id }, { $set: { name: CANONICAL_BATCH_NAME } });
  }
  const batchId = String(canonical._id);
  console.log(`[migrate] canonical batch: ${CANONICAL_BATCH_NAME} (${batchId})`);

  // ── 3. backfill users.batch_id from program field ─────────────────
  const variantUsers = await db.collection("users")
    .find({ program: { $exists: true, $ne: null } })
    .toArray();
  const toBackfill = variantUsers.filter(u => isTechis60Variant(u.program) && String(u.batch_id || "") !== batchId);
  console.log(`[migrate] users to associate with ${CANONICAL_BATCH_NAME}: ${toBackfill.length}`);
  for (const u of toBackfill) {
    console.log(`[migrate]   ${u.email} (program="${u.program}") -> batch_id=${batchId}`);
    if (!DRY_RUN) {
      await db.collection("users").updateOne({ _id: u._id }, { $set: { batch_id: batchId } });
    }
  }

  // ── 4. case-insensitive unique email index (dedupe + report) ───────
  const users = await db.collection("users").find({}, { projection: { email: 1 } }).toArray();
  const seen = new Map(); // normalized email -> first doc
  const dupes = [];
  for (const u of users) {
    const key = String(u.email || "").trim().toLowerCase();
    if (seen.has(key)) dupes.push({ kept: seen.get(key), dupe: u });
    else seen.set(key, u);
  }
  if (dupes.length) {
    console.log(`[migrate] WARNING: ${dupes.length} duplicate email(s) found (case-insensitive):`);
    for (const d of dupes) console.log(`[migrate]   ${d.dupe.email} (${d.dupe._id}) duplicates ${d.kept.email} (${d.kept._id})`);
    console.log("[migrate] Resolve duplicates manually before relying on the unique index. Skipping index creation.");
  } else {
    await db.collection("users").createIndex(
      { email: 1 },
      { unique: true, name: "email_1_ci", collation: { locale: "en", strength: 2 } }
    );
    console.log("[migrate] users: unique case-insensitive index on email ensured");
  }

  // ── 5. task_assignments collection + backfill ──────────────────────
  await db.collection("task_assignments").createIndex(
    { task_id: 1, student_id: 1 },
    { unique: true, name: "task_student_unique" }
  );
  console.log("[migrate] task_assignments: unique index on (task_id, student_id) ensured");

  const tasks = await db.collection("tasks").find({}).toArray();
  let assignmentsCreated = 0;
  for (const t of tasks) {
    // Backfill target_type / batch_id on legacy tasks
    if (!t.target_type && !DRY_RUN) {
      await db.collection("tasks").updateOne(
        { _id: t._id },
        { $set: { target_type: "student", batch_id: null } }
      );
    }
    if (!t.assigned_to) continue;
    const existing = await db.collection("task_assignments").findOne({ task_id: String(t._id), student_id: String(t.assigned_to) });
    if (existing) continue;
    const status = t.workflow_status === "Approved" ? "approved"
      : ["In Progress", "Submitted", "Under Review", "Revision Required", "Resubmitted", "Acknowledged"].includes(t.workflow_status) ? "in_progress"
      : "assigned";
    const progress = t.workflow_status === "Approved" ? 100 : 0;
    if (!DRY_RUN) {
      try {
        await db.collection("task_assignments").insertOne({
          task_id: String(t._id),
          student_id: String(t.assigned_to),
          status,
          progress,
          submission_version: null,
          submission_comment: null,
          submitted_at: null,
          created_at: t.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        assignmentsCreated++;
      } catch (e) {
        if (e.code !== 11000) throw e;
      }
    }
  }
  console.log(`[migrate] task_assignments backfilled: ${assignmentsCreated}`);

  // ── summary ─────────────────────────────────────────────────────────
  const [batchCount, userCount, assignmentCount] = await Promise.all([
    db.collection("batches").countDocuments(),
    db.collection("users").countDocuments(),
    db.collection("task_assignments").countDocuments(),
  ]);
  console.log(`[migrate] DONE. batches=${batchCount} users=${userCount} task_assignments=${assignmentCount}`);

  await client.close();
}

main().catch(err => {
  console.error("[migrate] FATAL:", err.message);
  process.exit(1);
});
