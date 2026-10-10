const express = require("express");
const { ObjectId } = require("mongodb");
const { authenticateToken, authorizeRoles, checkStudentRegistrationStatus } = require("../middleware/authMiddleware");

const router = express.Router();
function toId(id) { try { return new ObjectId(id); } catch { return id; } }

router.get("/", authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    // Students see only their own missions, managers/CEO see all
    let query = {};
    if (["student", "member"].includes(req.user.role)) {
      query = { assigned_to: req.user.id };
    }
    const missions = await db.collection("missions").find(query).sort({ created_at: -1 }).toArray();
    const result = await Promise.all(missions.map(async m => {
      const student = await db.collection("users").findOne({ _id: toId(m.assigned_to) }, { projection: { name: 1 } });
      const assigner = await db.collection("users").findOne({ _id: toId(m.assigned_by) }, { projection: { name: 1 } });
      return { ...m, id: String(m._id), student_name: student?.name, assigned_by_name: assigner?.name };
    }));
    res.json({ success: true, missions: result });
  } catch (e) { res.status(500).json({ success: false, message: "Unable to fetch missions" }); }
});

router.post("/", authenticateToken, authorizeRoles("ceo", "admin", "manager"), async (req, res) => {
  try {
    const db = req.db;
    const { title, description, assigned_to, due_date } = req.body || {};
    if (!title || !assigned_to) return res.status(400).json({ success: false, message: "Title and student are required" });
    const student = await db.collection("users").findOne({ _id: toId(assigned_to), role: "student", active: 1 });
    if (!student) return res.status(404).json({ success: false, message: "Student not found" });
    const result = await db.collection("missions").insertOne({
      title: String(title).trim(), description: String(description || "").trim(),
      assigned_to: String(assigned_to), assigned_by: req.user.id,
      status: "assigned", progress: 0, due_date: due_date || null,
      completed_at: null, feedback: null, created_at: new Date().toISOString()
    });
    res.status(201).json({ success: true, message: "Mission created successfully", missionId: String(result.insertedId) });
  } catch (e) { res.status(500).json({ success: false, message: "Unable to create mission" }); }
});

router.patch("/:id/progress", authenticateToken, checkStudentRegistrationStatus, authorizeRoles("student", "member"), async (req, res) => {
  try {
    const db = req.db;
    const mission = await db.collection("missions").findOne({ _id: toId(req.params.id), assigned_to: req.user.id });
    if (!mission) return res.status(404).json({ success: false, message: "Mission not found" });
    const progress = Math.min(100, Math.max(0, Number(req.body?.progress || 0)));
    await db.collection("missions").updateOne({ _id: mission._id }, { $set: { progress, status: progress >= 100 ? "completed" : "in_progress", completed_at: progress >= 100 ? new Date().toISOString() : null } });
    res.json({ success: true, message: "Progress updated" });
  } catch (e) { res.status(500).json({ success: false, message: "Unable to update progress" }); }
});

router.put("/:id", authenticateToken, authorizeRoles("ceo", "admin", "manager"), async (req, res) => {
  try {
    const db = req.db;
    const { title, description, assigned_to, due_date, status, progress, feedback } = req.body || {};
    const mission = await db.collection("missions").findOne({ _id: toId(req.params.id) });
    if (!mission) return res.status(404).json({ success: false, message: "Mission not found" });
    
    const updates = {};
    if (title !== undefined) updates.title = String(title).trim();
    if (description !== undefined) updates.description = String(description).trim();
    if (assigned_to !== undefined) updates.assigned_to = String(assigned_to);
    if (due_date !== undefined) updates.due_date = due_date;
    if (status !== undefined) updates.status = String(status);
    if (progress !== undefined) updates.progress = Math.min(100, Math.max(0, Number(progress)));
    if (feedback !== undefined) updates.feedback = String(feedback).trim();
    
    await db.collection("missions").updateOne({ _id: mission._id }, { $set: updates });
    res.json({ success: true, message: "Mission updated" });
  } catch (e) { res.status(500).json({ success: false, message: "Unable to update mission" }); }
});

router.delete("/:id", authenticateToken, authorizeRoles("ceo", "admin", "manager"), async (req, res) => {
  try {
    const db = req.db;
    const mission = await db.collection("missions").findOne({ _id: toId(req.params.id) });
    if (!mission) return res.status(404).json({ success: false, message: "Mission not found" });
    await db.collection("missions").deleteOne({ _id: mission._id });
    res.json({ success: true, message: "Mission deleted" });
  } catch (e) { res.status(500).json({ success: false, message: "Unable to delete mission" }); }
});

module.exports = router;
