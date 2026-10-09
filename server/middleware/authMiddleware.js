const jwt = require("jsonwebtoken");

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return secret;
}

function authenticateToken(req, res, next) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }

  const token = header.slice(7).trim();
  if (!token) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }

  try {
    const decoded = jwt.verify(token, getSecret());
    req.user = {
      id: Number(decoded.id),
      role: String(decoded.role || "").toLowerCase()
    };
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
}

function authorizeRoles(...allowedRoles) {
  const roles = allowedRoles.map((role) => String(role).toLowerCase());
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "You do not have permission to access this resource" });
    }
    next();
  };
}

/**
 * Middleware to check student registration status
 * Only applies to students - pending/rejected students get 403
 */
function checkStudentRegistrationStatus(req, res, next) {
  // Only check for students
  if (req.user && req.user.role === "student") {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(500).json({ 
          success: false, 
          message: "Database connection unavailable" 
        });
      }

      const user = db.prepare(
        "SELECT registration_status FROM users WHERE id = ? LIMIT 1"
      ).get(req.user.id);

      if (!user) {
        return res.status(404).json({ 
          success: false, 
          message: "User not found" 
        });
      }

      const status = user.registration_status || "approved";

      if (status === "pending") {
        return res.status(403).json({ 
          success: false, 
          code: "REGISTRATION_PENDING",
          message: "Your registration is pending CEO approval" 
        });
      }

      if (status === "rejected") {
        return res.status(403).json({ 
          success: false, 
          code: "REGISTRATION_REJECTED",
          message: "Your registration has been rejected" 
        });
      }

      // Approved - continue
      next();
    } catch (error) {
      console.error("Registration status check error:", error);
      return res.status(500).json({ 
        success: false, 
        message: "Unable to verify registration status" 
      });
    }
  } else {
    // Not a student - continue
    next();
  }
}

module.exports = { authenticateToken, authorizeRoles, checkStudentRegistrationStatus, getSecret };
