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

// ─── CORS ──────────────────────────────────────────────────────────────────
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5176",
  "https://technis-work-portal-05.vercel.app",
  "https://technis-work-portal-05-ep1h6tgcr.vercel.app",
  "https://technis-portal-server.vercel.app",
];

if (process.env.FRONTEND_URL) {
  process.env.FRONTEND_URL
    .split(",")
    .map(u => u.trim())
    .filter(Boolean)
    .forEach(u => allowedOrigins.push(u));
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.warn("[CORS] Blocked origin:", origin);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

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
app.use(async (req, res, next) => {
  try {
    req.db = await connect();
    next();
  } catch (err) {
    console.error("[DB] Connection failed:", err.message);
    return res.status(503).json({ success: false, message: "Database connection unavailable. Check MONGODB_URI in Vercel env vars." });
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
async function ensureDefaultAccounts(db) {
  const accounts = [
    { name: "TECHINS Admin",   email: "ceo@techins.com",     password: "ceo@2006",    role: "admin",   department: "Administration" },
    { name: "TECHINS Manager", email: "manager@techins.com", password: "Manager@123", role: "manager", department: "Techins" },
  ];
  for (const account of accounts) {
    const existing = await db.collection("users").findOne({ email: account.email });
    const hashedPassword = await bcrypt.hash(account.password, 12);
    if (existing) {
      await db.collection("users").updateOne(
        { email: account.email },
        { $set: { name: account.name, password: hashedPassword, role: account.role, department: account.department, active: 1 } }
      );
    } else {
      await db.collection("users").insertOne({
        name: account.name, email: account.email, password: hashedPassword,
        role: account.role, department: account.department, active: 1,
        registration_status: "approved", created_at: new Date().toISOString()
      });
    }
    console.log(`[Accounts] ${account.role.toUpperCase()} ready: ${account.email}`);
  }
}

// ─── VERCEL SERVERLESS ENTRY ────────────────────────────────────────────────
// On Vercel: module.exports = app  (no app.listen — Vercel handles the HTTP layer)
// Locally:   start() calls app.listen()

let _initialized = false;

// Lazy init — runs once on first warm request, then reuses the connection
async function initOnce() {
  if (_initialized) return;
  _initialized = true;
  try {
    console.log("[TECHINS] Initializing serverless function...");
    const db = await connect();
    console.log("[TECHINS] Database connected");
    await ensureDefaultAccounts(db);
    console.log("[TECHINS] Server initialized successfully");
  } catch (err) {
    _initialized = false; // allow retry on next request
    console.error("[TECHINS] Initialization failed");
    console.error("[TECHINS] Error message:", err.message);
    console.error("[TECHINS] Stack trace:", err.stack);
    // Don't throw — let the request continue and get caught by middleware
  }
}

// Wrap app to trigger lazy init before the first real request
const handler = async (req, res) => {
  await initOnce();
  return app(req, res);
};

// ─── LOCAL DEV ─────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== "production") {
  const PORT = Number(process.env.PORT) || 5000;
  (async () => {
    try {
      console.log("[TECHINS] Starting local development server...");
      const db = await connect();
      console.log("[TECHINS] Database connected successfully");
      await ensureDefaultAccounts(db);
      console.log("[TECHINS] Default accounts ensured");
      app.listen(PORT, () => {
        console.log(`[TECHINS] Server running on http://localhost:${PORT}`);
      });
    } catch (err) {
      console.error("[TECHINS] Failed to start server");
      console.error("[TECHINS] Error message:", err.message);
      console.error("[TECHINS] Stack trace:", err.stack);
      console.error("[TECHINS] If this is a database error, check your MONGODB_URI in .env");
      process.exit(1);
    }
  })();
}

// ─── EXPORT FOR VERCEL ─────────────────────────────────────────────────────
// Vercel imports this file and calls the exported function as an HTTP handler.
module.exports = handler;
