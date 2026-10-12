/**
 * Backfill script: Create missing task_assignments for existing tasks
 * 
 * This script repairs the database if tasks were created but task_assignments weren't.
 * It's idempotent - safe to run multiple times.
 * 
 * Usage:
 *   node server/scripts/backfill-task-assignments.js
 *   
 * For production:
 *   MONGODB_URI="your-production-uri" node server/scripts/backfill-task-assignments.js
 */

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

async function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  BACKFILL TASK ASSIGNMENTS');
  console.log('══════════════════════════════════════════════\n');
  
  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) {
    console.error('❌ ERROR: MONGODB_URI not set');
    process.exit(1);
  }
  
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db();
  
  try {
    const tasks = await db.collection('tasks').find({}).toArray();
    console.log(`Found ${tasks.length} tasks\n`);
    
    let created = 0;
    let existing = 0;
    let errors = 0;
    
    for (const task of tasks) {
      const taskId = String(task._id);
      console.log(`Processing: ${task.task_code} - ${task.title}`);
      console.log(`  Target Type: ${task.target_type}`);
      
      let studentIds = [];
      
      // ─── BATCH TASKS ──────────────────────────────────────────
      if (task.target_type === 'batch' && task.batch_id) {
        const students = await db.collection('users').find({
          batch_id: task.batch_id,
          role: 'student',
          active: 1
        }).toArray();
        
        studentIds = students.map(s => String(s._id));
        console.log(`  Batch task → ${studentIds.length} students in batch ${task.batch_id}`);
      }
      // ─── INDIVIDUAL TASKS ─────────────────────────────────────
      else if (task.assigned_to) {
        studentIds = [task.assigned_to];
        console.log(`  Individual task → student ${task.assigned_to}`);
      }
      // ─── PROGRAM/GROUP TASKS ──────────────────────────────────
      else if (task.program) {
        const students = await db.collection('users').find({
          program: task.program,
          role: 'student',
          active: 1
        }).toArray();
        studentIds = students.map(s => String(s._id));
        console.log(`  Program task → ${studentIds.length} students in program ${task.program}`);
      } else if (task.group) {
        const students = await db.collection('users').find({
          program: task.group,
          role: 'student',
          active: 1
        }).toArray();
        studentIds = students.map(s => String(s._id));
        console.log(`  Group task → ${studentIds.length} students in group ${task.group}`);
      }
      
      if (studentIds.length === 0) {
        console.log(`  ⚠️  No students to assign\n`);
        continue;
      }
      
      // Create assignments
      for (const studentId of studentIds) {
        try {
          const result = await db.collection('task_assignments').updateOne(
            { task_id: taskId, student_id: studentId },
            {
              $setOnInsert: {
                task_id: taskId,
                student_id: studentId,
                status: 'assigned',
                progress: 0,
                submission_version: null,
                submission_comment: null,
                submitted_at: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              }
            },
            { upsert: true }
          );
          
          if (result.upsertedCount > 0) {
            created++;
          } else {
            existing++;
          }
        } catch (error) {
          console.error(`  ❌ Error creating assignment for student ${studentId}:`, error.message);
          errors++;
        }
      }
      
      console.log(`  ✅ Processed ${studentIds.length} assignments\n`);
    }
    
    console.log('══════════════════════════════════════════════');
    console.log('  SUMMARY');
    console.log('══════════════════════════════════════════════');
    console.log(`  Tasks processed: ${tasks.length}`);
    console.log(`  Assignments created: ${created}`);
    console.log(`  Assignments already existed: ${existing}`);
    console.log(`  Errors: ${errors}`);
    console.log('══════════════════════════════════════════════\n');
    
    if (created > 0) {
      console.log('✅ SUCCESS: Created', created, 'new task assignments');
      console.log('Students should now be able to see their assigned tasks\n');
    } else if (existing > 0 && created === 0) {
      console.log('✅ All task assignments already exist - no action needed\n');
    } else {
      console.log('ℹ️  No tasks found or no students to assign\n');
    }
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
  } finally {
    await client.close();
  }
}

main().catch(console.error);
