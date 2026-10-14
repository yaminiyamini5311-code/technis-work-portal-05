/**
 * Upload validation rules — SINGLE SOURCE OF TRUTH.
 *
 * The Drive resumable-upload path and the existing multer path must enforce
 * identical rules, so both read them from here. Changing a rule changes it for
 * both at once and they cannot drift apart.
 *
 * Values are intentionally UNCHANGED from the pre-existing multer
 * configuration in server/routes/taskRoutes.js.
 */

const path = require("path");

/** Extensions the app has always accepted. Not widened. */
const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".zip", ".png", ".jpg", ".jpeg",
]);

/**
 * Per-file limit: 4 MB.
 * Vercel rejects request bodies above ~4.5 MB at the platform level (an
 * opaque 413 before the app sees it), so a higher app-level limit could never
 * be used in production. Unchanged.
 */
const MAX_FILE_BYTES = 4 * 1024 * 1024;

/** Maximum files per submission. Unchanged. */
const MAX_FILES = 5;

/**
 * Check a filename's extension against the allowlist.
 * @param {string} filename
 * @returns {boolean}
 */
function isAllowedExtension(filename) {
  return ALLOWED_EXTENSIONS.has(path.extname(String(filename || "")).toLowerCase());
}

/**
 * Validate filename / declared size against the existing rules.
 * Returns `{ ok: true }` or `{ ok: false, message }` with a user-safe message.
 * @param {string} filename
 * @param {number} size
 * @returns {{ok: boolean, message?: string}}
 */
function validateFileMeta(filename, size) {
  if (!filename || !String(filename).trim()) {
    return { ok: false, message: "File name is required" };
  }
  if (!isAllowedExtension(filename)) {
    return { ok: false, message: "Unsupported file type" };
  }
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { ok: false, message: "File size is invalid" };
  }
  if (bytes > MAX_FILE_BYTES) {
    return { ok: false, message: "File too large (max 4 MB each)" };
  }
  return { ok: true };
}

module.exports = {
  ALLOWED_EXTENSIONS,
  MAX_FILE_BYTES,
  MAX_FILES,
  isAllowedExtension,
  validateFileMeta,
};