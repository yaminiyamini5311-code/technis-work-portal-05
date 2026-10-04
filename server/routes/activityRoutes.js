const express = require("express");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const { writeAudit } = require("../utils/audit");

const router = express.Router();

function listActivities(db, where = "", params = []) {
  return db.prepare(`
    SELECT a.*, u.name AS student_name, u.email AS student_email
    FROM daily_activities a
    JOIN users u ON u.id = a.user_id
    ${where}
    ORDER BY a.date DESC, a.id DESC
  `).all(...params);
}

router.get("/me", authenticateToken, authorizeRoles("student", "member"), (req, res) => {
  res.json({ success: true, activities: listActivities(req.app.locals.db, "WHERE a.user_id = ?", [req.user.id]) });
});

router.get("/my", authenticateToken, authorizeRoles("student", "member"), (req, res) => {
  res.json({ success: true, activities: listActivities(req.app.locals.db, "WHERE a.user_id = ?", [req.user.id]) });
});

router.get("/", authenticateToken, (req, res) => {
  const db = req.app.locals.db;
  if (["student", "member"].includes(req.user.role)) {
    return res.json({ success: true, activities: listActivities(db, "WHERE a.user_id = ?", [req.user.id]) });
  }
  if (!["admin", "manager"].includes(req.user.role)) return res.status(403).json({ success: false, message: "Access denied" });
  res.json({ success: true, activities: listActivities(db) });
});

router.post("/", authenticateToken, authorizeRoles("student", "member"), (req, res) => {
  try {
    const { work_title, description, hours_worked = 0, status = "completed", blockers = "", next_steps = "", date } = req.body || {};
    if (!String(work_title || "").trim() || !String(description || "").trim()) {
      return res.status(400).json({ success: false, message: "Work title and description are required" });
    }
    const hours = Number(hours_worked);
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) return res.status(400).json({ success: false, message: "Hours worked must be between 0 and 24" });
    const cleanStatus = String(status).toLowerCase();
    if (!['completed', 'in_progress', 'blocked'].includes(cleanStatus)) return res.status(400).json({ success: false, message: "Invalid activity status" });
    const db = req.app.locals.db;
    const result = db.prepare(`INSERT INTO daily_activities (user_id, date, work_title, description, hours_worked, status, blockers, next_steps) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      req.user.id,
      date || new Date().toISOString().slice(0, 10),
      String(work_title).trim(), String(description).trim(), hours, cleanStatus, String(blockers || "").trim() || null, String(next_steps || "").trim() || null
    );
    writeAudit(db,{actorId:req.user.id,action:"daily_activity_submitted",entityType:"daily_activity",entityId:Number(result.lastInsertRowid),newValue:{date:date||new Date().toISOString().slice(0,10),work_title:String(work_title).trim(),status:cleanStatus}});
    res.status(201).json({ success: true, message: "Daily activity submitted successfully", activityId: result.lastInsertRowid });
  } catch (error) {
    console.error("Activity error:", error);
    res.status(500).json({ success: false, message: "Failed to submit activity" });
  }
});

module.exports = router;
