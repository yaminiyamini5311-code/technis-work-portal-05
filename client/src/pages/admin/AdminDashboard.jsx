import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatNumber } from "../../components/useCountUp";
import TechinsIcon from "../../components/TechinsIcon";
import "./AdminDashboard.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

/* Count-up figures live in the shared useCountUp hook (transform-free,
   textContent-only ticking that honours reduced-motion). */

function MiniLineChart({ labels = [], values = [], period = "" }) {
  if (!values.length || !labels.length) {
    return <div className="chart-shell"><div className="empty-state">No data available</div></div>;
  }
  
  const width = 760, height = 250, pad = 30;
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = pad + (index * (width - pad * 2)) / Math.max(values.length - 1, 1);
    const y = height - pad - (value / max) * (height - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  const area = `${pad},${height-pad} ${points} ${width-pad},${height-pad}`;
  // Peak callout: echoes the reference film's tooltip bubble ("Sales 2,678")
  // that rides the chart's highest point — rendered from the real maximum.
  const maxIdx = values.reduce((best, v, i) => (v > values[best] ? i : best), 0);
  const maxParts = (points.split(" ")[maxIdx] || `${pad},${pad}`).split(",");
  const maxX = Number(maxParts[0]), maxY = Number(maxParts[1]);
  const chipW = 64, chipH = 30;
  const chipX = Math.min(Math.max(maxX - chipW / 2, 2), width - chipW - 2);
  const chipY = Math.max(maxY - chipH - 14, 2);
  
  // Keyed on `period` so the draw + travelling cursor replay when the
  // pill tab changes (a deliberate state change), exactly like the
  // reference film's chart redraw. Data mapping is unchanged.
  return <div className="chart-shell"><svg key={period} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Student task completion progress chart">
    {[0,1,2,3,4].map(i => <line key={i} x1={pad} x2={width-pad} y1={pad + i*47} y2={pad + i*47} className="chart-grid" />)}
    <polygon points={area} className="chart-area" />
    <polyline points={points} className="chart-line" fill="none" />
    <line x1={pad} x2={pad} y1={pad} y2={height-pad} className="chart-cursor" />
    {values.map((value,index)=>{
      const pointParts = points.split(" ")[index];
      if (!pointParts) return null;
      const [x,y] = pointParts.split(",");
      return <circle key={`${period}-${index}`} cx={x} cy={y} r="4" className="chart-dot"><title>{`${labels[index]}: ${value} completed`}</title></circle>
    })}
    <g className="chart-callout" transform={`translate(${chipX},${chipY})`}>
      <rect width={chipW} height={chipH} rx="8" className="chart-callout-box" />
      <text x={chipW / 2} y={chipH / 2 + 1} textAnchor="middle" dominantBaseline="middle" className="chart-callout-text">{values[maxIdx]}</text>
      <title>{`Peak: ${values[maxIdx]} completed on ${labels[maxIdx]}`}</title>
    </g>
  </svg><div className="chart-labels">{labels.filter((_,i)=>i===0||i===labels.length-1||i===Math.floor(labels.length/2)).map((label,i)=><span key={`${label}-${i}`}>{label}</span>)}</div></div>;
}

export default function AdminDashboard() {
  const [data,setData]=useState(null);
  const [period,setPeriod]=useState("week");
  const [chart,setChart]=useState({labels:[],values:[]});
  const [submissions,setSubmissions]=useState([]);
  const [pendingRegistrations,setPendingRegistrations]=useState([]);
  const [loading,setLoading]=useState(true);
  // { kind: "network" | "auth" | "forbidden" | "http", message, status? }
  const [error,setError]=useState(null);

  // Guards against duplicate/in-flight fetches (React StrictMode mounts
  // effects twice in dev; without this every dashboard call fires twice).
  const busyRef = useRef(false);
  const abortRef = useRef(null);

  const headers={Authorization:`Bearer ${localStorage.getItem("token")}`};

  const isNetworkError = (err) =>
    err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(String(err?.message || ""));

  const classifyHttp = (responses) => {
    const bad = responses.find((r) => !r.ok);
    if (!bad) return null;
    if (bad.status === 401) return { kind: "auth", status: 401, message: "Your session has expired. Please log in again." };
    if (bad.status === 403) return { kind: "forbidden", status: 403, message: "You do not have permission to view the dashboard." };
    return { kind: "http", status: bad.status, message: `The server returned an error (${bad.status}). Please try again.` };
  };

  const load=useCallback(async ({ force = false } = {}) => {
    // Genuine refetch path (Retry, period change, interval) always runs;
    // overlapping renders never stack duplicate requests.
    if (busyRef.current && !force) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    busyRef.current = true;
    // Built inside the callback (not a dep): the token is read fresh on
    // every fetch, and the callback identity stays stable so the effect
    // below cannot loop.
    const liveHeaders = { Authorization: `Bearer ${localStorage.getItem("token")}` };
    try{
      setError(null);
      setLoading(true);
      const [stats,progress,sub,pending]=await Promise.all([
        fetch(`${API_URL}/api/admin/stats`,{headers: liveHeaders, signal: ctrl.signal}),
        fetch(`${API_URL}/api/admin/progress?period=${period}`,{headers: liveHeaders, signal: ctrl.signal}),
        fetch(`${API_URL}/api/tasks/submissions`,{headers: liveHeaders, signal: ctrl.signal}),
        fetch(`${API_URL}/api/admin/pending-registrations`,{headers: liveHeaders, signal: ctrl.signal})
      ]);

      // Resilient: render every endpoint that succeeded instead of failing
      // the whole dashboard when only one call errors. Real data only —
      // failed endpoints keep their previous (or empty) state.
      const httpError = classifyHttp([stats,progress,sub,pending]);
      const settled = await Promise.all([stats.json(),progress.json(),sub.json(),pending.json()].map((p) => p.catch(() => null)));
      const [a,b,c,d]=settled;

      if(stats.ok && a?.success) {
        setData(a.stats);
      } else if (a) {
        console.error("Stats error:", a);
      }

      if(progress.ok && b?.success && Array.isArray(b.progress)) {
        // Transform progress data into chart format
        const labels = b.progress.map(p => {
          const date = new Date(p.date);
          return `${date.getMonth()+1}/${date.getDate()}`;
        });
        const values = b.progress.map(p => p.count || 0);
        setChart({labels, values});
      } else {
        setChart({labels:[], values:[]});
      }

      if(sub.ok && c?.success) {
        setSubmissions(c.submissions||[]);
      }

      if(pending.ok && d?.success) {
        setPendingRegistrations(d.pending||[]);
      }

      // Surface HTTP errors only when nothing usable rendered.
      if (httpError && !stats.ok) {
        setError(httpError);
      }
    } catch(err) {
      if (ctrl.signal.aborted) return; // unmounted / superseded — not an error
      console.error("Dashboard load error:", err);
      setError(isNetworkError(err)
        ? { kind: "network", message: "The server is unreachable. Check that the backend is running, then retry." }
        : { kind: "http", message: "Unable to load dashboard data. Please try again." });
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
      busyRef.current = false;
    }
  },[period]);

  // Single effect owner: initial load + 20s refresh, no loops (dep is the
  // stable `load` callback, which only changes with `period`). Aborts any
  // in-flight request and clears the interval on unmount or period change.
  useEffect(()=>{
    let alive = true;
    setLoading(true);
    load({ force: true });
    const id=setInterval(()=>{ if (alive) load({ force: true }); },20000);
    return()=>{ alive = false; clearInterval(id); abortRef.current?.abort(); };
  },[load]);
  const maxStudents = data?.maxStudents || 100;
  const capacity=useMemo(()=>Math.min(((data?.students||0)/maxStudents)*100,100),[data, maxStudents]);
  
  // Distinguish between "loading", "failed to load" and "loaded with zeros"
  const hasLoaded = data !== null;
  const hasFailed = error !== null;
  
  const handleApprove = async (userId) => {
    try {
      const response = await fetch(`${API_URL}/api/admin/approve-registration/${userId}`, {
        method: 'POST',
        headers
      });
      const result = await response.json();
      if (response.ok) {
        // Reload dashboard to refresh pending list
        load();
      } else {
        alert(result.message || 'Failed to approve registration');
      }
    } catch (error) {
      console.error('Approve error:', error);
      alert('Failed to approve registration');
    }
  };

  const handleReject = async (userId) => {
    if (!confirm('Are you sure you want to reject this registration?')) return;
    try {
      const response = await fetch(`${API_URL}/api/admin/reject-registration/${userId}`, {
        method: 'POST',
        headers
      });
      const result = await response.json();
      if (response.ok) {
        // Reload dashboard to refresh pending list
        load();
      } else {
        alert(result.message || 'Failed to reject registration');
      }
    } catch (error) {
      console.error('Reject error:', error);
      alert('Failed to reject registration');
    }
  };
  
  if(loading&&!data)return <div className="portal-loading"><div className="loader-dot"/><h2>Loading CEO workspace</h2><p>Syncing the latest team data.</p></div>;

  if(error && !data) return <div className="portal-loading"><div className="error-icon"><TechinsIcon name="alert" size={28} ariaLabel="Error" /></div><h2>Unable to load dashboard</h2><p>{error.message}</p>{error.kind === "network" && <p style={{marginTop:"0.5rem",fontSize:"0.9rem",opacity:0.8}}>Check that the backend API is running and VITE_API_URL is configured correctly.</p>}<button onClick={() => { setLoading(true); load({ force: true }); }} disabled={loading} style={{marginTop:"1rem",padding:"0.75rem 1.5rem",fontSize:"1rem"}}>{loading ? "Retrying…" : "Retry"}</button></div>;

  return <div className="admin-simple page-enter">
    <div className="simple-head"><span>CEO CONTROL CENTER</span><h2>Command dashboard</h2><p>One view for students, assignments, missions, daily work and performance.</p></div>
    {loading && data ? <div className="dashboard-sync" role="status">Syncing latest data…</div> : null}
    {error && data ? <div className="dashboard-error" role="alert" style={{padding:"1rem",margin:"1rem 0",background:"#fff3cd",border:"1px solid #ffc107",borderRadius:"8px",display:"flex",alignItems:"center",gap:"1rem"}}><TechinsIcon name="alert" size={22} ariaLabel="Warning" /><div style={{flex:1}}><strong>Partial data loaded</strong><p style={{margin:"0.25rem 0 0",fontSize:"0.9rem"}}>{error.message}</p></div><button onClick={() => load({ force: true })} disabled={loading} style={{padding:"0.5rem 1rem"}}>{loading ? "Retrying…" : "Retry"}</button></div> : null}

    {/* Pending Registrations Panel */}
    {pendingRegistrations.length > 0 && (
      <section className="panel pending-registrations-panel">
        <div className="panel-head">
          <div>
            <span className="section-kicker">REGISTRATION REQUESTS</span>
            <h3>Pending Student Approvals</h3>
            <p>{pendingRegistrations.length} student{pendingRegistrations.length===1?'':'s'} waiting for approval.</p>
          </div>
        </div>
        <div className="pending-registrations-list">
          {pendingRegistrations.map(student => (
            <div className="pending-registration-item" key={student.id}>
              <div className="pending-student-avatar">
                {student.name.charAt(0).toUpperCase()}
              </div>
              <div className="pending-student-info">
                <strong>{student.name}</strong>
                <small>{student.email}</small>
                <small className="registration-date">
                  Registered: {new Date(student.created_at).toLocaleString()}
                </small>
              </div>
              <div className="pending-actions">
                <button 
                  className="approve-btn"
                  onClick={() => handleApprove(student.id)}
                >
                  Approve
                </button>
                <button 
                  className="reject-btn"
                  onClick={() => handleReject(student.id)}
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    )}

    <div className="admin-stat-grid">
      {[['Students',data?.students||0,'01'],['Tasks',data?.tasks||0,'02'],['Completed',data?.completedTasks||0,'03'],['Pending',data?.pendingTasks||0,'04'],['Missions',data?.missions||0,'05'],["Today's activity",data?.activitiesToday||0,'06']].map(([label,value,no])=><div className="admin-stat" key={label}><small>{no}</small><span>{label}</span><StatNumber value={value} /></div>)}
    </div>
    <section className="panel admin-chart-panel">
      <div className="panel-head chart-head"><div><span className="section-kicker">LIVE PROGRESS</span><h3>Student completion activity</h3><p>Real completed-task data tracked across your team.</p></div><div className="chart-tabs"><span className="chart-slider" aria-hidden="true" />{['week','month','year'].map(item=><button key={item} className={period===item?'active':''} onClick={()=>setPeriod(item)}>{item}</button>)}</div></div>
      {chart?.values?.length ? <MiniLineChart labels={chart.labels} values={chart.values} period={period}/> : <div className="empty-state">No completion activity has been recorded yet.</div>}
    </section>
    <div className="admin-quick">
      <div className="panel capacity-panel"><div className="icon-head"><div className="section-icon"><TechinsIcon name="gauge" size={22} variant="dark" /></div><div><h3>Student capacity</h3><p>{data?.students||0} of {maxStudents} student accounts are currently registered.</p></div></div><div className="capacity"><i style={{width:`${capacity}%`}}/></div><div className="capacity-meta"><span>Available slots</span><strong>{Math.max(maxStudents-(data?.students||0),0)}</strong></div></div>
      <div className="panel"><div className="icon-head"><div className="section-icon"><TechinsIcon name="grid" size={22} variant="dark" /></div><div><h3>Quick actions</h3><p>Move directly into the areas you manage most.</p></div></div><div className="quick-actions"><a href="/admin/students">Create ID</a><a href="/admin/tasks">Assign task</a><a href="/admin/missions">Create mission</a><a href="/admin/feedback">Give feedback</a></div></div>
    </div>
    <section className="panel"><div className="panel-head"><div><span className="section-kicker">SUBMITTED WORK</span><h3>Latest task outcomes & files</h3></div><a className="panel-link" href="/admin/tasks">Open task control →</a></div>{submissions?.length?<div className="submission-list">{submissions.slice(0,6).map(item=><div className="submission-row" key={item.id}><div className="submission-avatar">{(item.student_name||'S').charAt(0).toUpperCase()}</div><div><strong>{item.title}</strong><small>{item.student_name} · {item.outcome_submitted_at ? new Date(item.outcome_submitted_at).toLocaleString() : 'Files uploaded'}</small></div><span>{item.file_count||0} file{item.file_count===1?'':'s'}</span></div>)}</div>:<div className="empty-state">No student reports or task files submitted yet.</div>}</section>
  </div>;
}
