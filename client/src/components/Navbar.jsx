import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import TechinsIcon from "./TechinsIcon";
import "./Navbar.css";

const readStoredUser = () => {
  try { return JSON.parse(localStorage.getItem("user") || "{}"); } catch { return {}; }
};

export default function Navbar({ role }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  // Held in state (not read inline) so a profile save can refresh the
  // displayed name immediately instead of on the next full reload.
  const [user, setUser] = useState(readStoredUser);

  useEffect(() => {
    setUser(readStoredUser());
    const onUserUpdated = () => setUser(readStoredUser());
    window.addEventListener("techins:user-updated", onUserUpdated);
    return () => window.removeEventListener("techins:user-updated", onUserUpdated);
  }, []);

  const logout = () => {
    localStorage.clear();
    navigate("/login", { replace: true });
  };

  // The profile page lives under the portal that owns this navbar.
  // CEO and admin share the /admin portal (see the /ceo redirect in App.jsx).
  // null => no profile page for this role, render the static block instead.
  const profilePath = role === "admin" || role === "ceo" ? "/admin/profile" : null;

  // Define navigation items based on role
  const getNavigationItems = () => {
    switch (role) {
      case "admin":
        return [
          { path: "/admin", icon: "home", label: "Dashboard", end: true },
          { path: "/admin/students", icon: "user", label: "Students" },
          { path: "/admin/tasks", icon: "clipboard", label: "Tasks" },
          { path: "/admin/missions", icon: "target", label: "Missions" },
          { path: "/admin/daily-activities", icon: "notepad", label: "Daily Activity" },
          { path: "/admin/performance", icon: "gauge", label: "Performance" },
          { path: "/admin/feedback", icon: "comment", label: "Feedback" },
          { path: "/admin/audit", icon: "history", label: "Audit Log" }
        ];
      case "manager":
        return [
          { path: "/manager", icon: "home", label: "Dashboard", end: true },
          { path: "/manager/monitor", icon: "grid", label: "Activity Monitor" },
          { path: "/manager/students", icon: "user", label: "Students" },
          { path: "/manager/tasks", icon: "clipboard", label: "Tasks" },
          { path: "/manager/missions", icon: "target", label: "Missions" },
          { path: "/manager/daily-activities", icon: "notepad", label: "Daily Activity" },
          { path: "/manager/performance", icon: "gauge", label: "Performance" },
          { path: "/manager/feedback", icon: "comment", label: "Feedback" }
        ];
      case "student":
      case "member":
        return [
          { path: "/student", icon: "home", label: "Dashboard", end: true },
          { path: "/student/tasks", icon: "clipboard", label: "My Tasks" },
          { path: "/student/missions", icon: "target", label: "Missions" },
          { path: "/student/daily-activity", icon: "notepad", label: "Daily Activity" },
          { path: "/student/work-history", icon: "history", label: "Work History" },
          { path: "/student/performance", icon: "gauge", label: "Performance" },
          { path: "/student/feedback", icon: "comment", label: "Feedback" }
        ];
      default:
        return [];
    }
  };

  const navigationItems = getNavigationItems();

  return (
    <>
      {/* Hamburger Button */}
      <button
        className="navbar-hamburger"
        type="button"
        aria-label="Open navigation menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(true)}
      >
        <span></span>
        <span></span>
        <span></span>
      </button>

      {/* Backdrop */}
      <div
        className={`navbar-backdrop ${menuOpen ? "show" : ""}`}
        onClick={() => setMenuOpen(false)}
      />

      {/* Navigation Menu */}
      <nav className={`navbar-menu ${menuOpen ? "open" : ""}`}>
        {/* Close Button */}
        <button
          className="navbar-close"
          type="button"
          aria-label="Close navigation menu"
          onClick={() => setMenuOpen(false)}
        >
          ×
        </button>

        {/* Brand */}
        <div className="navbar-brand">
          <img src="/techins-logo.jpg" alt="TECHINS" />
          <div>
            <strong>TECHINS</strong>
            <small>WORK PORTAL</small>
          </div>
        </div>

        {/* User Profile — for the CEO/admin portal this links to the profile
            page (it was a plain <div>, so it looked clickable but did nothing).
            The manager portal has no profile page yet, so it keeps the static
            block rather than linking to a route that does not exist. */}
        {profilePath ? (
          <NavLink to={profilePath} className="navbar-profile" onClick={() => setMenuOpen(false)}>
            <div className="navbar-avatar">
              {(user.name || role || "U").charAt(0).toUpperCase()}
            </div>
            <div>
              <strong>{user.name || "User"}</strong>
              <span>{user.email || ""}</span>
            </div>
          </NavLink>
        ) : (
          <div className="navbar-profile">
            <div className="navbar-avatar">
              {(user.name || role || "U").charAt(0).toUpperCase()}
            </div>
            <div>
              <strong>{user.name || "User"}</strong>
              <span>{user.email || ""}</span>
            </div>
          </div>
        )}

        {/* Navigation Links */}
        <div className="navbar-links">
          <p>WORKSPACE</p>
          {navigationItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              onClick={() => setMenuOpen(false)}
            >
              <span><TechinsIcon name={item.icon} size={16} variant="dark" /></span>
              {item.label}
            </NavLink>
          ))}
        </div>

        {/* Logout Button */}
        <button className="navbar-logout" onClick={logout}>
          <span>↪</span>
          Logout
        </button>
      </nav>
    </>
  );
}
