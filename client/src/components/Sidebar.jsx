import { NavLink } from "react-router-dom";
import TechinsIcon from "./TechinsIcon";

function Sidebar() {
  const user = JSON.parse(localStorage.getItem("user"));

  return (
    <aside className="sidebar">
      <div className="menu-title">
        WORKSPACE
      </div>

      <NavLink to="/dashboard">
        <TechinsIcon name="home" size={18} variant="light" /> Dashboard
      </NavLink>

      <NavLink to="/tasks">
        <TechinsIcon name="clipboard" size={18} variant="light" /> My Tasks
      </NavLink>

      <NavLink to="/mission">
        <TechinsIcon name="target" size={18} variant="light" /> Missions
      </NavLink>

      <NavLink to="/daily-activity">
        <TechinsIcon name="notepad" size={18} variant="light" /> Daily Activity
      </NavLink>

      <NavLink to="/work-history">
        <TechinsIcon name="history" size={18} variant="light" /> Work History
      </NavLink>

      <NavLink to="/performance">
        <TechinsIcon name="gauge" size={18} variant="light" /> Performance
      </NavLink>

      <NavLink to="/activity-monitor">
        <TechinsIcon name="search" size={18} variant="light" /> Activity Monitor
      </NavLink>

      {user?.role === "admin" && (
        <>
          <div className="menu-title admin-title">
            ADMIN
          </div>

          <NavLink to="/admin">
            <TechinsIcon name="grid" size={18} variant="light" /> Admin Dashboard
          </NavLink>
        </>
      )}
    </aside>
  );
}

export default Sidebar;