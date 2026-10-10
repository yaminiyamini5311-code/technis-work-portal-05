const express = require("express");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", authenticateToken, authorizeRoles("ceo", "admin", "manager"), async (req, res) => {
  try {
    const db = req.db;
    const students = await db.collection("users").find(
      { role: "student", active: 1 },
      { projection: { password: 0 } }
    ).sort({ name: 1 }).toArray();
    res.json({ success: true, students: students.map(s => ({ ...s, id: String(s._id) })) });
  } catch (error) {
    console.error("Students list error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch students" });
  }
});

module.exports = router;
