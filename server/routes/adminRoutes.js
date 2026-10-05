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
        created_at,
        active
      FROM users
      WHERE LOWER(role) = 'student'
      ORDER BY name ASC
    `).all();

    res.json({ success: true, students });
  } catch (error) {
    console.error("Admin students error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch students" });
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

module.exports = router;
