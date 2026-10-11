/** Inspect exact batch document schema + MongoDB {active:true} matching semantics. */
const { MongoClient } = require("mongodb");
(async () => {
  const c = new MongoClient("mongodb://127.0.0.1:27017");
  await client_connect(c);
  async function client_connect() {}
  await c.connect();
  const db = c.db("techins");

  const docs = await db.collection("batches").find({}).toArray();
  console.log("=== full documents (schema + value types) ===");
  docs.forEach(d => {
    console.log(JSON.stringify(d));
    console.log("   name:", typeof d.name, "| active:", typeof d.active, "=", d.active,
                "| created_at:", typeof d.created_at);
  });

  console.log("\n=== does {active:true} match? ===");
  const strict = await db.collection("batches").countDocuments({ active: true });
  console.log("count({active:true})      =", strict);
  console.log("count({active:{$exists:true}}) =",
    await db.collection("batches").countDocuments({ active: { $exists: true } }));

  // prove boolean true does NOT match integer 1
  const t = await db.createCollection("__type_probe").catch(() => db.collection("__type_probe"));
  await db.collection("__type_probe").deleteMany({});
  await db.collection("__type_probe").insertMany([
    { k: "bool_true", active: true },
    { k: "int_one",   active: 1 },
    { k: "missing" },
  ]);
  const matched = await db.collection("__type_probe").find({ active: true }).toArray();
  console.log("\n{active:true} matched kinds:", matched.map(m => m.k).join(", "));
  console.log("=> boolean true matches; integer 1 and missing do NOT");
  await db.collection("__type_probe").drop();

  console.log("\n=== index on batches ===");
  console.log(JSON.stringify(await db.collection("batches").indexes(), null, 1));

  await c.close();
})();