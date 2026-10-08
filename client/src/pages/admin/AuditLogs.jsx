import { useEffect, useState } from "react";
import "./AuditLogs.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  // Filters
  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  
  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 50;

  const loadLogs = async () => {
    try {
      setLoading(true);
      setError("");

      const params = new URLSearchParams();
      if (activeTab !== "all") params.append("role", activeTab);
      if (searchQuery.trim()) params.append("search", searchQuery.trim());
      if (actionFilter) params.append("action", actionFilter);
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
      params.append("page", page);
      params.append("limit", limit);

      const response = await fetch(`${API_URL}/api/audit-logs?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to load audit logs");

      setLogs(data.logs || []);
      setTotal(data.pagination?.total || 0);
      setTotalPages(data.pagination?.totalPages || 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [activeTab, actionFilter, startDate, endDate, page]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    loadLogs();
  };

  const clearFilters = () => {
    setSearchQuery("");
    setActionFilter("");
    setStartDate("");
    setEndDate("");
    setActiveTab("all");
    setPage(1);
  };

  const getRoleBadgeClass = (role) => {
    switch (role?.toLowerCase()) {
      case "admin": return "role-badge role-admin";
      case "ceo": return "role-badge role-ceo";
      case "manager": return "role-badge role-manager";
      case "student": return "role-badge role-student";
      default: return "role-badge role-other";
    }
  };

  const formatAction = (action) => {
    return action
      .replace(/_/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const formatDetails = (log) => {
    const entityInfo = log.entity_type ? `${log.entity_type}${log.entity_id ? ` #${log.entity_id}` : ""}` : "—";
    
    // Parse metadata for additional details
    let details = entityInfo;
    try {
      if (log.metadata) {
        const meta = JSON.parse(log.metadata);
        if (meta.comment) details += ` (${meta.comment})`;
      }
      if (log.new_value) {
        const newVal = JSON.parse(log.new_value);
        if (newVal.task_code) details += ` - ${newVal.task_code}`;
        if (newVal.title) details += ` - ${newVal.title}`;
        if (newVal.submission_code) details += ` - ${newVal.submission_code}`;
      }
    } catch {
      // Ignore JSON parse errors
    }
    
    return details;
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return "—";
    const date = new Date(dateString);
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  };

  // Get unique action types for filter
  const actionTypes = [...new Set(logs.map(l => l.action))].sort();

  return (
    <div className="audit-logs-page page-enter">
      <div className="audit-header">
        <div>
          <span className="audit-eyebrow">ACCOUNTABILITY & TRACEABILITY</span>
          <h2>System Activity Logs</h2>
          <p>Complete audit trail of all portal activities across users and roles</p>
        </div>
        <button className="btn-refresh" onClick={() => loadLogs()} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && <div className="audit-error">{error}</div>}

      {/* Tabs for role filtering */}
      <div className="audit-tabs">
        <button
          className={activeTab === "all" ? "active" : ""}
          onClick={() => { setActiveTab("all"); setPage(1); }}
        >
          All
        </button>
        <button
          className={activeTab === "student" ? "active" : ""}
          onClick={() => { setActiveTab("student"); setPage(1); }}
        >
          Students
        </button>
        <button
          className={activeTab === "manager" ? "active" : ""}
          onClick={() => { setActiveTab("manager"); setPage(1); }}
        >
          Managers
        </button>
        <button
          className={activeTab === "admin" ? "active" : ""}
          onClick={() => { setActiveTab("admin"); setPage(1); }}
        >
          Admins
        </button>
        <button
          className={activeTab === "ceo" ? "active" : ""}
          onClick={() => { setActiveTab("ceo"); setPage(1); }}
        >
          CEO
        </button>
      </div>

      {/* Filters */}
      <div className="audit-filters">
        <form onSubmit={handleSearch} className="audit-search-form">
          <input
            type="text"
            placeholder="Search by user, email, action, or entity..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button type="submit" disabled={loading}>Search</button>
        </form>

        <div className="audit-filter-row">
          <select
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          >
            <option value="">All Actions</option>
            {actionTypes.map(action => (
              <option key={action} value={action}>{formatAction(action)}</option>
            ))}
          </select>

          <input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
            placeholder="Start Date"
          />

          <input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
            placeholder="End Date"
          />

          {(searchQuery || actionFilter || startDate || endDate || activeTab !== "all") && (
            <button className="btn-clear-filters" onClick={clearFilters}>
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Results count */}
      <div className="audit-results-info">
        Showing {logs.length} of {total} log entries
        {activeTab !== "all" && ` (filtered by ${activeTab})`}
      </div>

      {/* Logs Table */}
      <div className="audit-table-container">
        <table className="audit-table">
          <thead>
            <tr>
              <th>Date & Time</th>
              <th>User</th>
              <th>Role</th>
              <th>Action</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td className="audit-datetime">{formatDateTime(log.created_at)}</td>
                <td className="audit-user">
                  <div className="audit-user-info">
                    <span className="audit-user-name">{log.actor_name || "System"}</span>
                    <span className="audit-user-email">{log.actor_email || "—"}</span>
                  </div>
                </td>
                <td>
                  <span className={getRoleBadgeClass(log.actor_role)}>
                    {log.actor_role ? log.actor_role.toUpperCase() : "SYSTEM"}
                  </span>
                </td>
                <td className="audit-action">{formatAction(log.action)}</td>
                <td className="audit-details">{formatDetails(log)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {!loading && logs.length === 0 && (
          <div className="audit-empty-state">
            <p>No logs found</p>
            <small>Try adjusting your filters or search criteria</small>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="audit-pagination">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || loading}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
