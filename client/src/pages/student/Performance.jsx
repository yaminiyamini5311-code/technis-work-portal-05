import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import TechinsIcon from "../../components/TechinsIcon";
import { useScrollReveal } from "../../components/useScrollReveal";
import "./Performance.css";

const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5000";

function Performance() {
  const navigate = useNavigate();

  const [performance, setPerformance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const token = localStorage.getItem("token");

  const user = JSON.parse(
    localStorage.getItem("user") || "{}"
  );

  useScrollReveal('.reveal-card', {
    stagger: 60,
    initialScale: 0.96,
    initialOpacity: 0.15,
    initialTranslateY: 24,
    initialBlur: 0
  });

  useEffect(() => {
    const loadPerformance = async () => {
      if (!token) {
        navigate("/login");
        return;
      }

      try {
        // The student summary payload (progress, score, mission completion,
        // strengths/improvement lists, feedback) is produced by
        // /api/student/dashboard. /api/performance/me returns the raw review
        // records array (`records`) — reading dashboard-shaped fields from it
        // silently rendered 0/empty cards, which is why this page now uses
        // the dashboard payload.
        const response = await axios.get(
          `${API_URL}/api/student/dashboard`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        setPerformance(response.data);
      } catch (err) {
        console.error("Performance error:", err);

        if (err.response?.status === 401) {
          localStorage.removeItem("token");
          localStorage.removeItem("user");
          navigate("/login");
          return;
        }

        setError(
          err.response?.data?.message ||
            "Unable to load your performance."
        );
      } finally {
        setLoading(false);
      }
    };

    loadPerformance();
  }, [token, navigate]);

  if (loading) {
    return (
      <div className="student-performance-page">
        <div className="loading-box">
          <div className="loader"></div>
          <h2>Loading your performance...</h2>
          <p>Please wait.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="student-performance-page">
        <div className="error-box">
          <h2>Private Performance</h2>
          <p>{error}</p>

          <button
            onClick={() => navigate("/student")}
            className="back-button"
          >
            <TechinsIcon name="chevron" size={14} variant="light" ariaHidden style={{ transform: "rotate(180deg)" }} /> Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const progress = performance?.progress ?? 0;
  const score = performance?.score;
  const completed = performance?.completedMissions ?? 0;
  const total = performance?.totalMissions ?? 0;

  const missionPercentage =
    total > 0
      ? Math.round((completed / total) * 100)
      : 0;

  return (
    <div className="student-performance-page">
      {/* STUDENT INFORMATION */}

      <main className="performance-container">

        <section className="student-profile">

          <div className="student-avatar">
            {(user.name || "S")
              .charAt(0)
              .toUpperCase()}
          </div>

          <div>
            <h2>
              {user.name || "Student"}
            </h2>

            <p>
              {user.email || "Student account"}
            </p>

            <span>
              Role: {user.role || "student"}
            </span>
          </div>

        </section>


        {/* MAIN PERFORMANCE */}

        <section className="student-performance-grid">

          {/* PROGRESS */}

          <div className="student-performance-card reveal-card">

            <div className="card-top">
              <span className="card-icon">
                <TechinsIcon name="chart" size={28} variant="light" className="portal-icon" />
              </span>

              <span className="card-label">
                PROGRESS
              </span>
            </div>

            <h2>{progress}%</h2>

            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: `${progress}%`,
                }}
              ></div>
            </div>

            <p>
              Your current learning progress
            </p>

          </div>


          {/* SCORE */}

          <div className="student-performance-card reveal-card">

            <div className="card-top">
              <span className="card-icon">
                <TechinsIcon name="trophy" size={28} variant="light" className="portal-icon" />
              </span>

              <span className="card-label">
                SCORE
              </span>
            </div>

            <h2>{score == null ? "—" : `${score}%`}</h2>

            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: `${score == null ? 0 : score}%`,
                }}
              ></div>
            </div>

            <p>
              {score == null ? "Not evaluated yet" : "Your overall performance score"}
            </p>

          </div>


          {/* COMPLETED MISSIONS */}

          <div className="student-performance-card reveal-card">

            <div className="card-top">
              <span className="card-icon">
                <TechinsIcon name="check" size={28} variant="light" className="portal-icon" />
              </span>

              <span className="card-label">
                MISSIONS
              </span>
            </div>

            <h2>
              {completed} / {total}
            </h2>

            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: `${missionPercentage}%`,
                }}
              ></div>
            </div>

            <p>
              Missions completed
            </p>

          </div>

        </section>


        {/* DETAILS */}

        <section className="details-grid">

          {/* STRENGTHS */}

          <div className="detail-card reveal-card">

            <div className="detail-heading">
              <span><TechinsIcon name="strength" size={24} variant="light" className="portal-icon" /></span>
              <h3>Strengths</h3>
            </div>

            {performance?.strengths?.length > 0 ? (
              <ul>
                {performance.strengths.map(
                  (item, index) => (
                    <li key={index}>
                      {item}
                    </li>
                  )
                )}
              </ul>
            ) : (
              <p className="student-empty-text">
                No strengths added yet.
              </p>
            )}

          </div>


          {/* IMPROVEMENT */}

          <div className="detail-card reveal-card">

            <div className="detail-heading">
              <span><TechinsIcon name="improve" size={24} variant="light" className="portal-icon" /></span>
              <h3>Areas to Improve</h3>
            </div>

            {performance?.improvement?.length > 0 ? (
              <ul>
                {performance.improvement.map(
                  (item, index) => (
                    <li key={index}>
                      {item}
                    </li>
                  )
                )}
              </ul>
            ) : (
              <p className="student-empty-text">
                No improvement areas added yet.
              </p>
            )}

          </div>


          {/* FEEDBACK */}

          <div className="detail-card reveal-card">

            <div className="detail-heading">
              <span><TechinsIcon name="comment" size={24} variant="light" className="portal-icon" /></span>
              <h3>Feedback</h3>
            </div>

            <div className="feedback-card">
              <p>{performance?.feedback || "No feedback recorded yet."}</p>
            </div>

          </div>

        </section>


        {/* PRIVACY MESSAGE */}

        <div className="privacy-message">
          <TechinsIcon name="lock" size={16} variant="light" /> This performance information is private
          and belongs only to your student account.
        </div>

      </main>

    </div>
  );
}

export default Performance;
