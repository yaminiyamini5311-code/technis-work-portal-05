import { Outlet } from "react-router-dom";
import { Link } from "react-router-dom";
import Navbar, { NavProvider, NavbarToggle } from "./Navbar";
import NotificationBell from "./NotificationBell";
import TechinsIcon from "./TechinsIcon";
import SpaceBackground from "./SpaceBackground";
import RegistrationStatusGate from "./RegistrationStatusGate";
import "./StudentLayout.css";

export default function StudentLayout(){
  let user={};
  try{user=JSON.parse(localStorage.getItem("user")||"{}")}catch{}

  // NOTE: the brand loader (TechinsLoader) plays exactly once at app boot
  // in App.jsx for every portal, including the student portal. A second
  // loader instance here used to replay the full 6.5s sequence on every
  // student navigation (~13s total) and read as a duplicated loader, so it
  // was removed. The student entry flow is: App loader (logo + hexagon
  // portal + outward wave) -> this layout renders normally.
  return (
    <RegistrationStatusGate>
      <div className="student-layout">
          {/* Cosmic space backdrop with parallax starfield */}
          <SpaceBackground />

          {/* Single fixed background logo */}
          <div className="background-logo-fixed" aria-hidden="true">
            <img src="/techins-logo.jpg" alt="" />
          </div>

          <NavProvider>
          <Navbar role="student" />
          {/* Sibling of <main>, for the same reason as RoleLayout: an ancestor
              with `transform` / `perspective` becomes the containing block for
              `position: fixed` descendants and the bar scrolls away with the
              page. */}
          <header className="student-header">
            <div className="student-header-lead"><NavbarToggle /><div><span>TECHINS WORK PORTAL</span><h1>Student Workspace</h1></div></div>
            <div className="student-header-actions">
              <NotificationBell/>
              <Link to="/student/profile" style={{ textDecoration: 'none' }}>
                <div className="student-header-user">
                  <TechinsIcon name="user" size={20} variant="dark" />
                  <div>
                    <strong>{user.name||"Student"}</strong>
                    <small>{user.email||""}</small>
                  </div>
                </div>
              </Link>
            </div>
          </header>
          <main className="student-main">
            <section className="student-content"><Outlet/></section>
          </main>
          </NavProvider>
      </div>
    </RegistrationStatusGate>
  );
}
