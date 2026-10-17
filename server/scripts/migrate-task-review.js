/**
 * Idempotent migration for the Task Manager review / resubmission workflow.
 *
 * Backward compatible: every field it touches is OPTIONAL on the read side, so
 * the new code works against an unmigrated database and this script only makes
 * the stored data match the canonical model. Running it twice changes nothing
 * (every step is a no-op once applied), so it is safe to run on every deploy.
 *
 * What it does
 *   1. tasks.domain === "program"  →  "edutins", keeping the old value in
 *      tasks.legacy_domain. The old Domain dropdown offered "program" as if it
 *      were a domain, which is why the Live Tasks table showed a "Program"
 *      badge on every row while the Program column showed "—".
 *   2. tasks.program is filled from the assignees' own program when it is
 *      missing, so the Program column shows a real value.
 *   3. task_assignments.status is normalized to the shared enum
 *      (assigned → pending, "Revision Required" → revision_required, …).
 *   4. Revision bookkeeping fields get their defaults on existing rows
 *      (revision_cycle 0, revision_status null, revision_history []).
 *
 * Usage:
 *   node scripts/migrate-task-review.js            # report + apply
 *   node scripts/migrate-task-review.js --dry-run  # report only
 */

require("dotenv").config();
const { connect, disconnect } = require("../mongodb");
const { normalizeStatus } = require("../config/taskStatus");
const { LEGACY_SCOPE_DOMAIN, SCOPE_DOMAIN_FALLBACK, toId } = require("../utils/submissionStatus");

const DRY_RUN = process.argv.includes("--dry-run");

async function migrateDomains(db) {
  const tasks = await db.collection("tasks").find({ domain: LEGACY_SCOPE_DOMAIN }).toArray();
  const detail = tasks.map(t => ({ id: String(t._id), code: t.task_code, title: t.title }));
  if (!DRY_RUN) {
    for (const task of tasks) {
      await db.collection("tasks").updateOne(
        { _id: task._id },
        { $set: { domain: SCOPE_DOMAIN_FALLBACK, legacy_domain: LEGACY_SCOPE_DOMAIN, updated_at: new Date().toISOString() } }
      );
    }
  }
  return { scanned: tasks.length, changed: tasks.length, detail };
}

async function migratePrograms(db) {
  const tasks = await db.collection("tasks").find({ program: { $in: [null, ""] } }).toArray();
  let changed = 0;
  const detail = [];
  for (const task of tasks) {
    const studentIds = (await db.collection("task_assignments")
      .find({ task_id: String(task._id) }, { projection: { student_id: 1 } })
      .toArray()).map(a => String(a.student_id));
    if (task.assigned_to && !studentIds.includes(String(task.assigned_to))) studentIds.push(String(task.assigned_to));
    if (!studentIds.length) continue;
    const students = await db.collection("users")
      .find({ _id: { $in: studentIds.map(toId) } }, { projection: { program: 1 } })
      .toArray();
    const programs = [...new Set(students.map(s => s.program).filter(Boolean).map(p => String(p).trim()))];
    if (!programs.length) continue;
    const program = programs[0];
    if (!DRY_RUN) {
      await db.collection("tasks").updateOne({ _id: task._id }, { $set: { program } });
    }
    changed++;
    detail.push({ id: String(task._id), code: task.task_code, program });
  }
  return { scanned: tasks.length, changed, detail };
}

async function migrateAssignments(db) {
  const rows = await db.collection("task_assignments").find({}).toArray();
  let statusChanged = 0;
  let defaultsApplied = 0;
  for (const row of rows) {
    const canonical = normalizeStatus(row.status);
    const needsDefaults = row.revision_cycle === undefined
      || row.revision_history === undefined
      || row.revision_status === undefined;
    if (canonical === row.status && !needsDefaults) continue;
    const set = {};
    if (canonical !== row.status) { set.status = canonical; statusChanged++; }
    if (needsDefaults) {
      defaultsApplied++;
      if (row.revision_cycle === undefined) set.revision_cycle = 0;
      if (row.revision_history === undefined) set.revision_history = [];
      if (row.revision_status === undefined) set.revision_status = null;
      if (row.revision_requested_at === undefined) set.revision_requested_at = null;
      if (row.revision_deadline === undefined) set.revision_deadline = null;
    }
    if (!DRY_RUN) await db.collection("task_assignments").updateOne({ _id: row._id }, { $set: set });
  }
  return { scanned: rows.length, statusChanged, defaultsApplied };
}

async function main() {
  const db = await connect();
  console.log(`[migrate-task-review] ${DRY_RUN ? "DRY RUN — nothing will be written" : "applying"}`);

  const domains = await migrateDomains(db);
  console.log(`[1/3] tasks.domain "${LEGACY_SCOPE_DOMAIN}" -> "${SCOPE_DOMAIN_FALLBACK}": scanned ${domains.scanned}, changed ${domains.changed}`);
  for (const d of domains.detail) console.log(`      - ${d.code || d.id} ${d.title || ""}`.trimEnd());

  const programs = await migratePrograms(db);
  console.log(`[2/3] tasks.program backfill: scanned ${programs.scanned}, changed ${programs.changed}`);

  const assignments = await migrateAssignments(db);
  console.log(`[3/3] task_assignments normalization: scanned ${assignments.scanned}, status normalized ${assignments.statusChanged}, revision defaults applied ${assignments.defaultsApplied}`);

  console.log(DRY_RUN ? "[done] dry run complete." : "[done] migration complete.");
  await disconnect();
}

if (require.main === module) {
  main().catch(async (e) => {
    console.error("[migrate-task-review] failed:", e.message);
    try { await disconnect(); } catch { /* noop */ }
    process.exit(1);
  });
}

module.exports = { migrateDomains, migratePrograms, migrateAssignments, DRY_RUN };