const express = require("express");
const { ObjectId } = require("mongodb");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const { writeAudit } = require("../utils/audit_mongo");

const router = express.Router();
function toId(id) { try { return new ObjectId(id); } catch { return id; } }

router.get("/me", authenticateToken, authorizeRoles("student", "member"), async (req, res) => {
  const db = req.db;
  const activities = await db.collection("daily_activities").find({ user_id: req.user.id }).sort({ date: -1 }).toArray();
  res.json({ success: true, activities: activities.map(a => ({ ...a, id: String(a._id) })) });
});

router.get("/my", authenticateToken, authorizeRoles("student", "member"), async (req, res) => {
  const db = req.db;
  const activities = await db.collection("daily_activities").find({ user_id: req.user.id }).sort({ date: -1 }).toArray();
  res.json({ success: true, activities: activities.map(a => ({ ...a, id: String(a._id) })) });
});

router.get("/", authenticateToken, authorizeRoles("ceo", "admin", "manager"), async (req, res) => {
  try {
    const db = req.db;
    // CEO, admin, and manager can see all activities
    const activities = await db.collection("daily_activities").find({}).sort({ date: -1 }).toArray();
    const result = await Promise.all(activities.map(async a => {
      const u = await db.collection("users").findOne({ _id: toId(a.user_id) }, { projection: { name: 1, email: 1 } });
      return { ...a, id: String(a._id), student_name: u?.name, student_email: u?.email };
    }));
    res.json({ success: true, activities: result });
  } catch (e) { console.error("Activity GET:", e); res.status(500).json({ success: false, message: "Unable to fetch activities" }); }
});

router.post("/", authenticateToken, authorizeRoles("student", "member"), async (req, res) => {
  try {
    const { work_title, description, hours_worked = 0, status = "completed", blockers = "", next_steps = "", date } = req.body || {};
    if (!String(work_title || "").trim() || !String(description || "").trim()) {
      return res.status(400).json({ success: false, message: "Work title and description are required" });
    }
    const hours = Number(hours_worked);
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) return res.status(400).json({ success: false, message: "Hours worked must be between 0 and 24" });
    const cleanStatus = String(status).toLowerCase();
    if (!["completed", "in_progress", "blocked"].includes(cleanStatus)) return res.status(400).json({ success: false, message: "Invalid activity status" });

    const db = req.db;
    const result = await db.collection("daily_activities").insertOne({
      user_id: req.user.id,
      date: date || new Date().toISOString().slice(0, 10),
      work_title: String(work_title).trim(),
      description: String(description).trim(),
      hours_worked: hours,
      status: cleanStatus,
      blockers: String(blockers || "").trim() || null,
      next_steps: String(next_steps || "").trim() || null,
      created_at: new Date().toISOString()
    });
    const activityId = String(result.insertedId);
    await writeAudit(db, { actorId: req.user.id, action: "daily_activity_submitted", entityType: "daily_activity", entityId: activityId, newValue: { date: date || new Date().toISOString().slice(0, 10), work_title: String(work_title).trim(), status: cleanStatus } });
    res.status(201).json({ success: true, message: "Daily activity submitted successfully", activityId });
  } catch (error) {
    console.error("Activity error:", error);
    res.status(500).json({ success: false, message: "Failed to submit activity" });
  }
});

module.exports = router;
