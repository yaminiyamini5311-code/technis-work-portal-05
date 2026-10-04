function MissionCard({ mission, onUpdate }) {
  return (
    <div className="mission-card">
      <div className="mission-header">
        <h3>{mission.title}</h3>

        <span className="mission-status">
          {mission.status}
        </span>
      </div>

      <p>
        {mission.description || "No description available."}
      </p>

      <div className="progress-container">
        <div className="progress-label">
          <span>Progress</span>
          <strong>{mission.progress}%</strong>
        </div>

        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{
              width: `${mission.progress}%`
            }}
          />
        </div>
      </div>

      <select
        value={mission.status}
        onChange={(e) =>
          onUpdate(mission._id, {
            status: e.target.value
          })
        }
      >
        <option>Not Started</option>
        <option>In Progress</option>
        <option>Completed</option>
      </select>
    </div>
  );
}

export default MissionCard;