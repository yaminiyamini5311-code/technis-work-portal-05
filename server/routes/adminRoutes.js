const express = require("express");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const { MAX_STUDENT_ACCOUNTS } = require("../config");

const router = express.Router();

/* =========================================================
   GET ADMIN STATS
   GET /api/admin/stats
========================================================= */
router.get("/stats", authenticateToken, authorizeRoles("admin", "manager"), (req, res) => {
  try {
    const db = req.app.locals.db;

    const today = new Date().toISOString().slice(0, 10);
    
    const stats = {
      students: db.prepare("SELECT COUNT(*) AS count FROM users WHERE LOWER(role) = 'student' AND active = 1").get().count || 0,
      maxStudents: MAX_STUDENT_ACCOUNTS,
      tasks: db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count || 0,
      missions: db.prepare("SELECT COUNT(*) AS count FROM missions").get().count || 0,
      activities: db.prepare("SELECT COUNT(*) AS count FROM daily_activities").get().count || 0,
      activitiesToday: db.prepare("SELECT COUNT(*) AS count FROM daily_activities WHERE date = ?").get(today).count || 0,
      completedTasks: db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE workflow_status = 'Approved'").get().count || 0,
      pendingTasks: db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE workflow_status IN ('Assigned', 'Acknowledged')").get().count || 0,
      inProgressTasks: db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE workflow_status IN ('In Progress', 'Submitted', 'Under Review', 'Revision Required', 'Resubmitted')").get().count || 0,
    };

    res.json({ success: true, stats });
  } catch (error) {
    console.error("Admin stats error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch stats" });
  }
});

/* =========================================================
   GET ADMIN PROGRESS
   GET /api/admin/progress?period=week|month
========================================================= */
router.get("/progress", authenticateToken, authorizeRoles("admin", "manager"), (req, res) => {
  try {
    const db = req.app.locals.db;
    const period = String(req.query?.period || "week").toLowerCase();
    
    let days = 7;
    if (period === "month") days = 30;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().slice(0, 10);

    // Get daily task completion counts
    const progress = db.prepare(`
      SELECT 
        DATE(updated_at) AS date,
        COUNT(*) AS count
      FROM tasks
      WHERE workflow_status = 'Approved'
        AND DATE(updated_at) >= ?
      GROUP BY DATE(updated_at)
      ORDER BY date ASC
    `).all(startDateStr);

    res.json({ success: true, progress, period, days });
  } catch (error) {
    console.error("Admin progress error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch progress" });
  }
});

/* =========================================================
   GET STUDENTS
   GET /api/admin/students
========================================================= */
router.get("/students", authenticateToken, authorizeRoles("admin", "manager"), (req, res) => {
  try {
    const db = req.app.locals.db;

    const students = db.prepare(`
      SELECT
        id,
        name,
        email,
        department,
        program,
        created_at,
        active
      FROM users
      WHERE LOWER(role) = 'student'
      ORDER BY name ASC
    `).all();

    // Count only active+pending (not rejected/deleted) toward the limit.
    // Active students (active=1) are full members.
    // There are no "pending" students in this flow (admin creates directly).
    const activeCount = db.prepare(
      "SELECT COUNT(*) AS count FROM users WHERE LOWER(role) = 'student' AND active = 1"
    ).get().count || 0;

    res.json({
      success: true,
      students,
      total: activeCount,
      limit: MAX_STUDENT_ACCOUNTS,
    });
  } catch (error) {
    console.error("Admin students error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch students" });
  }
});


/* =========================================================
   CREATE STUDENT
   POST /api/admin/students
========================================================= */
router.post("/students", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { name, email, password, department, program } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "Name, email, and password are required" });
    }

    // Validate department/program exclusivity
    if (department && program) {
      return res.status(400).json({ success: false, message: "Cannot select both Department and Program. Choose one." });
    }

    // Hash password before entering the transaction (bcrypt is slow, keep outside)
    const bcrypt = require("bcryptjs");
    const hashedPassword = await bcrypt.hash(String(password), 12);

    // Wrap limit check + INSERT in a transaction to prevent concurrent over-creation.
    // NOTE: db.transaction(callback) in this project executes immediately and returns
    //       the callback's return value (it is NOT like better-sqlite3 which returns a fn).
    let studentId;
    try {
      studentId = db.transaction(() => {
        // Re-check email uniqueness inside the transaction
        const existing = db.prepare(
          "SELECT id FROM users WHERE LOWER(TRIM(email)) = ?"
        ).get(String(email).trim().toLowerCase());
        if (existing) {
          const err = new Error("Email already exists");
          err.code = "DUPLICATE_EMAIL";
          throw err;
        }

        // Re-count inside the transaction so two concurrent requests cannot
        // both pass the limit check and both insert the 100th student.
        const studentCount = db.prepare(
          "SELECT COUNT(*) AS count FROM users WHERE LOWER(role) = 'student' AND active = 1"
        ).get().count || 0;

        if (studentCount >= MAX_STUDENT_ACCOUNTS) {
          const err = new Error(`Student limit reached (${MAX_STUDENT_ACCOUNTS}). Cannot create more student accounts.`);
          err.code = "LIMIT_REACHED";
          throw err;
        }

        const result = db.prepare(`
          INSERT INTO users (name, email, password, role, department, program, active)
          VALUES (?, ?, ?, 'student', ?, ?, 1)
        `).run(
          String(name).trim(),
          String(email).trim().toLowerCase(),
          hashedPassword,
          department ? String(department).trim().toLowerCase() : null,
          program ? String(program).trim().toLowerCase() : null
        );

        return Number(result.lastInsertRowid);
      });
    } catch (txErr) {
      if (txErr.code === "DUPLICATE_EMAIL") {
        return res.status(409).json({ success: false, message: "Email already exists" });
      }
      if (txErr.code === "LIMIT_REACHED") {
        return res.status(409).json({ success: false, message: txErr.message });
      }
      throw txErr; // Re-throw unexpected errors to the outer catch
    }

    // Fetch the created student to return the real DB row (not an echo of input)
    const created = db.prepare(
      "SELECT id, name, email, department, program, created_at, active FROM users WHERE id = ?"
    ).get(studentId);

    res.status(201).json({
      success: true,
      message: "Student created successfully",
      studentId,
      student: created,
    });
  } catch (error) {
    console.error("Create student error:", error);
    res.status(500).json({ success: false, message: "Unable to create student" });
  }
});



/* =========================================================
   GET PENDING APPROVALS
   GET /api/admin/pending-approvals
========================================================= */
router.get("/pending-approvals", authenticateToken, authorizeRoles("admin", "ceo"), (req, res) => {
  try {
    const db = req.app.locals.db;

    const pending = db.prepare(`
      SELECT
        id,
        name,
        email,
        role,
        phone,
        created_at
      FROM users
      WHERE active = 0
      ORDER BY created_at DESC
    `).all();

    res.json({ success: true, pending });
  } catch (error) {
    console.error("Pending approvals error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch pending approvals" });
  }
});

/* =========================================================
   APPROVE USER
   POST /api/admin/approve-user/:id
========================================================= */
router.post("/approve-user/:id", authenticateToken, authorizeRoles("admin", "ceo"), (req, res) => {
  try {
    const db = req.app.locals.db;
    const userId = Number(req.params.id);

    const user = db.prepare("SELECT id, name, email, role FROM users WHERE id = ?").get(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (Number(user.active) === 1) {
      return res.status(400).json({ success: false, message: "User is already active" });
    }

    db.prepare("UPDATE users SET active = 1 WHERE id = ?").run(userId);

    // Write audit log
    const { writeAudit } = require("../utils/audit");
    writeAudit(db, {
      actorId: req.user.id,
      action: "user_approved",
      entityType: "user",
      entityId: userId,
      newValue: { name: user.name, email: user.email, role: user.role, active: 1 },
    });

    res.json({ success: true, message: "User approved successfully" });
  } catch (error) {
    console.error("Approve user error:", error);
    res.status(500).json({ success: false, message: "Unable to approve user" });
  }
});

/* =========================================================
   GET FEEDBACK
   GET /api/admin/feedback
========================================================= */
router.get("/feedback", authenticateToken, authorizeRoles("admin", "manager"), (req, res) => {
  try {
    const db = req.app.locals.db;

    const feedback = db.prepare(`
      SELECT
        t.id,
        t.task_code,
        t.title,
        t.feedback,
        t.updated_at,
        u.name AS student_name,
        u.email AS student_email
      FROM tasks t
      JOIN users u ON u.id = t.assigned_to
      WHERE t.feedback IS NOT NULL
      ORDER BY t.updated_at DESC
    `).all();

    res.json({ success: true, feedback });
  } catch (error) {
    console.error("Admin feedback error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch feedback" });
  }
});

/* =========================================================
   CREATE FEEDBACK
   POST /api/admin/feedback
========================================================= */
router.post("/feedback", authenticateToken, authorizeRoles("admin", "manager"), (req, res) => {
  try {
    const db = req.app.locals.db;
    const { user_id, score, strengths, improvements, feedback } = req.body || {};

    if (!user_id || !feedback) {
      return res.status(400).json({ success: false, message: "Student and feedback are required" });
    }

    // Verify student exists
    const student = db.prepare("SELECT id, name FROM users WHERE id = ? AND LOWER(role) = 'student' AND active = 1").get(Number(user_id));
    if (!student) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    // Insert into performance table
    const period = new Date().toISOString().slice(0, 7); // YYYY-MM format
    const result = db.prepare(`
      INSERT INTO performance (user_id, period, score, strengths, improvements, feedback, reviewed_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      Number(user_id),
      period,
      score ? Number(score) : null,
      Array.isArray(strengths) ? strengths.join(", ") : (strengths || ""),
      Array.isArray(improvements) ? improvements.join(", ") : (improvements || ""),
      String(feedback).trim(),
      req.user.id
    );

    res.status(201).json({ success: true, message: "Feedback saved successfully", feedbackId: result.lastInsertRowid });
  } catch (error) {
    console.error("Create feedback error:", error);
    res.status(500).json({ success: false, message: "Unable to save feedback" });
  }
});

/* =========================================================
   GET PENDING STUDENT REGISTRATIONS
   GET /api/admin/pending-registrations
========================================================= */
router.get("/pending-registrations", authenticateToken, authorizeRoles("admin", "ceo"), (req, res) => {
  try {
    const db = req.app.locals.db;

    const pending = db.prepare(`
      SELECT
        id,
        name,
        email,
        phone,
        created_at,
        registration_status
      FROM users
      WHERE LOWER(role) = 'student'
        AND registration_status = 'pending'
      ORDER BY created_at DESC
    `).all();

    res.json({ success: true, pending });
  } catch (error) {
    console.error("Pending registrations error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch pending registrations" });
  }
});

/* =========================================================
   APPROVE STUDENT REGISTRATION
   POST /api/admin/approve-registration/:id
========================================================= */
router.post("/approve-registration/:id", authenticateToken, authorizeRoles("admin", "ceo"), (req, res) => {
  try {
    const db = req.app.locals.db;
    const userId = Number(req.params.id);

    const user = db.prepare("SELECT id, name, email, role, registration_status FROM users WHERE id = ?").get(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (user.role !== "student") {
      return res.status(400).json({ success: false, message: "Only student registrations can be approved" });
    }

    // Idempotent: allow pending->approved and rejected->approved
    if (user.registration_status === "approved") {
      return res.json({ success: true, message: "Student is already approved" });
    }

    db.prepare("UPDATE users SET registration_status = 'approved' WHERE id = ?").run(userId);

    // Mark related notifications as read
    db.prepare(`
      UPDATE notifications
      SET read_at = CURRENT_TIMESTAMP
      WHERE type = 'registration_pending'
        AND message LIKE ?
        AND read_at IS NULL
    `).run(`%${user.email}%`);

    // Write audit log
    const { writeAudit } = require("../utils/audit");
    writeAudit(db, {
      actorId: req.user.id,
      action: "registration_approved",
      entityType: "user",
      entityId: userId,
      newValue: { name: user.name, email: user.email, registration_status: "approved" },
    });

    res.json({ success: true, message: "Student registration approved successfully" });
  } catch (error) {
    console.error("Approve registration error:", error);
    res.status(500).json({ success: false, message: "Unable to approve registration" });
  }
});

/* =========================================================
   REJECT STUDENT REGISTRATION
   POST /api/admin/reject-registration/:id
========================================================= */
router.post("/reject-registration/:id", authenticateToken, authorizeRoles("admin", "ceo"), (req, res) => {
  try {
    const db = req.app.locals.db;
    const userId = Number(req.params.id);

    const user = db.prepare("SELECT id, name, email, role, registration_status FROM users WHERE id = ?").get(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (user.role !== "student") {
      return res.status(400).json({ success: false, message: "Only student registrations can be rejected" });
    }

    // Idempotent: allow pending->rejected (silently succeed if already rejected)
    if (user.registration_status === "rejected") {
      return res.json({ success: true, message: "Student is already rejected" });
    }

    db.prepare("UPDATE users SET registration_status = 'rejected' WHERE id = ?").run(userId);

    // Mark related notifications as read
    db.prepare(`
      UPDATE notifications
      SET read_at = CURRENT_TIMESTAMP
      WHERE type = 'registration_pending'
        AND message LIKE ?
        AND read_at IS NULL
    `).run(`%${user.email}%`);

    // Write audit log
    const { writeAudit } = require("../utils/audit");
    writeAudit(db, {
      actorId: req.user.id,
      action: "registration_rejected",
      entityType: "user",
      entityId: userId,
      newValue: { name: user.name, email: user.email, registration_status: "rejected" },
    });

    res.json({ success: true, message: "Student registration rejected" });
  } catch (error) {
    console.error("Reject registration error:", error);
    res.status(500).json({ success: false, message: "Unable to reject registration" });
  }
});

module.exports = router;
