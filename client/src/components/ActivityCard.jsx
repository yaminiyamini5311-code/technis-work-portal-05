function ActivityCard({ activity }) {
  return (
    <div className="activity-card">
      <div className="activity-header">
        <div>
          <h3>
            {activity.user?.name || "My Activity"}
          </h3>

          <small>
            {new Date(
              activity.createdAt || activity.date
            ).toLocaleDateString()}
          </small>
        </div>

        <span className="activity-status">
          {activity.status}
        </span>
      </div>

      <p>
        <strong>Work:</strong> {activity.workDone}
      </p>

      <p>
        <strong>Hours:</strong> {activity.hours}
      </p>

      {activity.challenges && (
        <p className="activity-challenges">
          <span className="challenge-ping" aria-hidden="true"></span>
          <strong>Challenges:</strong>{" "}
          {activity.challenges}
        </p>
      )}
    </div>
  );
}

export default ActivityCard;