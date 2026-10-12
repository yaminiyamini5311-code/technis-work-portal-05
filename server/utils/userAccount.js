/**
 * Shared user-account normalization helpers.
 *
 * The users collection carries TWO approval signals:
 *   - `active`               numeric/boolean flag written by the server paths
 *                             (signup, admin register, deactivate/reactivate)
 *   - `registration_status`  "pending" | "approved" | "rejected" workflow state
 *
 * Direct-insert / legacy rows may use different shapes (missing field, NULL,
 * boolean, "1"/"true"/"Approved" strings, mixed casing). Every code path MUST
 * go through these helpers so login, signup, approval and seeds agree on what
 * "active" and "approved" mean.
 *
 * New student signups are created INACTIVE + PENDING and only become usable
 * when an admin/CEO approves them (see adminRoutes approve-registration).
 */

/** Normalize an email for storage AND lookup: trim + lowercase. */
function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

/** Normalize a role: trim + lowercase ("Student" -> "student"). */
function normalizeRole(role) {
  return String(role ?? "").trim().toLowerCase();
}

/**
 * Normalize registration_status: trim + lowercase.
 * Missing/empty means "approved" — that is how legacy rows (created before
 * the column existed) have always been treated by the app.
 */
function normalizeRegistrationStatus(status) {
  const s = String(status ?? "").trim().toLowerCase();
  return s === "" ? "approved" : s;
}

/**
 * Is an `active` value truthy? Robust to legacy shapes:
 *   1, true, "1", "true", "TRUE"  -> active
 *   0, false, null, undefined, "", "0", "false", anything else -> inactive
 */
function isActiveFlag(active) {
  if (active === true) return true;
  if (typeof active === "number") return active === 1;
  if (typeof active === "string") {
    const s = active.trim().toLowerCase();
    return s === "1" || s === "true";
  }
  return false;
}

/**
 * Is this registration_status value an approval that still blocks login?
 * (casing/NULL-safe)
 */
function isBlockedRegistrationStatus(status) {
  const s = normalizeRegistrationStatus(status);
  return s === "pending" || s === "rejected";
}

/**
 * Can this user log in?
 * - `active` must be an active flag (robust to NULL/casing/string shapes)
 * - registration must NOT be pending or rejected (approval enforced)
 */
function canUserLogin(user) {
  if (!user) return false;
  if (!isActiveFlag(user.active)) return false;
  if (isBlockedRegistrationStatus(user.registration_status)) return false;
  return true;
}

module.exports = {
  normalizeEmail,
  normalizeRole,
  normalizeRegistrationStatus,
  isActiveFlag,
  isBlockedRegistrationStatus,
  canUserLogin,
};
