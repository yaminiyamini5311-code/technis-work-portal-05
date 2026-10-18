import { useState, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import TechinsLoader, { LOADER_DURATION_MS } from "./components/TechinsLoader";
import Login from "./pages/Login";
import Register from "./pages/Register";
import StudentLayout from "./components/StudentLayout";
import RoleLayout from "./components/RoleLayout";
import StudentDashboard from "./pages/student/StudentDashboard";
import MyTasks from "./pages/student/MyTasks";
import TaskDetail from "./pages/student/TaskDetail";
import DailyActivity from "./pages/student/DailyActivity";
import Missions from "./pages/student/Missions";
import WorkHistory from "./pages/student/WorkHistory";
import StudentPerformance from "./pages/student/Performance";
import StudentFeedback from "./pages/student/Feedback";
import Profile from "./pages/student/Profile";
import ActivityMonitor from "./pages/manager/ActivityMonitor";
import ManagerDashboard from "./pages/manager/ManagerDashboard";
import AdminDashboard from "./pages/admin/AdminDashboard";
import Students from "./pages/admin/Students";
import AdminTasks from "./pages/admin/Tasks";
import AdminMissions from "./pages/admin/Missions";
import DailyActivities from "./pages/admin/DailyActivities";
import Feedback from "./pages/admin/feedback";
import AdminPerformance from "./pages/admin/performance";
import AuditLogs from "./pages/admin/AuditLogs";
import AdminProfile from "./pages/admin/Profile";
import AdminSubmissions from "./pages/admin/Submissions";
import StudentDetailsPage from "./pages/admin/StudentDetailsPage";
import TaskReview from "./pages/admin/TaskReview";
import ManagerSubmissions from "./pages/manager/Submissions";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

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

/**
 * Alias for the canonical student task route. Notifications and deep links may
 * arrive as /tasks/:taskId; the real page lives under the existing student
 * router convention (/student/tasks/:taskId). The id is preserved verbatim.
 */
function TaskAliasRedirect() {
  const { taskId } = useParams();
  return <Navigate to={`/student/tasks/${taskId}`} replace />;
}

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [booted, setBooted] = useState(false);

  // Restore auth on load: verify the stored token with /me before
  // route guards decide. Clears stale tokens (expired, server restart
  // with rotated secret, deactivated account).
  // Note: in dev React StrictMode mounts this effect twice, so /me fires
  // twice — the first request is aborted on cleanup and its response is
  // ignored, so only one response ever takes effect. No infinite loop:
  // the effect has no state deps and runs once per mount.
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    (async () => {
      const token = localStorage.getItem("token");
      if (!token) { setAuthChecked(true); return; }
      try {
        const res = await fetch(`${API_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal
        });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          if (data?.user) {
            localStorage.setItem("user", JSON.stringify(data.user));
            localStorage.setItem("role", data.user.role);
          }
        } else {
          // Invalid/expired token or deactivated account — clear it
          localStorage.removeItem("token");
          localStorage.removeItem("user");
          localStorage.removeItem("role");
        }
      } catch {
        // Aborted (StrictMode remount) or network error: keep the token,
        // retry on next navigation
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    })();
    return () => { cancelled = true; ctrl.abort(); };
  }, []);

  return (
    <>
      {/* A SINGLE loader instance. It stays mounted until BOTH its own
          minimum display time (LOADER_DURATION_MS: 3.5s portal sequence +
          3s outward wave, signalled via onDone) AND the auth check have
          finished, whichever is later, so the loading screen plays exactly
          once for the full duration and can never re-appear mid-session. */}
      {(!booted || !authChecked) && <TechinsLoader duration={LOADER_DURATION_MS} onDone={() => setBooted(true)} />}
      {authChecked && booted ? (
        <BrowserRouter><Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        <Route element={<Protected role="student"><StudentLayout /></Protected>}>
          <Route path="/student" element={<StudentDashboard />} />
          <Route path="/student/tasks" element={<MyTasks />} />
          {/* The task's own page. Declared BEFORE nothing conflicts: the id is a
              real Mongo ObjectId and is preserved across refresh, Back/Forward,
              notification clicks and a full page reload. */}
          <Route path="/student/tasks/:taskId" element={<TaskDetail />} />
          {/* Deep-link alias so /tasks/:taskId (notification action_url) lands on
              the same page inside the student workspace. */}
          <Route path="/tasks/:taskId" element={<TaskAliasRedirect />} />
          <Route path="/student/daily-activity" element={<DailyActivity />} />
          <Route path="/student/missions" element={<Missions />} />
          <Route path="/student/work-history" element={<WorkHistory />} />
          <Route path="/student/performance" element={<StudentPerformance />} />
          <Route path="/student/feedback" element={<StudentFeedback />} />
          <Route path="/student/profile" element={<Profile />} />
        </Route>

        <Route element={<Protected role="manager"><RoleLayout role="manager" /></Protected>}>
          <Route path="/manager" element={<ManagerDashboard />} />
          <Route path="/manager/monitor" element={<ActivityMonitor />} />
          <Route path="/manager/students" element={<Students />} />
          <Route path="/manager/tasks" element={<AdminTasks />} />
          <Route path="/manager/missions" element={<AdminMissions />} />
          <Route path="/manager/submissions" element={<ManagerSubmissions />} />
          {/* Dedicated Task Manager review route. It MUST be declared before the
              catch-all: an unregistered review URL falls through to path="*",
              which redirects the reviewer to /login — the "Review button takes
              me to the home page" bug. See pages/admin/TaskReview.jsx. */}
          <Route path="/manager/tasks/:taskId/review" element={<TaskReview />} />
          <Route path="/manager/daily-activities" element={<DailyActivities />} />
          <Route path="/manager/performance" element={<AdminPerformance />} />
          <Route path="/manager/feedback" element={<Feedback />} />
        </Route>

        <Route element={<Protected role="admin"><RoleLayout role="admin" /></Protected>}>
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/students" element={<Students />} />
          <Route path="/admin/tasks" element={<AdminTasks />} />
          <Route path="/admin/missions" element={<AdminMissions />} />
          <Route path="/admin/submissions" element={<AdminSubmissions />} />
          <Route path="/admin/daily-activities" element={<DailyActivities />} />
          <Route path="/admin/performance" element={<AdminPerformance />} />
          <Route path="/admin/feedback" element={<Feedback />} />
          <Route path="/admin/audit" element={<AuditLogs />} />
          <Route path="/admin/profile" element={<AdminProfile />} />
          <Route path="/admin/students/:id" element={<StudentDetailsPage />} />
          {/* Dedicated Task Manager review route — see the manager block above. */}
          <Route path="/admin/tasks/:taskId/review" element={<TaskReview />} />
        </Route>

        {/* Redirect old CEO routes to Admin */}
        <Route path="/ceo" element={<Navigate to="/admin" replace />} />
        <Route path="/ceo/*" element={<Navigate to="/admin" replace />} />

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes></BrowserRouter>
      ) : null}
    </>
  );
}
