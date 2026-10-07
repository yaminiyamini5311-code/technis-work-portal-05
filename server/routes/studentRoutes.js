const express = require("express");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const { getStudentDashboard } = require("../utils/dashboard");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    cb(allowedTypes.includes(file.mimetype) ? null : new Error("Only JPEG, PNG, and WebP images are allowed"), allowedTypes.includes(file.mimetype));
  }
});

router.get("/dashboard", authenticateToken, authorizeRoles("student", "member"), (req, res) => {
  const dashboard = getStudentDashboard(req.app.locals.db, req.user.id);
  if (!dashboard) return res.status(404).json({ success: false, message: "Student account not found" });
  res.json({ success: true, ...dashboard });
});

/* =========================================================
   GET STUDENT FEEDBACK
   GET /api/student/feedback
========================================================= */
router.get("/feedback", authenticateToken, authorizeRoles("student", "member"), (req, res) => {
  try {
    const db = req.app.locals.db;

    const feedback = db.prepare(`
      SELECT
        p.id,
        p.period,
        p.score,
        p.strengths,
        p.improvements,
        p.feedback,
        p.created_at,
        u.name AS reviewer_name
      FROM performance p
      LEFT JOIN users u ON u.id = p.reviewed_by
      WHERE p.user_id = ?
      ORDER BY p.created_at DESC
      LIMIT 20
    `).all(req.user.id);

    // Also get task feedback
    const taskFeedback = db.prepare(`
      SELECT
        t.id,
        t.task_code,
        t.title,
        t.feedback,
        t.updated_at,
        'task' AS type
      FROM tasks t
      WHERE t.assigned_to = ? AND t.feedback IS NOT NULL
      ORDER BY t.updated_at DESC
      LIMIT 20
    `).all(req.user.id);

    res.json({ success: true, feedback, taskFeedback });
  } catch (error) {
    console.error("Student feedback error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch feedback" });
  }
});

/* =========================================================
   GET STUDENT PROFILE
   GET /api/student/profile
========================================================= */
router.get("/profile", authenticateToken, authorizeRoles("student", "member"), (req, res) => {
  try {
    const db = req.app.locals.db;

    const user = db.prepare(`
      SELECT
        id,
        name,
        email,
        role,
        phone,
        avatar,
        created_at
      FROM users
      WHERE id = ?
    `).get(req.user.id);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({ success: true, user });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch profile" });
  }
});

/* =========================================================
   UPDATE STUDENT PROFILE
   PUT /api/student/profile
========================================================= */
router.put("/profile", authenticateToken, authorizeRoles("student", "member"), upload.single("avatar"), (req, res) => {
  try {
    const db = req.app.locals.db;
    const { name, phone } = req.body || {};

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Name is required" });
    }

    let avatarPath = null;

    // Handle avatar upload
    if (req.file) {
      const uploadsDir = path.join(__dirname, "..", "uploads", "avatars");
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const safeName = `${req.user.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${path.extname(req.file.originalname)}`;
      avatarPath = path.join(uploadsDir, safeName);
      fs.writeFileSync(avatarPath, req.file.buffer);

      // Remove old avatar if exists
      const oldUser = db.prepare("SELECT avatar FROM users WHERE id = ?").get(req.user.id);
      if (oldUser?.avatar && fs.existsSync(oldUser.avatar)) {
        fs.unlinkSync(oldUser.avatar);
      }

      avatarPath = `/uploads/avatars/${safeName}`;
    }

    // Update user
    db.prepare(`
      UPDATE users
      SET name = ?, phone = ?, avatar = COALESCE(?, avatar)
      WHERE id = ?
    `).run(
      String(name).trim(),
      phone ? String(phone).trim() : null,
      avatarPath,
      req.user.id
    );

    // Fetch updated user
    const updatedUser = db.prepare(`
      SELECT id, name, email, role, phone, avatar, created_at
      FROM users
      WHERE id = ?
    `).get(req.user.id);

    res.json({ success: true, message: "Profile updated successfully", user: updatedUser });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ success: false, message: "Unable to update profile" });
  }
});

module.exports = router;
