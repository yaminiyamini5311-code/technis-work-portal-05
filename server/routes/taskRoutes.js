const express = require("express");
const { ObjectId } = require("mongodb");
const { authenticateToken, authorizeRoles, checkStudentRegistrationStatus } = require("../middleware/authMiddleware");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { sendTaskAssignmentEmail } = require("../utils/email");
const { writeAudit } = require("../utils/audit_mongo");
const { ALLOWED_DOMAINS, ALLOWED_PROGRAMS } = require("../config");
const { createCeoNotification, createUserNotification } = require("../utils/ceoNotification");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = new Set([".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".zip", ".png", ".jpg", ".jpeg"]);
    cb(allowed.has(ext) ? null : new Error("Unsupported file type"), allowed.has(ext));
  }
});

const STATUS = ["Draft","Scheduled","Assigned","Acknowledged","In Progress","Submitted","Under Review","Revision Required","Resubmitted","Approved","Overdue","Cancelled","Archived"];
const priorityValues = new Set(["low","medium","high","critical"]);

function toId(id) { try { return new ObjectId(id); } catch { return id; } }

function legacyStatus(workflow) {
  if (["Approved","Archived"].includes(workflow)) return "completed";
  if (["In Progress","Acknowledged","Submitted","Under Review","Revision Required","Resubmitted"].includes(workflow)) return "in_progress";
  return "pending";
}

async function nextTaskCode(db) {
  const year = new Date().getFullYear();
  const last = await db.collection("tasks").find(
    { task_code: { $regex: `^TNS-${year}-` } },
    { projection: { task_code: 1 } }
  ).sort({ task_code: -1 }).limit(1).toArray();
  const lastNum = last[0]?.task_code ? Number(last[0].task_code.split("-").pop()) || 0 : 0;
  return `TNS-${year}-${String(lastNum + 1).padStart(4, "0")}`;
}

async function nextSubmissionCode(db) {
  const year = new Date().getFullYear();
  const last = await db.collection("submissions").find(
    { submission_code: { $regex: `^SUB-${year}-` } },
    { projection: { submission_code: 1 } }
  ).sort({ submission_code: -1 }).limit(1).toArray();
  const lastNum = last[0]?.submission_code ? Number(last[0].submission_code.split("-").pop()) || 0 : 0;
  return `SUB-${year}-${String(lastNum + 1).padStart(5, "0")}`;
}

async function notify(db, userId, type, title, message, taskId = null) {
  await createUserNotification(db, userId, {
    type,
    title,
    message,
    related_task_id: taskId
  });
}

async function transition(db, task, toStatus, actorId, comment = null) {
  const from = task.workflow_status || "Assigned";
  if (from === toStatus) return;
  const now = new Date().toISOString();
  await db.collection("tasks").updateOne(
    { _id: toId(String(task._id)) },
    { $set: { workflow_status: toStatus, status: legacyStatus(toStatus), completed_at: toStatus === "Approved" ? now : null, updated_at: now } }
  );
  await db.collection("task_status_history").insertOne({
    task_id: String(task._id), from_status: from, to_status: toStatus, changed_by: String(actorId), comment, created_at: now
  });
  await writeAudit(db, { actorId, action: "task_status_changed", entityType: "task", entityId: String(task._id), previousValue: { status: from }, newValue: { status: toStatus }, metadata: { comment } });
}

async function buildTaskResponse(db, tasks) {
  return Promise.all(tasks.map(async t => {
    const assigned = await db.collection("users").findOne({ _id: toId(t.assigned_to) }, { projection: { name: 1, email: 1 } });
    const creator = await db.collection("users").findOne({ _id: toId(t.assigned_by) }, { projection: { name: 1 } });
    const fileCount = await db.collection("task_files").countDocuments({ task_id: String(t._id) });
    const subCount = await db.collection("submissions").countDocuments({ task_id: String(t._id) });
    const lastSub = await db.collection("submissions").find({ task_id: String(t._id) }, { projection: { version: 1 } }).sort({ version: -1 }).limit(1).toArray();
    return {
      ...t,
      id: String(t._id),
      student_name: assigned?.name,
      student_email: assigned?.email,
      assigned_by_name: creator?.name,
      file_count: fileCount,
      submission_count: subCount,
      latest_version: lastSub[0]?.version || null
    };
  }));
}

/* ─── GET MY TASKS (student) ────────────────────────────────────────────── */
router.get("/my", authenticateToken, checkStudentRegistrationStatus, authorizeRoles("student", "member"), async (req, res) => {
  try {
    const db = req.db;
    const tasks = await db.collection("tasks").find({ assigned_to: req.user.id }).sort({ created_at: -1 }).toArray();
    const result = await buildTaskResponse(db, tasks);
    res.json({ success: true, tasks: result });
  } catch (e) { console.error("GET MY TASKS:", e); res.status(500).json({ success: false, message: "Unable to load tasks" }); }
});

/* ─── GET STUDENTS LIST (for task assignment) ───────────────────────────── */
router.get("/students", authenticateToken, authorizeRoles("admin", "manager"), async (req, res) => {
  try {
    const db = req.db;
    const students = await db.collection("users").find({ role: "student", active: 1 }, { projection: { name: 1, email: 1, department: 1, created_at: 1 } }).sort({ name: 1 }).toArray();
    res.json({ success: true, students: students.map(s => ({ ...s, id: String(s._id) })) });
  } catch (e) { res.status(500).json({ success: false, message: "Unable to fetch students" }); }
});

/* ─── GET SUBMISSIONS ───────────────────────────────────────────────────── */
router.get("/submissions", authenticateToken, authorizeRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const subTaskIds = await db.collection("submissions").distinct("task_id");
    const tasks = await db.collection("tasks").find(
      { $or: [{ _id: { $in: subTaskIds.map(id => { try { return new ObjectId(id); } catch { return id; } }) } }, { outcome: { $exists: true, $ne: null } }] },
      { projection: { task_code: 1, title: 1, status: 1, workflow_status: 1, outcome: 1, outcome_submitted_at: 1, assigned_to: 1 } }
    ).sort({ outcome_submitted_at: -1 }).limit(100).toArray();

    const rows = await Promise.all(tasks.map(async t => {
      const student = await db.collection("users").findOne({ _id: toId(t.assigned_to) }, { projection: { name: 1, email: 1 } });
      const fileCount = await db.collection("submission_files").countDocuments({ submission_id: { $in: await db.collection("submissions").distinct("_id", { task_id: String(t._id) }).then(ids => ids.map(String)) } });
      const subCount = await db.collection("submissions").countDocuments({ task_id: String(t._id) });
      return { id: String(t._id), task_code: t.task_code, title: t.title, status: t.status, workflow_status: t.workflow_status, outcome: t.outcome, outcome_submitted_at: t.outcome_submitted_at, assigned_to: t.assigned_to, student_name: student?.name, student_email: student?.email, file_count: fileCount, submission_count: subCount };
    }));
    res.json({ success: true, submissions: rows });
  } catch (e) { console.error("GET SUBMISSIONS:", e); res.status(500).json({ success: false, message: "Unable to fetch submissions" }); }
});

/* ─── GET ALL TASKS ─────────────────────────────────────────────────────── */
router.get("/", authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    let tasks;
    if (["student", "member"].includes(req.user.role)) {
      // Students must have approved registration
      if (req.user.role === "student") {
        const user = await db.collection("users").findOne({ _id: toId(req.user.id) }, { projection: { registration_status: 1 } });
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        const status = user.registration_status || "approved";
        if (status === "pending") return res.status(403).json({ success: false, code: "REGISTRATION_PENDING", message: "Your registration is pending CEO approval" });
        if (status === "rejected") return res.status(403).json({ success: false, code: "REGISTRATION_REJECTED", message: "Your registration has been rejected" });
      }
      tasks = await db.collection("tasks").find({ assigned_to: req.user.id }).sort({ created_at: -1 }).toArray();
    } else if (["admin", "manager", "ceo"].includes(req.user.role)) {
      tasks = await db.collection("tasks").find({}).sort({ created_at: -1 }).toArray();
    } else {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const result = await buildTaskResponse(db, tasks);
    res.json({ success: true, tasks: result });
  } catch (e) { console.error("GET ALL TASKS:", e); res.status(500).json({ success: false, message: "Unable to load tasks" }); }
});

/* ─── CREATE TASK ───────────────────────────────────────────────────────── */
router.post("/", authenticateToken, authorizeRoles("admin", "ceo", "manager"), async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || "").trim();
    if (!title) return res.status(400).json({ success: false, message: "Task title is required" });

    const assignedTo = b.assigned_to ? String(b.assigned_to) : null;
    const program = b.program ? String(b.program).trim().toLowerCase() : null;
    const domain = b.domain ? String(b.domain).trim().toLowerCase() : null;
    const group = b.group ? String(b.group).trim().toLowerCase() : null;

    if (!domain || !ALLOWED_DOMAINS.includes(domain)) {
      return res.status(400).json({ success: false, message: "Invalid domain. Choose from: " + ALLOWED_DOMAINS.join(", ") });
    }

    const db = req.db;
    let studentsToNotify = [];

    if (assignedTo && !program && !group) {
      const student = await db.collection("users").findOne({ _id: toId(assignedTo), role: "student", active: 1 });
      if (!student) return res.status(404).json({ success: false, message: "Student not found" });
      studentsToNotify.push(student);
    } else if (program) {
      if (!ALLOWED_PROGRAMS.includes(program)) {
        return res.status(400).json({ success: false, message: "Invalid program. Choose from: " + ALLOWED_PROGRAMS.join(", ") });
      }
      studentsToNotify = await db.collection("users").find({ program, role: "student", active: 1 }).toArray();
      if (studentsToNotify.length === 0) return res.status(404).json({ success: false, message: "No active students found in this program" });
    } else if (group) {
      // Group-based assignment: group is stored in users.program field
      studentsToNotify = await db.collection("users").find({ program: group, role: "student", active: 1 }).toArray();
      if (studentsToNotify.length === 0) return res.status(404).json({ success: false, message: "No active students found in this group" });
    } else {
      return res.status(400).json({ success: false, message: "Select a student, program, or group" });
    }

    const priority = String(b.priority || "medium").toLowerCase();
    if (!priorityValues.has(priority)) return res.status(400).json({ success: false, message: "Invalid priority" });

    const workflow = String(b.workflow_status || "Assigned");
    if (!STATUS.includes(workflow)) return res.status(400).json({ success: false, message: "Invalid task workflow status" });

    if (b.start_date && b.due_date && b.start_date > b.due_date) {
      return res.status(400).json({ success: false, message: "Starting Date cannot be after Ending Date" });
    }

    const taskCode = await nextTaskCode(db);
    const taskIds = [];

    for (const student of studentsToNotify) {
      const studentId = String(student._id);
      const now = new Date().toISOString();
      const result = await db.collection("tasks").insertOne({
        task_code: taskCode,
        title,
        category: String(b.category || "").trim() || null,
        program: program || null,
        group: group || null,
        department: null,
        domain,
        team: String(b.team || "").trim() || null,
        task_type: String(b.task_type || "General"),
        description: String(b.description || "").trim(),
        what: String(b.what || "").trim(),
        why: String(b.why || "").trim(),
        how: String(b.how || "").trim(),
        how_to_do: b.how_to_do ? String(b.how_to_do).trim().substring(0, 5000) : null,
        expected_output: String(b.expected_output || "").trim(),
        submission_requirements: String(b.submission_requirements || "").trim(),
        resources: String(b.resources || "").trim(),
        notes: String(b.notes || "").trim(),
        assigned_to: studentId,
        assigned_by: req.user.id,
        status: legacyStatus(workflow),
        workflow_status: workflow,
        priority,
        start_date: b.start_date || null,
        due_date: b.due_date || null,
        completed_at: null,
        feedback: null,
        outcome: null,
        outcome_submitted_at: null,
        created_at: now,
        updated_at: now
      });
      const taskId = String(result.insertedId);
      taskIds.push(taskId);

      await notify(db, studentId, "task_assigned", "New task assigned", `${title} (${taskCode}) has been assigned to you.`, taskId);
      await writeAudit(db, { actorId: req.user.id, action: "task_created", entityType: "task", entityId: taskId, newValue: { task_code: taskCode, title, assigned_to: studentId, workflow_status: workflow } });

      try {
        await sendTaskAssignmentEmail({ to: student.email, studentName: student.name, taskTitle: title, description: String(b.description || ""), dueDate: b.due_date, appUrl: process.env.APP_URL });
      } catch (e) { console.error("Task email notification failed:", e.message); }
    }

    res.status(201).json({ success: true, message: "Task assigned successfully", taskId: taskIds[0], taskCode });
  } catch (e) { console.error("Create task error:", e); res.status(500).json({ success: false, message: "Unable to create task" }); }
});

/* ─── GET TASK BY ID ────────────────────────────────────────────────────── */
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    const task = await db.collection("tasks").findOne({ _id: toId(req.params.id) });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });

    const allowed = ["admin", "manager", "ceo"].includes(req.user.role) || task.assigned_to === req.user.id;
    if (!allowed) return res.status(403).json({ success: false, message: "Access denied" });

    const history = await db.collection("task_status_history").find({ task_id: String(task._id) }).sort({ created_at: 1 }).toArray();
    const submissions = await db.collection("submissions").find({ task_id: String(task._id) }).sort({ version: -1 }).toArray();

    const historyWithNames = await Promise.all(history.map(async h => {
      const u = await db.collection("users").findOne({ _id: toId(h.changed_by) }, { projection: { name: 1 } });
      return { ...h, id: String(h._id), changed_by_name: u?.name };
    }));
    const subsWithNames = await Promise.all(submissions.map(async s => {
      const u = s.reviewer_id ? await db.collection("users").findOne({ _id: toId(s.reviewer_id) }, { projection: { name: 1 } }) : null;
      return { ...s, id: String(s._id), reviewer_name: u?.name };
    }));

    res.json({ success: true, task: { ...task, id: String(task._id) }, history: historyWithNames, submissions: subsWithNames });
  } catch (e) { res.status(500).json({ success: false, message: "Unable to fetch task" }); }
});

/* ─── UPDATE TASK STATUS ────────────────────────────────────────────────── */
router.patch("/:id/status", authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    const task = await db.collection("tasks").findOne({ _id: toId(req.params.id) });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });

    const requested = String(req.body?.workflow_status || req.body?.status || "").trim();
    const map = { pending: "Assigned", in_progress: "In Progress", completed: "Approved" };
    const toStatus = map[requested.toLowerCase()] || requested;
    if (!STATUS.includes(toStatus)) return res.status(400).json({ success: false, message: "Invalid task status" });

    const studentOwner = task.assigned_to === req.user.id && ["student", "member"].includes(req.user.role);
    const managerOwner = task.assigned_by === req.user.id && req.user.role === "manager";
    const admin = ["admin", "ceo"].includes(req.user.role);

    if (!studentOwner && !managerOwner && !admin) return res.status(403).json({ success: false, message: "Access denied" });
    if (studentOwner && !["Acknowledged", "In Progress"].includes(toStatus)) return res.status(403).json({ success: false, message: "Students cannot directly approve or review tasks" });
    if ((admin || managerOwner) && toStatus === "Approved" && !["Under Review", "Resubmitted", "Submitted", "Revision Required"].includes(task.workflow_status)) {
      return res.status(409).json({ success: false, message: "Task must have a submission before approval" });
    }

    await transition(db, task, toStatus, req.user.id, req.body?.comment || null);
    if (toStatus === "In Progress") await notify(db, task.assigned_by, "task_started", "Task started", `${task.title} was marked in progress.`, String(task._id));
    if (toStatus === "Approved") await notify(db, task.assigned_to, "task_approved", "Task approved", `${task.title} has been approved.`, String(task._id));

    res.json({ success: true, message: "Task status updated", workflow_status: toStatus });
  } catch (e) { console.error("Update status:", e); res.status(500).json({ success: false, message: "Unable to update status" }); }
});

/* ─── SUBMIT TASK ───────────────────────────────────────────────────────── */
router.post("/:id/submit", authenticateToken, checkStudentRegistrationStatus, authorizeRoles("student", "member"), upload.array("files", 5), async (req, res) => {
  try {
    const db = req.db;
    const task = await db.collection("tasks").findOne({ _id: toId(req.params.id), assigned_to: req.user.id });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    if (["Approved", "Cancelled", "Archived"].includes(task.workflow_status)) return res.status(409).json({ success: false, message: "This task cannot accept a submission" });

    const lastSub = await db.collection("submissions").find({ task_id: String(task._id) }).sort({ version: -1 }).limit(1).toArray();
    const version = (lastSub[0]?.version || 0) + 1;
    const submissionCode = await nextSubmissionCode(db);
    const submittedAt = new Date().toISOString();

    // Store files in uploads directory
    const folder = path.join(__dirname, "..", "uploads", `student_${req.user.id}`, `task_${task._id}`, `submission_v${version}`);
    fs.mkdirSync(folder, { recursive: true });

    const subResult = await db.collection("submissions").insertOne({
      submission_code: submissionCode,
      task_id: String(task._id),
      student_id: req.user.id,
      version,
      comment: String(req.body?.comment || "").trim() || null,
      status: "Submitted",
      submitted_at: submittedAt,
      reviewer_id: null,
      reviewed_at: null,
      review_comments: null,
      created_at: submittedAt
    });
    const sid = String(subResult.insertedId);

    for (const file of (req.files || [])) {
      const safe = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const full = path.join(folder, safe);
      fs.writeFileSync(full, file.buffer);
      await db.collection("submission_files").insertOne({ submission_id: sid, original_name: file.originalname, stored_name: safe, mime_type: file.mimetype, size: file.size, storage_path: full, created_at: submittedAt });
    }

    await transition(db, task, version > 1 ? "Resubmitted" : "Submitted", req.user.id, "Submission received");
    await notify(db, task.assigned_by, "submission_received", "Submission received", `${submissionCode} was submitted for ${task.title}.`, String(task._id));
    await writeAudit(db, { actorId: req.user.id, action: "submission_uploaded", entityType: "submission", entityId: sid, newValue: { submission_code: submissionCode, task_id: String(task._id), version, submitted_at: submittedAt } });

    res.status(201).json({ success: true, message: "Submission stored successfully", submissionId: sid, submissionCode, version, submittedAt });
  } catch (e) { console.error("Submission error:", e); res.status(500).json({ success: false, message: "Unable to store submission" }); }
});

/* ─── REVIEW SUBMISSION ─────────────────────────────────────────────────── */
router.post("/review", authenticateToken, authorizeRoles("admin", "ceo", "manager"), async (req, res) => {
  try {
    const db = req.db;
    const sub = await db.collection("submissions").findOne({ _id: toId(req.body?.submission_id) });
    if (!sub) return res.status(404).json({ success: false, message: "Submission not found" });

    const task = await db.collection("tasks").findOne({ _id: toId(sub.task_id) });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });

    const effectiveRole = req.user.role === "ceo" ? "admin" : req.user.role;
    if (effectiveRole === "manager" && task.assigned_by !== req.user.id) return res.status(403).json({ success: false, message: "You can only review tasks assigned by you" });

    const decision = String(req.body?.decision || "").toLowerCase();
    const comment = String(req.body?.comment || "").trim();
    if (!["approve", "revision"].includes(decision) || !comment) return res.status(400).json({ success: false, message: "Decision and review comment are required" });

    const next = decision === "approve" ? "Approved" : "Revision Required";
    const now = new Date().toISOString();

    await db.collection("submissions").updateOne({ _id: sub._id }, { $set: { status: next, reviewer_id: req.user.id, reviewed_at: now, review_comments: comment } });
    await transition(db, task, next, req.user.id, comment);
    await notify(db, sub.student_id, decision === "approve" ? "task_approved" : "revision_required", decision === "approve" ? "Task approved" : "Revision required", `${task.title}: ${comment}`, sub.task_id);
    await writeAudit(db, { actorId: req.user.id, action: decision === "approve" ? "submission_approved" : "revision_requested", entityType: "submission", entityId: String(sub._id), previousValue: { status: sub.status }, newValue: { status: next, review_comments: comment } });

    res.json({ success: true, message: decision === "approve" ? "Submission approved" : "Revision requested", status: next });
  } catch (e) { console.error("Review error:", e); res.status(500).json({ success: false, message: "Unable to review submission" }); }
});

/* ─── TASK FEEDBACK ─────────────────────────────────────────────────────── */
router.patch("/:id/feedback", authenticateToken, authorizeRoles("admin", "ceo", "manager"), async (req, res) => {
  try {
    const db = req.db;
    const task = await db.collection("tasks").findOne({ _id: toId(req.params.id) });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });

    const effectiveRole = req.user.role === "ceo" ? "admin" : req.user.role;
    if (effectiveRole === "manager" && task.assigned_by !== req.user.id) return res.status(403).json({ success: false, message: "Access denied" });

    const feedback = String(req.body?.feedback || "").trim() || null;
    const now = new Date().toISOString();
    await db.collection("tasks").updateOne({ _id: task._id }, { $set: { feedback, updated_at: now } });
    await notify(db, task.assigned_to, "feedback", "New task feedback", feedback || "New feedback was added.", String(task._id));
    await writeAudit(db, { actorId: req.user.id, action: "feedback_added", entityType: "task", entityId: String(task._id), newValue: { feedback } });

    res.json({ success: true, message: "Task feedback updated" });
  } catch (e) { res.status(500).json({ success: false, message: "Unable to update feedback" }); }
});

/* ─── TASK OUTCOME ──────────────────────────────────────────────────────── */
router.patch("/:id/outcome", authenticateToken, checkStudentRegistrationStatus, authorizeRoles("student", "member"), async (req, res) => {
  try {
    const db = req.db;
    const task = await db.collection("tasks").findOne({ _id: toId(req.params.id), assigned_to: req.user.id });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });

    const outcome = String(req.body?.outcome || "").trim();
    if (!outcome) return res.status(400).json({ success: false, message: "Task outcome is required" });

    const now = new Date().toISOString();
    await db.collection("tasks").updateOne({ _id: task._id }, { $set: { outcome, outcome_submitted_at: now, updated_at: now } });

    if (!["Submitted", "Under Review", "Revision Required", "Resubmitted"].includes(task.workflow_status)) {
      await transition(db, task, "Submitted", req.user.id, "Outcome submitted");
    }

    // Notify CEO/Admin about task outcome (with authorization check)
    await createCeoNotification(db, req.user.email, {
      type: "task_outcome",
      title: "New task outcome submitted",
      message: `${task.title} received an outcome from a student.`,
      related_task_id: String(task._id)
    });
    
    await writeAudit(db, { actorId: req.user.id, action: "task_outcome_submitted", entityType: "task", entityId: String(task._id), newValue: { outcome, submitted_at: now } });

    res.json({ success: true, message: "Task outcome saved" });
  } catch (e) { res.status(500).json({ success: false, message: "Unable to save outcome" }); }
});

/* ─── GET TASK SUBMISSIONS ──────────────────────────────────────────────── */
router.get("/:id/submissions", authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    const task = await db.collection("tasks").findOne({ _id: toId(req.params.id) });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    if (!["admin", "manager", "ceo"].includes(req.user.role) && task.assigned_to !== req.user.id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const submissions = await db.collection("submissions").find({ task_id: String(task._id) }).sort({ version: -1 }).toArray();
    const rows = await Promise.all(submissions.map(async s => {
      const u = s.reviewer_id ? await db.collection("users").findOne({ _id: toId(s.reviewer_id) }, { projection: { name: 1 } }) : null;
      const fc = await db.collection("submission_files").countDocuments({ submission_id: String(s._id) });
      return { ...s, id: String(s._id), reviewer_name: u?.name, file_count: fc };
    }));
    res.json({ success: true, submissions: rows });
  } catch (e) { res.status(500).json({ success: false, message: "Unable to fetch submissions" }); }
});

module.exports = router;
