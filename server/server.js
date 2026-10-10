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
  // We throw instead so every request gets a clear 503 rather than a generic 500.
}

const { connect, healthCheck } = require("./mongodb");
const { authenticateToken, checkStudentRegistrationStatus } = require("./middleware/authMiddleware");

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

app.use(async (req, res, next) => {
  try {
    // Connect to database (reuses cached connection if available)
    req.db = await connect();
    
    // Ensure default accounts on first successful connection
    if (!_initialized) {
      _initialized = true;
      setImmediate(async () => {
        try {
          await ensureDefaultAccounts(req.db);
          console.log("[TECHINS] Initialization complete");
        } catch (initErr) {
          _initialized = false; // allow retry
          console.error("[TECHINS] Initialization error (non-fatal):", initErr.message);
        }
      });
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

app.use("/api/auth",         authRoutes);
app.use("/api/admin",        adminRoutes);
app.use("/api/tasks",        authenticateToken, checkStudentRegistrationStatus, taskRoutes);
app.use("/api/student",      authenticateToken, checkStudentRegistrationStatus, studentRoutes);
app.use("/api/students",     studentsRoutes);
app.use("/api/activities",   authenticateToken, checkStudentRegistrationStatus, activityRoutes);
app.use("/api/notifications",authenticateToken, checkStudentRegistrationStatus, notificationRoutes);
app.use("/api/missions",     authenticateToken, checkStudentRegistrationStatus, missionRoutes);
app.use("/api/performance",  authenticateToken, checkStudentRegistrationStatus, performanceRoutes);
app.use("/api/audit-logs",   auditRoutes);

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
// Idempotent admin/manager/CEO account seeding using upsert.
// Reads from env vars (ADMIN_EMAIL, ADMIN_PASSWORD, CEO_EMAIL, CEO_PASSWORD, etc.) or falls back to defaults.
// Never overwrites existing users — only creates on first run.
async function ensureDefaultAccounts(db) {
  try {
    // Build accounts list from environment variables with secure defaults
    const accounts = [];
    
    // ═══════════════════════════════════════════════════════════════════════
    // CEO ACCOUNT - SPECIAL TREATMENT
    // ═══════════════════════════════════════════════════════════════════════
    // The CEO account has direct login access without registration/approval.
    // Only ONE email can be CEO. This is set via environment variables.
    const ceoEmail = process.env.CEO_EMAIL || "ceo@techins.com";
    const ceoPassword = process.env.CEO_PASSWORD || "ceo@2006";
    const ceoName = process.env.CEO_NAME || "TECHINS CEO";
    accounts.push({
      name: ceoName,
      email: ceoEmail,
      password: ceoPassword,
      role: "ceo",
      department: "Executive",
      isCEO: true  // Special flag to identify CEO account
    });
    
    // Admin account (for backward compatibility)
    const adminEmail = process.env.ADMIN_EMAIL || "admin@techins.com";
    const adminPassword = process.env.ADMIN_PASSWORD || "Admin@123";
    const adminName = process.env.ADMIN_NAME || "TECHINS Admin";
    
    // Only create admin if it's different from CEO email
    if (adminEmail !== ceoEmail) {
      accounts.push({
        name: adminName,
        email: adminEmail,
        password: adminPassword,
        role: "admin",
        department: "Administration"
      });
    }
    
    // Manager account
    const managerEmail = process.env.MANAGER_EMAIL || "manager@techins.com";
    const managerPassword = process.env.MANAGER_PASSWORD || "Manager@123";
    const managerName = process.env.MANAGER_NAME || "TECHINS Manager";
    
    // Only create manager if it's different from CEO/admin
    if (managerEmail !== ceoEmail && managerEmail !== adminEmail) {
      accounts.push({
        name: managerName,
        email: managerEmail,
        password: managerPassword,
        role: "manager",
        department: process.env.MANAGER_DEPARTMENT || "Techins"
      });
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
              is_ceo: account.isCEO || false,  // Mark CEO account
              created_at: new Date().toISOString()
            }
          },
          { upsert: true }
        );
        
        if (result.upsertedCount > 0) {
          console.log(`[Accounts] ${account.role.toUpperCase()} created: ${account.email}`);
          if (account.isCEO) {
            console.log(`[Accounts] ⚠️  CEO ACCOUNT - Direct login enabled for: ${account.email}`);
          }
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
    console.error("[Accounts] Error during account seeding (non-fatal):", error.message);
    console.error("[Accounts] Stack trace:", error.stack);
    console.warn("[Accounts] Continuing initialization despite seeding error");
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
