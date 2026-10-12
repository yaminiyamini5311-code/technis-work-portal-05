require('dotenv').config();
const { MongoClient } = require('mongodb');

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();
  
  await db.collection('tasks').deleteMany({ task_code: /^TEST-/ });
  await db.collection('users').deleteMany({ email: /\.test$/ });
  await db.collection('task_assignments').deleteMany({});
  
  console.log('Cleanup complete');
  await client.close();
})();
