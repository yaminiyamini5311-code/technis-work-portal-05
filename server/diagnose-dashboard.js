/**
 * Dashboard Metrics Diagnostic Tool
 * Traces each metric to actual database state
 */

const { MongoClient } = require("mongodb");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "techins";

async function diagnose() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log("✓ Connected to MongoDB");
    
    const db = client.db(MONGODB_DB_NAME);
    const today = new Date().toISOString().slice(0, 10);
    
    console.log("\n" + "=".repeat(60));
    console.log("DASHBOARD METRICS DIAGNOSIS");
    console.log("=".repeat(60));
    console.log(`Database: ${MONGODB_DB_NAME}`);
    console.log(`Today's date (UTC): ${today}`);
    console.log("=".repeat(60));
    
    // 1. STUDENTS
    console.log("\n[1] STUDENTS METRIC");
    const students = await db.collection("users").countDocuments({ role: "student", active: 1 });
    const totalUsers = await db.collection("users").countDocuments();
    const studentsByStatus = await db.collection("users").aggregate([
      { $match: { role: "student" } },
      { $group: { _id: { active: "$active", reg_status: "$registration_status" }, count: { $sum: 1 } } }
    ]).toArray();
    console.log(`  Active students (role='student', active=1): ${students}`);
    console.log(`  Total users in database: ${totalUsers}`);
    console.log(`  Students by status:`);
    studentsByStatus.forEach(s => {
      console.log(`    active=${s._id.active}, reg_status=${s._id.reg_status}: ${s.count}`);
    });
    
    // 2. TASKS
    console.log("\n[2] TASKS METRIC");
    const tasks = await db.collection("tasks").countDocuments();
    const tasksByStatus = await db.collection("tasks").aggregate([
      { $group: { _id: "$workflow_status", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();
    console.log(`  Total tasks: ${tasks}`);
    console.log(`  Tasks by workflow_status:`);
    if (tasksByStatus.length === 0) {
      console.log(`    (none)`);
    } else {
      tasksByStatus.forEach(t => {
        console.log(`    "${t._id}": ${t.count}`);
      });
    }
    
    // 3. COMPLETED TASKS
    console.log("\n[3] COMPLETED TASKS METRIC");
    const completedTasks = await db.collection("tasks").countDocuments({ workflow_status: "Approved" });
    const completedTasksCaseInsensitive = await db.collection("tasks").countDocuments({ 
      workflow_status: { $regex: /^approved$/i } 
    });
    console.log(`  Tasks with workflow_status="Approved" (exact case): ${completedTasks}`);
    console.log(`  Tasks with workflow_status="approved" (case-insensitive): ${completedTasksCaseInsensitive}`);
    
    // Sample some task statuses
    const sampleTasks = await db.collection("tasks").find({}, { 
      projection: { title: 1, workflow_status: 1, status: 1, updated_at: 1 }, 
      limit: 5 
    }).toArray();
    if (sampleTasks.length > 0) {
      console.log(`  Sample tasks (first 5):`);
      sampleTasks.forEach((t, i) => {
        console.log(`    ${i+1}. "${t.title}" - workflow_status="${t.workflow_status}", status="${t.status}", updated_at="${t.updated_at}"`);
      });
    }
    
    // 4. PENDING TASKS
    console.log("\n[4] PENDING TASKS METRIC");
    const pendingTasks = await db.collection("tasks").countDocuments({ 
      workflow_status: { $in: ["Assigned", "Acknowledged"] } 
    });
    const assignedCount = await db.collection("tasks").countDocuments({ workflow_status: "Assigned" });
    const acknowledgedCount = await db.collection("tasks").countDocuments({ workflow_status: "Acknowledged" });
    console.log(`  Tasks with workflow_status in ["Assigned", "Acknowledged"]: ${pendingTasks}`);
    console.log(`    - "Assigned": ${assignedCount}`);
    console.log(`    - "Acknowledged": ${acknowledgedCount}`);
    
    // 5. MISSIONS
    console.log("\n[5] MISSIONS METRIC");
    const missions = await db.collection("missions").countDocuments();
    const missionsByStatus = await db.collection("missions").aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]).toArray();
    console.log(`  Total missions: ${missions}`);
    if (missions > 0) {
      console.log(`  Missions by status:`);
      missionsByStatus.forEach(m => {
        console.log(`    "${m._id}": ${m.count}`);
      });
    }
    
    // 6. TODAY'S ACTIVITY
    console.log("\n[6] TODAY'S ACTIVITY METRIC");
    const activitiesToday = await db.collection("daily_activities").countDocuments({ date: today });
    const totalActivities = await db.collection("daily_activities").countDocuments();
    const activityDates = await db.collection("daily_activities").aggregate([
      { $group: { _id: "$date", count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
      { $limit: 10 }
    ]).toArray();
    console.log(`  Activities with date="${today}": ${activitiesToday}`);
    console.log(`  Total daily_activities: ${totalActivities}`);
    if (activityDates.length > 0) {
      console.log(`  Recent activity dates (last 10):`);
      activityDates.forEach(a => {
        console.log(`    ${a._id}: ${a.count} activities`);
      });
    }
    
    // 7. CHART DATA
    console.log("\n[7] CHART DATA (Approved tasks with recent updated_at)");
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
    const startDateStr = startDate.toISOString().slice(0, 10);
    
    const recentApprovedTasks = await db.collection("tasks").find(
      { workflow_status: "Approved", updated_at: { $gte: startDateStr } },
      { projection: { updated_at: 1, title: 1 } }
    ).toArray();
    
    console.log(`  Approved tasks with updated_at >= ${startDateStr}: ${recentApprovedTasks.length}`);
    if (recentApprovedTasks.length > 0) {
      console.log(`  Sample (first 5):`);
      recentApprovedTasks.slice(0, 5).forEach((t, i) => {
        console.log(`    ${i+1}. "${t.title}" - updated_at="${t.updated_at}"`);
      });
    }
    
    // Check if tasks have updated_at field at all
    const tasksWithUpdatedAt = await db.collection("tasks").countDocuments({ updated_at: { $exists: true, $ne: null } });
    console.log(`  Tasks with updated_at field: ${tasksWithUpdatedAt} / ${tasks}`);
    
    console.log("\n" + "=".repeat(60));
    console.log("DIAGNOSIS COMPLETE");
    console.log("=".repeat(60));
    
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await client.close();
  }
}

diagnose().catch(console.error);
