const express = require("express");
const { ObjectId } = require("mongodb");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const { MAX_STUDENT_ACCOUNTS } = require("../config");
const { writeAudit } = require("../utils/audit_mongo");
const bcrypt = require("bcryptjs");

const router = express.Router();

function toId(id) { try { return new ObjectId(id); } catch { return id; } }
function fmt(doc) {
  if (!doc) return null;
  const d = { ...doc, id: String(doc._id) };
  delete d._id;
  return d;
}

/* ─── STATS ─────────────────────────────────────────────────────────────── */
router.get("/stats", authenticateToken, authorizeRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const today = new Date().toISOString().slice(0, 10);

    const [students, tasks, missions, activities, activitiesToday, completedTasks, pendingTasks, inProgressTasks] = await Promise.all([
      db.collection("users").countDocuments({ role: "student", active: 1 }),
      db.collection("tasks").countDocuments(),
      db.collection("missions").countDocuments(),
      db.collection("daily_activities").countDocuments(),
      db.collection("daily_activities").countDocuments({ date: today }),
      db.collection("tasks").countDocuments({ workflow_status: "Approved" }),
      db.collection("tasks").countDocuments({ workflow_status: { $in: ["Assigned", "Acknowledged"] } }),
      db.collection("tasks").countDocuments({ workflow_status: { $in: ["In Progress", "Submitted", "Under Review", "Revision Required", "Resubmitted"] } }),
    ]);

    res.json({
      success: true,
      stats: { students, maxStudents: MAX_STUDENT_ACCOUNTS, tasks, missions, activities, activitiesToday, completedTasks, pendingTasks, inProgressTasks }
    });
  } catch (error) {
    console.error("Admin stats error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch stats" });
  }
});

/* ─── PROGRESS ──────────────────────────────────────────────────────────── */
router.get("/progress", authenticateToken, authorizeRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const period = String(req.query?.period || "week").toLowerCase();
    const days = period === "month" ? 30 : 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().slice(0, 10);

    const tasks = await db.collection("tasks").find(
      { workflow_status: "Approved", updated_at: { $gte: startDateStr } },
      { projection: { updated_at: 1 } }
    ).toArray();

    const grouped = {};
    for (const t of tasks) {
      const date = String(t.updated_at || "").slice(0, 10);
      if (date) grouped[date] = (grouped[date] || 0) + 1;
    }
    const progress = Object.entries(grouped).sort().map(([date, count]) => ({ date, count }));

    res.json({ success: true, progress, period, days });
  } catch (error) {
    console.error("Admin progress error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch progress" });
  }
});

/* ─── GET STUDENTS ──────────────────────────────────────────────────────── */
router.get("/students", authenticateToken, authorizeRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const students = await db.collection("users").find(
      { role: "student" },
      { projection: { password: 0 } }
    ).sort({ name: 1 }).toArray();

    const activeCount = await db.collection("users").countDocuments({ role: "student", active: 1 });

    res.json({
      success: true,
      students: students.map(fmt),
      total: activeCount,
      limit: MAX_STUDENT_ACCOUNTS,
    });
  } catch (error) {
    console.error("Admin students error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch students" });
  }
});

/* ─── CREATE STUDENT ────────────────────────────────────────────────────── */
router.post("/students", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const { name, email, password, department, program } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "Name, email, and password are required" });
    }
    if (department && program) {
      return res.status(400).json({ success: false, message: "Cannot select both Department and Program. Choose one." });
    }

    const existing = await db.collection("users").findOne({ email: String(email).trim().toLowerCase() });
    if (existing) return res.status(409).json({ success: false, message: "Email already exists" });

    const studentCount = await db.collection("users").countDocuments({ role: "student", active: 1 });
    if (studentCount >= MAX_STUDENT_ACCOUNTS) {
      return res.status(409).json({ success: false, message: `Student limit reached (${MAX_STUDENT_ACCOUNTS}). Cannot create more student accounts.` });
    }

    const hashedPassword = await bcrypt.hash(String(password), 12);
    const result = await db.collection("users").insertOne({
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      password: hashedPassword,
      role: "student",
      department: department ? String(department).trim().toLowerCase() : null,
      program: program ? String(program).trim().toLowerCase() : null,
      active: 1,
      registration_status: "approved",
      created_at: new Date().toISOString()
    });

    const created = await db.collection("users").findOne({ _id: result.insertedId }, { projection: { password: 0 } });
    res.status(201).json({ success: true, message: "Student created successfully", studentId: String(result.insertedId), student: fmt(created) });
  } catch (error) {
    console.error("Create student error:", error);
    if (error.code === 11000) return res.status(409).json({ success: false, message: "Email already exists" });
    res.status(500).json({ success: false, message: "Unable to create student" });
  }
});

/* ─── PENDING APPROVALS ─────────────────────────────────────────────────── */
router.get("/pending-approvals", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const pending = await db.collection("users").find(
      { active: 0 },
      { projection: { password: 0 } }
    ).sort({ created_at: -1 }).toArray();
    res.json({ success: true, pending: pending.map(fmt) });
  } catch (error) {
    console.error("Pending approvals error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch pending approvals" });
  }
});

/* ─── APPROVE USER ──────────────────────────────────────────────────────── */
router.post("/approve-user/:id", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const userId = req.params.id;
    const user = await db.collection("users").findOne({ _id: toId(userId) });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (Number(user.active) === 1) return res.status(400).json({ success: false, message: "User is already active" });

    await db.collection("users").updateOne({ _id: toId(userId) }, { $set: { active: 1 } });
    await writeAudit(db, { actorId: req.user.id, action: "user_approved", entityType: "user", entityId: userId, newValue: { name: user.name, email: user.email, role: user.role, active: 1 } });

    res.json({ success: true, message: "User approved successfully" });
  } catch (error) {
    console.error("Approve user error:", error);
    res.status(500).json({ success: false, message: "Unable to approve user" });
  }
});

/* ─── FEEDBACK ──────────────────────────────────────────────────────────── */
router.get("/feedback", authenticateToken, authorizeRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const tasks = await db.collection("tasks").find(
      { feedback: { $exists: true, $ne: null } },
      { projection: { task_code: 1, title: 1, feedback: 1, updated_at: 1, assigned_to: 1 } }
    ).sort({ updated_at: -1 }).toArray();

    const feedback = await Promise.all(tasks.map(async t => {
      const student = await db.collection("users").findOne({ _id: toId(t.assigned_to) }, { projection: { name: 1, email: 1 } });
      return { id: String(t._id), task_code: t.task_code, title: t.title, feedback: t.feedback, updated_at: t.updated_at, student_name: student?.name, student_email: student?.email };
    }));
    res.json({ success: true, feedback });
  } catch (error) {
    console.error("Admin feedback error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch feedback" });
  }
});

router.post("/feedback", authenticateToken, authorizeRoles("admin", "manager"), async (req, res) => {
  try {
    const db = req.db;
    const { user_id, score, strengths, improvements, feedback } = req.body || {};
    if (!user_id || !feedback) return res.status(400).json({ success: false, message: "Student and feedback are required" });

    const student = await db.collection("users").findOne({ _id: toId(user_id), role: "student", active: 1 });
    if (!student) return res.status(404).json({ success: false, message: "Student not found" });

    const period = new Date().toISOString().slice(0, 7);
    const result = await db.collection("performance").insertOne({
      user_id: String(user_id),
      period,
      score: score ? Number(score) : null,
      strengths: Array.isArray(strengths) ? strengths.join(", ") : (strengths || ""),
      improvements: Array.isArray(improvements) ? improvements.join(", ") : (improvements || ""),
      feedback: String(feedback).trim(),
      reviewed_by: req.user.id,
      created_at: new Date().toISOString()
    });
    res.status(201).json({ success: true, message: "Feedback saved successfully", feedbackId: String(result.insertedId) });
  } catch (error) {
    console.error("Create feedback error:", error);
    res.status(500).json({ success: false, message: "Unable to save feedback" });
  }
});

/* ─── PENDING REGISTRATIONS ─────────────────────────────────────────────── */
router.get("/pending-registrations", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const pending = await db.collection("users").find(
      { role: "student", registration_status: "pending" },
      { projection: { password: 0 } }
    ).sort({ created_at: -1 }).toArray();
    res.json({ success: true, pending: pending.map(fmt) });
  } catch (error) {
    console.error("Pending registrations error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch pending registrations" });
  }
});

/* ─── APPROVE REGISTRATION ──────────────────────────────────────────────── */
router.post("/approve-registration/:id", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const userId = req.params.id;
    const user = await db.collection("users").findOne({ _id: toId(userId) });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (user.role !== "student") return res.status(400).json({ success: false, message: "Only student registrations can be approved" });
    if (user.registration_status === "approved") return res.json({ success: true, message: "Student is already approved" });

    await db.collection("users").updateOne({ _id: toId(userId) }, { $set: { registration_status: "approved" } });

    // Mark related notifications as read
    await db.collection("notifications").updateMany(
      { type: "registration_pending", message: { $regex: user.email }, read_at: null },
      { $set: { read_at: new Date().toISOString() } }
    );

    await writeAudit(db, { actorId: req.user.id, action: "registration_approved", entityType: "user", entityId: userId, newValue: { name: user.name, email: user.email, registration_status: "approved" } });
    res.json({ success: true, message: "Student registration approved successfully" });
  } catch (error) {
    console.error("Approve registration error:", error);
    res.status(500).json({ success: false, message: "Unable to approve registration" });
  }
});

/* ─── REJECT REGISTRATION ───────────────────────────────────────────────── */
router.post("/reject-registration/:id", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const userId = req.params.id;
    const user = await db.collection("users").findOne({ _id: toId(userId) });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (user.role !== "student") return res.status(400).json({ success: false, message: "Only student registrations can be rejected" });
    if (user.registration_status === "rejected") return res.json({ success: true, message: "Student is already rejected" });

    await db.collection("users").updateOne({ _id: toId(userId) }, { $set: { registration_status: "rejected" } });

    await db.collection("notifications").updateMany(
      { type: "registration_pending", message: { $regex: user.email }, read_at: null },
      { $set: { read_at: new Date().toISOString() } }
    );

    await writeAudit(db, { actorId: req.user.id, action: "registration_rejected", entityType: "user", entityId: userId, newValue: { name: user.name, email: user.email, registration_status: "rejected" } });
    res.json({ success: true, message: "Student registration rejected" });
  } catch (error) {
    console.error("Reject registration error:", error);
    res.status(500).json({ success: false, message: "Unable to reject registration" });
  }
});

module.exports = router;
