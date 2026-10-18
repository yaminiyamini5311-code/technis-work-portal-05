/**
 * Shared date formatting helper for the TECHINS WORK PORTAL.
 * 
 * All frontend components and Excel export should import and use this helper
 * instead of ad-hoc `new Date().toLocaleString()` calls. This ensures
 * consistent IST (Asia/Kolkata) timezone formatting across the entire app.
 * 
 * IST = UTC+5:30. The end-of-day deadline is 23:59:59 IST = 18:29:59 UTC.
 * 
 * Usage:
 *   import { formatISTDateTime } from "@/utils/dateHelper";
 *   const formatted = formatISTDateTime(dueAtISOString);
 * 
 * The formatter always renders the Indian timezone (Asia/Kolkata) so that
 * users in India always see the correct calendar day, regardless of their
 * local browser timezone (avoids the off-by-one error of showing 17 Oct or 19 Oct).
 */

// Create a reusable Intl.DateTimeFormat formatter configured for IST.
// This is created once and reused for all format calls.
const istFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * Format a date/ISO string in the Asia/Kolkata (IST) timezone.
 * Returns the formatted string like "Sunday, 18 October 2026, 23:59".
 * 
 * If the input is null/undefined, returns "—".
 * If the input is already a valid Date object, it is formatted directly.
 * 
 * @param {string|Date|null|undefined} value - The date value to format
 * @returns {string} The formatted date string in IST timezone
 */
export function formatISTDateTime(value) {
  if (value == null) return "—";

  const date = value instanceof Date ? value : new Date(value);

  // If the Date is invalid, fall back to raw string
  if (isNaN(date)) return String(value);

  return istFormatter.format(date);
}

/**
 * Format just the date portion (weekday + day + month + year) in IST.
 * Returns "Sunday, 18 October 2026" — the full date without time.
 * 
 * @param {string|Date|null|undefined} value - The date value to format
 * @returns {string} The formatted date string in IST timezone
 */
export function formatISTDate(value) {
  if (value == null) return "—";

  const date = value instanceof Date ? value : new Date(value);

  if (isNaN(date)) return String(value);

  // Use a date-only formatter (no time portion)
  const dateFormatter = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });

  return dateFormatter.format(date);
}

/**
 * Short format: "18 October 2026" (date only, no weekday).
 * 
 * @param {string|Date|null|undefined} value - The date value to format
 * @returns {string} The formatted date string
 */
export function formatISTDateShort(value) {
  if (value == null) return "—";

  const date = value instanceof Date ? value : new Date(value);

  if (isNaN(date)) return String(value);

  const dateFormatter = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });

  return dateFormatter.format(date);
}

/**
 * Format a deadline end-of-day string for display.
 * Given a UTC ISO string like "2026-10-18T18:29:59.000Z",
 * this returns "Sunday, 18 October 2026" (IST end-of-day).
 * 
 * @param {string} isoUTC - UTC ISO date string
 * @returns {string} Formatted IST date string
 */
export function formatDeadlineIST(isoUTC) {
  if (!isoUTC) return "—";
  // The ISO string is already in UTC; formatting with Asia/Kolkata timezone
  // will show the correct Indian calendar day.
  const date = new Date(isoUTC);
  if (isNaN(date)) return "—";
  return istFormatter.format(date);
}

/**
 * Check if a deadline (in IST) has passed, given a reference date.
 * Uses the IST end-of-day boundary: 23:59:59 IST.
 * 
 * @param {string|Date} deadlineISO - UTC ISO string of the deadline
 * @param {string|Date} [refDate] - Reference date (defaults to now in IST)
 * @returns {boolean} true if the deadline has passed in IST
 */
export function isDeadlinePassedIST(deadlineISO, refDate) {
  const deadline = new Date(deadlineISO);
  if (isNaN(deadline)) return false;

  const ref = refDate ? new Date(refDate) : new Date();
  // Set reference to end of day in IST
  const istRef = new Date(
    ref.getTime() - ref.getTimezoneOffset() * 60000 + 5.5 * 3600000
  );
  istRef.setHours(23, 59, 59, 0);

  return deadline < istRef;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * WORKSPACE DATE FORMAT
 *
 * One formatter for every table, card and badge in the CEO workspace. Before
 * this existed the same page showed three different shapes:
 *
 *   "2026-10-16 00:30"            raw ISO, no timezone conversion
 *   "18 October 2026"             no time at all
 *   "Thursday, 15 October 202"    weekday + long month, then truncated
 *
 * Everything now renders as "15 Oct 2026, 12:33 PM" in Asia/Kolkata, and is
 * never truncated — a table cell wraps the string instead of cutting it.
 *
 * `null` / `undefined` / unparseable input returns an em dash so a missing date
 * is visibly missing rather than showing "Invalid Date".
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * "18 Oct 2026, 10:00:00 AM" in IST — the ONE date+time format used across the
 * CEO workspace, the student portal and every dialog. Seconds are included so
 * two events in the same minute (a task start and its submission) are never
 * ambiguous. An already-malformed legacy shape such as "15:43 3 PM" can no
 * longer be produced: the whole string comes from a single Intl formatter.
 * @param {string|Date|null|undefined} value
 * @returns {string}
 */
export function formatWorkspaceDateTime(value) {
  if (value == null || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date)) return "—";
  return upperPeriod(workspaceDateTimeFormatter.format(date));
}

/**
 * Date only, same month format: "15 Oct 2026".
 * Used where a time is meaningless (a task's deadline date, a batch label).
 */
export function formatWorkspaceDate(value) {
  if (value == null || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date)) return "—";
  return workspaceDateFormatter.format(date);
}

/**
 * Combine a date and a separate time value ("18:30") into one display string.
 * Task start/end are stored as two fields; this keeps them on one format.
 * Returns null when neither part is present, so the caller can decide between
 * an em dash and "Not available".
 */
export function formatWorkspaceDateTimeParts(dateValue, timeValue) {
  if (dateValue == null || dateValue === "") return null;
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (isNaN(date)) return null;
  if (timeValue == null || timeValue === "") return formatWorkspaceDate(date);

  const match = String(timeValue).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return formatWorkspaceDate(date);

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const dateWithTime = new Date(date.getTime());
  dateWithTime.setHours(hour, minute, 0, 0);
  return upperPeriod(workspaceDateTimeFormatter.format(dateWithTime));
}

/** "am" → "AM" so the workspace shows one consistent meridiem casing. */
function upperPeriod(text) {
  return text.replace(/\b(am|pm)\b/gi, (m) => m.toUpperCase());
}

const workspaceDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
  timeZone: "Asia/Kolkata",
});

const workspaceDateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

/**
 * Correctly pluralised count, e.g. pluralise(1, "file") -> "1 file",
 * pluralise(2, "file") -> "2 files", pluralise(1, "hour") -> "1 hour".
 */
export function pluralise(count, word, pluralWord) {
  const n = Number(count) || 0;
  const plural = pluralWord || `${word}s`;
  return `${n} ${n === 1 ? word : plural}`;
}

/**
 * Human duration: 5100 -> "1 hour, 25 minutes, 30 seconds" with correct
 * singular/plural. Returns null for a missing value so callers can show
 * "Not recorded" instead of a fabricated "0 seconds".
 *
 * @param {number|null|undefined} totalSeconds
 * @returns {string|null}
 */
export function formatDuration(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || totalSeconds === "") return null;
  const seconds = Math.max(0, Math.floor(Number(totalSeconds)));
  if (!Number.isFinite(seconds)) return null;
  if (seconds === 0) return "0 seconds";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const parts = [];
  if (hours) parts.push(pluralise(hours, "hour"));
  if (minutes) parts.push(pluralise(minutes, "minute"));
  if (secs) parts.push(pluralise(secs, "second"));
  return parts.join(", ");
}

export default {
  formatISTDateTime,
  formatISTDate,
  formatISTDateShort,
  formatDeadlineIST,
  isDeadlinePassedIST,
  formatWorkspaceDateTime,
  formatWorkspaceDate,
  formatWorkspaceDateTimeParts,
  pluralise,
  formatDuration,
};