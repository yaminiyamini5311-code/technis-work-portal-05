import { Outlet } from "react-router-dom";
import Navbar from "./Navbar";
import NotificationBell from "./NotificationBell";
import "./StudentLayout.css";

export default function StudentLayout(){
  let user={};
  try{user=JSON.parse(localStorage.getItem("user")||"{}")}catch{}
  
  return <div className="student-layout">
    {/* Floating logo background */}
    <div className="floating-logo-bg" aria-hidden="true">
      <img src="/techins-logo.jpg" alt="" className="float-logo float-logo-1" />
      <img src="/techins-logo.jpg" alt="" className="float-logo float-logo-2" />
      <img src="/techins-logo.jpg" alt="" className="float-logo float-logo-3" />
    </div>
    
    <Navbar role="student" />
    <main className="student-main">
      <header className="student-header">
        <div><span>TECHINS WORK PORTAL</span><h1>Student Workspace</h1></div>
        <div className="student-header-actions">
          <NotificationBell/>
          <div className="student-header-user"><strong>{user.name||"Student"}</strong><small>{user.email||""}</small></div>
        </div>
      </header>
      <section className="student-content"><Outlet/></section>
    </main>
  </div>
}
