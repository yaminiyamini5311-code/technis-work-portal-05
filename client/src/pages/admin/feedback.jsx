import { useEffect, useState } from "react";
import "../../styles/admin.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export default function Feedback() {
  const [students, setStudents] = useState([]);
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({
    user_id: "",
    score: "",
    feedback: "",
    strengths: "",
    improvements: ""
  });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const headers = {
    Authorization: `Bearer ${localStorage.getItem("token")}`
  };

  const load = async () => {
    try {
      const [a, b] = await Promise.all([
        fetch(`${API_URL}/api/admin/students`, { headers }),
        fetch(`${API_URL}/api/admin/feedback`, { headers })
      ]);
      const ad = await a.json();
      const bd = await b.json();
      setStudents(ad.students || []);
      setItems(bd.feedback || []);
    } catch (e) {
      console.error("Failed to load feedback data:", e);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setMessage("");
    setLoading(true);

    try {
      const r = await fetch(`${API_URL}/api/admin/feedback`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...form,
          user_id: Number(form.user_id),
          strengths: form.strengths.split(",").map(x => x.trim()).filter(Boolean),
          improvements: form.improvements.split(",").map(x => x.trim()).filter(Boolean)
        })
      });
      const d = await r.json();
      setMessage(r.ok ? "Feedback saved." : d.message || "Unable to save feedback");
      if (r.ok) {
        setForm({
          user_id: "",
          score: "",
          feedback: "",
          strengths: "",
          improvements: ""
        });
        load();
      }
    } catch (err) {
      setMessage("An error occurred while saving feedback");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-simple page-enter">
      <div className="simple-head">
        <span>MENTORING</span>
        <h2>Feedback</h2>
        <p>Give students private feedback and optional evaluated scores.</p>
      </div>

      {message && (
        <div className={message.startsWith("Feedback") ? "success-msg" : "error-msg"}>
          {message}
        </div>
      )}

      <form className="panel form-grid-admin" onSubmit={submit} autoComplete="off">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label htmlFor="feedback-student" style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-muted-on-light)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Student <span style={{ color: '#FA9A02' }}>*</span>
          </label>
          <select
            id="feedback-student"
            name="feedback-student"
            value={form.user_id}
            onChange={e => setForm({ ...form, user_id: e.target.value })}
            required
            autoComplete="off"
          >
            <option value="">Select student</option>
            {students.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label htmlFor="feedback-score" style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-muted-on-light)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Score (optional)
          </label>
          <input
            id="feedback-score"
            name="feedback-score"
            type="number"
            min="0"
            max="100"
            placeholder="Score (optional)"
            value={form.score}
            onChange={e => setForm({ ...form, score: e.target.value })}
            autoComplete="off"
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label htmlFor="feedback-strengths" style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-muted-on-light)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Strengths <span style={{ color: '#FA9A02' }}>*</span>
          </label>
          <input
            id="feedback-strengths"
            name="feedback-strengths"
            placeholder="Strengths (comma separated)"
            value={form.strengths}
            onChange={e => setForm({ ...form, strengths: e.target.value })}
            required
            autoComplete="off"
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label htmlFor="feedback-improvements" style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-muted-on-light)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Improvement areas <span style={{ color: '#FA9A02' }}>*</span>
          </label>
          <input
            id="feedback-improvements"
            name="feedback-improvements"
            placeholder="Improvement areas (comma separated)"
            value={form.improvements}
            onChange={e => setForm({ ...form, improvements: e.target.value })}
            required
            autoComplete="off"
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label htmlFor="feedback-text" style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-muted-on-light)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Feedback <span style={{ color: '#FA9A02' }}>*</span>
          </label>
          <textarea
            id="feedback-text"
            name="feedback-text"
            placeholder="Feedback"
            value={form.feedback}
            onChange={e => setForm({ ...form, feedback: e.target.value })}
            required
            autoComplete="off"
          />
        </div>

        <button className="gold-btn" type="submit" disabled={loading}>
          {loading ? "Saving..." : "Save Feedback"}
        </button>
      </form>

      <div className="panel table-wrap" style={{ marginTop: '20px' }}>
        <div className="panel-head">
          <div>
            <span className="section-kicker">RECENT FEEDBACK</span>
            <h3>Feedback history</h3>
          </div>
          <button onClick={load}>Refresh</button>
        </div>

        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Score</th>
              <th>Feedback</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id}>
                <td>{item.student_name}</td>
                <td>{item.score || "—"}</td>
                <td>{item.feedback}</td>
                <td>{new Date(item.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {!items.length && <div className="empty-state">No feedback yet.</div>}
      </div>
    </div>
  );
}
