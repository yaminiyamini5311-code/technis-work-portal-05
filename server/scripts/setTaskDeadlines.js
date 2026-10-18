/**
 * Migration script: set all task deadlines to Sunday, 18 October 2026 (IST end-of-day)
 * 
 * IST (Asia/Kolkata) = UTC+5:30
 * 2026-10-18 23:59:59 IST = 2026-10-18T18:29:59.000Z
 * 
 * Usage:
   --dry-run : print what would change, do not modify DB
   --apply   : actually update the database
 * 
 * Running twice is idempotent: second run makes no changes.
 */

const { MongoClient } = require("mongodb");

const URI = "mongodb://localhost:27017/techins";
const DB_NAME = "techins";

const NEW_DEADLINE_ISO = "2026-10-18T18:29:59.000Z"; // 2026-10-18 23:59:59 IST

let applied = process.argv.includes("--apply");
let dryRun = !applied;

if (dryRun && process.argv.includes("--apply")) {
  console.error("ERROR: Use --dry-run or --apply, not both.");
  process.exit(1);
}

async function main() {
  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const collection = db.collection("tasks");

  // Fetch all tasks with their current due_at values
  const allTasks = await collection.find({}).toArray();

  // Identify tasks with missing or odd deadline fields
  const oddDeadlineTasks = allTasks.filter(
    t => t.due_at === undefined || t.due_at === null || t.due_at === "" || (typeof t.due_at === "string" && isNaN(Date.parse(t.due_at)))
  );

  console.log(`\n=== Migration: Set all task deadlines to Sunday, 18 October 2026 (IST end-of-day) ===`);
  console.log(`Total tasks found: ${allTasks.length}`);
  console.log(`Tasks with missing/odd deadline field: ${oddDeadlineTasks.length}`);
  if (oddDeadlineTasks.length > 0) {
    console.log("\nSample of tasks with missing/odd deadlines:");
    oddDeadlineTasks.slice(0, 5).forEach(t => {
      console.log(`  - ${t.task_code || t._id} | title: "${t.title}" | due_at: "${t.due_at}"`);
    });
  }

  // Filter tasks that actually need updating (due_at is not already the target value)
  const tasksNeedingUpdate = allTasks.filter(
    t => t.due_at !== NEW_DEADLINE_ISO && (t.due_at === undefined || t.due_at === null || t.due_at === "" || new Date(t.due_at).toISOString() !== NEW_DEADLINE_ISO)
  );

  console.log(`Tasks needing update (due_at differs from ${NEW_DEADLINE_ISO}): ${tasksNeedingUpdate.length}`);

  let matched = 0;
  let modified = 0;

  if (!dryRun) {
    // Idempotent: only update tasks that don't already have the correct deadline
    const result = await collection.updateMany(
      { _id: { $in: tasksNeedingUpdate.map(t => t._id) } },
      { $set: { due_at: NEW_DEADLINE_ISO } }
    );
    matched = result.matchedCount;
    modified = result.modifiedCount;
    console.log(`\nMongoDB update result: matched=${matched}, modified=${modified}`);
  } else {
    // DRY-RUN: just count
    matched = tasksNeedingUpdate.length;
    modified = 0; // nothing actually modified
    console.log(`\n[DRY-RUN] Would match=${matched}, modify=0 (no DB changes)`);
  }

  // Before/after sample of 5 tasks
  console.log("\n=== Before/After Sample (first 5 tasks) ===");
  const sample = allTasks.slice(0, 5);
  sample.forEach(t => {
    const oldDeadline = t.due_at || "undefined/missing";
    const newDeadline = NEW_DEADLINE_ISO;
    console.log(`  ${t.task_code || t._id}`);
    console.log(`    title: "${t.title}"`);
    console.log(`    old due_at: "${oldDeadline}"`);
    console.log(`    new due_at: "${newDeadline}"`);
    console.log();
  });

  // If dry-run, also show what would be modified
  if (dryRun) {
    console.log("\n=== Tasks that WOULD be modified ===");
    tasksNeedingUpdate.slice(0, 10).forEach(t => {
      console.log(`  ${t.task_code || t._id} | "${t.title}" | old: "${t.due_at || "missing"}" -> new: "${NEW_DEADLINE_ISO}"`);
    });
    if (tasksNeedingUpdate.length > 10) {
      console.log(`  ... and ${tasksNeedingUpdate.length - 10} more`);
    }
  }

  // Idempotency check: running again should change nothing
  if (!dryRun) {
    const reRun = await collection.updateMany(
      { _id: { $in: tasksNeedingUpdate.map(t => t._id) } },
      { $set: { due_at: NEW_DEADLINE_ISO } }
    );
    console.log(`\n=== Idempotency check (second run) ===`);
    console.log(`Second run: matched=${reRun.matchedCount}, modified=${reRun.modifiedCount}`);
    if (reRun.modifiedCount === 0) {
      console.log("Confirmed: second run makes no changes (idempotent).");
    } else {
      console.log("WARNING: second run still made changes - not fully idempotent!");
    }
  }

  await client.close();
  console.log("\n=== Migration complete ===");
}

main().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});