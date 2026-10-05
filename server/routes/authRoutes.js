const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const {
  authenticateToken,
  authorizeRoles,
  getSecret,
} = require("../middleware/authMiddleware");

const { MAX_STUDENT_ACCOUNTS, ALLOWED_DEPARTMENTS, ALLOWED_PROGRAMS } = require("../config");

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

    const user = db
      .prepare(`
        SELECT
          id,
          name,
          email,
          password,
          role,
          department,
          active
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
      hashExists: Boolean(user.password),
    });

    if (Number(user.active) !== 1) {
      return res.status(401).json({
        success: false,
        message: "Account is inactive",
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
   REGISTER STUDENT
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
