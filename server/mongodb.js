const { MongoClient } = require("mongodb");

// Read and sanitize MongoDB connection string
// Trim whitespace that might be added accidentally in Vercel env vars
const MONGODB_URI = process.env.MONGODB_URI ? process.env.MONGODB_URI.trim() : null;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME ? process.env.MONGODB_DB_NAME.trim() : "techins";

// Globally cached client and connection promise for serverless reuse
let _client = null;
let _db = null;
let _connecting = null;

/**
 * Connect to MongoDB with global caching and automatic retry on failure.
 * 
 * Serverless-safe design:
 * - Reuses connection across warm invocations
 * - Resets _connecting promise on failure so next request can retry
 * - Increased timeouts (20s) for slow Vercel cold starts
 * - Never calls process.exit() - returns errors instead
 * - Never logs the connection URI (contains credentials)
 */
async function connect() {
  // Return cached connection if available
  if (_db) return _db;
  
  // Wait for in-progress connection attempt
  if (_connecting) return _connecting;

  if (!MONGODB_URI) {
    throw new Error("[MongoDB] MONGODB_URI environment variable is not set. Add it to your .env or Vercel environment settings.");
  }

  _connecting = (async () => {
    try {
      console.log("[MongoDB] Connecting...");
      
      // Create client with increased timeouts for Vercel serverless
      _client = new MongoClient(MONGODB_URI, {
        maxPoolSize: 10,
        minPoolSize: 1,
        serverSelectionTimeoutMS: 20000,  // 20s - increased for Vercel cold starts
        connectTimeoutMS: 20000,           // 20s - increased for slow connections
        socketTimeoutMS: 45000,            // 45s - keep-alive for long operations
      });
      
      await _client.connect();
      _db = _client.db(MONGODB_DB_NAME);
      
      // Verify connection with ping
      await _db.command({ ping: 1 });
      console.log("[MongoDB] Connected successfully — db: " + MONGODB_DB_NAME);
      
      // Ensure indexes (non-fatal)
      await ensureIndexes(_db);
      
      return _db;
    } catch (err) {
      // Reset all connection state on failure so next request can retry
      _client = null;
      _db = null;
      _connecting = null;
      
      console.error("[MongoDB] Connection failed:", err.message);
      console.error("[MongoDB] Error code:", err.code);
      
      // Provide helpful error messages for common issues without exposing credentials
      if (err.message.includes("timeout") || err.message.includes("ETIMEDOUT")) {
        console.error("[MongoDB] TIMEOUT - Possible causes:");
        console.error("  1. MongoDB Atlas IP allowlist doesn't include 0.0.0.0/0");
        console.error("  2. Network connectivity issues from Vercel region");
        console.error("  3. MongoDB Atlas cluster is paused or unavailable");
        console.error("  4. Connection string is incorrect");
      } else if (err.message.includes("bad auth") || err.message.includes("authentication failed")) {
        console.error("[MongoDB] AUTHENTICATION FAILED - Possible causes:");
        console.error("  1. Username or password is incorrect in MONGODB_URI");
        console.error("  2. Password contains special characters that need URL encoding");
        console.error("  3. Database user doesn't have correct permissions");
        console.error("  4. Check: Encode password special chars: @ = %40, : = %3A, / = %2F, ? = %3F, # = %23, [ = %5B, ] = %5D, % = %25");
      }
      
      throw new Error(`MongoDB connection failed: ${err.message}`);
    } finally {
      // Always clear _connecting flag so failures don't block future attempts
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
    
    // Authorized users collection indexes
    await db.collection("authorized_users").createIndex({ email: 1 }, { unique: true });
    await db.collection("authorized_users").createIndex({ learnerId: 1 }, { unique: true, sparse: true });
    await db.collection("authorized_users").createIndex({ role: 1 });
    await db.collection("authorized_users").createIndex({ active: 1 });
    
    console.log("[MongoDB] Indexes ensured.");
  } catch (err) {
    console.error("[MongoDB] Index creation error (non-fatal):", err.message);
  }
}

async function healthCheck() {
  try {
    if (!_db) return { connected: false, reason: "No active connection" };
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
      _connecting = null;
      console.log("[MongoDB] Connection closed gracefully.");
    } catch (err) {
      console.error("[MongoDB] Shutdown error:", err.message);
    }
  }
}

module.exports = { connect, disconnect, healthCheck };
