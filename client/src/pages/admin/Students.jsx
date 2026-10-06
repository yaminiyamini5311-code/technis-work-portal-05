import { useEffect, useState } from "react";
import { useExclusiveSelect } from "../../hooks/useExclusiveSelect";
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

const DEPARTMENTS = [
  { value: "edutins", label: "Edutins" },
  { value: "resins", label: "Resins" },
  { value: "innovins", label: "Innovins" },
  { value: "systins", label: "Systins" },
  { value: "program", label: "Program" }
];

const PROGRAMS = [
  { value: "techins 60", label: "Techins 60" },
  { value: "ai ally", label: "AI Ally" },
  { value: "life wise", label: "Life Wise" },
  { value: "foundation x", label: "Foundation X" },
  { value: "concept to carrier", label: "Concept to Carrier" },
  { value: "unlock", label: "Unlock" }
];

export default function Students() {
  const [students, setStudents] = useState([]);
  const [maxStudents, setMaxStudents] = useState(100);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const { department, program, setDepartment, setProgram, reset, isDepartmentDisabled, isProgramDisabled } = useExclusiveSelect();
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      const [studentsRes, statsRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/students`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
        }),
        fetch(`${API_URL}/api/admin/stats`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
        })
      ]);

      const studentsData = await studentsRes.json();
      const statsData = await statsRes.json();

      if (!studentsRes.ok) throw new Error(studentsData.message || "Unable to load students");
      
      setStudents(studentsData.students || []);
      if (statsData.success && statsData.stats?.maxStudents) {
        setMaxStudents(statsData.stats.maxStudents);
      }
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const create = async (e) => {
    e.preventDefault();
    setMsg("");
    setError("");
    setLoading(true);

    try {
      const r = await fetch(`${API_URL}/api/admin/students`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`
        },
        body: JSON.stringify({ ...form, department, program })
      });

      const d = await r.json();

      if (!r.ok) {
        setError(d.message || "Unable to create ID");
        return;
      }

      setMsg("ID created successfully.");
      setForm({ name: "", email: "", password: "" });
      reset();
      load();
    } catch (err) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const isLimitReached = students.length >= maxStudents;

  return (
    <div className="admin-simple">
      <div className="simple-head">
        <span>TEAM MANAGEMENT</span>
        <h2>Students</h2>
        <p>{students.length} / {maxStudents} student accounts.</p>
      </div>

      <div className="admin-two">
        <form className="panel" onSubmit={create} autocomplete="off">
          <h3>Create ID</h3>

          <label htmlFor="student-name">
            Full name
            <input
              id="student-name"
              name="student-name"
              placeholder="Full name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              autocomplete="off"
            />
          </label>

          <label htmlFor="student-email">
            Email
            <input
              id="student-email"
              name="student-email"
              type="email"
              placeholder="Email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              autocomplete="off"
            />
          </label>

          <label htmlFor="student-password">
            Temporary password
            <input
              id="student-password"
              name="student-password"
              type="password"
              placeholder="Temporary password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              autocomplete="new-password"
            />
          </label>

          <label htmlFor="student-department">
            Department
            <select
              id="student-department"
              name="student-department"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              disabled={isProgramDisabled}
              style={isProgramDisabled ? { opacity: 0.5, cursor: 'not-allowed', backgroundColor: 'rgba(0,0,0,0.05)' } : {}}
              title={isProgramDisabled ? "Disabled because a Program is selected" : ""}
              aria-disabled={isProgramDisabled}
            >
              <option value="">Select department</option>
              {DEPARTMENTS.map((dept) => (
                <option key={dept.value} value={dept.value}>
                  {dept.label}
                </option>
              ))}
            </select>
            {isProgramDisabled && (
              <small style={{ fontSize: '10px', color: 'var(--text-muted-on-light)', marginTop: '2px' }}>Disabled because a Program is selected</small>
            )}
          </label>

          <label htmlFor="student-program">
            Program
            <select
              id="student-program"
              name="student-program"
              value={program}
              onChange={(e) => setProgram(e.target.value)}
              disabled={isDepartmentDisabled}
              style={isDepartmentDisabled ? { opacity: 0.5, cursor: 'not-allowed', backgroundColor: 'rgba(0,0,0,0.05)' } : {}}
              title={isDepartmentDisabled ? "Disabled because a Department is selected" : ""}
              aria-disabled={isDepartmentDisabled}
            >
              <option value="">Select program</option>
              {PROGRAMS.map((prog) => (
                <option key={prog.value} value={prog.value}>
                  {prog.label}
                </option>
              ))}
            </select>
            {isDepartmentDisabled && (
              <small style={{ fontSize: '10px', color: 'var(--text-muted-on-light)', marginTop: '2px' }}>Disabled because a Department is selected</small>
            )}
          </label>

          <button 
            className="gold-btn" 
            type="submit"
            disabled={loading || isLimitReached}
          >
            {loading ? "Creating ID…" : "Create ID"}
          </button>

          {isLimitReached && (
            <div className="error-msg">
              Student limit of {maxStudents} has been reached. Cannot create more student accounts.
            </div>
          )}

          {msg && <div className="success-msg">{msg}</div>}
          {error && <div className="error-msg">{error}</div>}
        </form>

        <div className="panel">
          <div className="panel-head">
            <h3>Registered Students</h3>
            <button onClick={() => load()}>Refresh</button>
          </div>

          {students.length ? (
            students.map((s) => (
              <div className="list-row" key={s.id}>
                <div className="avatar">{s.name.charAt(0).toUpperCase()}</div>
                <div>
                  <strong>{s.name}</strong>
                  <small>
                    {s.email}
                    {s.department && ` · ${s.department.charAt(0).toUpperCase() + s.department.slice(1)}`}
                    {s.program && ` · ${s.program.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}`}
                  </small>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">No students yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
