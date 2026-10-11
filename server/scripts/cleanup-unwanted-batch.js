/**
 * Cleanup script: Reassign students from unwanted batch and remove it
 */
const { MongoClient, ObjectId } = require("mongodb");
require("dotenv").config();

const MONGODB_URI = process.env.MONGODB_URI.trim();
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME.trim();

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGODB_DB_NAME);

  const unwantedBatchId = "6acba22092c1d7023663f433";
  const techins60Id = "6acb514eccdade82bcadd0e6";

  console.log("Reassigning students from unwanted batch to Techins 60...");
  const result = await db.collection("users").updateMany(
    { batch_id: unwantedBatchId },
    { $set: { batch_id: techins60Id, program: "techins 60" } }
  );
  console.log(`✓ Reassigned ${result.modifiedCount} student(s)`);

  console.log("Deleting unwanted batch...");
  await db.collection("batches").deleteOne({ 
    _id: ObjectId.createFromHexString(unwantedBatchId) 
  });
  console.log("✓ Deleted unwanted batch");

  const finalBatches = await db.collection("batches")
    .find({ active: true })
    .sort({ name: 1 })
    .toArray();
  
  console.log("\nFinal active batches:");
  finalBatches.forEach((b, idx) => {
    console.log(`  ${idx + 1}. ${b.name}`);
  });

  await client.close();
  console.log("\n✓ Cleanup complete!");
}

main().catch(console.error);
