const express = require("express");
const { authenticateToken } = require("../middleware/authMiddleware");

const router = express.Router();

/* =========================================================
   GET NOTIFICATIONS
   GET /api/notifications
========================================================= */
router.get("/", authenticateToken, (req, res) => {
  try {
    const db = req.app.locals.db;
    
    const notifications = db.prepare(`
      SELECT 
        id,
        type,
        title,
        message,
        CASE WHEN read_at IS NOT NULL THEN 1 ELSE 0 END AS read,
        related_task_id,
        created_at
      FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(req.user.id);

    const unread = db.prepare(`
      SELECT COUNT(*) AS count
      FROM notifications
      WHERE user_id = ?
        AND read_at IS NULL
    `).get(req.user.id);

    res.json({
      success: true,
      notifications,
      unread: unread?.count || 0
    });
  } catch (error) {
    console.error("Notifications error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch notifications" });
  }
});

/* =========================================================
   MARK NOTIFICATION AS READ
   PATCH /api/notifications/:id/read
========================================================= */
router.patch("/:id/read", authenticateToken, (req, res) => {
  try {
    const db = req.app.locals.db;
    
    db.prepare(`
      UPDATE notifications
      SET read_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND user_id = ?
    `).run(Number(req.params.id), req.user.id);

    res.json({ success: true, message: "Notification marked as read" });
  } catch (error) {
    console.error("Mark read error:", error);
    res.status(500).json({ success: false, message: "Unable to update notification" });
  }
});

/* =========================================================
   MARK ALL NOTIFICATIONS AS READ
   POST /api/notifications/read-all
========================================================= */
router.post("/read-all", authenticateToken, (req, res) => {
  try {
    const db = req.app.locals.db;
    
    db.prepare(`
      UPDATE notifications
      SET read_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
        AND read_at IS NULL
    `).run(req.user.id);

    res.json({ success: true, message: "All notifications marked as read" });
  } catch (error) {
    console.error("Mark all read error:", error);
    res.status(500).json({ success: false, message: "Unable to update notifications" });
  }
});

module.exports = router;
