function calculateProgress(tasks = [], missions = []) {
  const completedTasks = tasks.filter(task => String(task.status).toLowerCase() === "completed").length;
  const completedMissions = missions.filter(mission => String(mission.status).toLowerCase() === "completed" || Number(mission.progress) >= 100).length;
  const total = tasks.length + missions.length;
  const completed = completedTasks + completedMissions;
  return { progress: total ? Math.round((completed / total) * 100) : 0, totalTasks: tasks.length, completedTasks, totalMissions: missions.length, completedMissions };
}
module.exports = calculateProgress;
