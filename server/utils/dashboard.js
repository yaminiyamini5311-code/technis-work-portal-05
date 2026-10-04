function parseList(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [String(parsed)];
  } catch {
    return String(value).split(",").map((v) => v.trim()).filter(Boolean);
  }
}

function getStudentDashboard(db, userId) {
  const student = db.prepare("SELECT id, name, email, role, department FROM users WHERE id = ?").get(userId);
  if (!student) return null;

  const tasks = db.prepare(`SELECT t.*, u.name AS assigned_by_name, (SELECT COUNT(*) FROM task_files tf WHERE tf.task_id=t.id) AS file_count FROM tasks t LEFT JOIN users u ON u.id=t.assigned_by WHERE t.assigned_to=? ORDER BY t.id DESC`).all(userId);
  const missions = db.prepare(`SELECT m.* FROM missions m WHERE m.assigned_to=? ORDER BY m.id DESC`).all(userId);
  const activities = db.prepare(`SELECT a.* FROM daily_activities a WHERE a.user_id=? ORDER BY a.date DESC, a.id DESC`).all(userId);
  const review = db.prepare("SELECT * FROM performance WHERE user_id=? ORDER BY id DESC LIMIT 1").get(userId);

  const completedTasks = tasks.filter((t) => String(t.status).toLowerCase() === "completed").length;
  const completedMissions = missions.filter((m) => String(m.status).toLowerCase() === "completed" || Number(m.progress) >= 100).length;
  const completedActivities = activities.filter((a) => String(a.status).toLowerCase() === "completed").length;
  const rates = [];
  if (tasks.length) rates.push((completedTasks / tasks.length) * 100);
  if (missions.length) rates.push((completedMissions / missions.length) * 100);
  if (activities.length) rates.push((completedActivities / activities.length) * 100);
  const progress = rates.length ? Math.round(rates.reduce((a,b)=>a+b,0)/rates.length) : 0;

  return {
    student,
    progress,
    score: review?.score == null ? null : Number(review.score),
    tasks: { total: tasks.length, completed: completedTasks, pending: tasks.filter(t => String(t.status).toLowerCase() === "pending").length, in_progress: tasks.filter(t => String(t.status).toLowerCase() === "in_progress").length, recent: tasks.slice(0,5) },
    missions: { total: missions.length, completed: completedMissions, recent: missions.slice(0,4) },
    activities: { total: activities.length, completed: completedActivities, recent: activities.slice(0,5) },
    strengths: parseList(review?.strengths),
    improvement: parseList(review?.improvements),
    feedback: review?.feedback || "No feedback available yet."
  };
}

module.exports = { getStudentDashboard };
