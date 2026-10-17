/**
 * Server-side IST formatting.
 *
 * The resubmission deadline is a UTC instant computed from the SERVER clock
 * and must be shown to students and admins in the same timezone the rest of the
 * portal uses (Asia/Kolkata, see client/src/utils/dateHelper.js). Formatting it
 * here — not in the client — means the string inside the notification message
 * and the string on the eligibility endpoint can never disagree.
 */

const IST = "Asia/Kolkata";

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: IST,
});

/** "Tue, 20 Oct 2026, 18:30 IST" — used inside notification messages. */
function formatISTDeadlineLabel(value) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${dateTimeFormatter.format(date)} IST`;
}

module.exports = { IST, formatISTDeadlineLabel };