import { Outlet } from "react-router-dom";
import Navbar from "./Navbar";
import NotificationBell from "./NotificationBell";
import TechinsIcon from "./TechinsIcon";
import "./RoleLayout.css";

export default function RoleLayout({role}){
  let user={};
  try{user=JSON.parse(localStorage.getItem("user")||"{}")}catch{}

  const getWorkspaceTitle = () => {
    if (role === "admin" || role === "ceo") return "CEO Workspace";
    if (role === "manager") return "Manager Workspace";
    return "Workspace";
  };

  return <div className="role-layout">
    <Navbar role={role} />
    <main className="role-main">
      <header className="role-topbar">
        <div><span className="role-eyebrow">TECHINS WORK PORTAL</span><h1>{getWorkspaceTitle()}</h1></div>
        <div className="role-top-actions">
          <NotificationBell/>
          <div className="role-top-user">
            <TechinsIcon name="user" size={16} variant="light" />
            <div>
              <span>{user.name||"User"}</span>
              <small>{user.email||""}</small>
            </div>
          </div>
        </div>
      </header>
      <section className="role-content"><Outlet/></section>
    </main>
  </div>
}
