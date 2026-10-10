import { useEffect, useState } from "react";
import axios from "axios";
import TechinsIcon from "../../components/TechinsIcon";
import { useScrollReveal } from "../../components/useScrollReveal";
import "./Missions.css";

const API_URL =
    import.meta.env.VITE_API_URL || "http://localhost:5000";

function Missions() {
    const [missions, setMissions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [updatingId, setUpdatingId] = useState(null);

    // Scroll reveal effect for space theme - sophisticated animation
    useScrollReveal('.reveal-card', { 
        stagger: 110,
        initialScale: 0.85,
        initialOpacity: 0.1,
        initialTranslateY: 50,
        initialBlur: 5
    });

    const getToken = () => {
        return localStorage.getItem("token");
    };

    const loadMissions = async () => {
        try {
            setLoading(true);
            setError("");

            const token = getToken();

            if (!token) {
                setError("Your login session has expired. Please login again.");
                setLoading(false);
                return;
            }

            const response = await axios.get(
                `${API_URL}/api/missions`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            const data = response.data;

            if (Array.isArray(data)) {
                setMissions(data);
            } else if (Array.isArray(data.missions)) {
                setMissions(data.missions);
            } else {
                setMissions([]);
            }
        } catch (err) {
            console.error("LOAD MISSIONS ERROR:", err);

            if (err.response?.status === 401) {
                setError("Your login session is invalid. Please login again.");
            } else {
                setError(
                    err.response?.data?.message ||
                    "Unable to load missions."
                );
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadMissions();
    }, []);

    const updateMission = async (mission) => {
        try {
            const token = getToken();

            if (!token) {
                setError("Please login again.");
                return;
            }

            setUpdatingId(mission.id);

            const currentProgress = Number(mission.progress || 0);

            const newProgress = Math.min(
                100,
                currentProgress + 25
            );

            const newStatus =
                newProgress >= 100
                    ? "completed"
                    : "in_progress";

            await axios.put(
                `${API_URL}/api/missions/${mission.id}`,
                {
                    progress: newProgress,
                    status: newStatus,
                },
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            await loadMissions();
        } catch (err) {
            console.error("UPDATE MISSION ERROR:", err);

            alert(
                err.response?.data?.message ||
                "Unable to update mission."
            );
        } finally {
            setUpdatingId(null);
        }
    };

    const getStatusClass = (status) => {
        const value = String(status || "").toLowerCase();

        if (value === "completed") {
            return "mission-status completed";
        }

        if (value === "in_progress") {
            return "mission-status progress";
        }

        return "mission-status assigned";
    };

    if (loading) {
        return (
            <div className="page">
                <div className="page-header">
                    <h1>My Missions</h1>
                    <p>Loading your assigned missions...</p>
                </div>

                <div className="mission-loading">
                    <div className="loading-spinner"></div>
                    <p>Please wait...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="page">

            <div className="page-header">
                <div>
                    <h1>My Missions</h1>

                    <p>
                        View your assigned missions and track
                        your progress.
                    </p>
                </div>

                <button
                    className="refresh-btn"
                    onClick={loadMissions}
                >
                    ↻ Refresh
                </button>
            </div>

            {error && (
                <div className="mission-error">
                    <strong>Unable to load missions</strong>
                    <p>{error}</p>

                    <button onClick={loadMissions}>
                        Try Again
                    </button>
                </div>
            )}

            {!error && missions.length === 0 && (
                <div className="empty-missions">
                    <div className="empty-icon icon-sway">
                        <TechinsIcon name="target" size={48} variant="light" />
                    </div>

                    <h2>No Missions Assigned</h2>

                    <p>
                        Your manager or admin has not assigned
                        any missions to you yet.
                    </p>
                </div>
            )}

            {!error && missions.length > 0 && (
                <div className="missions-grid">

                    {missions.map((mission) => {

                        const progress = Math.min(
                            100,
                            Math.max(
                                0,
                                Number(mission.progress || 0)
                            )
                        );

                        const completed =
                            progress >= 100 ||
                            mission.status === "completed";

                        return (
                            <div
                                className="mission-card reveal-card"
                                key={mission.id}
                            >

                                <div className="mission-card-top">

                                    <div>
                                        <span className="mission-label">
                                            MISSION
                                        </span>

                                        <h2>
                                            {mission.title ||
                                                "Untitled Mission"}
                                        </h2>
                                    </div>

                                    <span
                                        className={getStatusClass(
                                            mission.status
                                        )}
                                    >
                                        {completed
                                            ? "Completed"
                                            : mission.status ===
                                              "in_progress"
                                            ? "In Progress"
                                            : "Assigned"}
                                    </span>

                                </div>

                                <p className="mission-description">
                                    {mission.description ||
                                        "No description available."}
                                </p>

                                <div className="mission-info">

                                    <div>
                                        <span>Progress</span>

                                        <strong>
                                            {progress}%
                                        </strong>
                                    </div>

                                    {mission.due_date && (
                                        <div>
                                            <span>Due Date</span>

                                            <strong>
                                                {
                                                    mission.due_date
                                                }
                                            </strong>
                                        </div>
                                    )}

                                </div>

                                <div className="progress-container">

                                    <div className="progress-background">

                                        <div
                                            className="progress-fill"
                                            style={{
                                                width: `${progress}%`,
                                            }}
                                        />

                                    </div>

                                    <span>
                                        {progress}% complete
                                    </span>

                                </div>

                                <div className="mission-actions">

                                    {completed ? (
                                        <div className="completed-message">
                                            <TechinsIcon name="check" size={18} variant="light" /> Mission Completed
                                        </div>
                                    ) : (
                                        <button
                                            className="update-btn"
                                            disabled={
                                                updatingId ===
                                                mission.id
                                            }
                                            onClick={() =>
                                                updateMission(
                                                    mission
                                                )
                                            }
                                        >
                                            {updatingId ===
                                            mission.id
                                                ? "Updating..."
                                                : "Update Progress +25%"}
                                        </button>
                                    )}

                                </div>

                            </div>
                        );
                    })}

                </div>
            )}

        </div>
    );
}

export default Missions;