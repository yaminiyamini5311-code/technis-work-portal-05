const express = require("express");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const router = express.Router();

router.get("/", authenticateToken, authorizeRoles("ceo", "admin"), async (req, res) => {
  try {
    const db = req.db;
    
    // Parse pagination parameters
    const page = Math.max(1, Number(req.query?.page || 1));
    const limit = Math.min(Math.max(1, Number(req.query?.limit || 50)), 500);
    const skip = (page - 1) * limit;
    
    // Parse filter parameters
    const filters = {};
    if (req.query?.role) filters.actor_role = String(req.query.role);
    if (req.query?.action) filters.action = String(req.query.action);
    if (req.query?.search) {
      const search = String(req.query.search);
      filters.$or = [
        { action: { $regex: search, $options: "i" } },
        { entity_type: { $regex: search, $options: "i" } },
        { actor_email: { $regex: search, $options: "i" } }
      ];
    }
    
    // Date range filters
    if (req.query?.startDate || req.query?.endDate) {
      filters.created_at = {};
      if (req.query.startDate) filters.created_at.$gte = String(req.query.startDate);
      if (req.query.endDate) filters.created_at.$lte = String(req.query.endDate);
    }
    
    // Get total count for pagination
    const total = await db.collection("audit_logs").countDocuments(filters);
    
    // Fetch logs with pagination
    const logs = await db.collection("audit_logs")
      .find(filters)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();
    
    res.json({ 
      success: true, 
      logs: logs.map(l => ({ ...l, id: String(l._id) })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (e) {
    console.error("Audit logs error:", e);
    res.status(500).json({ success: false, message: "Unable to fetch audit logs" });
  }
});

module.exports = router;
