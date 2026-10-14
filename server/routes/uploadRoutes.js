/**
 * Google Drive upload routes — resumable, direct-from-browser uploads.
 *
 * Flow (file bytes never pass through a Vercel function body):
 *   1. POST /init      → authenticate, authorize, validate, ensure folders,
 *                       create a Drive resumable session, return its URL.
 *   2. client PUTs the bytes straight to Google Drive.
 *   3. POST /finalize  → re-verify against the Drive API (never trust the
 *                       client), mark the upload ready to be attached to a
 *                       submission.
 *
 * The session URL is a credential: it is returned only to the authenticated
 * client that requested it and is never logged or persisted.
 *
 * Mounted at /api/tasks/uploads (before the /api/tasks router, whose "/:id"
 * route would otherwise swallow these paths).
 */

const express = require("express");
const crypto = require("crypto");
const { authenticateToken, authorizeRoles, checkStudentRegistrationStatus } = require("../middleware/authMiddleware");
const { writeAudit } = require("../utils/audit_mongo");
const { validateFileMeta, MAX_FILES } = require("../utils/uploadRules");
const drive = require("../utils/driveStorage");

const router = express.Router();

const UPLOAD_COLLECTION = "drive_uploads";
// Staged uploads are swept after a day; anything already attached to a
// submission is ignored by this sweep.
const STALE_UPLOAD_AGE_MS = 24 * 60 * 60 * 1000;

function toId(id) { const { ObjectId } = require("mongodb"); try { return new ObjectId(id); } catch { return id; } }

/**
 * Resolve the real task + the real user, and confirm the caller may submit to
 * that task. Authorization mirrors the existing POST /:id/submit rule exactly.
 * @returns {Promise<{task:Object, user:Object}>}
 * @throws {Error} with `.status` and `.message` for a client-safe failure
 */
async function authorizeTaskSubmission(db, req, taskId) {
  let taskOid;
  try {
    taskOid = new (require("mongodb").ObjectId)(String(taskId || ""));
  } catch {
    const err = new Error("Invalid task id");
    err.status = 400;
    throw err;
  }
  const task = await db.collection("tasks").findOne({ _id: taskOid });
  if (!task) { const err = new Error("Task not found"); err.status = 404; throw err; }

  // The owning user is read from the database, keyed by the verified JWT id.
  const user = await db.collection("users").findOne(
    { _id: toId(req.user.id) },
    { projection: { name: 1, email: 1, role: 1, department: 1, program: 1, student_id: 1, batch_id: 1 } }
  );
  if (!user) { const err = new Error("User not found"); err.status = 404; throw err; }

  // A student may only submit a task they have an assignment for (batch or
  // individual), or that is legacy-assigned to them.
  const { getAssignment } = require("../models/TaskAssignment");
  const assignment = await getAssignment(db, String(task._id), req.user.id);
  const legacyOwner = task.assigned_to === req.user.id;
  if (!assignment && !legacyOwner) {
    const err = new Error("Access denied");
    err.status = 403;
    throw err;
  }
  if (["Approved", "Cancelled", "Archived"].includes(task.workflow_status)) {
    const err = new Error("This task cannot accept a submission");
    err.status = 409;
    throw err;
  }
  return { task, user };
}

/**
 * POST /api/tasks/uploads/init
 * Body: { taskId, fileName, mimeType, size, submissionId? }
 */
router.post("/init", authenticateToken, checkStudentRegistrationStatus, authorizeRoles("student", "member"), async (req, res) => {
  try {
    if (!drive.isDriveConfigured()) {
      return res.status(503).json({ success: false, message: "File storage is temporarily unavailable. Please contact your administrator." });
    }

    const db = req.db;
    const { taskId, fileName, mimeType, size, submissionId } = req.body || {};

    // Existing validation rules — identical to the multer path.
    const check = validateFileMeta(fileName, size);
    if (!check.ok) {
      return res.status(400).json({ success: false, message: check.message });
    }

    // Do not let a client stack an unbounded number of staged uploads.
    const recent = await db.collection(UPLOAD_COLLECTION).countDocuments({
      user_id: req.user.id,
      created_at: { $gte: new Date(Date.now() - STALE_UPLOAD_AGE_MS).toISOString() },
      status: { $in: ["staged", "verified"] },
    });
    if (recent >= 40) {
      return res.status(429).json({ success: false, message: "Too many uploads in progress. Please wait a moment and try again." });
    }

    const { task, user } = await authorizeTaskSubmission(db, req, taskId);

    // Role → Drive root mapping happens here, server-side, from the verified
    // JWT role. The client cannot influence the root or the folder path.
    const folders = await drive.ensureTaskFolder(db, {
      role: req.user.role,
      userId: req.user.id,
      userName: user.name || user.email || "User",
      task,
    });

    // Never overwrite: pick a name that is free in this folder.
    const taken = await drive.listFolderFileNames(await drive.getDrive(), folders.taskFolderId);
    const storedFileName = drive.uniqueStoredFileName(fileName, taken);

    const uploadToken = crypto.randomBytes(24).toString("hex");
    await db.collection(UPLOAD_COLLECTION).insertOne({
      upload_token: uploadToken,
      status: "staged",
      user_id: req.user.id,
      user_display_name: user.name || null,
      user_role: req.user.role,
      user_email: user.email || null,
      task_id: String(task._id),
      task_title: task.title || null,
      task_code: task.task_code || null,
      submission_id: submissionId ? String(submissionId) : null,
      original_file_name: String(fileName),
      stored_file_name: storedFileName,
      mime_type: String(mimeType || "application/octet-stream"),
      declared_size: Number(size),
      drive_folder_id: folders.taskFolderId,
      drive_folder_name: folders.taskFolderName,
      created_at: new Date().toISOString(),
    });

    const sessionUrl = await drive.createResumableSession({
      folderId: folders.taskFolderId,
      storedFileName,
      mimeType: String(mimeType || "application/octet-stream"),
      originalFileName: String(fileName),
      userId: req.user.id,
      taskId: String(task._id),
      submissionId,
      userRole: req.user.role,
    });

    // Only the column names are logged — never the session URL.
    res.json({
      success: true,
      uploadToken,
      sessionUrl,            // SECRET: returned to this client only
      storedFileName,
      originalFileName: String(fileName),
      driveFolderName: folders.taskFolderName,
      maxFiles: MAX_FILES,
    });
  } catch (e) {
    console.error("[Upload] Init error:", e.message);
    const status = e.status || (e.code === "DRIVE_NOT_CONFIGURED" ? 503 : 500);
    res.status(status).json({ success: false, message: drive.driveErrorMessage(e, "Unable to start the upload") });
  }
});

/**
 * POST /api/tasks/uploads/finalize
 * Body: { uploadToken, driveFileId }
 *
 * The client-supplied file id is NEVER trusted: the file is re-read from the
 * Drive API and must (a) live in the folder this upload was staged into,
 * (b) carry appProperties matching this user + task, and (c) be within the
 * existing type/size rules.
 *
 * Idempotent: retrying with the same token returns the same result and can
 * never create a duplicate record.
 */
router.post("/finalize", authenticateToken, checkStudentRegistrationStatus, authorizeRoles("student", "member"), async (req, res) => {
  try {
    const db = req.db;
    const { uploadToken, driveFileId } = req.body || {};
    if (!uploadToken || !driveFileId) {
      return res.status(400).json({ success: false, message: "uploadToken and driveFileId are required" });
    }

    const staged = await db.collection(UPLOAD_COLLECTION).findOne({
      upload_token: String(uploadToken),
      user_id: req.user.id,          // a token is only usable by its owner
    });
    if (!staged) return res.status(404).json({ success: false, message: "Upload not found" });

    // Already verified → idempotent success (double-click / retry safe).
    if (staged.status === "verified" && staged.drive_file_id === String(driveFileId)) {
      return res.json({ success: true, duplicate: true, uploadToken: staged.upload_token, fileId: staged.drive_file_id, storedFileName: staged.stored_file_name });
    }
    if (staged.status === "linked") {
      return res.json({ success: true, duplicate: true, uploadToken: staged.upload_token, fileId: staged.drive_file_id });
    }

    const meta = await drive.getFileMetadata(String(driveFileId));
    if (meta.trashed) {
      await db.collection(UPLOAD_COLLECTION).updateOne({ upload_token: staged.upload_token }, { $set: { status: "failed", error: "trashed", updated_at: new Date().toISOString() } });
      return res.status(400).json({ success: false, message: "That upload is no longer available in Drive" });
    }

    // (a) must be in the folder we staged into
    if (!meta.parents.includes(staged.drive_folder_id)) {
      return res.status(400).json({ success: false, message: "Uploaded file is not in the expected folder" });
    }
    // (b) must have been created by THIS user's session for THIS task
    const props = meta.appProperties || {};
    if (props.techinsUserId !== String(staged.user_id) || props.techinsTaskId !== String(staged.task_id)) {
      return res.status(403).json({ success: false, message: "Uploaded file does not belong to this user or task" });
    }
    // (c) Drive-reported size/type must satisfy the existing rules
    const check = validateFileMeta(meta.name, meta.size);
    if (!check.ok) {
      await db.collection(UPLOAD_COLLECTION).updateOne({ upload_token: staged.upload_token }, { $set: { status: "failed", error: check.message, updated_at: new Date().toISOString() } });
      return res.status(400).json({ success: false, message: check.message });
    }

    // Unique index on drive_file_id makes this write safe under retries.
    await db.collection(UPLOAD_COLLECTION).updateOne(
      { upload_token: staged.upload_token },
      {
        $set: {
          status: "verified",
          drive_file_id: meta.id,
          drive_file_name: meta.name,
          actual_size: meta.size,
          actual_mime_type: meta.mimeType,
          updated_at: new Date().toISOString(),
        },
      }
    );

    await writeAudit(db, {
      actorId: req.user.id,
      action: "drive_upload_verified",
      entityType: "drive_upload",
      entityId: staged.upload_token,
      newValue: { task_id: staged.task_id, drive_folder_name: staged.drive_folder_name, size: meta.size },
    });

    res.json({
      success: true,
      uploadToken: staged.upload_token,
      fileId: meta.id,
      storedFileName: staged.stored_file_name,
      size: meta.size,
      mimeType: meta.mimeType,
    });
  } catch (e) {
    console.error("[Upload] Finalize error:", e.message);
    res.status(500).json({ success: false, message: drive.driveErrorMessage(e, "Unable to confirm the upload") });
  }
});

/**
 * DELETE /api/tasks/uploads/:uploadToken
 * Abandons a staged upload whose Drive transfer failed. The Drive file is
 * deleted ONLY because the app created it moments earlier and it was never
 * attached to a submission — this is not a user-facing delete feature.
 */
router.delete("/:uploadToken", authenticateToken, authorizeRoles("student", "member"), async (req, res) => {
  try {
    const db = req.db;
    const staged = await db.collection(UPLOAD_COLLECTION).findOne({
      upload_token: String(req.params.uploadToken),
      user_id: req.user.id,
    });
    if (!staged) return res.status(404).json({ success: false, message: "Upload not found" });
    if (staged.status === "linked") {
      return res.status(409).json({ success: false, message: "This upload is already attached to a submission" });
    }
    if (staged.drive_file_id) {
      try {
        await drive.getDrive().then(d => d.files.update({ fileId: staged.drive_file_id, supportsAllDrives: true, requestBody: { trashed: true } }));
      } catch (e) {
        console.warn("[Upload] Could not trash abandoned upload:", e.message);
      }
    }
    await db.collection(UPLOAD_COLLECTION).deleteOne({ upload_token: staged.upload_token });
    res.json({ success: true });
  } catch (e) {
    console.error("[Upload] Abandon error:", e.message);
    res.status(500).json({ success: false, message: "Unable to abandon the upload" });
  }
});

module.exports = router;
module.exports.UPLOAD_COLLECTION = UPLOAD_COLLECTION;
module.exports.authorizeTaskSubmission = authorizeTaskSubmission;