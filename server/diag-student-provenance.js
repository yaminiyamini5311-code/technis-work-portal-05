require('dotenv').config();
const { MongoClient } = require('mongodb');

function maskEmail(e) {
  const [u, d] = String(e || '').split('@');
  return d ? `${u.slice(0, 2)}***@${d}` : '***';
}

async function main() {
  const uri = process.env.MONGODB_URI && process.env.MONGODB_URI.trim();
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const db = client.db((process.env.MONGODB_DB_NAME || 'techins').trim());

  console.log('=== 3 PENDING STUDENTS ===');
  const pending = await db.collection('users').find({ registration_status: 'pending' }).toArray();
  for (const u of pending) {
    console.log(`  ${maskEmail(u.email)} name="${u.name}" role=${u.role} active=${JSON.stringify(u.active)} batch=${u.batch_id ? 'yes' : 'no'} program=${u.program || 'NULL'} created=${u.created_at || 'NULL'} dept=${u.department || 'NULL'}`);
  }

  console.log('\n=== created_at distribution (students) ===');
  const byDay = await db.collection('users').aggregate([
    { $match: { role: 'student' } },
    { $group: { _id: { $substrBytes: [{ $ifNull: ['$created_at', 'NULL'] }, 0, 10] }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]).toArray();
  byDay.forEach(d => console.log(`  ${d._id}: ${d.count}`));

  console.log('\n=== field presence across students ===');
  const students = await db.collection('users').find({ role: 'student' }).project({ batch_id: 1, program: 1, department: 1, phone: 1, avatar: 1, sqlite_id: 1, created_at: 1 }).toArray();
  const presence = {};
  for (const u of students) {
    for (const k of Object.keys(u)) {
      if (k === '_id') continue;
      const v = u[k];
      const has = v !== undefined && v !== null;
      presence[k] = presence[k] || { present: 0, missing: 0 };
      if (has) presence[k].present++; else presence[k].missing++;
    }
  }
  for (const [k, v] of Object.entries(presence)) console.log(`  ${k}: present=${v.present} missing/absent=${v.missing} (of ${students.length})`);

  console.log('\n=== recent audit_logs (user actions) ===');
  const logs = await db.collection('audit_logs').find({ entity_type: 'user' }).sort({ created_at: -1 }).limit(15).toArray();
  for (const l of logs) {
    console.log(`  ${l.created_at} action=${l.action} entity=${String(l.entity_id).slice(0, 6)}***`);
  }

  console.log('\n=== duplicate emails? (case-insensitive count) ===');
  const dupes = await db.collection('users').aggregate([
    { $group: { _id: { $toLower: { $trim: { input: { $toString: '$email' } } } }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();
  console.log('  case-insensitive duplicate emails:', dupes.length);

  console.log('\n=== batches collection ===');
  const batches = await db.collection('batches').find().project({ name: 1, active: 1, program: 1 }).toArray();
  console.log('  batches:', batches.length);
  for (const b of batches) console.log(`    "${b.name}" active=${JSON.stringify(b.active)}`);

  await client.close();
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
