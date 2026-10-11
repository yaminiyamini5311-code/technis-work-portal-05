/**
 * TECHINS Batch/Program Fix Script
 * 
 * Ensures EXACTLY the 6 required programs exist in the database:
 * 1. Techins 60
 * 2. AI Ally
 * 3. Life Wise
 * 4. Foundation X
 * 5. Concept to Carrier
 * 6. Unlock
 * 
 * Removes any other batches that shouldn't exist.
 * Safe and idempotent.
 */

const { MongoClient, ObjectId } = require("mongodb");

// Load environment variables
if (!process.env.VERCEL) {
  require("dotenv").config();
}

const MONGODB_URI = (process.env.MONGODB_URI || "").trim();
const MONGODB_DB_NAME = (process.env.MONGODB_DB_NAME || "techins").trim();

// EXACT 6 REQUIRED PROGRAMS (case-sensitive as specified)
const REQUIRED_PROGRAMS = [
  "Techins 60",
  "AI Ally",
  "Life Wise",
  "Foundation X",
  "Concept to Carrier",
  "Unlock"
];

function normalizeName(name) {
  return String(name || "").trim().toLowerCase();
}

async function main() {
  if (!MONGODB_URI) {
    console.error("[FIX] ERROR: MONGODB_URI environment variable is required");
    process.exit(1);
  }

  console.log("[FIX] ════════════════════════════════════════════════════════");
  console.log("[FIX] TECHINS Batch/Program Fix");
  console.log("[FIX] ════════════════════════════════════════════════════════");
  console.log("[FIX] Target database:", MONGODB_DB_NAME);
  console.log("[FIX] Required programs:", REQUIRED_PROGRAMS.length);
  console.log("[FIX]");

  const client = new MongoClient(MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000
  });

  try {
    await client.connect();
    const db = client.db(MONGODB_DB_NAME);
    console.log("[FIX] ✓ Connected to database");
    console.log("[FIX]");

    // ─── Step 1: Backup current state ─────────────────────────────────────
    console.log("[FIX] ─────────────────────────────────────────────────────");
    console.log("[FIX] STEP 1: Current batches in database");
    console.log("[FIX] ─────────────────────────────────────────────────────");
    const existingBatches = await db.collection("batches").find({}).toArray();
    console.log(`[FIX] Found ${existingBatches.length} batch(es):`);
    existingBatches.forEach(b => {
      console.log(`[FIX]   - "${b.name}" (${b._id}) [active: ${b.active !== false}]`);
    });
    console.log("[FIX]");

    // ─── Step 2: Identify batches to keep and remove ──────────────────────
    console.log("[FIX] ─────────────────────────────────────────────────────");
    console.log("[FIX] STEP 2: Analyzing batches");
    console.log("[FIX] ─────────────────────────────────────────────────────");

    const requiredNormalized = new Set(REQUIRED_PROGRAMS.map(normalizeName));
    const batchesToKeep = [];
    const batchesToRemove = [];
    const requiredBatchNames = new Map(); // normalized -> original name

    for (const batch of existingBatches) {
      const normalized = normalizeName(batch.name);
      if (requiredNormalized.has(normalized)) {
        batchesToKeep.push(batch);
        requiredBatchNames.set(normalized, batch.name);
        console.log(`[FIX] ✓ KEEP: "${batch.name}"`);
      } else {
        batchesToRemove.push(batch);
        console.log(`[FIX] ✗ REMOVE: "${batch.name}" (not in required list)`);
      }
    }
    console.log("[FIX]");

    // ─── Step 3: Remove unwanted batches ──────────────────────────────────
    if (batchesToRemove.length > 0) {
      console.log("[FIX] ─────────────────────────────────────────────────────");
      console.log("[FIX] STEP 3: Removing unwanted batches");
      console.log("[FIX] ─────────────────────────────────────────────────────");
      
      for (const batch of batchesToRemove) {
        // Check if any students are assigned to this batch
        const studentCount = await db.collection("users").countDocuments({
          batch_id: String(batch._id),
          role: "student"
        });

        if (studentCount > 0) {
          console.log(`[FIX] ⚠ SKIP: "${batch.name}" (${studentCount} student(s) assigned)`);
          console.log(`[FIX]         Manual intervention required to reassign students`);
        } else {
          await db.collection("batches").deleteOne({ _id: batch._id });
          console.log(`[FIX] ✓ REMOVED: "${batch.name}" (${batch._id})`);
        }
      }
      console.log("[FIX]");
    }

    // ─── Step 4: Add missing required programs ────────────────────────────
    console.log("[FIX] ─────────────────────────────────────────────────────");
    console.log("[FIX] STEP 4: Ensuring all 6 required programs exist");
    console.log("[FIX] ─────────────────────────────────────────────────────");

    const existingNormalized = new Set(batchesToKeep.map(b => normalizeName(b.name)));
    let inserted = 0;

    for (const programName of REQUIRED_PROGRAMS) {
      const normalized = normalizeName(programName);
      
      if (existingNormalized.has(normalized)) {
        const existing = batchesToKeep.find(b => normalizeName(b.name) === normalized);
        console.log(`[FIX] ⊘ EXISTS: "${programName}" (as "${existing.name}")`);
      } else {
        const result = await db.collection("batches").insertOne({
          name: programName,
          active: true,
          created_at: new Date().toISOString(),
          created_by: "system_fix"
        });
        console.log(`[FIX] ✓ INSERTED: "${programName}" (${result.insertedId})`);
        inserted++;
      }
    }
    console.log("[FIX]");

    // ─── Step 5: Final verification ───────────────────────────────────────
    console.log("[FIX] ─────────────────────────────────────────────────────");
    console.log("[FIX] STEP 5: Final verification");
    console.log("[FIX] ─────────────────────────────────────────────────────");

    const finalBatches = await db.collection("batches")
      .find({ active: true })
      .sort({ name: 1 })
      .toArray();

    console.log(`[FIX] Active batches in database: ${finalBatches.length}`);
    finalBatches.forEach((b, idx) => {
      const isRequired = requiredNormalized.has(normalizeName(b.name));
      const marker = isRequired ? "✓" : "⚠";
      console.log(`[FIX]   ${idx + 1}. ${marker} ${b.name} (${b._id})`);
    });
    console.log("[FIX]");

    // ─── Summary ───────────────────────────────────────────────────────────
    console.log("[FIX] ════════════════════════════════════════════════════════");
    console.log("[FIX] SUMMARY");
    console.log("[FIX] ════════════════════════════════════════════════════════");
    console.log(`[FIX] Batches kept:      ${batchesToKeep.length}`);
    console.log(`[FIX] Batches removed:   ${batchesToRemove.filter(b => !existingBatches.find(eb => eb._id === b._id)).length}`);
    console.log(`[FIX] Batches inserted:  ${inserted}`);
    console.log(`[FIX] Total active now:  ${finalBatches.length}`);
    console.log("[FIX] ════════════════════════════════════════════════════════");
    console.log("[FIX] ✓ FIX COMPLETE");
    console.log("[FIX] ════════════════════════════════════════════════════════");

  } catch (error) {
    console.error("[FIX] ✗ ERROR:", error.message);
    console.error("[FIX] Stack:", error.stack);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
