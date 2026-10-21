import { useEffect, useMemo, useState } from "react";
import "../../styles/manager-femly.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

// DEMO DATA: workload % not supplied by the API; seeded per member.
const DEMO_MEMBERS = [
  { id: "m1", name: "Aria Patel", department: "Engineering", email: "aria.patel@techins.example", workload: 68, status: "Active" },
  { id: "m2", name: "Jordan Lee", department: "Design", email: "jordan.lee@techins.example", workload: 42, status: "Active" },
  { id: "m3", name: "Sam Rivera", department: "Marketing", email: "sam.rivera@techins.example", workload: 81, status: "Busy" },
  { id: "m4", name: "Tina Okafor", department: "Management", email: "tina.okafor@techins.example", workload: 55, status: "Active" },
];

const TEAMS = ["All", "Engineering", "Design", "Marketing", "Management"];

function teamFor(department) {
  if (!department) return "Engineering";
  const d = String(department).toLowerCase();
  for (const t of TEAMS) if (t !== "All" && t.toLowerCase() === d) return t;
  return "Engineering";
}

export default function Team() {
  const [members, setMembers] = useState([]);
  const [filter, setFilter] = useState("All");
  const [profile, setProfile] = useState(null);
  const [renderKey, setRenderKey] = useState(0);

  useEffect(() => {
    fetch(`${API_URL}/api/tasks/students`, { headers: auth() })
      .then((r) => r.json())
      .then((data) => {
        const list = (data.success ? data.students : data) || DEMO_MEMBERS;
        setMembers(list.map((s) => ({
          id: s.id,
          name: s.name || "Unknown",
          department: s.department || "Engineering",
          email: s.email || "",
          workload: DEMO_MEMBERS.find((m) => m.name === s.name)?.workload || Math.floor(30 + Math.random() * 60),
          status: "Active",
        })));
      })
      .catch(() => setMembers(DEMO_MEMBERS));
  }, []);

  const filtered = useMemo(() => {
    if (filter === "All") return members;
    return members.filter((m) => teamFor(m.department) === filter);
  }, [members, filter]);

  const openProfile = (m) => { setProfile(m); setRenderKey((k) => k + 1); };
  const closeProfile = () => setProfile(null);

  return (
    <div className="manager-page page-enter" style={{ paddingBottom: 40 }}>
      {profile && (
        <>
          <div className="femly-profile-backdrop femly-profile-backdrop--show" onClick={closeProfile} />
          <div className="femly-profile-panel femly-profile-panel--open">
            <button className="femly-btn femly-btn--secondary" style={{ alignSelf: "flex-start", marginBottom: 12 }} onClick={closeProfile}>Close</button>
            <div className="panel" style={{ flex: 1, overflowY: "auto", padding: 0 }}>
              <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--line)" }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "var(--ink)" }}>{profile.name}</span>
                <div style={{ fontSize: 11, color: "var(--mut)", marginTop: 2 }}>{profile.department}</div>
                <div style={{ fontSize: 11, color: "var(--mut)", marginTop: 4 }}>{profile.email}</div>
              </div>
              <div style={{ padding: "16px 22px", display: "grid", gap: 14 }}>
                <div>
                  <span style={{ fontSize: 10, fontWeight: 800, color: "var(--mut)", textTransform: "uppercase" }}>Workload</span>
                  <div style={{ height: 8, background: "var(--line)", borderRadius: 999, marginTop: 6, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${profile.workload}%`, background: "var(--a)" }}></div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)", marginTop: 4 }}>{profile.workload}%</div>
                </div>
                <div>
                  <span style={{ fontSize: 10, fontWeight: 800, color: "var(--mut)", textTransform: "uppercase" }}>Status</span>
                  <span className="pill completed">{profile.status}</span>
                </div>
                <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10 }}>
                  <button className="femly-btn femly-btn--primary" style={{ flex: 1 }}>Message {profile.name}</button>
                  <button className="femly-btn femly-btn--secondary" style={{ flex: 1 }} onClick={closeProfile}>Back to team</button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="simple-head">
        <span>TEAM</span>
        <h2>Team collaboration</h2>
        <p>Filter members and open a profile to message or view details.</p>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {TEAMS.map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`femly-btn ${filter === t ? "femly-btn--primary" : "femly-btn--secondary"}`}
            style={{ fontSize: 12, height: 30, padding: "0 12px" }}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="panel">
        <div className="panel-head"><div><span className="section-kicker">MEMBERS</span><h3>{filtered.length} members</h3></div></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }} key={renderKey}>
          {filtered.map((m, i) => (
            <div
              key={m.id}
              className="team-card"
              style={{
                animation: `femly-card-in 450ms cubic-bezier(.2,.8,.2,1) ${i * 60}ms both`,
                background: "var(--card)", border: "1px solid var(--line)", borderRadius: 14, padding: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--a4)", color: "var(--a)", display: "grid", placeItems: "center", fontWeight: 800 }}>{m.name.charAt(0)}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>{m.name}</div>
                  <div style={{ fontSize: 11, color: "var(--mut)" }}>{m.department}</div>
                </div>
              </div>
              <div style={{ height: 8, background: "#e3e6df", borderRadius: 999, marginBottom: 10, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${m.workload}%`, background: "var(--a)", transition: "width 600ms ease" }}></div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)", marginBottom: 10 }}>{m.workload}% workload</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="femly-btn femly-btn--secondary" style={{ flex: 1, fontSize: 11, padding: 6 }} onClick={() => openProfile(m)}>Profile</button>
                <button className="femly-btn femly-btn--primary" style={{ flex: 1, fontSize: 11, padding: 6 }}>Message</button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="empty-state">No members match this filter.</div>}
        </div>
      </div>
    </div>
  );
}
