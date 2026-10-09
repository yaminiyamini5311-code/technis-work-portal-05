import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import TechinsIcon from "./TechinsIcon";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

// Shared helper to determine notification target
export function getNotificationTarget(notification, role) {
  if (!notification) return null;

  const { type, related_task_id } = notification;

  // Treat CEO as admin for routing
  const effectiveRole = role === "ceo" ? "admin" : role;

  // Registration pending notifications - navigate to pending registrations panel
  if (type === "registration_pending") {
    if (role === "admin" || role === "ceo") {
      return "/admin";  // CEO Dashboard where pending registrations panel is shown
    }
  }

  // Task-related notifications - navigate to tasks list (task detail not implemented)
  if (type === "task_assigned" || type === "task_updated" || type === "task_due" || type === "task_started" || type === "task_approved") {
    if (related_task_id) {
      if (role === "student") {
        return `/student/tasks`;
      } else if (role === "admin" || role === "manager" || role === "ceo") {
        return `/${effectiveRole}/tasks`;
      }
    }
  }

  // Review-related notifications - navigate to tasks list
  if (type === "review_required" || type === "review_approved" || type === "review_rejected" || type === "revision_required" || type === "submission_received") {
    if (related_task_id) {
      if (role === "student") {
        return `/student/tasks`;
      } else if (role === "admin" || role === "manager") {
        return `/${effectiveRole}/tasks`;
      }
    }
  }

  // Feedback notifications
  if (type === "feedback" || type === "feedback_added") {
    if (role === "student") return "/student/feedback";
    if (role === "admin" || role === "ceo") return "/admin/feedback";
    if (role === "manager") return "/manager/feedback";
  }

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

  let user = {};
  try {
    user = JSON.parse(localStorage.getItem("user") || "{}");
  } catch {}

  const role = String(user.role || "").toLowerCase();

  const load = async () => {
    try {
      const r = await fetch(`${API_URL}/api/notifications`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      const d = await r.json();
      if (r.ok) {
        setUnread(d.unread || 0);
        setItems(d.notifications || []);
      }
    } catch {}
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, []);

  const markAndNavigate = async (item) => {
    // Mark as read
    if (!item.read_at) {
      await fetch(`${API_URL}/api/notifications/${item.id}/read`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
    }

    // Navigate to target
    const target = getNotificationTarget(item, role);
    if (target) {
      navigate(target);
      setOpen(false);
    }
  };

  return (
    <div className="notification-wrap">
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
