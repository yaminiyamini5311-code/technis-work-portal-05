const express = require("express");
const { ObjectId } = require("mongodb");
const { authenticateToken } = require("../middleware/authMiddleware");

const router = express.Router();
function toId(id) { try { return new ObjectId(id); } catch { return id; } }

router.get("/", authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    const notifications = await db.collection("notifications").find(
      { user_id: req.user.id },
    ).sort({ created_at: -1 }).limit(50).toArray();
    const unread = await db.collection("notifications").countDocuments({ user_id: req.user.id, read_at: null });
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
    await db.collection("notifications").updateOne(
      { _id: toId(req.params.id), user_id: req.user.id },
      { $set: { read_at: new Date().toISOString() } }
    );
    res.json({ success: true, message: "Notification marked as read" });
  } catch (error) {
    console.error("Mark read error:", error);
    res.status(500).json({ success: false, message: "Unable to update notification" });
  }
});

router.post("/read-all", authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    await db.collection("notifications").updateMany(
      { user_id: req.user.id, read_at: null },
      { $set: { read_at: new Date().toISOString() } }
    );
    res.json({ success: true, message: "All notifications marked as read" });
  } catch (error) {
    console.error("Mark all read error:", error);
    res.status(500).json({ success: false, message: "Unable to update notifications" });
  }
});

module.exports = router;
