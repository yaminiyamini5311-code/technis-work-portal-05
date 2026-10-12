/**
 * Test script to verify CEO task assignment → Student task retrieval flow
 * 
 * This script:
 * 1. Creates a test student if none exists
 * 2. Creates a test task assigned to that student
 * 3. Verifies the task_assignment is created
 * 4. Simulates the student's GET /my endpoint
 * 5. Confirms the student can see their task
 */

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;

async function main() {
  console.log('\n═══ Task Assignment Flow Test ═══\n');
  
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db();
  
  try {
    // ─── STEP 1: Create test student ─────────────────────────────────
    console.log('STEP 1: Creating test student...');
    const testStudent = {
      name: 'Test Student',
      email: 'test.student@techins.test',
      password: '$2b$12$test', // dummy hash
      role: 'student',
      active: 1,
      registration_status: 'approved',
      program: 'Test Program',
      created_at: new Date().toISOString()
    };
    
    let student = await db.collection('users').findOne({ email: testStudent.email });
    if (!student) {
      const result = await db.collection('users').insertOne(testStudent);
      student = { ...testStudent, _id: result.insertedId };
      console.log('✅ Test student created:', String(student._id));
    } else {
      console.log('✅ Test student already exists:', String(student._id));
    }
    const studentId = String(student._id);
    
    // ─── STEP 2: Create test task ───────────────────────────────────
    console.log('\nSTEP 2: Creating test task...');
    const testTask = {
      task_code: 'TEST-' + Date.now(),
      title: 'Test Task for Assignment Flow',
      description: 'This is a test task to verify assignment flow',
      expected_output: 'Test expected output',
      how_to_do: 'Test how to do instructions',
      submission_requirements: 'Test submission requirements',
      domain: 'edutins',
      target_type: 'student',
      batch_id: null,
      assigned_to: studentId,
      assigned_by: 'test-ceo-id',
      status: 'pending',
      workflow_status: 'Assigned',
      priority: 'medium',
      start_date: null,
      due_date: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const taskResult = await db.collection('tasks').insertOne(testTask);
    const taskId = String(taskResult.insertedId);
    console.log('✅ Test task created:', taskId, `(${testTask.task_code})`);
    
    // ─── STEP 3: Create task assignment ─────────────────────────────
    console.log('\nSTEP 3: Creating task assignment...');
    const assignment = {
      task_id: taskId,
      student_id: studentId,
      status: 'assigned',
      progress: 0,
      submission_version: null,
      submission_comment: null,
      submitted_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const assignmentResult = await db.collection('task_assignments').updateOne(
      { task_id: taskId, student_id: studentId },
      {
        $setOnInsert: assignment
      },
      { upsert: true }
    );
    
    if (assignmentResult.upsertedCount > 0) {
      console.log('✅ Task assignment created');
    } else {
      console.log('✅ Task assignment already exists');
    }
    
    // ─── STEP 4: Simulate student fetching tasks ────────────────────
    console.log('\nSTEP 4: Simulating student GET /my endpoint...');
    
    // Get student's task IDs from task_assignments
    const assignmentRows = await db.collection('task_assignments')
      .find({ student_id: studentId }, { projection: { task_id: 1 } })
      .toArray();
    const assignedTaskIds = assignmentRows.map(r => r.task_id);
    console.log('  Student assigned task IDs:', assignedTaskIds);
    
    // Fetch tasks
    const tasks = await db.collection('tasks').find({
      $or: [
        { _id: { $in: assignedTaskIds.map(id => { try { return new ObjectId(id); } catch { return id; } }) } },
        { assigned_to: studentId }
      ]
    }).sort({ created_at: -1 }).toArray();
    
    console.log(`✅ Student can see ${tasks.length} task(s)`);
    
    // ─── STEP 5: Verify task details ────────────────────────────────
    console.log('\nSTEP 5: Verifying task details...');
    if (tasks.length > 0) {
      const task = tasks[0];
      console.log('✅ Task retrieved successfully:');
      console.log('  ID:', String(task._id));
      console.log('  Code:', task.task_code);
      console.log('  Title:', task.title);
      console.log('  Description:', task.description);
      console.log('  Expected Output:', task.expected_output);
      console.log('  How to Do:', task.how_to_do);
      console.log('  Submission Requirements:', task.submission_requirements);
      console.log('  Assigned To:', task.assigned_to);
      
      // Verify all detail fields are present
      const hasAllFields = task.description && task.expected_output && task.how_to_do && task.submission_requirements;
      if (hasAllFields) {
        console.log('\n✅ ALL DETAIL FIELDS PRESENT');
      } else {
        console.log('\n❌ MISSING DETAIL FIELDS:');
        if (!task.description) console.log('  - description');
        if (!task.expected_output) console.log('  - expected_output');
        if (!task.how_to_do) console.log('  - how_to_do');
        if (!task.submission_requirements) console.log('  - submission_requirements');
      }
    } else {
      console.log('❌ ERROR: Student cannot see the assigned task!');
      console.log('\nDEBUG INFO:');
      console.log('  Student ID:', studentId);
      console.log('  Task ID:', taskId);
      console.log('  Assignment exists:', assignmentRows.length > 0);
    }
    
    // ─── CLEANUP ─────────────────────────────────────────────────────
    console.log('\n STEP 6: Cleaning up test data...');
    await db.collection('task_assignments').deleteOne({ task_id: taskId, student_id: studentId });
    await db.collection('tasks').deleteOne({ _id: new ObjectId(taskId) });
    await db.collection('users').deleteOne({ _id: new ObjectId(studentId) });
    console.log('✅ Test data cleaned up');
    
    console.log('\n═══ Test Complete ═══\n');
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
  } finally {
    await client.close();
  }
}

main().catch(console.error);
