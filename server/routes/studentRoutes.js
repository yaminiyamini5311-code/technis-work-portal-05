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
    const sid = String(req.user.id);
    const feedback = await db.collection("performance").find({ user_id: sid }).sort({ created_at: -1 }).limit(20).toArray();
    // Task feedback should follow the student's assignments (batch tasks are
    // not stored under assigned_to), not a single legacy owner field.
    const { getStudentTaskIds } = require("../models/TaskAssignment");
    const taskIds = await getStudentTaskIds(db, req.user.id);
    const taskObjectIds = taskIds.map(id => { try { return toId(id); } catch { return id; } });
    const taskFeedback = taskObjectIds.length
      ? await db.collection("tasks").find(
          { _id: { $in: taskObjectIds }, feedback: { $exists: true, $ne: null } },
          { projection: { task_code: 1, title: 1, feedback: 1, updated_at: 1 } }
        ).sort({ updated_at: -1 }).limit(20).toArray()
      : [];
    // Enrich performance entries with reviewer + linked task details so the
    // student sees the same task-specific context as the CEO feedback page.
    const linkedTaskIds = [...new Set(feedback.map(p => p.task_id).filter(Boolean).map(String))];
    const linkedTasks = linkedTaskIds.length
      ? await db.collection("tasks").find(
          { _id: { $in: linkedTaskIds.map(id => { try { return toId(id); } catch { return id; } }) } },
          { projection: { task_code: 1, title: 1, day_number: 1, day: 1 } }
        ).toArray()
      : [];
    const taskById = new Map(linkedTasks.map(t => [String(t._id), t]));
    const fbWithNames = await Promise.all(feedback.map(async p => {
      const r = p.reviewed_by ? await db.collection("users").findOne({ _id: toId(p.reviewed_by) }, { projection: { name: 1 } }) : null;
      const linked = p.task_id ? taskById.get(String(p.task_id)) : null;
      return {
        ...p,
        id: String(p._id),
        reviewer_name: r?.name || null,
        task_id: p.task_id ? String(p.task_id) : null,
        task_code: linked?.task_code || p.task_code || null,
        task_title: linked?.title || p.task_title || null,
        task_day: linked ? (linked.day_number ?? linked.day ?? null) : null,
      };
    }));
    res.json({ success: true, feedback: fbWithNames, taskFeedback: taskFeedback.map(t => ({ ...t, id: String(t._id), type: "task" })) });
  } catch (e) {
    res.status(500).json({ success: false, message: "Unable to fetch feedback" });
  }
});

/* ─── OWN TASK-WISE PERFORMANCE REPORT ──────────────────────────
 * Same builder as the CEO performance page (utils/studentReport.js) but
 * scoped to the authenticated student, so the Student Performance page can
 * match the CEO visual language and numbers without seeing other students.
 */
router.get("/report", authenticateToken, authorizeRoles("student", "member"), async (req, res) => {
  try {
    const db = req.db;
    const { buildStudentReport } = require("../utils/studentReport");
    const student = await db.collection("users").findOne({ _id: toId(req.user.id) });
    if (!student) return res.status(404).json({ success: false, message: "Student account not found" });
    const report = await buildStudentReport(db, student);
    const missions = await db.collection("missions").find({ assigned_to: String(req.user.id) }).toArray();
    const completedMissions = missions.filter(m => String(m.status || "").toLowerCase() === "completed").length;
    const totalMissions = missions.length;
    const progress = report.counts.total + totalMissions > 0
      ? Math.round(((report.counts.approved + completedMissions) / (report.counts.total + totalMissions)) * 100)
      : 0;
    const latestReview = await db.collection("performance")
      .findOne({ user_id: String(req.user.id) }, { sort: { created_at: -1 } });
    res.json({
      success: true,
      ...report,
      completedMissions,
      totalMissions,
      progress,
      score: latestReview?.score ?? null,
      lastReviewed: latestReview?.created_at ?? null,
    });
  } catch (e) {
    console.error("Student report error:", e);
    res.status(500).json({ success: false, message: "Unable to load performance report" });
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

    // Avatars are stored in GridFS (serverless-safe; Vercel's filesystem is
    // read-only). Legacy on-disk avatars are deleted best-effort on replace.
    let avatarGridfsId = null;
    if (req.file) {
      const { uploadAvatar, deleteAvatar } = require("../utils/fileStorage");
      const previous = await db.collection("users").findOne({ _id: toId(req.user.id) }, { projection: { avatar: 1, avatar_gridfs_id: 1 } });
      avatarGridfsId = await uploadAvatar(db, req.file.buffer, req.file.originalname, {
        user_id: req.user.id,
        mime_type: req.file.mimetype,
        size: req.file.size
      });
      if (previous?.avatar && previous.avatar.startsWith("/uploads/")) {
        try { fs.unlinkSync(path.join(__dirname, "..", previous.avatar)); } catch { /* already gone */ }
      }
      if (previous?.avatar_gridfs_id) {
        deleteAvatar(db, previous.avatar_gridfs_id).catch(() => {});
      }
    }

    const update = { name: String(name).trim(), phone: phone ? String(phone).trim() : null };
    if (avatarGridfsId) {
      update.avatar_gridfs_id = avatarGridfsId;
      update.avatar = null; // legacy disk path no longer used
      update.avatar_updated_at = new Date().toISOString();
    }

    await db.collection("users").updateOne({ _id: toId(req.user.id) }, { $set: update });
    const updatedUser = await db.collection("users").findOne({ _id: toId(req.user.id) }, { projection: { password: 0 } });

    res.json({ success: true, message: "Profile updated successfully", user: { ...updatedUser, id: String(updatedUser._id) } });
  } catch (e) {
    console.error("Update profile error:", e);
    res.status(500).json({ success: false, message: "Unable to update profile" });
  }
});

/* ─── PROFILE AVATAR (authenticated) ───────────────────────────────────────
 * Streams a profile photo from GridFS. Only the account owner and
 * admin/manager/ceo may fetch it; avatars are never public. The CEO profile
 * photo lives in the ceo_profile document and is requested with id "ceo".
 */
router.get("/avatar/:id", authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    const id = String(req.params.id || "");
    const isPrivileged = ["admin", "manager", "ceo"].includes(req.user.role);
    if (!isPrivileged && id !== req.user.id) {
      return res.status(403).json({ success: false, message: "You do not have permission to view this avatar" });
    }

    let gridfsId = null;
    if (id === "ceo") {
      const saved = await db.collection("ceo_profile").findOne({ _id: "ceo" }, { projection: { avatar_gridfs_id: 1 } });
      gridfsId = saved?.avatar_gridfs_id || null;
    } else {
      const user = await db.collection("users").findOne({ _id: toId(id) }, { projection: { avatar_gridfs_id: 1 } });
      gridfsId = user?.avatar_gridfs_id || null;
    }

    if (!gridfsId) return res.status(404).json({ success: false, message: "No avatar set" });

    const { downloadAvatar } = require("../utils/fileStorage");
    const { stream, file } = await downloadAvatar(db, gridfsId);
    res.setHeader("Content-Type", file.metadata?.mime_type || "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=300");
    stream.pipe(res);
  } catch (e) {
    console.error("Avatar fetch error:", e.message);
    res.status(404).json({ success: false, message: "Avatar is no longer available" });
  }
});

module.exports = router;
