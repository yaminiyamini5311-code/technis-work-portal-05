/**
 * READ-ONLY diagnostic for the student login/approval issue.
 * Prints counts and flag values only — never passwords, hashes, tokens or env values.
 *
 * Usage: node diagnose-student-login.js
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');

function maskEmail(e) {
  if (!e || typeof e !== 'string') return String(e);
  const [user, domain] = e.split('@');
  if (!domain) return '***';
  return `${user.slice(0, 2)}***@${domain}`;
}

function hashShape(h) {
  if (!h) return 'MISSING';
  const m = String(h).match(/^\$2[aby]\$/);
  return m ? `bcrypt(${m[0]}) len=${String(h).length}` : `unknown len=${String(h).length}`;
}

async function main() {
  const uri = process.env.MONGODB_URI && process.env.MONGODB_URI.trim();
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const db = client.db((process.env.MONGODB_DB_NAME || 'techins').trim());

  console.log('=== TOTAL / BY ROLE ===');
  const total = await db.collection('users').countDocuments();
  const byRole = await db.collection('users').aggregate([
    { $group: { _id: '$role', count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]).toArray();
  console.log('total users:', total);
  for (const r of byRole) console.log(`  role=${JSON.stringify(r._id)} count=${r.count}`);

  console.log('\n=== active VALUE/TYPE BREAKDOWN (all users) ===');
  const activeAgg = await db.collection('users').aggregate([
    { $project: { av: { $type: '$active' }, active: 1, role: 1 } },
    { $group: { _id: { type: '$av', val: { $toString: '$active' } }, count: { $sum: 1 },
      roles: { $addToSet: '$role' } } },
    { $sort: { '_id.type': 1, '_id.val': 1 } }
  ]).toArray();
  for (const a of activeAgg) {
    console.log(`  active type=${a._id.type} value=${a._id.val} count=${a.count} roles=${a.roles.map(x=>JSON.stringify(x)).join(',')}`);
  }

  console.log('\n=== registration_status BREAKDOWN ===');
  const regAgg = await db.collection('users').aggregate([
    { $group: { _id: '$registration_status', count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]).toArray();
  for (const r of regAgg) console.log(`  registration_status=${JSON.stringify(r._id)} count=${r.count}`);

  console.log('\n=== STUDENT CROSS-TAB: active x registration_status ===');
  const xt = await db.collection('users').aggregate([
    { $match: { role: 'student' } },
    { $group: { _id: { a: { $type: '$active' }, av: { $toString: '$active' }, rs: '$registration_status' }, count: { $sum: 1 } } },
    { $sort: { '_id.av': 1, '_id.rs': 1 } }
  ]).toArray();
  for (const x of xt) console.log(`  active(${x._id.a})=${x._id.av} reg=${JSON.stringify(x._id.rs)} count=${x.count}`);

  console.log('\n=== EMAIL HYGIENE (all users) ===');
  const users = await db.collection('users').find({}, {
    projection: { email: 1, name: 1, role: 1, active: 1, registration_status: 1, batch_id: 1, program: 1, created_at: 1, sqlite_id: 1, password: 1, department: 1 }
  }).toArray();
  let notLower = 0, notTrim = 0;
  for (const u of users) {
    const e = String(u.email || '');
    if (e !== e.trim()) notTrim++;
    if (e.trim() !== e.trim().toLowerCase()) notLower++;
  }
  console.log(`  emails with leading/trailing whitespace: ${notTrim}`);
  console.log(`  emails not lowercase (after trim): ${notLower}`);

  console.log('\n=== ROLE CASING ===');
  const roleCase = await db.collection('users').aggregate([
    { $group: { _id: '$role', count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]).toArray();
  roleCase.forEach(r => console.log(`  role="${r._id}" count=${r.count}`));

  console.log('\n=== PASSWORD SHAPE (prefix type only, never values) ===');
  const pwShapes = {};
  for (const u of users) {
    const shape = hashShape(u.password);
    pwShapes[shape] = (pwShapes[shape] || 0) + 1;
  }
  Object.keys(pwShapes).sort().forEach(k => console.log(`  ${k}: ${pwShapes[k]}`));

  console.log('\n=== SERVER-CREATED vs DIRECT-INSERT COMPARISON (students) ===');
  // Heuristics: server signup/admin paths always set batch_id (signup) or program; sqlite migration sets sqlite_id
  const withSqliteId = await db.collection('users').countDocuments({ role: 'student', sqlite_id: { $exists: true } });
  const withBatch = await db.collection('users').countDocuments({ role: 'student', batch_id: { $exists: true, $ne: null } });
  console.log(`  students with sqlite_id (migrated from legacy sqlite): ${withSqliteId}`);
  console.log(`  students with batch_id: ${withBatch}`);

  const broken = await db.collection('users').find({
    role: 'student',
    $or: [
      { active: { $exists: false } },
      { active: null },
      { active: { $ne: 1 } }
    ]
  }).toArray();
  console.log(`\n=== BROKEN PER LOGIN CHECK (role=student, Number(active)!==1): ${broken.length} ===`);
  for (const u of broken) {
    console.log(`  ${maskEmail(u.email)} | role="${u.role}" active=${JSON.stringify(u.active)}(${typeof u.active}) reg=${JSON.stringify(u.registration_status)} pw=${hashShape(u.password)} batch=${u.batch_id ? 'yes' : 'no'} sqlite_id=${u.sqlite_id !== undefined ? 'yes' : 'no'} created=${u.created_at || 'NULL'}`);
  }

  console.log('\n=== NON-BROKEN STUDENTS (login check passes) — sample flags ===');
  const okStudents = await db.collection('users').find({ role: 'student', active: 1 }).limit(5).toArray();
  for (const u of okStudents) {
    console.log(`  ${maskEmail(u.email)} | active=${JSON.stringify(u.active)}(${typeof u.active}) reg=${JSON.stringify(u.registration_status)} pw=${hashShape(u.password)} batch=${u.batch_id ? 'yes' : 'no'} sqlite_id=${u.sqlite_id !== undefined ? 'yes' : 'no'}`);
  }

  console.log('\n=== OTHER ROLES FLAGS (never touched by repair) ===');
  const others = await db.collection('users').find({ role: { $in: ['ceo', 'admin', 'manager'] } }).toArray();
  for (const u of others) {
    console.log(`  role="${u.role}" ${maskEmail(u.email)} active=${JSON.stringify(u.active)}(${typeof u.active}) reg=${JSON.stringify(u.registration_status)} pw=${hashShape(u.password)}`);
  }

  console.log('\n=== LOGIN-SIM: would each student pass the current gate? ===');
  const sim = await db.collection('users').aggregate([
    { $match: { role: 'student' } },
    { $group: { _id: { $eq: [ { $toInt: { $ifNull: ['$active', 0] } }, 1 ] }, count: { $sum: 1 } } }
  ]).toArray();
  sim.forEach(s => console.log(`  Number(active)===1 -> ${s._id} : ${s.count}`));

  await client.close();
}

main().catch(e => { console.error('DIAG ERROR:', e.message); process.exit(1); });
