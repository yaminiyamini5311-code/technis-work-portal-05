/**
 * CEO Portal Notification System with Authorization
 * 
 * This module provides a secure way to create CEO Portal notifications
 * Only authorized users (67 students + 4 managers) can trigger notifications
 * Authorization is enforced on the backend by checking authenticated email against AuthorizedUser collection
 */

const { isAuthorized } = require("../models/AuthorizedUser");

/**
 * Create a CEO Portal notification (with authorization check)
 * 
 * @param {Db} db - MongoDB database instance
 * @param {string} senderEmail - Email from authenticated user (req.user.email), NOT from request body
 * @param {object} payload - Notification data
 * @param {string} payload.type - Notification type (e.g., "registration_pending", "submission_received")
 * @param {string} payload.title - Notification title
 * @param {string} payload.message - Notification message
 * @param {string} [payload.related_task_id] - Optional related task ID
 * @returns {Promise<boolean>} True if notification was created, false if unauthorized
 */
async function createCeoNotification(db, senderEmail, payload) {
  try {
    // Validate inputs
    if (!db) {
      console.error("[CeoNotification] Database instance is required");
      return false;
    }
    
    if (!senderEmail || typeof senderEmail !== 'string') {
      console.error("[CeoNotification] Sender email is required and must be a string");
      return false;
    }
    
    if (!payload || typeof payload !== 'object') {
      console.error("[CeoNotification] Payload is required and must be an object");
      return false;
    }
    
    const { type, title, message, related_task_id } = payload;
    
    if (!type || !title || !message) {
      console.error("[CeoNotification] Payload must include type, title, and message");
      return false;
    }
    
    // CRITICAL: Check authorization against AuthorizedUser collection
    // Fail closed: if lookup fails or user is not authorized, don't create notification
    const authorized = await isAuthorized(db, senderEmail);
    
    if (!authorized) {
      // Silent failure - don't leak authorization status to caller
      // Log for monitoring but don't expose in API response
      console.log(`[CeoNotification] Unauthorized email attempted notification: ${senderEmail}`);
      return false;
    }
    
    // User is authorized - create notifications for all CEO/admin users
    const ceoAdmins = await db.collection("users").find(
      { role: { $in: ["admin", "ceo"] }, active: 1 },
      { projection: { _id: 1 } }
    ).toArray();
    
    if (ceoAdmins.length === 0) {
      console.warn("[CeoNotification] No CEO/admin users found to notify");
      return false;
    }
    
    // Prepare notification documents
    const notificationDocs = ceoAdmins.map(admin => ({
      user_id: String(admin._id),
      type: String(type),
      title: String(title),
      message: String(message),
      related_task_id: related_task_id ? String(related_task_id) : null,
      sender_email: senderEmail.trim().toLowerCase(), // Track who triggered this
      read_at: null,
      created_at: new Date().toISOString()
    }));
    
    // Insert notifications
    await db.collection("notifications").insertMany(notificationDocs);
    
    console.log(`[CeoNotification] Created ${notificationDocs.length} notification(s) from authorized user: ${senderEmail}`);
    
    return true;
  } catch (error) {
    console.error("[CeoNotification] Error creating notification:", error.message);
    // Fail closed: on error, no notification is created
    return false;
  }
}

/**
 * Create a notification for a specific user (not CEO portal)
 * This is for regular user-to-user notifications, not CEO portal notifications
 * No authorization check needed for direct user notifications
 * 
 * @param {Db} db - MongoDB database instance
 * @param {string} userId - Target user ID
 * @param {object} payload - Notification data
 * @returns {Promise<boolean>} True if notification was created
 */
async function createUserNotification(db, userId, payload) {
  try {
    if (!db || !userId || !payload) {
      console.error("[CeoNotification] Invalid parameters for user notification");
      return false;
    }
    
    const { type, title, message, related_task_id } = payload;
    
    if (!type || !title || !message) {
      console.error("[CeoNotification] Payload must include type, title, and message");
      return false;
    }
    
    await db.collection("notifications").insertOne({
      user_id: String(userId),
      type: String(type),
      title: String(title),
      message: String(message),
      related_task_id: related_task_id ? String(related_task_id) : null,
      read_at: null,
      created_at: new Date().toISOString()
    });
    
    return true;
  } catch (error) {
    console.error("[CeoNotification] Error creating user notification:", error.message);
    return false;
  }
}

module.exports = {
  createCeoNotification,
  createUserNotification
};
