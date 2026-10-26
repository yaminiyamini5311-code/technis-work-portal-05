const express = require("express");
const { ObjectId } = require("mongodb");
const { authenticateToken, authorizeRoles, checkStudentRegistrationStatus } = require("../middleware/authMiddleware");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { sendTaskAssignmentEmail } = require("../utils/email");
const { writeAudit } = require("../utils/audit_mongo");
const { ALLOWED_DOMAINS, ALLOWED_PROGRAMS } = require("../config");
const {
  TASK_STATUS,
  STATUS_LABELS,
  normalizeStatus,
  normalizeSubmissionStatus,
  resubmissionWindowHours,
} = require("../config/taskStatus");
const {
  buildTaskStudentState,
  expireStaleRevisionWindows,
  legacyDomainFor,
  loadTaskAssignees,
  resolveDomain,
  resolveProgram,
  resubmissionEligibility,
  validateRevisionFeedback,
  toId: sidToId,
} = require("../utils/submissionStatus");
const { notifyOnce, notifyAdmins, revisionMessage } = require("../utils/notifications");
const { formatISTDeadlineLabel } = require("../utils/time");
const { createCeoNotification, createUserNotification } = require("../utils/ceoNotification");
const { normalizeRegistrationStatus } = require("../utils/userAccount");
const { studentCode, STUDENT_PROFILE_PROJECTION } = require("../utils/students");
const { uploadFile, downloadFile, migrateFileToGridFS } = require("../utils/fileStorage");

const router = express.Router();

/** Roles allowed to review submissions, request revisions, approve and remind. */
const REVIEW_ROLES = ["admin", "ceo", "manager"];
const isReviewerRole = (role) => REVIEW_ROLES.includes(String(role || "").toLowerCase());

/**
 * Fields a student may NEVER set through any request body.
 * The client's form values are stripped before they reach the database so a
 * crafted request cannot approve itself, invent feedback or move a deadline.
 */
const STUDENT_FORBIDDEN_FIELDS = [
  "status", "workflow_status", "assignment_status",
  "review_comments", "feedback", "reviewed_by", "reviewer_id", "reviewed_at",
  "revision_deadline", "revision_requested_at", "revision_cycle",
  "resubmission_deadline", "score", "earned_score", "max_marks",
];

/** Remove the above keys from any student-supplied payload. */
function stripStudentControlledFields(body) {
  const clean = { ...(body || {}) };
  for (const key of STUDENT_FORBIDDEN_FIELDS) delete clean[key];
  return clean;
}

/** Consistent envelope so every client can rely on the same three fields. */
function ok(res, data, extra = {}) {
  return res.json({ success: true, data, error: null, ...extra });
}
function fail(res, status, code, message, extra = {}) {
  return res.status(status).json({ success: false, data: null, error: { code, message }, message, ...extra });
}
// Per-file limit is 4 MB: Vercel serverless rejects request bodies above
// ~4.5 MB at the platform level (opaque 413 before the app sees it), so a
// higher app-level limit could never actually be used in production.
// The client mirrors this limit so students get an instant, clear error.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = new Set([".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".zip", ".png", ".jpg", ".jpeg"]);
    cb(allowed.has(ext) ? null : new Error("Unsupported file type"), allowed.has(ext));
  }
});

const STATUS = ["Draft","Scheduled","Assigned","Acknowledged","In Progress","Submitted","Under Review","Revision Required","Resubmitted","Approved","Overdue","Cancelled","Archived"];
const priorityValues = new Set(["low","medium","high","critical"]);

function toId(id) { try { return new ObjectId(id); } catch { return id; } }
function combineTaskDateTime(date, time, defaultTime) {
  if (!date) return null;
  const t = time || defaultTime;
  try {
    // Parse with Asia/Kolkata timezone to match what the portal displays
    const dt = new Date(`${date}T${t}:00+05:30`);
    return dt.toISOString();
  } catch { return null; }
}
function taskStartAt(task) {
  return task?.start_at || combineTaskDateTime(task?.start_date, task?.start_time, "00:00");
}
function taskEndAt(task) {
  return task?.due_at || combineTaskDateTime(task?.due_date, task?.due_time, "23:59");
}


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

/* ─── TASK EDIT DIFF (used by the "Task Updated" notification) ─────────────
 * The notification copy is generated field by field from the real before/after
 * values, so it can never drift from what was saved and never contains
 * hardcoded text. Long prose fields are summarised as "<label> updated";
 * short, comparable fields (dates, title, priority, domain, program) name the
 * old and the new value.
 */

const NOTIFY_DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
});

/** Human label for an editable task field. */
const TASK_FIELD_LABELS = {
  title: "Title",
  description: "Description",
  expected_output: "Expected output",
  submission_requirements: "Submission requirements",
  how_to_do: "Instructions",
  priority: "Priority",
  domain: "Domain",
  program: "Program",
  day_number: "Day",
  start_date: "Start date",
  start_time: "Start time",
  due_date: "Deadline",
  due_time: "Deadline time",
};

/** Fields whose value is prose: never echoed into the message, only "updated". */
const TASK_TEXT_FIELDS = new Set(["description", "expected_output", "submission_requirements", "how_to_do"]);

function labelForField(key) {
  return TASK_FIELD_LABELS[key] || key.replace(/_/g, " ");
}

/** Render one field value for the message (dates as "18 Oct 2026"). */
function describeFieldValue(key, value) {
  if (value === null || value === undefined || value === "") return "cleared";
  if (key === "due_date" || key === "start_date") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return NOTIFY_DATE_FMT.format(d);
  }
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/**
 * Build the message fragments for the fields that actually changed.
 * Returns an array such as
 *   ["Deadline changed from 18 Oct 2026 to 20 Oct 2026", "Instructions updated"]
 */
function describeTaskChanges(changedKeys, before, after) {
  const parts = [];
  for (const key of changedKeys) {
    if (key === "start_at" || key === "due_at") continue; // derived from the date/time fields
    const b = before[key] ?? null;
    const a = after[key] ?? null;
    const label = labelForField(key);
    if (TASK_TEXT_FIELDS.has(key)) {
      parts.push(a === null || a === "" ? `${label} cleared` : `${label} updated`);
      continue;
    }
    if ((b === null || b === "") && a !== null && a !== "") parts.push(`${label} set to ${describeFieldValue(key, a)}`);
    else if ((a === null || a === "") && b !== null && b !== "") parts.push(`${label} cleared`);
    else parts.push(`${label} changed from ${describeFieldValue(key, b)} to ${describeFieldValue(key, a)}`);
  }
  return parts;
}

/** Stable hash of the real change set, used to de-duplicate notifications. */
function taskChangeHash(changedKeys, before, after) {
  const crypto = require("crypto");
  const payload = changedKeys
    .slice()
    .sort()
    .map(k => `${k}=${String(before[k] ?? "")}->${String(after[k] ?? "")}`)
    .join("|");
  return crypto.createHash("sha1").update(payload).digest("hex").slice(0, 16);
}

/**
 * Task-level mirror of the per-student state.
 *
 * It used to be a single value flipped by `transition()` the moment ANY student
 * submitted, which is why a task with 38 assignees showed one "Submitted" chip
 * for everybody. It is now derived: "Submitted" while nobody has handed work
 * in is impossible, and the real per-student picture lives in status_counts.
 * Every existing consumer of tasks.status / tasks.workflow_status keeps
 * working because the legacy values are still written.
 */
async function syncTaskWorkflowFromStudents(db, task) {
  const { counts } = await buildTaskStudentState(db, task);
  const now = new Date().toISOString();
  let next = "Assigned";
  if (counts.approved === counts.assigned && counts.assigned > 0) next = "Approved";
  else if (counts.submitted + counts.revision_required + counts.resubmission_expired > 0) next = counts.approved > 0 ? "Under Review" : "Submitted";
  else if (counts.in_progress > 0) next = "In Progress";
  if (task.workflow_status === next) return;
  await db.collection("tasks").updateOne(
    { _id: toId(String(task._id)) },
    { $set: { workflow_status: next, status: legacyStatus(next), updated_at: now } }
  );
  task.workflow_status = next;
  task.status = legacyStatus(next);
}

function transition(db, task, toStatus, actorId, comment = null) {
  const from = task.workflow_status || "Assigned";
  if (from === toStatus) return Promise.resolve();
  const now = new Date().toISOString();
  return db.collection("tasks").updateOne(
    { _id: toId(String(task._id)) },
    { $set: { workflow_status: toStatus, status: legacyStatus(toStatus), completed_at: toStatus === "Approved" ? now : null, updated_at: now } }
  ).then(() => db.collection("task_status_history").insertOne({
    task_id: String(task._id), from_status: from, to_status: toStatus, changed_by: String(actorId), comment, created_at: now
  })).then(() => writeAudit(db, { actorId, action: "task_status_changed", entityType: "task", entityId: String(task._id), previousValue: { status: from }, newValue: { status: toStatus }, metadata: { comment } })).catch((e) => {
    console.error("transition():", e.message);
  });
}

/**
 * Row shape for the Live Tasks table.
 *
 * Fixes the three counting/mapping defects at the source:
 *  - assignee_count is the union of the assignment snapshot and the live batch
 *    membership, so tasks of the same batch stop reporting different numbers.
 *  - submission_count counts DISTINCT students, not versions.
 *  - domain/program are resolved from real data: the legacy `program` pseudo
 *    domain maps to the owning domain and the program comes from the task or
 *    its assignees, instead of always rendering "—" .
 *  - status_counts is the per-student aggregate, so the Workflow column can
 *    show Submitted / Pending / In Progress / Revision / Approved together.
 */
async function buildTaskResponse(db, tasks) {
  return Promise.all(tasks.map(async t => {
    const assigned = t.assigned_to
      ? await db.collection("users").findOne({ _id: toId(t.assigned_to) }, { projection: { name: 1, email: 1 } })
      : null;
    const creator = await db.collection("users").findOne({ _id: toId(t.assigned_by) }, { projection: { name: 1 } });
    const fileCount = await db.collection("task_files").countDocuments({ task_id: String(t._id) });
    const lastSub = await db.collection("submissions").find({ task_id: String(t._id) }, { projection: { version: 1 } }).sort({ version: -1 }).limit(1).toArray();

    const assignees = await loadTaskAssignees(db, t);
    const assigneeIds = assignees.map(a => a.student_id);

    let batchName = null;
    if (t.batch_id) {
      const batch = await db.collection("batches").findOne({ _id: toId(t.batch_id) }, { projection: { name: 1 } });
      batchName = batch?.name || null;
    }

    const studentDocs = assignees.map(a => a.student).filter(Boolean);
    const program = await resolveProgram(db, t, studentDocs.length ? studentDocs : assigned ? [assigned] : []);
    const { domain, legacy_domain, effective_domain } = resolveDomain(t);

    const { counts } = await buildTaskStudentState(db, t);

    return {
      ...t,
      id: String(t._id),
      student_name: t.target_type === "batch" ? batchName : (assigned?.name || null),
      student_email: assigned?.email,
      assigned_by_name: creator?.name,
      file_count: fileCount,
      // DISTINCT students who handed work in — not the number of versions.
      submission_count: counts.submitters,
      latest_version: lastSub[0]?.version || null,
      assignee_count: assigneeIds.length,
      assignee_ids: assigneeIds,
      batch_name: batchName,
      program,
      domain,
      legacy_domain,
      effective_domain,
      status_counts: counts,
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

    // Attach the RUNNING session (if any) to each task in one query, plus the
    // server clock, so the student portal can render a live timer that is
    // correct even under client clock skew without a per-task request.
    const { sessionView } = require("../utils/taskSession");
    const activeSessions = await db.collection("task_sessions")
      .find({ student_id: req.user.id, status: "active" })
      .toArray();
    const sessionByTask = new Map(activeSessions.map(s => [String(s.task_id), s]));
    const now = new Date();

    res.json({
      success: true,
      server_now: now.toISOString(),
      tasks: result.map(t => ({ ...t, session: sessionView(sessionByTask.get(String(t.id)) || null, now) })),
    });
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

/* ─── GET SUBMISSIONS ─────────────────────────────────────────────────────
 * One row per SUBMISSION (not per task): students write the `submissions`
 * collection via POST /:id/submit, so this is where CEO/managers look.
 * (The old implementation read `tasks.outcome`, which the submit path
 * never sets, so real submissions never appeared.)
 *
 * Shape stays { success, submissions: [...] } and keeps every field the
 * dashboards already consume (id, title, student_name, file_count,
 * outcome, status, workflow_status, outcome_submitted_at), plus detail
 * fields for the Student Submissions pages (student/task info, files[]
 * with download_url, assignment progress, review info).
 */
router.get("/submissions", authenticateToken, authorizeRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const filter = {};
    if (req.query.task_id) filter.task_id = String(req.query.task_id);
    if (req.query.student_id) filter.student_id = String(req.query.student_id);
    if (req.query.status) filter.status = String(req.query.status);

    const subs = await db.collection("submissions").find(filter).sort({ submitted_at: -1 }).limit(limit).toArray();

    const rows = await Promise.all(subs.map(async s => {
      const sid = String(s._id);
      const [task, student, files, assignment, reviewer] = await Promise.all([
        db.collection("tasks").findOne({ _id: toId(s.task_id) }, { projection: { task_code: 1, title: 1, description: 1, status: 1, workflow_status: 1, feedback: 1, outcome: 1, outcome_submitted_at: 1, priority: 1, due_date: 1 } }),
        db.collection("users").findOne({ _id: toId(s.student_id) }, { projection: STUDENT_PROFILE_PROJECTION }),
        db.collection("submission_files").find({ submission_id: sid }, { projection: { original_name: 1, size: 1, mime_type: 1, created_at: 1, drive_file_id: 1, drive_folder_id: 1 } }).toArray(),
        db.collection("task_assignments").findOne({ task_id: String(s.task_id), student_id: String(s.student_id) }, { projection: { progress: 1, status: 1, revision_cycle: 1, revision_requested_at: 1, revision_deadline: 1, revision_status: 1 } }),
        s.reviewer_id ? db.collection("users").findOne({ _id: toId(s.reviewer_id) }, { projection: { name: 1 } }) : null,
      ]);
      let batchName = null;
      if (student?.batch_id) {
        const batch = await db.collection("batches").findOne({ _id: toId(student.batch_id) }, { projection: { name: 1 } });
        batchName = batch?.name || null;
      }
      const code = studentCode(student);
      return {
        id: sid,
        submission_code: s.submission_code,
        version: s.version,
        comment: s.comment || null,
        status: s.status,
        submitted_at: s.submitted_at,
        // Server-recorded timing. Null on pre-existing submissions, which the
        // CEO table renders as "Not recorded".
        task_started_at: s.task_started_at || null,
        task_submitted_at: s.task_submitted_at || s.submitted_at || null,
        duration_seconds: s.duration_seconds ?? null,
        reviewed_at: s.reviewed_at || null,
        reviewer_name: reviewer?.name || null,
        review_comments: s.review_comments || null,
        task_id: String(s.task_id),
        task_code: task?.task_code || null,
        task_title: task?.title || null,
        title: task?.title || null,
        task_description: task?.description || null,
        workflow_status: task?.workflow_status || null,
        task_feedback: task?.feedback || null,
        outcome: task?.outcome || null,
        outcome_submitted_at: task?.outcome_submitted_at || s.submitted_at || null,
        student_id: code,
        // Same value under an explicit name so new callers do not have to
        // know that TECHINS stores the display code in `learner_id`.
        student_code: code,
        // The users._id (DB ObjectId) is the only identifier the student
        // routes accept. String(null) yields the literal text "null", which
        // would travel into /admin/students/null as a truthy id, so a
        // submission without a student reference must stay null here and is
        // rejected by the client guard before any request is made.
        student_db_id: s.student_id ? String(s.student_id) : null,
        student_name: student?.name || null,
        student_email: student?.email || null,
        student_phone: student?.phone || null,
        student_program: student?.program || null,
        student_department: student?.department || null,
        batch_name: batchName,
        file_count: files.length,
        files: files.map(f => ({ id: String(f._id), name: f.original_name, size: f.size, mime: f.mime_type, download_url: `/api/tasks/files/${String(f._id)}/download` })),
        assignment_progress: assignment?.progress ?? null,
        assignment_status: assignment?.status ?? null,
        // The 24-hour resubmission window for THIS student's revision cycle,
        // so the submissions table can show the exact deadline without a
        // second round trip.
        revision_cycle: assignment?.revision_cycle ?? s.revision_cycle ?? null,
        revision_requested_at: assignment?.revision_requested_at ?? null,
        revision_deadline: assignment?.revision_deadline ?? null,
        revision_status: assignment?.revision_status ?? null,
      };
    }));
    res.json({ success: true, submissions: rows });
  } catch (e) { console.error("GET SUBMISSIONS:", e); res.status(500).json({ success: false, message: "Unable to fetch submissions" }); }
});

/* ─── EXPORT SUBMISSIONS TO EXCEL ──────────────────────────────────────────
 * Export student submissions as Excel workbook (.xlsx).
 * Supports filters: batch, status, task_id, student_id.
 * Returns all matching records without pagination limit.
 */
router.get("/submissions/export", authenticateToken, authorizeRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const XLSX = require('xlsx');
    const db = req.db;
    
    // Build filter from query params
    const filter = {};
    let batchStudentIds = [];
    if (req.query.task_id) filter.task_id = String(req.query.task_id);
    if (req.query.student_id) filter.student_id = String(req.query.student_id);
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.batch_name) {
      const batch = await db.collection("batches").findOne({ name: String(req.query.batch_name) }, { projection: { _id: 1 } });
      if (batch) {
        const batchStudents = await db.collection("users").find(
          { batch_id: String(batch._id) },
          { projection: { _id: 1 } }
        ).toArray();
        batchStudentIds = batchStudents.map(s => String(s._id));
        if (batchStudentIds.length > 0) {
          filter.student_id = { $in: batchStudentIds };
        }
      }
    }
    
    // Fetch all matching submissions without limit
    const subs = await db.collection("submissions").find(filter).sort({ submitted_at: -1 }).toArray();
    
    // Build complete dataset with all details
    const rows = await Promise.all(subs.map(async s => {
      const sid = String(s._id);
      const [task, student, files, assignment, reviewer] = await Promise.all([
        db.collection("tasks").findOne({ _id: toId(s.task_id) }, { projection: { task_code: 1, title: 1, description: 1, status: 1, workflow_status: 1, feedback: 1, priority: 1, due_date: 1, start_date: 1, domain: 1 } }),
        db.collection("users").findOne({ _id: toId(s.student_id) }, { projection: { name: 1, email: 1, phone: 1, program: 1, department: 1, batch_id: 1, student_id: 1 } }),
        db.collection("submission_files").find({ submission_id: sid }, { projection: { original_name: 1, size: 1, mime_type: 1, created_at: 1 } }).toArray(),
        db.collection("task_assignments").findOne({ task_id: String(s.task_id), student_id: String(s.student_id) }, { projection: { progress: 1, status: 1 } }),
        s.reviewer_id ? db.collection("users").findOne({ _id: toId(s.reviewer_id) }, { projection: { name: 1 } }) : null,
      ]);
      
      let batchName = null;
      if (student?.batch_id) {
        const batch = await db.collection("batches").findOne({ _id: toId(student.batch_id) }, { projection: { name: 1 } });
        batchName = batch?.name || null;
      }
      
      // Format file names as comma-separated list
      const fileNames = files.map(f => f.original_name).join(', ') || 'No files';
      
      // Format dates
      const formatDate = (d) => d ? new Date(d).toISOString().split('T')[0] : '';
      const formatDateTime = (d) => d ? new Date(d).toLocaleString('en-US', { 
        year: 'numeric', month: '2-digit', day: '2-digit', 
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false 
      }) : '';
      
      return {
        'Submission Code': s.submission_code || '',
        'Submission Version': s.version || 1,
        'Submission Status': s.status || '',
        'Submission Date': formatDateTime(s.submitted_at),
        'Student Name': student?.name || '',
        'Student ID': student?.student_id || String(s.student_id),
        'Student Email': student?.email || '',
        'Student Phone': student?.phone || '',
        'Department': student?.department || '',
        'Program': student?.program || '',
        'Batch': batchName || '',
        'Task Code': task?.task_code || '',
        'Task Title': task?.title || '',
        'Day': task?.day_number || task?.day || '',
        'Task Description': task?.description || '',
        'Task Domain': task?.domain || '',
        'Task Priority': task?.priority || '',
        'Task Start Date': formatDate(task?.start_date),
        'Task Due Date': formatDate(task?.due_date),
        'Task Workflow Status': task?.workflow_status || '',
        'Student Response/Comment': s.comment || '',
        'Uploaded Files': fileNames,
        'File Count': files.length,
        'Assignment Progress (%)': assignment?.progress ?? '',
        'Assignment Status': assignment?.status || '',
        'Reviewer Name': reviewer?.name || '',
        'Reviewed Date': formatDateTime(s.reviewed_at),
        'Review Comments': s.review_comments || '',
        'Task Feedback': task?.feedback || '',
        'Drive Folder Link': (files && files.length && files[0].drive_folder_id) ? ('https://drive.google.com/drive/folders/' + files[0].drive_folder_id) : '',
        'Submission File Link': (files && files.length) ? files.map(function(f){ return f.drive_file_id ? ('https://drive.google.com/file/d/' + f.drive_file_id + '/view') : ''; }).filter(Boolean).join('; ') : '',
      };
    }));
    
    // Include students who have NOT submitted (Pending) so the export is complete.
    const submittedKeys = new Set(rows.map(r => (r['Task Code'] || '') + '|' + (r['Student ID'] || '')));
    const assignmentFilter = {};
    if (filter.task_id) assignmentFilter.task_id = filter.task_id;
    if (filter.student_id) assignmentFilter.student_id = filter.student_id;
    if (batchStudentIds.length) assignmentFilter.student_id = { $in: batchStudentIds };
    const pendingAssignments = await db.collection("task_assignments").find(assignmentFilter).toArray();
    const pendingRows = [];
    for (const a of pendingAssignments) {
      const key = String(a.task_id) + '|' + String(a.student_id);
      if (submittedKeys.has(key)) continue;
      const [task, student] = await Promise.all([
        db.collection("tasks").findOne({ _id: toId(a.task_id) }, { projection: { task_code: 1, title: 1, description: 1, feedback: 1, due_date: 1, start_date: 1 } }),
        db.collection("users").findOne({ _id: toId(a.student_id) }, { projection: { name: 1, email: 1, student_id: 1 } }),
      ]);
      pendingRows.push({
        'Submission Code': '', 'Submission Version': '', 'Submission Status': 'Pending', 'Submission Date': '',
        'Student Name': student?.name || '', 'Student ID': student?.student_id || String(a.student_id),
        'Student Email': student?.email || '', 'Student Phone': '', 'Department': '', 'Program': '',
        'Batch': '', 'Task Code': task?.task_code || '', 'Task Title': task?.title || '',
        'Task Description': task?.description || '', 'Task Domain': '', 'Task Priority': '',
        'Task Start Date': task?.start_date ? new Date(task?.start_date).toISOString().split('T')[0] : '',
        'Task Due Date': task?.due_date ? new Date(task?.due_date).toISOString().split('T')[0] : '',
        'Task Workflow Status': task?.workflow_status || '',
        'Day': task?.day_number || task?.day || '',
        'Student Response/Comment': '', 'Uploaded Files': '', 'File Count': 0,
        'Assignment Progress (%)': a.progress ?? '', 'Assignment Status': a.status || '',
        'Reviewer Name': '', 'Reviewed Date': '', 'Review Comments': '', 'Task Feedback': task?.feedback || '',
        'Drive Folder Link': '', 'Submission File Link': '',
      });
    }
    rows.push(...pendingRows);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "No records found matching the filters" });
    }

    // Create Excel workbook
    const worksheet = XLSX.utils.json_to_sheet(rows);
    
    // Set column widths for better readability
    const columnWidths = [
      { wch: 18 }, // Submission Code
      { wch: 10 }, // Version
      { wch: 15 }, // Status
      { wch: 20 }, // Submission Date
      { wch: 20 }, // Student Name
      { wch: 15 }, // Student ID
      { wch: 25 }, // Student Email
      { wch: 15 }, // Student Phone
      { wch: 15 }, // Department
      { wch: 20 }, // Program
      { wch: 15 }, // Batch
      { wch: 15 }, // Task Code
      { wch: 30 }, // Task Title
      { wch: 50 }, // Task Description
      { wch: 12 }, // Task Domain
      { wch: 10 }, // Task Priority
      { wch: 12 }, // Task Start Date
      { wch: 12 }, // Task Due Date
      { wch: 15 }, // Task Workflow Status
      { wch: 50 }, // Student Response
      { wch: 40 }, // Uploaded Files
      { wch: 10 }, // File Count
      { wch: 10 }, // Progress
      { wch: 15 }, // Assignment Status
      { wch: 20 }, // Reviewer Name
      { wch: 20 }, // Reviewed Date
      { wch: 50 }, // Review Comments
      { wch: 50 }, // Task Feedback
      { wch: 10 }, // Day
      { wch: 45 }, // Drive Folder Link
      { wch: 60 }, // Submission File Link
    ];
    worksheet['!cols'] = columnWidths;
    
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Student Submissions');
    
    // Generate Excel file
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    // Generate filename with current date
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const filename = `TECHINS_Student_Submissions_${today}.xlsx`;
    
    // Set headers for Excel download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', excelBuffer.length);
    
    res.send(excelBuffer);
  } catch (e) {
    console.error("EXPORT SUBMISSIONS TO EXCEL:", e);
    res.status(500).json({ success: false, message: "Unable to export submissions to Excel" });
  }
});

/* ─── SINGLE SUBMISSION DETAIL ──────────────────────────────────────────────
 * GET /api/tasks/submissions/:submissionId
 *
 * Backs "View Details". Everything the review dialog renders is assembled from
 * ONE lookup of the submission id, so the dialog can never mix two students'
 * data: the student, the task, this version's files and every sibling version
 * all come from the same submission row.
 *
 * Reviewer roles only, and the response is scoped to the requested
 * submission — an unknown id is a 404, never another student's record.
 */
router.get("/submissions/:submissionId", authenticateToken, authorizeRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const submission = await db.collection("submissions").findOne({ _id: toId(req.params.submissionId) });
    if (!submission) {
      return fail(res, 404, "SUBMISSION_NOT_FOUND", "That submission no longer exists.");
    }

    const [task, student, files, assignment] = await Promise.all([
      db.collection("tasks").findOne({ _id: toId(submission.task_id) }, { projection: { task_code: 1, title: 1, description: 1, instructions: 1, status: 1, workflow_status: 1, feedback: 1, priority: 1, domain: 1, program: 1, due_date: 1, start_date: 1, created_at: 1, assigned_at: 1 } }),
      db.collection("users").findOne({ _id: toId(submission.student_id) }, { projection: STUDENT_PROFILE_PROJECTION }),
      filesForSubmission(db, submission._id),
      db.collection("task_assignments").findOne(
        { task_id: String(submission.task_id), student_id: String(submission.student_id) },
        { projection: { progress: 1, status: 1, revision_cycle: 1, revision_requested_at: 1, revision_deadline: 1, revision_status: 1, revision_history: 1, assigned_at: 1, created_at: 1 } }
      ),
    ]);

    const taskMissing = !task;
    const studentMissing = !student;

    let batch = null;
    if (student?.batch_id) {
      batch = await db.collection("batches").findOne({ _id: toId(student.batch_id) }, { projection: { name: 1, start_date: 1, end_date: 1 } });
    }

    const taskIdForVersions = task ? String(task._id) : String(submission.task_id || "");
    const versions = taskIdForVersions && submission.student_id
      ? await versionsForStudent(db, taskIdForVersions, submission.student_id)
      : [];
    const reviewerIds = versions.map(v => v.reviewer_id).filter(Boolean);
    const reviewers = reviewerIds.length
      ? await db.collection("users").find({ _id: { $in: reviewerIds.map(toId) } }, { projection: { name: 1, email: 1 } }).toArray()
      : [];
    const reviewerById = new Map(reviewers.map(r => [String(r._id), r]));
    const code = studentCode(student);

    const responseTask = task ? {
      id: String(task._id),
      code: task.task_code || null,
      title: task.title || null,
      description: task.description || null,
      instructions: task.instructions || null,
      domain: task.domain || null,
      program: task.program || null,
      priority: task.priority || null,
      status: task.status || null,
      workflow_status: task.workflow_status || null,
      assigned_at: assignment?.assigned_at || task.assigned_at || task.created_at || null,
      start_date: task.start_date || null,
      due_date: task.due_date || null,
      feedback: task.feedback || null,
      taskMissing: false,
    } : {
      // Task was deleted: use the snapshot stored during submission
      id: submission.task_id ? String(submission.task_id) : null,
      code: submission.task_code || null,
      title: submission.task_title || "Deleted task",
      description: submission.task_description || null,
      instructions: submission.task_how_to_do || submission.task_instructions || null,
      domain: submission.task_domain || null,
      program: submission.task_program || null,
      priority: submission.task_priority || null,
      status: null,
      workflow_status: null,
      assigned_at: null,
      start_date: submission.task_start_date || null,
      due_date: submission.task_due_date || null,
      feedback: null,
      taskMissing: true,
    };

    const responseStudent = student ? {
      id: submission.student_id ? String(submission.student_id) : null,
      code,
      name: student?.name || null,
      email: student?.email || null,
      phone: student?.phone || null,
      department: student?.department || null,
      program: student?.program || null,
      batch: batch?.name || null,
      joined_at: student?.created_at || null,
      studentMissing: false,
    } : {
      id: submission.student_id ? String(submission.student_id) : null,
      code: null,
      name: "Deleted student",
      email: null,
      phone: null,
      department: null,
      program: null,
      batch: null,
      joined_at: null,
      studentMissing: true,
    };

    ok(res, {
      submission: {
        id: String(submission._id),
        submission_code: submission.submission_code || null,
        version: submission.version || 1,
        comment: submission.comment || null,
        status: submission.status || null,
        review_status: normalizeSubmissionStatus(submission.status),
        review_status_label: STATUS_LABELS[normalizeSubmissionStatus(submission.status)],
        submitted_at: submission.submitted_at || null,
        task_started_at: submission.task_started_at || null,
        task_submitted_at: submission.task_submitted_at || submission.submitted_at || null,
        duration_seconds: submission.duration_seconds ?? null,
        reviewer_id: submission.reviewer_id || null,
        reviewer_name: submission.reviewer_id ? (reviewerById.get(String(submission.reviewer_id))?.name || null) : null,
        reviewed_at: submission.reviewed_at || null,
        review_comments: submission.review_comments || null,
        review_comment_edited_at: submission.review_comment_edited_at || null,
        review_comment_edited_by: submission.review_comment_edited_by || null,
        revision_cycle: submission.revision_cycle ?? assignment?.revision_cycle ?? null,
        score: submission.score ?? null,
        max_marks: submission.max_marks ?? null,
      },
      student: responseStudent,
      task: responseTask,
      assignment: assignment ? {
        progress: assignment.progress ?? null,
        status: assignment.status ?? null,
        revision_cycle: assignment.revision_cycle ?? null,
        revision_requested_at: assignment.revision_requested_at ?? null,
        revision_deadline: assignment.revision_deadline ?? null,
        revision_status: assignment.revision_status ?? null,
      } : null,
      files,
      versions: versions.map(v => ({
        ...v,
        reviewer_name: v.reviewer_id ? (reviewerById.get(String(v.reviewer_id))?.name || null) : null,
        is_current: String(v.id) === String(submission._id),
      })),
      can_approve: ["submitted", "revision_required"].includes(normalizeSubmissionStatus(submission.status)),
      can_request_revision: ["submitted", "revision_required", "approved"].includes(normalizeSubmissionStatus(submission.status)),
      taskMissing,
      studentMissing,
      message: taskMissing || studentMissing ? "Submission loaded with missing related records." : "Submission loaded",
    });
  } catch (e) {
    console.error("GET SUBMISSION DETAIL:", e);
    fail(res, 500, "SUBMISSION_DETAIL_FAILED", "Unable to load this submission. Please retry.");
  }
});

/* ─── EDIT REVIEW COMMENT ────────────────────────────────────────────────
 * PATCH /api/tasks/submissions/:submissionId/review-comment
 *
 * Allows a reviewer to edit their own review comment on a submission.
 * Authorization: Only the original reviewer (matched by reviewer_id) can edit.
 * The comment is stored as review_comments field on the submission document.
 */
router.patch("/submissions/:submissionId/review-comment", authenticateToken, authorizeRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const submissionId = req.params.submissionId;
    
    // Validate submission ID
    let sid;
    try {
      sid = toId(submissionId);
    } catch {
      return fail(res, 400, "INVALID_ID", "Invalid submission ID");
    }

    // Get the submission
    const submission = await db.collection("submissions").findOne({ _id: sid });
    if (!submission) {
      return fail(res, 404, "SUBMISSION_NOT_FOUND", "Submission not found");
    }

    // Authorization: Only the reviewer who wrote the comment can edit it
    const reviewerId = String(submission.reviewer_id || "");
    const currentUserId = String(req.user.id);
    if (reviewerId !== currentUserId) {
      return fail(res, 403, "FORBIDDEN", "You can only edit your own review comments");
    }

    // Validate the new comment text
    const newComment = String(req.body.review_comment || "").trim();
    
    if (!newComment) {
      return fail(res, 400, "COMMENT_REQUIRED", "Review comment cannot be empty");
    }

    // Normalize line endings
    const normalized = newComment.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    if (normalized.length > 500) {
      return fail(res, 400, "COMMENT_TOO_LONG", "Review comment must be 500 characters or less");
    }

    // Check if comment actually changed
    if (normalized === submission.review_comments) {
      return ok(res, {
        message: "No changes to save",
        submission_id: submissionId,
        review_comment: normalized,
      });
    }

    const now = new Date().toISOString();

    // Update the submission
    await db.collection("submissions").updateOne(
      { _id: sid },
      { 
        $set: { 
          review_comments: normalized,
          review_comment_edited_at: now,
          review_comment_edited_by: currentUserId,
          updated_at: now
        } 
      }
    );

    // Audit log
    await writeAudit(db, {
      actorId: currentUserId,
      action: "review_comment_edited",
      entityType: "submission",
      entityId: submissionId,
      previousValue: { review_comments: submission.review_comments },
      newValue: { review_comments: normalized },
      metadata: { 
        task_id: String(submission.task_id),
        student_id: String(submission.student_id),
        edited_at: now
      },
    });

    ok(res, {
      message: "Review comment updated successfully",
      submission_id: submissionId,
      review_comment: normalized,
      edited_at: now,
    });
  } catch (e) {
    console.error("EDIT REVIEW COMMENT:", e);
    fail(res, 500, "EDIT_FAILED", "Unable to update review comment. Please retry.");
  }
});

/* ─── DOWNLOAD / PREVIEW SUBMISSION FILE ─────────────────────────────────
 * Streams file from Google Drive, MongoDB GridFS or the legacy filesystem.
 *
 * One authenticated route serves both needs; nothing is exposed publicly:
 *   .../download                 → Content-Disposition: attachment
 *   .../download?disposition=inline
 *   .../download?disposition=inline&download=0
 *                                  → Content-Disposition: inline (preview)
 * The client fetches the bytes with the Authorization header and renders them
 * from a blob URL, so no raw storage path is ever exposed.
 *
 * Authorization: reviewers (admin/manager/ceo) may read any submission file; a
 * student may read files belonging ONLY to their OWN submissions. Ownership is
 * matched from the stored submission row — never from a client-supplied field
 * — so student A can never reach student B's file even by guessing a fileId
 * (IDOR). Pending/rejected students are already blocked by
 * requireApprovedStudent on this router.
 */
router.get("/files/:fileId/download", authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    const file = await db.collection("submission_files").findOne({ _id: toId(req.params.fileId) });
    if (!file) return res.status(404).json({ success: false, message: "File not found" });
    
    const sub = await db.collection("submissions").findOne({ _id: toId(file.submission_id) });
    if (!sub) return res.status(404).json({ success: false, message: "Submission not found" });

    const isReviewer = isReviewerRole(req.user.role);
    const isOwner = String(sub.student_id) === String(req.user.id);
    if (!isReviewer && !isOwner) {
      return res.status(403).json({ success: false, message: "You do not have permission to access this file" });
    }

    // `inline` only whitelists types a browser can safely render. Everything
    // else stays an attachment, so an uploaded .docx/.zip is never rendered
    // in the app's origin (defence in depth against stored XSS via SVG/HTML).
    const wantsInline = String(req.query.disposition || "") === "inline";
    const mime = file.mime_type || "application/octet-stream";
    const INLINE_SAFE = /^image\/(png|jpeg|gif|webp)$/.test(mime)
      || mime === "application/pdf"
      || /^text\/plain$/.test(mime);
    const disposition = (wantsInline && INLINE_SAFE) ? "inline" : "attachment";
    const filename = (file.original_name || "submission-file").replace(/[\r\n"\\]/g, "_");
    const safeHeaders = (contentType) => {
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `${disposition}; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("Cache-Control", "private, no-store");
      if (file.size) res.setHeader("Content-Length", file.size);
    };
    
    // Google Drive storage (preferred when available)
    if (file.drive_file_id) {
      try {
        const { downloadFromDrive } = require("../utils/driveStorage");
        const { stream, meta } = await downloadFromDrive(file.drive_file_id);
        safeHeaders(file.mime_type || meta.mimeType || "application/octet-stream");
        stream.pipe(res);
        await writeAudit(db, { actorId: req.user.id, action: "submission_file_downloaded", entityType: "submission_file", entityId: String(file._id), newValue: { submission_id: String(sub._id), storage_type: "drive", disposition } });
        return;
      } catch (driveError) {
        console.error("[Download] Drive error:", driveError.message);
        return res.status(502).json({ success: false, message: "Unable to fetch file from Drive" });
      }
    }

    // Try GridFS first (old storage)
    if (file.gridfs_id) {
      try {
        const { stream, file: gridfsFile } = await downloadFile(db, file.gridfs_id);
        safeHeaders(file.mime_type || "application/octet-stream");
        stream.pipe(res);
        
        await writeAudit(db, { 
          actorId: req.user.id, 
          action: "submission_file_downloaded", 
          entityType: "submission_file", 
          entityId: String(file._id), 
          newValue: { submission_id: String(sub._id), storage_type: "gridfs", disposition } 
        });
        
        return;
      } catch (gridfsError) {
        console.error("[Download] GridFS error:", gridfsError.message);
        return res.status(404).json({ success: false, message: "File is no longer available" });
      }
    }
    
    // Fallback to filesystem (old storage) and attempt migration
    if (file.storage_path) {
      // Try to read from filesystem
      if (fs.existsSync(file.storage_path)) {
        // Migrate to GridFS in background (don't block download)
        migrateFileToGridFS(db, file.storage_path, file.original_name, {
          submission_id: file.submission_id,
          mime_type: file.mime_type,
          size: file.size
        }).then(gridfsId => {
          if (gridfsId) {
            // Update file record with GridFS ID
            db.collection("submission_files").updateOne(
              { _id: file._id },
              { $set: { gridfs_id: gridfsId, storage_type: "gridfs", migrated_at: new Date().toISOString() } }
            ).catch(err => console.error("[Download] Migration update error:", err.message));
          }
        }).catch(err => console.error("[Download] Migration error:", err.message));
        
        // Serve from filesystem
        await writeAudit(db, { 
          actorId: req.user.id, 
          action: "submission_file_downloaded", 
          entityType: "submission_file", 
          entityId: String(file._id), 
          newValue: { submission_id: String(sub._id), storage_type: "filesystem", disposition } 
        });
        
        safeHeaders(file.mime_type || "application/octet-stream");
        return fs.createReadStream(file.storage_path).pipe(res);
      }
    }
    
    // File not found in either storage
    return res.status(404).json({ 
      success: false, 
      message: "File is no longer available. It may have been uploaded before the system migration." 
    });
    
  } catch (e) { 
    console.error("DOWNLOAD FILE:", e); 
    res.status(500).json({ success: false, message: "Unable to download file" }); 
  }
});

/* ─── GET ALL TASKS ─────────────────────────────────────────────────────── */
router.get("/", authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    // Close any revision window that has passed before the counts are built,
    // so the Live Tasks table never shows a stale "Revision Required".
    if (isReviewerRole(req.user.role)) await runExpirySweep(db);
    let tasks;
    if (["student", "member"].includes(req.user.role)) {
      // Students must have approved registration
      if (req.user.role === "student") {
        const user = await db.collection("users").findOne({ _id: toId(req.user.id) }, { projection: { registration_status: 1 } });
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        const status = normalizeRegistrationStatus(user.registration_status);
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
    const dayNumber = b.day_number !== undefined && b.day_number !== null && b.day_number !== "" ? Number(b.day_number) : null;
    if (dayNumber !== null && (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 60)) {
      return res.status(400).json({ success: false, message: "Day must be an integer between 1 and 60" });
    }

    // Validate 500-character limits for text fields
    const description = String(b.description || "").trim();
    const howToDo = String(b.how_to_do || "").trim();
    const expectedOutput = String(b.expected_output || "").trim();
    const submissionRequirements = String(b.submission_requirements || "").trim();
    
    if (description.length > 500) {
      return res.status(400).json({ success: false, message: "Description must be 500 characters or less" });
    }
    if (howToDo.length > 500) {
      return res.status(400).json({ success: false, message: "How to Do must be 500 characters or less" });
    }
    if (expectedOutput.length > 500) {
      return res.status(400).json({ success: false, message: "Expected Output must be 500 characters or less" });
    }
    if (submissionRequirements.length > 500) {
      return res.status(400).json({ success: false, message: "Submission Requirements must be 500 characters or less" });
    }

    const workflow = String(b.workflow_status || "Assigned");
    if (!STATUS.includes(workflow)) return res.status(400).json({ success: false, message: "Invalid task workflow status" });

    const startTime = b.start_time ? String(b.start_time).trim() : null;
    const endTime = (b.due_time || b.end_time) ? String(b.due_time || b.end_time).trim() : null;
    if (b.start_date && b.due_date) {
      if (b.start_date > b.due_date) {
        return res.status(400).json({ success: false, message: "Starting Date cannot be after Ending Date" });
      }
      if (b.start_date === b.due_date && startTime && endTime && startTime > endTime) {
        return res.status(400).json({ success: false, message: "Starting time cannot be after ending time" });
      }
    }

    const taskCode = await nextTaskCode(db);
    const now = new Date().toISOString();

    // Validate that start datetime is before due datetime
    const startAt = combineTaskDateTime(b.start_date, startTime, "00:00");
    const dueAt = combineTaskDateTime(b.due_date, endTime, "23:59");
    if (startAt && dueAt && new Date(startAt) >= new Date(dueAt)) {
      return res.status(400).json({ success: false, message: "Task start time must be before the deadline" });
    }

    // Program is stored on the task so the Program column shows a real value
    // instead of "—". An explicit program wins; otherwise it is derived from
    // the students this task is being assigned to.
    const derivedProgram = await resolveProgram(db, { program }, targetStudents);
    const storedProgram = program || derivedProgram || null;

    // One shared Task document. Per-student state lives in task_assignments.
    const result = await db.collection("tasks").insertOne({
      task_code: taskCode,
      title,
      category: String(b.category || "").trim() || null,
      program: storedProgram,
      group: group || null,
      department: null,
      domain,
      team: String(b.team || "").trim() || null,
      task_type: String(b.task_type || "General"),
      description: description,
      what: String(b.what || "").trim(),
      why: String(b.why || "").trim(),
      how: String(b.how || "").trim(),
      how_to_do: howToDo,
      expected_output: expectedOutput,
      submission_requirements: submissionRequirements,
      resources: String(b.resources || "").trim(),
      notes: String(b.notes || "").trim(),
      target_type: taskTargetType,
      batch_id: taskBatchId,
      assigned_to: targetStudents[0] ? String(targetStudents[0]._id) : null,
      assigned_by: req.user.id,
      status: legacyStatus(workflow),
      workflow_status: workflow,
      priority,
      day_number: dayNumber,
      start_date: b.start_date || null,
      start_time: startTime,
      start_at: startAt,
      due_date: b.due_date || null,
      due_time: endTime,
      due_at: dueAt,
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

/* ─── EDIT TASK ──────────────────────────────────────────────────────────────
 * Updates the content of ONE existing task in place (used by the Edit button
 * on the Tasks page). It is a partial update: only the keys present in the
 * body are written, so a form that always submits every field behaves like a
 * full save while a partial API caller cannot wipe a field by omitting it.
 *
 * Only the fields the task form owns are writable:
 *   title, description, how_to_do, expected_output, submission_requirements,
 *   priority, domain, day_number, start_date, start_time, due_date, due_time
 * Assignment (target_type / batch_id / assigned_to / student_ids), task_code,
 * workflow status, submissions, files and history are deliberately NOT
 * editable here: reassigning students is a separate operation and every other
 * record that points at this task must keep working after an edit.
 *
 * start_at / due_at are recomputed from the merged values so the server-side
 * submission window always follows the dates shown in the UI, and the
 * deadline can be extended but never moved before the start date.
 *
 * Authorized exactly like task creation and deletion (admin / ceo / manager).
 */
router.put("/:id", authenticateToken, authorizeRoles("admin", "ceo", "manager"), async (req, res) => {
  try {
    const db = req.db;
    let taskId;
    try {
      taskId = new ObjectId(String(req.params.id || "").trim());
    } catch {
      return res.status(400).json({ success: false, message: "Invalid task id" });
    }

    const task = await db.collection("tasks").findOne({ _id: taskId });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });

    const taskKey = String(task._id);
    const b = req.body || {};
    const update = {};

    if ("title" in b) {
      const title = String(b.title || "").trim();
      if (!title) return res.status(400).json({ success: false, message: "Task title is required" });
      update.title = title;
    }
    
    // Validate 500-character limits for text fields
    for (const field of ["description", "expected_output", "submission_requirements"]) {
      if (field in b) {
        const value = String(b[field] || "").trim();
        if (value.length > 500) {
          const fieldLabel = field.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
          return res.status(400).json({ success: false, message: `${fieldLabel} must be 500 characters or less` });
        }
        update[field] = value;
      }
    }
    
    if ("how_to_do" in b) {
      const value = b.how_to_do ? String(b.how_to_do).trim() : null;
      if (value && value.length > 500) {
        return res.status(400).json({ success: false, message: "How To Do must be 500 characters or less" });
      }
      update.how_to_do = value;
    }
    if ("priority" in b) {
      const priority = String(b.priority || "").trim().toLowerCase();
      if (!priorityValues.has(priority)) return res.status(400).json({ success: false, message: "Invalid priority" });
      update.priority = priority;
    }
    if ("domain" in b) {
      const domain = String(b.domain || "").trim().toLowerCase();
      if (!ALLOWED_DOMAINS.includes(domain)) {
        return res.status(400).json({ success: false, message: "Invalid domain. Choose from: " + ALLOWED_DOMAINS.join(", ") });
      }
      update.domain = domain;
    }
    if ("program" in b) {
      const value = String(b.program || "").trim();
      if (value && !ALLOWED_PROGRAMS.includes(value.toLowerCase())) {
        return res.status(400).json({ success: false, message: "Invalid program. Choose from: " + ALLOWED_PROGRAMS.join(", ") });
      }
      update.program = value || null;
    }
    if ("day_number" in b) {
      const raw = b.day_number;
      if (raw === undefined || raw === null || raw === "") {
        update.day_number = null;
      } else {
        const dayNumber = Number(raw);
        if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 60) {
          return res.status(400).json({ success: false, message: "Day must be an integer between 1 and 60" });
        }
        update.day_number = dayNumber;
      }
    }

    // Dates: merge with the stored values first so a partial body still keeps
    // the task's real window, then validate the window the task will have.
    const hasDateKey = ["start_date", "start_time", "due_date", "due_time"].some(k => k in b);
    let startDate = task.start_date || null;
    let startTime = task.start_time || null;
    let dueDate = task.due_date || null;
    let dueTime = task.due_time || null;
    if (hasDateKey) {
      if ("start_date" in b) { startDate = b.start_date ? String(b.start_date).trim() : null; update.start_date = startDate; }
      if ("start_time" in b) { startTime = b.start_time ? String(b.start_time).trim() : null; update.start_time = startTime; }
      if ("due_date" in b) { dueDate = b.due_date ? String(b.due_date).trim() : null; update.due_date = dueDate; }
      if ("due_time" in b) { dueTime = b.due_time ? String(b.due_time).trim() : null; update.due_time = dueTime; }

      if (startDate && dueDate) {
        if (startDate > dueDate) {
          return res.status(400).json({ success: false, message: "Starting Date cannot be after Ending Date" });
        }
        if (startDate === dueDate && startTime && dueTime && startTime > dueTime) {
          return res.status(400).json({ success: false, message: "Starting time cannot be after ending time" });
        }
      }
      const startAt = combineTaskDateTime(startDate, startTime, "00:00");
      const dueAt = combineTaskDateTime(dueDate, dueTime, "23:59");
      // Validate that start datetime is before due datetime
      if (startAt && dueAt && new Date(startAt) >= new Date(dueAt)) {
        return res.status(400).json({ success: false, message: "Task start time must be before the deadline" });
      }
      update.start_at = startAt;
      update.due_at = dueAt;
    }

    const editableKeys = Object.keys(update);
    if (editableKeys.length === 0) {
      return res.status(400).json({ success: false, message: "No editable fields supplied" });
    }

    // Only fields whose value actually changed count as a real edit. Re-saving a
    // form without touching anything must NOT send a notification, must NOT bump
    // updated_at and must not touch a single student record.
    const changedKeys = editableKeys.filter(k => String(task[k] ?? "") !== String(update[k] ?? ""));
    if (changedKeys.length === 0) {
      return res.json({
        success: true,
        message: "No changes to save",
        taskId: taskKey,
        taskCode: task.task_code || null,
        updated: [],
        changed: false,
      });
    }

    // Capture the real "before" values BEFORE anything is mutated, so the audit
    // log and the notification diff always describe the true old -> new change.
    const previousValue = {};
    for (const key of changedKeys) previousValue[key] = task[key] ?? null;

    const nowIso = new Date().toISOString();
    await db.collection("tasks").updateOne({ _id: taskId }, { $set: { ...update, updated_at: nowIso } });

    const newValue = {};
    for (const key of changedKeys) newValue[key] = update[key] ?? null;

    // Keep the in-memory task fresh for anything below that reads it.
    for (const key of changedKeys) task[key] = update[key];

    await writeAudit(db, {
      actorId: req.user.id,
      action: "task_updated",
      entityType: "task",
      entityId: taskKey,
      previousValue,
      newValue,
      metadata: { changed: changedKeys },
    });

    // Notify ONLY the students assigned to THIS task — the batch/individual
    // assignment snapshot plus any legacy direct assignment. The message is a
    // real field-by-field diff; an identical repeat save is de-duplicated by the
    // change hash. Notification failures never fail the edit itself.
    try {
      const { notifyOnce } = require("../utils/notifications");
      const assignments = await db.collection("task_assignments")
        .find({ task_id: taskKey }, { projection: { student_id: 1 } })
        .toArray();
      const recipients = new Set(assignments.map(a => String(a.student_id)).filter(Boolean));
      if (task.assigned_to) recipients.add(String(task.assigned_to));

      const before = {};
      const after = {};
      for (const key of changedKeys) {
        before[key] = previousValue[key];
        after[key] = newValue[key];
      }

      const parts = describeTaskChanges(changedKeys, before, after);
      const title = String(update.title || task.title || "Task");
      const actor = req.user.role === "ceo" ? "the CEO" : req.user.role === "manager" ? "a manager" : "an administrator";
      const message = `"${title}" was updated by ${actor}. ${parts.join("; ")}`.slice(0, 400);
      const changeHash = taskChangeHash(changedKeys, before, after);

      for (const studentId of recipients) {
        await notifyOnce(db, {
          userId: studentId,
          type: "task_updated",
          title: "Task Updated",
          message,
          taskId: taskKey,
          recipientRole: "student",
          changeHash,
          actionUrl: `/student/tasks/${taskKey}`,
          meta: { changed: changedKeys, updated_at: nowIso },
        });
      }
    } catch (e) {
      console.error("Task update notification failed:", e.message);
    }

    res.json({
      success: true,
      message: "Task updated successfully",
      taskId: taskKey,
      taskCode: task.task_code || null,
      updated: changedKeys,
      changed: true,
      updated_at: nowIso,
    });
  } catch (e) {
    console.error("UPDATE TASK:", e);
    res.status(500).json({ success: false, message: "Unable to update task" });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   TASK MANAGER — review interface backend
   ═══════════════════════════════════════════════════════════════════════════
   One aggregation (utils/submissionStatus.buildTaskStudentState) feeds the
   header, the four tabs and every count, so the numbers can never disagree
   between the tab badges, the tables and the Live Tasks table.

   All routes here are reviewer-only (admin / ceo / manager) and additionally
   scoped: a manager may only work on tasks they created, exactly like the
   legacy POST /review route already did.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Cooldown between two reminders for the same student + task. */
function reminderCooldownMs() {
  const raw = Number(process.env.REMINDER_COOLDOWN_HOURS);
  const hours = Number.isFinite(raw) && raw > 0 ? raw : 12;
  return hours * 3600 * 1000;
}

/**
 * Load the task for a reviewer request, enforcing:
 *  - a valid ObjectId (400, not a confusing 404)
 *  - existence (404)
 *  - manager ownership (403)
 * Returns { task } or null after having already written the response.
 */
async function loadReviewTask(req, res) {
  let taskId;
  try {
    taskId = new ObjectId(String(req.params.id || "").trim());
  } catch {
    fail(res, 400, "INVALID_TASK_ID", "This review link is not valid. Open the task from the task list and try again.");
    return null;
  }
  const task = await req.db.collection("tasks").findOne({ _id: taskId });
  if (!task) {
    fail(res, 404, "TASK_NOT_FOUND", "This task no longer exists. It may have been removed.");
    return null;
  }
  if (req.user.role === "manager" && String(task.assigned_by) !== String(req.user.id)) {
    fail(res, 403, "FORBIDDEN", "You can only review tasks that were assigned by you.");
    return null;
  }
  return task;
}

/** Submission files with an authenticated preview/download path. */
async function filesForSubmission(db, submissionId) {
  const files = await db.collection("submission_files")
    .find({ submission_id: String(submissionId) })
    .sort({ created_at: 1 })
    .toArray();
  return files.map(f => ({
    id: String(f._id),
    name: f.original_name,
    size: f.size ?? null,
    mime: f.mime_type || "application/octet-stream",
    created_at: f.created_at || null,
    // Never a raw Drive/GridFS path: always an authenticated endpoint.
    download_url: `/api/tasks/files/${String(f._id)}/download`,
    preview_url: `/api/tasks/files/${String(f._id)}/download?disposition=inline`,
  }));
}

/** Every version a student has submitted for a task, newest first. */
async function versionsForStudent(db, taskId, studentId) {
  const rows = await db.collection("submissions")
    .find({ task_id: String(taskId), student_id: String(studentId) })
    .sort({ version: -1 })
    .toArray();
  const reviewerIds = rows.map(r => r.reviewer_id).filter(Boolean);
  const reviewers = reviewerIds.length
    ? await db.collection("users").find({ _id: { $in: reviewerIds.map(toId) } }, { projection: { name: 1 } }).toArray()
    : [];
  const nameById = new Map(reviewers.map(r => [String(r._id), r.name]));
  return Promise.all(rows.map(async (s) => ({
    id: String(s._id),
    submission_id: String(s._id),
    submission_code: s.submission_code || null,
    version: s.version || 1,
    status: normalizeSubmissionStatus(s.status),
    status_label: s.status || STATUS_LABELS[normalizeSubmissionStatus(s.status)],
    submitted_at: s.submitted_at || null,
    comment: s.comment || null,
    // Per-version timing snapshot (null on older records).
    task_started_at: s.task_started_at || null,
    duration_seconds: s.duration_seconds ?? null,
    reviewed_at: s.reviewed_at || null,
    review_comments: s.review_comments || null,
    reviewer_id: s.reviewer_id || null,
    reviewer_name: s.reviewer_id ? (nameById.get(String(s.reviewer_id)) || null) : null,
    score: s.score ?? null,
    max_marks: s.max_marks ?? null,
    window_expired_at: s.window_expired_at || null,
    files: await filesForSubmission(db, s._id),
  })));
}

/** Normalize ?page / ?limit / ?search for the tabbed lists. */
function readListQuery(req) {
  const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
  const limitRaw = Number.parseInt(req.query.limit, 10) || 25;
  const limit = Math.min(Math.max(limitRaw, 1), 200);
  const search = String(req.query.search || "").trim().toLowerCase();
  return { page, limit, search };
}

function filterAndPage(rows, { search, page, limit }) {
  let filtered = rows;
  if (search) {
    filtered = rows.filter(r => [r.student_name, r.student_email, r.student_code, r.batch_name]
      .filter(Boolean)
      .some(v => String(v).toLowerCase().includes(search)));
  }
  const total = filtered.length;
  const start = (page - 1) * limit;
  return {
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    rows: filtered.slice(start, start + limit),
  };
}

/**
 * GET /api/tasks/:id/review
 * The single aggregation endpoint: header, Task Details payload and every
 * status count the four tab badges need. One request, no client-side maths,
 * so the tabs and the Live Tasks table always agree.
 */
router.get("/:id/review", authenticateToken, authorizeRoles("admin", "ceo", "manager"), async (req, res) => {
  try {
    const db = req.db;
    const task = await loadReviewTask(req, res);
    if (!task) return;

    // Lazy expiry first, so a window that closed while nobody was looking is
    // already reflected in the numbers this request returns.
    await runExpirySweep(db);

    const { counts, rows, assigneeCount } = await buildTaskStudentState(db, task);
    const assignees = await loadTaskAssignees(db, task);
    const { domain, legacy_domain, effective_domain } = resolveDomain(task);
    const program = await resolveProgram(db, task, assignees.map(a => a.student).filter(Boolean));

    const creator = task.assigned_by
      ? await db.collection("users").findOne({ _id: toId(task.assigned_by) }, { projection: { name: 1, email: 1 } })
      : null;

    const details = {
      id: String(task._id),
      task_code: task.task_code || null,
      title: task.title || "",
      description: task.description || "",
      domain: effective_domain,
      stored_domain: domain,
      legacy_domain,
      program,
      target_type: task.target_type || "student",
      batch_id: task.batch_id || null,
      batch_name: task.target_type === "batch"
        ? ((await db.collection("batches").findOne({ _id: toId(task.batch_id) }, { projection: { name: 1 } }))?.name || null)
        : (rows[0]?.batch_name || null),
      assigned_students: task.target_type === "batch"
        ? assignees.map(a => ({ id: a.student_id, name: a.student_name, code: a.student_code }))
        : rows.map(r => ({ id: r.student_id, name: r.student_name, code: r.student_code })),
      total_assignees: assigneeCount,
      priority: task.priority || "medium",
      task_type: task.task_type || null,
      start_date: task.start_date || null,
      start_time: task.start_time || null,
      start_at: task.start_at || null,
      due_date: task.due_date || null,
      due_time: task.due_time || null,
      due_at: task.due_at || null,
      how_to_do: task.how_to_do || null,
      expected_output: task.expected_output || "",
      submission_requirements: task.submission_requirements || "",
      day_number: task.day_number ?? null,
      workflow_status: task.workflow_status || null,
      assigned_by_name: creator?.name || null,
      assigned_by_email: creator?.email || null,
      created_at: task.created_at || null,
      updated_at: task.updated_at || null,
    };

    ok(res, {
      task: details,
      counts,
      status_labels: STATUS_LABELS,
      status_enum: TASK_STATUS,
      resubmission_window_hours: resubmissionWindowHours(),
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("GET TASK REVIEW:", e);
    fail(res, 500, "REVIEW_LOAD_FAILED", "Unable to load the review data. Please retry.");
  }
});

/**
 * Shared implementation for the three tabbed lists.
 *
 * `mode`:
 *   "submitted"    every student who handed work in, whatever their review
 *                  status is. A student whose submission is "Revision
 *                  Required" or "Resubmission Expired" is still someone the
 *                  reviewer has to be able to open, so the tab lists every
 *                  submitter and shows their review status as a chip. This is
 *                  also what fixes the old modal, which could only ever show
 *                  the single highest-version row of the whole task.
 *   "pending"      assigned, no submission, work not started.
 *   "in_progress"  explicitly started, nothing submitted yet.
 *
 * `?status=` narrows any of them to one canonical status.
 */
async function reviewListHandler(req, res, mode) {
  const db = req.db;
  const task = await loadReviewTask(req, res);
  if (!task) return;
  await runExpirySweep(db);

  const { rows } = await buildTaskStudentState(db, task);
  const scoped = mode === "submitted"
    ? rows.filter(r => Boolean(r.submission_id))
    : rows.filter(r => r.status === mode);
  const statusFilter = String(req.query.status || "").trim();
  const filtered = statusFilter ? scoped.filter(r => r.status === statusFilter) : scoped;
  const page = filterAndPage(filtered, readListQuery(req));

  const withFiles = await Promise.all(page.rows.map(async r => ({
    ...r,
    status_label: STATUS_LABELS[r.status],
    // The task deadline travels with every row so the Pending / In Progress
    // tables can render a per-student "time remaining" without a second call.
    task_due_at: task.due_at || null,
    task_due_date: task.due_date || null,
    task_title: task.title || "",
    files: r.submission_id ? await filesForSubmission(db, r.submission_id) : [],
  })));

  ok(res, {
    task: { id: String(task._id), task_code: task.task_code || null, title: task.title || "", due_at: task.due_at || null },
    mode,
    status: statusFilter || null,
    total: page.total,
    page: page.page,
    limit: page.limit,
    pages: page.pages,
    students: withFiles,
  });
}

/** GET /api/tasks/:id/review/submitted — every student who handed work in. */
router.get("/:id/review/submitted", authenticateToken, authorizeRoles("admin", "ceo", "manager"), (req, res) =>
  reviewListHandler(req, res, "submitted").catch((e) => {
    console.error("REVIEW SUBMITTED:", e);
    fail(res, 500, "REVIEW_LIST_FAILED", "Unable to load submitted students. Please retry.");
  }));

/** GET /api/tasks/:id/review/pending — assigned, nothing started. */
router.get("/:id/review/pending", authenticateToken, authorizeRoles("admin", "ceo", "manager"), (req, res) =>
  reviewListHandler(req, res, "pending").catch((e) => {
    console.error("REVIEW PENDING:", e);
    fail(res, 500, "REVIEW_LIST_FAILED", "Unable to load pending students. Please retry.");
  }));

/** GET /api/tasks/:id/review/in-progress — explicitly started, not submitted. */
router.get("/:id/review/in-progress", authenticateToken, authorizeRoles("admin", "ceo", "manager"), (req, res) =>
  reviewListHandler(req, res, "in_progress").catch((e) => {
    console.error("REVIEW IN PROGRESS:", e);
    fail(res, 500, "REVIEW_LIST_FAILED", "Unable to load in-progress students. Please retry.");
  }));

/**
 * GET /api/tasks/:id/review/assignments/:studentId
 * Everything about ONE student's work on this task: profile, every version
 * with its files and timestamps, the open revision cycle and all past review
 * feedback. Scoped by taskId AND studentId so the View Submission button can
 * never open a different student's record.
 */
router.get("/:id/review/assignments/:studentId", authenticateToken, authorizeRoles("admin", "ceo", "manager"), async (req, res) => {
  try {
    const db = req.db;
    const task = await loadReviewTask(req, res);
    if (!task) return;
    await runExpirySweep(db);

    const studentId = String(req.params.studentId || "").trim();
    if (!studentId || studentId === "null" || studentId === "undefined") {
      return fail(res, 400, "INVALID_STUDENT_ID", "No student was specified for this submission.");
    }

    const { rows } = await buildTaskStudentState(db, task);
    const row = rows.find(r => String(r.student_id) === studentId);
    if (!row) {
      return fail(res, 404, "ASSIGNMENT_NOT_FOUND", "This student is not assigned to this task.");
    }

    const assignment = await db.collection("task_assignments")
      .findOne({ task_id: String(task._id), student_id: studentId });
    const versions = await versionsForStudent(db, task._id, studentId);
    const { effective_domain, legacy_domain } = resolveDomain(task);

    // Get the student's session for timing information
    const { currentSession, sessionView } = require("../utils/taskSession");
    const session = await currentSession(db, studentId, String(task._id));
    const timing = sessionView(session, new Date());

    ok(res, {
      task: {
        id: String(task._id),
        task_code: task.task_code || null,
        title: task.title || "",
        description: task.description || "",
        domain: effective_domain,
        legacy_domain,
        due_at: task.due_at || null,
        due_date: task.due_date || null,
      },
      student: {
        student_id: studentId,
        student_db_id: studentId,
        student_name: row.student_name,
        student_email: row.student_email,
        student_code: row.student_code,
        student_department: row.student_department,
        student_program: row.student_program,
        batch_name: row.batch_name,
      },
      assignment: {
        id: assignment ? String(assignment._id) : null,
        status: row.status,
        status_label: STATUS_LABELS[row.status],
        overdue: row.overdue,
        assigned_at: row.assigned_at,
        submission_version: row.submission_version,
        submission_comment: row.submission_comment,
        submitted_at: row.submitted_at,
        revision_cycle: row.revision_cycle,
        revision_requested_at: row.revision_requested_at,
        revision_deadline: row.revision_deadline,
        revision_status: assignment?.revision_status || null,
        revision_history: Array.isArray(assignment?.revision_history) ? assignment.revision_history : [],
        resubmission_available: row.resubmission_available,
        resubmission_expires_in_ms: row.resubmission_expires_in_ms,
        started_at: timing.started_at || null,
        elapsed_seconds: timing.elapsed_seconds || null,
      },
      versions,
      latest: versions[0] || null,
    });
  } catch (e) {
    console.error("GET REVIEW ASSIGNMENT:", e);
    fail(res, 500, "REVIEW_DETAIL_FAILED", "Unable to load this submission. Please retry.");
  }
});

/**
 * POST /api/tasks/:id/review/approve
 * Body: { studentId } or { submissionId }, optional { feedback, score, max_marks }
 *
 * Affects ONLY that student's submission — never the whole task — and rejects
 * a duplicate approval with 409 instead of silently re-notifying.
 *
 * Shared implementation: `POST /api/tasks/review` (submission-id addressed,
 * used by the CEO Submissions page and the Manager dashboard) delegates here,
 * so there is exactly one approval rule in the codebase.
 */
async function handleApprove(req, res) {
  try {
    const db = req.db;
    const task = await loadReviewTask(req, res);
    if (!task) return;
    await runExpirySweep(db);

    const { studentId, submissionId } = await resolveReviewTarget(db, task, req.body || {}, res);
    if (!studentId) return;

    // Optional scoring. Both halves must be present and the score may not
    // exceed the maximum; when omitted the task is simply left un-scored —
    // nothing is invented.
    const scoreUpdate = parseScorePair(req.body, res);
    if (scoreUpdate === undefined) return;

    const latest = submissionId
      // A specific version was named (the Submissions page addresses one
      // submission by id). Fetch exactly that row: taking only the newest
      // version first made approving an EARLIER version return 404 whenever the
      // two existed side by side.
      ? await db.collection("submissions")
        .find({ _id: toId(submissionId), task_id: String(task._id), student_id: studentId })
        .toArray()
      : await db.collection("submissions")
        .find({ task_id: String(task._id), student_id: studentId })
        .sort({ version: -1 })
        .limit(1)
        .toArray();
    const submission = latest[0];
    if (!submission) {
      return fail(res, 404, "SUBMISSION_NOT_FOUND", "This student has not submitted anything to review.");
    }

    const current = normalizeSubmissionStatus(submission.status);
    if (current === "approved") {
      return fail(res, 409, "ALREADY_APPROVED", "This submission has already been approved.");
    }
    // A submitted version may be approved, and so may one that is currently
    // "Revision Required": an admin who decides the work is good enough after
    // all must be able to close the loop instead of hitting a dead end. A
    // student with nothing submitted has nothing to approve at all.
    if (current !== "submitted" && current !== "revision_required") {
      return fail(res, 409, "ILLEGAL_TRANSITION",
        `This submission is "${submission.status}" and cannot be approved. Only a submitted version can be approved.`);
    }

    const now = new Date().toISOString();
    const feedback = String((req.body && req.body.feedback) || "").trim() || "Approved";
    
    // Validate 500-character limit for approval feedback
    if (feedback.length > 500) {
      return fail(res, 400, "FEEDBACK_TOO_LONG", "Approval feedback must be 500 characters or less.");
    }

    const approvalFields = {
      status: "Approved",
      reviewer_id: req.user.id,
      reviewed_at: now,
      review_comments: feedback,
      approved_at: now,
      approved_by: req.user.id,
    };
    if (scoreUpdate) Object.assign(approvalFields, scoreUpdate, { scored_at: now, scored_by: req.user.id });
    await db.collection("submissions").updateOne({ _id: submission._id }, { $set: approvalFields });

    const { updateAssignment, ensureAssignment, getAssignment } = require("../models/TaskAssignment");
    await ensureAssignment(db, String(task._id), studentId);
    // Approving supersedes an open revision cycle: the student no longer has
    // anything to resubmit. The cycle itself stays in revisionHistory, marked
    // "closed" so the timeline never shows a window that is still open.
    const currentAssignment = await getAssignment(db, String(task._id), studentId);
    let revisionHistory = Array.isArray(currentAssignment?.revision_history) ? currentAssignment.revision_history : null;
    if (revisionHistory) {
      const idx = revisionHistory.findIndex((h) => h && h.status === "open");
      if (idx >= 0) {
        revisionHistory = revisionHistory.slice();
        revisionHistory[idx] = { ...revisionHistory[idx], status: "closed", closed_at: now, closed_by: String(req.user.id) };
      }
    }
    await updateAssignment(db, String(task._id), studentId, {
      status: "approved",
      progress: 100,
      revision_status: "closed",
      ...(revisionHistory ? { revision_history: revisionHistory } : {}),
    });

    await syncTaskWorkflowFromStudents(db, task);
    await writeAudit(db, {
      actorId: req.user.id,
      action: "submission_approved",
      entityType: "submission",
      entityId: String(submission._id),
      previousValue: { status: submission.status },
      newValue: { status: "Approved", review_comments: feedback },
      metadata: { task_id: String(task._id), student_id: studentId },
    });

    await notifyOnce(db, {
      userId: studentId,
      studentId: studentId,
      type: "task_approved",
      title: "Submission approved",
      message: `Your submission for ${task.title} has been approved.${feedback && feedback !== "Approved" ? ` Reviewer note: ${feedback}` : ""}`,
      taskId: String(task._id),
      submissionId: String(submission._id),
      recipientRole: "student",
    });

    const { counts } = await buildTaskStudentState(db, task);
    ok(res, {
      status: "approved",
      task_id: String(task._id),
      student_id: studentId,
      submission_id: String(submission._id),
      submission_code: submission.submission_code || null,
      reviewed_at: now,
      reviewed_by: req.user.id,
      feedback,
      score: scoreUpdate ? scoreUpdate.score : null,
      max_marks: scoreUpdate ? scoreUpdate.max_marks : null,
      counts,
      message: "Submission approved",
    });
  } catch (e) {
    console.error("APPROVE SUBMISSION:", e);
    fail(res, 500, "APPROVE_FAILED", "Unable to approve this submission. Please retry.");
  }
}
router.post("/:id/review/approve", authenticateToken, authorizeRoles("admin", "ceo", "manager"), handleApprove);

/**
 * Validate an optional { score, max_marks } pair.
 * Returns null when neither is supplied (scoring is optional), a `$set`
 * fragment when valid, or `undefined` after it has already answered the
 * request with a 400 — so callers do `if (scoreUpdate === undefined) return;`.
 */
function parseScorePair(body, res) {
  const rawScore = body?.score;
  const rawMax = body?.max_marks ?? body?.maxMarks;
  const hasScore = rawScore !== undefined && rawScore !== null && rawScore !== "";
  const hasMax = rawMax !== undefined && rawMax !== null && rawMax !== "";
  if (!hasScore && !hasMax) return null;
  if (!hasScore || !hasMax) {
    fail(res, 400, "INCOMPLETE_SCORE", "Provide both score and max_marks when scoring a submission.");
    return undefined;
  }
  const score = Number(rawScore);
  const maxMarks = Number(rawMax);
  if (!Number.isFinite(score) || score < 0) {
    fail(res, 400, "INVALID_SCORE", "Score must be a number of zero or more.");
    return undefined;
  }
  if (!Number.isFinite(maxMarks) || maxMarks <= 0) {
    fail(res, 400, "INVALID_MAX_MARKS", "Max marks must be a number greater than zero.");
    return undefined;
  }
  if (score > maxMarks) {
    fail(res, 400, "SCORE_EXCEEDS_MAX", "Score cannot exceed max marks.");
    return undefined;
  }
  return { score, earned_score: score, max_marks: maxMarks };
}

/**
 * POST /api/tasks/:id/review/request-revision
 * Body: { studentId | submissionId, feedback }
 *
 * Feedback is mandatory (min 10 chars, validated here — the client mirrors it).
 * Opens a NEW revision cycle with a fresh 24-hour window measured from the
 * SERVER clock. The original submission and all its history are preserved.
 *
 * Shared implementation: `POST /api/tasks/review` delegates here, so there is
 * exactly one revision rule (and one notification) in the codebase.
 */
async function handleRequestRevision(req, res) {
  try {
    const db = req.db;
    const task = await loadReviewTask(req, res);
    if (!task) return;
    await runExpirySweep(db);

    const validation = validateRevisionFeedback(req.body?.feedback);
    if (!validation.ok) {
      return fail(res, 400, validation.code, validation.message);
    }
    const feedback = validation.value;

    const { studentId, submissionId } = await resolveReviewTarget(db, task, req.body || {}, res);
    if (!studentId) return;

    const existing = await db.collection("submissions")
      .find({ task_id: String(task._id), student_id: studentId })
      .sort({ version: -1 })
      .toArray();
    const submission = submissionId ? existing.find(s => String(s._id) === String(submissionId)) : existing[0];
    if (!submission) {
      return fail(res, 404, "SUBMISSION_NOT_FOUND", "This student has not submitted anything to revise.");
    }
    const current = normalizeSubmissionStatus(submission.status);
    if (current === "approved") {
      return fail(res, 409, "ILLEGAL_TRANSITION", "An approved submission cannot be sent back for revision.");
    }

    // ── New cycle: 24h from the SERVER clock, never from the client. ──────
    const now = new Date();
    const nowIso = now.toISOString();
    const windowHours = resubmissionWindowHours();
    const deadline = new Date(now.getTime() + windowHours * 3600 * 1000).toISOString();

    const { getAssignment, ensureAssignment, updateAssignment } = require("../models/TaskAssignment");
    const { assignment: prior } = await ensureAssignment(db, String(task._id), studentId);
    const cycle = Number(prior?.revision_cycle || 0) + 1;

    // A cycle that already EXPIRED may be reopened: the student gets a brand new
    // 24-hour window measured from now. An expired window is never extended in
    // place. A cycle that is still open, on the other hand, must be resolved
    // (resubmitted or expired) before another revision can be requested.
    const priorCycleOpen = prior?.revision_status === "open";
    if (current === "revision_required" && priorCycleOpen) {
      return fail(res, 409, "REVISION_ALREADY_OPEN", "A revision is already open for this submission.");
    }

    await updateAssignment(db, String(task._id), studentId, {
      status: "revision_required",
      revision_cycle: cycle,
      revision_requested_at: nowIso,
      revision_deadline: deadline,
      revision_status: "open",
      revision_history: [
        ...(Array.isArray(prior?.revision_history) ? prior.revision_history : []),
        {
          cycle,
          requestedBy: String(req.user.id),
          requestedAt: nowIso,
          feedback,
          deadline,
          window_hours: windowHours,
          status: "open",
        },
      ],
    });

    await db.collection("submissions").updateOne(
      { _id: submission._id },
      { $set: {
        status: "Revision Required",
        reviewer_id: req.user.id,
        reviewed_at: nowIso,
        review_comments: feedback,
        revision_cycle: cycle,
      } }
    );

    await syncTaskWorkflowFromStudents(db, task);
    await writeAudit(db, {
      actorId: req.user.id,
      action: "revision_requested",
      entityType: "submission",
      entityId: String(submission._id),
      previousValue: { status: submission.status },
      newValue: { status: "Revision Required", review_comments: feedback, cycle },
      metadata: { task_id: String(task._id), student_id: studentId, deadline },
    });

    const deadlineLabel = formatISTDeadlineLabel(deadline);
    await notifyOnce(db, {
      userId: studentId,
      type: "revision_required",
      title: "Revision required",
      message: revisionMessage({ taskTitle: task.title, feedback, deadlineLabel }),
      taskId: String(task._id),
      submissionId: String(submission._id),
      cycle,
      revisionRequestedAt: nowIso,
      revisionDeadline: deadline,
      recipientRole: "student",
      actionUrl: "/student/tasks",
    });

    const { counts } = await buildTaskStudentState(db, task);
    ok(res, {
      status: "revision_required",
      task_id: String(task._id),
      student_id: studentId,
      submission_id: String(submission._id),
      revision_cycle: cycle,
      revision_requested_at: nowIso,
      resubmission_deadline: deadline,
      resubmission_deadline_label: deadlineLabel,
      window_hours: windowHours,
      counts,
      message: "Revision requested",
    });
  } catch (e) {
    console.error("REQUEST REVISION:", e);
    fail(res, 500, "REVISION_FAILED", "Unable to request a revision. Please retry.");
  }
}
router.post("/:id/review/request-revision", authenticateToken, authorizeRoles("admin", "ceo", "manager"), handleRequestRevision);

/**
 * POST /api/tasks/:id/review/remind
 * Body: { studentIds: ["...", ...] } (one id = single reminder)
 *
 * Creates an in-app notification per student. Duplicates are prevented twice:
 * the client disables the button while the request is in flight, and the server
 * enforces a per-student-per-task cooldown so a reload, a second tab or a
 * double click cannot spam anyone.
 */
router.post("/:id/review/remind", authenticateToken, authorizeRoles("admin", "ceo", "manager"), async (req, res) => {
  try {
    const db = req.db;
    const task = await loadReviewTask(req, res);
    if (!task) return;

    const raw = Array.isArray(req.body?.studentIds)
      ? req.body.studentIds
      : (req.body?.studentId ? [req.body.studentId] : []);
    const studentIds = raw.map(s => String(s).trim()).filter(s => s && s !== "null" && s !== "undefined");
    if (!studentIds.length) {
      return fail(res, 400, "NO_STUDENTS", "Select at least one student to remind.");
    }

    const { rows } = await buildTaskStudentState(db, task);
    const known = new Set(rows.map(r => String(r.student_id)));
    const targets = [...new Set(studentIds)].filter(id => known.has(id));
    const unknown = [...new Set(studentIds)].filter(id => !known.has(id));
    if (!targets.length) {
      return fail(res, 404, "ASSIGNMENT_NOT_FOUND", "None of the selected students are assigned to this task.");
    }

    const cooldownMs = reminderCooldownMs();
    const now = new Date();
    const nowIso = now.toISOString();
    const dueLabel = task.due_at ? formatISTDeadlineLabel(task.due_at) : null;

    const sent = [];
    const skipped = [];
    for (const studentId of targets) {
      const assignment = await db.collection("task_assignments").findOne({ task_id: String(task._id), student_id: studentId });
      const last = assignment?.reminder_sent_at ? new Date(assignment.reminder_sent_at) : null;
      if (last && !Number.isNaN(last.getTime()) && now.getTime() - last.getTime() < cooldownMs) {
        const retryInMs = cooldownMs - (now.getTime() - last.getTime());
        skipped.push({ student_id: studentId, retry_in_ms: retryInMs });
        continue;
      }
      const row = rows.find(r => String(r.student_id) === studentId);
      const message = `Reminder: "${task.title}" is still ${STATUS_LABELS[row.status].toLowerCase()}.${dueLabel ? ` Please complete it by ${dueLabel}.` : " Please complete it as soon as possible."}`;
      // The dedupe key includes the cooldown slot, so repeated clicks inside one
      // slot can never duplicate, while a legitimate reminder after the cooldown
      // still gets through.
      const slot = Math.floor(now.getTime() / cooldownMs);
      const result = await notifyOnce(db, {
        userId: studentId,
        studentId,
        type: "task_reminder",
        title: "Task reminder",
        message,
        taskId: String(task._id),
        cycle: `r${slot}`,
        recipientRole: "student",
      });
      await db.collection("task_assignments").updateOne(
        { task_id: String(task._id), student_id: studentId },
        { $set: { reminder_sent_at: nowIso, reminder_sent_by: String(req.user.id) } },
        { upsert: true }
      );
      if (result.created) sent.push({ student_id: studentId });
      else skipped.push({ student_id: studentId, duplicate: true });
    }

    await writeAudit(db, {
      actorId: req.user.id,
      action: "task_reminder_sent",
      entityType: "task",
      entityId: String(task._id),
      newValue: { sent: sent.length, skipped: skipped.length },
      metadata: { unknown },
    });

    ok(res, {
      task_id: String(task._id),
      sent,
      skipped,
      unknown,
      cooldown_ms: cooldownMs,
      message: sent.length
        ? `Reminder sent to ${sent.length} student${sent.length === 1 ? "" : "s"}.`
        : "No new reminder was sent: every selected student is still inside the reminder cooldown.",
    });
  } catch (e) {
    console.error("SEND REMINDER:", e);
    fail(res, 500, "REMINDER_FAILED", "Unable to send the reminder. Please retry.");
  }
});

/**
 * Resolve which student's submission a reviewer action targets.
 * Accepts studentId (preferred) or submissionId, and ALWAYS verifies the
 * submission really belongs to (task, student) — a mismatched pair is a 404,
 * never a cross-student write.
 */
async function resolveReviewTarget(db, task, body, res) {
  const submissionId = body.submissionId ? String(body.submissionId).trim() : null;
  let studentId = body.studentId ? String(body.studentId).trim() : null;
  const clean = (v) => v && v !== "null" && v !== "undefined" ? v : null;

  if (!studentId && submissionId) {
    const sub = await db.collection("submissions").findOne({ _id: toId(submissionId) });
    if (!sub || String(sub.task_id) !== String(task._id)) {
      fail(res, 404, "SUBMISSION_NOT_FOUND", "That submission does not belong to this task.");
      return {};
    }
    studentId = String(sub.student_id);
  }
  studentId = clean(studentId);
  if (!studentId) {
    fail(res, 400, "NO_TARGET", "No student was specified for this action.");
    return {};
  }
  if (submissionId) {
    const sub = await db.collection("submissions").findOne({ _id: toId(submissionId) });
    if (!sub || String(sub.task_id) !== String(task._id) || String(sub.student_id) !== studentId) {
      fail(res, 404, "SUBMISSION_NOT_FOUND", "That submission does not belong to this task and student.");
      return {};
    }
  }
  return { studentId, submissionId };
}

/**
 * Close revision windows that have passed and tell the student once.
 * Used both lazily (before every Task Manager read) and by the cron endpoint.
 */
async function runExpirySweep(db) {
  try {
    return await expireStaleRevisionWindows(db, {
      notify: async ({ task, assignment, deadline, now }) => {
        await notifyOnce(db, {
          userId: String(assignment.student_id),
          type: "resubmission_expired",
          title: "Resubmission window expired",
          message: `The 24-hour resubmission window for "${task.title}" has expired. Ask your administrator to request a new revision if you can still fix it.`,
          taskId: String(task._id),
          cycle: assignment.revision_cycle,
          revisionDeadline: deadline,
          revisionRequestedAt: assignment.revision_requested_at || null,
          recipientRole: "student",
        });
        await notifyAdmins(db, {
          type: "resubmission_expired_admin",
          title: "Resubmission window expired",
          message: `The resubmission window for "${task.title}" expired at ${formatISTDeadlineLabel(deadline)}.`,
          taskId: String(task._id),
          studentId: String(assignment.student_id),
          cycle: assignment.revision_cycle,
          revisionDeadline: deadline,
        });
        void now;
      },
    });
  } catch (e) {
    console.error("Revision expiry sweep failed:", e.message);
    return [];
  }
}

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
    const subFilter = { task_id: String(task._id) };
    if (["student", "member"].includes(req.user.role)) subFilter.student_id = req.user.id;
    const submissions = await db.collection("submissions").find(subFilter).sort({ version: -1 }).toArray();

    const historyWithNames = await Promise.all(history.map(async h => {
      const u = await db.collection("users").findOne({ _id: toId(h.changed_by) }, { projection: { name: 1 } });
      return { ...h, id: String(h._id), changed_by_name: u?.name };
    }));
    const subsWithNames = await Promise.all(submissions.map(async s => {
      const u = s.reviewer_id ? await db.collection("users").findOne({ _id: toId(s.reviewer_id) }, { projection: { name: 1 } }) : null;
      // File metadata (id + authenticated download path) so the owning
      // student can open their own submission history and download files
      // without a second request. Access is still enforced on download.
      const files = await db.collection("submission_files").find({ submission_id: String(s._id) }, { projection: { original_name: 1, size: 1, mime_type: 1 } }).toArray();
      return {
        ...s, id: String(s._id), reviewer_name: u?.name,
        file_count: files.length,
        files: files.map(f => ({ id: String(f._id), name: f.original_name, size: f.size, mime: f.mime_type, download_url: `/api/tasks/files/${String(f._id)}/download` })),
      };
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
    // Enforce start/end window for student-driven status changes.
    if (studentOwner && (toStatus === "In Progress" || toStatus === "Acknowledged")) {
      const now = new Date();
      const sa = taskStartAt(task); const ea = taskEndAt(task);
      if (sa && now < new Date(sa)) return res.status(409).json({ success: false, message: "Task has not started yet" });
      if (ea && now > new Date(ea)) return res.status(409).json({ success: false, message: "The task deadline has passed" });
    }
    if ((admin || managerOwner) && toStatus === "Approved" && !["Under Review", "Resubmitted", "Submitted", "Revision Required"].includes(task.workflow_status)) {
      return res.status(409).json({ success: false, message: "Task must have a submission before approval" });
    }

    await transition(db, task, toStatus, req.user.id, req.body?.comment || null);
    // Mirror the transition into the acting student's assignment
    if (studentOwner && studentAssignment) {
      await updateAssignment(db, String(task._id), req.user.id, { status: "in_progress" });
    }
    if (toStatus === "In Progress") await notify(db, task.assigned_by, "task_started", "Task started", `${task.title} was marked in progress.`, String(task._id));
    // Per-student approval side-effects are handled by the caller that knows
    // the owning student (e.g. POST /review updates that student's assignment
    // and notifies them). transition() must never bulk-update every
    // assignment, because one student's submission must not change another's.

    res.json({ success: true, message: "Task status updated", workflow_status: toStatus });
  } catch (e) { console.error("Update status:", e); res.status(500).json({ success: false, message: "Unable to update status" }); }
});

/* ─── SUBMISSION STORAGE (shared by submit + resubmit) ────────────────────
 * Writes ONE version of a submission for (task, student) and mirrors it onto
 * that student's assignment. Both entry points funnel through here so a
 * resubmission is stored exactly like a first submission — only the gate that
 * decides whether a new version is allowed differs.
 *
 * Throws { status, code, message } on failure so the caller can answer with the
 * right HTTP status; nothing partial is ever left behind (DB rows and Drive
 * files are rolled back together).
 */
async function storeSubmissionVersion(db, task, studentId, { files, comment, version, actorId, revisionCycle = null }) {
  const { uploadFile } = require("../utils/fileStorage"); // GridFS storage
  const crypto = require("crypto");

  const submissionCode = await nextSubmissionCode(db);
  const submittedAt = new Date().toISOString();

  // Snapshot critical task fields so submissions remain viewable even if the task is deleted
  const taskSnapshot = {
    task_code: task.task_code || null,
    task_title: task.title || null,
    task_description: task.description || null,
    task_expected_output: task.expected_output || null,
    task_how_to_do: task.how_to_do || null,
    task_instructions: task.instructions || null,
    task_domain: task.domain || null,
    task_program: task.program || null,
    task_batch_id: task.batch_id || null,
    task_priority: task.priority || null,
    task_start_date: task.start_date || null,
    task_due_date: task.due_date || null,
    task_day_number: task.day_number || null,
  };

  const subResult = await db.collection("submissions").insertOne({
    submission_code: submissionCode,
    task_id: String(task._id),
    student_id: String(studentId),
    version,
    comment: comment || null,
    status: "Submitted",
    submitted_at: submittedAt,
    revision_cycle: revisionCycle,
    reviewer_id: null,
    reviewed_at: null,
    review_comments: null,
    created_at: submittedAt,
    // Task snapshot for historical integrity
    ...taskSnapshot,
  });
  const sid = String(subResult.insertedId);

  // GRIDFS-FIRST STRATEGY: Save files to MongoDB GridFS (source of truth)
  // Drive sync happens later as a secondary backup
  const savedFiles = [];
  const failedFiles = [];
  
  for (const file of (files || [])) {
    try {
      // Save to GridFS immediately
      const gridfsId = await uploadFile(db, file.buffer, file.originalname, {
        mimetype: file.mimetype,
        size: file.size,
        submission_id: sid,
        task_id: String(task._id),
        student_id: String(studentId),
        version,
      });

      // Store file metadata with GridFS ID and pending Drive status
      const fileRecord = await db.collection("submission_files").insertOne({
        submission_id: sid,
        original_name: file.originalname,
        mime_type: file.mimetype,
        size: file.size,
        gridfs_id: gridfsId,
        storage_type: "gridfs",
        drive_status: "pending", // Will be synced to Drive later
        drive_file_id: null,
        drive_folder_id: null,
        drive_web_view_link: null,
        drive_web_content_link: null,
        idempotency_key: crypto.randomUUID(),
        created_at: submittedAt,
      });

      savedFiles.push({
        id: String(fileRecord.insertedId),
        name: file.originalname,
        size: file.size,
        gridfs_id: gridfsId,
      });
    } catch (err) {
      console.error("[Submit] GridFS save failed for", file.originalname, ":", err.message);
      failedFiles.push({ name: file.originalname, error: err.message });
    }
  }

  // If ANY file failed to save to GridFS, roll back the entire submission
  if (failedFiles.length > 0) {
    // Delete GridFS files that were successfully uploaded
    const { deleteFile } = require("../utils/fileStorage");
    for (const savedFile of savedFiles) {
      try {
        if (savedFile.gridfs_id) {
          await deleteFile(db, savedFile.gridfs_id);
        }
      } catch (delErr) {
        console.error("[Submit] Failed to delete GridFS file during rollback:", delErr.message);
      }
    }
    
    // Delete submission_files records
    try { await db.collection("submission_files").deleteMany({ submission_id: sid }); } catch (e) { /* noop */ }
    
    // Delete submission record
    try { await db.collection("submissions").deleteOne({ _id: subResult.insertedId }); } catch (e) { /* noop */ }
    
    const err = new Error(`Failed to save ${failedFiles.length} file(s): ${failedFiles.map(f => f.name).join(", ")}`);
    err.status = 500;
    err.code = "FILE_SAVE_FAILED";
    throw err;
  }

  // Stop the running timer and snapshot the timing onto THIS submission row
  const { timingSnapshot } = require("../utils/taskSession");
  const timing = await timingSnapshot(db, { studentId: String(studentId), taskId: String(task._id), submittedAt });
  await db.collection("submissions").updateOne(
    { _id: subResult.insertedId },
    {
      $set: {
        session_id: timing.session_id,
        task_started_at: timing.task_started_at,
        task_submitted_at: submittedAt,
        duration_seconds: timing.duration_seconds,
      },
    }
  );

  const { updateAssignment } = require("../models/TaskAssignment");
  await updateAssignment(db, String(task._id), studentId, {
    status: "submitted",
    submission_version: version,
    submission_comment: comment || null,
    submitted_at: submittedAt,
    ...(revisionCycle ? { revision_status: "resubmitted" } : {}),
  });
  await writeAudit(db, {
    actorId,
    action: revisionCycle ? "submission_resubmitted" : "submission_uploaded",
    entityType: "submission",
    entityId: sid,
    newValue: { submission_code: submissionCode, task_id: String(task._id), version, submitted_at: submittedAt, revision_cycle: revisionCycle },
  });

  // TODO: Queue Drive sync job for these files (run async via cron or background job)
  // For now, files are safely stored in GridFS and accessible immediately

  return {
    submissionId: sid,
    submissionCode,
    version,
    submittedAt,
    files: savedFiles,
    drive_status: "pending", // Indicates Drive sync is pending
    task_started_at: timing.task_started_at,
    duration_seconds: timing.duration_seconds,
  };
}

/** Load a task a student is allowed to act on, or write the error response. */
async function loadStudentTask(db, req, res) {
  let taskId;
  try {
    taskId = new ObjectId(String(req.params.id || "").trim());
  } catch {
    fail(res, 400, "INVALID_TASK_ID", "This task link is not valid.");
    return null;
  }
  const task = await db.collection("tasks").findOne({ _id: taskId });
  if (!task) {
    fail(res, 404, "TASK_NOT_FOUND", "This task no longer exists.");
    return null;
  }
  const { getAssignment } = require("../models/TaskAssignment");
  const assignment = await getAssignment(db, String(task._id), req.user.id);
  const legacyOwner = String(task.assigned_to) === String(req.user.id);
  if (!assignment && !legacyOwner) {
    // IDOR guard: a student can only ever act on a task assigned to them.
    fail(res, 403, "FORBIDDEN", "This task is not assigned to you.");
    return null;
  }
  return { task, assignment };
}

/* ─── START / CURRENT TASK SESSION (student) ───────────────────────────────
 * The server is the source of truth for the timer. Start is idempotent: a
 * double click, two tabs, a refresh or a re-login all return the SAME session
 * with the original `started_at`. Students can never send a timestamp or a
 * duration — neither is read from the request body anywhere.
 */
router.post("/:id/start", authenticateToken, checkStudentRegistrationStatus, authorizeRoles("student", "member"), async (req, res) => {
  try {
    const db = req.db;
    const loaded = await loadStudentTask(db, req, res);
    if (!loaded) return;
    const { task, assignment } = loaded;
    if (["Approved", "Cancelled", "Archived"].includes(task.workflow_status)) {
      return fail(res, 409, "TASK_CLOSED", "This task can no longer be started.");
    }

    // Enforce start/end date-time window server-side.
    const now = new Date();
    const startAt = taskStartAt(task);
    const endAt = taskEndAt(task);
    if (startAt && now < new Date(startAt)) {
      return fail(res, 409, "NOT_STARTED", `Task has not started yet. Starts on ${new Date(startAt).toLocaleString()}`);
    }
    if (endAt && now > new Date(endAt)) {
      return fail(res, 409, "DEADLINE_PASSED", "The task deadline has passed.");
    }

    const { startSession, sessionView } = require("../utils/taskSession");
    const session = await startSession(db, {
      studentId: req.user.id,
      taskId: String(task._id),
      revisionCycle: assignment?.revision_cycle || 0,
    });

    // Mirror the historical "Start" behaviour: the first Start marks the
    // student's assignment in progress. This never touches submissions,
    // deadlines or review state.
    if (assignment && normalizeStatus(assignment.status) === "pending") {
      const { updateAssignment } = require("../models/TaskAssignment");
      await updateAssignment(db, String(task._id), req.user.id, { status: "in_progress" });
      await syncTaskWorkflowFromStudents(db, task);
    }

    ok(res, {
      ...sessionView(session, now),
      server_now: now.toISOString(),
      task_id: String(task._id),
      task_code: task.task_code || null,
      task_title: task.title || "",
    });
  } catch (e) {
    console.error("START TASK SESSION:", e);
    fail(res, 500, "START_FAILED", "Unable to start the task timer. Please retry.");
  }
});

/* ─── CURRENT SESSION (student) ────────────────────────────────────────────
 * Returns the active session (or the last completed one), the elapsed seconds
 * and the SERVER clock. The client renders the live display from
 * started_at + server_now offset, so a skewed client clock cannot change it.
 */
router.get("/:id/session", authenticateToken, checkStudentRegistrationStatus, authorizeRoles("student", "member"), async (req, res) => {
  try {
    const db = req.db;
    const loaded = await loadStudentTask(db, req, res);
    if (!loaded) return;
    const { task } = loaded;

    const { currentSession, getActiveSession, sessionView } = require("../utils/taskSession");
    // Prefer the running session so a refresh always restores the LIVE timer.
    const active = await getActiveSession(db, req.user.id, String(task._id));
    const session = active || await currentSession(db, req.user.id, String(task._id));
    const now = new Date();
    ok(res, {
      ...sessionView(session, now),
      server_now: now.toISOString(),
      task_id: String(task._id),
    });
  } catch (e) {
    console.error("GET TASK SESSION:", e);
    fail(res, 500, "SESSION_FAILED", "Unable to load the task timer.");
  }
});

/* ─── SUBMIT TASK (first version only) ─────────────────────────────────────
 * A student may create exactly ONE first submission through this route.
 * Any later version must go through POST /:id/resubmit, which enforces the
 * 24-hour revision window on the SERVER clock. Previously both went through
 * this one route with no window check at all, which is how a version could be
 * pushed after the deadline.
 *
 * Every status / feedback / deadline field a client might send is stripped
 * before it reaches the database.
 */
router.post("/:id/submit", authenticateToken, checkStudentRegistrationStatus, authorizeRoles("student", "member"), upload.array("files", 5), async (req, res) => {
  try {
    const db = req.db;
    const loaded = await loadStudentTask(db, req, res);
    if (!loaded) return;
    const { task, assignment } = loaded;
    if (["Approved", "Cancelled", "Archived"].includes(task.workflow_status)) {
      return fail(res, 409, "TASK_CLOSED", "This task cannot accept a submission.");
    }

    const existing = await db.collection("submissions")
      .countDocuments({ task_id: String(task._id), student_id: req.user.id });
    if (existing > 0) {
      return fail(res, 409, "ALREADY_SUBMITTED",
        "You have already submitted this task. Use the resubmission option if a revision was requested.");
    }

    // Enforce configured start/end date-time window server-side.
    const now = new Date();
    const startAt = taskStartAt(task);
    const endAt = taskEndAt(task);
    if (startAt && now < new Date(startAt)) {
      return fail(res, 409, "NOT_STARTED", `Task has not started yet. Starts on ${new Date(startAt).toLocaleString()}`);
    }
    if (endAt && now > new Date(endAt)) {
      return fail(res, 409, "DEADLINE_PASSED", "The task deadline has passed.");
    }

    // Reject empty submissions: at least one file or a comment is required
    // (mirrors the student UI validation so API clients get the same rule).
    const body = stripStudentControlledFields(req.body);
    const commentText = String(body.comment || "").trim();
    if (!(req.files || []).length && !commentText) {
      return fail(res, 400, "EMPTY_SUBMISSION", "Add at least one file or a submission comment before submitting.");
    }
    
    // Enforce maximum comment length (500 characters)
    if (commentText.length > 500) {
      return fail(res, 400, "COMMENT_TOO_LONG", "Comment must be 500 characters or less.");
    }

    const stored = await storeSubmissionVersion(db, task, req.user.id, {
      files: req.files || [],
      comment: commentText,
      version: 1,
      actorId: req.user.id,
    });

    await transition(db, task, "Submitted", req.user.id, "Submission received");
    await syncTaskWorkflowFromStudents(db, task);
    await notifyAdmins(db, {
      type: "submission_received",
      title: "Submission received",
      message: `${stored.submissionCode} was submitted for ${task.title}.`,
      taskId: String(task._id),
      submissionId: stored.submissionId,
      studentId: req.user.id,
    });
    
    void assignment;

    res.status(201).json({
      success: true,
      data: { ...stored, status: "submitted", message: "Submission stored successfully" },
      error: null,
      // Legacy flat keys kept so existing callers keep working.
      message: "Submission stored successfully",
      submissionId: stored.submissionId,
      submissionCode: stored.submissionCode,
      version: stored.version,
      submittedAt: stored.submittedAt,
    });
  } catch (e) {
    console.error("[SUBMIT ERROR]:", e.message);
    if (e.stack) console.error(e.stack);
    
    // The unique partial index on { student_id, task_id, version: 1 } makes a
    // duplicate FIRST submission impossible even under a race. Translate the
    // database error into the same clear 409 the pre-check returns.
    if (e && e.code === 11000) {
      return fail(res, 409, "ALREADY_SUBMITTED",
        "You have already submitted this task. Use the resubmission option if a revision was requested.");
    }
    fail(res, e.status || 500, e.code || "SUBMIT_FAILED", e.message || "Unable to store submission");
  }
});

/* ─── RESUBMISSION ELIGIBILITY (student) ───────────────────────────────────
 * The backend is the source of truth for the 24-hour window: the button state
 * in the portal is only a rendering of what this endpoint returns. Refreshing,
 * switching device or changing the client clock cannot change the answer,
 * because the deadline was written from the server clock at revision time and
 * is compared against the server clock here.
 */
router.get("/:id/resubmission-eligibility", authenticateToken, checkStudentRegistrationStatus, authorizeRoles("student", "member"), async (req, res) => {
  try {
    const db = req.db;
    const loaded = await loadStudentTask(db, req, res);
    if (!loaded) return;
    const { task, assignment } = loaded;

    await runExpirySweep(db);
    const assignmentNow = assignment
      ? await db.collection("task_assignments").findOne({ _id: assignment._id })
      : null;
    const latestRows = await db.collection("submissions")
      .find({ task_id: String(task._id), student_id: req.user.id })
      .sort({ version: -1 })
      .limit(1)
      .toArray();
    const latest = latestRows[0] || null;

    const { resolveStatus } = require("../utils/submissionStatus");
    const now = new Date();
    const resolved = resolveStatus(assignmentNow, latest, now);
    const eligibility = resubmissionEligibility(
      { status: resolved, revision_deadline: assignmentNow?.revision_deadline || null, revision_status: assignmentNow?.revision_status || null },
      now
    );

    ok(res, {
      task_id: String(task._id),
      task_code: task.task_code || null,
      task_title: task.title || "",
      status: resolved,
      status_label: STATUS_LABELS[resolved],
      revision_cycle: assignmentNow?.revision_cycle || 0,
      revision_requested_at: assignmentNow?.revision_requested_at || null,
      revision_deadline: assignmentNow?.revision_deadline || null,
      revision_deadline_label: assignmentNow?.revision_deadline ? formatISTDeadlineLabel(assignmentNow.revision_deadline) : null,
      last_review_feedback: latest?.review_comments || null,
      latest_submission: latest ? {
        id: String(latest._id),
        version: latest.version,
        submitted_at: latest.submitted_at,
      } : null,
      resubmission_available: eligibility.allowed,
      resubmission_blocked_reason: eligibility.reason,
      resubmission_expires_in_ms: eligibility.expires_in_ms,
      window_hours: resubmissionWindowHours(),
      server_time: now.toISOString(),
    });
  } catch (e) {
    console.error("RESUBMISSION ELIGIBILITY:", e);
    fail(res, 500, "ELIGIBILITY_FAILED", "Unable to check the resubmission window. Please retry.");
  }
});

/* ─── RESUBMIT (student, new version) ──────────────────────────────────────
 * Only allowed while THIS student's revision cycle is open and the server
 * clock is inside the deadline. Every older version is kept, so the admin can
 * always see what changed between v1, v2, v3...
 */
router.post("/:id/resubmit", authenticateToken, checkStudentRegistrationStatus, authorizeRoles("student", "member"), upload.array("files", 5), async (req, res) => {
  try {
    const db = req.db;
    const loaded = await loadStudentTask(db, req, res);
    if (!loaded) return;
    const { task, assignment } = loaded;

    await runExpirySweep(db);
    const assignmentNow = await db.collection("task_assignments").findOne({ _id: assignment._id });
    const priorCount = await db.collection("submissions")
      .countDocuments({ task_id: String(task._id), student_id: req.user.id });
    if (priorCount === 0) {
      return fail(res, 409, "NO_PRIOR_SUBMISSION", "You have not submitted this task yet, so there is nothing to resubmit.");
    }

    const latestRows = await db.collection("submissions")
      .find({ task_id: String(task._id), student_id: req.user.id })
      .sort({ version: -1 })
      .limit(1)
      .toArray();
    const latest = latestRows[0];

    // ── The gate. Server clock only. ──────────────────────────────────────
    const cycle = Number(assignmentNow?.revision_cycle || 0);
    const cycleStatus = assignmentNow?.revision_status || null;
    // Distinguish "the window closed" from "there was never a revision", so the
    // student always gets the accurate reason and the UI can show the right
    // message. A window that expired is never reopened implicitly.
    if (cycleStatus === "expired" || normalizeSubmissionStatus(latest?.status) === "resubmission_expired") {
      return fail(res, 409, "RESUBMISSION_EXPIRED", "The 24-hour resubmission window has expired.");
    }
    const openCycle = cycleStatus === "open" && cycle > 0;
    if (!openCycle) {
      return fail(res, 409, "NO_OPEN_REVISION",
        "No revision was requested for this submission.");
    }
    const now = new Date();
    const deadline = assignmentNow?.revision_deadline ? new Date(assignmentNow.revision_deadline) : null;
    if (!deadline || Number.isNaN(deadline.getTime())) {
      return fail(res, 409, "RESUBMISSION_EXPIRED", "The 24-hour resubmission window has expired.");
    }
    if (now.getTime() > deadline.getTime()) {
      // Persist the expiry before answering, so the state is correct even if
      // the student immediately hits refresh.
      await db.collection("task_assignments").updateOne(
        { _id: assignmentNow._id },
        { $set: { status: "resubmission_expired", revision_status: "expired", updated_at: now.toISOString() } }
      );
      await db.collection("submissions").updateMany(
        { task_id: String(task._id), student_id: req.user.id, status: "Revision Required" },
        { $set: { status: "Revision Required", window_expired_at: now.toISOString() } }
      );
      return fail(res, 409, "RESUBMISSION_EXPIRED", "The 24-hour resubmission window has expired.");
    }

    const body = stripStudentControlledFields(req.body);
    const commentText = String(body.comment || "").trim();
    if (!(req.files || []).length && !commentText) {
      return fail(res, 400, "EMPTY_SUBMISSION", "Attach the corrected file or describe what you changed before resubmitting.");
    }
    
    // Enforce maximum comment length (500 characters)
    if (commentText.length > 500) {
      return fail(res, 400, "COMMENT_TOO_LONG", "Comment must be 500 characters or less.");
    }

    const version = priorCount + 1;
    const stored = await storeSubmissionVersion(db, task, req.user.id, {
      files: req.files || [],
      comment: commentText,
      version,
      actorId: req.user.id,
      revisionCycle: cycle,
    });

    // Close the open entry in revisionHistory — history is append-only.
    const history = Array.isArray(assignmentNow.revision_history) ? assignmentNow.revision_history.slice() : [];
    const idx = history.findIndex(h => h && h.cycle === cycle && h.status === "open");
    if (idx >= 0) history[idx] = { ...history[idx], status: "resubmitted", resubmitted_at: stored.submittedAt };
    await db.collection("task_assignments").updateOne(
      { _id: assignmentNow._id },
      { $set: { revision_history: history } }
    );

    await transition(db, task, "Resubmitted", req.user.id, "Resubmission received");
    await syncTaskWorkflowFromStudents(db, task);
    await notifyAdmins(db, {
      type: "resubmission_received",
      title: "Corrected resubmission received",
      message: `${stored.submissionCode} (v${version}) was resubmitted for ${task.title} after revision cycle ${cycle}.`,
      taskId: String(task._id),
      submissionId: stored.submissionId,
      studentId: req.user.id,
      cycle,
      revisionDeadline: assignmentNow.revision_deadline,
      revisionRequestedAt: assignmentNow.revision_requested_at || null,
    });

    res.status(201).json({
      success: true,
      data: { ...stored, status: "submitted", revision_cycle: cycle, message: "Resubmission stored successfully" },
      error: null,
      message: "Resubmission stored successfully",
      submissionId: stored.submissionId,
      submissionCode: stored.submissionCode,
      version: stored.version,
      submittedAt: stored.submittedAt,
    });
  } catch (e) {
    console.error("Resubmission error:", e);
    fail(res, e.status || 500, e.code || "RESUBMIT_FAILED", e.message || "Unable to store the resubmission");
  }
});

/* ─── REVIEW SUBMISSION (submission-id addressed) ────────────────────────
 * POST /api/tasks/review  Body: { submission_id, decision, comment, score?, max_marks? }
 *
 * Kept because the CEO Student Submissions page and the Manager dashboard are
 * addressed by SUBMISSION id rather than by (task, student). It deliberately
 * contains no business rules of its own: it resolves the task, then delegates to
 * the exact same handlers the Task Manager uses, so there is one approval rule,
 * one revision rule, one 24-hour window and one notification per event.
 */
router.post("/review", authenticateToken, authorizeRoles("admin", "ceo", "manager"), async (req, res) => {
  try {
    const db = req.db;
    const sub = await db.collection("submissions").findOne({ _id: toId(req.body?.submission_id) });
    if (!sub) return fail(res, 404, "SUBMISSION_NOT_FOUND", "That submission no longer exists.");

    const task = await db.collection("tasks").findOne({ _id: toId(sub.task_id) });
    if (!task) return fail(res, 404, "TASK_NOT_FOUND", "The task for this submission no longer exists.");

    // A manager may only review their own tasks (unchanged pre-existing rule).
    const effectiveRole = req.user.role === "ceo" ? "admin" : req.user.role;
    if (effectiveRole === "manager" && String(task.assigned_by) !== String(req.user.id)) {
      return fail(res, 403, "FORBIDDEN", "You can only review tasks assigned by you.");
    }

    const decision = String(req.body?.decision || "").trim().toLowerCase();
    if (!["approve", "revision"].includes(decision)) {
      return fail(res, 400, "BAD_DECISION", "Decision must be approve or revision.");
    }

    // Capture values from the ORIGINAL body before reassigning req.body,
    // so the spread never reads from the object being constructed.
    const comment = req.body?.comment ?? req.body?.feedback ?? "";
    const origScore = req.body?.score;
    const origMaxMarks = req.body?.max_marks ?? req.body?.maxMarks;
    req.params = { ...req.params, id: String(task._id) };
    req.body = {
      submissionId: String(sub._id),
      studentId: String(sub.student_id),
      feedback: comment,
      ...(decision === "approve" ? { score: origScore, max_marks: origMaxMarks } : {}),
    };
    return decision === "approve" ? handleApprove(req, res) : handleRequestRevision(req, res);
  } catch (e) {
    console.error("POST /review:", e);
    fail(res, 500, "REVIEW_FAILED", "Unable to process the review. Please retry.");
  }
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

/* ─── GET MY SUBMISSION STATUS (student) ─────────────────────────────────────
 * Returns whether the authenticated student has submitted this specific task.
 * Used by the frontend to determine if the Submit button should be shown.
 */
router.get("/:id/my-submission-status", authenticateToken, checkStudentRegistrationStatus, authorizeRoles("student", "member"), async (req, res) => {
  try {
    const db = req.db;
    const taskId = req.params.id;
    
    // Check if student has a submission for this task
    const submission = await db.collection("submissions")
      .findOne(
        { task_id: String(taskId), student_id: req.user.id },
        { projection: { _id: 1, status: 1, version: 1, submitted_at: 1, comment: 1, review_comments: 1 } }
      );
    
    // Get the student's assignment record for this task
    const { getAssignment } = require("../models/TaskAssignment");
    const assignment = await getAssignment(db, String(taskId), req.user.id);
    
    // Get the task to check if it's assigned to this student via legacy assigned_to
    const task = await db.collection("tasks").findOne(
      { _id: toId(taskId) },
      { projection: { assigned_to: 1, workflow_status: 1, title: 1, task_code: 1, due_at: 1 } }
    );
    
    const legacyOwner = task?.assigned_to === req.user.id;
    
    // Student must have either an assignment or be the legacy owner
    if (!assignment && !legacyOwner) {
      return fail(res, 403, "FORBIDDEN", "This task is not assigned to you.");
    }

    // Expire any window that has closed, so a student who refreshes sees the
    // real state instead of a stale "Resubmit" button.
    await runExpirySweep(db);
    const assignmentNow = assignment ? await db.collection("task_assignments").findOne({ _id: assignment._id }) : null;

    // One canonical status per student, from the same resolver the admin Task
    // Manager uses — the two portals can never disagree about a student.
    const now = new Date();
    const { resolveStatus } = require("../utils/submissionStatus");
    const resolved = resolveStatus(assignmentNow, submission, now);
    const eligibility = resubmissionEligibility(
      { status: resolved, revision_deadline: assignmentNow?.revision_deadline || null, revision_status: assignmentNow?.revision_status || null },
      now
    );

    let studentWorkflowStatus = STATUS_LABELS[resolved];
    // Respect a cancelled/archived task for everyone.
    if (task?.workflow_status === "Cancelled" || task?.workflow_status === "Archived") {
      studentWorkflowStatus = task.workflow_status;
    }

    ok(res, {
      task_id: String(taskId),
      task_title: task?.title || "",
      task_code: task?.task_code || null,
      due_at: task?.due_at || null,
      has_submission: !!submission,
      // `workflow_status` keeps its historical label so the existing student UI
      // keeps working; `status` is the canonical enum value.
      workflow_status: studentWorkflowStatus,
      status: resolved,
      status_label: STATUS_LABELS[resolved],
      assignment_status: assignmentNow ? normalizeStatus(assignmentNow.status) : null,
      revision_cycle: assignmentNow?.revision_cycle || 0,
      revision_requested_at: assignmentNow?.revision_requested_at || null,
      revision_deadline: assignmentNow?.revision_deadline || null,
      revision_deadline_label: assignmentNow?.revision_deadline ? formatISTDeadlineLabel(assignmentNow.revision_deadline) : null,
      review_feedback: submission?.review_comments || null,
      resubmission_available: eligibility.allowed && !["Cancelled", "Archived"].includes(studentWorkflowStatus),
      resubmission_blocked_reason: eligibility.reason,
      resubmission_expires_in_ms: eligibility.expires_in_ms,
      latest_submission: submission ? {
        id: String(submission._id),
        version: submission.version,
        submitted_at: submission.submitted_at,
        status: submission.status,
        comment: submission.comment
      } : null
    }, {
      // Legacy flat keys.
      //
      // These used to be the ONLY response shape, so they are kept as a
      // complete mirror of `data`: a caller reading the flat `status` must
      // get the same canonical value a caller reading `data.status` gets.
      has_submission: !!submission,
      workflow_status: studentWorkflowStatus,
      status: resolved,
      status_label: STATUS_LABELS[resolved],
      assignment_status: assignmentNow ? normalizeStatus(assignmentNow.status) : null,
      revision_cycle: assignmentNow?.revision_cycle || 0,
      revision_requested_at: assignmentNow?.revision_requested_at || null,
      revision_deadline: assignmentNow?.revision_deadline || null,
      revision_deadline_label: assignmentNow?.revision_deadline ? formatISTDeadlineLabel(assignmentNow.revision_deadline) : null,
      review_feedback: submission?.review_comments || null,
      resubmission_available: eligibility.allowed && !["Cancelled", "Archived"].includes(studentWorkflowStatus),
      resubmission_blocked_reason: eligibility.reason,
      resubmission_expires_in_ms: eligibility.expires_in_ms,
      latest_submission: submission ? {
        id: String(submission._id),
        version: submission.version,
        submitted_at: submission.submitted_at,
        status: submission.status,
        comment: submission.comment
      } : null
    });
  } catch (e) {
    console.error("GET MY SUBMISSION STATUS:", e);
    fail(res, 500, "STATUS_FAILED", "Unable to check submission status");
  }
});

/* ─── GET TASK SUBMISSIONS ─────────────────────────────────────────────────
 * Every version submitted for this task, newest first, each row carrying the
 * student it belongs to.
 *
 * The old shape had no student identity on the row at all, which is why the
 * review modal could only ever show "one student": the client had no way to
 * tell the rows apart. Student name / code / department / program / batch and
 * the canonical review status are resolved here, per version.
 *
 * Access: reviewers see everything; a student sees only their OWN versions.
 */
router.get("/:id/submissions", authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    const task = await db.collection("tasks").findOne({ _id: toId(req.params.id) });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });

    const isReviewer = isReviewerRole(req.user.role);
    if (!isReviewer) {
      const { getAssignment } = require("../models/TaskAssignment");
      const own = await getAssignment(db, String(task._id), req.user.id);
      const legacyOwner = String(task.assigned_to) === String(req.user.id);
      if (!own && !legacyOwner) {
        return fail(res, 403, "FORBIDDEN", "You do not have permission to view these submissions.");
      }
    }

    const filter = { task_id: String(task._id) };
    if (!isReviewer) filter.student_id = req.user.id;

    const submissions = await db.collection("submissions").find(filter).sort({ submitted_at: -1 }).toArray();
    const studentIds = [...new Set(submissions.map(s => String(s.student_id)))];
    const [students, reviewers, assignments] = await Promise.all([
      studentIds.length
        ? db.collection("users").find({ _id: { $in: studentIds.map(toId) } }, { projection: { name: 1, email: 1, student_id: 1, learner_id: 1, department: 1, program: 1, batch_id: 1 } }).toArray()
        : [],
      db.collection("users").find({ _id: { $in: submissions.map(s => toId(s.reviewer_id)).filter(Boolean) } }, { projection: { name: 1 } }).toArray(),
      db.collection("task_assignments").find({ task_id: String(task._id), student_id: { $in: studentIds } }).toArray(),
    ]);
    const studentById = new Map(students.map(s => [String(s._id), s]));
    const reviewerById = new Map(reviewers.map(s => [String(s._id), s.name]));
    const assignmentByStudent = new Map(assignments.map(a => [String(a.student_id), a]));

    const batchIds = [...new Set(students.map(s => s.batch_id).filter(Boolean))];
    const batches = batchIds.length
      ? await db.collection("batches").find({ _id: { $in: batchIds.map(toId) } }, { projection: { name: 1 } }).toArray()
      : [];
    const batchNameById = new Map(batches.map(b => [String(b._id), b.name]));

    const rows = await Promise.all(submissions.map(async s => {
      const student = studentById.get(String(s.student_id));
      const assignment = assignmentByStudent.get(String(s.student_id));
      const files = await filesForSubmission(db, s._id);
      return {
        ...s,
        id: String(s._id),
        student_id: String(s.student_id),
        student_db_id: String(s.student_id),
        student_name: student?.name || null,
        student_code: student?.student_id || student?.learner_id || null,
        student_email: student?.email || null,
        student_department: student?.department || null,
        student_program: student?.program || null,
        batch_name: student?.batch_id ? (batchNameById.get(String(student.batch_id)) || null) : null,
        reviewer_name: s.reviewer_id ? (reviewerById.get(String(s.reviewer_id)) || null) : null,
        // Canonical review status for this student-task, plus the raw label.
        review_status: normalizeSubmissionStatus(s.status),
        review_status_label: STATUS_LABELS[normalizeSubmissionStatus(s.status)],
        revision_cycle: assignment?.revision_cycle || s.revision_cycle || null,
        revision_deadline: assignment?.revision_deadline || null,
        file_count: files.length,
        files,
      };
    }));
    res.json({ success: true, submissions: rows });
  } catch (e) { res.status(500).json({ success: false, message: "Unable to fetch submissions" }); }
});

module.exports = router;
