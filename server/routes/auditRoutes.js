const express = require("express");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

/* =========================================================
   GET AUDIT LOGS
   GET /api/audit-logs
========================================================= */
router.get("/", authenticateToken, authorizeRoles("admin", "manager"), (req, res) => {
  try {
    const db = req.app.locals.db;
    
    const logs = db.prepare(`
      SELECT 
        a.id,
        a.actor_id,
        a.action,
        a.entity_type,
        a.entity_id,
        a.previous_value,
        a.new_value,
        a.metadata,
        a.created_at,
        u.name AS actor_name,
        u.email AS actor_email
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.actor_id
      ORDER BY a.created_at DESC
      LIMIT 500
    `).all();

    res.json({ success: true, logs });
  } catch (error) {
    console.error("Audit logs error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch audit logs" });
  }
});

module.exports = router;
