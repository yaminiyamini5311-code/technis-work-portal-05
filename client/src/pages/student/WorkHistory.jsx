import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import TechinsIcon from "../../components/TechinsIcon";
import { useScrollReveal } from "../../components/useScrollReveal";
import "./WorkHistory.css";

const API_URL =
    import.meta.env.VITE_API_URL || "http://localhost:5000";

function WorkHistory() {
    const [activities, setActivities] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [missions, setMissions] = useState([]);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [activeTab, setActiveTab] = useState("all");
    const [search, setSearch] = useState("");

    // Scroll reveal effect
    useScrollReveal('.reveal-card', { stagger: 50 });

    const token = localStorage.getItem("token");

    const authConfig = {
        headers: {
            Authorization: `Bearer ${token}`
        }
    };

    useEffect(() => {
        loadHistory();
    }, []);

    const loadHistory = async () => {
        try {
            setLoading(true);
            setError("");

            if (!token) {
                setError("Your login session has expired. Please login again.");
                return;
            }

            const requests = [];

            /*
             * Daily activities
             */
            requests.push(
                axios.get(
                    `${API_URL}/api/activities/my`,
                    authConfig
                ).catch(() => ({ data: [] }))
            );

            /*
             * Student tasks
             */
            requests.push(
                axios.get(
                    `${API_URL}/api/tasks/my`,
                    authConfig
                ).catch(() => ({ data: [] }))
            );

            /*
             * Student missions
             */
            requests.push(
                axios.get(
                    `${API_URL}/api/missions/my`,
                    authConfig
                ).catch(() => ({ data: [] }))
            );

            const [
                activityResponse,
                taskResponse,
                missionResponse
            ] = await Promise.all(requests);

            const activityData =
                Array.isArray(activityResponse.data)
                    ? activityResponse.data
                    : activityResponse.data?.activities || [];

            const taskData =
                Array.isArray(taskResponse.data)
                    ? taskResponse.data
                    : taskResponse.data?.tasks || [];

            const missionData =
                Array.isArray(missionResponse.data)
                    ? missionResponse.data
                    : missionResponse.data?.missions || [];

            setActivities(activityData);
            setTasks(taskData);
            setMissions(missionData);

        } catch (err) {
            console.error(
                "Work history loading error:",
                err
            );

            setError(
                err.response?.data?.message ||
                "Unable to load your work history."
            );
        } finally {
            setLoading(false);
        }
    };

    const historyItems = useMemo(() => {

        const activityItems = activities.map(
            (activity) => ({
                id: `activity-${activity.id}`,
                type: "activity",
                title:
                    activity.work_title ||
                    "Daily Activity",
                description:
                    activity.description ||
                    "No description available.",
                status:
                    activity.status ||
                    "completed",
                date:
                    activity.date ||
                    activity.created_at ||
                    "",
                hours:
                    activity.hours_worked || 0
            })
        );

        const taskItems = tasks.map(
            (task) => ({
                id: `task-${task.id}`,
                type: "task",
                title:
                    task.title ||
                    "Task",
                description:
                    task.description ||
                    "No description available.",
                status:
                    task.status ||
                    "pending",
                date:
                    task.completed_at ||
                    task.due_date ||
                    task.created_at ||
                    "",
                hours: null
            })
        );

        const missionItems = missions.map(
            (mission) => ({
                id: `mission-${mission.id}`,
                type: "mission",
                title:
                    mission.title ||
                    "Mission",
                description:
                    mission.description ||
                    "No description available.",
                status:
                    mission.status ||
                    "assigned",
                date:
                    mission.completed_at ||
                    mission.due_date ||
                    mission.created_at ||
                    "",
                progress:
                    mission.progress || 0,
                hours: null
            })
        );

        return [
            ...activityItems,
            ...taskItems,
            ...missionItems
        ].sort((a, b) => {

            const dateA =
                new Date(a.date || 0).getTime();

            const dateB =
                new Date(b.date || 0).getTime();

            return dateB - dateA;
        });

    }, [activities, tasks, missions]);

    const filteredItems = historyItems.filter(
        (item) => {

            const matchesTab =
                activeTab === "all" ||
                item.type === activeTab;

            const searchText =
                search.trim().toLowerCase();

            const matchesSearch =
                !searchText ||
                item.title
                    .toLowerCase()
                    .includes(searchText) ||
                item.description
                    .toLowerCase()
                    .includes(searchText);

            return (
                matchesTab &&
                matchesSearch
            );
        }
    );

    const completedTasks =
        tasks.filter(
            (task) =>
                String(task.status).toLowerCase() ===
                "completed"
        ).length;

    const completedMissions =
        missions.filter(
            (mission) =>
                String(mission.status).toLowerCase() ===
                    "completed" ||
                Number(mission.progress || 0) >= 100
        ).length;

    const totalHours =
        activities.reduce(
            (total, activity) =>
                total +
                Number(activity.hours_worked || 0),
            0
        );

    const formatDate = (date) => {

        if (!date) {
            return "No date";
        }

        const parsedDate =
            new Date(date);

        if (
            Number.isNaN(
                parsedDate.getTime()
            )
        ) {
            return date;
        }

        return parsedDate.toLocaleDateString(
            "en-IN",
            {
                day: "2-digit",
                month: "short",
                year: "numeric"
            }
        );
    };

    const getStatusClass = (status) => {

        const value =
            String(status || "")
                .toLowerCase()
                .replaceAll(" ", "_");

        if (value === "completed") {
            return "completed";
        }

        if (
            value === "in_progress" ||
            value === "in-progress"
        ) {
            return "progress";
        }

        if (value === "pending") {
            return "pending";
        }

        return "assigned";
    };

    const getTypeIcon = (type) => {
        if (type === "activity") {
            return <TechinsIcon name="notepad" size={18} variant="light" />;
        }
        if (type === "task") {
            return <TechinsIcon name="clipboard" size={18} variant="light" />;
        }
        if (type === "mission") {
            return <TechinsIcon name="target" size={18} variant="light" />;
        }
        return <TechinsIcon name="folder" size={18} variant="light" />;
    };

    if (loading) {
        return (
            <div style={styles.page}>
                <div style={styles.loadingCard}>
                    <div style={styles.loadingIcon}>
                        ⟳
                    </div>

                    <h2>
                        Loading Work History
                    </h2>

                    <p>
                        Please wait while we load your activities,
                        tasks and missions.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div style={styles.page}>

            {/* HEADER */}

            <div style={styles.header}>

                <div>
                    <div style={styles.eyebrow}>
                        TECHINS WORK PORTAL
                    </div>

                    <h1 style={styles.title}>
                        Work History
                    </h1>

                    <p style={styles.subtitle}>
                        Track your completed activities,
                        tasks and missions in one place.
                    </p>
                </div>

                <button
                    onClick={loadHistory}
                    style={styles.refreshButton}
                >
                    ↻ Refresh
                </button>

            </div>


            {/* ERROR */}

            {error && (
                <div style={styles.errorCard}>

                    <div>
                        <strong>
                            Unable to load some data
                        </strong>

                        <p>
                            {error}
                        </p>
                    </div>

                    <button
                        onClick={loadHistory}
                        style={styles.retryButton}
                    >
                        Try Again
                    </button>

                </div>
            )}


            {/* SUMMARY */}

            <div style={styles.summaryGrid}>

                <div style={styles.summaryCard} className="reveal-card" data-space-depth>

                    <div
                        style={{
                            ...styles.summaryIcon,
                            background: "rgba(250,154,2,0.12)"
                        }}
                    >
                        <TechinsIcon name="notepad" size={21} variant="light" />
                    </div>

                    <div>
                        <p style={styles.summaryLabel}>
                            Activities
                        </p>

                        <h2 style={styles.summaryValue}>
                            {activities.length}
                        </h2>
                    </div>

                </div>


                <div style={styles.summaryCard} className="reveal-card" data-space-depth>

                    <div
                        style={{
                            ...styles.summaryIcon,
                            background: "rgba(250,154,2,0.12)"
                        }}
                    >
                        <TechinsIcon name="check" size={21} variant="light" />
                    </div>

                    <div>
                        <p style={styles.summaryLabel}>
                            Completed Tasks
                        </p>

                        <h2 style={styles.summaryValue}>
                            {completedTasks}
                        </h2>
                    </div>

                </div>


                <div style={styles.summaryCard} className="reveal-card" data-space-depth>

                    <div
                        style={{
                            ...styles.summaryIcon,
                            background: "rgba(250,154,2,0.12)"
                        }}
                    >
                        <TechinsIcon name="target" size={21} variant="light" />
                    </div>

                    <div>
                        <p style={styles.summaryLabel}>
                            Completed Missions
                        </p>

                        <h2 style={styles.summaryValue}>
                            {completedMissions}
                        </h2>
                    </div>

                </div>


                <div style={styles.summaryCard} className="reveal-card" data-space-depth>

                    <div
                        style={{
                            ...styles.summaryIcon,
                            background: "rgba(250,154,2,0.12)"
                        }}
                    >
                        <TechinsIcon name="stopwatch" size={21} variant="light" />
                    </div>

                    <div>
                        <p style={styles.summaryLabel}>
                            Hours Worked
                        </p>

                        <h2 style={styles.summaryValue}>
                            {totalHours.toFixed(1)}
                        </h2>
                    </div>

                </div>

            </div>


            {/* MAIN CARD */}

            <div style={styles.mainCard} className="reveal-card" data-space-depth>

                <div style={styles.toolbar}>

                    <div>
                        <h2 style={styles.sectionTitle}>
                            Activity Timeline
                        </h2>

                        <p style={styles.sectionSubtitle}>
                            Your complete work history.
                        </p>
                    </div>

                    <input
                        type="text"
                        placeholder="Search history..."
                        value={search}
                        onChange={(e) =>
                            setSearch(e.target.value)
                        }
                        style={styles.search}
                        className="work-history-search"
                    />

                </div>


                {/* FILTERS */}

                <div style={styles.tabs}>

                    <button
                        onClick={() =>
                            setActiveTab("all")
                        }
                        style={{
                            ...styles.tab,
                            ...(activeTab === "all"
                                ? styles.activeTab
                                : {})
                        }}
                    >
                        All
                    </button>

                    <button
                        onClick={() =>
                            setActiveTab("activity")
                        }
                        style={{
                            ...styles.tab,
                            ...(activeTab === "activity"
                                ? styles.activeTab
                                : {})
                        }}
                    >
                        Activities
                    </button>

                    <button
                        onClick={() =>
                            setActiveTab("task")
                        }
                        style={{
                            ...styles.tab,
                            ...(activeTab === "task"
                                ? styles.activeTab
                                : {})
                        }}
                    >
                        Tasks
                    </button>

                    <button
                        onClick={() =>
                            setActiveTab("mission")
                        }
                        style={{
                            ...styles.tab,
                            ...(activeTab === "mission"
                                ? styles.activeTab
                                : {})
                        }}
                    >
                        Missions
                    </button>

                </div>


                {/* EMPTY */}

                {filteredItems.length === 0 && (

                    <div style={styles.empty}>

                        <div style={styles.emptyIcon}>
                            <TechinsIcon name="folder" size={40} variant="light" />
                        </div>

                        <h3>
                            No work history found
                        </h3>

                        <p>
                            Your activities, tasks and missions
                            will appear here.
                        </p>

                    </div>

                )}


                {/* TIMELINE */}

                {filteredItems.length > 0 && (

                    <div style={styles.timeline}>

                        {filteredItems.map(
                            (item) => (

                                <div
                                    key={item.id}
                                    style={styles.timelineItem}
                                >

                                    <div
                                        style={
                                            styles.timelineIcon
                                        }
                                    >
                                        {getTypeIcon(
                                            item.type
                                        )}
                                    </div>

                                    <div
                                        style={
                                            styles.timelineLine
                                        }
                                    />

                                    <div
                                        style={
                                            styles.historyCard
                                        }
                                    >

                                        <div
                                            style={
                                                styles.historyTop
                                            }
                                        >

                                            <div>

                                                <div
                                                    style={
                                                        styles.typeLabel
                                                    }
                                                >
                                                    {item.type.toUpperCase()}
                                                </div>

                                                <h3
                                                    style={
                                                        styles.historyTitle
                                                    }
                                                >
                                                    {item.title}
                                                </h3>

                                            </div>

                                            <span
                                                style={{
                                                    ...styles.status,
                                                    ...styles[
                                                        getStatusClass(
                                                            item.status
                                                        )
                                                    ]
                                                }}
                                            >
                                                {String(
                                                    item.status ||
                                                    "assigned"
                                                ).replace(
                                                    /_/g,
                                                    " "
                                                )}
                                            </span>

                                        </div>


                                        <p
                                            style={
                                                styles.description
                                            }
                                        >
                                            {item.description}
                                        </p>


                                        <div
                                            style={
                                                styles.meta
                                            }
                                        >

                                            <span>
                                                <TechinsIcon name="clock" size={12} variant="light" />{" "}
                                                {formatDate(
                                                    item.date
                                                )}
                                            </span>

                                            {item.hours !==
                                                null && (
                                                <span>
                                                    <TechinsIcon name="stopwatch" size={12} variant="light" />{" "}
                                                    {
                                                        item.hours
                                                    }{" "}
                                                    hrs
                                                </span>
                                            )}

                                            {item.progress !==
                                                undefined && (
                                                <span>
                                                    <TechinsIcon name="progress" size={12} variant="light" />{" "}
                                                    {
                                                        item.progress
                                                    }%
                                                </span>
                                            )}

                                        </div>


                                        {item.progress !==
                                            undefined && (

                                            <div
                                                style={
                                                    styles.progressArea
                                                }
                                            >

                                                <div
                                                    style={
                                                        styles.progressHeader
                                                    }
                                                >
                                                    <span>
                                                        Progress
                                                    </span>

                                                    <strong>
                                                        {
                                                            item.progress
                                                        }%
                                                    </strong>
                                                </div>

                                                <div
                                                    style={
                                                        styles.progressTrack
                                                    }
                                                >

                                                    <div
                                                        style={{
                                                            ...styles.progressFill,
                                                            width: `${Math.min(
                                                                100,
                                                                Math.max(
                                                                    0,
                                                                    Number(
                                                                        item.progress
                                                                    )
                                                                )
                                                            )}%`
                                                        }}
                                                    />

                                                </div>

                                            </div>

                                        )}

                                    </div>

                                </div>

                            )
                        )}

                    </div>

                )}

            </div>

        </div>
    );
}


const styles = {

    page: {
        minHeight: "100vh",
        background: "transparent",
        padding: "32px",
        fontFamily:
            "Inter, Arial, sans-serif",
        color: "var(--text-primary-dark)"
    },

    header: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: "28px",
        gap: "20px"
    },

    eyebrow: {
        color: "var(--text-accent-on-dark)",
        fontSize: "12px",
        fontWeight: "800",
        letterSpacing: "1.5px",
        marginBottom: "8px"
    },

    title: {
        margin: 0,
        fontSize: "34px",
        fontWeight: "800",
        color: "var(--text-primary-dark)"
    },

    subtitle: {
        margin:
            "8px 0 0",
        color: "var(--text-muted-dark)",
        fontSize: "15px"
    },

    refreshButton: {
        background: "rgba(250, 154, 2, 0.2)",
        color: "#FA9A02",
        padding: "11px 18px",
        borderRadius: "10px",
        cursor: "pointer",
        fontWeight: "700",
        border: "1px solid rgba(250, 154, 2, 0.4)"
    },

    errorCard: {
        background: "rgba(239, 68, 68, 0.15)",
        border:
            "1px solid rgba(239, 68, 68, 0.4)",
        color: "#FCA5A5",
        borderRadius: "14px",
        padding: "16px 20px",
        marginBottom: "22px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "20px"
    },

    retryButton: {
        border: "none",
        background: "#EF4444",
        color: "#fff",
        padding: "9px 15px",
        borderRadius: "8px",
        cursor: "pointer"
    },

    summaryGrid: {
        display: "grid",
        gridTemplateColumns:
            "repeat(4, minmax(0, 1fr))",
        gap: "18px",
        marginBottom: "24px"
    },

    summaryCard: {
        background: "rgba(10, 18, 40, 0.72)",
        backdropFilter: "blur(8px)",
        borderRadius: "16px",
        padding: "20px",
        display: "flex",
        alignItems: "center",
        gap: "15px",
        border: "1px solid rgba(250, 154, 2, 0.25)",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)"
    },

    summaryIcon: {
        width: "48px",
        height: "48px",
        borderRadius: "13px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "21px"
    },

    summaryLabel: {
        margin: 0,
        color: "var(--text-muted-dark)",
        fontSize: "13px"
    },

    summaryValue: {
        margin:
            "5px 0 0",
        fontSize: "25px",
        color: "var(--text-primary-dark)"
    },

    mainCard: {
        background: "rgba(10, 18, 40, 0.72)",
        backdropFilter: "blur(8px)",
        borderRadius: "18px",
        padding: "26px",
        border: "1px solid rgba(250, 154, 2, 0.25)",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)"
    },

    toolbar: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "20px",
        marginBottom: "20px"
    },

    sectionTitle: {
        margin: 0,
        fontSize: "21px",
        color: "var(--text-primary-dark)"
    },

    sectionSubtitle: {
        margin:
            "5px 0 0",
        color: "var(--text-muted-dark)",
        fontSize: "14px"
    },

    search: {
        width: "260px",
        padding: "11px 14px",
        border:
            "1px solid rgba(255, 255, 255, 0.2)",
        borderRadius: "10px",
        outline: "none",
        fontSize: "14px",
        background: "rgba(10, 18, 40, 0.6)",
        color: "var(--text-primary-dark)",
        "::placeholder": {
            color: "var(--text-muted-dark)"
        }
    },

    tabs: {
        display: "flex",
        gap: "8px",
        marginBottom: "25px",
        borderBottom:
            "1px solid rgba(255, 255, 255, 0.1)",
        paddingBottom: "14px"
    },

    tab: {
        background: "rgba(255, 255, 255, 0.05)",
        color: "var(--text-primary-dark)",
        padding: "9px 16px",
        borderRadius: "9px",
        cursor: "pointer",
        fontWeight: "600",
        border: "1px solid rgba(255, 255, 255, 0.1)"
    },

    activeTab: {
        background: "var(--primary-color)",
        color: "#FFFFFF",
        borderColor: "var(--primary-color)"
    },

    timeline: {
        position: "relative"
    },

    timelineItem: {
        display: "grid",
        gridTemplateColumns:
            "48px 1px 1fr",
        gap: "16px",
        position: "relative",
        marginBottom: "20px"
    },

    timelineIcon: {
        width: "44px",
        height: "44px",
        borderRadius: "50%",
        background: "rgba(250, 154, 2, 0.15)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "18px",
        zIndex: 2,
        border: "1px solid rgba(250, 154, 2, 0.3)"
    },

    timelineLine: {
        width: "1px",
        background: "rgba(255, 255, 255, 0.1)",
        minHeight: "100%"
    },

    historyCard: {
        border:
            "1px solid rgba(255, 255, 255, 0.1)",
        borderRadius: "14px",
        padding: "19px",
        background: "rgba(255, 255, 255, 0.03)"
    },

    historyTop: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: "15px"
    },

    typeLabel: {
        fontSize: "10px",
        color: "#FA9A02",
        fontWeight: "800",
        letterSpacing: "1px",
        marginBottom: "5px"
    },

    historyTitle: {
        margin: 0,
        fontSize: "17px",
        color: "var(--text-primary-dark)"
    },

    description: {
        color: "var(--text-muted-dark)",
        fontSize: "14px",
        lineHeight: "1.6",
        margin:
            "10px 0 14px"
    },

    status: {
        padding: "6px 10px",
        borderRadius: "20px",
        fontSize: "11px",
        fontWeight: "700",
        textTransform: "capitalize",
        whiteSpace: "nowrap"
    },

    completed: {
        background: "rgba(16, 185, 129, 0.2)",
        color: "#34D399",
        border: "1px solid rgba(16, 185, 129, 0.3)"
    },

    progress: {
        background: "rgba(59, 130, 246, 0.2)",
        color: "#60A5FA",
        border: "1px solid rgba(59, 130, 246, 0.3)"
    },

    pending: {
        background: "rgba(245, 158, 11, 0.2)",
        color: "#FBBF24",
        border: "1px solid rgba(245, 158, 11, 0.3)"
    },

    assigned: {
        background: "rgba(255, 255, 255, 0.05)",
        color: "var(--text-muted-dark)",
        border: "1px solid rgba(255, 255, 255, 0.1)"
    },

    meta: {
        display: "flex",
        flexWrap: "wrap",
        gap: "18px",
        color: "var(--text-muted-dark)",
        fontSize: "12px"
    },

    progressArea: {
        marginTop: "16px"
    },

    progressHeader: {
        display: "flex",
        justifyContent: "space-between",
        marginBottom: "7px",
        fontSize: "12px",
        color: "var(--text-muted-dark)"
    },

    progressTrack: {
        height: "7px",
        background: "rgba(255, 255, 255, 0.1)",
        borderRadius: "10px",
        overflow: "hidden"
    },

    progressFill: {
        height: "100%",
        background: "linear-gradient(90deg, var(--primary-color), #FBBF24)",
        borderRadius: "10px"
    },

    empty: {
        padding: "65px 20px",
        textAlign: "center",
        color: "var(--text-muted-dark)",
        background: "rgba(10, 18, 40, 0.5)",
        borderRadius: "14px",
        border: "1px dashed rgba(255, 255, 255, 0.1)"
    },

    emptyIcon: {
        fontSize: "45px",
        marginBottom: "10px"
    },

    loadingCard: {
        maxWidth: "600px",
        margin:
            "120px auto",
        background: "rgba(10, 18, 40, 0.72)",
        backdropFilter: "blur(8px)",
        borderRadius: "18px",
        padding: "50px",
        textAlign: "center",
        border: "1px solid rgba(250, 154, 2, 0.25)",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)"
    },

    loadingIcon: {
        fontSize: "35px",
        marginBottom: "10px",
        color: "var(--text-primary-dark)"
    }
};

export default WorkHistory;