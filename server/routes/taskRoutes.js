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
const { normalizeRegistrationStatus } = require("../utils/userAccount");
const { uploadFile, downloadFile, migrateFileToGridFS } = require("../utils/fileStorage");

const router = express.Router();
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
  try { return new Date(`${date}T${t}:00`).toISOString(); } catch { return null; }
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
        db.collection("users").findOne({ _id: toId(s.student_id) }, { projection: { name: 1, email: 1, phone: 1, program: 1, batch_id: 1, created_at: 1 } }),
        db.collection("submission_files").find({ submission_id: sid }, { projection: { original_name: 1, size: 1, mime_type: 1, created_at: 1, drive_file_id: 1, drive_folder_id: 1 } }).toArray(),
        db.collection("task_assignments").findOne({ task_id: String(s.task_id), student_id: String(s.student_id) }, { projection: { progress: 1, status: 1 } }),
        s.reviewer_id ? db.collection("users").findOne({ _id: toId(s.reviewer_id) }, { projection: { name: 1 } }) : null,
      ]);
      let batchName = null;
      if (student?.batch_id) {
        const batch = await db.collection("batches").findOne({ _id: toId(student.batch_id) }, { projection: { name: 1 } });
        batchName = batch?.name || null;
      }
      return {
        id: sid,
        submission_code: s.submission_code,
        version: s.version,
        comment: s.comment || null,
        status: s.status,
        submitted_at: s.submitted_at,
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
        student_id: String(s.student_id),
        student_name: student?.name || null,
        student_email: student?.email || null,
        student_phone: student?.phone || null,
        student_program: student?.program || null,
        batch_name: batchName,
        file_count: files.length,
        files: files.map(f => ({ id: String(f._id), name: f.original_name, size: f.size, mime: f.mime_type, download_url: `/api/tasks/files/${String(f._id)}/download` })),
        assignment_progress: assignment?.progress ?? null,
        assignment_status: assignment?.status ?? null,
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

/* ─── DOWNLOAD SUBMISSION FILE ──────────────────────────────────────────
 * Streams file from MongoDB GridFS or migrates from legacy filesystem.
 * Supports both new GridFS files and old filesystem files for backward compatibility.
 *
 * Authorization: reviewers (admin/manager/ceo) may download any submission
 * file; a student may download files belonging to THEIR OWN submissions
 * (submission history access). The owning student is matched by id — never
 * by a client-supplied field — and pending/rejected students are already
 * blocked by requireApprovedStudent on this router.
 */
router.get("/files/:fileId/download", authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    const file = await db.collection("submission_files").findOne({ _id: toId(req.params.fileId) });
    if (!file) return res.status(404).json({ success: false, message: "File not found" });
    
    const sub = await db.collection("submissions").findOne({ _id: toId(file.submission_id) });
    if (!sub) return res.status(404).json({ success: false, message: "Submission not found" });

    const isReviewer = ["admin", "manager", "ceo"].includes(req.user.role);
    const isOwner = req.user.role === "student" && String(sub.student_id) === String(req.user.id);
    if (!isReviewer && !isOwner) {
      return res.status(403).json({ success: false, message: "You do not have permission to access this file" });
    }
    
    // Google Drive storage (preferred when available)
    if (file.drive_file_id) {
      try {
        const { downloadFromDrive } = require("../utils/driveStorage");
        const { stream, meta } = await downloadFromDrive(file.drive_file_id);
        res.setHeader("Content-Type", file.mime_type || meta.mimeType || "application/octet-stream");
        res.setHeader("Content-Disposition", 'attachment; filename="' + encodeURIComponent(file.original_name || "submission-file") + '"');
        stream.pipe(res);
        await writeAudit(db, { actorId: req.user.id, action: "submission_file_downloaded", entityType: "submission_file", entityId: String(file._id), newValue: { submission_id: String(sub._id), storage_type: "drive" } });
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
        
        res.setHeader("Content-Type", file.mime_type || "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.original_name || "submission-file")}"`);
        
        stream.pipe(res);
        
        await writeAudit(db, { 
          actorId: req.user.id, 
          action: "submission_file_downloaded", 
          entityType: "submission_file", 
          entityId: String(file._id), 
          newValue: { submission_id: String(sub._id), storage_type: "gridfs" } 
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
          newValue: { submission_id: String(sub._id), storage_type: "filesystem" } 
        });
        
        return res.download(file.storage_path, file.original_name || "submission-file");
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
      day_number: dayNumber,
      start_date: b.start_date || null,
      start_time: startTime,
      start_at: combineTaskDateTime(b.start_date, startTime, "00:00"),
      due_date: b.due_date || null,
      due_time: endTime,
      due_at: combineTaskDateTime(b.due_date, endTime, "23:59"),
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

    // Enforce configured start/end date-time window server-side.
    const now = new Date();
    const startAt = taskStartAt(task);
    const endAt = taskEndAt(task);
    if (startAt && now < new Date(startAt)) {
      return res.status(409).json({ success: false, message: `Task has not started yet. Starts on ${new Date(startAt).toLocaleString()}` });
    }
    if (endAt && now > new Date(endAt)) {
      return res.status(409).json({ success: false, message: "The task deadline has passed." });
    }

    // Reject empty submissions: at least one file or a comment is required
    // (mirrors the student UI validation so API clients get the same rule).
    const commentText = String(req.body?.comment || "").trim();
    if (!(req.files || []).length && !commentText) {
      return res.status(400).json({ success: false, message: "Add at least one file or a submission comment before submitting." });
    }

    const priorSubCount = await db.collection("submissions").countDocuments({ task_id: String(task._id), student_id: req.user.id });
    const version = priorSubCount + 1;
    const submissionCode = await nextSubmissionCode(db);
    const submittedAt = new Date().toISOString();

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

    const { ensureStudentFolder, ensureTaskFolder, validateUpload, uploadToDrive, deleteFromDrive } = require("../utils/driveStorage");
    const crypto = require("crypto");
    // Fetch student info for folder naming
    const student = await db.collection("users").findOne({ _id: toId(req.user.id) }, { projection: { name: 1, student_id: 1 } });
    let parentFolderId = null;
    // Drive is only contacted when files are actually attached: comment-only
    // submissions must keep working even if Drive is temporarily unavailable.
    if ((req.files || []).length) {
      try {
        const folder = await ensureTaskFolder(
          db,
          req.user.id,
          String(task._id),
          task.task_code || String(task._id),
          task.title || "Untitled Task"
        );
        parentFolderId = folder.id;
      } catch (folderErr) {
        console.error("[Submit] Drive folder error:", folderErr.message);
        return res.status(502).json({ success: false, message: "Unable to prepare Drive folder: " + folderErr.message });
      }
    }

    const uploadedFiles = [];
    let uploadError = null;
    for (const file of (req.files || [])) {
      const v = validateUpload(file, Number(process.env.GOOGLE_DRIVE_UPLOAD_MAX_BYTES || 5 * 1024 * 1024));
      if (!v.ok) { uploadError = v.errors.join("; "); break; }
      let driveFile = null;
      try {
        const ext = (file.originalname.match(/\.[^.]+$/) || [""])[0].toLowerCase();
        const datePart = (submittedAt || new Date().toISOString()).slice(0, 10);
        const taskPart = "TASK_" + String(task.task_code || task.id || task._id).replace(/[^a-zA-Z0-9]/g, "_");
        const overrideName = taskPart + "_SUBMISSION_" + datePart + "_v" + version + ext;
        driveFile = await uploadToDrive(file.buffer, file.originalname, file.mimetype, parentFolderId, overrideName);
      } catch (upErr) {
        console.error("[Submit] Drive upload error:", upErr.message);
        uploadError = "Drive upload failed: " + upErr.message;
        break;
      }

      let saved = false;
      let lastErr = null;
      for (let i = 0; i < 3; i++) {
        try {
          const ins = await db.collection("submission_files").insertOne({
            submission_id: sid,
            original_name: file.originalname,
            mime_type: file.mimetype,
            size: file.size,
            drive_file_id: driveFile.id,
            drive_folder_id: parentFolderId,
            drive_web_view_link: driveFile.webViewLink || null,
            drive_web_content_link: driveFile.webContentLink || null,
            storage_type: "drive",
            idempotency_key: crypto.randomUUID(),
            created_at: submittedAt,
          });
          saved = true;
          uploadedFiles.push({ driveFile: driveFile, fileId: ins.insertedId, saved: true });
          break;
        } catch (dbErr) {
          lastErr = dbErr;
          await new Promise((r) => setTimeout(r, Math.pow(2, i) * 300));
        }
      }
      if (!saved) {
        uploadedFiles.push({ driveFile: driveFile, fileId: null, saved: false, error: (lastErr && lastErr.message) || "DB insert failed" });
        uploadError = "Database save failed for " + file.originalname + ": " + ((lastErr && lastErr.message) || "unknown");
        break;
      }
    }

    if (uploadError) {
      // Roll back: never leave a partial submission. Remove DB rows and Drive files.
      try { await db.collection("submission_files").deleteMany({ submission_id: sid }); } catch (e) { console.error("[Submit] rollback files error:", e.message); }
      try { await db.collection("submissions").deleteOne({ _id: subResult.insertedId }); } catch (e) { console.error("[Submit] rollback submission error:", e.message); }
      for (const uf of uploadedFiles) {
        if (uf.driveFile && uf.driveFile.id) {
          try { await deleteFromDrive(uf.driveFile.id); } catch (e) { console.error("[Submit] rollback drive delete failed:", e.message); }
        }
      }
      // Record orphans for reconcile (best effort)
      for (const uf of uploadedFiles) {
        if (uf.driveFile && uf.driveFile.id) {
          try {
            await db.collection("drive_orphans").insertOne({
              drive_file_id: uf.driveFile.id, drive_folder_id: parentFolderId, submission_id: sid,
              task_id: String(task._id), student_id: req.user.id, original_name: uf.driveFile.name || "unknown",
              created_at: new Date().toISOString(), error: uploadError, rolled_back: true,
            });
          } catch (e) { console.error("[Submit] orphan record failed:", e.message); }
        }
      }
      return res.status(502).json({ success: false, message: uploadError });
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

    // OPTIONAL scoring. The schema has no mandatory score/max_marks pair, so
    // scoring stays opt-in: when both are supplied they are validated and
    // stored on the submission (and mirrored on the assignment). When they
    // are omitted the task is simply left "awaiting evaluation" — no score
    // is invented and no division by zero can occur downstream.
    const rawScore = req.body?.score;
    const rawMax = req.body?.max_marks;
    const hasScoreInput = rawScore !== undefined && rawScore !== null && rawScore !== "";
    const hasMaxInput = rawMax !== undefined && rawMax !== null && rawMax !== "";
    let scoreValue = null, maxMarksValue = null;
    if (hasScoreInput || hasMaxInput) {
      if (!hasScoreInput || !hasMaxInput) {
        return res.status(400).json({ success: false, message: "Provide both score and max_marks when scoring a submission" });
      }
      scoreValue = Number(rawScore);
      maxMarksValue = Number(rawMax);
      if (!Number.isFinite(scoreValue) || scoreValue < 0) {
        return res.status(400).json({ success: false, message: "Score must be a non-negative number" });
      }
      if (!Number.isFinite(maxMarksValue) || maxMarksValue <= 0) {
        return res.status(400).json({ success: false, message: "Max marks must be a number greater than zero" });
      }
      if (scoreValue > maxMarksValue) {
        return res.status(400).json({ success: false, message: "Score cannot exceed max marks" });
      }
    }

    const next = decision === "approve" ? "Approved" : "Revision Required";
    const now = new Date().toISOString();

    const submissionUpdate = {
      status: next,
      reviewer_id: req.user.id,
      reviewed_at: now,
      review_comments: comment,
    };
    if (scoreValue !== null) {
      submissionUpdate.score = scoreValue;
      submissionUpdate.earned_score = scoreValue;
      submissionUpdate.max_marks = maxMarksValue;
      submissionUpdate.scored_at = now;
      submissionUpdate.scored_by = req.user.id;
    }
    await db.collection("submissions").updateOne({ _id: sub._id }, { $set: submissionUpdate });
    await transition(db, task, next, req.user.id, comment);
    // Mirror the decision onto the submitting student's assignment
    const { updateAssignment } = require("../models/TaskAssignment");
    await updateAssignment(db, String(task._id), sub.student_id, {
      status: decision === "approve" ? "approved" : "revision_required",
      progress: decision === "approve" ? 100 : undefined,
    });
    await notify(db, sub.student_id, decision === "approve" ? "task_approved" : "revision_required", decision === "approve" ? "Task approved" : "Revision required", `${task.title}: ${comment}`, sub.task_id);
    await writeAudit(db, { actorId: req.user.id, action: decision === "approve" ? "submission_approved" : "revision_requested", entityType: "submission", entityId: String(sub._id), previousValue: { status: sub.status }, newValue: { status: next, review_comments: comment } });

    res.json({ success: true, message: decision === "approve" ? "Submission approved" : "Revision requested", status: next, score: scoreValue, max_marks: maxMarksValue });
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
        { projection: { _id: 1, status: 1, version: 1, submitted_at: 1, comment: 1 } }
      );
    
    // Get the student's assignment record for this task
    const { getAssignment } = require("../models/TaskAssignment");
    const assignment = await getAssignment(db, String(taskId), req.user.id);
    
    // Get the task to check if it's assigned to this student via legacy assigned_to
    const task = await db.collection("tasks").findOne(
      { _id: toId(taskId) },
      { projection: { assigned_to: 1, workflow_status: 1 } }
    );
    
    const legacyOwner = task?.assigned_to === req.user.id;
    
    // Student must have either an assignment or be the legacy owner
    if (!assignment && !legacyOwner) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    
    // Determine the workflow status for THIS student (per-student only).
    let studentWorkflowStatus = null;
    if (submission) {
      // Student has submitted - use THEIR submission status.
      studentWorkflowStatus = submission.status;
    } else if (assignment) {
      switch (assignment.status) {
        case "approved": studentWorkflowStatus = "Approved"; break;
        case "revision_required": studentWorkflowStatus = "Revision Required"; break;
        case "submitted": studentWorkflowStatus = "Submitted"; break;
        case "in_progress": studentWorkflowStatus = "In Progress"; break;
        case "assigned":
        default: studentWorkflowStatus = "Assigned"; break;
      }
    }
    // Respect a cancelled/archived task for everyone.
    if (task?.workflow_status === "Cancelled" || task?.workflow_status === "Archived") {
      studentWorkflowStatus = task.workflow_status;
    }
    
    res.json({
      success: true,
      has_submission: !!submission,
      workflow_status: studentWorkflowStatus,
      assignment_status: assignment?.status || null,
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
    res.status(500).json({ success: false, message: "Unable to check submission status" });
  }
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
      const files = await db.collection("submission_files").find({ submission_id: String(s._id) }, { projection: { original_name: 1, size: 1, mime_type: 1 } }).toArray();
      return { ...s, id: String(s._id), reviewer_name: u?.name, file_count: files.length, files: files.map(f => ({ id: String(f._id), name: f.original_name, size: f.size, mime: f.mime_type, download_url: `/api/tasks/files/${String(f._id)}/download` })) };
    }));
    res.json({ success: true, submissions: rows });
  } catch (e) { res.status(500).json({ success: false, message: "Unable to fetch submissions" }); }
});

module.exports = router;
