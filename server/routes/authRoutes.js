const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { ObjectId } = require("mongodb");
const { authenticateToken, authorizeRoles, getSecret } = require("../middleware/authMiddleware");
const { MAX_STUDENT_ACCOUNTS, ALLOWED_DEPARTMENTS, ALLOWED_PROGRAMS } = require("../config");
const { isStudentEmailAllowed } = require("../utils/allowlist");
const { writeAudit } = require("../utils/audit_mongo");

const router = express.Router();

function toId(id) { try { return new ObjectId(id); } catch { return id; } }

/* ─── LOGIN ─────────────────────────────────────────────────────────────── */
router.post("/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    console.log("LOGIN REQUEST:", { email, passwordReceived: Boolean(password) });

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const db = req.db;
    if (!db) return res.status(500).json({ success: false, message: "Database connection unavailable" });

    const user = await db.collection("users").findOne({ email });
    console.log("LOGIN USER FOUND:", Boolean(user));

    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    if (Number(user.active) !== 1) {
      return res.status(401).json({ success: false, message: "Account is pending CEO approval or has been deactivated" });
    }

    if (!user.password) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const passwordMatch = await bcrypt.compare(password, String(user.password));
    console.log("LOGIN PASSWORD MATCH:", passwordMatch);

    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const role = String(user.role || "").trim().toLowerCase();
    const userId = String(user._id);

    const token = jwt.sign({ id: userId, role }, getSecret(), { expiresIn: "1d" });

    console.log("LOGIN SUCCESS:", email, role);
    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: userId,
        name: user.name,
        email: user.email,
        role,
        department: user.department,
        registration_status: user.registration_status || "approved",
      },
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);
    return res.status(500).json({ success: false, message: "Login failed" });
  }
});

/* ─── GET CURRENT USER ──────────────────────────────────────────────────── */
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    const user = await db.collection("users").findOne(
      { _id: toId(req.user.id) },
      { projection: { password: 0 } }
    );
    if (!user || Number(user.active) !== 1) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    return res.json({
      success: true,
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        active: user.active,
        registration_status: user.registration_status || "approved",
      }
    });
  } catch (error) {
    console.error("GET ME ERROR:", error);
    return res.status(500).json({ success: false, message: "Unable to fetch user data" });
  }
});

/* ─── ADMIN REGISTER STUDENT ────────────────────────────────────────────── */
router.post("/register", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const department = String(req.body?.department || "").trim().toLowerCase();
    const program = req.body?.program ? String(req.body.program).trim().toLowerCase() : null;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "Name, email and password are required" });
    }
    if (!department || !ALLOWED_DEPARTMENTS.includes(department)) {
      return res.status(400).json({ success: false, message: "Valid department is required. Choose from: " + ALLOWED_DEPARTMENTS.join(", ") });
    }
    if (program && !ALLOWED_PROGRAMS.includes(program)) {
      return res.status(400).json({ success: false, message: "Invalid program. Choose from: " + ALLOWED_PROGRAMS.join(", ") });
    }

    const db = req.db;
    if (!db) return res.status(500).json({ success: false, message: "Database connection unavailable" });

    const studentCount = await db.collection("users").countDocuments({ role: "student", active: 1 });
    if (studentCount >= MAX_STUDENT_ACCOUNTS) {
      return res.status(409).json({ success: false, message: `Maximum of ${MAX_STUDENT_ACCOUNTS} students has been reached` });
    }

    const existing = await db.collection("users").findOne({ email });
    if (existing) return res.status(409).json({ success: false, message: "A user with this email already exists" });

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.collection("users").insertOne({
      name, email, password: passwordHash, role: "student",
      department, program, active: 1, registration_status: "approved",
      created_at: new Date().toISOString()
    });

    return res.status(201).json({ success: true, message: "ID created successfully", userId: String(result.insertedId) });
  } catch (error) {
    console.error("REGISTER ERROR:", error);
    if (error.code === 11000) return res.status(409).json({ success: false, message: "A user with this email already exists" });
    return res.status(500).json({ success: false, message: "Unable to create ID" });
  }
});

/* ─── PUBLIC SIGNUP ─────────────────────────────────────────────────────── */
router.post("/signup", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const role = String(req.body?.role || "student").trim().toLowerCase();
    const phone = req.body?.phone ? String(req.body.phone).trim() : null;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "Name, email and password are required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters" });
    }
    if (!["student", "manager", "ceo"].includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role. Allowed: student, manager, ceo" });
    }
    if (role === "student" && !isStudentEmailAllowed(email)) {
      return res.status(403).json({ success: false, message: "This email is not authorized to register" });
    }

    const db = req.db;
    if (!db) return res.status(500).json({ success: false, message: "Database connection unavailable" });

    const existing = await db.collection("users").findOne({ email });
    if (existing) return res.status(409).json({ success: false, message: "A user with this email already exists" });

    if (role === "student") {
      const studentCount = await db.collection("users").countDocuments({ role: "student", active: 1 });
      if (studentCount >= MAX_STUDENT_ACCOUNTS) {
        return res.status(409).json({ success: false, message: `Maximum of ${MAX_STUDENT_ACCOUNTS} students has been reached` });
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const requiresApproval = role === "manager" || role === "ceo";
    const active = requiresApproval ? 0 : 1;
    const registrationStatus = role === "student" ? "pending" : "approved";

    const result = await db.collection("users").insertOne({
      name, email, password: passwordHash, role, phone, active, registration_status: registrationStatus,
      created_at: new Date().toISOString()
    });
    const insertedId = String(result.insertedId);

    // Notify CEO/Admin users about new student registration
    if (role === "student") {
      const ceoAdmins = await db.collection("users").find(
        { role: { $in: ["admin", "ceo"] }, active: 1 },
        { projection: { _id: 1 } }
      ).toArray();
      const notifDocs = ceoAdmins.map(admin => ({
        user_id: String(admin._id),
        type: "registration_pending",
        title: "New Student Registration",
        message: `${name} (${email}) has registered and is awaiting approval.`,
        read_at: null,
        created_at: new Date().toISOString()
      }));
      if (notifDocs.length) await db.collection("notifications").insertMany(notifDocs);
    }

    await writeAudit(db, { actorId: insertedId, action: "user_registered", entityType: "user", entityId: insertedId, newValue: { name, email, role, active } });

    const message = requiresApproval
      ? "Account created successfully. Your registration is pending CEO approval."
      : "Account created successfully. You can now log in.";

    return res.status(201).json({ success: true, message, userId: insertedId, requiresApproval });
  } catch (error) {
    console.error("SIGNUP ERROR:", error);
    if (error.code === 11000) return res.status(409).json({ success: false, message: "A user with this email already exists" });
    return res.status(500).json({ success: false, message: "Unable to create account" });
  }
});

module.exports = router;
