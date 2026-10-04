import { useEffect, useState } from "react";
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
export default function AuditLogs(){
  const [logs,setLogs]=useState([]); const [loading,setLoading]=useState(true); const [error,setError]=useState("");
  const load=async()=>{try{setLoading(true);const r=await fetch(`${API_URL}/api/audit-logs`,{headers:{Authorization:`Bearer ${localStorage.getItem("token")}`}});const d=await r.json();if(!r.ok)throw new Error(d.message||"Unable to load audit logs");setLogs(d.logs||[]);setError("")}catch(e){setError(e.message)}finally{setLoading(false)}};
  useEffect(()=>{load()},[]);
  return <div className="admin-simple page-enter"><div className="simple-head"><span>ACCOUNTABILITY</span><h2>Audit Log</h2><p>Important portal actions recorded with actor, object, time and value changes.</p></div>{error&&<div className="error-msg">{error}</div>}<div className="panel table-wrap"><div className="panel-head"><div><span className="section-kicker">TRACEABILITY</span><h3>Recent events</h3></div><button onClick={load} disabled={loading}>Refresh</button></div><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Object</th><th>Change</th></tr></thead><tbody>{logs.map(log=><tr key={log.id}><td>{new Date(log.created_at).toLocaleString()}</td><td>{log.actor_name||"System"}</td><td>{log.action}</td><td>{log.entity_type} #{log.entity_id||"—"}</td><td><small>{log.new_value||"—"}</small></td></tr>)}</tbody></table>{!loading&&!logs.length&&<div className="empty-state">No audit events yet.</div>}</div></div>;
}
