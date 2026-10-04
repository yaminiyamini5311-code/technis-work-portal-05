import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import "./Navbar.css";

export default function Navbar({ role }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  
  let user = {};
  try {
    user = JSON.parse(localStorage.getItem("user") || "{}");
  } catch {}

  const logout = () => {
    localStorage.clear();
    navigate("/login", { replace: true });
  };

  // Define navigation items based on role
  const getNavigationItems = () => {
    switch (role) {
      case "admin":
        return [
          { path: "/admin", icon: "⌂", label: "Dashboard", end: true },
          { path: "/admin/students", icon: "◉", label: "Students" },
          { path: "/admin/tasks", icon: "✓", label: "Tasks" },
          { path: "/admin/missions", icon: "◆", label: "Missions" },
          { path: "/admin/daily-activities", icon: "▤", label: "Daily Activity" },
          { path: "/admin/performance", icon: "◒", label: "Performance" },
          { path: "/admin/feedback", icon: "◌", label: "Feedback" },
          { path: "/admin/audit", icon: "▥", label: "Audit Log" }
        ];
      case "manager":
        return [
          { path: "/manager", icon: "◉", label: "Team Activity", end: true },
          { path: "/manager/tasks", icon: "✓", label: "Tasks" }
        ];
      case "student":
      case "member":
        return [
          { path: "/student", icon: "⌂", label: "Dashboard", end: true },
          { path: "/student/tasks", icon: "✓", label: "My Tasks" },
          { path: "/student/missions", icon: "◆", label: "Missions" },
          { path: "/student/daily-activity", icon: "▤", label: "Daily Activity" },
          { path: "/student/work-history", icon: "◫", label: "Work History" },
          { path: "/student/performance", icon: "◒", label: "Performance" },
          { path: "/student/feedback", icon: "◌", label: "Feedback" }
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

        {/* User Profile */}
        <div className="navbar-profile">
          <div className="navbar-avatar">
            {(user.name || role || "U").charAt(0).toUpperCase()}
          </div>
          <div>
            <strong>{user.name || "User"}</strong>
            <span>{user.email || ""}</span>
          </div>
        </div>

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
              <span>{item.icon}</span>
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
