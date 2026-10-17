const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const path = require("path");

// Load .env only in local development — Vercel injects env vars directly
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

// ─── STARTUP VALIDATION ────────────────────────────────────────────────────
// Lists every missing required variable so Vercel logs tell you exactly what
// to add in Settings → Environment Variables
const REQUIRED_ENV = ["JWT_SECRET", "MONGODB_URI"];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(
    `[TECHINS] FATAL — Missing required environment variables: ${missing.join(", ")}\n` +
    `Add them in Vercel Dashboard → Settings → Environment Variables.`
  );
  // DO NOT call process.exit() on Vercel — it kills the entire serverless instance.
  // The env-guard middleware below returns a clear 503 per request instead.
  // On long-running servers (local dev, Render) fail fast instead: without
  // JWT_SECRET no token can be issued or verified, so the process cannot
  // serve auth traffic at all.
  if (!process.env.VERCEL) {
    process.exit(1);
  }
}

const { connect, healthCheck } = require("./mongodb");
const { authenticateToken, checkStudentRegistrationStatus, requireApprovedStudent } = require("./middleware/authMiddleware");

const app = express();

// ─── CORS CONFIGURATION ────────────────────────────────────────────────────
// Allowlist-based CORS from CORS_ORIGINS environment variable
// Must be registered BEFORE all routes, middleware, and rate limiters

function buildCorsOriginsList() {
  const origins = new Set();
  
  // Add localhost origins for local development
  origins.add("http://localhost:5173");
  origins.add("http://localhost:5174");
  origins.add("http://localhost:5175");
  origins.add("http://localhost:5176");
  
  // Add from CORS_ORIGINS environment variable (primary config)
  if (process.env.CORS_ORIGINS) {
    process.env.CORS_ORIGINS
      .split(",")
      .map(url => url.trim().replace(/\/$/, ""))  // Strip trailing slashes
      .filter(Boolean)
      .forEach(url => origins.add(url));
  }

  // Also trust the deployed frontend URL when it is declared through any of
  // these variables. Root cause of the production CORS outage: CORS_ORIGINS
  // held a stale preview deployment URL while the canonical frontend domain
  // (CLIENT_URL/APP_URL/FRONTEND_URL) was never allowed, so every browser
  // request from the live site was blocked (preflight answered without
  // Access-Control-Allow-Origin — verified against the live API).
  for (const key of ["CLIENT_URL", "APP_URL", "FRONTEND_URL"]) {
    const value = process.env[key];
    if (!value) continue;
    value
      .split(",")
      .map(url => url.trim().replace(/\/$/, ""))
      .filter(Boolean)
      .forEach(url => origins.add(url));
  }
  
  return Array.from(origins);
}

const allowedOrigins = buildCorsOriginsList();
console.log("[CORS] Allowed origins:", allowedOrigins);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, curl, etc.)
    if (!origin) {
      return callback(null, true);
    }
    
    // Check if origin is in allowlist
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Log blocked origin with console.error for visibility
    console.error("[CORS] BLOCKED origin:", origin);
    console.error("[CORS] Allowed origins are:", allowedOrigins.join(", "));
    
    // Return false instead of throwing (prevents 500 error)
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 200
};

// Apply CORS BEFORE all routes, middleware, and rate limiters
// Note: app.use(cors()) already handles preflight OPTIONS requests
app.use(cors(corsOptions));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Static uploads — only works on long-running servers, not Vercel.
// Submissions use memory storage so this is a no-op safety fallback.
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ─── HEALTH CHECK ──────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "TECHINS Work Portal API is running",
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || "development",
  });
});

app.get("/api/health", async (req, res) => {
  // Basic health check — returns 200 without touching database
  const health = {
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || "development",
  };

  // Include config check if requested
  if (req.query.check === "config") {
    if (missing.length) {
      return res.status(503).json({
        success: false,
        status: "misconfigured",
        missing_env: missing,
        message: `Missing env vars: ${missing.join(", ")}. Add them in Vercel → Settings → Environment Variables.`,
      });
    }
    health.config = "ok";
  }

  // Include database check if requested (optional deep check)
  if (req.query.check === "db" || req.query.check === "all") {
    try {
      const dbHealth = await healthCheck();
      health.database = dbHealth;
      if (!dbHealth.connected) {
        health.status = "degraded";
        return res.status(503).json(health);
      }
    } catch (error) {
      health.database = { connected: false, error: error.message };
      health.status = "degraded";
      return res.status(503).json(health);
    }
  }

  res.status(200).json(health);
});

// ─── ENV GUARD MIDDLEWARE ───────────────────────────────────────────────────
// If required env vars are missing, every request returns 503 with a clear message
app.use((req, res, next) => {
  if (missing.length) {
    return res.status(503).json({
      success: false,
      message: `Server misconfigured — missing env vars: ${missing.join(", ")}`,
      missing_env: missing,
    });
  }
  next();
});

// ─── DB MIDDLEWARE ─────────────────────────────────────────────────────────
// Lazy connection on each request - connects on first request, reuses on warm requests
// Returns 503 if connection fails, allowing retry on next request

let _initialized = false;
let _initializationPromise = null;

app.use(async (req, res, next) => {
  try {
    // Connect to database (reuses cached connection if available)
    req.db = await connect();
    
    // Ensure default accounts and CEO cleanup on first successful connection
    // This must complete BEFORE serving any login requests
    if (!_initialized && !_initializationPromise) {
      _initializationPromise = (async () => {
        try {
          console.log("[TECHINS] Running startup initialization...");
          await ensureDefaultAccounts(req.db);
          _initialized = true;
          console.log("[TECHINS] Initialization complete");
        } catch (initErr) {
          _initialized = false;
          _initializationPromise = null; // allow retry
          console.error("[TECHINS] Initialization error (non-fatal):", initErr.message);
        }
      })();
    }
    
    // Wait for initialization to complete before serving requests
    if (_initializationPromise) {
      await _initializationPromise;
    }
    
    next();
  } catch (err) {
    console.error("[DB] Connection failed for request:", req.method, req.url);
    console.error("[DB] Error:", err.message);
    return res.status(503).json({ 
      success: false, 
      message: "Database connection unavailable. Please try again in a moment.",
      hint: "Check MONGODB_URI in Vercel environment variables and MongoDB Atlas IP allowlist (0.0.0.0/0)"
    });
  }
});

// ─── ROUTES ────────────────────────────────────────────────────────────────
const authRoutes         = require("./routes/authRoutes");
const adminRoutes        = require("./routes/adminRoutes");
const taskRoutes         = require("./routes/taskRoutes");
const studentRoutes      = require("./routes/studentRoutes");
const studentsRoutes     = require("./routes/studentsRoutes");
const activityRoutes     = require("./routes/activityRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const missionRoutes      = require("./routes/missionRoutes");
const performanceRoutes  = require("./routes/performanceRoutes");
const auditRoutes        = require("./routes/auditRoutes");
const authorizedUsersRoutes = require("./routes/authorizedUsersRoutes");
const batchRoutes        = require("./routes/batchRoutes");
const cronRoutes         = require("./routes/cronRoutes");

app.use("/api/auth",         authRoutes);
app.use("/api/admin",        adminRoutes);
// Tasks and notifications are reachable with a student token (login now
// issues a limited session to pending/rejected students so they can reach
// the Waiting-for-Approval screen). requireApprovedStudent blocks ONLY
// students whose registration is pending/rejected — unlike
// checkStudentRegistrationStatus it never rejects the env-based CEO token
// (CEO legitimately uses /api/tasks).
app.use("/api/tasks",        authenticateToken, requireApprovedStudent, taskRoutes);
app.use("/api/student",      authenticateToken, checkStudentRegistrationStatus, studentRoutes);
app.use("/api/students",     studentsRoutes);
app.use("/api/activities",   activityRoutes);
app.use("/api/notifications",authenticateToken, requireApprovedStudent, notificationRoutes);
app.use("/api/missions",     missionRoutes);
app.use("/api/performance",  performanceRoutes);
app.use("/api/audit-logs",   auditRoutes);
app.use("/api/authorized-users", authorizedUsersRoutes);
app.use("/api/batches",      batchRoutes);
// Vercel Cron target. Authenticated with CRON_SECRET (NOT a user JWT) because
// a cron invocation has no signed-in user; see routes/cronRoutes.js and the
// "crons" block in server/vercel.json.
app.use("/api/cron",         cronRoutes);

// ─── 404 ───────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: "API route not found", path: req.originalUrl });
});

// ─── ERROR HANDLER ─────────────────────────────────────────────────────────
app.use((error, req, res, next) => {
  console.error("[ERROR]", error.message);
  if (error.message === "Not allowed by CORS") {
    return res.status(403).json({ success: false, message: "CORS origin not allowed" });
  }
  res.status(500).json({
    success: false,
    message: "Internal server error",
    error: process.env.NODE_ENV === "production" ? undefined : error.message,
  });
});

// ─── DEFAULT ACCOUNTS ──────────────────────────────────────────────────────
// Idempotent admin/manager account seeding using upsert.
// Reads from env vars or falls back to defaults.
// Never overwrites existing users — only creates on first run.
// 
// CEO ACCOUNT HANDLING:
// CEO is authenticated via env vars only (CEO_EMAIL, CEO_PASSWORD_HASH).
// Any documents in users collection with CEO email are removed for security.
async function ensureDefaultAccounts(db) {
  try {
    // ═══════════════════════════════════════════════════════════════════════
    // CEO AUTH SEEDING - RUNS FIRST, BEFORE ANY LOGIN REQUESTS
    // ═══════════════════════════════════════════════════════════════════════
    // CEO authentication is handled ONLY via environment variables:
    //   CEO_EMAIL         - the CEO email address
    //   CEO_PASSWORD_HASH - bcrypt hash of the CEO password (cost 12)
    //   CEO_PASSWORD      - (optional) plaintext; hash is generated on first
    //                       startup if CEO_PASSWORD_HASH is missing.
    // Never overwrites an existing hash and never touches DB users.
    const CEO_EMAIL_RAW = process.env.CEO_EMAIL || null;
    const CEO_EMAIL = CEO_EMAIL_RAW ? CEO_EMAIL_RAW.trim().toLowerCase() : null;
    const CEO_PASSWORD = process.env.CEO_PASSWORD || null;
    const CEO_PASSWORD_HASH = process.env.CEO_PASSWORD_HASH || null;

    console.log("[Accounts] CEO_EMAIL configured:", Boolean(CEO_EMAIL_RAW));

    // If CEO_PASSWORD is provided but CEO_PASSWORD_HASH is not, generate
    // the hash once and write it back to .env (idempotent on next start).
    if (CEO_EMAIL && CEO_PASSWORD && !CEO_PASSWORD_HASH) {
      try {
        const generatedHash = await bcrypt.hash(CEO_PASSWORD, 12);
        process.env.CEO_PASSWORD_HASH = generatedHash;
        // Persist to .env so subsequent starts don't regenerate
        try {
          const fs = require("fs");
          const path = require("path");
          const envPath = path.join(__dirname, ".env");
          const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
          const out = [];
          let found = false;
          for (const line of lines) {
            if (/^\s*CEO_PASSWORD_HASH\s*=/.test(line)) {
              out.push("CEO_PASSWORD_HASH=" + generatedHash);
              found = true;
            } else {
              out.push(line);
            }
          }
          if (!found) out.push("CEO_PASSWORD_HASH=" + generatedHash);
          fs.writeFileSync(envPath, out.join("\n"));
          console.log("[Accounts] CEO_PASSWORD_HASH generated from CEO_PASSWORD and saved to .env");
        } catch (envErr) {
          console.error("[Accounts] Could not persist CEO_PASSWORD_HASH to .env:", envErr.message);
        }
      } catch (hashErr) {
        console.error("[Accounts] Failed to generate CEO_PASSWORD_HASH:", hashErr.message);
      }
    }

    // Remove any DB documents with the CEO email (case-insensitive) so
    // CEO auth can NEVER be bypassed via a DB user with the same email.
    if (CEO_EMAIL) {
      try {
        const escapedEmail = CEO_EMAIL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const deleteResult = await db.collection("users").deleteMany({
          email: { $regex: new RegExp(`^${escapedEmail}$`, 'i') }
        });
        if (deleteResult.deletedCount > 0) {
          console.log(`[Accounts] ✓ Removed ${deleteResult.deletedCount} document(s) with CEO email from users collection`);
        }
      } catch (cleanupError) {
        console.error("[Accounts] CEO email cleanup error:", cleanupError.message);
      }
    } else {
      console.warn("[Accounts] CEO_EMAIL not configured - CEO login will not work");
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // ADMIN & MANAGER ACCOUNTS
    // ═══════════════════════════════════════════════════════════════════════
    const accounts = [];
    
    // Admin account
    const adminEmail = process.env.ADMIN_EMAIL ? process.env.ADMIN_EMAIL.trim().toLowerCase() : "admin@techins.com";
    const adminPassword = process.env.ADMIN_PASSWORD || "Admin@123";
    const adminName = process.env.ADMIN_NAME ? process.env.ADMIN_NAME.trim() : "TECHINS Admin";
    
    // Only create admin if it's different from CEO email
    if (!CEO_EMAIL || adminEmail !== CEO_EMAIL) {
      accounts.push({
        name: adminName,
        email: adminEmail,
        password: adminPassword,
        role: "admin",
        department: "Administration"
      });
    } else {
      console.log("[Accounts] Admin email same as CEO email - skipping admin account creation");
    }
    
    // Manager account
    const managerEmail = process.env.MANAGER_EMAIL ? process.env.MANAGER_EMAIL.trim().toLowerCase() : "manager@techins.com";
    const managerPassword = process.env.MANAGER_PASSWORD || "Manager@123";
    const managerName = process.env.MANAGER_NAME ? process.env.MANAGER_NAME.trim() : "TECHINS Manager";
    
    // Only create manager if it's different from CEO/admin
    if ((!CEO_EMAIL || managerEmail !== CEO_EMAIL) && managerEmail !== adminEmail) {
      accounts.push({
        name: managerName,
        email: managerEmail,
        password: managerPassword,
        role: "manager",
        department: process.env.MANAGER_DEPARTMENT || "Techins"
      });
    } else {
      console.log("[Accounts] Manager email same as CEO/admin - skipping manager account creation");
    }

    for (const account of accounts) {
      try {
        // Hash password with bcrypt (12 rounds for high security)
        const hashedPassword = await bcrypt.hash(account.password, 12);
        
        // Upsert: insert only if email doesn't exist, never overwrite
        // $setOnInsert ensures data is only written on insert, not on match
        const result = await db.collection("users").updateOne(
          { email: account.email },
          {
            $setOnInsert: {
              name: account.name,
              email: account.email,
              password: hashedPassword,
              role: account.role,
              department: account.department,
              active: 1,
              registration_status: "approved",
              created_at: new Date().toISOString()
            }
          },
          { upsert: true }
        );
        
        if (result.upsertedCount > 0) {
          console.log(`[Accounts] ${account.role.toUpperCase()} created: ${account.email}`);
        } else {
          console.log(`[Accounts] ${account.role.toUpperCase()} already exists: ${account.email}`);
        }
      } catch (accountError) {
        // Catch duplicate key errors on individual accounts (race condition on parallel deploys)
        if (accountError.code === 11000) {
          console.log(`[Accounts] ${account.role.toUpperCase()} already exists (duplicate key): ${account.email}`);
        } else {
          console.error(`[Accounts] Failed to ensure ${account.role} account:`, accountError.message);
        }
        // Continue to next account even if one fails
      }
    }
    
    console.log("[Accounts] Default accounts ensured successfully");
  } catch (error) {
    // Log seeding errors but don't fail initialization
    console.error("[Accounts] Error during account seeding:", error.message);
    console.warn("[Accounts] Continuing initialization despite seeding error");
    throw error; // Re-throw so initialization can retry
  }
}

// ─── LOCAL DEV ONLY ────────────────────────────────────────────────────────
// On Vercel: VERCEL env var is set, skip app.listen() (Vercel handles HTTP)
// Locally:   Start Express server with app.listen()

if (!process.env.VERCEL) {
  const PORT = Number(process.env.PORT) || 5000;
  app.listen(PORT, () => {
    console.log(`[TECHINS] Server running on http://localhost:${PORT}`);
    console.log(`[TECHINS] Database will connect on first request`);
  });
}

// ─── EXPORT FOR VERCEL ─────────────────────────────────────────────────────
// Export Express app directly - Vercel wraps it as a serverless function
// Connection happens lazily in the DB middleware on each request
module.exports = app;
