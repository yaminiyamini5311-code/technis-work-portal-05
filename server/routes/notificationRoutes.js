const express = require("express");
const { ObjectId } = require("mongodb");
const { authenticateToken } = require("../middleware/authMiddleware");

const router = express.Router();
function toId(id) { try { return new ObjectId(id); } catch { return id; } }

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Build the query that scopes notifications to the caller.
 *
 * The CEO has no user document (their identity is env-based), so their bell
 * shows the workspace-wide stream; everyone else only ever sees rows addressed
 * to their own user id. This is the IDOR boundary for notifications.
 */
function queryForUser(req, extra = {}) {
  const role = String(req.user.role || "").toLowerCase();
  if (role === "ceo") {
    return {
      $or: [
        { user_id: "ceo" },
        { user_id: req.user.email || "ceo@techins.com" },
        { type: { $in: ["registration_pending", "submission_received", "task_outcome"] } },
      ],
      ...extra,
    };
  }
  return { user_id: req.user.id, ...extra };
}

/**
 * One serializer for both the new `data.notifications` array and the legacy
 * top-level `notifications` array, so the explicit field names (task_id,
 * submission_id, deep_link) are present either way.
 */
function serialize(n) {
  return {
    ...n,
    id: String(n._id),
    read: n.read_at ? 1 : 0,
    // `related_task_id` is the historical field name and stays on the document.
    task_id: n.task_id || n.related_task_id || null,
    deep_link: n.action_url || null,
  };
}

router.get("/", authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    const query = queryForUser(req);
    const notifications = await db.collection("notifications")
      .find(query)
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();
    const unread = await db.collection("notifications").countDocuments({ ...query, read_at: null });

    const rows = notifications.map(serialize);
    res.json({
      success: true,
      data: { notifications: rows, unread },
      error: null,
      notifications: rows,
      unread,
    });
  } catch (error) {
    console.error("Notifications error:", error);
    res.status(500).json({
      success: false,
      data: null,
      error: { code: "NOTIFICATIONS_FAILED", message: "Unable to fetch notifications" },
      message: "Unable to fetch notifications",
    });
  }
});

router.patch("/:id/read", authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    // Ownership is part of the filter: a user can only mark their OWN
    // notification as read, never another user's.
    const query = queryForUser(req, { _id: toId(req.params.id) });
    const result = await db.collection("notifications").updateOne(query, { $set: { read_at: new Date().toISOString() } });
    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        data: null,
        error: { code: "NOTIFICATION_NOT_FOUND", message: "Notification not found" },
        message: "Notification not found",
      });
    }
    res.json({ success: true, data: { id: String(req.params.id), read: true }, error: null, message: "Notification marked as read" });
  } catch (error) {
    console.error("Mark read error:", error);
    res.status(500).json({ success: false, data: null, error: { code: "MARK_READ_FAILED", message: "Unable to update notification" }, message: "Unable to update notification" });
  }
});

router.post("/read-all", authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    const query = queryForUser(req, { read_at: null });
    const result = await db.collection("notifications").updateMany(query, { $set: { read_at: new Date().toISOString() } });
    res.json({
      success: true,
      data: { updated: result.modifiedCount || 0 },
      error: null,
      message: "All notifications marked as read",
    });
  } catch (error) {
    console.error("Mark all read error:", error);
    res.status(500).json({ success: false, data: null, error: { code: "MARK_ALL_READ_FAILED", message: "Unable to update notifications" }, message: "Unable to update notifications" });
  }
});

module.exports = router;