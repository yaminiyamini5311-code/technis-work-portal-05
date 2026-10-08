const express = require("express");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

/* =========================================================
   GET AUDIT LOGS
   GET /api/audit-logs
   Query params: role, action, search, startDate, endDate, page, limit
========================================================= */
router.get("/", authenticateToken, authorizeRoles("admin", "manager", "ceo"), (req, res) => {
  try {
    const db = req.app.locals.db;
    
    // Parse query parameters
    const roleFilter = req.query.role ? String(req.query.role).toLowerCase() : null;
    const actionFilter = req.query.action ? String(req.query.action) : null;
    const searchQuery = req.query.search ? String(req.query.search).toLowerCase() : null;
    const startDate = req.query.startDate || null;
    const endDate = req.query.endDate || null;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(10, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    
    // Build WHERE clause dynamically
    const conditions = [];
    const params = [];
    
    if (roleFilter && roleFilter !== 'all') {
      conditions.push('LOWER(u.role) = ?');
      params.push(roleFilter);
    }
    
    if (actionFilter) {
      conditions.push('a.action = ?');
      params.push(actionFilter);
    }
    
    if (searchQuery) {
      conditions.push('(LOWER(u.name) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(a.action) LIKE ? OR LOWER(a.entity_type) LIKE ?)');
      const searchPattern = `%${searchQuery}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }
    
    if (startDate) {
      conditions.push('a.created_at >= ?');
      params.push(startDate);
    }
    
    if (endDate) {
      conditions.push('a.created_at <= ?');
      params.push(endDate);
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.actor_id
      ${whereClause}
    `;
    const { total } = db.prepare(countQuery).get(...params);
    
    // Get paginated logs
    const logsQuery = `
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
        u.email AS actor_email,
        u.role AS actor_role
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.actor_id
      ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `;
    const logs = db.prepare(logsQuery).all(...params, limit, offset);

    res.json({ 
      success: true, 
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("Audit logs error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch audit logs" });
  }
});

module.exports = router;
