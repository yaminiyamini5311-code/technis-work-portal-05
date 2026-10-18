/**
 * Idempotent mission-schedule migration.
 *
 * Missions historically carried a single `due_date`. This script adds the real
 * window:
 *   end_at   = the existing due_date when there is one
 *   start_at = end_at minus one day, so no window is ever inverted
 *
 * Nothing is lost and nothing is dropped:
 *   • `due_date` is KEPT and left exactly as it was, and is kept in sync with
 *     `end_at` going forward so older readers stay correct.
 *   • A mission with no `due_date` at all is given no window — the script does
 *     not invent a schedule the admin never chose.
 *
 * Safe to run any number of times: it only writes missions that are missing
 * `end_at`, and re-running touches nothing.
 *
 *   node scripts/migrate-mission-schedule.js [--dry-run]
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { MongoClient } = require("mongodb");

const DAY_MS = 24 * 60 * 60 * 1000;
const dryRun = process.argv.includes("--dry-run");

/** Parse whatever legacy shape `due_date` was stored in. */
function parseLegacyDueDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && value.$date) return parseLegacyDueDate(value.$date);
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set. Add it to server/.env before running the migration.");
    process.exit(1);
  }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME || "techins");
  const missions = db.collection("missions");

  // Only missions that need a window: end_at absent, with a due_date to use.
  const candidates = await missions.find({ end_at: { $exists: false }, due_date: { $ne: null, $exists: true } }).toArray();

  let updated = 0;
  let skippedNoDueDate = 0;
  let skippedUnparseable = 0;
  const changes = [];

  for (const m of candidates) {
    const end = parseLegacyDueDate(m.due_date);
    if (!end) { skippedUnparseable += 1; continue; }
    const start = new Date(end.getTime() - DAY_MS);
    const updates = {
      end_at: end.toISOString(),
      start_at: start.toISOString(),
      migrated_at: new Date().toISOString(),
    };
    if (!dryRun) await missions.updateOne({ _id: m._id }, { $set: updates });
    updated += 1;
    if (changes.length < 20) {
      changes.push({ id: String(m._id), title: m.title || null, due_date: m.due_date, start_at: updates.start_at, end_at: updates.end_at });
    }
  }

  const noDueDate = await missions.countDocuments({ end_at: { $exists: false }, $or: [{ due_date: null }, { due_date: { $exists: false } }] });
  skippedNoDueDate = noDueDate;

  const total = await missions.countDocuments({});

  console.log(dryRun ? "[dry-run] " : "");
  console.log(`missions total ................ ${total}`);
  console.log(`given end_at + start_at ...... ${updated}`);
  console.log(`left without a window ........ ${skippedNoDueDate}  (no due_date: the admin never chose one)`);
  console.log(`due_date unparseable ......... ${skippedUnparseable}`);
  if (changes.length) {
    console.log("\nsample:");
    for (const c of changes) console.log(`  ${c.id}  ${c.title || "(untitled)"}  ${c.due_date} -> ${c.start_at} .. ${c.end_at}`);
  }
  console.log(dryRun ? "\nDry run: nothing was written." : "\nMigration complete. Re-running is a no-op.");

  await client.close();
})().catch((e) => {
  console.error("Migration failed:", e.message);
  process.exit(1);
});