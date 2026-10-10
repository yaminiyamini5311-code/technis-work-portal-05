const { MongoClient } = require("mongodb");

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "techins";

let _client = null;
let _db = null;
let _connecting = null;

async function connect() {
  if (_db) return _db;
  if (_connecting) return _connecting;

  if (!MONGODB_URI) {
    throw new Error("[MongoDB] MONGODB_URI environment variable is not set. Add it to your .env or Vercel environment settings.");
  }

  _connecting = (async () => {
    try {
      console.log("[MongoDB] Connecting...");
      _client = new MongoClient(MONGODB_URI, {
        maxPoolSize: 10,
        minPoolSize: 1,
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      });
      await _client.connect();
      _db = _client.db(MONGODB_DB_NAME);
      await _db.command({ ping: 1 });
      console.log("[MongoDB] Connected — db: " + MONGODB_DB_NAME);
      await ensureIndexes(_db);
      return _db;
    } catch (err) {
      _client = null;
      _db = null;
      _connecting = null;
      console.error("[MongoDB] Connection failed:", err.message);
      console.error("[MongoDB] Stack trace:", err.stack);
      throw new Error(`MongoDB connection failed: ${err.message}`);
    } finally {
      _connecting = null;
    }
  })();

  return _connecting;
}

async function ensureIndexes(db) {
  try {
    await db.collection("users").createIndex({ email: 1 }, { unique: true });
    await db.collection("users").createIndex({ role: 1, active: 1 });
    await db.collection("users").createIndex({ program: 1 }, { sparse: true });
    await db.collection("tasks").createIndex({ task_code: 1 }, { unique: true, sparse: true });
    await db.collection("tasks").createIndex({ assigned_to: 1 });
    await db.collection("tasks").createIndex({ assigned_by: 1 });
    await db.collection("tasks").createIndex({ program: 1 }, { sparse: true });
    await db.collection("tasks").createIndex({ due_date: 1 }, { sparse: true });
    await db.collection("tasks").createIndex({ workflow_status: 1 });
    await db.collection("submissions").createIndex({ task_id: 1 });
    await db.collection("submissions").createIndex({ student_id: 1 });
    await db.collection("notifications").createIndex({ user_id: 1, read_at: 1 });
    await db.collection("notifications").createIndex({ created_at: -1 });
    await db.collection("daily_activities").createIndex({ user_id: 1, date: -1 });
    await db.collection("missions").createIndex({ assigned_to: 1 });
    await db.collection("performance").createIndex({ user_id: 1 });
    await db.collection("audit_logs").createIndex({ created_at: -1 });
    await db.collection("task_status_history").createIndex({ task_id: 1 });
    console.log("[MongoDB] Indexes ensured.");
  } catch (err) {
    console.error("[MongoDB] Index creation error (non-fatal):", err.message);
  }
}

async function healthCheck() {
  try {
    if (!_db) return { connected: false };
    await _db.command({ ping: 1 });
    const userCount = await _db.collection("users").countDocuments();
    return { connected: true, userCount };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

async function disconnect() {
  if (_client) {
    try {
      await _client.close();
      _client = null;
      _db = null;
      console.log("[MongoDB] Connection closed.");
    } catch (err) {
      console.error("[MongoDB] Shutdown error:", err.message);
    }
  }
}

// REMOVED process.exit() handlers — Vercel manages lifecycle
// Local dev cleanup is optional; connection will close on process end anyway

module.exports = { connect, disconnect, healthCheck };
