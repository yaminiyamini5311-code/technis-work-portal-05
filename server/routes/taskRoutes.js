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
    const assigned = t.assigned_to
      ? await db.collection("users").findOne({ _id: toId(t.assigned_to) }, { projection: { name: 1, email: 1 } })
      : null;
    const creator = await db.collection("users").findOne({ _id: toId(t.assigned_by) }, { projection: { name: 1 } });
    const fileCount = await db.collection("task_files").countDocuments({ task_id: String(t._id) });
    const subCount = await db.collection("submissions").countDocuments({ task_id: String(t._id) });
    const lastSub = await db.collection("submissions").find({ task_id: String(t._id) }, { projection: { version: 1 } }).sort({ version: -1 }).limit(1).toArray();
    // Per-student assignment summary for this task
    const assignments = await db.collection("task_assignments")
      .find({ task_id: String(t._id) }, { projection: { student_id: 1, status: 1, progress: 1 } })
      .toArray();
    const assigneeIds = [...new Set(assignments.map(a => a.student_id))];
    let batchName = null;
    if (t.batch_id) {
      const batch = await db.collection("batches").findOne({ _id: toId(t.batch_id) }, { projection: { name: 1 } });
      batchName = batch?.name || null;
    }
    return {
      ...t,
      id: String(t._id),
      student_name: assigned?.name,
      student_email: assigned?.email,
      assigned_by_name: creator?.name,
      file_count: fileCount,
      submission_count: subCount,
      latest_version: lastSub[0]?.version || null,
      assignee_count: assigneeIds.length,
      assignee_ids: assigneeIds,
      batch_name: batchName,
    };
  }));
}

/* ─── GET MY TASKS (student) ──────────────────────────────────────
 * A student's tasks = every task with a TaskAssignment for
 * them (batch tasks included). Legacy tasks assigned directly
 * via assigned_to are also included.
 */
router.get("/my", authenticateToken, checkStudentRegistrationStatus, authorizeRoles("student", "member"), async (req, res) => {
  try {
    const db = req.db;
    const { getStudentTaskIds } = require("../models/TaskAssignment");
    const assignedTaskIds = await getStudentTaskIds(db, req.user.id);
    const tasks = await db.collection("tasks").find({
      $or: [
        { _id: { $in: assignedTaskIds.map(id => { try { return toId(id); } catch { return id; } }) } },
        { assigned_to: req.user.id },
      ]
    }).sort({ created_at: -1 }).toArray();
    const result = await buildTaskResponse(db, tasks);
    res.json({ success: true, tasks: result });
  } catch (e) { console.error("GET MY TASKS:", e); res.status(500).json({ success: false, message: "Unable to load tasks" }); }
});

/* ─── GET STUDENTS LIST (for task assignment) ───────────────────────────── */
router.get("/students", authenticateToken, authorizeRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const students = await db.collection("users").find({ role: "student", active: 1 }, { projection: { name: 1, email: 1, department: 1, program: 1, batch_id: 1, created_at: 1 } }).sort({ name: 1 }).toArray();
    const batchIds = [...new Set(students.map(s => s.batch_id).filter(Boolean))];
    const batches = batchIds.length
      ? await db.collection("batches").find({ _id: { $in: batchIds.map(id => { try { return toId(id); } catch { return id; } }) } }, { projection: { name: 1 } }).toArray()
      : [];
    const batchNameById = new Map(batches.map(b => [String(b._id), b.name]));
    res.json({
      success: true,
      students: students.map(s => ({
        ...s,
        id: String(s._id),
        batch_name: s.batch_id ? (batchNameById.get(String(s.batch_id)) || null) : null,
      })),
    });
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
      // Tasks assigned through TaskAssignment (batch or multi-student)
      const { getStudentTaskIds } = require("../models/TaskAssignment");
      const assignedTaskIds = await getStudentTaskIds(db, req.user.id);
      const extra = await db.collection("tasks").find({
        _id: { $in: assignedTaskIds.map(id => { try { return toId(id); } catch { return id; } }) },
        assigned_to: { $ne: req.user.id },
      }).sort({ created_at: -1 }).toArray();
      const seen = new Set(tasks.map(t => String(t._id)));
      tasks = tasks.concat(extra.filter(t => !seen.has(String(t._id))));
    } else if (["admin", "manager", "ceo"].includes(req.user.role)) {
      tasks = await db.collection("tasks").find({}).sort({ created_at: -1 }).toArray();
    } else {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const result = await buildTaskResponse(db, tasks);
    res.json({ success: true, tasks: result });
  } catch (e) { console.error("GET ALL TASKS:", e); res.status(500).json({ success: false, message: "Unable to load tasks" }); }
});

/* ─── DELETE TASK ──────────────────────────────────────────────────────────
 * Removes one task and the records that exist only because of it:
 *   task_assignments  (one row per student)
 *   submissions       (+ submission_files belonging to them)
 *   notifications     (pointing at this task)
 *
 * Assignment logic for every OTHER task is untouched, so batch and
 * multi-student relationships elsewhere are preserved.
 * Authorized exactly like task creation (admin / ceo / manager).
 */
router.delete("/:id", authenticateToken, authorizeRoles("admin", "ceo", "manager"), async (req, res) => {
  try {
    const db = req.db;
    // toId() is lenient (returns the raw string on failure), so validate
    // explicitly here to give a clear 400 instead of a confusing 404.
    let taskId;
    try {
      taskId = new ObjectId(String(req.params.id || "").trim());
    } catch {
      return res.status(400).json({ success: false, message: "Invalid task id" });
    }

    const task = await db.collection("tasks").findOne({ _id: taskId });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });

    const taskKey = String(task._id);

    // Count the dependent rows before removing them (reported back to the UI).
    const assignmentCount = await db.collection("task_assignments").countDocuments({ task_id: taskKey });
    const submissionCount = await db.collection("submissions").countDocuments({ task_id: taskKey });
    const notificationCount = await db.collection("notifications").countDocuments({ task_id: taskKey });

    await db.collection("task_assignments").deleteMany({ task_id: taskKey });

    // Remove submission files first: they reference submissions by id.
    const subIds = (await db.collection("submissions").distinct("_id", { task_id: taskKey })).map(String);
    if (subIds.length) {
      await db.collection("submission_files").deleteMany({ submission_id: { $in: subIds } });
    }
    await db.collection("submissions").deleteMany({ task_id: taskKey });

    if (notificationCount > 0) {
      await db.collection("notifications").deleteMany({ task_id: taskKey });
    }

    const result = await db.collection("tasks").deleteOne({ _id: taskId });
    if (result.deletedCount !== 1) {
      return res.status(409).json({ success: false, message: "Task could not be removed. Please refresh and try again." });
    }

    await writeAudit(db, {
      actorId: req.user.id,
      action: "task_deleted",
      entityType: "task",
      entityId: taskKey,
      previousValue: {
        task_code: task.task_code || null,
        title: task.title,
        target_type: task.target_type || null,
        batch_id: task.batch_id || null,
      },
      metadata: { assignments: assignmentCount, submissions: submissionCount, notifications: notificationCount },
    });

    res.json({
      success: true,
      message: "Task removed successfully",
      taskId: taskKey,
      removed: {
        assignments: assignmentCount,
        submissions: submissionCount,
        notifications: notificationCount,
      },
    });
  } catch (e) {
    console.error("DELETE TASK:", e);
    res.status(500).json({ success: false, message: "Unable to remove task" });
  }
});

/* ─── CREATE TASK ─────────────────────────────────────────────────────────
 * Payload options (all IDs are ObjectId STRINGS — never Numbers):
 *   target_type: "batch"   + batch_id            → whole batch
 *   target_type: "student" + student_ids: [...]  → one or more students
 *   legacy: assigned_to (single student string)
 *   legacy: program / group (program grouping)
 */
router.post("/", authenticateToken, authorizeRoles("admin", "ceo", "manager"), async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || "").trim();
    if (!title) return res.status(400).json({ success: false, message: "Task title is required" });

    const targetType = b.target_type ? String(b.target_type).trim().toLowerCase() : null;
    const batchId = b.batch_id ? String(b.batch_id).trim() : null;
    const studentIdsRaw = Array.isArray(b.student_ids) ? b.student_ids.map(String).map(s => s.trim()).filter(Boolean) : [];
    const assignedTo = b.assigned_to ? String(b.assigned_to).trim() : null;
    const program = b.program ? String(b.program).trim().toLowerCase() : null;
    const domain = b.domain ? String(b.domain).trim().toLowerCase() : null;
    const group = b.group ? String(b.group).trim().toLowerCase() : null;

    if (!domain || !ALLOWED_DOMAINS.includes(domain)) {
      return res.status(400).json({ success: false, message: "Invalid domain. Choose from: " + ALLOWED_DOMAINS.join(", ") });
    }

    const db = req.db;
    let targetStudents = [];   // resolved student docs
    let taskBatchId = null;    // set for batch-targeted tasks
    let taskTargetType = "student";

    if (targetType === "batch" || (targetType === null && batchId)) {
      // ── BATCH ASSIGNMENT ──────────────────────────────────────────
      if (!batchId) {
        return res.status(400).json({ success: false, message: "Batch is required for batch assignment" });
      }
      const { ObjectId: Oid } = require("mongodb");
      let batchOid;
      try { batchOid = new Oid(batchId); } catch { batchOid = null; }
      if (!batchOid) {
        return res.status(400).json({ success: false, message: "Invalid batch id" });
      }
      const batch = await db.collection("batches").findOne({ _id: batchOid });
      if (!batch) {
        return res.status(404).json({ success: false, message: "Batch not found" });
      }
      if (batch.active === false) {
        return res.status(400).json({ success: false, message: "Batch is deactivated. Reactivate it before assigning tasks." });
      }
      taskBatchId = String(batch._id);
      taskTargetType = "batch";
      targetStudents = await db.collection("users")
        .find({ batch_id: taskBatchId, role: "student", active: 1 })
        .toArray();
      if (targetStudents.length === 0) {
        return res.status(404).json({ success: false, message: "No active students in this batch" });
      }
    } else if (studentIdsRaw.length > 0) {
      // ── MULTI-STUDENT ASSIGNMENT ────────────────────────────────
      taskTargetType = "student";
      for (const sid of studentIdsRaw) {
        const { ObjectId: Oid } = require("mongodb");
        let sOid;
        try { sOid = new Oid(sid); } catch { sOid = null; }
        if (!sOid) return res.status(400).json({ success: false, message: `Invalid student id: ${sid}` });
        const student = await db.collection("users").findOne({ _id: sOid, role: "student", active: 1 });
        if (!student) return res.status(404).json({ success: false, message: `Student not found: ${sid}` });
        targetStudents.push(student);
      }
    } else if (assignedTo && !program && !group) {
      // ── LEGACY SINGLE-STUDENT ASSIGNMENT ────────────────────────
      taskTargetType = "student";
      const { ObjectId: Oid } = require("mongodb");
      let sOid;
      try { sOid = new Oid(assignedTo); } catch { sOid = null; }
      if (!sOid) return res.status(400).json({ success: false, message: "Invalid student id" });
      const student = await db.collection("users").findOne({ _id: sOid, role: "student", active: 1 });
      if (!student) return res.status(404).json({ success: false, message: "Student not found" });
      targetStudents.push(student);
    } else if (program) {
      if (!ALLOWED_PROGRAMS.includes(program)) {
        return res.status(400).json({ success: false, message: "Invalid program. Choose from: " + ALLOWED_PROGRAMS.join(", ") });
      }
      targetStudents = await db.collection("users").find({ program, role: "student", active: 1 }).toArray();
      if (targetStudents.length === 0) return res.status(404).json({ success: false, message: "No active students found in this program" });
    } else if (group) {
      targetStudents = await db.collection("users").find({ program: group, role: "student", active: 1 }).toArray();
      if (targetStudents.length === 0) return res.status(404).json({ success: false, message: "No active students found in this group" });
    } else {
      return res.status(400).json({ success: false, message: "Select a student, a batch, a program, or a group" });
    }

    const priority = String(b.priority || "medium").toLowerCase();
    if (!priorityValues.has(priority)) return res.status(400).json({ success: false, message: "Invalid priority" });

    const workflow = String(b.workflow_status || "Assigned");
    if (!STATUS.includes(workflow)) return res.status(400).json({ success: false, message: "Invalid task workflow status" });

    if (b.start_date && b.due_date && b.start_date > b.due_date) {
      return res.status(400).json({ success: false, message: "Starting Date cannot be after Ending Date" });
    }

    const taskCode = await nextTaskCode(db);
    const now = new Date().toISOString();

    // One shared Task document. Per-student state lives in task_assignments.
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
      target_type: taskTargetType,
      batch_id: taskBatchId,
      assigned_to: targetStudents[0] ? String(targetStudents[0]._id) : null,
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

    // One TaskAssignment per student (idempotent upsert, unique on
    // (task_id, student_id) — duplicate attempts cannot create rows).
    const { createAssignmentsForStudents } = require("../models/TaskAssignment");
    const assignmentResult = await createAssignmentsForStudents(
      db,
      taskId,
      targetStudents.map(s => String(s._id)),
      { status: "assigned", progress: 0 }
    );

    for (const student of targetStudents) {
      const studentId = String(student._id);
      await notify(db, studentId, "task_assigned", "New task assigned", `${title} (${taskCode}) has been assigned to you.`, taskId);
      try {
        await sendTaskAssignmentEmail({ to: student.email, studentName: student.name, taskTitle: title, description: String(b.description || ""), dueDate: b.due_date, appUrl: process.env.APP_URL });
      } catch (e) { console.error("Task email notification failed:", e.message); }
    }

    await writeAudit(db, { actorId: req.user.id, action: "task_created", entityType: "task", entityId: taskId, newValue: { task_code: taskCode, title, target_type: taskTargetType, batch_id: taskBatchId, assigned_count: targetStudents.length, workflow_status: workflow } });

    res.status(201).json({
      success: true,
      message: "Task assigned successfully",
      taskId,
      taskCode,
      target_type: taskTargetType,
      batch_id: taskBatchId,
      assigned_count: targetStudents.length,
      assignments_created: assignmentResult.created,
      assignments_existing: assignmentResult.existing,
    });
  } catch (e) { console.error("Create task error:", e); res.status(500).json({ success: false, message: "Unable to create task" }); }
});

/* ─── GET TASK BY ID ────────────────────────────────────────────────────── */
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    const task = await db.collection("tasks").findOne({ _id: toId(req.params.id) });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });

    // Authorization: CEO/admin/manager see everything.
    // A student may read a task only if they have an assignment
    // for it (batch or individual) or it is legacy-assigned to them.
    let allowed = ["admin", "manager", "ceo"].includes(req.user.role) || task.assigned_to === req.user.id;
    if (!allowed && ["student", "member"].includes(req.user.role)) {
      const { getAssignment } = require("../models/TaskAssignment");
      const assignment = await getAssignment(db, String(task._id), req.user.id);
      allowed = Boolean(assignment);
    }
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

    // Per-student assignments (CEO/admin/manager only — students see only their own)
    let assignments = [];
    if (["admin", "manager", "ceo"].includes(req.user.role)) {
      const { listAssignmentsForTask } = require("../models/TaskAssignment");
      assignments = await listAssignmentsForTask(db, String(task._id));
    } else {
      const { getAssignment } = require("../models/TaskAssignment");
      const own = await getAssignment(db, String(task._id), req.user.id);
      if (own) assignments = [{
        id: String(own._id),
        task_id: own.task_id,
        student_id: own.student_id,
        status: own.status,
        progress: own.progress,
        submission_version: own.submission_version || null,
        submission_comment: own.submission_comment || null,
        submitted_at: own.submitted_at || null,
        created_at: own.created_at || null,
        updated_at: own.updated_at || null,
      }];
    }

    res.json({ success: true, task: { ...task, id: String(task._id) }, history: historyWithNames, submissions: subsWithNames, assignments });
  } catch (e) { res.status(500).json({ success: false, message: "Unable to fetch task" }); }
});

/* ─── LIST ASSIGNMENTS FOR A TASK (admin/manager/ceo) ─────────── */
router.get("/:id/assignments", authenticateToken, authorizeRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const task = await db.collection("tasks").findOne({ _id: toId(req.params.id) }, { projection: { title: 1, task_code: 1 } });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    const { listAssignmentsForTask } = require("../models/TaskAssignment");
    const assignments = await listAssignmentsForTask(db, String(task._id));
    res.json({ success: true, task: { id: String(task._id), title: task.title, task_code: task.task_code }, assignments });
  } catch (e) {
    console.error("GET ASSIGNMENTS:", e);
    res.status(500).json({ success: false, message: "Unable to fetch assignments" });
  }
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

    const { getAssignment, updateAssignment } = require("../models/TaskAssignment");
    const studentAssignment = ["student", "member"].includes(req.user.role)
      ? await getAssignment(db, String(task._id), req.user.id)
      : null;
    const studentOwner = (task.assigned_to === req.user.id || studentAssignment) && ["student", "member"].includes(req.user.role);
    const managerOwner = task.assigned_by === req.user.id && req.user.role === "manager";
    const admin = ["admin", "ceo"].includes(req.user.role);

    if (!studentOwner && !managerOwner && !admin) return res.status(403).json({ success: false, message: "Access denied" });
    if (studentOwner && !["Acknowledged", "In Progress"].includes(toStatus)) return res.status(403).json({ success: false, message: "Students cannot directly approve or review tasks" });
    if ((admin || managerOwner) && toStatus === "Approved" && !["Under Review", "Resubmitted", "Submitted", "Revision Required"].includes(task.workflow_status)) {
      return res.status(409).json({ success: false, message: "Task must have a submission before approval" });
    }

    await transition(db, task, toStatus, req.user.id, req.body?.comment || null);
    // Mirror the transition into the acting student's assignment
    if (studentOwner && studentAssignment) {
      await updateAssignment(db, String(task._id), req.user.id, { status: "in_progress" });
    }
    if (toStatus === "In Progress") await notify(db, task.assigned_by, "task_started", "Task started", `${task.title} was marked in progress.`, String(task._id));
    if (toStatus === "Approved") {
      // Notify every student assigned to this task (batch tasks have many)
      const { listAssignmentsForTask } = require("../models/TaskAssignment");
      const assignees = await listAssignmentsForTask(db, String(task._id));
      for (const a of assignees) {
        await notify(db, a.student_id, "task_approved", "Task approved", `${task.title} has been approved.`, String(task._id));
      }
      // Mark every student assignment on this task as approved
      await db.collection("task_assignments").updateMany(
        { task_id: String(task._id) },
        { $set: { status: "approved", progress: 100, updated_at: new Date().toISOString() } }
      );
    }

    res.json({ success: true, message: "Task status updated", workflow_status: toStatus });
  } catch (e) { console.error("Update status:", e); res.status(500).json({ success: false, message: "Unable to update status" }); }
});

/* ─── SUBMIT TASK ───────────────────────────────────────────────────────── */
router.post("/:id/submit", authenticateToken, checkStudentRegistrationStatus, authorizeRoles("student", "member"), upload.array("files", 5), async (req, res) => {
  try {
    const db = req.db;
    const task = await db.collection("tasks").findOne({ _id: toId(req.params.id) });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });

    // Students may only submit tasks they have an assignment for
    const { getAssignment, updateAssignment } = require("../models/TaskAssignment");
    const assignment = await getAssignment(db, String(task._id), req.user.id);
    const legacyOwner = task.assigned_to === req.user.id;
    if (!assignment && !legacyOwner) return res.status(403).json({ success: false, message: "Access denied" });
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
    // Record the submission snapshot on the student's own assignment
    await updateAssignment(db, String(task._id), req.user.id, {
      status: "submitted",
      submission_version: version,
      submission_comment: String(req.body?.comment || "").trim() || null,
      submitted_at: submittedAt,
    });
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
    // Mirror the decision onto the submitting student's assignment
    const { updateAssignment } = require("../models/TaskAssignment");
    await updateAssignment(db, String(task._id), sub.student_id, {
      status: decision === "approve" ? "approved" : "revision_required",
      progress: decision === "approve" ? 100 : undefined,
    });
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
