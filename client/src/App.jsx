import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import LoadingPage from "./components/LoadingPage";
import Login from "./pages/Login";
import StudentLayout from "./components/StudentLayout";
import RoleLayout from "./components/RoleLayout";
import StudentDashboard from "./pages/student/StudentDashboard";
import MyTasks from "./pages/student/MyTasks";
import DailyActivity from "./pages/student/DailyActivity";
import Missions from "./pages/student/Missions";
import WorkHistory from "./pages/student/WorkHistory";
import StudentPerformance from "./pages/student/Performance";
import StudentFeedback from "./pages/student/Feedback";
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
  if (!token || !user.id) return <Navigate to="/login" replace />;
  if (role && current !== role && !(role === "student" && current === "member")) {
    return <Navigate to={current === "admin" ? "/admin" : current === "manager" ? "/manager" : "/student"} replace />;
  }
  return children;
}

export default function App() {
  return (
    <BrowserRouter><Routes>
      <Route path="/" element={<LoadingPage redirectTo="/login" duration={5000} />} />
      <Route path="/login" element={<Login />} />

    <Route element={<Protected role="student"><StudentLayout /></Protected>}>
      <Route path="/student" element={<StudentDashboard />} />
      <Route path="/student/tasks" element={<MyTasks />} />
      <Route path="/student/daily-activity" element={<DailyActivity />} />
      <Route path="/student/missions" element={<Missions />} />
      <Route path="/student/work-history" element={<WorkHistory />} />
      <Route path="/student/performance" element={<StudentPerformance />} />
      <Route path="/student/feedback" element={<StudentFeedback />} />
    </Route>

    <Route element={<Protected role="manager"><RoleLayout role="manager" /></Protected>}>
      <Route path="/manager" element={<ActivityMonitor />} />
      <Route path="/manager/tasks" element={<AdminTasks />} />
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

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes></BrowserRouter>
  );
}
