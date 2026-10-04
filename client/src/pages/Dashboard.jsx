import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Dashboard.css";

const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5000";

function Dashboard() {
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const savedUser = localStorage.getItem("user");

    if (!token || !savedUser) {
      navigate("/login", { replace: true });
      return;
    }

    try {
      setUser(JSON.parse(savedUser));
    } catch {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      navigate("/login", { replace: true });
    }

    setLoading(false);
  }, [navigate]);

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login", { replace: true });
  };

  if (loading) {
    return (
      <div className="dashboard-loading">
        Loading...
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="dashboard-page">

      {/* HEADER */}
      <header className="dashboard-header">

        <div className="dashboard-brand">
          <div className="dashboard-logo">T</div>

          <div>
            <h1>TECHINS</h1>
            <span>WORK PORTAL</span>
          </div>
        </div>

        <div className="header-user">

          <div className="user-info">
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>

          <button
            className="logout-btn"
            onClick={logout}
          >
            Logout
          </button>

        </div>

      </header>


      {/* WELCOME */}
      <section className="welcome-section">

        <div>
          <p className="welcome-small">
            Welcome back
          </p>

          <h2>
            Hello, {user.name} 👋
          </h2>

          <p>
            Here is your work overview for today.
          </p>
        </div>

        <div className="profile-badge">
          <span>{user.role}</span>
          <small>{user.department}</small>
        </div>

      </section>


      {/* QUICK STATS */}
      <section className="stats-grid">

        <div className="stat-card">
          <div className="stat-icon">📋</div>
          <div>
            <span>Assigned Tasks</span>
            <strong>0</strong>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">✅</div>
          <div>
            <span>Completed</span>
            <strong>0</strong>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">🎯</div>
          <div>
            <span>Missions</span>
            <strong>0</strong>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">📊</div>
          <div>
            <span>Progress</span>
            <strong>0%</strong>
          </div>
        </div>

      </section>


      {/* MAIN FEATURES */}
      <section className="dashboard-grid">

        {/* MY TASKS */}
        <div className="dashboard-card">

          <div className="card-header">
            <div className="card-icon">📋</div>

            <div>
              <h3>My Tasks</h3>
              <p>
                View your assigned and remaining tasks.
              </p>
            </div>
          </div>

          <div className="empty-state">
            <div className="empty-icon">📭</div>

            <h4>No tasks assigned yet</h4>

            <p>
              Your assigned tasks will appear here.
            </p>
          </div>

          <button
            className="primary-btn"
            onClick={() => navigate("/tasks")}
          >
            Open Tasks →
          </button>

        </div>


        {/* DAILY ACTIVITY */}
        <div className="dashboard-card">

          <div className="card-header">
            <div className="card-icon">📝</div>

            <div>
              <h3>Daily Activity</h3>
              <p>
                Record the work you completed today.
              </p>
            </div>
          </div>

          <div className="empty-state">
            <div className="empty-icon">✏️</div>

            <h4>Today's activity</h4>

            <p>
              Add your completed work for today.
            </p>
          </div>

          <button
            className="primary-btn"
            onClick={() => navigate("/activity")}
          >
            Upload Activity →
          </button>

        </div>


        {/* MISSIONS */}
        <div className="dashboard-card">

          <div className="card-header">
            <div className="card-icon">🎯</div>

            <div>
              <h3>Missions</h3>
              <p>
                View and update your missions.
              </p>
            </div>
          </div>

          <div className="empty-state">
            <div className="empty-icon">🚀</div>

            <h4>No missions yet</h4>

            <p>
              Your missions will appear here.
            </p>
          </div>

          <button
            className="primary-btn"
            onClick={() => navigate("/missions")}
          >
            View Missions →
          </button>

        </div>


        {/* WORK HISTORY */}
        <div className="dashboard-card">

          <div className="card-header">
            <div className="card-icon">📚</div>

            <div>
              <h3>Work History</h3>
              <p>
                View your previous daily activities.
              </p>
            </div>
          </div>

          <div className="empty-state">
            <div className="empty-icon">🗂️</div>

            <h4>No activity history</h4>

            <p>
              Your previous work will appear here.
            </p>
          </div>

          <button
            className="primary-btn"
            onClick={() => navigate("/history")}
          >
            View History →
          </button>

        </div>


        {/* PERFORMANCE */}
        <div className="dashboard-card performance-card">

          <div className="card-header">
            <div className="card-icon">📊</div>

            <div>
              <h3>Performance</h3>
              <p>
                View your private performance information.
              </p>
            </div>
          </div>

          <div className="performance-preview">

            <div>
              <span>Progress</span>
              <strong>0%</strong>
            </div>

            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: "0%" }}
              />
            </div>

            <p>
              Complete tasks and missions to build
              your performance profile.
            </p>

          </div>

          <button
            className="primary-btn"
            onClick={() => navigate("/performance")}
          >
            View Performance →
          </button>

        </div>


        {/* ACTIVITY MONITOR */}
        {user.role === "admin" && (
          <div className="dashboard-card admin-card">

            <div className="card-header">
              <div className="card-icon">👥</div>

              <div>
                <h3>Activity Monitor</h3>
                <p>
                  Monitor team activities and progress.
                </p>
              </div>
            </div>

            <div className="empty-state">
              <div className="empty-icon">👨‍💻</div>

              <h4>Team Activity</h4>

              <p>
                Administrator access enabled.
              </p>
            </div>

            <button
              className="primary-btn"
              onClick={() => navigate("/monitor")}
            >
              Open Activity Monitor →
            </button>

          </div>
        )}

      </section>


      {/* FOOTER */}
      <footer className="dashboard-footer">
        <span>© 2026 TECHINS</span>
        <span>Work Portal</span>
      </footer>

    </div>
  );
}

export default Dashboard;