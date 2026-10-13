import { useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Navbar, { NavProvider, NavbarToggle } from "./Navbar";
import NotificationBell from "./NotificationBell";
import TechinsIcon from "./TechinsIcon";
import CeoStars from "./CeoStars";
import useCeoReveal, { MANAGER_REVEAL_CONFIG } from "./useCeoReveal";
import "./CeoStars.css";
import "./RoleLayout.css";
import "./CeoDark.css";
import "./CeoMotion.css";
import "./ManagerMotion.css";

export default function RoleLayout({role}){
  let user={};
  try{user=JSON.parse(localStorage.getItem("user")||"{}")}catch{}

  const rootRef = useRef(null);
  const { pathname } = useLocation();

  // `ceo-dark` is added for the CEO/admin workspace only. The manager portal
  // keeps the plain `role-layout` light theme, so the CEO dark treatment can
  // be scoped with `.role-layout.ceo-dark` and cannot leak to other portals.
  const isCeoWorkspace = role === "admin" || role === "ceo";
  const isManagerWorkspace = role === "manager";

  // Entrance motion: CEO uses the default (CEO) reveal config; the manager
  // portal uses the manager config, which targets the manager's light-theme
  // markup through the same observer machinery (scoped by `.manager-motion`
  // in ManagerMotion.css, so neither theme leaks into the other portal).
  // The hook itself always runs; only its selector config differs per
  // portal, so the rules-of-hooks are satisfied in both workspaces.
  useCeoReveal(rootRef, isManagerWorkspace ? MANAGER_REVEAL_CONFIG : undefined);

  const getWorkspaceTitle = () => {
    if (role === "admin" || role === "ceo") return "CEO Workspace";
    if (role === "manager") return "Manager Workspace";
    return "Workspace";
  };

  return <div ref={isCeoWorkspace || isManagerWorkspace ? rootRef : undefined} className={`role-layout${isCeoWorkspace ? " ceo-dark" : ""}${isManagerWorkspace ? " manager-motion" : ""}`}>
    <NavProvider>
    {/* CEO-only starfield: single fixed layer behind content (see CeoStars).
        Manager keeps the plain light theme — no stars, no dark treatment. */}
    {isCeoWorkspace && <CeoStars />}
    {/* CEO background logo: same asset the login page shows
        (/techins-logo-full.jpg), once, centered, behind all UI. */}
    {isCeoWorkspace && (
      <div className="ceo-logo-bg" aria-hidden="true">
        <img src="/techins-logo-full.jpg" alt="" />
      </div>
    )}
    <Navbar role={role} />
    <main className="role-main">
      <header className="role-topbar">
        {/* Hamburger is the first in-flow header item: full-width header
            with no reserved gap when the drawer is closed. */}
        <div className="role-topbar-lead"><NavbarToggle /><div><span className="role-eyebrow">TECHINS WORK PORTAL</span><h1>{getWorkspaceTitle()}</h1></div></div>
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
    </NavProvider>
  </div>
}
