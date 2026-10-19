/**
 * Shared client helpers for authenticated fetches, file access and status
 * presentation.
 *
 * Centralised so the Task Manager, the Live Tasks table and the student portal
 * all speak the same API shape ({ success, data, error }) and all use the same
 * one canonical status enum. Nothing here fabricates data: when a value is
 * missing the UI shows an em dash, never a placeholder row.
 */

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export function getToken() {
  return localStorage.getItem("token");
}

export function authHeaders(extra = {}) {
  const token = getToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}

/**
 * One fetch helper for the whole app.
 * Throws an Error carrying `.code` and `.status` so callers can show the exact
 * message the server sent (and a Retry action) instead of a generic failure.
 */
export async function apiFetch(path, { method = "GET", body, form, signal } = {}) {
  const headers = authHeaders();
  let payload;
  if (form) {
    // FormData: let fetch set the multipart boundary itself.
    payload = form;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    // Must be serialised: passing a plain object as the fetch body makes the
    // browser stringify it with String(), which produces the literal text
    // "[object Object]" and a 500 from body-parser on the server.
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: payload, signal });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    const err = new Error("Unable to reach the server. Check your connection and try again.");
    err.code = "NETWORK";
    throw err;
  }

  if (res.status === 204) return null;

  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }

  if (!res.ok) {
    const message = data?.error?.message || data?.message || `Request failed (${res.status}).`;
    const err = new Error(message);
    err.code = data?.error?.code || data?.code || `HTTP_${res.status}`;
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

/** `data` for the new envelope, with a fallback for legacy flat responses. */
export function unwrap(response, legacyKey) {
  if (!response) return null;
  if (response.data !== undefined && response.data !== null) return response.data;
  if (legacyKey && response[legacyKey] !== undefined) return response[legacyKey];
  return response;
}

/**
 * Canonical per-student statuses, shared by DB, API and both portals.
 * Keep in sync with server/config/taskStatus.js.
 */
export const STATUS = Object.freeze({
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  SUBMITTED: "submitted",
  APPROVED: "approved",
  REVISION_REQUIRED: "revision_required",
  RESUBMISSION_EXPIRED: "resubmission_expired",
});

export const STATUS_LABEL = Object.freeze({
  pending: "Pending",
  in_progress: "In Progress",
  submitted: "Submitted",
  approved: "Approved",
  revision_required: "Revision Required",
  resubmission_expired: "Resubmission Expired",
});

/** CSS modifier for the status chip, so both portals style one vocabulary. */
export function statusClass(status) {
  switch (status) {
    case STATUS.APPROVED: return "st-approved";
    case STATUS.SUBMITTED: return "st-submitted";
    case STATUS.IN_PROGRESS: return "st-in-progress";
    case STATUS.REVISION_REQUIRED: return "st-revision";
    case STATUS.RESUBMISSION_EXPIRED: return "st-expired";
    default: return "st-pending";
  }
}

export function formatBytes(n) {
  if (n === null || n === undefined) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Fetch a submission file WITH the Authorization header and hand back an
 * object URL. A plain <a href> cannot send the header, and the storage layer
 * (Drive / GridFS) is never exposed publicly — so every preview and every
 * download goes through the authenticated endpoint.
 */
export async function fetchFileObjectUrl(path) {
  const res = await fetch(`${API_URL}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    let message = "Unable to open this file.";
    try {
      const body = await res.json();
      message = body?.error?.message || body?.message || message;
    } catch { /* keep default */ }
    const err = new Error(message);
    err.code = res.status === 403 ? "FORBIDDEN" : res.status === 404 ? "NOT_FOUND" : `HTTP_${res.status}`;
    throw err;
  }
  return URL.createObjectURL(await res.blob());
}

/** Download a file through the authenticated endpoint and save it locally. */
export async function downloadFile(file) {
  const url = await fetchFileObjectUrl(file.download_url);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name || "submission-file";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Render a stored task/submission title without losing any character.
 *
 * Titles legitimately contain "|", "—", "’" and newlines. Rendering them
 * through a lossy transform (or a collapsing whitespace context) made
 * "…Study | Explain a Concept" read as "…Study I Explain a Concept", which
 * looked like the data had been corrupted. This returns the EXACT stored
 * string and the caller sets `white-space: pre-wrap`, so nothing is lost and
 * the pipe stays visually distinct from the letter I.
 */
export function taskTitle(value) {
  if (value === null || value === undefined) return "";
  // Normalize only the characters that survive a round trip identically and
  // strip control characters (which would break layout). Case, punctuation and
  // separators are preserved verbatim.
  // eslint-disable-next-line no-control-regex -- stripping C0 controls is the point
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\r\n/g, "\n");
}

/** Title-case a program / domain slug for display: "techins 60" → "Techins 60". */
export function titleCase(value) {
  if (!value || value === "null" || value === "undefined") return "";
  return String(value)
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Remaining time for a deadline, or null when there is none. */
export function remainingTime(deadline, now = Date.now()) {
  if (!deadline) return null;
  const due = new Date(deadline).getTime();
  if (Number.isNaN(due)) return null;
  const diff = due - now;
  const overdue = diff < 0;
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const minutes = Math.floor((abs % 3600000) / 60000);
  let text;
  if (days > 0) text = `${days}d ${hours}h`;
  else if (hours > 0) text = `${hours}h ${minutes}m`;
  else text = `${minutes}m`;
  return { overdue, label: overdue ? `Overdue by ${text}` : `${text} left`, expired: diff <= 0 };
}

export { API_URL };