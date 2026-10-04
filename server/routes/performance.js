const express = require("express");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

function parseList(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [String(parsed)];
  } catch {
    return String(value).split(",").map((item) => item.trim()).filter(Boolean);
  }
}

function getProgress(db, userId) {
  const task = db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN LOWER(status)='completed' THEN 1 ELSE 0 END) completed FROM tasks WHERE assigned_to = ?`).get(userId);
  const mission = db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN LOWER(status)='completed' OR progress >= 100 THEN 1 ELSE 0 END) completed FROM missions WHERE assigned_to = ?`).get(userId);
  const activity = db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN LOWER(status)='completed' THEN 1 ELSE 0 END) completed FROM daily_activities WHERE user_id = ?`).get(userId);

  const values = [task, mission, activity]
    .filter((item) => Number(item.total || 0) > 0)
    .map((item) => Math.round((Number(item.completed || 0) / Number(item.total)) * 100));

  return {
    progress: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0,
    tasks: { total: Number(task.total || 0), completed: Number(task.completed || 0) },
    missions: { total: Number(mission.total || 0), completed: Number(mission.completed || 0) },
    activities: { total: Number(activity.total || 0), completed: Number(activity.completed || 0) }
  };
}

function buildStudentPerformance(db, userId) {
  const student = db.prepare("SELECT id, name, email, role, department FROM users WHERE id = ?").get(userId);
  if (!student) return null;

  const progressData = getProgress(db, userId);
  const review = db.prepare("SELECT * FROM performance WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(userId);
  const assigned = Number(db.prepare("SELECT COUNT(*) c FROM tasks WHERE assigned_to=?").get(userId).c || 0);
  const approved = Number(db.prepare("SELECT COUNT(*) c FROM tasks WHERE assigned_to=? AND workflow_status='Approved'").get(userId).c || 0);
  const submitted = Number(db.prepare("SELECT COUNT(*) c FROM submissions WHERE student_id=?").get(userId).c || 0);
  const late = Number(db.prepare("SELECT COUNT(*) c FROM submissions s JOIN tasks t ON t.id=s.task_id WHERE s.student_id=? AND datetime(s.submitted_at)>datetime(t.due_date)").get(userId).c || 0);
  const revisions = Number(db.prepare("SELECT COUNT(*) c FROM submissions WHERE student_id=? AND status='Revision Required'").get(userId).c || 0);
  const overdue = Number(db.prepare("SELECT COUNT(*) c FROM tasks WHERE assigned_to=? AND due_date IS NOT NULL AND datetime(due_date)<datetime('now') AND workflow_status NOT IN ('Approved','Archived','Cancelled')").get(userId).c || 0);
  const activities = Number(db.prepare("SELECT COUNT(*) c FROM daily_activities WHERE user_id=?").get(userId).c || 0);
  const approvalRate = submitted ? Math.round((approved / submitted) * 100) : 0;

  return {
    student, progress: progressData.progress, score: review?.score == null ? null : Number(review.score),
    completedTasks: progressData.tasks.completed, totalTasks: progressData.tasks.total, completedMissions: progressData.missions.completed, totalMissions: progressData.missions.total,
    metrics: { assigned, approved, submitted, lateSubmissions: late, revisionRequests: revisions, overdue, approvalRate, dailyActivities: activities, activeTasks: Math.max(assigned-approved-overdue,0) },
    strengths: parseList(review?.strengths), improvement: parseList(review?.improvements), feedback: review?.feedback || "No feedback available yet.", period: review?.period || null, evaluated: review?.score != null
  };
}

router.get("/me", authenticateToken, authorizeRoles("student", "member"), (req, res) => {
  const result = buildStudentPerformance(req.app.locals.db, req.user.id);
  if (!result) return res.status(404).json({ success: false, message: "Student not found" });
  res.json({ success: true, ...result });
});

router.get("/", authenticateToken, (req, res) => {
  if (!["admin", "manager"].includes(req.user.role)) return res.status(403).json({ success: false, message: "Access denied" });
  const db = req.app.locals.db;
  const students = db.prepare("SELECT id, name, email, department FROM users WHERE LOWER(role)='student' ORDER BY name").all();
  res.json({ success: true, students: students.map((s) => buildStudentPerformance(db, s.id)) });
});

router.get("/student/:id", authenticateToken, authorizeRoles("admin", "manager"), (req, res) => {
  const result = buildStudentPerformance(req.app.locals.db, Number(req.params.id));
  if (!result) return res.status(404).json({ success: false, message: "Student not found" });
  res.json({ success: true, ...result });
});

router.post("/review", authenticateToken, authorizeRoles("admin"), (req, res) => {
  const { user_id, score, strengths = [], improvements = [], feedback = "", period = "general" } = req.body || {};
  const db = req.app.locals.db;
  const student = db.prepare("SELECT id FROM users WHERE id = ? AND LOWER(role)='student'").get(Number(user_id));
  if (!student) return res.status(404).json({ success: false, message: "Student not found" });

  let normalizedScore = null;
  if (score !== "" && score !== null && score !== undefined) {
    normalizedScore = Number(score);
    if (!Number.isInteger(normalizedScore) || normalizedScore < 0 || normalizedScore > 100) {
      return res.status(400).json({ success: false, message: "Score must be between 0 and 100" });
    }
  }

  const result = db.prepare(`INSERT INTO performance (user_id, period, score, strengths, improvements, completed_missions, feedback, reviewed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    Number(user_id), String(period || "general"), normalizedScore,
    JSON.stringify(Array.isArray(strengths) ? strengths : String(strengths).split(",").map((v) => v.trim()).filter(Boolean)),
    JSON.stringify(Array.isArray(improvements) ? improvements : String(improvements).split(",").map((v) => v.trim()).filter(Boolean)),
    getProgress(db, Number(user_id)).missions.completed,
    String(feedback || "").trim() || null,
    req.user.id
  );

  res.status(201).json({ success: true, message: "Performance review saved", performanceId: result.lastInsertRowid });
});

module.exports = router;
