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

function safeRate(done, total) {
  const t = Number(total) || 0;
  const d = Number(done) || 0;
  if (t <= 0) return null;
  return (Math.min(d, t) / t) * 100;
}

async function getStudentDashboard(db, userId) {
  const student = await db.collection("users").findOne({ _id: toId(userId) }, { projection: { password: 0 } });
  if (!student) return null;

  const sid = String(userId);

  // Tasks visible to this student: legacy direct assignments plus
  // any task with a TaskAssignment for them (batch or multi-student).
  const { getStudentTaskIds } = require("../models/TaskAssignment");
  const assignedTaskIds = await getStudentTaskIds(db, sid);
  const assignedObjectIds = assignedTaskIds
    .map(id => { try { return new ObjectId(id); } catch { return null; } })
    .filter(Boolean);
  const taskFilter = assignedObjectIds.length
    ? { $or: [{ _id: { $in: assignedObjectIds } }, { assigned_to: sid }] }
    : { assigned_to: sid };
  const [tasks, missions, activities, review] = await Promise.all([
    db.collection("tasks").find(taskFilter).sort({ created_at: -1 }).toArray(),
    db.collection("missions").find({ assigned_to: sid }).sort({ created_at: -1 }).toArray(),
    db.collection("daily_activities").find({ user_id: sid }).sort({ date: -1 }).toArray(),
    db.collection("performance").find({ user_id: sid }).sort({ created_at: -1 }).limit(1).toArray().then(r => r[0] || null)
  ]);

  // Canonical completion: Approved only. A task counts as completed when the
  // task document, its per-student assignment, or its latest submission says
  // Approved (covers batch fan-out where the task doc alone is not personal).
  const taskIds = tasks.map(t => String(t._id));
  const [assignments, submissions] = await Promise.all([
    taskIds.length
      ? db.collection("task_assignments").find({ task_id: { $in: taskIds }, student_id: sid }).toArray()
      : [],
    taskIds.length
      ? db.collection("submissions").find({ task_id: { $in: taskIds }, student_id: sid }).toArray()
      : [],
  ]);
  const approvedTaskIds = new Set();
  for (const a of assignments) {
    if (String(a.status || "").toLowerCase() === "approved") approvedTaskIds.add(String(a.task_id));
  }
  const latestByTask = new Map();
  for (const s of submissions) {
    const key = String(s.task_id);
    const cur = latestByTask.get(key);
    if (!cur || (s.version || 0) > (cur.version || 0)) latestByTask.set(key, s);
  }
  for (const [taskId, sub] of latestByTask) {
    if (String(sub.status || "").toLowerCase() === "approved") approvedTaskIds.add(taskId);
  }
  const isTaskCompleted = (t) =>
    String(t.status || "").toLowerCase() === "completed" ||
    t.workflow_status === "Approved" ||
    approvedTaskIds.has(String(t._id));

  const completedTasks = tasks.filter(isTaskCompleted).length;
  const completedMissions = missions.filter(m => String(m.status || "").toLowerCase() === "completed" || Number(m.progress) >= 100).length;
  const completedActivities = activities.filter(a => String(a.status || "").toLowerCase() === "completed").length;

  // Same rule as the CEO performance report (performanceRoutes GET /):
  // approval-based completion across tasks + missions. Activities are tracked
  // separately and never dilute the headline progress.
  const denom = (tasks.length || 0) + (missions.length || 0);
  const progress = denom > 0
    ? Math.round(((completedTasks + completedMissions) / denom) * 100)
    : 0;

  return {
    student: { ...student, id: String(student._id) },
    progress,
    score: review?.score == null || Number.isNaN(Number(review.score)) ? null : Number(review.score),
    tasks: {
      total: tasks.length || 0,
      completed: completedTasks,
      pending: tasks.filter(t => ["Assigned", "pending"].includes(t.workflow_status || t.status)).length,
      in_progress: tasks.filter(t => ["In Progress", "in_progress"].includes(t.workflow_status || t.status)).length,
      recent: tasks.slice(0, 5).map(t => ({ ...t, id: String(t._id) }))
    },
    missions: {
      total: missions.length || 0,
      completed: completedMissions,
      recent: missions.slice(0, 4).map(m => ({ ...m, id: String(m._id) }))
    },
    activities: {
      total: activities.length || 0,
      completed: completedActivities,
      recent: activities.slice(0, 5).map(a => ({ ...a, id: String(a._id) }))
    },
    strengths: parseList(review?.strengths),
    improvement: parseList(review?.improvements),
    feedback: review?.feedback || "No feedback available yet."
  };
}

module.exports = { getStudentDashboard };
