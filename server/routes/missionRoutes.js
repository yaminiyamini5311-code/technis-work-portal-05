const express = require("express");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

function getMissions(db, where = "", params = []) {
  return db.prepare(`
    SELECT m.*, u.name AS student_name, u.email AS student_email,
           creator.name AS assigned_by_name
    FROM missions m
    JOIN users u ON u.id = m.assigned_to
    LEFT JOIN users creator ON creator.id = m.assigned_by
    ${where}
    ORDER BY m.id DESC
  `).all(...params);
}

router.get("/my", authenticateToken, authorizeRoles("student", "member"), (req, res) => {
  res.json({ success: true, missions: getMissions(req.app.locals.db, "WHERE m.assigned_to = ?", [req.user.id]) });
});

router.get("/", authenticateToken, (req, res) => {
  const db = req.app.locals.db;
  if (["student", "member"].includes(req.user.role)) {
    return res.json({ success: true, missions: getMissions(db, "WHERE m.assigned_to = ?", [req.user.id]) });
  }
  const effectiveRole = req.user.role === "ceo" ? "admin" : req.user.role;
  if (!["admin", "manager"].includes(effectiveRole)) return res.status(403).json({ success: false, message: "Access denied" });
  res.json({ success: true, missions: getMissions(db) });
});

router.post("/", authenticateToken, authorizeRoles("admin", "ceo"), (req, res) => {
  try {
    const { title, description, assigned_to, due_date = null } = req.body || {};
    if (!String(title || "").trim() || !assigned_to) return res.status(400).json({ success: false, message: "Title and student are required" });
    const db = req.app.locals.db;
    const student = db.prepare("SELECT id FROM users WHERE id = ? AND LOWER(role) = 'student'").get(Number(assigned_to));
    if (!student) return res.status(404).json({ success: false, message: "Student not found" });
    const result = db.prepare(`INSERT INTO missions (title, description, assigned_to, assigned_by, status, progress, due_date) VALUES (?, ?, ?, ?, 'assigned', 0, ?)`).run(
      String(title).trim(), String(description || "").trim(), Number(assigned_to), req.user.id, due_date || null
    );
    res.status(201).json({ success: true, message: "Mission created successfully", missionId: result.lastInsertRowid });
  } catch (error) {
    console.error("Create mission error:", error);
    res.status(500).json({ success: false, message: "Unable to create mission" });
  }
});

router.put("/:id", authenticateToken, (req, res) => {
  const db = req.app.locals.db;
  const mission = db.prepare("SELECT * FROM missions WHERE id = ?").get(Number(req.params.id));
  if (!mission) return res.status(404).json({ success: false, message: "Mission not found" });

  const effectiveRole = req.user.role === "ceo" ? "admin" : req.user.role;
  const isAdmin = effectiveRole === "admin";
  const isOwner = ["student", "member"].includes(req.user.role) && mission.assigned_to === req.user.id;
  if (!isAdmin && !isOwner) return res.status(403).json({ success: false, message: "Access denied" });

  let progress = Number(req.body?.progress ?? mission.progress ?? 0);
  progress = Math.max(0, Math.min(100, Math.round(progress)));
  let status = String(req.body?.status || mission.status || "assigned").toLowerCase();
  if (progress >= 100) status = "completed";
  if (!['assigned', 'in_progress', 'completed'].includes(status)) status = "in_progress";

  db.prepare("UPDATE missions SET progress = ?, status = ?, feedback = ? WHERE id = ?").run(
    progress, status, req.body?.feedback ?? mission.feedback ?? null, Number(req.params.id)
  );
  res.json({ success: true, message: "Mission updated successfully" });
});

module.exports = router;
