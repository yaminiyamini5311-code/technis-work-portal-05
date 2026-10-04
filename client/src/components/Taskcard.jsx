function TaskCard({ task, onStatusChange }) {
  return (
    <div className="task-card">
      <div className="task-card-top">
        <h3>{task.title}</h3>

        <span className={`priority ${task.priority?.toLowerCase()}`}>
          {task.priority}
        </span>
      </div>

      <p>{task.description || "No description provided."}</p>

      <div className="task-meta">
        <span>
          Status:
          <strong> {task.status}</strong>
        </span>

        {task.dueDate && (
          <span>
            Due:{" "}
            {new Date(task.dueDate).toLocaleDateString()}
          </span>
        )}
      </div>

      <select
        value={task.status}
        onChange={(e) =>
          onStatusChange(task._id, e.target.value)
        }
      >
        <option>Pending</option>
        <option>In Progress</option>
        <option>Completed</option>
      </select>
    </div>
  );
}

export default TaskCard;