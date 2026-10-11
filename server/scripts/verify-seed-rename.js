/**
 * PROVES the seed's rename + insert logic on a THROWAWAY database.
 * Does not touch the real `techins` database.
 */
const { MongoClient } = require("mongodb");
const { execFileSync } = require("child_process");
const path = require("path");

const TEST_DB = "seed_rename_probe";
const URI = "mongodb://127.0.0.1:27017";

function runSeed() {
  const out = execFileSync(process.execPath, [path.join(__dirname, "seed-production-batches.js")], {
    env: { ...process.env, MONGODB_URI: URI, MONGODB_DB_NAME: TEST_DB, VERCEL: "1" },
    encoding: "utf8",
  });
  return out;
}

(async () => {
  const c = new MongoClient(URI);
  await c.connect();
  const db = c.db(TEST_DB);

  // Case A: a wrongly-named "Techis60" record exists, canonical does not.
  await db.collection("batches").deleteMany({});
  await db.collection("users").deleteMany({});
  await db.collection("tasks").deleteMany({});
  await db.collection("batches").insertOne({ name: "Techis60", active: true, created_at: new Date().toISOString() });
  await db.collection("users").insertOne({
    name: "Probe Student", email: "probe@example.com", role: "student",
    program: "Techis60", batch_id: (await db.collection("batches").findOne({ name: "Techis60" }))._id.toString()
  });
  const beforeId = (await db.collection("batches").findOne({ name: "Techis60" }))._id.toString();

  console.log("CASE A — wrong name present, canonical absent");
  console.log(runSeed().split("\n").filter(l => /RENAME|INSERT|renames needed|inserted|skipped:/.test(l)).join("\n"));

  const after = await db.collection("batches").find({}).sort({ name: 1 }).toArray();
  const techins60 = after.find(b => b.name === "Techins 60");
  console.log("\n  batches now:", after.map(b => b.name).join(" | "));
  console.log("  same _id preserved (renamed, not duplicated):", String(techins60._id) === beforeId);
  console.log("  count of 'Techins 60' records:", after.filter(b => b.name === "Techins 60").length);
  console.log("  leftover 'Techis60' records :", after.filter(b => b.name === "Techis60").length);
  const u = await db.collection("users").findOne({ email: "probe@example.com" });
  console.log("  user's legacy program ->", JSON.stringify(u.program), "| batch_id unchanged:", u.batch_id === beforeId);

  // Case B: run again -> fully idempotent
  console.log("\nCASE B — second run (idempotency)");
  console.log(runSeed().split("\n").filter(l => /RENAME|INSERT|renames needed|inserted|skipped:/.test(l)).join("\n"));
  const after2 = await db.collection("batches").find({}).sort({ name: 1 }).toArray();
  console.log("  batches:", after2.length, "->", after2.map(b => b.name).join(" | "));

  await db.dropDatabase();
  await c.close();
  console.log("\n  throwaway DB dropped");
})();