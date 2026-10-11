const { MongoClient } = require("mongodb");
(async () => {
  const c = new MongoClient("mongodb://127.0.0.1:27017");
  await c.connect();
  const db = c.db("techins");
  const u = await db.collection("users").find({ program: "Techis60" }).toArray();
  console.log("users with legacy program='Techis60':");
  u.forEach(x => console.log("  ", x.email, "| batch_id:", JSON.stringify(x.batch_id), "| role:", x.role, "| active:", x.active));
  await c.close();
})();