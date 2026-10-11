/**
 * Seed Techis60 students from the master credentials CSV into MongoDB.
 *
 * Idempotent: upserts by normalized email. Existing users keep their
 * password unless the record was never created (first seed) — the CSV
 * passwords are TEMPORARY passwords intended for first login.
 * Every seeded student is linked to the canonical "Techis60" batch.
 *
 * Usage: node scripts/seed-techins60-students.js [csvPath]
 */
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const bcrypt = require("bcryptjs");

const MONGODB_URI = (process.env.MONGODB_URI || "mongodb://127.0.0.1:27017").trim();
const MONGODB_DB_NAME = (process.env.MONGODB_DB_NAME || "techins").trim();
const BATCH_NAME = "Techis60";
const DEFAULT_CSV = path.join(__dirname, "..", "..", "TECHINS_60_Master_Credentials.csv");

function parseCsv(filePath) {
  const content = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    // simple CSV (no quoted commas in this file)
    const values = line.split(",").map(v => v.trim());
    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] || ""; });
    return row;
  });
}

async function main() {
  const csvPath = process.argv[2] || DEFAULT_CSV;
  if (!fs.existsSync(csvPath)) {
    console.error(`[seed] CSV not found: ${csvPath}`);
    process.exit(1);
  }
  const rows = parseCsv(csvPath);
  console.log(`[seed] ${rows.length} rows from ${path.basename(csvPath)}`);

  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(MONGODB_DB_NAME);

  // Resolve the canonical batch (create if missing — migration normally does this)
  let batch = await db.collection("batches").findOne({ name: BATCH_NAME });
  if (!batch) {
    const res = await db.collection("batches").insertOne({ name: BATCH_NAME, active: true, created_at: new Date().toISOString() });
    batch = { _id: res.insertedId, name: BATCH_NAME, active: true };
    console.log("[seed] created batch " + BATCH_NAME);
  }
  const batchId = String(batch._id);
  console.log(`[seed] batch: ${BATCH_NAME} (${batchId})`);

  let created = 0, updated = 0, skipped = 0;
  for (const row of rows) {
    const name = String(row["Name"] || "").trim();
    const email = String(row["Portal Email"] || "").trim().toLowerCase();
    const tempPassword = String(row["Temporary Password"] || "").trim();
    const learnerId = String(row["Learner ID"] || "").trim();
    if (!name || !email || !tempPassword) { skipped++; continue; }

    const existing = await db.collection("users").findOne({ email });
    if (existing) {
      // Link to the batch + learner id, never touch the password on re-runs
      await db.collection("users").updateOne(
        { _id: existing._id },
        { $set: { batch_id: batchId, program: "techins 60", learner_id: learnerId, active: 1 } }
      );
      updated++;
      continue;
    }

    const passwordHash = await bcrypt.hash(tempPassword, 12);
    await db.collection("users").insertOne({
      name,
      email,
      password: passwordHash,
      role: "student",
      department: "Techins",
      program: "techins 60",
      batch_id: batchId,
      learner_id: learnerId,
      phone: null,
      active: 1,
      registration_status: "approved",
      created_at: new Date().toISOString(),
    });
    created++;
  }

  const inBatch = await db.collection("users").countDocuments({ batch_id: batchId, role: "student" });
  console.log(`[seed] DONE. created=${created} updated=${updated} skipped=${skipped} — students in ${BATCH_NAME}: ${inBatch}`);
  await client.close();
}

main().catch(err => { console.error("[seed] FATAL:", err.message); process.exit(1); });
