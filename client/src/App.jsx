import { useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import TechinsLoader from "./components/TechinsLoader";
import Login from "./pages/Login";
import Register from "./pages/Register";
import StudentLayout from "./components/StudentLayout";
import RoleLayout from "./components/RoleLayout";
import StudentDashboard from "./pages/student/StudentDashboard";
import MyTasks from "./pages/student/MyTasks";
import DailyActivity from "./pages/student/DailyActivity";
import Missions from "./pages/student/Missions";
import WorkHistory from "./pages/student/WorkHistory";
import StudentPerformance from "./pages/student/Performance";
import StudentFeedback from "./pages/student/Feedback";
import Profile from "./pages/student/Profile";
import ActivityMonitor from "./pages/manager/ActivityMonitor";
import AdminDashboard from "./pages/admin/AdminDashboard";
import Students from "./pages/admin/Students";
import AdminTasks from "./pages/admin/Tasks";
import AdminMissions from "./pages/admin/Missions";
import DailyActivities from "./pages/admin/DailyActivities";
import Feedback from "./pages/admin/feedback";
import AdminPerformance from "./pages/admin/performance";
import AuditLogs from "./pages/admin/AuditLogs";

function Protected({ role, children }) {
  const token = localStorage.getItem("token");
  let user = {};
  try { user = JSON.parse(localStorage.getItem("user") || "{}"); } catch {}
  const current = String(user.role || "").toLowerCase();
  // Treat CEO as admin for routing
  const effectiveRole = current === "ceo" ? "admin" : current;
  if (!token || !user.id) return <Navigate to="/login" replace />;
  if (role && effectiveRole !== role && !(role === "student" && effectiveRole === "member")) {
    return <Navigate to={effectiveRole === "admin" ? "/admin" : effectiveRole === "manager" ? "/manager" : "/student"} replace />;
  }
  return children;
}

export default function App() {
  const [booting, setBooting] = useState(true);
  return (
    <>
      {booting && <TechinsLoader duration={3000} onDone={() => setBooting(false)} />}
      <BrowserRouter><Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

    <Route element={<Protected role="student"><StudentLayout /></Protected>}>
      <Route path="/student" element={<StudentDashboard />} />
      <Route path="/student/tasks" element={<MyTasks />} />
      <Route path="/student/daily-activity" element={<DailyActivity />} />
      <Route path="/student/missions" element={<Missions />} />
      <Route path="/student/work-history" element={<WorkHistory />} />
      <Route path="/student/performance" element={<StudentPerformance />} />
      <Route path="/student/feedback" element={<StudentFeedback />} />
      <Route path="/student/profile" element={<Profile />} />
    </Route>

    <Route element={<Protected role="manager"><RoleLayout role="manager" /></Protected>}>
      <Route path="/manager" element={<ActivityMonitor />} />
      <Route path="/manager/students" element={<Students />} />
      <Route path="/manager/tasks" element={<AdminTasks />} />
      <Route path="/manager/missions" element={<AdminMissions />} />
      <Route path="/manager/daily-activities" element={<DailyActivities />} />
      <Route path="/manager/performance" element={<AdminPerformance />} />
      <Route path="/manager/feedback" element={<Feedback />} />
    </Route>

    <Route element={<Protected role="admin"><RoleLayout role="admin" /></Protected>}>
      <Route path="/admin" element={<AdminDashboard />} />
      <Route path="/admin/students" element={<Students />} />
      <Route path="/admin/tasks" element={<AdminTasks />} />
      <Route path="/admin/missions" element={<AdminMissions />} />
      <Route path="/admin/daily-activities" element={<DailyActivities />} />
      <Route path="/admin/performance" element={<AdminPerformance />} />
      <Route path="/admin/feedback" element={<Feedback />} />
      <Route path="/admin/audit" element={<AuditLogs />} />
    </Route>

    {/* Redirect old CEO routes to Admin */}
    <Route path="/ceo" element={<Navigate to="/admin" replace />} />
    <Route path="/ceo/*" element={<Navigate to="/admin" replace />} />

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes></BrowserRouter>
    </>
  );
}
