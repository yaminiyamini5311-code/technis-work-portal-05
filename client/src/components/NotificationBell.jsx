import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import TechinsIcon from "./TechinsIcon";
import { apiFetch } from "../utils/api";
import "./NotificationBell.css";

/**
 * Notification bell and panel.
 *
 * The panel is themed for the dark navy workspace in NotificationBell.css —
 * including the CEO workspace, where the previous light-theme rule
 * (`.notification-pop{background:#FFFFFF}`) left near-white text on a white
 * panel and pale-peach icons. There are no light backgrounds left in this
 * component.
 *
 * The API is unchanged: GET /api/notifications, PATCH /api/notifications/:id/read
 * and POST /api/notifications/read-all. Mark-all-read only appears when the
 * API reports unread rows.
 */

// Shared helper to determine notification target
export function getNotificationTarget(notification, role) {
  if (!notification) return null;

  const { type, related_task_id, task_id, action_url, deep_link } = notification;

  // Treat CEO as admin for routing
  const effectiveRole = role === "ceo" ? "admin" : role;
  const isReviewer = role === "admin" || role === "ceo" || role === "manager";
  const base = role === "ceo" ? "admin" : role;
  // The backend stores the deep link it computed for this notification.
  // Honouring it means a click lands on the exact view that needs attention
  // (e.g. the Task Manager for one task) instead of a generic list.
  if (deep_link || action_url) return deep_link || action_url;

  const taskId = task_id || related_task_id;

  // Registration pending notifications - navigate to pending registrations panel
  if (type === "registration_pending") {
    if (role === "admin" || role === "ceo") {
      return "/admin";  // CEO Dashboard where pending registrations panel is shown
    }
  }

  // Workflow notifications about one task land the reviewer directly in that
  // task's Task Manager, where the four tabs and the counts live.
  if (isReviewer && taskId) {
    if (["revision_required", "submission_received", "resubmission_received", "resubmission_expired_admin"].includes(type)) {
      return `/${base}/tasks/${taskId}/review`;
    }
    return `/${base}/tasks`;
  }

  // Mission notifications deep link to the student's own mission list.
  if (type === "mission_assigned" || type === "mission_rescheduled") {
    if (role === "student") return "/student/missions";
  }

  // Task-related notifications for students land on that task's own page
  // (/student/tasks/:taskId), where the live timer, the resubmit section and
  // the revision countdown are. A notification without a task keeps the list.
  if (role === "student" && taskId) {
    return `/student/tasks/${taskId}`;
  }

  // Feedback notifications
  if (type === "feedback" || type === "feedback_added") {
    if (role === "student") return "/student/feedback";
    if (role === "admin" || role === "ceo") return "/admin/feedback";
    if (role === "manager") return "/manager/feedback";
  }

  void effectiveRole;

  // Default: navigate to portal's feedback page (notifications page equivalent)
  if (role === "student") return "/student/feedback";
  if (role === "admin" || role === "ceo") return "/admin/feedback";
  if (role === "manager") return "/manager/feedback";

  return null;
}

/** "just now" / "12m" / "3h" / "5d" — never a wall of full dates. */
function relativeTime(value) {
  if (!value) return "";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

const ICON_FOR_TYPE = {
  task_assigned: "check",
  task_approved: "check",
  revision_required: "refresh",
  submission_received: "target",
  resubmission_received: "target",
  feedback: "star",
  feedback_added: "star",
  mission_assigned: "target",
  mission_rescheduled: "refresh",
};

export default function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [markingAll, setMarkingAll] = useState(false);
  const navigate = useNavigate();
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);

  let user = {};
  try {
    user = JSON.parse(localStorage.getItem("user") || "{}");
  } catch {}

  const role = String(user.role || "").toLowerCase();

  const load = useCallback(async (signal) => {
    try {
      const d = await apiFetch("/api/notifications", { signal });
      setUnread(d?.data?.unread ?? d?.unread ?? 0);
      setItems(d?.data?.notifications ?? d?.notifications ?? []);
    } catch {
      // Aborted on unmount/StrictMode remount, or server unreachable:
      // the bell simply keeps its previous state. No error UI here by
      // design — pages own their error states.
    }
  }, []);

  // Single effect owner with abort + interval cleanup. In dev StrictMode
  // mounts twice: the first request is aborted on cleanup, so only one
  // response ever lands. No state deps → no loops.
  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    const id = setInterval(() => {
      if (document.hidden) return; // pause polling on hidden tabs
      load(ctrl.signal);
    }, 20000);
    return () => { clearInterval(id); ctrl.abort(); };
  }, [load]);

  // Close the panel on outside click and on Escape (keyboard parity with
  // the nav drawer). Only bound while the panel is open.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Focus moves into the panel when it opens and returns to the bell on close.
  useEffect(() => {
    if (open) listRef.current?.focus?.({ preventScroll: true });
    else buttonRef.current?.focus?.({ preventScroll: true });
  }, [open]);

  const markAndNavigate = async (item) => {
    // Mark as read. Ownership is enforced server-side, so a notification that
    // belongs to someone else simply answers 404 and is ignored here.
    if (!item.read_at) {
      try {
        await apiFetch(`/api/notifications/${item.id}/read`, { method: "PATCH" });
      } catch {
        // A failed read receipt must not block navigation.
      }
      setItems(rows => rows.map(r => (r.id === item.id ? { ...r, read_at: new Date().toISOString() } : r)));
      setUnread(n => Math.max(0, n - 1));
    }

    // Navigate to target
    const target = getNotificationTarget(item, role);
    if (target) {
      navigate(target);
      setOpen(false);
    }
  };

  const markAllRead = async () => {
    if (markingAll || unread === 0) return;
    setMarkingAll(true);
    try {
      await apiFetch("/api/notifications/read-all", { method: "POST" });
      const stamp = new Date().toISOString();
      setItems(rows => rows.map(r => ({ ...r, read_at: r.read_at || stamp })));
      setUnread(0);
    } catch {
      // Leave the list exactly as it is; the next poll restores the truth.
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <div className="notification-wrap" ref={wrapRef}>
      <button
        type="button"
        ref={buttonRef}
        className="notification-button"
        onClick={() => setOpen(v => !v)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <TechinsIcon name="bell" size={18} variant="light" />
        {unread > 0 && <b>{unread > 9 ? "9+" : unread}</b>}
      </button>

      {open && (
        <div className="notification-pop" role="dialog" aria-label="Notifications" tabIndex={-1} ref={listRef}>
          <div className="notification-head">
            <div>
              <strong>Notifications</strong>
              <small>{unread ? `${unread} unread` : "All caught up"}</small>
            </div>
            {unread > 0 && (
              <button type="button" className="notification-mark-all" onClick={markAllRead} disabled={markingAll}>
                {markingAll ? "Marking…" : "Mark all read"}
              </button>
            )}
          </div>

          <div className="notification-list">
            {items.length ? (
              items.map(item => {
                const isRead = Boolean(item.read_at);
                const open = () => markAndNavigate(item);
                return (
                  /* A div with role="button" rather than a <button>: the design
                     system has a global `button * { color: inherit !important }`
                     reset ("Ensure Text Never Disappears") that flattens every
                     descendant of a button to a single colour. That is what
                     stopped the title, body and timestamp from ever differing.
                     Keyboard parity is preserved explicitly below. */
                  <div
                    className={`notification-item ${isRead ? "read" : "unread"}`}
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={open}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
                        e.preventDefault();
                        open();
                      }
                    }}
                    aria-label={`${isRead ? "" : "Unread: "}${item.title}. ${item.message}`}
                  >
                    <span className="notification-tile" aria-hidden="true">
                      <TechinsIcon name={ICON_FOR_TYPE[item.type] || "bell"} size={14} variant="light" />
                    </span>
                    <span className="notification-body">
                      <span className="notification-row">
                        <strong>{item.title}</strong>
                        <time dateTime={item.created_at || undefined}>{relativeTime(item.created_at)}</time>
                      </span>
                      <small>{item.message}</small>
                    </span>
                    {!isRead && <span className="notification-dot" aria-hidden="true" />}
                  </div>
                );
              })
            ) : (
              <p className="notification-empty">No notifications yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}