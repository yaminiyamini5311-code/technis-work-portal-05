require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;

async function find() {
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(MONGODB_DB_NAME);
    const tasks = await db.collection('tasks').find({ 
      workflow_status: { $in: ['Submitted', 'Resubmitted', 'Under Review'] }
    }).sort({ _id: -1 }).limit(3).toArray();
    
    console.log('Tasks with Submitted/Resubmitted status:\n');
    for (const t of tasks) {
      const assignCount = await db.collection('task_assignments').countDocuments({ task_id: String(t._id) });
      console.log(`  ${t.task_code} - "${t.title}"`);
      console.log(`    workflow_status: ${t.workflow_status}`);
      console.log(`    target_type: ${t.target_type}`);
      console.log(`    assignments: ${assignCount}`);
      console.log('');
    }
    
    if (tasks.length > 0) {
      const t = tasks[0];
      console.log(`\n=== Testing ${t.task_code} ===\n`);
      const assignments = await db.collection('task_assignments').find({
        task_id: String(t._id)
      }).limit(3).toArray();
      
      for (const a of assignments) {
        const student = await db.collection('users').findOne({ _id: new ObjectId(a.student_id) }, { projection: { name: 1 } });
        const submission = await db.collection('submissions').findOne({ task_id: a.task_id, student_id: a.student_id });
        
        // FIXED logic
        let studentWorkflowStatus = null;
        if (submission) {
          studentWorkflowStatus = submission.status;
        } else if (a) {
          const statusMap = {
            "assigned": "Assigned",
            "in_progress": "In Progress",
            "submitted": "Submitted",
            "revision_required": "Revision Required",
            "approved": "Approved"
          };
          studentWorkflowStatus = statusMap[a.status] || "Assigned";
        }
        
        const hasSubmission = !!submission;
        const workflow = studentWorkflowStatus || t.workflow_status || "Assigned";
        const showStart = (workflow === "Assigned");
        const canSubmit = ["In Progress", "Revision Required", "Acknowledged", "Assigned"].includes(workflow) && !hasSubmission;
        
        console.log(`${student?.name}:`);
        console.log(`  assignment.status: ${a.status}`);
        console.log(`  has_submission: ${hasSubmission}`);
        console.log(`  studentWorkflowStatus: ${studentWorkflowStatus}`);
        console.log(`  workflow: ${workflow}`);
        console.log(`  ✓ Start Task button: ${showStart}`);
        console.log(`  ✓ Submit Task button: ${canSubmit}`);
        console.log('');
      }
    }
    
  } finally {
    await client.close();
  }
}

find().catch(console.error);
