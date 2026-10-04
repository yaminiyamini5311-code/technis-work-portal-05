import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useState } from "react";
import NotificationBell from "./NotificationBell";
import "./RoleLayout.css";

const roleMenus={
  admin:[
    ["/admin","⌂","Dashboard",true],
    ["/admin/students","◉","Students"],
    ["/admin/tasks","✓","Tasks"],
    ["/admin/missions","◆","Missions"],
    ["/admin/daily-activities","▤","Daily Activity"],
    ["/admin/performance","◒","Performance"],
    ["/admin/feedback","◌","Feedback"],
    ["/admin/audit","▥","Audit Log"]
  ],
  manager:[
    ["/manager","◉","Team Activity",true],
    ["/manager/tasks","✓","Tasks"]
  ]
};

export default function RoleLayout({role}){
  const navigate=useNavigate();
  const [menuOpen,setMenuOpen]=useState(false);
  let user={};
  try{user=JSON.parse(localStorage.getItem("user")||"{}")}catch{}
  const logout=()=>{
    localStorage.clear();
    navigate("/login",{replace:true});
  };
  return <div className="role-layout">
    <button
      className="mobile-menu-button role-mobile-menu"
      type="button"
      aria-label="Open workspace navigation"
      aria-expanded={menuOpen}
      onClick={()=>setMenuOpen(true)}
    >☰</button>
    <div className={`mobile-sidebar-backdrop ${menuOpen?"show":""}`} onClick={()=>setMenuOpen(false)} />
    <aside className={`role-sidebar ${menuOpen?"mobile-open":""}`}>
      <button className="mobile-close-button" type="button" aria-label="Close navigation" onClick={()=>setMenuOpen(false)}>×</button>
      <button className="role-brand" onClick={()=>{setMenuOpen(false);navigate(role==="admin"?"/admin":"/manager")}}>
        <img src="/techins-logo.jpg" alt="TECHINS"/>
        <span><strong>TECHINS</strong><small>WORK PORTAL</small></span>
      </button>
      <div className="role-user">
        <div className="role-avatar">{(user.name||role).charAt(0).toUpperCase()}</div>
        <div><strong>{user.name||role}</strong><span>{role}</span></div>
      </div>
      <nav className="role-nav">
        <p>WORKSPACE</p>
        {roleMenus[role].map(([path,icon,label,end])=>
          <NavLink key={path} to={path} end={end} onClick={()=>setMenuOpen(false)}>
            <span>{icon}</span>{label}
          </NavLink>
        )}
      </nav>
      <button className="role-logout" onClick={logout}>↪ <span>Logout</span></button>
    </aside>
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
