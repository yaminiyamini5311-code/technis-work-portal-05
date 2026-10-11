/**
 * PRODUCTION BATCH SEEDER
 * 
 * Seeds the canonical batch list into the production database.
 * IDEMPOTENT: Inserts only batches that don't exist (case-insensitive comparison).
 * Never creates, renames, or deletes any other batch.
 * 
 * Usage:
 *   MONGODB_URI="your-prod-uri" MONGODB_DB_NAME="techins" node scripts/seed-production-batches.js
 *   
 * Or with .env file:
 *   node scripts/seed-production-batches.js
 */

const { MongoClient } = require("mongodb");

// Load .env in local development
if (!process.env.VERCEL) {
  require("dotenv").config();
}

// Read from environment
const MONGODB_URI = (process.env.MONGODB_URI || "").trim();
const MONGODB_DB_NAME = (process.env.MONGODB_DB_NAME || "techins").trim();

// CANONICAL BATCH LIST (as provided by user)
// Add your exact batch names here - this script will insert ONLY these
const CANONICAL_BATCHES = [
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
    console.error("[seed] ERROR: MONGODB_URI environment variable is required");
    console.error("[seed] Usage: MONGODB_URI=\"your-uri\" node scripts/seed-production-batches.js");
    process.exit(1);
  }

  console.log("[seed] ═══════════════════════════════════════════════════════════");
  console.log("[seed] PRODUCTION BATCH SEEDER");
  console.log("[seed] ═══════════════════════════════════════════════════════════");
  console.log("[seed] Target database:", MONGODB_DB_NAME);
  console.log("[seed] Batches to seed:", CANONICAL_BATCHES.length);
  console.log("[seed] ───────────────────────────────────────────────────────────");
  
  const client = new MongoClient(MONGODB_URI, { 
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000
  });

  try {
    console.log("[seed] Connecting to MongoDB...");
    await client.connect();
    const db = client.db(MONGODB_DB_NAME);
    console.log("[seed] ✓ Connected successfully");

    // Take backup before any modifications
    console.log("[seed] ───────────────────────────────────────────────────────────");
    console.log("[seed] BACKUP: Current batches collection");
    const existingBatches = await db.collection("batches").find({}).toArray();
    console.log("[seed] Existing batches count:", existingBatches.length);
    if (existingBatches.length > 0) {
      console.log("[seed] Existing batches:");
      existingBatches.forEach(b => {
        console.log(`[seed]   - ${b.name} (${b._id}) [active: ${b.active !== false}]`);
      });
    } else {
      console.log("[seed] (No existing batches)");
    }

    // Build normalized map of existing batches
    const existingMap = new Map();
    for (const batch of existingBatches) {
      existingMap.set(normalizeName(batch.name), batch);
    }

    console.log("[seed] ───────────────────────────────────────────────────────────");
    console.log("[seed] SEEDING batches (idempotent)...");
    
    let inserted = 0;
    let skipped = 0;

    for (const batchName of CANONICAL_BATCHES) {
      const normalized = normalizeName(batchName);
      
      if (existingMap.has(normalized)) {
        const existing = existingMap.get(normalized);
        console.log(`[seed] ⊘ SKIP: "${batchName}" (exists as "${existing.name}")`);
        skipped++;
        continue;
      }

      // Insert new batch
      const result = await db.collection("batches").insertOne({
        name: batchName,
        active: true,
        created_at: new Date().toISOString(),
        created_by: "system_seed"
      });

      console.log(`[seed] ✓ INSERT: "${batchName}" (${result.insertedId})`);
      inserted++;
    }

    console.log("[seed] ───────────────────────────────────────────────────────────");
    console.log("[seed] SUMMARY");
    console.log("[seed] ───────────────────────────────────────────────────────────");
    console.log(`[seed] Batches inserted:  ${inserted}`);
    console.log(`[seed] Batches skipped:   ${skipped}`);
    console.log(`[seed] Total in database: ${inserted + existingBatches.length}`);

    // Verify final state
    const finalBatches = await db.collection("batches").find({}).sort({ name: 1 }).toArray();
    console.log("[seed] ───────────────────────────────────────────────────────────");
    console.log("[seed] FINAL STATE: All batches in database");
    finalBatches.forEach(b => {
      console.log(`[seed]   - ${b.name} (${b._id}) [active: ${b.active !== false}]`);
    });

    console.log("[seed] ═══════════════════════════════════════════════════════════");
    console.log("[seed] ✓ SEED COMPLETE");
    console.log("[seed] ═══════════════════════════════════════════════════════════");

  } catch (error) {
    console.error("[seed] ✗ ERROR:", error.message);
    console.error("[seed] Stack:", error.stack);
    process.exit(1);
  } finally {
    await client.close();
    console.log("[seed] Connection closed.");
  }
}

main();
