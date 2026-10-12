import { useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Navbar from "./Navbar";
import NotificationBell from "./NotificationBell";
import TechinsIcon from "./TechinsIcon";
import useCeoReveal from "./useCeoReveal";
import "./RoleLayout.css";
import "./CeoDark.css";
import "./CeoMotion.css";

export default function RoleLayout({role}){
  let user={};
  try{user=JSON.parse(localStorage.getItem("user")||"{}")}catch{}

  const rootRef = useRef(null);
  const { pathname } = useLocation();

  // CEO-only: install the single observer pair that drives entrance motion.
  // The manager portal calls this with no effect (guard inside the hook is
  // driven by the same rootRef, which we only attach on the CEO workspace).
  useCeoReveal(rootRef);

  const getWorkspaceTitle = () => {
    if (role === "admin" || role === "ceo") return "CEO Workspace";
    if (role === "manager") return "Manager Workspace";
    return "Workspace";
  };

  // `ceo-dark` is added for the CEO/admin workspace only. The manager portal
  // keeps the plain `role-layout` light theme, so the CEO dark treatment can
  // be scoped with `.role-layout.ceo-dark` and cannot leak to other portals.
  const isCeoWorkspace = role === "admin" || role === "ceo";

  return <div ref={isCeoWorkspace ? rootRef : undefined} className={`role-layout${isCeoWorkspace ? " ceo-dark" : ""}`}>
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
      {/* Keyed on pathname so the page-entry transition replays on navigation
          (a deliberate state change), without re-triggering on data re-renders. */}
      <section className="role-content" key={pathname}><Outlet/></section>
    </main>
  </div>
}
