import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "./LoadingPage.css";

export default function LoadingPage({ redirectTo = "/login", duration = 5000 }) {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      navigate(redirectTo, { replace: true });
    }, duration);

    return () => clearTimeout(timer);
  }, [navigate, redirectTo, duration]);

  return (
    <div className="techins-loading-page">
      <div className="loading-glow" />
      <div className="loading-content">
        <div className="loading-logo-container">
          <img src="/techins-logo-full.jpg" alt="TECHINS" />
        </div>
        <div className="loading-line" />
        <div className="loading-text">
          <h1>TECHINS</h1>
          <p>WORK PORTAL</p>
          <span>Where Learning Becomes Ideas</span>
        </div>
        <div className="loading-spinner">
          <div className="spinner-ring"></div>
        </div>
      </div>
    </div>
  );
}
