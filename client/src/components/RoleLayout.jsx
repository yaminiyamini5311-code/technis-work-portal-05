import { Outlet } from "react-router-dom";
import Navbar from "./Navbar";
import NotificationBell from "./NotificationBell";
import "./RoleLayout.css";

export default function RoleLayout({role}){
  let user={};
  try{user=JSON.parse(localStorage.getItem("user")||"{}")}catch{}
  
  return <div className="role-layout">
    {/* Floating logo background */}
    <div className="floating-logo-bg" aria-hidden="true">
      <img src="/techins-logo.jpg" alt="" className="float-logo float-logo-1" />
      <img src="/techins-logo.jpg" alt="" className="float-logo float-logo-2" />
      <img src="/techins-logo.jpg" alt="" className="float-logo float-logo-3" />
    </div>
    
    <Navbar role={role} />
    <main className="role-main">
      <header className="role-topbar">
        <div><span className="role-eyebrow">TECHINS WORK PORTAL</span><h1>{role==="admin"?"Admin Workspace":"Manager Workspace"}</h1></div>
        <div className="role-top-actions">
          <NotificationBell/>
          <div className="role-top-user"><span>{user.name||"User"}</span><small>{user.email||""}</small></div>
        </div>
      </header>
      <section className="role-content"><Outlet/></section>
    </main>
  </div>
}
