/**
 * Batch routes.
 *
 * GET  /api/batches            — PUBLIC, read-only: id + name of active
 *                                batches only (no sensitive data). Powers the
 *                                signup dropdown.
 * GET  /api/batches/:id        — CEO/admin/manager: batch details + member count.
 * POST /api/batches            — CEO/admin: create a batch (name unique,
 *                                case-insensitive).
 * PATCH /api/batches/:id       — CEO/admin: rename / activate / deactivate.
 *
 * All IDs are handled as strings (MongoDB ObjectId hex) to match the rest
 * of the codebase.
 */
const express = require("express");
const { ObjectId } = require("mongodb");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const { writeAudit } = require("../utils/audit_mongo");

const router = express.Router();

function toId(id) { try { return new ObjectId(id); } catch { return null; } }

function fmtBatch(b) {
  return {
    id: String(b._id),
    name: b.name,
    active: b.active !== false,
    created_at: b.created_at || null,
  };
}

/** Normalized batch name for case-insensitive comparison */
function norm(name) {
  return String(name || "").trim().toLowerCase();
}

/* ─── PUBLIC: list active batches (id + name only) ─────────── */
router.get("/", async (req, res) => {
  try {
    const db = req.db;
    const batches = await db.collection("batches")
      .find({ active: true }, { projection: { name: 1, created_at: 1 } })
      .sort({ name: 1 })
      .toArray();
    res.json({
      success: true,
      batches: batches.map(fmtBatch),
    });
  } catch (e) {
    console.error("[BATCHES] list error:", e.message);
    res.status(500).json({ success: false, message: "Unable to load batches" });
  }
});

/* ─── CEO/admin/manager: batch details + member count ──────── */
router.get("/:id", authenticateToken, authorizeRoles("ceo", "admin", "manager"), async (req, res) => {
  try {
    const db = req.db;
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid batch id" });
    const batch = await db.collection("batches").findOne({ _id: id });
    if (!batch) return res.status(404).json({ success: false, message: "Batch not found" });
    const memberCount = await db.collection("users").countDocuments({ batch_id: String(id), role: "student" });
    res.json({ success: true, batch: { ...fmtBatch(batch), member_count: memberCount } });
  } catch (e) {
    console.error("[BATCHES] get error:", e.message);
    res.status(500).json({ success: false, message: "Unable to load batch" });
  }
});

/* ─── CEO/admin: create batch ────────────────────────────────── */
router.post("/", authenticateToken, authorizeRoles("ceo", "admin"), async (req, res) => {
  try {
    const db = req.db;
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ success: false, message: "Batch name is required" });
    if (name.length > 60) return res.status(400).json({ success: false, message: "Batch name must be 60 characters or fewer" });

    // Case-insensitive uniqueness (same collation as the unique index)
    const existing = await db.collection("batches").findOne(
      { name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } }
    );
    if (existing) {
      return res.status(409).json({ success: false, message: `A batch named "${existing.name}" already exists` });
    }

    const result = await db.collection("batches").insertOne({
      name,
      active: true,
      created_at: new Date().toISOString(),
      created_by: req.user.id,
    });
    await writeAudit(db, { actorId: req.user.id, action: "batch_created", entityType: "batch", entityId: String(result.insertedId), newValue: { name } });
    res.status(201).json({ success: true, message: "Batch created", batch: fmtBatch({ _id: result.insertedId, name, active: true }) });
  } catch (e) {
    console.error("[BATCHES] create error:", e.message);
    if (e.code === 11000) return res.status(409).json({ success: false, message: "A batch with this name already exists" });
    res.status(500).json({ success: false, message: "Unable to create batch" });
  }
});

/* ─── CEO/admin: rename / activate / deactivate ────────────── */
router.patch("/:id", authenticateToken, authorizeRoles("ceo", "admin"), async (req, res) => {
  try {
    const db = req.db;
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid batch id" });
    const batch = await db.collection("batches").findOne({ _id: id });
    if (!batch) return res.status(404).json({ success: false, message: "Batch not found" });

    const updates = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ success: false, message: "Batch name cannot be empty" });
      const clash = await db.collection("batches").findOne(
        { _id: { $ne: id }, name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } }
      );
      if (clash) return res.status(409).json({ success: false, message: `A batch named "${clash.name}" already exists` });
      updates.name = name;
    }
    if (req.body?.active !== undefined) {
      updates.active = Boolean(req.body.active);
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ success: false, message: "Nothing to update" });
    }

    await db.collection("batches").updateOne({ _id: id }, { $set: updates });
    await writeAudit(db, { actorId: req.user.id, action: "batch_updated", entityType: "batch", entityId: String(id), previousValue: { name: batch.name, active: batch.active }, newValue: updates });
    const updated = await db.collection("batches").findOne({ _id: id });
    res.json({ success: true, message: "Batch updated", batch: fmtBatch(updated) });
  } catch (e) {
    console.error("[BATCHES] update error:", e.message);
    res.status(500).json({ success: false, message: "Unable to update batch" });
  }
});

module.exports = router;
