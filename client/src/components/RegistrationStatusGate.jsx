import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./RegistrationStatusGate.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

/**
 * Gate component that checks student registration status
 * Shows pending/rejected screens for students who haven't been approved yet
 * Only applies to students - other roles pass through immediately
 */
export default function RegistrationStatusGate({ children }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    checkStatus();
    // Refresh status every 10 seconds
    const interval = setInterval(checkStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  const checkStatus = async () => {
    try {
      // Get current user info
      let localUser = {};
      try {
        localUser = JSON.parse(localStorage.getItem("user") || "{}");
      } catch {}

      // Only check for students
      if (localUser.role !== "student") {
        setStatus("approved");
        setUser(localUser);
        setLoading(false);
        return;
      }

      // Fetch latest status from backend
      const response = await fetch(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });

      if (!response.ok) {
        throw new Error("Unable to verify registration status");
      }

      const data = await response.json();
      if (data.success && data.user) {
        setStatus(data.user.registration_status || "approved");
        setUser(data.user);
        
        // Update local storage with latest status
        localStorage.setItem("user", JSON.stringify(data.user));
      }
    } catch (error) {
      console.error("Status check error:", error);
      // On error, assume approved to avoid locking out users
      setStatus("approved");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    navigate("/login", { replace: true });
  };

  if (loading) {
    return (
      <div className="registration-gate-loading">
        <div className="loader-dot"></div>
        <p>Verifying registration status...</p>
      </div>
    );
  }

  // Pending status
  if (status === "pending") {
    return (
      <div className="registration-gate-screen pending-screen">
        <div className="registration-gate-content">
          <div className="registration-gate-icon">
            <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
              <circle cx="40" cy="40" r="38" stroke="#FFA500" strokeWidth="4" strokeDasharray="8 8" />
              <circle cx="40" cy="40" r="20" fill="#FFA500" opacity="0.2" />
              <path d="M40 28V40L48 48" stroke="#FFA500" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1>Waiting for Approval</h1>
          <p>Your registration is pending CEO approval. You will be notified once your account is approved.</p>
          {user && (
            <div className="registration-user-info">
              <p><strong>{user.name}</strong></p>
              <p className="email">{user.email}</p>
            </div>
          )}
          <button className="logout-button" onClick={handleLogout}>
            Logout
          </button>
          <button className="refresh-button" onClick={checkStatus}>
            Check Status
          </button>
        </div>
      </div>
    );
  }

  // Rejected status
  if (status === "rejected") {
    return (
      <div className="registration-gate-screen rejected-screen">
        <div className="registration-gate-content">
          <div className="registration-gate-icon">
            <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
              <circle cx="40" cy="40" r="38" stroke="#EF4444" strokeWidth="4" />
              <path d="M28 28L52 52M52 28L28 52" stroke="#EF4444" strokeWidth="4" strokeLinecap="round" />
            </svg>
          </div>
          <h1>Registration Not Approved</h1>
          <p>Your registration has not been approved. Please contact the administrator for more information.</p>
          {user && (
            <div className="registration-user-info">
              <p><strong>{user.name}</strong></p>
              <p className="email">{user.email}</p>
            </div>
          )}
          <button className="logout-button" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>
    );
  }

  // Approved - show normal portal
  return <>{children}</>;
}
