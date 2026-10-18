const express = require("express");
const { ObjectId } = require("mongodb");
const { authenticateToken, authorizeRoles, checkStudentRegistrationStatus } = require("../middleware/authMiddleware");
const { writeAudit } = require("../utils/audit_mongo");
const { notifyOnce } = require("../utils/notifications");
const { formatISTDeadlineLabel } = require("../utils/time");
const { studentCode, STUDENT_PROFILE_PROJECTION } = require("../utils/students");

const router = express.Router();
function toId(id) { try { return new ObjectId(id); } catch { return id; } }

const ok = (res, data, extra = {}) => res.json({ success: true, data, error: null, ...extra });
const fail = (res, status, code, message) =>
  res.status(status).json({ success: false, data: null, error: { code, message }, message });

/**
 * Scheduling.
 *
 * Missions now carry a real window — `start_at` and `end_at`, both stored as
 * UTC ISO dates — instead of a single `due_date`. `due_date` is kept and kept
 * in sync with `end_at` so older readers and the idempotent migration script
 * stay correct; nothing existing is lost.
 *
 * The admin form submits a local wall-clock date + time pair per bound. The
 * browser sends its IANA timezone and the offset it saw, so a mission created
 * in IST is stored as the same instant in UTC and renders back in IST for
 * everybody. The server is the authority: an explicit offset always wins over
 * anything derived here.
 */
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 4000;

/** Parse `{ date: "2026-10-18", time: "09:30", offset: "330" }` or an ISO string. */
function parseSchedule({ start_date, start_time, end_date, end_time, start_at, end_at, offset_minutes }, { which }) {
  const fromPair = (date, time) => {
    if (!date || !time) return { error: `MISSING_${which.toUpperCase()}_FIELDS`, message: `Provide both a ${which} date and a ${which} time.` };
    const [y, m, d] = String(date).split("-").map(Number);
    const [hh, mm] = String(time).split(":").map(Number);
    if (![y, m, d, hh, mm].every(Number.isFinite)) {
      return { error: `INVALID_${which.toUpperCase()}`, message: `The ${which} date or time is not a valid value.` };
    }
    if (d < 1 || d > 31 || hh > 23 || mm > 59) {
      return { error: `INVALID_${which.toUpperCase()}`, message: `The ${which} date or time is not a valid value.` };
    }
    // Minutes the admin's clock was ahead of UTC when the form was filled in.
    const offset = Number.isFinite(Number(offset_minutes)) ? Number(offset_minutes) : null;
    const asUtc = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
    if (!Number.isFinite(asUtc)) {
      return { error: `INVALID_${which.toUpperCase()}`, message: `The ${which} date or time is not a valid value.` };
    }
    return { iso: new Date(offset === null ? asUtc : asUtc - offset * 60000).toISOString() };
  };

  if (start_at !== undefined && start_at !== null && start_at !== "") {
    const parsed = new Date(start_at);
    if (Number.isNaN(parsed.getTime())) return { error: "INVALID_START", message: "The start date is not a valid value." };
    return { iso: parsed.toISOString() };
  }
  if (end_at !== undefined && end_at !== null && end_at !== "") {
    const parsed = new Date(end_at);
    if (Number.isNaN(parsed.getTime())) return { error: "INVALID_END", message: "The end date is not a valid value." };
    return { iso: parsed.toISOString() };
  }
  // Pick the pair for the bound actually being parsed. Returning the START pair
  // for both made every window collapse to a single instant and every schedule
  // look invalid.
  return which === "end" ? fromPair(end_date, end_time) : fromPair(start_date, start_time);
}

/**
 * Validate a schedule pair. Legacy missions have no `start_at`; when only an
 * end is supplied we place the start at the end minus one day so the window is
 * never inverted.
 */
function validateWindow(startIso, endIso) {
  if (!startIso || !endIso) {
    return { code: "MISSING_SCHEDULE", message: "A mission needs both a start and an end date and time." };
  }
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (end <= start) {
    return { code: "INVALID_WINDOW", message: "The end date and time must be after the start date and time." };
  }
  return null;
}

/** The fields a mission list row needs, with legacy `due_date` respected. */
function scheduleFields(m) {
  const start = m.start_at || null;
  const end = m.end_at || m.due_date || null;
  const now = Date.now();
  const startMs = start ? new Date(start).getTime() : null;
  const endMs = end ? new Date(end).getTime() : null;
  let scheduleStatus = "scheduled";
  if (m.status === "completed") scheduleStatus = "completed";
  else if (endMs !== null && endMs <= now) scheduleStatus = "overdue";
  else if (startMs !== null && startMs > now) scheduleStatus = "upcoming";
  else if (startMs !== null) scheduleStatus = "active";
  return { start_at: start, end_at: end, due_date: m.due_date || end, schedule_status: scheduleStatus };
}

/* GET /my - Student's own missions */
router.get("/my", authenticateToken, checkStudentRegistrationStatus, authorizeRoles("student", "member"), async (req, res) => {
  try {
    const db = req.db;
    const missions = await db.collection("missions").find({ assigned_to: req.user.id }).sort({ created_at: -1 }).toArray();
    const result = await Promise.all(missions.map(async m => {
      const assigner = await db.collection("users").findOne({ _id: toId(m.assigned_by) }, { projection: { name: 1 } });
      return { ...m, ...scheduleFields(m), id: String(m._id), assigned_by_name: assigner?.name };
    }));
    return res.json({ success: true, missions: result, data: { missions: result }, error: null });
  } catch (e) { return fail(res, 500, "MISSIONS_FETCH_FAILED", "Unable to fetch missions"); }
});

/* GET / - All missions (admin/manager/CEO) */
router.get("/", authenticateToken, authorizeRoles("ceo", "admin", "manager"), async (req, res) => {
  try {
    const db = req.db;
    const missions = await db.collection("missions").find({}).sort({ created_at: -1 }).toArray();

    const studentIds = [...new Set(missions.map(m => m.assigned_to).filter(Boolean).map(String))];
    const assignerIds = [...new Set(missions.map(m => m.assigned_by).filter(Boolean).map(String))];
    const batchIds = [...new Set(missions.map(m => m.batch_id).filter(Boolean).map(String))];
    const [students, assigners, batches] = await Promise.all([
      studentIds.length ? db.collection("users").find({ _id: { $in: studentIds.map(toId) } }, { projection: STUDENT_PROFILE_PROJECTION }).toArray() : [],
      assignerIds.length ? db.collection("users").find({ _id: { $in: assignerIds.map(toId) } }, { projection: { name: 1 } }).toArray() : [],
      batchIds.length ? db.collection("batches").find({ _id: { $in: batchIds.map(toId) } }, { projection: { name: 1 } }).toArray() : [],
    ]);
    const studentById = new Map(students.map(s => [String(s._id), s]));
    const assignerById = new Map(assigners.map(s => [String(s._id), s.name]));
    const batchById = new Map(batches.map(b => [String(b._id), b.name]));

    const result = missions.map(m => {
      const student = studentById.get(String(m.assigned_to));
      return {
        ...m,
        ...scheduleFields(m),
        id: String(m._id),
        student_name: student?.name || null,
        student_code: studentCode(student),
        batch_id: m.batch_id || null,
        batch_name: m.batch_id ? (batchById.get(String(m.batch_id)) || null) : null,
        assigned_by_name: assignerById.get(String(m.assigned_by)) || null,
      };
    });
    return res.json({ success: true, missions: result, data: { missions: result }, error: null });
  } catch (e) {
    console.error("List missions error:", e);
    return fail(res, 500, "MISSIONS_FETCH_FAILED", "Unable to fetch missions");
  }
});

router.post("/", authenticateToken, authorizeRoles("ceo", "admin", "manager"), async (req, res) => {
  try {
    const db = req.db;
    const body = req.body || {};
    const title = String(body.title || "").trim();
    if (!title) return fail(res, 400, "TITLE_REQUIRED", "Mission title is required.");
    if (title.length > TITLE_MAX) return fail(res, 400, "TITLE_TOO_LONG", `Mission title must be ${TITLE_MAX} characters or fewer.`);
    const description = String(body.description || "").trim();
    if (description.length > DESCRIPTION_MAX) return fail(res, 400, "DESCRIPTION_TOO_LONG", `Description must be ${DESCRIPTION_MAX} characters or fewer.`);

    const start = parseSchedule(body, { which: "start" });
    if (start.error) return fail(res, 400, start.error, start.message);
    const end = parseSchedule(body, { which: "end" });
    if (end.error) return fail(res, 400, end.error, end.message);
    // Legacy callers that only send `due_date` still work: the end is taken
    // from it and the start is placed one day earlier so the window is valid.
    let startIso = start.iso;
    let endIso = end.iso;
    if (body.start_at === undefined && !body.start_date && body.due_date && !body.end_at) {
      endIso = new Date(body.due_date).toISOString();
      startIso = new Date(new Date(endIso).getTime() - 86400000).toISOString();
    }
    const windowError = validateWindow(startIso, endIso);
    if (windowError) return fail(res, 400, windowError.code, windowError.message);

    const now = new Date().toISOString();
    const base = {
      title,
      description,
      assigned_by: req.user.id,
      status: "assigned",
      progress: 0,
      start_at: startIso,
      end_at: endIso,
      // Kept in sync so older readers and the export stay correct.
      due_date: endIso,
      completed_at: null,
      feedback: null,
      created_at: now,
      updated_at: now,
    };

    // Group/batch assignment: assign to all active students in the batch
    if (body.batch_id) {
      let batchOid;
      try { batchOid = new ObjectId(String(body.batch_id)); } catch { return fail(res, 400, "INVALID_BATCH", "Invalid batch id"); }
      const batch = await db.collection("batches").findOne({ _id: batchOid });
      if (!batch) return fail(res, 404, "BATCH_NOT_FOUND", "Batch not found");
      if (batch.active === false) return fail(res, 400, "BATCH_INACTIVE", "Batch is deactivated");

      const batchStudents = await db.collection("users")
        .find({ batch_id: String(batchOid), role: "student", active: 1 })
        .toArray();
      if (batchStudents.length === 0) return fail(res, 404, "BATCH_EMPTY", "No active students in this batch");

      // Check for existing assignments (prevent duplicates)
      const existingAssignments = await db.collection("missions")
        .find({ title, assigned_to: { $in: batchStudents.map(s => String(s._id)) } })
        .toArray();
      const existingStudentIds = new Set(existingAssignments.map(a => String(a.assigned_to)));
      const newStudents = batchStudents.filter(s => !existingStudentIds.has(String(s._id)));

      const missionDocs = newStudents.map(s => ({ ...base, assigned_to: String(s._id), batch_id: String(batchOid) }));
      let insertedCount = 0;
      if (missionDocs.length > 0) {
        const result = await db.collection("missions").insertMany(missionDocs);
        insertedCount = result.insertedCount;
      }
      await writeAudit(db, { actorId: req.user.id, action: "mission_created", entityType: "mission", entityId: `batch:${batchOid}`, newValue: { title, batch_id: String(batchOid), start_at: startIso, end_at: endIso, assigned_count: insertedCount } });

      return res.status(201).json({
        success: true,
        data: { assigned_count: insertedCount, skipped_count: existingStudentIds.size, total_in_batch: batchStudents.length, start_at: startIso, end_at: endIso },
        error: null,
        message: `Mission assigned to ${insertedCount} new student(s). ${existingStudentIds.size} already had this mission.`,
        assigned_count: insertedCount,
        skipped_count: existingStudentIds.size,
        total_in_batch: batchStudents.length,
      });
    }

    // Individual assignment
    if (!body.assigned_to) return fail(res, 400, "STUDENT_REQUIRED", "Title and student are required");
    const student = await db.collection("users").findOne({ _id: toId(body.assigned_to), role: "student", active: 1 });
    if (!student) return fail(res, 404, "STUDENT_NOT_FOUND", "Student not found");
    const result = await db.collection("missions").insertOne({ ...base, assigned_to: String(body.assigned_to), batch_id: student.batch_id ? String(student.batch_id) : null });
    await writeAudit(db, { actorId: req.user.id, action: "mission_created", entityType: "mission", entityId: String(result.insertedId), newValue: { title, start_at: startIso, end_at: endIso, assigned_to: String(body.assigned_to) } });
    return res.status(201).json({
      success: true,
      data: { missionId: String(result.insertedId), start_at: startIso, end_at: endIso },
      error: null,
      message: "Mission created successfully",
      missionId: String(result.insertedId),
    });
  } catch (e) {
    console.error("Create mission error:", e);
    return fail(res, 500, "MISSION_CREATE_FAILED", "Unable to create mission");
  }
});

router.patch("/:id/progress", authenticateToken, checkStudentRegistrationStatus, authorizeRoles("student", "member"), async (req, res) => {
  try {
    const db = req.db;
    const mission = await db.collection("missions").findOne({ _id: toId(req.params.id), assigned_to: req.user.id });
    if (!mission) return fail(res, 404, "MISSION_NOT_FOUND", "Mission not found");
    const progress = Math.min(100, Math.max(0, Number(req.body?.progress || 0)));
    await db.collection("missions").updateOne({ _id: mission._id }, { $set: { progress, status: progress >= 100 ? "completed" : "in_progress", completed_at: progress >= 100 ? new Date().toISOString() : null } });
    return res.json({ success: true, data: { progress }, error: null, message: "Progress updated" });
  } catch (e) { return fail(res, 500, "MISSION_PROGRESS_FAILED", "Unable to update progress"); }
});

router.put("/:id", authenticateToken, authorizeRoles("ceo", "admin", "manager"), async (req, res) => {
  try {
    const db = req.db;
    const mission = await db.collection("missions").findOne({ _id: toId(req.params.id) });
    if (!mission) return fail(res, 404, "MISSION_NOT_FOUND", "Mission not found");

    const body = req.body || {};
    const updates = {};
    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) return fail(res, 400, "TITLE_REQUIRED", "Mission title is required.");
      if (title.length > TITLE_MAX) return fail(res, 400, "TITLE_TOO_LONG", `Mission title must be ${TITLE_MAX} characters or fewer.`);
      updates.title = title;
    }
    if (body.description !== undefined) {
      const description = String(body.description).trim();
      if (description.length > DESCRIPTION_MAX) return fail(res, 400, "DESCRIPTION_TOO_LONG", `Description must be ${DESCRIPTION_MAX} characters or fewer.`);
      updates.description = description;
    }
    if (body.assigned_to !== undefined) updates.assigned_to = String(body.assigned_to);
    if (body.status !== undefined) updates.status = String(body.status);
    if (body.progress !== undefined) updates.progress = Math.min(100, Math.max(0, Number(body.progress)));
    if (body.feedback !== undefined) updates.feedback = String(body.feedback).trim();

    // Schedule edits are validated as a PAIR, so an edit can never leave the
    // mission with an end before its start.
    const wantsSchedule = body.start_at !== undefined || body.end_at !== undefined
      || body.start_date !== undefined || body.end_date !== undefined
      || body.start_time !== undefined || body.end_time !== undefined;
    let movedSchedule = false;
    if (wantsSchedule) {
      const start = parseSchedule(
        { start_at: body.start_at, end_at: body.end_at, start_date: body.start_date, start_time: body.start_time, offset_minutes: body.offset_minutes },
        { which: "start" },
      );
      if (start.error) return fail(res, 400, start.error, start.message);
      const end = parseSchedule(
        { end_at: body.end_at, start_at: body.start_at, end_date: body.end_date, end_time: body.end_time, offset_minutes: body.offset_minutes },
        { which: "end" },
      );
      if (end.error) return fail(res, 400, end.error, end.message);
      const windowError = validateWindow(start.iso, end.iso);
      if (windowError) return fail(res, 400, windowError.code, windowError.message);
      updates.start_at = start.iso;
      updates.end_at = end.iso;
      updates.due_date = end.iso;
      movedSchedule = start.iso !== mission.start_at || end.iso !== (mission.end_at || mission.due_date || null);
    } else if (body.due_date !== undefined) {
      updates.due_date = body.due_date;
    }

    if (!Object.keys(updates).length) return fail(res, 400, "NOTHING_TO_UPDATE", "Nothing to update.");
    updates.updated_at = new Date().toISOString();

    // Edit updates THIS mission — never creates a second one.
    await db.collection("missions").updateOne({ _id: mission._id }, { $set: updates });
    await writeAudit(db, {
      actorId: req.user.id,
      action: "mission_updated",
      entityType: "mission",
      entityId: String(mission._id),
      previousValue: { title: mission.title, start_at: mission.start_at || null, end_at: mission.end_at || mission.due_date || null },
      newValue: { title: updates.title ?? mission.title, start_at: updates.start_at ?? mission.start_at ?? null, end_at: updates.end_at ?? mission.end_at ?? mission.due_date ?? null },
    });

    // Students are notified only when the window ACTUALLY moved. `notifyOnce`
    // deduplicates on (user, type, mission, cycle) using the new window as the
    // cycle key, so repeated saves with the same schedule never re-notify.
    if (movedSchedule && updates.end_at) {
      const deadlineLabel = formatISTDeadlineLabel(updates.end_at);
      await notifyOnce(db, {
        userId: String(mission.assigned_to),
        type: "mission_rescheduled",
        title: "Mission schedule updated",
        message: `"${updates.title ?? mission.title}" now ends on ${deadlineLabel}.${updates.start_at ? ` It starts on ${formatISTDeadlineLabel(updates.start_at)}.` : ""}`,
        missionId: String(mission._id),
        // Same schedule ⇒ same cycle key ⇒ no duplicate notification.
        cycle: `${updates.start_at}|${updates.end_at}`,
        recipientRole: "student",
        actionUrl: "/student/missions",
      });
    }

    const updated = await db.collection("missions").findOne({ _id: mission._id });
    return res.json({
      success: true,
      data: { mission: { ...updated, ...scheduleFields(updated), id: String(updated._id) }, notified: movedSchedule },
      error: null,
      message: movedSchedule ? "Mission updated and affected students notified" : "Mission updated",
    });
  } catch (e) {
    console.error("Update mission error:", e);
    return fail(res, 500, "MISSION_UPDATE_FAILED", "Unable to update mission");
  }
});

router.delete("/:id", authenticateToken, authorizeRoles("ceo", "admin", "manager"), async (req, res) => {
  try {
    const db = req.db;
    const mission = await db.collection("missions").findOne({ _id: toId(req.params.id) });
    if (!mission) return fail(res, 404, "MISSION_NOT_FOUND", "Mission not found");
    await db.collection("missions").deleteOne({ _id: mission._id });
    await writeAudit(db, { actorId: req.user.id, action: "mission_deleted", entityType: "mission", entityId: String(mission._id), previousValue: { title: mission.title } });
    return res.json({ success: true, data: { id: String(mission._id) }, error: null, message: "Mission deleted" });
  } catch (e) { return fail(res, 500, "MISSION_DELETE_FAILED", "Unable to delete mission"); }
});

module.exports = router;