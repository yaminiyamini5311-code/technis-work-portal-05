import { useEffect, useState } from "react";
import "../../styles/admin.css";
import "./performance.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export default function Performance() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${API_URL}/api/performance`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success && Array.isArray(data.students)) {
        setItems(data.students);
      } else {
        console.error("Unexpected API response:", data);
        setItems([]);
      }
    } catch (err) {
      console.error("Failed to load performance data:", err);
      setError(err.message || "Unable to load performance data");
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="admin-simple">
        <div className="simple-head">
          <span>PRIVATE PERFORMANCE</span>
          <h2>Student Performance</h2>
          <p>Loading performance data...</p>
        </div>
        <div className="empty-state">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-simple">
        <div className="simple-head">
          <span>PRIVATE PERFORMANCE</span>
          <h2>Student Performance</h2>
          <p>Progress is calculated from real tasks, missions and daily activities. Scores appear only after evaluation.</p>
        </div>
        <div className="empty-state" style={{ color: "#d32f2f" }}>
          Error: {error}
          <button 
            onClick={load} 
            style={{ 
              marginTop: "1rem", 
              padding: "0.5rem 1rem", 
              cursor: "pointer" 
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-simple">
      <div className="simple-head">
        <span>PRIVATE PERFORMANCE</span>
        <h2>Student Performance</h2>
        <p>
          Progress is calculated from real tasks, missions and daily activities. 
          Scores appear only after evaluation.
        </p>
      </div>
      <div className="performance-admin-grid">
        {items.map((x) => (
          <div className="panel" key={x.student.id}>
            <div className="panel-head">
              <div>
                <h3>{x.student.name}</h3>
                <small>{x.student.email}</small>
                {x.student.program && (
                  <small style={{ display: "block", marginTop: "0.25rem", opacity: 0.7 }}>
                    {x.student.program}
                  </small>
                )}
              </div>
              <strong>{x.progress}%</strong>
            </div>
            <div className="admin-progress">
              <i style={{ width: `${x.progress}%` }} />
            </div>
            <div className="perf-line">
              <span>Tasks</span>
              <b>
                {x.completedTasks}/{x.totalTasks}
              </b>
            </div>
            <div className="perf-line">
              <span>Missions</span>
              <b>
                {x.completedMissions}/{x.totalMissions}
              </b>
            </div>
            <div className="perf-score">
              Evaluated score:{" "}
              <strong>
                {x.score == null ? "Not evaluated yet" : `${x.score}%`}
              </strong>
            </div>
            {x.lastReviewed && (
              <div style={{ 
                marginTop: "0.75rem", 
                fontSize: "0.85rem", 
                opacity: 0.6 
              }}>
                Last reviewed: {new Date(x.lastReviewed).toLocaleDateString()}
              </div>
            )}
          </div>
        ))}
      </div>
      {!items.length && (
        <div className="empty-state">
          No student performance data yet. Students will appear here once they are assigned tasks or missions.
        </div>
      )}
    </div>
  );
}
