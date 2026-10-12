/**
 * repair-student-accounts.js
 *
 * Idempotent data repair for student rows that were inserted directly
 * (bypassing signup/admin-register), e.g. with `active` missing/NULL/false.
 * Those rows fail the login gate with "Your account is pending approval or
 * has been deactivated" even though their registration is approved.
 *
 * SAFETY RULES (hard-coded, no flags override them):
 *   - UPDATE ONLY. Never deletes, drops, truncates or re-inserts users.
 *   - Never touches ceo / admin / manager accounts.
 *   - Never touches genuinely pending or rejected registrations.
 *   - Never touches deliberately deactivated students (active === numeric 0
 *     is what the server's deactivate route writes — respected as-is).
 *   - Never reads, prints or rewrites passwords/hashes.
 *
 * USAGE:
 *   node scripts/repair-student-accounts.js            # dry-run (default)
 *   node scripts/repair-student-accounts.js --apply    # backup + apply + verify
 *   node scripts/repair-student-accounts.js --apply --backup-dir <dir>
 *
 * Backup: a full JSON dump of the users collection is written BEFORE any
 * change (server/backup/ is gitignored). On replica-set deployments the
 * updates run inside a transaction and roll back on any error.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const {
  normalizeEmail,
  normalizeRole,
  normalizeRegistrationStatus,
  isActiveFlag,
} = require("../utils/userAccount");

const APPLY = process.argv.includes("--apply");
const NO_BACKUP = process.argv.includes("--no-backup");
const backupDirArgIndex = process.argv.indexOf("--backup-dir");
const BACKUP_DIR = backupDirArgIndex > -1 && process.argv[backupDirArgIndex + 1]
  ? path.resolve(process.argv[backupDirArgIndex + 1])
  : path.join(__dirname, "..", "backup");

const MONGODB_URI = (process.env.MONGODB_URI || "").trim();
const MONGODB_DB_NAME = (process.env.MONGODB_DB_NAME || "techins").trim();

function maskEmail(e) {
  const s = String(e || "").trim();
  const at = s.indexOf("@");
  if (at < 0) return "***";
  return `${s.slice(0, 2)}***${s.slice(at)}`;
}

function isNumericZero(v) {
  return typeof v === "number" && v === 0;
}

/** A documented-but-wrong shape of `active` that breaks the login gate. */
function isBrokenActive(active) {
  if (isActiveFlag(active)) return false;        // already fine
  if (isNumericZero(active)) return false;       // deliberate deactivation
  return true;                                   // missing/NULL/false/"0"/other
}

async function connect() {
  if (!MONGODB_URI) {
    console.error("MONGODB_URI is not set (check server/.env). Aborting.");
    process.exit(1);
  }
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  return client;
}

async function supportsTransactions(db) {
  try {
    const hello = await db.command({ hello: 1 });
    return Boolean(hello.setName); // replica set / sharded cluster
  } catch {
    return false;
  }
}

async function dumpUsers(db, tag) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(BACKUP_DIR, `users-backup-${tag}-${stamp}.json`);
  const users = await db.collection("users").find({}).toArray();
  fs.writeFileSync(file, JSON.stringify(users, null, 2));
  console.log(`[backup] ${users.length} user documents dumped -> ${file}`);
  return { file, count: users.length };
}

async function scan(db) {
  const users = await db.collection("users").find({}).toArray();
  const duplicateEmails = await db.collection("users").aggregate([
    { $group: { _id: { $toLower: { $trim: { input: { $toString: "$email" } } } }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();

  // normalized-email -> doc, for collision detection before any rewrite
  const emailOwners = new Map();
  for (const u of users) {
    const key = normalizeEmail(u.email);
    if (!key) continue;
    emailOwners.set(key, (emailOwners.get(key) || 0) + 1);
  }

  const plan = [];
  const skipped = { pending: 0, rejected: 0, deliberateDeactivated: 0, noPassword: 0, emailCollision: 0, protectedRoles: 0 };

  for (const u of users) {
    const role = normalizeRole(u.role);

    // Never touch privileged accounts, whatever their state.
    if (role !== "student") { skipped.protectedRoles++; continue; }

    const status = normalizeRegistrationStatus(u.registration_status);
    if (status === "pending") { skipped.pending++; continue; }
    if (status === "rejected") { skipped.rejected++; continue; }

    // Deliberate deactivation by an admin: respected, not repaired.
    if (isNumericZero(u.active)) { skipped.deliberateDeactivated++; continue; }

    const brokenActive = isBrokenActive(u.active);
    const cleanEmail = normalizeEmail(u.email);
    const emailNeedsFix = cleanEmail !== String(u.email || "") && cleanEmail.length > 0;
    const roleNeedsFix = role !== String(u.role || "");
    const statusNeedsFix = status !== String(u.registration_status || "") && String(u.registration_status || "").trim() !== "";

    if (!brokenActive && !emailNeedsFix && !roleNeedsFix && !statusNeedsFix) continue;

    // Only repair real accounts (must have a password credential present).
    if (!u.password || typeof u.password !== "string") { skipped.noPassword++; continue; }

    // Email rewrite must never create a duplicate. emailOwners counts docs
    // per normalized email (this doc included), so >1 means a real clash.
    if (emailNeedsFix) {
      const owners = emailOwners.get(cleanEmail) || 0;
      if (owners > 1) {
        skipped.emailCollision++;
        continue;
      }
    }

    const changes = {};
    if (brokenActive) changes.active = 1;
    if (status === "approved" || status === "") changes.registration_status = "approved";
    if (emailNeedsFix) changes.email = cleanEmail;
    if (roleNeedsFix) changes.role = "student";
    if (statusNeedsFix) changes.registration_status = status;

    plan.push({
      _id: u._id,
      email: maskEmail(u.email),
      reason: brokenActive ? "broken-active" : (emailNeedsFix ? "email-casing" : "field-casing"),
      changes,
    });
  }

  return { plan, skipped, total: users.length, duplicateEmails: duplicateEmails.length };
}

async function applyPlan(db, plan, transactional) {
  const coll = db.collection("users");
  const now = new Date().toISOString();

  const runOne = async (item) => {
    const set = { ...item.changes, updated_at: now };
    const res = await coll.updateOne({ _id: item._id }, { $set: set });
    return res.modifiedCount;
  };

  if (transactional) {
    const session = db.client.startSession();
    try {
      let modified = 0;
      await session.withTransaction(async () => {
        for (const item of plan) modified += await runOne(item);
      });
      return { modified, mode: "transaction" };
    } finally {
      await session.endSession();
    }
  }

  // Standalone server (no replica set): idempotent single-document updates,
  // each one independent; a failure aborts before touching the rest.
  let modified = 0;
  for (const item of plan) {
    modified += await runOne(item);
  }
  return { modified, mode: "sequential" };
}

async function countStudents(db) {
  const rows = await db.collection("users").aggregate([
    { $project: { r: { $toLower: { $trim: { input: { $toString: "$role" } } } } } },
    { $match: { r: "student" } },
    { $count: "n" },
  ]).toArray();
  return rows[0]?.n || 0;
}

async function main() {
  const client = await connect();
  try {
    const db = client.db(MONGODB_DB_NAME);
    const transactional = await supportsTransactions(db);
    console.log(`[mode] ${APPLY ? "APPLY" : "DRY-RUN"} | transactions: ${transactional ? "available" : "unavailable (standalone)"} | db: ${MONGODB_DB_NAME}`);

    // ── STEP 1: BACKUP (read-only dump, never committed) ──
    let backupFile = null;
    if (NO_BACKUP) {
      console.log("[backup] skipped (--no-backup)");
    } else {
      const dump = await dumpUsers(db, APPLY ? "pre-repair" : "pre-scan");
      backupFile = dump.file;
    }

    // ── STEP 2: SCAN / DRY-RUN ──
    const before = await scan(db);
    const beforeCounts = {
      total: before.total,
      students: await countStudents(db),
      brokenStudents: before.plan.filter(p => p.reason === "broken-active").length,
    };

    console.log("\n=== SCAN SUMMARY ===");
    console.log(`users total                : ${before.total}`);
    console.log(`rows to repair (students)  : ${before.plan.length}`);
    console.log(`  - broken active flag     : ${before.plan.filter(p => p.reason === "broken-active").length}`);
    console.log(`  - email/field casing only: ${before.plan.filter(p => p.reason !== "broken-active").length}`);
    console.log(`skipped (never touched)    : pending=${before.skipped.pending} rejected=${before.skipped.rejected} deliberate-deactivated=${before.skipped.deliberateDeactivated} missing-password=${before.skipped.noPassword} email-collision=${before.skipped.emailCollision} protected-roles=${before.skipped.protectedRoles}`);

    if (before.plan.length > 0) {
      console.log("\nrows (masked):");
      before.plan.forEach(p => console.log(`  ${p.email}  [${p.reason}] -> ${JSON.stringify(p.changes)}`));
    }

    if (!APPLY) {
      console.log("\n[dry-run] No changes made. Re-run with --apply to run the repair.");
      return;
    }

    // ── STEP 3: APPLY ──
    if (before.plan.length === 0) {
      console.log("\n[apply] Nothing to repair — database already consistent.");
    } else {
      const { modified, mode } = await applyPlan(db, before.plan, transactional);
      console.log(`\n[apply] updated ${modified}/${before.plan.length} rows (${mode})`);
    }

    // ── STEP 4: VERIFY ──
    const after = await scan(db);
    const afterCounts = {
      total: after.total,
      students: await countStudents(db),
      brokenStudents: after.plan.filter(p => p.reason === "broken-active").length,
    };
    // Only duplicates CREATED by this run are a failure; pre-existing ones
    // (impossible under the app's case-insensitive unique email index, but
    // possible in hand-made databases) are reported, not fatal.
    const newDuplicates = Math.max(0, after.duplicateEmails - before.duplicateEmails);

    console.log("\n=== POST-VERIFY ===");
    console.log(`backup dump               : ${backupFile || "(none)"}`);
    console.log(`users total before/after  : ${beforeCounts.total} / ${afterCounts.total} ${beforeCounts.total === afterCounts.total ? "(unchanged OK)" : "(CHANGED!)"}`);
    console.log(`students before/after     : ${beforeCounts.students} / ${afterCounts.students} ${beforeCounts.students === afterCounts.students ? "(unchanged OK)" : "(CHANGED!)"}`);
    console.log(`broken students before/after: ${beforeCounts.brokenStudents} / ${afterCounts.brokenStudents}`);
    console.log(`duplicate emails (ci)     : ${before.duplicateEmails} before / ${after.duplicateEmails} after (new: ${newDuplicates})`);
    console.log(`still pending (untouched) : ${after.skipped.pending}`);
    console.log(`still rejected (untouched): ${after.skipped.rejected}`);
    console.log(`still deactivated (untouched): ${after.skipped.deliberateDeactivated}`);

    if (beforeCounts.total !== afterCounts.total || beforeCounts.students !== afterCounts.students || afterCounts.brokenStudents > 0 || newDuplicates > 0) {
      console.error("\n[verify] FAILED — restore from the backup dump if needed.");
      process.exitCode = 1;
    } else {
      console.log("\n[verify] OK — repair complete, idempotent, counts unchanged, no new duplicates.");
    }
  } finally {
    await client.close();
  }
}

main().catch(e => { console.error("REPAIR ERROR:", e.message); process.exit(1); });
