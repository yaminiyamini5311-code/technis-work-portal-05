import { useEffect, useState } from "react";
import TechinsIcon from "../../components/TechinsIcon";
import "./StudentDashboard.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export default function StudentDashboard(){
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [unread,setUnread]=useState(0);

  const load=async()=>{
    try{
      const h={Authorization:`Bearer ${localStorage.getItem("token")}`};
      const [dash,notices]=await Promise.all([
        fetch(`${API_URL}/api/student/dashboard`,{headers:h}),
        fetch(`${API_URL}/api/notifications`,{headers:h})
      ]);
      const d=await dash.json();
      const n=await notices.json();
      if(!dash.ok) throw new Error(d.message||"Unable to load dashboard");
      setData(d);
      setUnread(n.unread||0);
      setError("");
    }catch(e){
      setError(e.message);
    }finally{
      setLoading(false);
    }
  };

  useEffect(()=>{
    load();
    const id=setInterval(load,20000);
    return()=>clearInterval(id);
  },[]);

  if(loading) return <div className="portal-loading"><div className="loader-dot"/><h2>Loading your workspace</h2><p>Preparing your latest tasks and progress.</p></div>;
  if(error) return <div className="portal-error"><h2>Unable to load dashboard</h2><p>{error}</p><button onClick={load}>Retry</button></div>;

  const user=data.student;
  const pending=data.tasks.pending;
  const completed=data.tasks.completed;
  const inProgress=data.tasks.in_progress||0;
  const taskTotal=data.tasks.total||0;
  const taskCompletion=taskTotal?Math.round(completed/taskTotal*100):0;
  const missionCompletion=data.missions.total?Math.round(data.missions.completed/data.missions.total*100):0;

  return <div className="student-dashboard-page page-enter">
    <section className="workspace-hero">
      <div className="caustic-light"></div>
      <div className="workspace-hero-copy">
        <span className="section-kicker">PRIVATE WORKSPACE</span>
        <h2>Welcome back, {user.name}</h2>
        <p>Everything assigned to you, your daily work, missions and measurable progress in one place.</p>
        <div className={`workspace-status ${unread?"has-updates":""}`}>
          <span className={`status-dot ${unread?"glow-pulse":""}`}/>
          {unread?`${unread} new update${unread>1?"s":""} waiting for you`:"Workspace is up to date"}
        </div>
      </div>
      <div className="overall-progress">
        <div className="progress-ring">
          <div className="bubbles-container">
            <span className="bubble"></span>
            <span className="bubble"></span>
            <span className="bubble"></span>
          </div>
          <strong>{data.progress}%</strong>
        </div>
        <div><span>Overall progress</span><small>Based on your current records</small></div>
      </div>
    </section>

    <section className="workspace-stats" aria-label="Workspace overview">
      {[
        ["Total tasks",data.tasks.total,"Assigned work","clipboard"],
        ["Pending",pending,"Needs your attention","clock"],
        ["Completed",completed,"Approved work","check"],
        ["Missions",data.missions.total,"Assigned missions","target"]
      ].map(([label,value,note,iconName])=>
        <article className="workspace-stat" key={label}>
          <div className="stat-icon-tile"><TechinsIcon name={iconName} size={20} variant="light" /></div>
          <div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
        </article>
      )}
    </section>

    <div className="workspace-main-grid">
      <section className="workspace-card tasks-card">
        <div className="card-heading">
          <div><span className="section-kicker">ASSIGNED WORK</span><h3>Recent tasks</h3><p>Latest work assigned to you.</p></div>
          <a href="/student/tasks">View all</a>
        </div>
        <div className="task-list">
          {data.tasks.recent.length?data.tasks.recent.map(t=>
            <div className="professional-task-row" key={t.id}>
              <div className="task-index"><TechinsIcon name="clipboard" size={16} variant="light" /></div>
              <div className="task-row-content"><strong>{t.title}</strong><small>{t.due_date?`Due ${t.due_date}`:"No due date"}</small></div>
              <span className={`workspace-status-badge ${t.status}`}>{String(t.status).replace("_"," ")}</span>
            </div>
          ):<div className="workspace-empty"><TechinsIcon name="folder" size={40} variant="light" className="icon-sway" /><strong>No tasks assigned yet</strong><span>New assignments will appear here.</span></div>}
        </div>
      </section>

      <section className="workspace-card progress-card-large">
        <div className="card-heading">
          <div><span className="section-kicker">MEASURABLE PROGRESS</span><h3>Work summary</h3><p>Live from your task and mission records.</p></div>
        </div>
        <div className="progress-metric">
          <div><span>Task completion</span><strong>{taskCompletion}%</strong></div>
          <div className="professional-progress"><i style={{width:`${taskCompletion}%`}}/></div>
        </div>
        <div className="progress-metric">
          <div><span>In progress</span><strong>{inProgress}</strong></div>
          <div className="professional-progress"><i style={{width:`${taskTotal?Math.min(100,inProgress/taskTotal*100):0}%`}}/></div>
        </div>
        <div className="progress-metric">
          <div><span>Mission completion</span><strong>{missionCompletion}%</strong></div>
          <div className="professional-progress"><i style={{width:`${missionCompletion}%`}}/></div>
        </div>
        <div className="evaluation-row"><span>Evaluated score</span><strong>{data.score==null?"Not evaluated yet":`${data.score}%`}</strong></div>
      </section>
    </div>

    <div className="workspace-main-grid lower-grid">
      <section className="workspace-card">
        <div className="card-heading">
          <div><span className="section-kicker">MISSIONS</span><h3>Mission focus</h3><p>Your current mission progress.</p></div>
          <a href="/student/missions">Open missions</a>
        </div>
        {data.missions.recent.length?data.missions.recent.map(m=>
          <div className="mission-row" key={m.id}>
            <div className="mission-mark"><TechinsIcon name="target" size={16} variant="light" /></div>
            <div><strong>{m.title}</strong><small>{m.due_date||"No deadline"}</small></div>
            <b>{Math.min(100,Number(m.progress||0))}%</b>
          </div>
        ):<div className="workspace-empty"><TechinsIcon name="target" size={40} variant="light" className="icon-sway" /><strong>No missions assigned yet</strong><span>Assigned missions will appear here.</span></div>}
      </section>

      <section className="workspace-card feedback-card">
        <div className="card-heading">
          <div><span className="section-kicker">PRIVATE FEEDBACK</span><h3>Latest feedback</h3><p>Feedback connected to your work.</p></div>
          <TechinsIcon name="comment" size={20} variant="light" className="feedback-mark" />
        </div>
        <p className="feedback-text">{data.feedback||"No feedback has been recorded yet."}</p>
      </section>
    </div>

    <section className="workspace-quick-links">
      <a href="/student/daily-activity">
        <span><TechinsIcon name="notepad" size={20} variant="light" /></span>
        <div><strong>Daily activity</strong><small>Record today's completed work, blockers and next steps.</small></div>
        <b><TechinsIcon name="chevron" size={18} variant="light" /></b>
      </a>
      <a href="/student/work-history">
        <span><TechinsIcon name="history" size={20} variant="light" /></span>
        <div><strong>Work history</strong><small>Review your stored work and submission history.</small></div>
        <b><TechinsIcon name="chevron" size={18} variant="light" /></b>
      </a>
      <a href="/student/performance">
        <span><TechinsIcon name="gauge" size={20} variant="light" /></span>
        <div><strong>Performance</strong><small>Review measurable progress and evaluated results.</small></div>
        <b><TechinsIcon name="chevron" size={18} variant="light" /></b>
      </a>
    </section>
  </div>
}
