require('dotenv').config();
const { MongoClient } = require('mongodb');

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();
  
  const assignmentsCount = await db.collection('task_assignments').countDocuments();
  console.log('Total task_assignments:', assignmentsCount);
  
  const tasksCount = await db.collection('tasks').countDocuments();
  console.log('Total tasks:', tasksCount);
  
  if (tasksCount > 0) {
    const tasks = await db.collection('tasks').find({}).toArray();
    console.log('\nAll tasks:');
    tasks.forEach(t => {
      console.log(`  Task ${t.task_code}: ${t.title}`);
      console.log(`    target_type: ${t.target_type}`);
      console.log(`    batch_id: ${t.batch_id || 'none'}`);
      console.log(`    assigned_to: ${t.assigned_to || 'none'}`);
    });
    
    if (assignmentsCount > 0) {
      const assignments = await db.collection('task_assignments').find({}).toArray();
      console.log('\nAll task_assignments:');
      assignments.forEach(a => {
        console.log(`  task_id: ${a.task_id}, student_id: ${a.student_id}, status: ${a.status}`);
      });
    }
  }
  
  const studentsCount = await db.collection('users').countDocuments({ role: 'student' });
  console.log('\nTotal students:', studentsCount);
  
  if (studentsCount > 0) {
    const students = await db.collection('users').find({ role: 'student' }).limit(3).toArray();
    console.log('\nSample students:');
    students.forEach(s => {
      console.log(`  ${s.name} (${s.email}) - ID: ${s._id}`);
    });
  }
  
  await client.close();
})();
