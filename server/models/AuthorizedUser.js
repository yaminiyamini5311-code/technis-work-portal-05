/**
 * AuthorizedUser Model
 * Manages the permanent whitelist of users authorized to trigger CEO Portal notifications
 * Uses MongoDB native driver (not Mongoose) for consistency with the rest of the application
 */

const { ObjectId } = require("mongodb");

/**
 * Schema definition (for documentation and validation)
 */
const AuthorizedUserSchema = {
  email: String,        // required, unique, lowercase, trimmed
  role: String,         // 'student' | 'manager', required
  learnerId: String,    // unique, sparse; students only (e.g., T60-001)
  name: String,         // full name
  isDemo: Boolean,      // default false; label only, does not affect authorization
  active: Boolean,      // default true; deactivate instead of deleting
  createdAt: Date,
  updatedAt: Date
};

/**
 * Collection name constant
 */
const COLLECTION_NAME = "authorized_users";

/**
 * Create indexes for the authorized_users collection
 * @param {Db} db - MongoDB database instance
 */
async function createIndexes(db) {
  const collection = db.collection(COLLECTION_NAME);
  
  await collection.createIndex({ email: 1 }, { unique: true });
  await collection.createIndex({ learnerId: 1 }, { unique: true, sparse: true });
  await collection.createIndex({ role: 1 });
  await collection.createIndex({ active: 1 });
  
  console.log("[AuthorizedUser] Indexes created successfully");
}

/**
 * Check if an email is authorized to trigger CEO notifications
 * @param {Db} db - MongoDB database instance
 * @param {string} email - Email address to check (case-insensitive, trimmed)
 * @returns {Promise<boolean>} True if authorized and active
 */
async function isAuthorized(db, email) {
  if (!email || typeof email !== 'string') {
    return false;
  }
  
  const normalizedEmail = email.trim().toLowerCase();
  
  try {
    const user = await db.collection(COLLECTION_NAME).findOne({
      email: normalizedEmail,
      active: true
    });
    
    return !!user;
  } catch (error) {
    console.error("[AuthorizedUser] Error checking authorization:", error.message);
    // Fail closed: if DB lookup fails, deny authorization
    return false;
  }
}

/**
 * Get authorized user details by email
 * @param {Db} db - MongoDB database instance
 * @param {string} email - Email address
 * @returns {Promise<object|null>} User document or null
 */
async function findByEmail(db, email) {
  if (!email || typeof email !== 'string') {
    return null;
  }
  
  const normalizedEmail = email.trim().toLowerCase();
  
  try {
    return await db.collection(COLLECTION_NAME).findOne({
      email: normalizedEmail,
      active: true
    });
  } catch (error) {
    console.error("[AuthorizedUser] Error finding user by email:", error.message);
    return null;
  }
}

/**
 * Block accidental deletion - require explicit admin confirmation
 * This is a pre-check function that should be called before any delete operation
 * @param {boolean} adminConfirmed - Must be explicitly set to true
 * @throws {Error} If adminConfirmed is not true
 */
function requireDeletionConfirmation(adminConfirmed) {
  if (adminConfirmed !== true) {
    throw new Error(
      "Deletion of authorized users requires explicit admin confirmation. " +
      "Pass { adminConfirmed: true } to confirm deletion."
    );
  }
}

/**
 * Safely delete an authorized user (requires admin confirmation)
 * Logs the deletion for audit purposes
 * @param {Db} db - MongoDB database instance
 * @param {string} email - Email of user to delete
 * @param {string} adminId - ID of admin performing deletion
 * @param {boolean} adminConfirmed - Must be explicitly true
 * @returns {Promise<boolean>} True if deleted
 */
async function deleteByEmail(db, email, adminId, adminConfirmed = false) {
  requireDeletionConfirmation(adminConfirmed);
  
  const normalizedEmail = email.trim().toLowerCase();
  
  try {
    const user = await db.collection(COLLECTION_NAME).findOne({ email: normalizedEmail });
    
    if (!user) {
      return false;
    }
    
    // Log deletion for audit
    await db.collection("audit_logs").insertOne({
      actor_id: adminId,
      action: "authorized_user_deleted",
      entity_type: "authorized_user",
      entity_id: String(user._id),
      previous_value: { email: user.email, role: user.role, name: user.name },
      new_value: null,
      timestamp: new Date().toISOString()
    });
    
    const result = await db.collection(COLLECTION_NAME).deleteOne({ _id: user._id });
    
    console.log(`[AuthorizedUser] Deleted user ${email} by admin ${adminId}`);
    
    return result.deletedCount > 0;
  } catch (error) {
    console.error("[AuthorizedUser] Error deleting user:", error.message);
    throw error;
  }
}

/**
 * Deactivate a user (preferred over deletion)
 * @param {Db} db - MongoDB database instance
 * @param {string} email - Email of user to deactivate
 * @param {string} adminId - ID of admin performing deactivation
 * @returns {Promise<boolean>} True if deactivated
 */
async function deactivate(db, email, adminId) {
  const normalizedEmail = email.trim().toLowerCase();
  
  try {
    const result = await db.collection(COLLECTION_NAME).updateOne(
      { email: normalizedEmail },
      {
        $set: {
          active: false,
          updatedAt: new Date(),
          deactivatedBy: adminId,
          deactivatedAt: new Date().toISOString()
        }
      }
    );
    
    if (result.modifiedCount > 0) {
      // Log deactivation for audit
      await db.collection("audit_logs").insertOne({
        actor_id: adminId,
        action: "authorized_user_deactivated",
        entity_type: "authorized_user",
        entity_id: normalizedEmail,
        new_value: { active: false },
        timestamp: new Date().toISOString()
      });
      
      console.log(`[AuthorizedUser] Deactivated user ${email} by admin ${adminId}`);
    }
    
    return result.modifiedCount > 0;
  } catch (error) {
    console.error("[AuthorizedUser] Error deactivating user:", error.message);
    throw error;
  }
}

/**
 * Reactivate a user
 * @param {Db} db - MongoDB database instance
 * @param {string} email - Email of user to reactivate
 * @param {string} adminId - ID of admin performing reactivation
 * @returns {Promise<boolean>} True if reactivated
 */
async function reactivate(db, email, adminId) {
  const normalizedEmail = email.trim().toLowerCase();
  
  try {
    const result = await db.collection(COLLECTION_NAME).updateOne(
      { email: normalizedEmail },
      {
        $set: {
          active: true,
          updatedAt: new Date(),
          reactivatedBy: adminId,
          reactivatedAt: new Date().toISOString()
        },
        $unset: {
          deactivatedBy: "",
          deactivatedAt: ""
        }
      }
    );
    
    if (result.modifiedCount > 0) {
      // Log reactivation for audit
      await db.collection("audit_logs").insertOne({
        actor_id: adminId,
        action: "authorized_user_reactivated",
        entity_type: "authorized_user",
        entity_id: normalizedEmail,
        new_value: { active: true },
        timestamp: new Date().toISOString()
      });
      
      console.log(`[AuthorizedUser] Reactivated user ${email} by admin ${adminId}`);
    }
    
    return result.modifiedCount > 0;
  } catch (error) {
    console.error("[AuthorizedUser] Error reactivating user:", error.message);
    throw error;
  }
}

/**
 * Get statistics about authorized users
 * @param {Db} db - MongoDB database instance
 * @returns {Promise<object>} Statistics
 */
async function getStats(db) {
  try {
    const collection = db.collection(COLLECTION_NAME);
    
    const [total, active, students, managers] = await Promise.all([
      collection.countDocuments({}),
      collection.countDocuments({ active: true }),
      collection.countDocuments({ role: "student", active: true }),
      collection.countDocuments({ role: "manager", active: true })
    ]);
    
    return { total, active, students, managers };
  } catch (error) {
    console.error("[AuthorizedUser] Error getting stats:", error.message);
    throw error;
  }
}

module.exports = {
  COLLECTION_NAME,
  createIndexes,
  isAuthorized,
  findByEmail,
  deleteByEmail,
  deactivate,
  reactivate,
  getStats,
  requireDeletionConfirmation
};
