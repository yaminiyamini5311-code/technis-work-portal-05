import { useEffect, useMemo, useState } from "react";
import axios from "axios";

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
                    `${API_URL}/api/activity/my`,
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
            return "📝";
        }

        if (type === "task") {
            return "✓";
        }

        if (type === "mission") {
            return "🎯";
        }

        return "📌";
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

                <div style={styles.summaryCard}>

                    <div
                        style={{
                            ...styles.summaryIcon,
                            background: "#eef2ff"
                        }}
                    >
                        📝
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


                <div style={styles.summaryCard}>

                    <div
                        style={{
                            ...styles.summaryIcon,
                            background: "#ecfdf5"
                        }}
                    >
                        ✓
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


                <div style={styles.summaryCard}>

                    <div
                        style={{
                            ...styles.summaryIcon,
                            background: "#fff7ed"
                        }}
                    >
                        🎯
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


                <div style={styles.summaryCard}>

                    <div
                        style={{
                            ...styles.summaryIcon,
                            background: "#f0fdf4"
                        }}
                    >
                        ⏱
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

            <div style={styles.mainCard}>

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
                            📂
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
                                                📅{" "}
                                                {formatDate(
                                                    item.date
                                                )}
                                            </span>

                                            {item.hours !==
                                                null && (
                                                <span>
                                                    ⏱{" "}
                                                    {
                                                        item.hours
                                                    }{" "}
                                                    hrs
                                                </span>
                                            )}

                                            {item.progress !==
                                                undefined && (
                                                <span>
                                                    📊{" "}
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
        background: "#f5f7fb",
        padding: "32px",
        fontFamily:
            "Inter, Arial, sans-serif",
        color: "#172033"
    },

    header: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: "28px",
        gap: "20px"
    },

    eyebrow: {
        color: "#4f46e5",
        fontSize: "12px",
        fontWeight: "800",
        letterSpacing: "1.5px",
        marginBottom: "8px"
    },

    title: {
        margin: 0,
        fontSize: "34px",
        fontWeight: "800"
    },

    subtitle: {
        margin:
            "8px 0 0",
        color: "#6b7280",
        fontSize: "15px"
    },

    refreshButton: {
        border: "none",
        background: "#172554",
        color: "#fff",
        padding: "11px 18px",
        borderRadius: "10px",
        cursor: "pointer",
        fontWeight: "700"
    },

    errorCard: {
        background: "#fff1f2",
        border:
            "1px solid #fecdd3",
        color: "#991b1b",
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
        background: "#991b1b",
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
        background: "#fff",
        borderRadius: "16px",
        padding: "20px",
        display: "flex",
        alignItems: "center",
        gap: "15px",
        boxShadow:
            "0 5px 20px rgba(15,23,42,0.06)"
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
        color: "#718096",
        fontSize: "13px"
    },

    summaryValue: {
        margin:
            "5px 0 0",
        fontSize: "25px"
    },

    mainCard: {
        background: "#fff",
        borderRadius: "18px",
        padding: "26px",
        boxShadow:
            "0 5px 20px rgba(15,23,42,0.06)"
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
        fontSize: "21px"
    },

    sectionSubtitle: {
        margin:
            "5px 0 0",
        color: "#7b8494",
        fontSize: "14px"
    },

    search: {
        width: "260px",
        padding: "11px 14px",
        border:
            "1px solid #dce1ea",
        borderRadius: "10px",
        outline: "none",
        fontSize: "14px"
    },

    tabs: {
        display: "flex",
        gap: "8px",
        marginBottom: "25px",
        borderBottom:
            "1px solid #edf0f4",
        paddingBottom: "14px"
    },

    tab: {
        border: "none",
        background: "#f8fafc",
        color: "#64748b",
        padding: "9px 16px",
        borderRadius: "9px",
        cursor: "pointer",
        fontWeight: "600"
    },

    activeTab: {
        background: "#172554",
        color: "#fff"
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
        background: "#eef2ff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "18px",
        zIndex: 2
    },

    timelineLine: {
        width: "1px",
        background: "#e2e8f0",
        minHeight: "100%"
    },

    historyCard: {
        border:
            "1px solid #e7ebf1",
        borderRadius: "14px",
        padding: "19px",
        background: "#fff"
    },

    historyTop: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: "15px"
    },

    typeLabel: {
        fontSize: "10px",
        color: "#6366f1",
        fontWeight: "800",
        letterSpacing: "1px",
        marginBottom: "5px"
    },

    historyTitle: {
        margin: 0,
        fontSize: "17px"
    },

    description: {
        color: "#64748b",
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
        background: "#dcfce7",
        color: "#166534"
    },

    progress: {
        background: "#dbeafe",
        color: "#1d4ed8"
    },

    pending: {
        background: "#fef3c7",
        color: "#92400e"
    },

    assigned: {
        background: "#f1f5f9",
        color: "#475569"
    },

    meta: {
        display: "flex",
        flexWrap: "wrap",
        gap: "18px",
        color: "#64748b",
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
        color: "#64748b"
    },

    progressTrack: {
        height: "7px",
        background: "#e5e7eb",
        borderRadius: "10px",
        overflow: "hidden"
    },

    progressFill: {
        height: "100%",
        background: "#4f46e5",
        borderRadius: "10px"
    },

    empty: {
        padding: "65px 20px",
        textAlign: "center",
        color: "#64748b"
    },

    emptyIcon: {
        fontSize: "45px",
        marginBottom: "10px"
    },

    loadingCard: {
        maxWidth: "600px",
        margin:
            "120px auto",
        background: "#fff",
        borderRadius: "18px",
        padding: "50px",
        textAlign: "center",
        boxShadow:
            "0 10px 40px rgba(15,23,42,0.08)"
    },

    loadingIcon: {
        fontSize: "35px",
        marginBottom: "10px"
    }
};

export default WorkHistory;