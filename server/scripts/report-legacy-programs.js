/** Report legacy users.program values vs batch names + propose a backfill. READ-ONLY. */
const { MongoClient } = require("mongodb");
(async () => {
  const c = new MongoClient("mongodb://127.0.0.1:27017");
  await c.connect();
  const db = c.db("techins");
  const norm = n => String(n || "").trim().toLowerCase();

  const batches = await db.collection("batches").find({}).toArray();
  const byName = new Map(batches.map(b => [norm(b.name), b]));
  const users = await db.collection("users").find({ program: { $exists: true, $ne: null } }).toArray();

  console.log("=== legacy users.program values (LOCAL) ===");
  const groups = new Map();
  for (const u of users) {
    const k = JSON.stringify(u.program);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(u);
  }
  for (const [prog, list] of groups) {
    const hasBatch = byName.has(norm(list[0].program));
    const withBatchId = list.filter(u => u.batch_id).length;
    console.log(`  program=${prog}  count=${list.length}  matches_a_batch=${hasBatch}  already_have_batch_id=${withBatchId}`);
  }

  console.log("\n=== PROPOSED BACKFILL (NOT APPLIED) ===");
  console.log("Rule: for each user with program=P and no batch_id,");
  console.log("      set batch_id = batches._id where lower(trim(batches.name)) = lower(trim(P)).");
  console.log("      Leave users already having a batch_id untouched (idempotent + safe).\n");

  let wouldSet = 0, noMatch = [];
  for (const [prog, list] of groups) {
    const target = byName.get(norm(list[0].program));
    const pending = list.filter(u => !u.batch_id);
    if (pending.length === 0) continue;
    if (target) { wouldSet += pending.length; console.log(`  MATCH  ${prog} -> batch "${target.name}" (${target._id}) : ${pending.length} user(s)`); }
    else { noMatch.push(...pending); console.log(`  NO MATCH ${prog} : ${pending.length} user(s) would stay unset`); }
  }
  console.log(`\n  TOTAL that would receive batch_id: ${wouldSet}`);
  console.log(`  TOTAL with no matching batch name (left untouched): ${noMatch.length}`);
  if (noMatch.length) {
    console.log("  examples:", noMatch.slice(0, 5).map(u => `${u.email} (program=${JSON.stringify(u.program)})`).join(", "));
  }
  await c.close();
})();