/**
 * MongoDB-backed audit utility
 */
async function writeAudit(db, { actorId, action, entityType, entityId = null, previousValue = null, newValue = null, metadata = null, actorRole = null, actorEmail = null, actorName = null }) {
  try {
    await db.collection("audit_logs").insertOne({
      actor_id: actorId || null,
      actor_role: actorRole || null,
      actor_email: actorEmail || null,
      actor_name: actorName || null,
      action: String(action),
      entity_type: String(entityType),
      entity_id: entityId != null ? String(entityId) : null,
      previous_value: previousValue,
      new_value: newValue,
      metadata: metadata,
      created_at: new Date().toISOString()
    });
  } catch (err) {
    console.error("[Audit] Failed to write audit log:", err.message);
  }
}
module.exports = { writeAudit };
