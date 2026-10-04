const express = require("express");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

/* =========================================================
   GET STUDENTS LIST
   GET /api/students
   
   For admin/manager: returns all students
   For students: returns all students (for peer reference)
========================================================= */
router.get("/", authenticateToken, (req, res) => {
  try {
    const db = req.app.locals.db;
    
    const students = db.prepare(`
      SELECT 
        id,
        name,
        email,
        department,
        created_at
      FROM users
      WHERE LOWER(role) = 'student' AND active = 1
      ORDER BY name ASC
    `).all();

    res.json({ success: true, students });
  } catch (error) {
    console.error("Students list error:", error);
    res.status(500).json({ success: false, message: "Unable to fetch students" });
  }
});

module.exports = router;
