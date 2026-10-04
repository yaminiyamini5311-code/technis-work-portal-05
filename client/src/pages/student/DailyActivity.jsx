import { useEffect, useState } from "react";
import axios from "axios";
import "./DailyActivity.css";

const API_URL =
    import.meta.env.VITE_API_URL || "http://localhost:5000";

function DailyActivity() {
    const [activities, setActivities] = useState([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    const [form, setForm] = useState({
        work_title: "",
        description: "",
        hours_worked: "",
        status: "completed",
        blockers: ""
    });

    const getToken = () => {
        return localStorage.getItem("token");
    };

    const getUser = () => {
        try {
            return JSON.parse(localStorage.getItem("user") || "{}");
        } catch {
            return {};
        }
    };

    const loadActivities = async () => {
        try {
            setLoading(true);
            setError("");

            const token = getToken();

            if (!token) {
                setError("Login session not found. Please login again.");
                return;
            }

            const response = await axios.get(
                `${API_URL}/api/activity/me`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                }
            );

            const data = response.data;

            if (Array.isArray(data)) {
                setActivities(data);
            } else if (Array.isArray(data.activities)) {
                setActivities(data.activities);
            } else {
                setActivities([]);
            }
        } catch (err) {
            console.error("Daily activity error:", err);

            if (err.response) {
                setError(
                    err.response.data?.message ||
                    "Unable to load your activities."
                );
            } else {
                setError(
                    "Unable to connect to the server."
                );
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadActivities();
    }, []);

    const handleChange = (event) => {
        const { name, value } = event.target;

        setForm((previous) => ({
            ...previous,
            [name]: value
        }));

        setError("");
        setSuccess("");
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        setError("");
        setSuccess("");

        if (!form.work_title.trim()) {
            setError("Please enter the work title.");
            return;
        }

        if (!form.description.trim()) {
            setError("Please describe the work you completed.");
            return;
        }

        const hours = Number(form.hours_worked);

        if (
            form.hours_worked !== "" &&
            (Number.isNaN(hours) || hours < 0 || hours > 24)
        ) {
            setError("Hours worked must be between 0 and 24.");
            return;
        }

        try {
            setSubmitting(true);

            const token = getToken();

            if (!token) {
                setError("Login session expired. Please login again.");
                return;
            }

            await axios.post(
                `${API_URL}/api/activity`,
                {
                    work_title: form.work_title.trim(),
                    description: form.description.trim(),
                    hours_worked: hours || 0,
                    status: form.status,
                    blockers: form.blockers.trim()
                },
                {
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                }
            );

            setSuccess("Daily activity submitted successfully.");

            setForm({
                work_title: "",
                description: "",
                hours_worked: "",
                status: "completed",
                blockers: ""
            });

            await loadActivities();
        } catch (err) {
            console.error("Submit activity error:", err);

            setError(
                err.response?.data?.message ||
                "Unable to submit daily activity."
            );
        } finally {
            setSubmitting(false);
        }
    };

    const user = getUser();

    return (
        <div className="daily-activity-page">

            <div className="daily-activity-header">
                <div>
                    <p className="page-label">STUDENT WORKSPACE</p>

                    <h1>Daily Activity</h1>

                    <p className="page-description">
                        Record the work you completed today and keep your
                        manager updated.
                    </p>
                </div>

                <div className="student-badge">
                    <div className="student-avatar">
                        {(user.name || "S").charAt(0).toUpperCase()}
                    </div>

                    <div>
                        <strong>{user.name || "Student"}</strong>
                        <span>{user.email || ""}</span>
                    </div>
                </div>
            </div>


            <div className="daily-activity-grid">

                <section className="activity-form-card">

                    <div className="card-header">
                        <div>
                            <h2>Submit Today's Work</h2>

                            <p>
                                Tell your manager what you worked on today.
                            </p>
                        </div>

                        <div className="today-badge">
                            {new Date().toLocaleDateString("en-IN", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric"
                            })}
                        </div>
                    </div>


                    <form onSubmit={handleSubmit}>

                        <div className="form-group">
                            <label htmlFor="work_title">
                                Work Title
                            </label>

                            <input
                                id="work_title"
                                name="work_title"
                                type="text"
                                placeholder="Example: Completed Java assignment"
                                value={form.work_title}
                                onChange={handleChange}
                            />
                        </div>


                        <div className="form-group">
                            <label htmlFor="description">
                                Description
                            </label>

                            <textarea
                                id="description"
                                name="description"
                                rows="5"
                                placeholder="Explain what you completed..."
                                value={form.description}
                                onChange={handleChange}
                            />
                        </div>


                        <div className="form-row">

                            <div className="form-group">
                                <label htmlFor="hours_worked">
                                    Hours Worked
                                </label>

                                <input
                                    id="hours_worked"
                                    name="hours_worked"
                                    type="number"
                                    min="0"
                                    max="24"
                                    step="0.5"
                                    placeholder="0"
                                    value={form.hours_worked}
                                    onChange={handleChange}
                                />
                            </div>


                            <div className="form-group">
                                <label htmlFor="status">
                                    Status
                                </label>

                                <select
                                    id="status"
                                    name="status"
                                    value={form.status}
                                    onChange={handleChange}
                                >
                                    <option value="completed">
                                        Completed
                                    </option>

                                    <option value="in_progress">
                                        In Progress
                                    </option>

                                    <option value="blocked">
                                        Blocked
                                    </option>
                                </select>
                            </div>

                        </div>


                        <div className="form-group">
                            <label htmlFor="blockers">
                                Blockers / Problems
                            </label>

                            <textarea
                                id="blockers"
                                name="blockers"
                                rows="3"
                                placeholder="Any problem preventing you from completing the work?"
                                value={form.blockers}
                                onChange={handleChange}
                            />
                        </div>


                        {error && (
                            <div className="activity-message error">
                                {error}
                            </div>
                        )}


                        {success && (
                            <div className="activity-message success">
                                {success}
                            </div>
                        )}


                        <button
                            type="submit"
                            className="submit-activity-btn"
                            disabled={submitting}
                        >
                            {submitting
                                ? "Submitting..."
                                : "Submit Daily Activity"}
                        </button>

                    </form>

                </section>


                <section className="activity-history-card">

                    <div className="card-header">
                        <div>
                            <h2>My Recent Activities</h2>

                            <p>
                                Your submitted work is visible here.
                            </p>
                        </div>

                        <span className="activity-count">
                            {activities.length}
                        </span>
                    </div>


                    {loading ? (

                        <div className="activity-empty">
                            <div className="loader"></div>
                            <p>Loading your activities...</p>
                        </div>

                    ) : activities.length === 0 ? (

                        <div className="activity-empty">
                            <div className="empty-icon">
                                📝
                            </div>

                            <h3>No activities yet</h3>

                            <p>
                                Submit your first daily activity using
                                the form.
                            </p>
                        </div>

                    ) : (

                        <div className="activity-list">

                            {activities.map((activity) => (

                                <article
                                    className="activity-item"
                                    key={activity.id}
                                >

                                    <div className="activity-item-top">

                                        <div>
                                            <h3>
                                                {activity.work_title}
                                            </h3>

                                            <span className="activity-date">
                                                {activity.date ||
                                                    activity.created_at ||
                                                    "Recent"}
                                            </span>
                                        </div>

                                        <span
                                            className={`status-badge ${
                                                activity.status ||
                                                "completed"
                                            }`}
                                        >
                                            {String(
                                                activity.status ||
                                                "completed"
                                            )
                                                .replace("_", " ")
                                                .toUpperCase()}
                                        </span>

                                    </div>


                                    <p className="activity-description">
                                        {activity.description}
                                    </p>


                                    <div className="activity-meta">

                                        <span>
                                            ⏱{" "}
                                            {activity.hours_worked || 0}
                                            {" "}hours
                                        </span>

                                        {activity.blockers && (
                                            <span>
                                                ⚠ Blocker reported
                                            </span>
                                        )}

                                    </div>

                                </article>

                            ))}

                        </div>

                    )}

                </section>

            </div>

        </div>
    );
}

export default DailyActivity;