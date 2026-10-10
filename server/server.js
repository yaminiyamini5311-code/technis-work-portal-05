const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const path = require("path");

dotenv.config();

if (!process.env.JWT_SECRET) {
  console.error("JWT_SECRET is missing. Add it to environment variables.");
  process.exit(1);
}

if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is missing. Add it to environment variables.");
  process.exit(1);
}

const { connect, healthCheck } = require("./mongodb");
const { authenticateToken, checkStudentRegistrationStatus } = require("./middleware/authMiddleware");

const app = express();
const PORT = Number(process.env.PORT) || 5000;

// ─── CORS ──────────────────────────────────────────────────────────────────
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5176",
  "https://technis-work-portal-05.vercel.app",
  "https://technis-work-portal-05-ep1h6tgcr.vercel.app",
];

if (process.env.FRONTEND_URL) {
  const extraOrigins = process.env.FRONTEND_URL.split(",").map(u => u.trim()).filter(Boolean);
  allowedOrigins.push(...extraOrigins);
}

console.log("Allowed CORS origins:", allowedOrigins);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.log("Blocked CORS origin:", origin);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ─── HEALTH CHECK ──────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.status(200).json({ success: true, message: "TECHINS Work Portal API is running", timestamp: new Date().toISOString() });
});

app.get("/api/health", async (req, res) => {
  try {
    const dbHealth = await healthCheck();
    res.status(dbHealth.connected ? 200 : 503).json({
      success: dbHealth.connected,
      status: dbHealth.connected ? "healthy" : "unhealthy",
      timestamp: new Date().toISOString(),
      database: dbHealth,
    });
  } catch (error) {
    res.status(503).json({ success: false, status: "unhealthy", error: error.message });
  }
});

// ─── DB MIDDLEWARE ─────────────────────────────────────────────────────────
// Attach MongoDB db to req before routes
app.use(async (req, res, next) => {
  try {
    req.db = await connect();
    next();
  } catch (err) {
    console.error("[DB] Connection failed:", err.message);
    return res.status(503).json({ success: false, message: "Database connection unavailable" });
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

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/tasks", authenticateToken, checkStudentRegistrationStatus, taskRoutes);
app.use("/api/student", authenticateToken, checkStudentRegistrationStatus, studentRoutes);
app.use("/api/students", studentsRoutes);
app.use("/api/activities", authenticateToken, checkStudentRegistrationStatus, activityRoutes);
app.use("/api/notifications", authenticateToken, checkStudentRegistrationStatus, notificationRoutes);
app.use("/api/missions", authenticateToken, checkStudentRegistrationStatus, missionRoutes);
app.use("/api/performance", authenticateToken, checkStudentRegistrationStatus, performanceRoutes);
app.use("/api/audit-logs", auditRoutes);

// ─── 404 ───────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: "API route not found", path: req.originalUrl });
});

// ─── ERROR HANDLER ─────────────────────────────────────────────────────────
app.use((error, req, res, next) => {
  console.error("SERVER ERROR:", error);
  if (error.message === "Not allowed by CORS") {
    return res.status(403).json({ success: false, message: "CORS origin not allowed" });
  }
  res.status(500).json({
    success: false,
    message: "Internal server error",
    error: process.env.NODE_ENV === "production" ? undefined : error.message,
  });
});

// ─── DEFAULT ACCOUNTS (ensure CEO & Manager exist) ────────────────────────
async function ensureDefaultAccounts() {
  try {
    const db = await connect();
    const accounts = [
      { name: "TECHINS Admin", email: "ceo@techins.com", password: "ceo@2006", role: "admin", department: "Administration" },
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
        console.log(`${account.role.toUpperCase()} account updated: ${account.email}`);
      } else {
        await db.collection("users").insertOne({
          name: account.name,
          email: account.email,
          password: hashedPassword,
          role: account.role,
          department: account.department,
          active: 1,
          registration_status: "approved",
          created_at: new Date().toISOString()
        });
        console.log(`${account.role.toUpperCase()} account created: ${account.email}`);
      }
    }
    console.log("=== TECHINS DEFAULT ACCOUNTS READY ===");
  } catch (err) {
    console.error("Default account setup failed:", err.message);
    process.exit(1);
  }
}

// ─── START ─────────────────────────────────────────────────────────────────
async function start() {
  try {
    await connect();
    await ensureDefaultAccounts();
    app.listen(PORT, () => {
      console.log(`TECHINS server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err.message);
    process.exit(1);
  }
}

start();
