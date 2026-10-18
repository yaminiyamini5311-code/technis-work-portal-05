/**
 * One status vocabulary for the whole workspace.
 *
 * Before this existed every page mapped a status to its own colour: the tasks
 * table used `.st.st-pending`, submissions used `.pill.submitted`, performance
 * used `.perf-status`, feedback used `.fb-status`. Same value, five different
 * colours, and none of them matched.
 *
 * `STATUS_TONE` is the single mapping from a status value to a tone, and the
 * tones resolve to the `--ui-st-*` tokens in styles/ceo-ui.css. The LABEL is
 * display text only — the underlying status VALUE is never changed, derived or
 * reinterpreted.
 */
import "../styles/ceo-ui.css";

/** Canonical status value -> tone. Keys match server/config/taskStatus.js. */
export const STATUS_TONE = Object.freeze({
  approved: "approved",
  // Approved work that a reviewer has since reopened for edits still reads as
  // approved until it is resubmitted.
  pending: "pending",
  assigned: "pending",
  in_progress: "progress",
  draft: "pending",
  submitted: "submitted",
  revision_required: "revision",
  resubmitted: "submitted",
  resubmission_expired: "expired",
  overdue: "expired",
  under_review: "submitted",
  cancelled: "expired",
  archived: "expired",
});

const TONE_LABEL = Object.freeze({
  approved: "Approved",
  pending: "Pending",
  progress: "In Progress",
  submitted: "Submitted",
  revision: "Revision Required",
  expired: "Expired",
});

/**
 * Map any status string to a tone. Unknown values fall back to `pending`
 * rather than disappearing, so a new status is visible rather than invisible.
 */
export function toneFor(status) {
  if (status == null) return "pending";
  const key = String(status).trim().toLowerCase().replace(/\s+/g, "_");
  return STATUS_TONE[key] || "pending";
}

export function labelForTone(tone) {
  return TONE_LABEL[tone] || TONE_LABEL.pending;
}

/**
 * A status chip.
 *
 * @param {string} status  the raw status value from the API (never modified)
 * @param {object} [opts]
 * @param {string} [opts.label] override the display text
 * @param {boolean} [opts.count] render `label (n)`
 * @param {number} [opts.n] the count to render with `count`
 */
export default function StatusBadge({ status, label, count, title }) {
  const tone = toneFor(status);
  const text = label || labelForTone(tone);
  return (
    <span className={`ui-chip ui-chip--${tone}`} title={title || text}>
      {count != null ? `${count} ${text}` : text}
    </span>
  );
}