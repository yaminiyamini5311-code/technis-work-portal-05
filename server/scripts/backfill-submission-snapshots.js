/**
 * Backfill script: Add task snapshot fields to existing submissions
 * 
 * This script is IDEMPOTENT - safe to run multiple times.
 * It only updates submissions that are missing snapshot fields.
 * 
 * Usage: node server/scripts/backfill-submission-snapshots.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/techins';

function toId(id) {
  try {
    return new ObjectId(id);
  } catch {
    return id;
  }
}

async function backfillSubmissionSnapshots() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('✓ Connected to MongoDB');
    
    const db = client.db();
    const submissions = db.collection('submissions');
    const tasks = db.collection('tasks');
    
    // Find submissions missing snapshot fields (task_title is the key indicator)
    const missingSnapshots = await submissions.find({
      task_title: { $exists: false }
    }).toArray();
    
    console.log(`Found ${missingSnapshots.length} submissions missing snapshot data`);
    
    if (missingSnapshots.length === 0) {
      console.log('✓ All submissions already have snapshot data. Nothing to do.');
      return;
    }
    
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    
    for (const submission of missingSnapshots) {
      try {
        // Fetch the task for this submission
        const task = await tasks.findOne({ _id: toId(submission.task_id) });
        
        const snapshot = {};
        
        if (task) {
          // Task still exists: capture current values
          snapshot.task_code = task.task_code || null;
          snapshot.task_title = task.title || null;
          snapshot.task_description = task.description || null;
          snapshot.task_expected_output = task.expected_output || null;
          snapshot.task_how_to_do = task.how_to_do || null;
          snapshot.task_instructions = task.instructions || null;
          snapshot.task_domain = task.domain || null;
          snapshot.task_program = task.program || null;
          snapshot.task_batch_id = task.batch_id || null;
          snapshot.task_priority = task.priority || null;
          snapshot.task_start_date = task.start_date || null;
          snapshot.task_due_date = task.due_date || null;
          snapshot.task_day_number = task.day_number || null;
        } else {
          // Task was deleted: use submission_code as fallback identifier
          snapshot.task_code = submission.submission_code || null;
          snapshot.task_title = "Deleted task (historical data unavailable)";
          snapshot.task_description = null;
          snapshot.task_expected_output = null;
          snapshot.task_how_to_do = null;
          snapshot.task_instructions = null;
          snapshot.task_domain = null;
          snapshot.task_program = null;
          snapshot.task_batch_id = null;
          snapshot.task_priority = null;
          snapshot.task_start_date = null;
          snapshot.task_due_date = null;
          snapshot.task_day_number = null;
        }
        
        // Update the submission with snapshot data
        await submissions.updateOne(
          { _id: submission._id },
          { $set: snapshot }
        );
        
        updated++;
        
        if (updated % 100 === 0) {
          console.log(`Progress: ${updated} submissions updated...`);
        }
      } catch (err) {
        console.error(`Failed to backfill submission ${submission._id}:`, err.message);
        failed++;
      }
    }
    
    console.log('\n=== Backfill Complete ===');
    console.log(`✓ Updated: ${updated}`);
    console.log(`⊘ Skipped: ${skipped}`);
    console.log(`✗ Failed: ${failed}`);
    
  } catch (error) {
    console.error('Backfill script failed:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('✓ Database connection closed');
  }
}

// Run the script
backfillSubmissionSnapshots()
  .then(() => {
    console.log('✓ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('✗ Script failed:', error);
    process.exit(1);
  });
