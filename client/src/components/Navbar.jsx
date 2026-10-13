import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import TechinsIcon from "./TechinsIcon";
import "./Navbar.css";

const readStoredUser = () => {
  try { return JSON.parse(localStorage.getItem("user") || "{}"); } catch { return {}; }
};

/* Single open/closed state for the nav drawer, shared by the header
   toggle button and the drawer itself. Layouts compose:
     <NavProvider><Navbar role={r}/><main>…<header><NavbarToggle/>…</header></main></NavProvider>
   so the hamburger sits in-flow inside the header (no floating button,
   no reserved gap) while open/close behavior stays in one place. */
const NavContext = createContext({ menuOpen: false, setMenuOpen: () => {} });

export function NavProvider({ children }) {
  // Closed by default: only the header toggle is visible on load.
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();

  // Close the drawer on route change (covers back/forward navigation,
  // where no NavLink onClick fires).
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  // Escape closes the drawer; body scroll locks while it is open so the
  // overlay never traps the page underneath on mobile/tablet.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  return <NavContext.Provider value={{ menuOpen, setMenuOpen }}>{children}</NavContext.Provider>;
}

/* In-header hamburger — the only drawer opener. Rendered in-flow as the
   first header item so it occupies a predictable spot and never overlaps
   content. White bars come from Navbar.css per-portal overrides. */
export function NavbarToggle({ className = "" }) {
  const { menuOpen, setMenuOpen } = useContext(NavContext);
  return (
    <button
      className={`navbar-hamburger ${className}`.trim()}
      type="button"
      aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
      aria-expanded={menuOpen}
      aria-controls="techins-nav-menu"
      onClick={() => setMenuOpen((v) => !v)}
    >
      <span></span>
      <span></span>
      <span></span>
    </button>
  );
}

export default function Navbar({ role }) {
  const { menuOpen, setMenuOpen } = useContext(NavContext);
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
          { path: "/admin/submissions", icon: "upload", label: "Submissions" },
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
          { path: "/manager/submissions", icon: "upload", label: "Submissions" },
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
      {/* Backdrop — outside click closes on mobile/tablet/desktop */}
      <div
        className={`navbar-backdrop ${menuOpen ? "show" : ""}`}
        onClick={() => setMenuOpen(false)}
        aria-hidden={!menuOpen}
      />

      {/* Navigation Menu — overlay drawer; page content keeps full width
          underneath (see RoleLayout/StudentLayout margin-left:0) so the
          drawer never covers content unexpectedly without the backdrop. */}
      <nav id="techins-nav-menu" className={`navbar-menu ${menuOpen ? "open" : ""}`} aria-hidden={!menuOpen}>
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
