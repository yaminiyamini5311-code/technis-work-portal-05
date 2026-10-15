const express = require("express");
const { ObjectId } = require("mongodb");
const { authenticateToken, authorizeRoles, checkStudentRegistrationStatus } = require("../middleware/authMiddleware");
const { writeAudit } = require("../utils/audit_mongo");
const router = express.Router();
function toId(id) { try { return new ObjectId(id); } catch { return id; } }

/* GET /me - Student's own performance records */
router.get("/me", authenticateToken, checkStudentRegistrationStatus, authorizeRoles("student", "member"), async (req, res) => {
  try {
    const db = req.db;
    const records = await db.collection("performance").find({ user_id: req.user.id }).sort({ created_at: -1 }).toArray();
    const result = await Promise.all(records.map(async p => {
      const r = p.reviewed_by ? await db.collection("users").findOne({ _id: toId(p.reviewed_by) }, { projection: { name: 1 } }) : null;
      return { ...p, id: String(p._id), reviewer_name: r?.name };
    }));
    res.json({ success: true, records: result });
  } catch (e) {
    console.error("Performance GET /me:", e);
    res.status(500).json({ success: false, message: "Unable to fetch performance records" });
  }
});

/* GET / - Aggregated student performance with scorecards (admin/manager/CEO)
 *
 * Extends the existing per-student card with task-wise data built by
 * utils/studentReport.js (task states, submission/review metadata and the
 * optional score / max_marks pair). Every figure is derived from real
 * records — no task counts or scores are invented.
 */
router.get("/", authenticateToken, authorizeRoles("ceo", "admin", "manager"), async (req, res) => {
  try {
    const db = req.db;
    const { buildStudentReport } = require("../utils/studentReport");
    
    // Get all active students
    const students = await db.collection("users").find({ role: "student", active: 1 }).toArray();
    
    // Aggregate performance data for each student
    const studentPerformance = await Promise.all(students.map(async (student) => {
      const studentId = String(student._id);
      
      // Get missions assigned to this student
      const missions = await db.collection("missions").find({ 
        assigned_to: studentId 
      }).toArray();
      
      // Get latest performance review score (overall evaluator score, kept
      // for backward compatibility; task scores live on the report below).
      const latestReview = await db.collection("performance")
        .findOne({ user_id: studentId }, { sort: { created_at: -1 } });

      // Task-wise report (per student + task only).
      const report = await buildStudentReport(db, student);

      // Keep the legacy aggregate fields so existing consumers keep working.
      const completedTasks = report.counts.approved;
      const totalTasks = report.counts.total;

      // Mission statuses are stored lowercase ("completed"); the previous
      // capitalized comparison never matched.
      const completedMissions = missions.filter(m => String(m.status || "").toLowerCase() === "completed").length;
      const totalMissions = missions.length;

      // Progress: authoritative approval-based completion across tasks + missions.
      const progress = totalTasks + totalMissions > 0
        ? Math.round(((completedTasks + completedMissions) / (totalTasks + totalMissions)) * 100)
        : 0;

      return {
        ...report,
        completedTasks,
        totalTasks,
        completedMissions,
        totalMissions,
        progress,
        score: latestReview?.score ?? null,
        lastReviewed: latestReview?.created_at ?? null
      };
    }));

    res.json({ success: true, students: studentPerformance });
  } catch (e) {
    console.error("Performance GET:", e);
    res.status(500).json({ success: false, message: "Unable to fetch performance data" });
  }
});

/* GET /students/:id - Single student report (task-wise detail) */
router.get("/students/:id", authenticateToken, authorizeRoles("ceo", "admin", "manager"), async (req, res) => {
  try {
    const db = req.db;
    const { buildStudentReport } = require("../utils/studentReport");
    const student = await db.collection("users").findOne({ _id: toId(req.params.id), role: "student" });
    if (!student) return res.status(404).json({ success: false, message: "Student not found" });
    const report = await buildStudentReport(db, student);
    res.json({ success: true, ...report });
  } catch (e) {
    console.error("Performance GET /students/:id:", e);
    res.status(500).json({ success: false, message: "Unable to fetch student report" });
  }
});

/* GET /reviews - All performance review records (admin/manager/CEO) */
router.get("/reviews", authenticateToken, authorizeRoles("ceo", "admin", "manager"), async (req, res) => {
  try {
    const db = req.db;
    // CEO, admin, and manager can see all performance records
    const records = await db.collection("performance").find({}).sort({ created_at: -1 }).toArray();
    const result = await Promise.all(records.map(async p => {
      const u = await db.collection("users").findOne({ _id: toId(p.user_id) }, { projection: { name: 1, email: 1 } });
      const r = p.reviewed_by ? await db.collection("users").findOne({ _id: toId(p.reviewed_by) }, { projection: { name: 1 } }) : null;
      return { ...p, id: String(p._id), student_name: u?.name, student_email: u?.email, reviewer_name: r?.name };
    }));
    res.json({ success: true, records: result });
  } catch (e) {
    console.error("Performance GET:", e);
    res.status(500).json({ success: false, message: "Unable to fetch performance records" });
  }
});

/* POST add performance review */
router.post("/", authenticateToken, authorizeRoles("ceo", "admin", "manager"), async (req, res) => {
  try {
    const db = req.db;
    const { user_id, period, score, strengths, improvements, feedback } = req.body || {};
    if (!user_id || !feedback) return res.status(400).json({ success: false, message: "Student and feedback are required" });

    const student = await db.collection("users").findOne({ _id: toId(user_id), role: "student", active: 1 });
    if (!student) return res.status(404).json({ success: false, message: "Student not found" });

    const result = await db.collection("performance").insertOne({
      user_id: String(user_id),
      period: period || new Date().toISOString().slice(0, 7),
      score: score != null ? Number(score) : null,
      strengths: Array.isArray(strengths) ? strengths.join(", ") : (strengths || ""),
      improvements: Array.isArray(improvements) ? improvements.join(", ") : (improvements || ""),
      feedback: String(feedback).trim(),
      reviewed_by: req.user.id,
      created_at: new Date().toISOString()
    });
    await writeAudit(db, { actorId: req.user.id, action: "performance_review_added", entityType: "performance", entityId: String(result.insertedId), newValue: { user_id, period, score } });
    res.status(201).json({ success: true, message: "Performance review saved", reviewId: String(result.insertedId) });
  } catch (e) {
    console.error("Performance POST:", e);
    res.status(500).json({ success: false, message: "Unable to save performance review" });
  }
});

module.exports = router;
