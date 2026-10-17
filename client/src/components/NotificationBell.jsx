import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import TechinsIcon from "./TechinsIcon";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

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

  // Task-related notifications for students - navigate to their task list.
  if (role === "student" && taskId) {
    return "/student/tasks";
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

export default function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const navigate = useNavigate();
  const wrapRef = useRef(null);

  let user = {};
  try {
    user = JSON.parse(localStorage.getItem("user") || "{}");
  } catch {}

  const role = String(user.role || "").toLowerCase();

  const load = async (signal) => {
    try {
      const r = await fetch(`${API_URL}/api/notifications`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        signal
      });
      const d = await r.json();
      if (r.ok) {
        setUnread(d.unread || 0);
        setItems(d.notifications || []);
      }
    } catch {
      // Aborted on unmount/StrictMode remount, or server unreachable:
      // the bell simply keeps its previous state. No error UI here by
      // design — pages own their error states.
    }
  };

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
  }, []);

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

  const markAndNavigate = async (item) => {
    // Mark as read. Ownership is enforced server-side, so a notification that
    // belongs to someone else simply answers 404 and is ignored here.
    if (!item.read_at) {
      try {
        await fetch(`${API_URL}/api/notifications/${item.id}/read`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
        });
      } catch {
        // A failed read receipt must not block navigation.
      }
    }

    // Navigate to target
    const target = getNotificationTarget(item, role);
    if (target) {
      navigate(target);
      setOpen(false);
    }
  };

  return (
    <div className="notification-wrap" ref={wrapRef}>
      <button
        className="notification-button"
        onClick={() => setOpen(v => !v)}
        aria-label="Notifications"
        aria-expanded={open}
      >
        <TechinsIcon name="bell" size={18} variant="dark" />
        {unread > 0 && <b>{unread > 9 ? "9+" : unread}</b>}
      </button>

      {open && (
        <div className="notification-pop">
          <div>
            <h4>Notifications</h4>
            <small>{unread ? `${unread} unread` : "All caught up"}</small>
          </div>

          {items.length ? (
            items.slice(0, 7).map(item => (
              <button
                className={`notification-item ${item.read_at ? "read" : ""}`}
                key={item.id}
                onClick={() => markAndNavigate(item)}
                type="button"
              >
                <span>
                  <TechinsIcon
                    name={item.type === "task_assigned" ? "check" : "target"}
                    size={14}
                    variant="dark"
                  />
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.message}</small>
                </div>
              </button>
            ))
          ) : (
            <p className="notification-empty">No notifications yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
