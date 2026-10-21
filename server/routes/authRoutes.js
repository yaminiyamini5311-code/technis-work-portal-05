const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { ObjectId } = require("mongodb");
const { authenticateToken, authorizeRoles, getSecret } = require("../middleware/authMiddleware");
const { rateLimit } = require("../middleware/rateLimit");
const { MAX_STUDENT_ACCOUNTS, ALLOWED_DEPARTMENTS, ALLOWED_PROGRAMS } = require("../config");
const { writeAudit } = require("../utils/audit_mongo");
const { createCeoNotification } = require("../utils/ceoNotification");
const {
  normalizeEmail,
  normalizeRole,
  normalizeRegistrationStatus,
  isActiveFlag,
} = require("../utils/userAccount");

const router = express.Router();

function toId(id) { try { return new ObjectId(id); } catch { return id; } }

/**
 * Timing-safe string comparison to prevent timing attacks
 * Compares strings character-by-character with constant time
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/* ─── LOGIN ─────────────────────────────────────────────────────────────── */
// Generic rate limit: 20 attempts per 15 minutes per client
router.post("/login", rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }), async (req, res) => {
  try {
    const emailRaw = String(req.body?.email || "");
    const email = normalizeEmail(emailRaw);
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CEO AUTHENTICATION - CHECKED FIRST, NO DATABASE LOOKUP
    // ═══════════════════════════════════════════════════════════════════════
    // The CEO account is authenticated ONLY via environment variables.
    // CEO credentials never touch the users collection.
    
    // Read and normalize CEO configuration
    const CEO_EMAIL_RAW = process.env.CEO_EMAIL || null;
    const CEO_EMAIL = CEO_EMAIL_RAW ? CEO_EMAIL_RAW.trim().toLowerCase() : null;
    const CEO_PASSWORD_HASH = process.env.CEO_PASSWORD_HASH ? process.env.CEO_PASSWORD_HASH.trim() : null;
    const CEO_NAME = process.env.CEO_NAME ? process.env.CEO_NAME.trim() : "TECHINS CEO";
    
    // Log CEO configuration status (never log actual values)
    console.log("[CEO AUTH] CEO_EMAIL defined:", Boolean(CEO_EMAIL_RAW));
    console.log("[CEO AUTH] CEO_PASSWORD_HASH defined:", Boolean(CEO_PASSWORD_HASH));
    console.log("[CEO AUTH] Submitted email matches CEO_EMAIL:", Boolean(CEO_EMAIL && timingSafeEqual(email, CEO_EMAIL)));
    
    // Check if this is a CEO login attempt (timing-safe email comparison)
    if (CEO_EMAIL && timingSafeEqual(email, CEO_EMAIL)) {
      console.log("[CEO AUTH] CEO login attempt detected");
      
      // Validate CEO configuration
      if (!CEO_PASSWORD_HASH) {
        console.error("[CEO AUTH] Missing CEO_PASSWORD_HASH environment variable");
        return res.status(500).json({ 
          success: false, 
          message: "Server configuration error. Contact administrator." 
        });
      }
      
      if (!process.env.JWT_SECRET) {
        console.error("[CEO AUTH] Missing JWT_SECRET environment variable");
        return res.status(500).json({ 
          success: false, 
          message: "Server configuration error. Contact administrator." 
        });
      }
      
      // Verify CEO password with bcrypt
      const passwordMatch = await bcrypt.compare(password, CEO_PASSWORD_HASH);
      
      if (!passwordMatch) {
        console.log("[CEO AUTH] Failed login attempt - incorrect password");
        return res.status(401).json({ success: false, message: "Invalid email or password" });
      }
      
      // Generate CEO JWT token (8 hour expiry, no user ID needed)
      const token = jwt.sign(
        { role: "ceo", email: CEO_EMAIL },
        getSecret(),
        { expiresIn: "8h" }
      );
      
      console.log("[CEO AUTH] ✓ CEO login successful");

      // Log CEO login to audit logs (non-blocking)
      setImmediate(async () => {
        try {
          await writeAudit(req.db, {
            actorId: "ceo",
            actorRole: "ceo",
            actorEmail: CEO_EMAIL,
            actorName: CEO_NAME,
            action: "login",
            entityType: "user",
            entityId: "ceo",
            newValue: { role: "ceo", email: CEO_EMAIL }
          });
        } catch (e) {
          console.error("[Audit] Failed to log CEO login:", e.message);
        }
      });

      return res.status(200).json({
        success: true,
        message: "CEO login successful",
        token,
        user: {
          id: "ceo",
          name: CEO_NAME,
          email: CEO_EMAIL,
          role: "ceo",
          department: "Executive",
          registration_status: "approved",
        },
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // REGULAR USER AUTHENTICATION (NON-CEO)
    // ═══════════════════════════════════════════════════════════════════════
    const db = req.db;
    if (!db) {
      return res.status(500).json({ success: false, message: "Database connection unavailable" });
    }

    const user = await db.collection("users").findOne({ email });

    if (!user) {
      // User does not exist. Generic client message (no email enumeration);
      // the reason is only visible in the server log.
      console.log("[AUTH] Login rejected: no user found for submitted email");
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    if (!user.password) {
      // Account has no password set (broken/imported row) — treat like a
      // wrong password, never reveal which accounts are usable.
      console.log("[AUTH] Login rejected: account has no password set");
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    // Password verification FIRST: account status must never be observable
    // before the caller proves knowledge of the password.
    const passwordMatch = await bcrypt.compare(password, String(user.password));

    if (!passwordMatch) {
      console.log("[AUTH] Login rejected: password mismatch");
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    // ── Account status checks (after password verification) ──
    // Robust to legacy shapes: NULL, boolean, "1"/"true" strings, casing.
    //
    // Pending/rejected STUDENTS and MANAGERS are allowed to authenticate and receive a
    // session token, but only so they can reach the dedicated "Waiting for
    // Approval" screen. Every student route is gated by
    // checkStudentRegistrationStatus / requireApprovedStudent (403
    // REGISTRATION_PENDING / REGISTRATION_REJECTED), so the token can never
    // read portal data. The frontend reads registration_status from this
    // response (and /api/auth/me) and renders the matching gate.
    // Deactivated accounts stay blocked unless awaiting approval.
    const registrationStatus = normalizeRegistrationStatus(user.registration_status);
    const role0 = normalizeRole(user.role);
    const awaitingReview =
      (role0 === "student" || role0 === "manager") &&
      (registrationStatus === "pending" || registrationStatus === "rejected");

    if (!isActiveFlag(user.active) && !awaitingReview) {
      console.log("[AUTH] Login blocked: account is deactivated");
      return res.status(401).json({
        success: false,
        message: "Your account has been deactivated"
      });
    }

    if (awaitingReview) {
      console.log(`[AUTH] Login granted to ${registrationStatus} ${role0} — portal routes remain gated`);
    }

    const role = normalizeRole(user.role);
    const userId = String(user._id);

    // Generate JWT token with user ID and role (1 day expiry for regular users)
    const token = jwt.sign({ id: userId, role }, getSecret(), { expiresIn: "1d" });

    console.log("[AUTH] Login successful:", role);

    // Log user login to audit logs (non-blocking)
    setImmediate(async () => {
      try {
        await writeAudit(db, {
          actorId: userId,
          actorRole: role,
          actorEmail: user.email,
          actorName: user.name,
          action: "login",
          entityType: "user",
          entityId: userId,
          newValue: { role, email: user.email }
        });
      } catch (e) {
        console.error("[Audit] Failed to log user login:", e.message);
      }
    });

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
    console.error("[AUTH] Login error:", error.message);
    return res.status(500).json({ success: false, message: "Login failed" });
  }
});

/* ─── GET CURRENT USER ──────────────────────────────────────────────────── */
router.get("/me", authenticateToken, async (req, res) => {
  try {
    // CEO tokens don't have database records - return from token data
    if (req.user.role === "ceo") {
      const CEO_EMAIL = process.env.CEO_EMAIL ? process.env.CEO_EMAIL.trim().toLowerCase() : "ceo@techins.com";
      const CEO_NAME = process.env.CEO_NAME ? process.env.CEO_NAME.trim() : "TECHINS CEO";

      // Prefer the name saved on the CEO profile page (see /api/admin/profile)
      // so /me and the profile screen agree and a reload does not reset it to
      // the environment default. Email and role stay env/token sourced.
      let name = CEO_NAME;
      let phone = null;
      let avatar = null;
      try {
        const saved = await req.db.collection("ceo_profile").findOne({ _id: "ceo" });
        if (saved) {
          name = saved.name || CEO_NAME;
          phone = saved.phone || null;
          avatar = saved.avatar || null;
        }
      } catch (e) {
        console.error("CEO profile lookup failed, falling back to env:", e.message);
      }

      return res.json({
        success: true,
        user: {
          id: "ceo",
          name,
          email: CEO_EMAIL,
          role: "ceo",
          phone,
          avatar,
          department: "Executive",
          active: 1,
          registration_status: "approved",
        }
      });
    }
    
    // Regular user - lookup in database.
    // NOTE: inactive/pending users must still be able to read their own
    // record: the frontend's RegistrationStatusGate polls /me to display
    // the Waiting-for-Approval screen. Returning 404 here would hide the
    // very status the student needs. Only the token-verified owner can
    // read this record, so no data is exposed.
    const db = req.db;
    const user = await db.collection("users").findOne(
      { _id: toId(req.user.id) },
      { projection: { password: 0 } }
    );
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Resolve batch membership (id + name) for the auth payload
    let batch = null;
    if (user.batch_id) {
      const batchDoc = await db.collection("batches").findOne(
        { _id: toId(user.batch_id) },
        { projection: { name: 1, active: 1 } }
      );
      if (batchDoc) batch = { id: String(batchDoc._id), name: batchDoc.name, active: batchDoc.active !== false };
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
        batch,
      }
    });
  } catch (error) {
    console.error("[AUTH] Get user error:", error.message);
    return res.status(500).json({ success: false, message: "Unable to fetch user data" });
  }
});

/* ─── ADMIN REGISTER STUDENT ────────────────────────────────────────────── */
router.post("/register", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = normalizeEmail(req.body?.email);
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
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const role = normalizeRole(req.body?.role || "student");
    const phone = req.body?.phone ? String(req.body.phone).trim() : null;
    const batchId = req.body?.batchId ? String(req.body.batchId).trim() : null;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "Name, email and password are required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters" });
    }
    // Email format (client mirrors this; server is the authority)
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, message: "Enter a valid email address" });
    }
    // Mobile format: optional in general, required for students (matches the
    // signup form). Accepts +country prefixes, spaces, dashes, 7-15 digits.
    const PHONE_RE = /^\+?[0-9\s-]{7,15}$/;
    const digits = phone ? phone.replace(/[^0-9]/g, "") : "";
    if (role === "student" && !digits) {
      return res.status(400).json({ success: false, message: "Phone number is required for students" });
    }
    if (phone && (!PHONE_RE.test(phone) || digits.length < 7 || digits.length > 15)) {
      return res.status(400).json({ success: false, message: "Enter a valid mobile number (7-15 digits)" });
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // CEO ACCOUNT PROTECTION
    // ═══════════════════════════════════════════════════════════════════════
    // NO ONE can register as CEO or use the CEO email via public signup
    const CEO_EMAIL = process.env.CEO_EMAIL ? process.env.CEO_EMAIL.trim().toLowerCase() : null;
    
    if (role === "ceo") {
      console.error("[SECURITY] Attempt to register as CEO via signup");
      return res.status(403).json({ 
        success: false, 
        message: "CEO accounts cannot be created through registration. Contact system administrator." 
      });
    }
    
    if (CEO_EMAIL && email === CEO_EMAIL) {
      console.error("[SECURITY] Attempt to register with CEO email");
      return res.status(403).json({ 
        success: false, 
        message: "This email address is reserved and cannot be used for registration." 
      });
    }
    
    if (!["student", "manager"].includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role. Allowed: student, manager" });
    }

    // ── BATCH VALIDATION (students must join an active batch) ──
    // Never trust the client: the batch must exist and be active.
    let batchRecord = null;
    if (role === "student") {
      if (!batchId) {
        return res.status(400).json({ success: false, message: "Batch selection is required" });
      }
      const dbPre = req.db;
      const { ObjectId: Oid } = require("mongodb");
      let batchOid;
      try { batchOid = new Oid(batchId); } catch { batchOid = null; }
      if (!batchOid) {
        return res.status(400).json({ success: false, message: "Invalid batch selected" });
      }
      batchRecord = await dbPre.collection("batches").findOne({ _id: batchOid });
      if (!batchRecord) {
        return res.status(400).json({ success: false, message: "Selected batch does not exist" });
      }
      if (batchRecord.active === false) {
        return res.status(400).json({ success: false, message: "Selected batch is no longer accepting students" });
      }
    }

    // NOTE: Signup is open to all emails. Authorization is enforced only for CEO Portal notifications.
    // Only emails in the authorized_users collection will trigger CEO notifications.
    // See utils/ceoNotification.js for authorization logic.

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

    // ── Account defaults (single source of truth: utils/userAccount.js) ──
    // Students start INACTIVE + PENDING: they cannot log in until an
    // admin/CEO approves the registration (approve-registration sets
    // active=1 AND registration_status="approved"). Managers keep the
    // previous behaviour (inactive until an admin activates the account).
    const requiresApproval = role === "student" || role === "manager";
    const active = requiresApproval ? 0 : 1;
    const registrationStatus = "pending";

    const result = await db.collection("users").insertOne({
      name, email, password: passwordHash, role, phone, active, registration_status: registrationStatus,
      batch_id: batchRecord ? String(batchRecord._id) : null,
      program: batchRecord ? String(batchRecord.name) : null,
      created_at: new Date().toISOString()
    });
    const insertedId = String(result.insertedId);

    // Student joined a batch: materialize assignments for that batch's active tasks
    if (batchRecord) {
      const { createAssignmentsForStudent } = require("../models/TaskAssignment");
      await createAssignmentsForStudent(db, insertedId, String(batchRecord._id));
    }

    // Notify CEO/Admin users about new registration (with authorization check)
    if (role === "student" || role === "manager") {
      await createCeoNotification(db, email, {
        type: "registration_pending",
        title: role === "student" ? "New Student Registration" : "New Manager Registration",
        message: `${name} (${email}) has registered as ${role} and is awaiting approval.`
      });
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
