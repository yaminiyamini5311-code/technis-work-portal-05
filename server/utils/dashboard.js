const { ObjectId } = require("mongodb");

function toId(id) { try { return new ObjectId(id); } catch { return id; } }

function parseList(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [String(parsed)];
  } catch {
    return String(value).split(",").map(v => v.trim()).filter(Boolean);
  }
}

async function getStudentDashboard(db, userId) {
  const student = await db.collection("users").findOne({ _id: toId(userId) }, { projection: { password: 0 } });
  if (!student) return null;

  const [tasks, missions, activities, review] = await Promise.all([
    db.collection("tasks").find({ assigned_to: String(userId) }).sort({ created_at: -1 }).toArray(),
    db.collection("missions").find({ assigned_to: String(userId) }).sort({ created_at: -1 }).toArray(),
    db.collection("daily_activities").find({ user_id: String(userId) }).sort({ date: -1 }).toArray(),
    db.collection("performance").find({ user_id: String(userId) }).sort({ created_at: -1 }).limit(1).toArray().then(r => r[0] || null)
  ]);

  const completedTasks = tasks.filter(t => String(t.status).toLowerCase() === "completed" || t.workflow_status === "Approved").length;
  const completedMissions = missions.filter(m => String(m.status).toLowerCase() === "completed" || Number(m.progress) >= 100).length;
  const completedActivities = activities.filter(a => String(a.status).toLowerCase() === "completed").length;

  const rates = [];
  if (tasks.length) rates.push((completedTasks / tasks.length) * 100);
  if (missions.length) rates.push((completedMissions / missions.length) * 100);
  if (activities.length) rates.push((completedActivities / activities.length) * 100);
  const progress = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : 0;

  return {
    student: { ...student, id: String(student._id) },
    progress,
    score: review?.score == null ? null : Number(review.score),
    tasks: {
      total: tasks.length,
      completed: completedTasks,
      pending: tasks.filter(t => ["Assigned", "pending"].includes(t.workflow_status || t.status)).length,
      in_progress: tasks.filter(t => ["In Progress", "in_progress"].includes(t.workflow_status || t.status)).length,
      recent: tasks.slice(0, 5).map(t => ({ ...t, id: String(t._id) }))
    },
    missions: {
      total: missions.length,
      completed: completedMissions,
      recent: missions.slice(0, 4).map(m => ({ ...m, id: String(m._id) }))
    },
    activities: {
      total: activities.length,
      completed: completedActivities,
      recent: activities.slice(0, 5).map(a => ({ ...a, id: String(a._id) }))
    },
    strengths: parseList(review?.strengths),
    improvement: parseList(review?.improvements),
    feedback: review?.feedback || "No feedback available yet."
  };
}

module.exports = { getStudentDashboard };
