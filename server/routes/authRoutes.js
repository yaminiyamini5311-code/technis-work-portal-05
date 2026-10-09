const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const {
  authenticateToken,
  authorizeRoles,
  getSecret,
} = require("../middleware/authMiddleware");

const { MAX_STUDENT_ACCOUNTS, ALLOWED_DEPARTMENTS, ALLOWED_PROGRAMS } = require("../config");
const { isStudentEmailAllowed } = require("../utils/allowlist");
const { runInTransaction } = require("../database");

const router = express.Router();

/* =========================================================
   LOGIN
   POST /api/auth/login
========================================================= */
router.post("/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();

    const password = String(req.body?.password || "");

    console.log("LOGIN REQUEST:", {
      email,
      passwordReceived: Boolean(password),
      passwordLength: password ? password.length : 0
    });

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const db = req.app.locals.db;

    if (!db) {
      console.error("LOGIN ERROR: Database unavailable");

      return res.status(500).json({
        success: false,
        message: "Database connection unavailable",
      });
    }

    console.log("LOGIN: Querying database for email:", email);

    const user = db
      .prepare(`
        SELECT
          id,
          name,
          email,
          password,
          role,
          department,
          active,
          registration_status
        FROM users
        WHERE LOWER(TRIM(email)) = ?
        LIMIT 1
      `)
      .get(email);

    console.log("LOGIN USER FOUND:", Boolean(user));

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    console.log("LOGIN USER:", {
      id: user.id,
      email: user.email,
      role: user.role,
      active: user.active,
      registration_status: user.registration_status,
      hashExists: Boolean(user.password),
    });

    if (Number(user.active) !== 1) {
      return res.status(401).json({
        success: false,
        message: "Account is pending CEO approval or has been deactivated",
      });
    }

    if (!user.password) {
      console.error(
        "LOGIN ERROR: User has no password hash"
      );

      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const passwordMatch = await bcrypt.compare(
      password,
      String(user.password)
    );

    console.log(
      "LOGIN PASSWORD MATCH:",
      passwordMatch
    );

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const role = String(
      user.role || ""
    ).trim().toLowerCase();

    const token = jwt.sign(
      {
        id: Number(user.id),
        role,
      },
      getSecret(),
      {
        expiresIn: "1d",
      }
    );

    console.log(
      "LOGIN SUCCESS:",
      email,
      role
    );

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role,
        department: user.department,
        registration_status: user.registration_status || "approved",
      },
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Login failed",
      error:
        process.env.NODE_ENV === "production"
          ? undefined
          : error.message,
    });
  }
});

/* =========================================================
   GET CURRENT USER
   GET /api/auth/me
   Returns current user's data including registration_status
========================================================= */
router.get("/me", authenticateToken, (req, res) => {
  try {
    const db = req.app.locals.db;
    
    const user = db.prepare(`
      SELECT id, name, email, role, department, active, registration_status
      FROM users
      WHERE id = ?
      LIMIT 1
    `).get(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    return res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        active: user.active,
        registration_status: user.registration_status || "approved"
      }
    });
  } catch (error) {
    console.error("GET ME ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch user data"
    });
  }
});

/* =========================================================
   REGISTER STUDENT (ADMIN)
   POST /api/auth/register
   ADMIN ONLY
========================================================= */
router.post(
  "/register",
  authenticateToken,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const name = String(req.body?.name || "").trim();
      const email = String(req.body?.email || "")
        .trim()
        .toLowerCase();
      const password = String(req.body?.password || "");
      const department = String(
        req.body?.department || ""
      ).trim().toLowerCase();
      const program = req.body?.program ? String(req.body.program).trim().toLowerCase() : null;

      if (!name || !email || !password) {
        return res.status(400).json({
          success: false,
          message:
            "Name, email and password are required",
        });
      }

      if (!department || !ALLOWED_DEPARTMENTS.includes(department)) {
        return res.status(400).json({
          success: false,
          message:
            "Valid department is required. Choose from: " + ALLOWED_DEPARTMENTS.join(", "),
        });
      }

      if (program && !ALLOWED_PROGRAMS.includes(program)) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid program. Choose from: " + ALLOWED_PROGRAMS.join(", "),
        });
      }

      const requestedRole = String(
        req.body?.role || "student"
      )
        .trim()
        .toLowerCase();

      if (requestedRole !== "student") {
        return res.status(403).json({
          success: false,
          message:
            "Only student accounts can be created from the admin portal",
        });
      }

      const db = req.app.locals.db;

      if (!db) {
        return res.status(500).json({
          success: false,
          message:
            "Database connection unavailable",
        });
      }

      const studentCount = db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM users
          WHERE LOWER(role) = 'student'
          AND active = 1
        `)
        .get();

      if (Number(studentCount?.count || 0) >= MAX_STUDENT_ACCOUNTS) {
        return res.status(409).json({
          success: false,
          message:
            `Maximum of ${MAX_STUDENT_ACCOUNTS} students has been reached`,
        });
      }

      const existingUser = db
        .prepare(`
          SELECT id
          FROM users
          WHERE LOWER(TRIM(email)) = ?
          LIMIT 1
        `)
        .get(email);

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message:
            "A user with this email already exists",
        });
      }

      const passwordHash = await bcrypt.hash(
        password,
        10
      );

      const result = db
        .prepare(`
          INSERT INTO users
          (
            name,
            email,
            password,
            role,
            department,
            program,
            active
          )
          VALUES (?, ?, ?, 'student', ?, ?, 1)
        `)
        .run(
          name,
          email,
          passwordHash,
          department,
          program
        );

      return res.status(201).json({
        success: true,
        message:
          "ID created successfully",
        userId: Number(
          result.lastInsertRowid
        ),
      });
    } catch (error) {
      console.error(
        "REGISTER ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to create ID",
      });
    }
  }
);

/* =========================================================
   PUBLIC REGISTRATION
   POST /api/auth/signup
   Students, Managers, CEOs (not Admin)
========================================================= */
router.post("/signup", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const role = String(req.body?.role || "student").trim().toLowerCase();
    const phone = req.body?.phone ? String(req.body.phone).trim() : null;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email and password are required",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters",
      });
    }

    // Validate role
    const allowedRoles = ["student", "manager", "ceo"];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role. Allowed: student, manager, ceo",
      });
    }

    // Admin accounts cannot be created through public registration
    if (role === "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin accounts cannot be created through public registration",
      });
    }

    // ALLOWLIST CHECK: Only for student role
    if (role === "student" && !isStudentEmailAllowed(email)) {
      return res.status(403).json({
        success: false,
        message: "This email is not authorized to register",
      });
    }

    const db = req.app.locals.db;

    if (!db) {
      return res.status(500).json({
        success: false,
        message: "Database connection unavailable",
      });
    }

    // Check for existing email
    const existingUser = db
      .prepare(`
        SELECT id
        FROM users
        WHERE LOWER(TRIM(email)) = ?
        LIMIT 1
      `)
      .get(email);

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "A user with this email already exists",
      });
    }

    // Check student limit for student registrations
    if (role === "student") {
      const studentCount = db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM users
          WHERE LOWER(role) = 'student'
          AND active = 1
        `)
        .get();

      if (Number(studentCount?.count || 0) >= MAX_STUDENT_ACCOUNTS) {
        return res.status(409).json({
          success: false,
          message: `Maximum of ${MAX_STUDENT_ACCOUNTS} students has been reached`,
        });
      }
    }

    // Hash password outside the transaction (bcrypt is slow)
    const passwordHash = await bcrypt.hash(password, 12);

    // Manager and CEO accounts require admin approval (active = 0)
    // Students start with active = 1 but registration_status = 'pending'
    const requiresApproval = role === "manager" || role === "ceo";
    const active = requiresApproval ? 0 : 1;
    const registrationStatus = role === "student" ? "pending" : "approved";

    let insertedId;
    try {
      insertedId = runInTransaction(db, () => {
        // Re-check student limit inside transaction for student role
        if (role === "student") {
          const studentCount = db
            .prepare(
              "SELECT COUNT(*) AS count FROM users WHERE LOWER(role) = 'student' AND active = 1"
            )
            .get();
          if (Number(studentCount?.count || 0) >= MAX_STUDENT_ACCOUNTS) {
            const err = new Error(`Student limit reached (${MAX_STUDENT_ACCOUNTS}).`);
            err.code = "LIMIT_REACHED";
            throw err;
          }
        }

        // Re-check email uniqueness inside transaction
        const dupCheck = db
          .prepare("SELECT id FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1")
          .get(email);
        if (dupCheck) {
          const err = new Error("A user with this email already exists");
          err.code = "DUPLICATE_EMAIL";
          throw err;
        }

        const result = db
          .prepare(
            "INSERT INTO users (name, email, password, role, phone, active, registration_status) VALUES (?, ?, ?, ?, ?, ?, ?)"
          )
          .run(name, email, passwordHash, role, phone, active, registrationStatus);

        const userId = Number(result.lastInsertRowid);

        // Notify all CEO/Admin users about new student registration
        if (role === "student") {
          const ceoAdmins = db.prepare(
            "SELECT id FROM users WHERE LOWER(role) IN ('admin', 'ceo') AND active = 1"
          ).all();
          
          const notifyStmt = db.prepare(
            "INSERT INTO notifications (user_id, type, title, message, created_at) VALUES (?, ?, ?, ?, ?)"
          );
          
          for (const admin of ceoAdmins) {
            notifyStmt.run(
              admin.id,
              "registration_pending",
              "New Student Registration",
              `${name} (${email}) has registered and is awaiting approval.`,
              new Date().toISOString()
            );
          }
        }

        return userId;
      });
    } catch (txErr) {
      if (txErr.code === "LIMIT_REACHED") {
        return res.status(409).json({
          success: false,
          message: `Student limit reached (${MAX_STUDENT_ACCOUNTS}). No more student accounts can be created.`,
        });
      }
      if (txErr.code === "DUPLICATE_EMAIL") {
        return res.status(409).json({
          success: false,
          message: "A user with this email already exists",
        });
      }
      throw txErr;
    }

    // Write audit log after transaction commits
    const { writeAudit } = require("../utils/audit");
    writeAudit(db, {
      actorId: insertedId,
      action: "user_registered",
      entityType: "user",
      entityId: insertedId,
      newValue: { name, email, role, active },
    });

    const message = requiresApproval
      ? "Account created successfully. Your registration is pending CEO approval."
      : "Account created successfully. You can now log in.";

    return res.status(201).json({
      success: true,
      message,
      userId: insertedId,
      requiresApproval,
    });
  } catch (error) {
    console.error("SIGNUP ERROR:", error);
    console.error("SIGNUP ERROR STACK:", error.stack);
    
    // Provide more specific error message without exposing internals
    let errorMessage = "Unable to create account";
    if (error.message && error.message.includes("UNIQUE constraint failed")) {
      errorMessage = "A user with this email already exists";
    } else if (error.message && error.message.includes("database")) {
      errorMessage = "Database error occurred. Please try again.";
    }
    
    return res.status(500).json({
      success: false,
      message: errorMessage,
      ...(process.env.NODE_ENV !== "production" && { debug: error.message })
    });
  }
});

/* =========================================================
   CURRENT USER
   GET /api/auth/me
========================================================= */
router.get(
  "/me",
  authenticateToken,
  (req, res) => {
    try {
      const db = req.app.locals.db;

      if (!db) {
        return res.status(500).json({
          success: false,
          message:
            "Database connection unavailable",
        });
      }

      const user = db
        .prepare(`
          SELECT
            id,
            name,
            email,
            role,
            department,
            active
          FROM users
          WHERE id = ?
          LIMIT 1
        `)
        .get(Number(req.user.id));

      if (
        !user ||
        Number(user.active) !== 1
      ) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      return res.status(200).json({
        success: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          department: user.department,
        },
      });
    } catch (error) {
      console.error(
        "ME ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to fetch user",
      });
    }
  }
);

module.exports = router;
