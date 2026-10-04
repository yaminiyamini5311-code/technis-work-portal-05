import { NavLink } from "react-router-dom";

function Sidebar() {
  const user = JSON.parse(localStorage.getItem("user"));

  return (
    <aside className="sidebar">
      <div className="menu-title">
        WORKSPACE
      </div>

      <NavLink to="/dashboard">
        🏠 Dashboard
      </NavLink>

      <NavLink to="/tasks">
        📋 My Tasks
      </NavLink>

      <NavLink to="/mission">
        🎯 Missions
      </NavLink>

      <NavLink to="/daily-activity">
        📝 Daily Activity
      </NavLink>

      <NavLink to="/work-history">
        📚 Work History
      </NavLink>

      <NavLink to="/performance">
        📊 Performance
      </NavLink>

      <NavLink to="/activity-monitor">
        👁 Activity Monitor
      </NavLink>

      {user?.role === "admin" && (
        <>
          <div className="menu-title admin-title">
            ADMIN
          </div>

          <NavLink to="/admin">
            ⚙ Admin Dashboard
          </NavLink>
        </>
      )}
    </aside>
  );
}

export default Sidebar;