const express = require("express");
const { ObjectId } = require("mongodb");
const { authenticateToken } = require("../middleware/authMiddleware");

const router = express.Router();
function toId(id) { try { return new ObjectId(id); } catch { return id; } }

router.get("/", authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    
    // CEO has no user_id in database, query by email or return CEO-specific notifications
    let query;
    if (req.user.role === "ceo") {
      // CEO notifications are stored with CEO email as identifier or return all admin-level notifications
      query = { $or: [
        { user_id: "ceo" },
        { user_id: req.user.email || "ceo@techins.com" },
        { type: { $in: ["registration_pending", "submission_received", "task_outcome"] } }
      ]};
    } else {
      query = { user_id: req.user.id };
    }
    
    const notifications = await db.collection("notifications").find(query).sort({ created_at: -1 }).limit(50).toArray();
    const unread = await db.collection("notifications").countDocuments({ ...query, read_at: null });
    
    res.json({
      success: true,
      notifications: notifications.map(n => ({ ...n, id: String(n._id), read: n.read_at ? 1 : 0 })),
      unread
    });
  } catch (error) {
    console.error("Notifications error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch notifications" });
  }
});

router.patch("/:id/read", authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    
    // Build query based on role
    let query = { _id: toId(req.params.id) };
    if (req.user.role === "ceo") {
      // CEO can mark notifications with "ceo" or CEO email as user_id
      query.$or = [
        { user_id: "ceo" },
        { user_id: req.user.email || "ceo@techins.com" }
      ];
    } else {
      query.user_id = req.user.id;
    }
    
    await db.collection("notifications").updateOne(query, { $set: { read_at: new Date().toISOString() } });
    res.json({ success: true, message: "Notification marked as read" });
  } catch (error) {
    console.error("Mark read error:", error);
    res.status(500).json({ success: false, message: "Unable to update notification" });
  }
});

router.post("/read-all", authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    
    // Build query based on role
    let query = { read_at: null };
    if (req.user.role === "ceo") {
      query.$or = [
        { user_id: "ceo" },
        { user_id: req.user.email || "ceo@techins.com" },
        { type: { $in: ["registration_pending", "submission_received", "task_outcome"] } }
      ];
    } else {
      query.user_id = req.user.id;
    }
    
    await db.collection("notifications").updateMany(query, { $set: { read_at: new Date().toISOString() } });
    res.json({ success: true, message: "All notifications marked as read" });
  } catch (error) {
    console.error("Mark all read error:", error);
    res.status(500).json({ success: false, message: "Unable to update notifications" });
  }
});

module.exports = router;
