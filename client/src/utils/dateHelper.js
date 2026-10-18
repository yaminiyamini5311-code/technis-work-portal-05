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

export default { formatISTDateTime, formatISTDate, formatISTDateShort, formatDeadlineIST, isDeadlinePassedIST };