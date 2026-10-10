const express = require("express");
const { ObjectId } = require("mongodb");
const { authenticateToken, authorizeRoles } = require("../middleware/authMiddleware");
const router = express.Router();
function toId(id) { try { return new ObjectId(id); } catch { return id; } }

router.get("/", authenticateToken, authorizeRoles("ceo", "admin", "manager", "student", "member"), async (req, res) => {
  try {
    const db = req.db;
    let records;
    if (["student", "member"].includes(req.user.role)) {
      records = await db.collection("performance").find({ user_id: req.user.id }).sort({ created_at: -1 }).toArray();
    } else {
      records = await db.collection("performance").find({}).sort({ created_at: -1 }).toArray();
    }
    const result = await Promise.all(records.map(async p => {
      const u = await db.collection("users").findOne({ _id: toId(p.user_id) }, { projection: { name: 1 } });
      const r = p.reviewed_by ? await db.collection("users").findOne({ _id: toId(p.reviewed_by) }, { projection: { name: 1 } }) : null;
      return { ...p, id: String(p._id), student_name: u?.name, reviewer_name: r?.name };
    }));
    res.json({ success: true, records: result });
  } catch (e) { res.status(500).json({ success: false, message: "Unable to fetch performance records" }); }
});

module.exports = router;
