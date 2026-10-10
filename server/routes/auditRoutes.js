const express = require("express");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const router = express.Router();

router.get("/", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  try {
    const db = req.db;
    const limit = Math.min(Number(req.query?.limit || 100), 500);
    const logs = await db.collection("audit_logs").find({}).sort({ created_at: -1 }).limit(limit).toArray();
    res.json({ success: true, logs: logs.map(l => ({ ...l, id: String(l._id) })) });
  } catch (e) {
    res.status(500).json({ success: false, message: "Unable to fetch audit logs" });
  }
});

module.exports = router;
