import { Outlet } from "react-router-dom";
import { Link } from "react-router-dom";
import Navbar from "./Navbar";
import NotificationBell from "./NotificationBell";
import TechinsIcon from "./TechinsIcon";
import SpaceBackground from "./SpaceBackground";
import "./StudentLayout.css";

export default function StudentLayout(){
  let user={};
  try{user=JSON.parse(localStorage.getItem("user")||"{}")}catch{}

  return <div className="student-layout">
    {/* Cosmic space backdrop with parallax starfield */}
    <SpaceBackground />

    {/* Single fixed background logo */}
    <div className="background-logo-fixed" aria-hidden="true">
      <img src="/techins-logo.jpg" alt="" />
    </div>

    <Navbar role="student" />
    <main className="student-main">
      <header className="student-header">
        <div><span>TECHINS WORK PORTAL</span><h1>Student Workspace</h1></div>
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
      <section className="student-content"><Outlet/></section>
    </main>
  </div>
}
