import { useEffect, useState } from "react";
import axios from "axios";

import Navbar from "../components/Navbar";
import Sidebar from "../components/Sidebar";
import ActivityCard from "../components/ActivityCard";

function WorkHistory() {
  const [activities, setActivities] = useState([]);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const token = localStorage.getItem("token");

        const response = await axios.get(
          "http://localhost:5000/api/activities",
          {
            headers: {
              Authorization: `Bearer ${token}`
            }
          }
        );

        setActivities(response.data);
      } catch (error) {
        console.log(error);
      }
    };

    fetchHistory();
  }, []);

  return (
    <div>
      <Navbar />

      <div className="layout">
        <Sidebar />

        <main className="main-content">
          <div className="page-heading">
            <div>
              <h1>Work History</h1>
              <p>
                Review your previously submitted work.
              </p>
            </div>
          </div>

          <div className="history-list">
            {activities.length === 0 ? (
              <div className="empty-state">
                No work history available.
              </div>
            ) : (
              activities.map((activity) => (
                <ActivityCard
                  key={activity._id}
                  activity={activity}
                />
              ))
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default WorkHistory;