import { useEffect, useMemo, useState } from "react";
import "./AdminDashboard.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

function MiniLineChart({ labels, values }) {
  const width = 760, height = 250, pad = 30;
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = pad + (index * (width - pad * 2)) / Math.max(values.length - 1, 1);
    const y = height - pad - (value / max) * (height - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  const area = `${pad},${height-pad} ${points} ${width-pad},${height-pad}`;
  return <div className="chart-shell"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Student task completion progress chart">
    {[0,1,2,3,4].map(i => <line key={i} x1={pad} x2={width-pad} y1={pad + i*47} y2={pad + i*47} className="chart-grid" />)}
    <polygon points={area} className="chart-area" />
    <polyline points={points} className="chart-line" fill="none" />
    {values.map((value,index)=>{const [x,y]=points.split(" ")[index].split(","); return <circle key={index} cx={x} cy={y} r="4" className="chart-dot"><title>{`${labels[index]}: ${value} completed`}</title></circle>})}
  </svg><div className="chart-labels">{labels.filter((_,i)=>i===0||i===labels.length-1||i===Math.floor(labels.length/2)).map((label,i)=><span key={`${label}-${i}`}>{label}</span>)}</div></div>;
}

export default function AdminDashboard() {
  const [data,setData]=useState(null); const [period,setPeriod]=useState("week"); const [chart,setChart]=useState({labels:[],values:[]}); const [submissions,setSubmissions]=useState([]); const [loading,setLoading]=useState(true);
  const headers={Authorization:`Bearer ${localStorage.getItem("token")}`};
  const load=async()=>{try{const [stats,progress,sub]=await Promise.all([fetch(`${API_URL}/api/admin/stats`,{headers}),fetch(`${API_URL}/api/admin/progress?period=${period}`,{headers}),fetch(`${API_URL}/api/tasks/submissions`,{headers})]); const [a,b,c]=await Promise.all([stats.json(),progress.json(),sub.json()]); if(stats.ok)setData(a); if(progress.ok)setChart(b); if(sub.ok)setSubmissions(c.submissions||[]);}finally{setLoading(false)}};
  useEffect(()=>{load();const id=setInterval(load,20000);return()=>clearInterval(id)},[period]);
  const capacity=useMemo(()=>Math.min(((data?.students||0)/25)*100,100),[data]);
  if(loading&&!data)return <div className="portal-loading"><div className="loader-dot"/><h2>Loading admin workspace</h2><p>Syncing the latest team data.</p></div>;
  return <div className="admin-simple page-enter">
    <div className="simple-head"><span>ADMIN CONTROL CENTER</span><h2>Command dashboard</h2><p>One view for students, assignments, missions, daily work and performance.</p></div>
    <div className="admin-stat-grid">
      {[['Students',data?.students||0,'01'],['Tasks',data?.tasks||0,'02'],['Completed',data?.completedTasks||0,'03'],['Pending',data?.pendingTasks||0,'04'],['Missions',data?.missions||0,'05'],["Today's activity",data?.activitiesToday||0,'06']].map(([label,value,no])=><div className="admin-stat" key={label}><small>{no}</small><span>{label}</span><strong>{value}</strong></div>)}
    </div>
    <section className="panel admin-chart-panel">
      <div className="panel-head chart-head"><div><span className="section-kicker">LIVE PROGRESS</span><h3>Student completion activity</h3><p>Real completed-task data from the SQLite database.</p></div><div className="chart-tabs">{['week','month','year'].map(item=><button key={item} className={period===item?'active':''} onClick={()=>setPeriod(item)}>{item}</button>)}</div></div>
      {chart.values.length?<MiniLineChart labels={chart.labels} values={chart.values}/>:<div className="empty-state">No completion activity has been recorded yet.</div>}
    </section>
    <div className="admin-quick">
      <div className="panel capacity-panel"><div className="section-icon">◈</div><div><h3>Student capacity</h3><p>{data?.students||0} of 25 student accounts are currently registered.</p></div><div className="capacity"><i style={{width:`${capacity}%`}}/></div><div className="capacity-meta"><span>Available slots</span><strong>{Math.max(25-(data?.students||0),0)}</strong></div></div>
      <div className="panel"><div className="section-icon">✦</div><div><h3>Quick actions</h3><p>Move directly into the areas you manage most.</p></div><div className="quick-actions"><a href="/admin/students">Create student</a><a href="/admin/tasks">Assign task</a><a href="/admin/missions">Create mission</a><a href="/admin/feedback">Give feedback</a></div></div>
    </div>
    <section className="panel"><div className="panel-head"><div><span className="section-kicker">SUBMITTED WORK</span><h3>Latest task outcomes & files</h3></div><a className="panel-link" href="/admin/tasks">Open task control →</a></div>{submissions.length?<div className="submission-list">{submissions.slice(0,6).map(item=><div className="submission-row" key={item.id}><div className="submission-avatar">{(item.student_name||'S').charAt(0).toUpperCase()}</div><div><strong>{item.title}</strong><small>{item.student_name} · {item.outcome_submitted_at ? new Date(item.outcome_submitted_at).toLocaleString() : 'Files uploaded'}</small></div><span>{item.file_count||0} file{item.file_count===1?'':'s'}</span></div>)}</div>:<div className="empty-state">No student reports or task files submitted yet.</div>}</section>
  </div>;
}
