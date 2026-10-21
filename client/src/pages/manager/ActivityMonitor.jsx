import { useEffect, useMemo, useState } from "react";
import { StatNumber } from "../../components/useCountUp";
import "../../styles/manager-femly.css";
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
export default function ActivityMonitor() {
  const [activities, setActivities] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const h = { Authorization: `Bearer ${localStorage.getItem("token")}` };
    try {
      const [a, b, c] = await Promise.all([
        fetch(`${API_URL}/api/activities`, { headers: h }),
        fetch(`${API_URL}/api/tasks`, { headers: h }),
        fetch(`${API_URL}/api/tasks/submissions`, { headers: h }),
      ]);
      const [ad, td, sd] = await Promise.all([a.json(), b.json(), c.json()]);
      setActivities(ad.activities || []);
      setTasks(td.tasks || []);
      setSubmissions(sd.submissions || []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const todayUpdates = activities.filter((a) => a.date === today).length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const pending = tasks.filter((t) => t.status !== "completed").length;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return activities.filter((a) => {
      const matches = `${a.student_name} ${a.work_title} ${a.description}`.toLowerCase().includes(q);
      const status = filter === "all" || a.status === filter;
      return matches && status;
    });
  }, [activities, search, filter]);

  const activitiesContent = loading && !activities.length
    ? <div className="empty-state">Syncing activity…</div>
    : filtered.length
      ? filtered.map((a) => (
          <article className="activity-admin" key={a.id}>
            <div className="avatar">{ (a.student_name || "S").charAt(0) }</div>
            <div>
              <strong>{a.student_name}</strong>
              <h4>{a.work_title}</h4>
              <p>{a.description}</p>
              <small>{a.date} · {a.hours_worked || 0} hours · {a.status}</small>
            </div>
          </article>
        ))
      : <div className="empty-state">No matching activity.</div>;

  const submissionsContent = submissions.length
    ? submissions.map((item) => (
        <div className="submission-manager" key={item.id}>
          <div>
            <strong>{item.title}</strong>
            <small>{item.student_name} · {item.file_count || 0} file{item.file_count === 1 ? "" : "s"} · {item.outcome ? "Outcome submitted" : "File submitted"}</small>
            {item.outcome && <p>{item.outcome}</p>}
          </div>
          <span className="pill completed">{item.status}</span>
        </div>
      ))
    : <div className="empty-state">No submitted work yet.</div>;

  return (
    <div className="manager-page page-enter">
      <div className="simple-head">
        <span>TEAM MONITOR</span>
        <h2>Activity command center</h2>
        <p>Monitor daily updates, task progress and submitted student work.</p>
      </div>

      <div className="admin-stat-grid">
        <div className="admin-stat stat-highlight">
          <small>01</small><span>Total activities</span><StatNumber value={activities.length} />
        </div>
        <div className="admin-stat">
          <small>02</small><span>Today updates</span><StatNumber value={todayUpdates} />
        </div>
        <div className="admin-stat">
          <small>03</small><span>Completed tasks</span><StatNumber value={completed} />
        </div>
        <div className="admin-stat">
          <small>04</small><span>Pending tasks</span><StatNumber value={pending} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <span className="section-kicker">DAILY TEAM ACTIVITIES</span>
            <h3>Live activity feed</h3>
          </div>
          <div className="monitor-tools">
            <input
              className="search-input"
              placeholder="Search member or activity"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All status</option>
              <option value="completed">Completed</option>
              <option value="in_progress">In progress</option>
              <option value="blocked">Blocked</option>
            </select>
            <button className="femly-btn femly-btn--secondary" onClick={load}>Refresh</button>
          </div>
        </div>
        {activitiesContent}
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <span className="section-kicker">SUBMITTED WORK</span>
            <h3>Student reports & files</h3>
          </div>
        </div>
        {submissionsContent}
      </div>
    </div>
  );
}
