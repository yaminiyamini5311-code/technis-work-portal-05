/**
 * Production Diagnostic Script for Task Assignment Issues
 * 
 * Run this against your PRODUCTION database to identify why tasks aren't appearing for students.
 * 
 * Usage:
 *   MONGODB_URI="your-production-uri" node diagnose-production-task-issue.js
 */

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

async function main() {
  const MONGODB_URI = process.env.MONGODB_URI;
  
  if (!MONGODB_URI) {
    console.error('❌ ERROR: MONGODB_URI environment variable not set');
    console.error('Usage: MONGODB_URI="your-production-uri" node diagnose-production-task-issue.js');
    process.exit(1);
  }
  
  console.log('\n══════════════════════════════════════════════');
  console.log('  PRODUCTION TASK ASSIGNMENT DIAGNOSTICS');
  console.log('══════════════════════════════════════════════\n');
  
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db();
  
  try {
    // ─── CHECK 1: Collections exist ─────────────────────────────────
    console.log('✓ CHECK 1: Database collections');
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    
    const required = ['users', 'tasks', 'task_assignments'];
    for (const name of required) {
      if (collectionNames.includes(name)) {
        console.log(`  ✅ ${name} collection exists`);
      } else {
        console.log(`  ❌ ${name} collection MISSING`);
      }
    }
    
    // ─── CHECK 2: Indexes ───────────────────────────────────────────
    console.log('\n✓ CHECK 2: task_assignments indexes');
    if (collectionNames.includes('task_assignments')) {
      const indexes = await db.collection('task_assignments').indexes();
      const hasUniqueIndex = indexes.some(idx => 
        idx.name === 'task_student_unique' || 
        (idx.key.task_id && idx.key.student_id && idx.unique)
      );
      
      if (hasUniqueIndex) {
        console.log('  ✅ Unique index on (task_id, student_id) exists');
      } else {
        console.log('  ❌ Unique index on (task_id, student_id) MISSING');
        console.log('  FIX: Restart your server to trigger index creation');
      }
    }
    
    // ─── CHECK 3: Data counts ───────────────────────────────────────
    console.log('\n✓ CHECK 3: Data counts');
    const studentsCount = await db.collection('users').countDocuments({ role: 'student' });
    const tasksCount = await db.collection('tasks').countDocuments();
    const assignmentsCount = collectionNames.includes('task_assignments') 
      ? await db.collection('task_assignments').countDocuments()
      : 0;
    
    console.log(`  Students: ${studentsCount}`);
    console.log(`  Tasks: ${tasksCount}`);
    console.log(`  Task Assignments: ${assignmentsCount}`);
    
    if (tasksCount > 0 && assignmentsCount === 0) {
      console.log('  ⚠️  WARNING: Tasks exist but NO task_assignments!');
      console.log('  This means task assignments were never created.');
    }
    
    // ─── CHECK 4: Recent tasks ──────────────────────────────────────
    if (tasksCount > 0) {
      console.log('\n✓ CHECK 4: Recent tasks (last 5)');
      const recentTasks = await db.collection('tasks')
        .find({})
        .sort({ created_at: -1 })
        .limit(5)
        .toArray();
      
      for (const task of recentTasks) {
        console.log(`\n  Task: ${task.task_code} - ${task.title}`);
        console.log(`    ID: ${task._id}`);
        console.log(`    Target Type: ${task.target_type}`);
        console.log(`    Batch ID: ${task.batch_id || 'none'}`);
        console.log(`    Assigned To: ${task.assigned_to || 'none'}`);
        console.log(`    Created: ${task.created_at}`);
        
        // Check if task_assignment exists for this task
        if (collectionNames.includes('task_assignments')) {
          const assignmentCount = await db.collection('task_assignments')
            .countDocuments({ task_id: String(task._id) });
          
          if (assignmentCount > 0) {
            console.log(`    ✅ Has ${assignmentCount} task_assignment(s)`);
            
            // Show which students it's assigned to
            const assignments = await db.collection('task_assignments')
              .find({ task_id: String(task._id) })
              .limit(3)
              .toArray();
            
            for (const a of assignments) {
              const student = await db.collection('users').findOne(
                { _id: new ObjectId(a.student_id) },
                { projection: { name: 1, email: 1 } }
              );
              console.log(`      → ${student?.name || 'Unknown'} (${a.student_id})`);
            }
          } else {
            console.log(`    ❌ NO task_assignments found!`);
            console.log(`    PROBLEM: Task was created but assignments weren't`);
          }
        }
      }
    }
    
    // ─── CHECK 5: Sample student check ──────────────────────────────
    if (studentsCount > 0) {
      console.log('\n✓ CHECK 5: Sample student task visibility');
      const sampleStudent = await db.collection('users')
        .findOne({ role: 'student' });
      
      if (sampleStudent) {
        const studentId = String(sampleStudent._id);
        console.log(`\n  Student: ${sampleStudent.name} (${sampleStudent.email})`);
        console.log(`  ID: ${studentId}`);
        
        // Get assigned task IDs
        let assignedTaskIds = [];
        if (collectionNames.includes('task_assignments')) {
          const assignments = await db.collection('task_assignments')
            .find({ student_id: studentId }, { projection: { task_id: 1 } })
            .toArray();
          assignedTaskIds = assignments.map(a => a.task_id);
        }
        
        console.log(`  Task assignments: ${assignedTaskIds.length}`);
        
        // Fetch tasks (same query as GET /my endpoint)
        const tasks = await db.collection('tasks').find({
          $or: [
            { _id: { $in: assignedTaskIds.map(id => { try { return new ObjectId(id); } catch { return id; } }) } },
            { assigned_to: studentId }
          ]
        }).toArray();
        
        console.log(`  Visible tasks: ${tasks.length}`);
        
        if (tasks.length > 0) {
          console.log(`  ✅ Student can see ${tasks.length} task(s)`);
          tasks.slice(0, 3).forEach(t => {
            console.log(`    - ${t.task_code}: ${t.title}`);
          });
        } else {
          console.log(`  ❌ Student CANNOT see any tasks!`);
          
          // Additional debugging
          const legacyTasks = await db.collection('tasks')
            .find({ assigned_to: studentId })
            .toArray();
          console.log(`    Legacy assigned_to tasks: ${legacyTasks.length}`);
          
          if (assignedTaskIds.length > 0) {
            console.log(`    Task IDs from assignments: ${assignedTaskIds.join(', ')}`);
            // Check if these task IDs actually exist
            const existingTasks = await db.collection('tasks')
              .find({ _id: { $in: assignedTaskIds.map(id => { try { return new ObjectId(id); } catch { return id; } }) } })
              .toArray();
            console.log(`    Existing tasks matching IDs: ${existingTasks.length}`);
            
            if (existingTasks.length !== assignedTaskIds.length) {
              console.log(`    ⚠️  ORPHANED ASSIGNMENTS: task_assignments reference non-existent tasks`);
            }
          }
        }
      }
    }
    
    // ─── SUMMARY ────────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════');
    console.log('  SUMMARY');
    console.log('══════════════════════════════════════════════');
    
    if (tasksCount === 0) {
      console.log('\n✅ No tasks created yet - system ready');
    } else if (assignmentsCount === 0) {
      console.log('\n❌ CRITICAL ISSUE: Tasks exist but NO task_assignments');
      console.log('\nROOT CAUSE: Task assignments not being created during task creation');
      console.log('\nPOSSIBLE FIXES:');
      console.log('  1. Ensure createAssignmentsForStudents() is called in POST /api/tasks');
      console.log('  2. Check for errors in server logs during task creation');
      console.log('  3. Verify TaskAssignment model is imported correctly');
      console.log('  4. Run: node server/scripts/backfill-task-assignments.js');
    } else if (assignmentsCount < tasksCount) {
      console.log('\n⚠️  WARNING: Some tasks missing assignments');
      console.log(`\n  Tasks: ${tasksCount}`);
      console.log(`  Assignments: ${assignmentsCount}`);
      console.log(`  Gap: ${tasksCount - assignmentsCount} tasks without assignments`);
    } else {
      console.log('\n✅ Task assignment system appears healthy');
      console.log('\nIf students still can\'t see tasks:');
      console.log('  1. Check if student is logged in correctly (verify JWT token)');
      console.log('  2. Check student role (must be "student" or "member")');
      console.log('  3. Check registration_status (must be "approved")');
      console.log('  4. Check browser console for API errors');
      console.log('  5. Check server logs for authorization failures');
    }
    
    console.log('\n══════════════════════════════════════════════\n');
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
  } finally {
    await client.close();
  }
}

main().catch(console.error);
