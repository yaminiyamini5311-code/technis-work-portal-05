/**
 * Scheduled maintenance endpoint (Vercel Cron).
 *
 * Resubmission windows must close on time even when nobody opens the Task
 * Manager. The SAME implementation runs lazily on every read
 * (utils/submissionStatus.expireStaleRevisionWindows via runExpirySweep), so
 * this route is not required for correctness — it just makes expiry timely and
 * guarantees the student notification is delivered promptly.
 *
 * No new infrastructure: Vercel Cron issues a plain GET with the
 * `x-vercel-cron` header plus a bearer `Authorization: Bearer $CRON_SECRET`, so
 * the route is mounted on the existing serverless function.
 *
 *   vercel.json → { "crons": [{ "path": "/api/cron/expire-resubmissions",
 *                               "schedule": "0 2 * * *" }] }
 *
 * Note the key is "path", not "src" — Vercel's schema rejects a cron entry
 * without it ("crons[0] missing required property `path`"). The daily 02:00
 * schedule is the Hobby-plan limit; the lazy sweep below is what actually
 * enforces the window, so running once a day is sufficient.
 *
 * CRON_SECRET must be set in the Vercel project settings. Without it the
 * endpoint answers 503 and says so, rather than running unprotected.
 */

const express = require("express");
const { expireStaleRevisionWindows } = require("../utils/submissionStatus");
const { notifyOnce, notifyAdmins } = require("../utils/notifications");
const { formatISTDeadlineLabel } = require("../utils/time");

const router = express.Router();

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. We also accept an
 * `x-cron-secret` header and a `?secret=` query parameter so the endpoint can
 * be triggered manually from a shell during an incident.
 */
function requireCronSecret(req, res, next) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return res.status(503).json({
      success: false,
      error: { code: "CRON_NOT_CONFIGURED", message: "CRON_SECRET is not configured on this deployment." },
      message: "CRON_SECRET is not configured on this deployment.",
    });
  }
  const header = req.headers.authorization || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const provided = bearer || req.headers["x-cron-secret"] || req.query.secret || "";
  if (provided !== expected) {
    return res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Invalid cron secret." },
      message: "Invalid cron secret.",
    });
  }
  next();
}

const handler = async (req, res) => {
  try {
    const db = req.db;
    const now = new Date();
    const expired = await expireStaleRevisionWindows(db, {
      now,
      notify: async ({ task, assignment, deadline }) => {
        await notifyOnce(db, {
          userId: String(assignment.student_id),
          type: "resubmission_expired",
          title: "Resubmission window expired",
          message: `The 24-hour resubmission window for "${task.title}" has expired. Ask your administrator to request a new revision if you can still fix it.`,
          taskId: String(task._id),
          cycle: assignment.revision_cycle,
          revisionDeadline: deadline,
          revisionRequestedAt: assignment.revision_requested_at || null,
          recipientRole: "student",
        });
        await notifyAdmins(db, {
          type: "resubmission_expired_admin",
          title: "Resubmission window expired",
          message: `The resubmission window for "${task.title}" expired at ${formatISTDeadlineLabel(deadline)}.`,
          taskId: String(task._id),
          studentId: String(assignment.student_id),
          cycle: assignment.revision_cycle,
          revisionDeadline: deadline,
        });
      },
    });

    res.json({
      success: true,
      data: {
        expired_count: expired.length,
        expired: expired.map(e => ({
          task_id: e.task_id,
          student_id: e.student_id,
          cycle: e.cycle,
          deadline: e.deadline,
        })),
        ran_at: now.toISOString(),
      },
      error: null,
      message: expired.length
        ? `Closed ${expired.length} resubmission window${expired.length === 1 ? "" : "s"}.`
        : "No resubmission windows needed closing.",
    });
  } catch (e) {
    console.error("CRON expire-resubmissions:", e);
    res.status(500).json({
      success: false,
      error: { code: "CRON_FAILED", message: "Unable to close resubmission windows." },
      message: "Unable to close resubmission windows.",
    });
  }
};

router.get("/expire-resubmissions", requireCronSecret, handler);
// Vercel Cron only issues GET; POST is accepted so the sweep can be triggered
// from a deploy hook or an ops script with the same secret.
router.post("/expire-resubmissions", requireCronSecret, handler);

module.exports = router;
module.exports.requireCronSecret = requireCronSecret;