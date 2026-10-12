require('dotenv').config();
const { MongoClient } = require('mongodb');

async function main() {
  const uri = process.env.MONGODB_URI && process.env.MONGODB_URI.trim();
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const db = client.db((process.env.MONGODB_DB_NAME || 'techins').trim());
  const cols = await db.listCollections().toArray();
  console.log('collections:', cols.map(c => c.name).join(', '));
  const studentsNoBatch = await db.collection('users').find({ role: 'student', $or: [{ batch_id: { $exists: false } }, { batch_id: null }] }).project({ email: 1, name: 1, program: 1, created_at: 1, active: 1, registration_status: 1 }).toArray();
  console.log('\nstudents without batch_id:', studentsNoBatch.length);
  for (const u of studentsNoBatch) console.log(`  ${String(u.email).split('@')[0].slice(0,2)}***@${String(u.email).split('@')[1]} name="${u.name}" program=${u.program} created=${u.created_at}`);
  const learnerIds = await db.collection('users').countDocuments({ role: 'student', learner_id: { $exists: true } });
  console.log('\nstudents with learner_id:', learnerIds);
  await client.close();
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
