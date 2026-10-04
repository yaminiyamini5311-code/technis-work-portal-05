import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useState } from "react";
import NotificationBell from "./NotificationBell";
import "./StudentLayout.css";

const links=[
  ["/student","⌂","Dashboard",true],
  ["/student/tasks","✓","My Tasks"],
  ["/student/missions","◆","Missions"],
  ["/student/daily-activity","▤","Daily Activity"],
  ["/student/work-history","◫","Work History"],
  ["/student/performance","◒","Performance"],
  ["/student/feedback","◌","Feedback"]
];

export default function StudentLayout(){
  const navigate=useNavigate();
  const [menuOpen,setMenuOpen]=useState(false);
  let user={};
  try{user=JSON.parse(localStorage.getItem("user")||"{}")}catch{}
  const logout=()=>{
    localStorage.clear();
    navigate("/login",{replace:true});
  };
  return <div className="student-layout">
    <button
      className="mobile-menu-button"
      type="button"
      aria-label="Open workspace navigation"
      aria-expanded={menuOpen}
      onClick={()=>setMenuOpen(true)}
    >☰</button>
    <div className={`mobile-sidebar-backdrop ${menuOpen?"show":""}`} onClick={()=>setMenuOpen(false)} />
    <aside className={`student-sidebar ${menuOpen?"mobile-open":""}`}>
      <button className="mobile-close-button" type="button" aria-label="Close navigation" onClick={()=>setMenuOpen(false)}>×</button>
      <button className="student-brand" onClick={()=>{setMenuOpen(false);navigate("/student")}}>
        <img src="/techins-logo.jpg" alt="TECHINS"/>
        <span><strong>TECHINS</strong><small>WORK PORTAL</small></span>
      </button>
      <div className="student-profile">
        <div className="student-avatar">{(user.name||"S").charAt(0).toUpperCase()}</div>
        <div><strong>{user.name||"Student"}</strong><small>Student</small></div>
      </div>
      <nav className="student-navigation">
        <p>WORKSPACE</p>
        {links.map(([path,icon,label,end])=>
          <NavLink key={path} to={path} end={end} onClick={()=>setMenuOpen(false)}>
            <span>{icon}</span>{label}
          </NavLink>
        )}
      </nav>
      <button className="student-logout" onClick={logout}>↪ <span>Logout</span></button>
    </aside>
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
