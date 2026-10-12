require('dotenv').config();
const { MongoClient } = require('mongodb');

async function main() {
  const uri = process.env.MONGODB_URI && process.env.MONGODB_URI.trim();
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const admin = client.db().admin();
  const { databases } = await admin.listDatabases();
  for (const d of databases) {
    if (!['admin', 'local', 'config'].includes(d.name)) {
      console.log(`db: ${d.name} (sizeOnDisk=${d.sizeOnDisk})`);
    }
  }
  for (const d of databases) {
    if (['admin', 'local', 'config'].includes(d.name)) continue;
    const db = client.db(d.name);
    const cols = await db.listCollections().toArray();
    const usersCol = cols.find(c => c.name === 'users');
    if (usersCol) {
      const total = await db.collection('users').countDocuments();
      const broken = await db.collection('users').countDocuments({
        role: 'student',
        $or: [{ active: { $exists: false } }, { active: null }, { active: { $ne: 1 } }]
      });
      const pending = await db.collection('users').countDocuments({ role: 'student', registration_status: 'pending' });
      console.log(`  ${d.name}.users: total=${total} students_not_active1=${broken} students_pending=${pending}`);
    } else {
      console.log(`  ${d.name}: no users collection (collections: ${cols.map(c=>c.name).join(',')})`);
    }
  }
  await client.close();
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
