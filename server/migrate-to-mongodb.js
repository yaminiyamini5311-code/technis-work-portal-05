/**
 * MongoDB Data Migration Script
 * Migrates data from sqlite_backup.json into MongoDB
 * Safe to run multiple times (idempotent - uses upsert)
 */
require("dotenv").config();

const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "techins";

if (!MONGODB_URI) {
  console.error("MONGODB_URI is required. Set it in .env");
  process.exit(1);
}

const backupPath = path.join(__dirname, "sqlite_backup.json");
if (!fs.existsSync(backupPath)) {
  console.error("sqlite_backup.json not found. Run the backup script first.");
  process.exit(1);
}

const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));

async function migrate() {
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    const db = client.db(MONGODB_DB_NAME);
    console.log("Connected to MongoDB:", MONGODB_DB_NAME);

    // Migrate users
    const users = backup.users || [];
    console.log(`Migrating ${users.length} users...`);
    let migrated = 0, skipped = 0;
    for (const user of users) {
      const { id, ...rest } = user;
      // Use upsert by email to avoid duplicates
      const result = await db.collection("users").updateOne(
        { email: String(user.email || "").trim().toLowerCase() },
        {
          $setOnInsert: {
            name: user.name,
            email: String(user.email || "").trim().toLowerCase(),
            password: user.password,
            role: user.role || "student",
            department: user.department || null,
            program: user.program || null,
            active: user.active != null ? Number(user.active) : 1,
            phone: user.phone || null,
            avatar: user.avatar || null,
            registration_status: user.registration_status || "approved",
            created_at: user.created_at || new Date().toISOString(),
            // Keep original SQLite ID for reference
            sqlite_id: user.id
          }
        },
        { upsert: true }
      );
      if (result.upsertedCount > 0) migrated++;
      else skipped++;
    }
    console.log(`Users: ${migrated} migrated, ${skipped} already existed.`);

    // Migrate audit_logs (source of truth since tasks = 0)
    const auditLogs = backup.audit_logs || [];
    if (auditLogs.length > 0) {
      console.log(`Migrating ${auditLogs.length} audit logs...`);
      for (const log of auditLogs) {
        const { id, ...rest } = log;
        await db.collection("audit_logs").updateOne(
          { sqlite_id: log.id },
          { $setOnInsert: { ...rest, sqlite_id: log.id } },
          { upsert: true }
        );
      }
      console.log(`Audit logs migrated.`);
    }

    // Report final counts
    const collections = ["users", "tasks", "missions", "daily_activities", "submissions", "notifications", "performance", "audit_logs"];
    console.log("\n=== MongoDB Record Counts After Migration ===");
    for (const col of collections) {
      const count = await db.collection(col).countDocuments();
      console.log(`  ${col}: ${count}`);
    }
    console.log("=== Migration Complete ===\n");

  } catch (err) {
    console.error("Migration error:", err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

migrate();
