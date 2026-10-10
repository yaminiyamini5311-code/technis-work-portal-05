const express = require("express");
const { ObjectId } = require("mongodb");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const router = express.Router();
function toId(id) { try { return new ObjectId(id); } catch { return id; } }

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    cb(allowedTypes.includes(file.mimetype) ? null : new Error("Only JPEG, PNG, and WebP images are allowed"), allowedTypes.includes(file.mimetype));
  }
});

router.get("/dashboard", authenticateToken, authorizeRoles("student", "member"), async (req, res) => {
  try {
    const db = req.db;
    const { getStudentDashboard } = require("../utils/dashboard");
    const dashboard = await getStudentDashboard(db, req.user.id);
    if (!dashboard) return res.status(404).json({ success: false, message: "Student account not found" });
    return res.json({ success: true, ...dashboard });
  } catch (e) {
    console.error("Student dashboard error:", e);
    res.status(500).json({ success: false, message: "Unable to load dashboard" });
  }
});



router.get("/feedback", authenticateToken, authorizeRoles("student", "member"), async (req, res) => {
  try {
    const db = req.db;
    const feedback = await db.collection("performance").find({ user_id: req.user.id }).sort({ created_at: -1 }).limit(20).toArray();
    const taskFeedback = await db.collection("tasks").find({ assigned_to: req.user.id, feedback: { $exists: true, $ne: null } }, { projection: { task_code: 1, title: 1, feedback: 1, updated_at: 1 } }).sort({ updated_at: -1 }).limit(20).toArray();
    const fbWithNames = await Promise.all(feedback.map(async p => {
      const r = p.reviewed_by ? await db.collection("users").findOne({ _id: toId(p.reviewed_by) }, { projection: { name: 1 } }) : null;
      return { ...p, id: String(p._id), reviewer_name: r?.name };
    }));
    res.json({ success: true, feedback: fbWithNames, taskFeedback: taskFeedback.map(t => ({ ...t, id: String(t._id), type: "task" })) });
  } catch (e) {
    res.status(500).json({ success: false, message: "Unable to fetch feedback" });
  }
});

router.get("/profile", authenticateToken, authorizeRoles("student", "member"), async (req, res) => {
  try {
    const db = req.db;
    const user = await db.collection("users").findOne({ _id: toId(req.user.id) }, { projection: { password: 0 } });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, user: { ...user, id: String(user._id) } });
  } catch (e) {
    res.status(500).json({ success: false, message: "Unable to fetch profile" });
  }
});

router.put("/profile", authenticateToken, authorizeRoles("student", "member"), upload.single("avatar"), async (req, res) => {
  try {
    const db = req.db;
    const { name, phone } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ success: false, message: "Name is required" });

    let avatarPath = null;
    if (req.file) {
      const uploadsDir = path.join(__dirname, "..", "uploads", "avatars");
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      const safeName = `${req.user.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${path.extname(req.file.originalname)}`;
      avatarPath = path.join(uploadsDir, safeName);
      fs.writeFileSync(avatarPath, req.file.buffer);

      const oldUser = await db.collection("users").findOne({ _id: toId(req.user.id) }, { projection: { avatar: 1 } });
      if (oldUser?.avatar && fs.existsSync(oldUser.avatar)) fs.unlinkSync(oldUser.avatar);

      avatarPath = `/uploads/avatars/${safeName}`;
    }

    const update = { name: String(name).trim(), phone: phone ? String(phone).trim() : null };
    if (avatarPath) update.avatar = avatarPath;

    await db.collection("users").updateOne({ _id: toId(req.user.id) }, { $set: update });
    const updatedUser = await db.collection("users").findOne({ _id: toId(req.user.id) }, { projection: { password: 0 } });

    res.json({ success: true, message: "Profile updated successfully", user: { ...updatedUser, id: String(updatedUser._id) } });
  } catch (e) {
    console.error("Update profile error:", e);
    res.status(500).json({ success: false, message: "Unable to update profile" });
  }
});

module.exports = router;
