import { Navigate, Outlet } from "react-router-dom";

function ProtectedRoute({ allowedRoles }) {
  const token = localStorage.getItem("token");
  const userData = localStorage.getItem("user");

  if (!token || !userData) {
    return <Navigate to="/login" replace />;
  }

  let user;

  try {
    user = JSON.parse(userData);
  } catch {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    return <Navigate to="/login" replace />;
  }

  // Convert role to lowercase so Student/student both work
  const role = user.role?.toLowerCase();

  // If roles are specified, check the logged-in user's role
  if (
    allowedRoles &&
    allowedRoles.length > 0 &&
    !allowedRoles.map((r) => r.toLowerCase()).includes(role)
  ) {
    if (role === "student") {
      return <Navigate to="/student" replace />;
    }

    if (role === "manager") {
      return <Navigate to="/manager" replace />;
    }

    if (role === "admin") {
      return <Navigate to="/admin" replace />;
    }

    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

export default ProtectedRoute;