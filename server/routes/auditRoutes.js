const express = require("express");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const { ObjectId } = require("mongodb");
const router = express.Router();

function toId(id) { try { return new ObjectId(id); } catch { return id; } }

router.get("/", authenticateToken, authorizeRoles("ceo", "admin"), async (req, res) => {
  try {
    const db = req.db;

    // Parse pagination parameters
    const page = Math.max(1, Number(req.query?.page || 1));
    const limit = Math.min(Math.max(1, Number(req.query?.limit || 50)), 500);
    const skip = (page - 1) * limit;

    // Parse filter parameters (except role - we'll handle after enrichment)
    const filters = {};
    if (req.query?.action) filters.action = String(req.query.action);
    if (req.query?.search) {
      // Escape regex metacharacters: a raw value like "(" made MongoDB throw
      // (500) and a pathological value could be used for regex backtracking.
      const search = String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 100);
      filters.$or = [
        { action: { $regex: search, $options: "i" } },
        { entity_type: { $regex: search, $options: "i" } },
        { actor_email: { $regex: search, $options: "i" } },
        { actor_name: { $regex: search, $options: "i" } }
      ];
    }

    // Date range filters
    if (req.query?.startDate || req.query?.endDate) {
      filters.created_at = {};
      if (req.query.startDate) filters.created_at.$gte = String(req.query.startDate);
      if (req.query.endDate) filters.created_at.$lte = String(req.query.endDate);
    }

    // Fetch ALL logs first (for enrichment), then filter and paginate
    // This is necessary because we need to enrich with actor_role before filtering by role
    const allLogs = await db.collection("audit_logs")
      .find(filters)
      .sort({ created_at: -1 })
      .toArray();

    // Enrich logs with user information for backward compatibility
    // (old logs don't have actor_role, actor_email, actor_name fields)
    const enrichedLogs = await Promise.all(allLogs.map(async (log) => {
      let enriched = { ...log, id: String(log._id) };

      // If actor_role is missing, look it up from users collection
      if (!enriched.actor_role && enriched.actor_id) {
        try {
          const user = await db.collection("users").findOne(
            { _id: toId(enriched.actor_id) },
            { projection: { role: 1, email: 1, name: 1 } }
          );
          if (user) {
            enriched.actor_role = user.role;
            enriched.actor_email = enriched.actor_email || user.email;
            enriched.actor_name = enriched.actor_name || user.name;
          }
        } catch (e) {
          // Lookup failed, keep existing values
        }
      }

      // CEO logs have actor_id = "ceo", set role explicitly
      if (enriched.actor_id === "ceo" && !enriched.actor_role) {
        enriched.actor_role = "ceo";
        enriched.actor_email = enriched.actor_email || process.env.CEO_EMAIL;
        enriched.actor_name = enriched.actor_name || process.env.CEO_NAME || "TECHINS CEO";
      }

      return enriched;
    }));

    // Apply role filter after enrichment for backward compatibility
    let filteredLogs = enrichedLogs;
    if (req.query?.role) {
      const roleFilter = String(req.query.role);
      filteredLogs = enrichedLogs.filter(log => log.actor_role === roleFilter);
    }

    // Apply pagination after filtering
    const total = filteredLogs.length;
    const paginatedLogs = filteredLogs.slice(skip, skip + limit);

    res.json({
      success: true,
      logs: paginatedLogs,
      pagination: {
        page,
        limit,
        total, // Total count of filtered logs
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (e) {
    console.error("Audit logs error:", e);
    res.status(500).json({ success: false, message: "Unable to fetch audit logs" });
  }
});

module.exports = router;
