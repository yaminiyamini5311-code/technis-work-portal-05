function writeAudit(db, { actorId, action, entityType, entityId = null, previousValue = null, newValue = null, metadata = null }) {
  db.prepare(`
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, previous_value, new_value, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    actorId || null,
    String(action),
    String(entityType),
    entityId == null ? null : Number(entityId),
    previousValue == null ? null : JSON.stringify(previousValue),
    newValue == null ? null : JSON.stringify(newValue),
    metadata == null ? null : JSON.stringify(metadata),
    new Date().toISOString()
  );
}
module.exports = { writeAudit };
