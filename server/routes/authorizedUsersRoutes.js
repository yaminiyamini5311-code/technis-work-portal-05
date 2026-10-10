/**
 * Admin routes for managing authorized users
 * All routes require admin role authentication
 */

const express = require("express");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const { 
  getStats, 
  findByEmail, 
  deactivate, 
  reactivate, 
  deleteByEmail,
  COLLECTION_NAME 
} = require("../models/AuthorizedUser");

const router = express.Router();

/**
 * Get statistics about authorized users
 * GET /api/authorized-users/stats
 */
router.get("/stats", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const stats = await getStats(req.db);
    res.json({ success: true, stats });
  } catch (error) {
    console.error("[AuthorizedUsers] Error getting stats:", error.message);
    res.status(500).json({ success: false, message: "Unable to retrieve statistics" });
  }
});

/**
 * List all authorized users with pagination
 * GET /api/authorized-users?page=1&limit=50&role=student&active=true
 */
router.get("/", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;
    
    // Build filter
    const filter = {};
    if (req.query.role) {
      filter.role = req.query.role;
    }
    if (req.query.active !== undefined) {
      filter.active = req.query.active === "true";
    }
    
    const [users, total] = await Promise.all([
      db.collection(COLLECTION_NAME)
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      db.collection(COLLECTION_NAME).countDocuments(filter)
    ]);
    
    res.json({
      success: true,
      users: users.map(u => ({
        ...u,
        id: String(u._id),
        _id: undefined
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("[AuthorizedUsers] Error listing users:", error.message);
    res.status(500).json({ success: false, message: "Unable to retrieve users" });
  }
});

/**
 * Get a specific authorized user by email
 * GET /api/authorized-users/:email
 */
router.get("/:email", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const user = await findByEmail(req.db, req.params.email);
    
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    
    res.json({
      success: true,
      user: {
        ...user,
        id: String(user._id),
        _id: undefined
      }
    });
  } catch (error) {
    console.error("[AuthorizedUsers] Error finding user:", error.message);
    res.status(500).json({ success: false, message: "Unable to retrieve user" });
  }
});

/**
 * Deactivate an authorized user (preferred over deletion)
 * PATCH /api/authorized-users/:email/deactivate
 */
router.patch("/:email/deactivate", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const success = await deactivate(req.db, req.params.email, req.user.id);
    
    if (!success) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    
    res.json({ success: true, message: "User deactivated successfully" });
  } catch (error) {
    console.error("[AuthorizedUsers] Error deactivating user:", error.message);
    res.status(500).json({ success: false, message: "Unable to deactivate user" });
  }
});

/**
 * Reactivate an authorized user
 * PATCH /api/authorized-users/:email/reactivate
 */
router.patch("/:email/reactivate", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const success = await reactivate(req.db, req.params.email, req.user.id);
    
    if (!success) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    
    res.json({ success: true, message: "User reactivated successfully" });
  } catch (error) {
    console.error("[AuthorizedUsers] Error reactivating user:", error.message);
    res.status(500).json({ success: false, message: "Unable to reactivate user" });
  }
});

/**
 * Delete an authorized user (requires explicit confirmation)
 * DELETE /api/authorized-users/:email
 * Body: { adminConfirmed: true }
 */
router.delete("/:email", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const adminConfirmed = req.body?.adminConfirmed === true;
    
    if (!adminConfirmed) {
      return res.status(400).json({
        success: false,
        message: "Deletion requires explicit confirmation. Send { adminConfirmed: true } in request body."
      });
    }
    
    const success = await deleteByEmail(req.db, req.params.email, req.user.id, adminConfirmed);
    
    if (!success) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    
    res.json({ success: true, message: "User deleted successfully" });
  } catch (error) {
    console.error("[AuthorizedUsers] Error deleting user:", error.message);
    
    if (error.message.includes("requires explicit admin confirmation")) {
      return res.status(400).json({ success: false, message: error.message });
    }
    
    res.status(500).json({ success: false, message: "Unable to delete user" });
  }
});

/**
 * Update an authorized user
 * PATCH /api/authorized-users/:email
 * Body: { name, learnerId, isDemo }
 */
router.patch("/:email", authenticateToken, authorizeRoles("admin", "ceo"), async (req, res) => {
  try {
    const db = req.db;
    const email = req.params.email.trim().toLowerCase();
    const { name, learnerId, isDemo } = req.body;
    
    const updates = {};
    if (name !== undefined) updates.name = String(name).trim();
    if (learnerId !== undefined) updates.learnerId = String(learnerId).trim();
    if (isDemo !== undefined) updates.isDemo = Boolean(isDemo);
    updates.updatedAt = new Date();
    
    if (Object.keys(updates).length === 1) { // Only updatedAt
      return res.status(400).json({ success: false, message: "No fields to update" });
    }
    
    const result = await db.collection(COLLECTION_NAME).updateOne(
      { email },
      { $set: updates }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    
    // Log audit
    await db.collection("audit_logs").insertOne({
      actor_id: req.user.id,
      action: "authorized_user_updated",
      entity_type: "authorized_user",
      entity_id: email,
      new_value: updates,
      timestamp: new Date().toISOString()
    });
    
    res.json({ success: true, message: "User updated successfully" });
  } catch (error) {
    console.error("[AuthorizedUsers] Error updating user:", error.message);
    
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Duplicate learner ID" });
    }
    
    res.status(500).json({ success: false, message: "Unable to update user" });
  }
});

module.exports = router;
