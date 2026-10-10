const express = require("express");
const { ObjectId } = require("mongodb");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();
function toId(id) { try { return new ObjectId(id); } catch { return id; } }

router.get("/", authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    let query = {};
    if (["student", "member"].includes(req.user.role)) query = { assigned_to: req.user.id };
    const missions = await db.collection("missions").find(query).sort({ created_at: -1 }).toArray();
    const result = await Promise.all(missions.map(async m => {
      const student = await db.collection("users").findOne({ _id: toId(m.assigned_to) }, { projection: { name: 1 } });
      const assigner = await db.collection("users").findOne({ _id: toId(m.assigned_by) }, { projection: { name: 1 } });
      return { ...m, id: String(m._id), student_name: student?.name, assigned_by_name: assigner?.name };
    }));
    res.json({ success: true, missions: result });
  } catch (e) { res.status(500).json({ success: false, message: "Unable to fetch missions" }); }
});

router.post("/", authenticateToken, authorizeRoles("admin", "manager"), async (req, res) => {
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

router.patch("/:id/progress", authenticateToken, authorizeRoles("student", "member"), async (req, res) => {
  try {
    const db = req.db;
    const mission = await db.collection("missions").findOne({ _id: toId(req.params.id), assigned_to: req.user.id });
    if (!mission) return res.status(404).json({ success: false, message: "Mission not found" });
    const progress = Math.min(100, Math.max(0, Number(req.body?.progress || 0)));
    await db.collection("missions").updateOne({ _id: mission._id }, { $set: { progress, status: progress >= 100 ? "completed" : "in_progress", completed_at: progress >= 100 ? new Date().toISOString() : null } });
    res.json({ success: true, message: "Progress updated" });
  } catch (e) { res.status(500).json({ success: false, message: "Unable to update progress" }); }
});

module.exports = router;
