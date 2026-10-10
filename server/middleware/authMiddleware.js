const jwt = require("jsonwebtoken");

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not configured");
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
      id: String(decoded.id),
      role: String(decoded.role || "").toLowerCase()
    };
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
}

function authorizeRoles(...allowedRoles) {
  const roles = allowedRoles.map(r => String(r).toLowerCase());
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: "Authentication required" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "You do not have permission to access this resource" });
    }
    next();
  };
}

/**
 * Middleware to check student registration status (MongoDB version)
 */
async function checkStudentRegistrationStatus(req, res, next) {
  if (req.user && req.user.role === "student") {
    try {
      const db = req.db;
      if (!db) return res.status(500).json({ success: false, message: "Database connection unavailable" });

      const { ObjectId } = require("mongodb");
      let query;
      try {
        query = { _id: new ObjectId(req.user.id) };
      } catch {
        query = { _id: req.user.id };
      }

      const user = await db.collection("users").findOne(query, { projection: { registration_status: 1 } });
      if (!user) return res.status(404).json({ success: false, message: "User not found" });

      const status = user.registration_status || "approved";
      if (status === "pending") {
        return res.status(403).json({ success: false, code: "REGISTRATION_PENDING", message: "Your registration is pending CEO approval" });
      }
      if (status === "rejected") {
        return res.status(403).json({ success: false, code: "REGISTRATION_REJECTED", message: "Your registration has been rejected" });
      }
      next();
    } catch (error) {
      console.error("Registration status check error:", error);
      return res.status(500).json({ success: false, message: "Unable to verify registration status" });
    }
  } else {
    next();
  }
}

module.exports = { authenticateToken, authorizeRoles, checkStudentRegistrationStatus, getSecret };
