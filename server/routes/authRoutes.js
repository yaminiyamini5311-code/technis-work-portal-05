const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { authenticateToken, authorizeRoles, getSecret } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const db = req.app.locals.db;
    const cleanEmail = String(email).trim().toLowerCase();
    const user = db.prepare("SELECT id, name, email, password, role, department FROM users WHERE email = ? AND active=1").get(cleanEmail);

    if (!user || !(await bcrypt.compare(String(password), user.password))) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const token = jwt.sign({ id: user.id, role: user.role }, getSecret(), { expiresIn: "1d" });

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department
      }
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ success: false, message: "Login failed" });
  }
});

// No public registration. Admin can create student accounts only.
router.post("/register", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  try {
    const { name, email, password, role = "student", department = "Techins" } = req.body || {};
    const requestedRole = String(role).trim().toLowerCase();

    if (requestedRole !== "student") {
      return res.status(403).json({ success: false, message: "Only student accounts can be created from the admin portal" });
    }
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "Name, email and password are required" });
    }

    const db = req.app.locals.db;
    const studentCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE LOWER(role) = 'student' AND active=1").get().count;
    if (studentCount >= 25) {
      return res.status(409).json({ success: false, message: "Maximum of 25 students has been reached" });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    if (db.prepare("SELECT id FROM users WHERE email = ?").get(cleanEmail)) {
      return res.status(409).json({ success: false, message: "A user with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const result = db.prepare(`INSERT INTO users (name, email, password, role, department) VALUES (?, ?, ?, 'student', ?)`).run(
      String(name).trim(), cleanEmail, passwordHash, String(department || "Techins").trim()
    );

    res.status(201).json({ success: true, message: "Student created successfully", userId: result.lastInsertRowid });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ success: false, message: "Unable to create student" });
  }
});

router.get("/me", authenticateToken, (req, res) => {
  const user = req.app.locals.db.prepare("SELECT id, name, email, role, department FROM users WHERE id = ? AND active=1").get(req.user.id);
  if (!user) return res.status(404).json({ success: false, message: "User not found" });
  res.json({ success: true, user });
});

module.exports = router;
