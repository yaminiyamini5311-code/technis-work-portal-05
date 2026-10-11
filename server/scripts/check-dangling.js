/** Verify the "dangling batch_id" count — check for ObjectId vs string mismatch. */
const { MongoClient, ObjectId } = require("mongodb");
(async () => {
  const client = new MongoClient("mongodb://127.0.0.1:27017");
  await client.connect();
  const db = client.db("techins");

  const batchIds = (await db.collection("batches").find({}).toArray()).map(b => String(b._id));
  const users = await db.collection("users").find({ batch_id: { $ne: null } }).toArray();

  let dangling = 0, resolved = 0;
  for (const u of users) {
    if (batchIds.includes(String(u.batch_id))) resolved++;
    else { dangling++; if (dangling <= 5) console.log("  truly dangling:", u.email, "->", u.batch_id); }
  }
  console.log(`users with batch_id : ${users.length}`);
  console.log(`  resolve to a batch: ${resolved}`);
  console.log(`  truly dangling    : ${dangling}`);

  // Show the type of a batch_id vs _id
  const sample = users[0];
  if (sample) {
    console.log("\nsample users.batch_id value:", JSON.stringify(sample.batch_id), "(", typeof sample.batch_id, ")");
    console.log("sample batches._id value  :", JSON.stringify(batchIds[0]), "( string form )");
  }

  // Confirm the earlier aggregate failure mode
  const agg = await db.collection("users").aggregate([
    { $match: { batch_id: { $ne: null } } },
    { $lookup: { from: "batches", localField: "batch_id", foreignField: "_id", as: "b" } },
    { $match: { b: { $size: 0 } } },
    { $count: "n" }
  ]).toArray();
  console.log("\naggregation (string vs ObjectId) says dangling:", agg[0]?.n || 0);

  await client.close();
})();