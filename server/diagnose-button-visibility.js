/**
 * Diagnosis script: Compare working vs broken students for task button visibility
 * 
 * This script compares:
 * 1. TaskAssignment records for working vs broken students
 * 2. Submission records
 * 3. User/Student records
 * 4. Task document structure
 * 
 * Goal: Find the root cause of missing Start/Submit buttons
 */

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'techins';

async function diagnose() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('✓ Connected to MongoDB');
    const db = client.db(MONGODB_DB_NAME);
    
    // Step 1: Find a task with multiple students assigned
    console.log('\n=== STEP 1: Finding tasks with multiple assignments ===');
    const tasks = await db.collection('tasks').find({
      target_type: { $in: ['batch', 'student'] }
    }).sort({ created_at: -1 }).limit(10).toArray();
    
    console.log(`Found ${tasks.length} recent tasks`);
    
    for (const task of tasks) {
      const taskId = String(task._id);
      const assignments = await db.collection('task_assignments').find({
        task_id: taskId
      }).toArray();
      
      if (assignments.length > 1) {
        console.log(`\nTask: ${task.task_code} - "${task.title}"`);
        console.log(`  Target Type: ${task.target_type}`);
        console.log(`  Batch ID: ${task.batch_id || 'N/A'}`);
        console.log(`  Legacy assigned_to: ${task.assigned_to || 'N/A'}`);
        console.log(`  Workflow Status: ${task.workflow_status || task.status}`);
        console.log(`  Assignments: ${assignments.length}`);
        
        // Get submission counts per student
        for (const assignment of assignments) {
          const student = await db.collection('users').findOne({ 
            _id: toId(assignment.student_id) 
          }, { projection: { name: 1, email: 1, _id: 1 } });
          
          const submissions = await db.collection('submissions').find({
            task_id: taskId,
            student_id: assignment.student_id
          }).toArray();
          
          console.log(`    → Student: ${student?.name || 'Unknown'} (${assignment.student_id})`);
          console.log(`       Assignment status: ${assignment.status}`);
          console.log(`       Submissions: ${submissions.length}`);
          console.log(`       Assignment record:`, JSON.stringify({
            task_id: assignment.task_id,
            student_id: assignment.student_id,
            status: assignment.status,
            progress: assignment.progress,
            created_at: assignment.created_at
          }, null, 2));
        }
        
        // This is a good candidate for detailed comparison
        if (assignments.length >= 2) {
          console.log('\n=== DETAILED COMPARISON FOR THIS TASK ===');
          await compareStudents(db, taskId, assignments);
          break; // Only examine one task in detail
        }
      }
    }
    
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.close();
  }
}

async function compareStudents(db, taskId, assignments) {
  console.log(`\nComparing ${assignments.length} students for task ${taskId}`);
  
  // Get the task document
  const task = await db.collection('tasks').findOne({ _id: toId(taskId) });
  console.log('\n--- TASK DOCUMENT ---');
  console.log(JSON.stringify({
    _id: String(task._id),
    task_code: task.task_code,
    title: task.title,
    target_type: task.target_type,
    batch_id: task.batch_id,
    assigned_to: task.assigned_to,
    assigned_by: task.assigned_by,
    workflow_status: task.workflow_status,
    status: task.status,
    start_date: task.start_date,
    due_date: task.due_date
  }, null, 2));
  
  // Compare each student
  for (let i = 0; i < assignments.length; i++) {
    const assignment = assignments[i];
    console.log(`\n--- STUDENT ${i + 1} ---`);
    
    // Get student user record
    const student = await db.collection('users').findOne({ 
      _id: toId(assignment.student_id) 
    }, { projection: { name: 1, email: 1, role: 1, batch_id: 1, active: 1, registration_status: 1 } });
    
    console.log('User Record:', JSON.stringify(student, null, 2));
    console.log('User _id type:', typeof student?._id, student?._id?.constructor?.name);
    console.log('User _id string:', String(student?._id));
    
    // Get assignment record
    console.log('\nAssignment Record:', JSON.stringify({
      _id: String(assignment._id),
      task_id: assignment.task_id,
      student_id: assignment.student_id,
      status: assignment.status,
      progress: assignment.progress,
      submission_version: assignment.submission_version,
      submitted_at: assignment.submitted_at,
      created_at: assignment.created_at,
      updated_at: assignment.updated_at
    }, null, 2));
    console.log('Assignment task_id type:', typeof assignment.task_id);
    console.log('Assignment student_id type:', typeof assignment.student_id);
    
    // Check ID matching
    console.log('\nID MATCHING:');
    console.log(`  task._id: ${String(task._id)} (${typeof task._id})`);
    console.log(`  assignment.task_id: ${assignment.task_id} (${typeof assignment.task_id})`);
    console.log(`  Match: ${String(task._id) === assignment.task_id}`);
    
    console.log(`  student._id: ${String(student._id)} (${typeof student._id})`);
    console.log(`  assignment.student_id: ${assignment.student_id} (${typeof assignment.student_id})`);
    console.log(`  Match: ${String(student._id) === assignment.student_id}`);
    
    // Get submissions
    const submissions = await db.collection('submissions').find({
      task_id: assignment.task_id,
      student_id: assignment.student_id
    }).sort({ version: -1 }).toArray();
    
    console.log(`\nSubmissions: ${submissions.length}`);
    if (submissions.length > 0) {
      console.log('Latest submission:', JSON.stringify({
        _id: String(submissions[0]._id),
        submission_code: submissions[0].submission_code,
        version: submissions[0].version,
        status: submissions[0].status,
        submitted_at: submissions[0].submitted_at,
        task_id: submissions[0].task_id,
        student_id: submissions[0].student_id
      }, null, 2));
      console.log('Submission task_id type:', typeof submissions[0].task_id);
      console.log('Submission student_id type:', typeof submissions[0].student_id);
    }
    
    // Simulate the frontend logic
    console.log('\n--- FRONTEND LOGIC SIMULATION ---');
    const workflow = task.workflow_status || (task.status === "completed" ? "Approved" : task.status === "in_progress" ? "In Progress" : "Assigned");
    const hasStudentSubmission = submissions.length > 0;
    const studentStatus = submissions.length > 0 ? submissions[0].status : workflow;
    const needsRevision = workflow === "Revision Required" || (submissions.length > 0 && submissions[0].status === "Revision Required");
    const canSubmit = ["In Progress", "Revision Required", "Acknowledged", "Assigned"].includes(workflow) && (!hasStudentSubmission || needsRevision);
    
    console.log(`  workflow: ${workflow}`);
    console.log(`  hasStudentSubmission: ${hasStudentSubmission}`);
    console.log(`  studentStatus: ${studentStatus}`);
    console.log(`  needsRevision: ${needsRevision}`);
    console.log(`  canSubmit: ${canSubmit}`);
    console.log(`  Should show "Start Task": ${(workflow === "Assigned" || task.status === "pending")}`);
    console.log(`  Should show "Submit Task": ${canSubmit}`);
  }
}

function toId(id) {
  try {
    return new ObjectId(id);
  } catch {
    return id;
  }
}

diagnose().catch(console.error);
