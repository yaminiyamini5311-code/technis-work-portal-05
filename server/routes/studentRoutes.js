const express = require("express");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const { getStudentDashboard } = require("../utils/dashboard");

const router = express.Router();

router.get("/dashboard", authenticateToken, authorizeRoles("student", "member"), (req, res) => {
  const dashboard = getStudentDashboard(req.app.locals.db, req.user.id);
  if (!dashboard) return res.status(404).json({ success: false, message: "Student account not found" });
  res.json({ success: true, ...dashboard });
});

module.exports = router;
