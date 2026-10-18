import { useCallback, useEffect, useState } from "react";
import TechinsIcon from "../../components/TechinsIcon";
import StatusBadge from "../../components/StatusBadge";
import { formatWorkspaceDate, pluralise } from "../../utils/dateHelper";
import "../../styles/admin.css";
import "../../styles/ceo-ui.css";
import "./DailyActivities.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

/**
 * CEO Daily Activities.
 *
 * GET /api/activities returns one document per logged activity. Previously
 * this was a single line of JSX rendering a flat <article> list, so:
 *   • rows had no card treatment, no equal height and no grid,
 *   • `.activity-admin h4` inherited a near-black colour on the dark canvas,
 *   • the duration read "1 hours" because the plural was hard-coded,
 *   • the date was the raw stored string, not the shared format.
 *
 * Each activity is now one card in a responsive grid. Nothing is removed: the
 * student, title, description, date, duration and status are all still shown,
 * and a description longer than four lines gets an explicit Show more / Show
 * less toggle rather than being permanently clipped.
 */

/** Description clamp height, in lines. */
const CLAMP_LINES = 4;

export default function DailyActivities() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/activities`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      const data = await res.json();
      setItems(data.activities || data.data?.activities || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = (id) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="admin-simple">
      <div className="simple-head">
        <span>TEAM ACTIVITY</span>
        <h2>Daily Activities</h2>
        <p>Monitor student work submissions.</p>
      </div>

      <div className="panel">
        {/* Heading and Refresh on one aligned row at one control height. */}
        <div className="panel-head ui-toolbar">
          <div>
            <span className="section-kicker">RECENT</span>
            <h3>Recent submissions</h3>
          </div>
          <div className="ui-toolbar-controls">
            <button type="button" className="ui-btn ui-btn--neutral" onClick={load} disabled={loading}>
              <TechinsIcon name="refresh" size={14} variant="light" ariaHidden />
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {items.length > 0 ? (
          <div className="activity-grid">
            {items.map(a => {
              const open = expanded.has(a.id);
              return (
                <article className="activity-card" key={a.id}>
                  <header className="activity-card-head">
                    <span className="activity-avatar" aria-hidden="true">
                      {(a.student_name || "S").charAt(0).toUpperCase()}
                    </span>
                    <strong className="activity-student">{a.student_name || "Unknown student"}</strong>
                  </header>

                  {/* Was near-black on the dark canvas; see DailyActivities.css. */}
                  <h4 className="activity-title" title={a.work_title || ""}>
                    {a.work_title || "Untitled activity"}
                  </h4>

                  <p
                    className={`activity-description ui-clamp${open ? " is-open" : ""}`}
                    style={{ "--ui-clamp-lines": CLAMP_LINES }}
                  >
                    {a.description || "No description provided."}
                  </p>
                  {a.description && (
                    <button
                      type="button"
                      className="ui-toggle"
                      onClick={() => toggle(a.id)}
                      aria-expanded={open}
                    >
                      {open ? "Show less" : "Show more"}
                    </button>
                  )}

                  <footer className="activity-foot">
                    <span className="activity-date">{formatWorkspaceDate(a.date)}</span>
                    {/* "1 hour" / "2 hours" — the plural was hard-coded before. */}
                    <span className="activity-duration">
                      <TechinsIcon name="stopwatch" size={12} variant="light" ariaHidden />
                      {pluralise(Number(a.hours_worked) || 0, "hour")}
                    </span>
                    <StatusBadge status={a.status} />
                  </footer>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            {loading ? "Loading activities…" : "No activities submitted yet."}
          </div>
        )}
      </div>
    </div>
  );
}