const express = require("express");
const { ObjectId } = require("mongodb");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const { MAX_STUDENT_ACCOUNTS } = require("../config");
const { writeAudit } = require("../utils/audit_mongo");
const { isActiveFlag, normalizeRegistrationStatus } = require("../utils/userAccount");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const router = express.Router();

// Same limits as the student avatar upload (JPEG/PNG/WebP, 2MB max).
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    const ok = allowed.includes(file.mimetype);
    cb(ok ? null : new Error("Only JPEG, PNG, and WebP images are allowed"), ok);
  }
});

function toId(id) { try { return new ObjectId(id); } catch { return id; } }
function fmt(doc) {
  if (!doc) return null;
  const d = { ...doc, id: String(doc._id) };
  delete d._id;
  return d;
}

/* ─── PROFILE (CEO / ADMIN) ────────────────────────────────────────────────
 * Mirrors GET/PUT /api/student/profile for the CEO Workspace.
 *
 * The CEO account is env-driven and has NO row in `users`
 * (ensureDefaultAccounts deletes any DB user matching CEO_EMAIL on every
 * boot, and signup refuses role=ceo). The JWT therefore carries the literal
 * id "ceo". Storing CEO profile fields on a users row would be deleted on the
 * next restart, so they are persisted in a dedicated `ceo_profile` document
 * keyed by the CEO email.
 *
 * Email and role are ALWAYS taken from the environment / token and are never
 * accepted from the request body, so they cannot be modified through this API.
 */
const CEO_PROFILE_ID = "ceo";

function ceoIdentity() {
  return {
    email: (process.env.CEO_EMAIL || "ceo@techins.com").trim().toLowerCase(),
    name: (process.env.CEO_NAME || "TECHINS CEO").trim(),
  };
}

// Avatars are stored in GridFS (Vercel's filesystem is read-only and
// ephemeral — the previous disk write failed on every production deploy).
// The CEO profile photo lives in the ceo_profile document; an admin's photo
// lives on its users row. Both are served only through authenticated
// endpoints (see GET /api/student/avatar/:id).
async function saveAvatarGridfs(db, buffer, filename, metadata = {}) {
  const { uploadAvatar } = require("../utils/fileStorage");
  return uploadAvatar(db, buffer, filename, metadata);
}

router.get("/profile", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const db = req.db;

    if (req.user.role === "ceo") {
      const identity = ceoIdentity();
      const saved = await db.collection("ceo_profile").findOne({ _id: CEO_PROFILE_ID });
      return res.json({
        success: true,
        user: {
          id: CEO_PROFILE_ID,
          // env name is the default; a saved name overrides it
          name: saved?.name || identity.name,
          phone: saved?.phone || "",
          avatar: saved?.avatar || null,
          avatar_gridfs_id: saved?.avatar_gridfs_id || null,
          email: identity.email,
          role: "ceo",
        },
      });
    }

    const user = await db.collection("users").findOne({ _id: toId(req.user.id) }, { projection: { password: 0 } });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    return res.json({ success: true, user: { ...user, id: String(user._id) } });
  } catch (e) {
    console.error("Fetch profile error:", e);
    return res.status(500).json({ success: false, message: "Unable to fetch profile" });
  }
});

router.put("/profile", authenticateToken, authorizeRoles("admin", "ceo"), avatarUpload.single("avatar"), async (req, res) => {
  try {
    const db = req.db;
    const { name, phone } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: "Name is required" });
    }

    let avatarGridfsId = null;
    if (req.file) {
      avatarGridfsId = await saveAvatarGridfs(db, req.file.buffer, req.file.originalname, {
        user_id: req.user.role === "ceo" ? "ceo" : req.user.id,
        mime_type: req.file.mimetype,
        size: req.file.size
      });
    }

    const cleanName = String(name).trim();
    const cleanPhone = phone ? String(phone).trim() : null;

    if (req.user.role === "ceo") {
      const identity = ceoIdentity();
      const update = { name: cleanName, phone: cleanPhone };
      if (avatarGridfsId) {
        update.avatar_gridfs_id = avatarGridfsId;
        update.avatar = null;
        const prev = await db.collection("ceo_profile").findOne({ _id: CEO_PROFILE_ID }, { projection: { avatar: 1, avatar_gridfs_id: 1 } });
        if (prev?.avatar) {
          try { fs.unlinkSync(path.join(__dirname, "..", prev.avatar)); } catch { /* already gone */ }
        }
        if (prev?.avatar_gridfs_id) {
          const { deleteAvatar } = require("../utils/fileStorage");
          deleteAvatar(db, prev.avatar_gridfs_id).catch(() => {});
        }
      }
      await db.collection("ceo_profile").updateOne(
        { _id: CEO_PROFILE_ID },
        { $set: update, $setOnInsert: { email: identity.email, created_at: new Date().toISOString() } },
        { upsert: true }
      );
      await writeAudit(db, { actorId: req.user.id, action: "ceo_profile_updated", entityType: "ceo_profile", entityId: CEO_PROFILE_ID, newValue: { name: cleanName } });
      return res.json({ success: true, message: "Profile updated successfully" });
    }
    const update = { name: cleanName, phone: cleanPhone };
    if (avatarGridfsId) {
      update.avatar_gridfs_id = avatarGridfsId;
      update.avatar = null;
      const prev = await db.collection("users").findOne({ _id: toId(req.user.id) }, { projection: { avatar: 1, avatar_gridfs_id: 1 } });
      if (prev?.avatar) {
        try { fs.unlinkSync(path.join(__dirname, "..", prev.avatar)); } catch { /* already gone */ }
      }
      if (prev?.avatar_gridfs_id) {
        const { deleteAvatar } = require("../utils/fileStorage");
        deleteAvatar(db, prev.avatar_gridfs_id).catch(() => {});
      }
    }
    await db.collection("users").updateOne({ _id: toId(req.user.id) }, { $set: update });
    return res.json({ success: true, message: "Profile updated successfully" });
  } catch (e) {
    console.error("Update profile error:", e);
    return res.status(500).json({ success: false, message: "Unable to update profile" });
  }
});

// Multer rejects a bad avatar in middleware, before the handler runs, so the
// error bypasses the try/catch above and would surface as a generic 500.
// Mounted directly after the profile routes so only they are affected.
router.use((err, req, res, next) => {
  if (!err) return next();
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ success: false, message: "File size must be less than 2MB" });
  }
  if (err.code === "LIMIT_UNEXPECTED_FILE" || /JPEG, PNG, and WebP/i.test(err.message || "")) {
    return res.status(400).json({ success: false, message: "Only JPEG, PNG, and WebP images are allowed" });
  }
  return next(err);
});

/* ─── STATS ─────────────────────────────────────────────────────────────── */
/**
 * Dashboard KPI Metrics
 * - Students: Active student accounts (role='student', active=1)
 * - Tasks: Total task records created
 * - Completed: Tasks with workflow_status='Approved' (admin approved final outcome)
 * - Pending: Tasks in 'Assigned' or 'Acknowledged' state (not yet started by student)
 * - Missions: Total mission records
 * - Today's Activity: Submissions made today (real student activity, not just daily_activity records)
 */
router.get("/stats", authenticateToken, authorizeRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const today = new Date().toISOString().slice(0, 10);

    const [students, tasks, missions, completedTasks, pendingTasks, inProgressTasks, submissionsToday] = await Promise.all([
      db.collection("users").countDocuments({ role: "student", active: 1 }),
      db.collection("tasks").countDocuments(),
      db.collection("missions").countDocuments(),
      db.collection("tasks").countDocuments({ workflow_status: "Approved" }),
      db.collection("tasks").countDocuments({ workflow_status: { $in: ["Assigned", "Acknowledged"] } }),
      db.collection("tasks").countDocuments({ workflow_status: { $in: ["In Progress", "Submitted", "Under Review", "Revision Required", "Resubmitted"] } }),
      // Today's Activity: Count submissions created today (student activity)
      db.collection("submissions").countDocuments({ 
        created_at: { $gte: `${today}T00:00:00.000Z`, $lt: `${today}T23:59:59.999Z` } 
      }),
    ]);

    // Keep activities field for potential future use, but use submissionsToday for the card
    const activities = 0; // Placeholder - daily_activities feature not currently used
    const activitiesToday = submissionsToday; // Real student activity = submissions today

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
/**
 * Student Completion Activity Chart
 * Shows submissions over time (student activity), not just admin approvals
 * Periods: week (7 days), month (30 days), year (365 days)
 * Groups by day for week/month, by month for year
 */
router.get("/progress", authenticateToken, authorizeRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const period = String(req.query?.period || "week").toLowerCase();
    
    let days, groupByMonth = false;
    if (period === "year") {
      days = 365;
      groupByMonth = true; // Group by month for year view
    } else if (period === "month") {
      days = 30;
    } else {
      days = 7; // week (default)
    }
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().slice(0, 10);

    // Get submissions (real student activity) instead of only approved tasks
    const submissions = await db.collection("submissions").find(
      { created_at: { $gte: startDateStr } },
      { projection: { created_at: 1 } }
    ).toArray();

    const grouped = {};
    
    for (const sub of submissions) {
      const timestamp = String(sub.created_at || "");
      if (!timestamp) continue;
      
      let key;
      if (groupByMonth) {
        // Group by month for year view: "2026-10"
        key = timestamp.slice(0, 7);
      } else {
        // Group by day for week/month: "2026-10-14"
        key = timestamp.slice(0, 10);
      }
      
      grouped[key] = (grouped[key] || 0) + 1;
    }
    
    // Fill in missing dates/months with 0 to show continuous timeline
    const filled = {};
    const current = new Date(startDateStr);
    const end = new Date();
    
    if (groupByMonth) {
      // Fill months
      while (current <= end) {
        const key = current.toISOString().slice(0, 7);
        filled[key] = grouped[key] || 0;
        current.setMonth(current.getMonth() + 1);
      }
    } else {
      // Fill days
      while (current <= end) {
        const key = current.toISOString().slice(0, 10);
        filled[key] = grouped[key] || 0;
        current.setDate(current.getDate() + 1);
      }
    }
    
    const progress = Object.entries(filled).sort().map(([date, count]) => ({ date, count }));

    res.json({ success: true, progress, period, days });
  } catch (error) {
    console.error("Admin progress error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch progress" });
  }
});

/* ─── GET STUDENTS (search, batch filter, pagination) ───── */
router.get("/students", authenticateToken, authorizeRoles("admin", "manager", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const search = String(req.query?.search || "").trim();
    const batch = String(req.query?.batch || "").trim();
    const includeInactive = String(req.query?.include_inactive || "") === "true";
    const page = Math.max(1, Number(req.query?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 25));

    const filter = { role: "student" };
    if (!includeInactive) filter.active = 1;
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: { $regex: escaped, $options: "i" } },
        { email: { $regex: escaped, $options: "i" } },
      ];
    }
    if (batch) {
      const { ObjectId: Oid } = require("mongodb");
      let batchOid;
      try { batchOid = new Oid(batch); } catch { batchOid = null; }
      if (!batchOid) return res.status(400).json({ success: false, message: "Invalid batch filter" });
      filter.batch_id = String(batchOid);
    }

    const [total, students] = await Promise.all([
      db.collection("users").countDocuments(filter),
      db.collection("users")
        .find(filter, { projection: { password: 0 } })
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
    ]);

    // Resolve batch names for display
    const batchIds = [...new Set(students.map(s => s.batch_id).filter(Boolean))];
    const batches = batchIds.length
      ? await db.collection("batches").find({ _id: { $in: batchIds.map(id => { try { return toId(id); } catch { return id; } }) } }, { projection: { name: 1, active: 1 } }).toArray()
      : [];
    const batchById = new Map(batches.map(b => [String(b._id), b]));

    const activeCount = await db.collection("users").countDocuments({ role: "student", active: 1 });

    res.json({
      success: true,
      students: students.map(s => {
        const d = fmt(s);
        d.batch = s.batch_id && batchById.has(String(s.batch_id))
          ? { id: String(s.batch_id), name: batchById.get(String(s.batch_id)).name, active: batchById.get(String(s.batch_id)).active !== false }
          : null;
        return d;
      }),
      total,
      active_total: activeCount,
      limit: MAX_STUDENT_ACCOUNTS,
      page,
      page_size: limit,
      total_pages: Math.ceil(total / limit) || 1,
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
    const { name, email, password, department, program, batchId } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "Name, email, and password are required" });
    }
    if (department && program) {
      return res.status(400).json({ success: false, message: "Cannot select both Department and Program. Choose one." });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    // Batch validation — never trust the client
    let batchRecord = null;
    if (batchId) {
      const { ObjectId: Oid } = require("mongodb");
      let batchOid;
      try { batchOid = new Oid(String(batchId).trim()); } catch { batchOid = null; }
      if (!batchOid) return res.status(400).json({ success: false, message: "Invalid batch id" });
      batchRecord = await db.collection("batches").findOne({ _id: batchOid });
      if (!batchRecord) return res.status(404).json({ success: false, message: "Batch not found" });
      if (batchRecord.active === false) return res.status(400).json({ success: false, message: "Batch is deactivated" });
    }

    const existing = await db.collection("users").findOne({ email: cleanEmail });
    if (existing) return res.status(409).json({ success: false, message: "Email already exists" });

    const studentCount = await db.collection("users").countDocuments({ role: "student", active: 1 });
    if (studentCount >= MAX_STUDENT_ACCOUNTS) {
      return res.status(409).json({ success: false, message: `Student limit reached (${MAX_STUDENT_ACCOUNTS}). Cannot create more student accounts.` });
    }

    const hashedPassword = await bcrypt.hash(String(password), 12);
    const result = await db.collection("users").insertOne({
      name: String(name).trim(),
      email: cleanEmail,
      password: hashedPassword,
      role: "student",
      department: department ? String(department).trim().toLowerCase() : null,
      program: program ? String(program).trim().toLowerCase() : (batchRecord ? String(batchRecord.name) : null),
      batch_id: batchRecord ? String(batchRecord._id) : null,
      active: 1,
      registration_status: "approved",
      created_at: new Date().toISOString()
    });

    // New batch member: materialize assignments for the batch's active tasks
    if (batchRecord) {
      const { createAssignmentsForStudent } = require("../models/TaskAssignment");
      await createAssignmentsForStudent(db, String(result.insertedId), String(batchRecord._id));
    }

    const created = await db.collection("users").findOne({ _id: result.insertedId }, { projection: { password: 0 } });
    res.status(201).json({ success: true, message: "Student created successfully", studentId: String(result.insertedId), student: fmt(created) });
  } catch (error) {
    console.error("Create student error:", error);
    if (error.code === 11000) return res.status(409).json({ success: false, message: "Email already exists" });
    res.status(500).json({ success: false, message: "Unable to create student" });
  }
});

/* ─── EDIT STUDENT ──────────────────────────────────────────────── */
router.put("/students/:id", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const userId = toId(req.params.id);
    if (!userId) return res.status(400).json({ success: false, message: "Invalid student id" });
    const user = await db.collection("users").findOne({ _id: userId });
    if (!user) return res.status(404).json({ success: false, message: "Student not found" });

    const { name, email, phone, department } = req.body || {};
    const updates = {};
    if (name !== undefined) {
      const cleanName = String(name).trim();
      if (!cleanName) return res.status(400).json({ success: false, message: "Name cannot be empty" });
      updates.name = cleanName;
    }
    if (email !== undefined) {
      const cleanEmail = String(email).trim().toLowerCase();
      if (!cleanEmail) return res.status(400).json({ success: false, message: "Email cannot be empty" });
      const clash = await db.collection("users").findOne({ email: cleanEmail, _id: { $ne: userId } });
      if (clash) return res.status(409).json({ success: false, message: "Another account already uses this email" });
      updates.email = cleanEmail;
    }
    if (phone !== undefined) updates.phone = String(phone).trim() || null;
    if (department !== undefined) updates.department = String(department).trim().toLowerCase() || null;

    if (!Object.keys(updates).length) {
      return res.status(400).json({ success: false, message: "Nothing to update" });
    }

    updates.updated_at = new Date().toISOString();
    await db.collection("users").updateOne({ _id: userId }, { $set: updates });
    await writeAudit(db, { actorId: req.user.id, action: "student_updated", entityType: "user", entityId: String(userId), previousValue: { name: user.name, email: user.email, phone: user.phone, department: user.department }, newValue: updates });

    const updated = await db.collection("users").findOne({ _id: userId }, { projection: { password: 0 } });
    res.json({ success: true, message: "Student updated", student: fmt(updated) });
  } catch (error) {
    console.error("Edit student error:", error);
    if (error.code === 11000) return res.status(409).json({ success: false, message: "Another account already uses this email" });
    res.status(500).json({ success: false, message: "Unable to update student" });
  }
});

/* ─── CHANGE STUDENT BATCH ──────────────────────────────────── */
router.patch("/students/:id/batch", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const userId = toId(req.params.id);
    if (!userId) return res.status(400).json({ success: false, message: "Invalid student id" });
    const user = await db.collection("users").findOne({ _id: userId });
    if (!user || user.role !== "student") return res.status(404).json({ success: false, message: "Student not found" });

    const batchId = req.body?.batchId ? String(req.body.batchId).trim() : null;
    if (!batchId) return res.status(400).json({ success: false, message: "batchId is required" });

    const { ObjectId: Oid } = require("mongodb");
    let batchOid;
    try { batchOid = new Oid(batchId); } catch { batchOid = null; }
    if (!batchOid) return res.status(400).json({ success: false, message: "Invalid batch id" });

    const batch = await db.collection("batches").findOne({ _id: batchOid });
    if (!batch) return res.status(404).json({ success: false, message: "Batch not found" });
    if (batch.active === false) return res.status(400).json({ success: false, message: "Batch is deactivated" });

    const previousBatchId = user.batch_id ? String(user.batch_id) : null;
    if (previousBatchId === String(batch._id)) {
      return res.json({ success: true, message: "Student is already in this batch" });
    }

    // Move the student. Historical submissions and task
    // history are kept: existing assignments stay with
    // their original tasks.
    await db.collection("users").updateOne(
      { _id: userId },
      { $set: { batch_id: String(batch._id), program: String(batch.name), updated_at: new Date().toISOString() } }
    );

    // Materialize assignments for the new batch's active tasks
    const { createAssignmentsForStudent } = require("../models/TaskAssignment");
    await createAssignmentsForStudent(db, String(userId), String(batch._id));

    await writeAudit(db, { actorId: req.user.id, action: "student_batch_changed", entityType: "user", entityId: String(userId), previousValue: { batch_id: previousBatchId }, newValue: { batch_id: String(batch._id), batch_name: batch.name } });

    const updated = await db.collection("users").findOne({ _id: userId }, { projection: { password: 0 } });
    res.json({ success: true, message: `Student moved to ${batch.name}`, student: fmt(updated) });
  } catch (error) {
    console.error("Change batch error:", error);
    res.status(500).json({ success: false, message: "Unable to change student batch" });
  }
});

/* ─── REMOVE STUDENT FROM BATCH ───────────────────────────── */
router.patch("/students/:id/remove-batch", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const userId = toId(req.params.id);
    if (!userId) return res.status(400).json({ success: false, message: "Invalid student id" });
    const user = await db.collection("users").findOne({ _id: userId });
    if (!user || user.role !== "student") return res.status(404).json({ success: false, message: "Student not found" });
    if (!user.batch_id) {
      return res.json({ success: true, message: "Student is not in a batch" });
    }

    const previousBatchId = String(user.batch_id);
    // Soft removal only: batch_id cleared, all history and
    // existing assignments (and their submissions) preserved.
    await db.collection("users").updateOne(
      { _id: userId },
      { $set: { batch_id: null, updated_at: new Date().toISOString() } }
    );

    await writeAudit(db, { actorId: req.user.id, action: "student_batch_removed", entityType: "user", entityId: String(userId), previousValue: { batch_id: previousBatchId }, newValue: { batch_id: null } });

    const updated = await db.collection("users").findOne({ _id: userId }, { projection: { password: 0 } });
    res.json({ success: true, message: "Student removed from batch", student: fmt(updated) });
  } catch (error) {
    console.error("Remove batch error:", error);
    res.status(500).json({ success: false, message: "Unable to remove student from batch" });
  }
});

/* ─── DEACTIVATE STUDENT ──────────────────────────────────── */
router.patch("/students/:id/deactivate", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const userId = toId(req.params.id);
    if (!userId) return res.status(400).json({ success: false, message: "Invalid student id" });
    const user = await db.collection("users").findOne({ _id: userId });
    if (!user) return res.status(404).json({ success: false, message: "Student not found" });
    if (!isActiveFlag(user.active)) {
      return res.json({ success: true, message: "Student is already deactivated" });
    }
    await db.collection("users").updateOne(
      { _id: userId },
      { $set: { active: 0, updated_at: new Date().toISOString() } }
    );
    await writeAudit(db, { actorId: req.user.id, action: "student_deactivated", entityType: "user", entityId: String(userId), previousValue: { active: 1 }, newValue: { active: 0 } });
    const updated = await db.collection("users").findOne({ _id: userId }, { projection: { password: 0 } });
    res.json({ success: true, message: "Student deactivated", student: fmt(updated) });
  } catch (error) {
    console.error("Deactivate student error:", error);
    res.status(500).json({ success: false, message: "Unable to deactivate student" });
  }
});

/* ─── REACTIVATE STUDENT ──────────────────────────────────── */
router.patch("/students/:id/reactivate", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const userId = toId(req.params.id);
    if (!userId) return res.status(400).json({ success: false, message: "Invalid student id" });
    const user = await db.collection("users").findOne({ _id: userId });
    if (!user) return res.status(404).json({ success: false, message: "Student not found" });
    if (isActiveFlag(user.active)) {
      return res.json({ success: true, message: "Student is already active" });
    }
    await db.collection("users").updateOne(
      { _id: userId },
      { $set: { active: 1, updated_at: new Date().toISOString() } }
    );
    await writeAudit(db, { actorId: req.user.id, action: "student_reactivated", entityType: "user", entityId: String(userId), previousValue: { active: 0 }, newValue: { active: 1 } });
    const updated = await db.collection("users").findOne({ _id: userId }, { projection: { password: 0 } });
    res.json({ success: true, message: "Student reactivated", student: fmt(updated) });
  } catch (error) {
    console.error("Reactivate student error:", error);
    res.status(500).json({ success: false, message: "Unable to reactivate student" });
  }
});

/* ─── DELETE STUDENT (guarded) ──────────────────────────────
 * Hard delete is BLOCKED while related records exist (tasks,
 * submissions, assignments, activities, missions). Deactivate
 * instead — soft delete preserves all history.
 */
router.delete("/students/:id", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const userId = toId(req.params.id);
    if (!userId) return res.status(400).json({ success: false, message: "Invalid student id" });
    const user = await db.collection("users").findOne({ _id: userId });
    if (!user) return res.status(404).json({ success: false, message: "Student not found" });

    const related = {
      tasks: await db.collection("tasks").countDocuments({ $or: [{ assigned_to: String(userId) }, { assigned_by: String(userId) }] }),
      submissions: await db.collection("submissions").countDocuments({ student_id: String(userId) }),
      assignments: await db.collection("task_assignments").countDocuments({ student_id: String(userId) }),
      daily_activities: await db.collection("daily_activities").countDocuments({ user_id: String(userId) }),
      missions: await db.collection("missions").countDocuments({ assigned_to: String(userId) }),
      notifications: await db.collection("notifications").countDocuments({ user_id: String(userId) }),
    };
    const hasRelated = Object.values(related).some(n => n > 0);
    if (hasRelated) {
      return res.status(409).json({
        success: false,
        message: "Cannot delete: student has related records. Deactivate the account instead to preserve history.",
        related,
      });
    }

    await db.collection("users").deleteOne({ _id: userId });
    await writeAudit(db, { actorId: req.user.id, action: "student_deleted", entityType: "user", entityId: String(userId), previousValue: { name: user.name, email: user.email } });
    res.json({ success: true, message: "Student deleted" });
  } catch (error) {
    console.error("Delete student error:", error);
    res.status(500).json({ success: false, message: "Unable to delete student" });
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
    const userId = toId(req.params.id); // ObjectId — a raw string never matches the _id field
    const user = await db.collection("users").findOne({ _id: userId });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (isActiveFlag(user.active) && normalizeRegistrationStatus(user.registration_status) !== "pending") {
      return res.status(400).json({ success: false, message: "User is already active" });
    }

    // Approval grants BOTH signals (active + registration_status) so the
    // login gate and the approval workflow can never drift apart again.
    // approve-registration/:id is the student-specific variant; this route
    // also covers manager/admin activation.
    const update = { active: 1, updated_at: new Date().toISOString() };
    if (user.role === "student" || user.role === "manager") update.registration_status = "approved";
    await db.collection("users").updateOne({ _id: userId }, { $set: update });
    await writeAudit(db, { actorId: req.user.id, action: "user_approved", entityType: "user", entityId: String(userId), newValue: { name: user.name, email: user.email, role: user.role, active: 1 } });

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

router.post("/feedback", authenticateToken, authorizeRoles("admin", "manager", "ceo"), async (req, res) => {
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
    const roleFilter = req.query?.role ? String(req.query.role).toLowerCase() : "student";
    const role = ["student", "manager", "all"].includes(roleFilter) ? roleFilter : "student";
    const filter = { registration_status: "pending" };
    if (role !== "all") filter.role = role;
    const pending = await db.collection("users").find(filter, { projection: { password: 0 } }).sort({ created_at: -1 }).toArray();
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

    // Approval grants BOTH signals so the login gate and the approval
    // workflow can never drift apart again.
    await db.collection("users").updateOne(
      { _id: toId(userId) },
      { $set: { registration_status: "approved", active: 1 } }
    );

    // Mark related notifications as read (email escaped: "+" or "." in an
    // address would otherwise make the regex throw or over-match)
    const emailPattern = user.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await db.collection("notifications").updateMany(
      { type: "registration_pending", message: { $regex: emailPattern }, read_at: null },
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

    await db.collection("users").updateOne(
      { _id: toId(userId) },
      { $set: { registration_status: "rejected", active: 0 } }
    );

    const emailPattern = user.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await db.collection("notifications").updateMany(
      { type: "registration_pending", message: { $regex: emailPattern }, read_at: null },
      { $set: { read_at: new Date().toISOString() } }
    );

    await writeAudit(db, { actorId: req.user.id, action: "registration_rejected", entityType: "user", entityId: userId, newValue: { name: user.name, email: user.email, registration_status: "rejected" } });
    res.json({ success: true, message: "Student registration rejected" });
  } catch (error) {
    console.error("Reject registration error:", error);
    res.status(500).json({ success: false, message: "Unable to reject registration" });
  }
});


/* ─── PENDING MANAGERS ───────────────────────────────────────────────── */
router.get("/pending-managers", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const pending = await db.collection("users").find(
      { role: "manager", registration_status: "pending" },
      { projection: { password: 0 } }
    ).sort({ created_at: -1 }).toArray();
    res.json({ success: true, pending: pending.map(fmt) });
  } catch (error) {
    console.error("Pending managers error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch pending managers" });
  }
});

/* aliases */
router.get("/pending-manager-registrations", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res, next) => {
  req.url = "/pending-managers";
  // delegate by re-running? Simpler: fetch directly below.
  try {
    const db = req.db;
    const pending = await db.collection("users").find({ role: "manager", registration_status: "pending" }, { projection: { password: 0 } }).sort({ created_at: -1 }).toArray();
    res.json({ success: true, pending: pending.map(fmt) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to fetch pending managers" });
  }
});

/* ─── APPROVE MANAGER ─────────────────────────────────────────────────── */
router.post("/approve-manager/:id", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const userId = req.params.id;
    const user = await db.collection("users").findOne({ _id: toId(userId) });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (user.role !== "manager") return res.status(400).json({ success: false, message: "Only manager registrations can be approved here" });
    await db.collection("users").updateOne({ _id: toId(userId) }, { $set: { registration_status: "approved", active: 1, updated_at: new Date().toISOString() } });
    res.json({ success: true, message: "Manager approved successfully" });
  } catch (error) {
    console.error("Approve manager error:", error);
    res.status(500).json({ success: false, message: "Unable to approve manager" });
  }
});

/* aliases for approve manager */
router.post("/approve-manager-registration/:id", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const userId = req.params.id;
    const user = await db.collection("users").findOne({ _id: toId(userId) });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    await db.collection("users").updateOne({ _id: toId(userId) }, { $set: { registration_status: "approved", active: 1, updated_at: new Date().toISOString() } });
    res.json({ success: true, message: "Manager approved successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to approve manager" });
  }
});

/* ─── REJECT MANAGER ──────────────────────────────────────────────────── */
router.post("/reject-manager/:id", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const userId = req.params.id;
    const user = await db.collection("users").findOne({ _id: toId(userId) });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    await db.collection("users").updateOne({ _id: toId(userId) }, { $set: { registration_status: "rejected", active: 0, updated_at: new Date().toISOString() } });
    res.json({ success: true, message: "Manager rejected successfully" });
  } catch (error) {
    console.error("Reject manager error:", error);
    res.status(500).json({ success: false, message: "Unable to reject manager" });
  }
});

router.post("/reject-manager-registration/:id", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const userId = req.params.id;
    await db.collection("users").updateOne({ _id: toId(userId) }, { $set: { registration_status: "rejected", active: 0, updated_at: new Date().toISOString() } });
    res.json({ success: true, message: "Manager rejected successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to reject manager" });
  }
});


/* ─── GOOGLE DRIVE HEALTH ────────────────────────────────────────────── */
router.get("/drive/verify", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const { verifyRootAccess, authType } = require("../utils/driveStorage");
    const result = await verifyRootAccess();
    res.json({ success: result.ok, authType: authType(), ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/drive/reconcile", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const orphans = await db.collection("drive_orphans").find({}).limit(100).toArray();
    let reconciled = 0;
    for (const o of orphans) {
      const exists = await db.collection("submission_files").findOne({ drive_file_id: o.drive_file_id });
      if (exists) {
        await db.collection("drive_orphans").deleteOne({ _id: o._id });
        reconciled++;
      }
    }
    res.json({ success: true, checked: orphans.length, reconciled });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
module.exports = router;
