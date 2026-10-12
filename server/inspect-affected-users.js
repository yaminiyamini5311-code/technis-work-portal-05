require('dotenv').config();
const { MongoClient } = require('mongodb');

async function inspect() {
  const client = new MongoClient(process.env.MONGODB_URI.trim());
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME.trim());
  
  const affectedEmails = ['s.ritika@techins60.com', 'soorya.r@techins60.com'];
  const users = await db.collection('users').find({ 
    email: { $in: affectedEmails } 
  }).toArray();
  
  console.log('═══════════════════════════════════════════════════════');
  console.log('AFFECTED USERS INSPECTION (READ-ONLY)');
  console.log('═══════════════════════════════════════════════════════\n');
  console.log('Found:', users.length, 'user(s)\n');
  
  users.forEach((u, idx) => {
    console.log(`─── USER ${idx + 1} ─────────────────────────────────────────────`);
    console.log('Email:', u.email);
    console.log('Name:', u.name);
    console.log('Role:', u.role, '(Type:', typeof u.role + ')');
    console.log('Active:', u.active, '(Type:', typeof u.active + ')');
    console.log('Active as Number:', Number(u.active));
    console.log('Active === 1:', u.active === 1);
    console.log('Number(active) === 1:', Number(u.active) === 1);
    console.log('Password exists:', Boolean(u.password));
    console.log('Password format:', u.password ? (u.password.startsWith('$2') ? 'bcrypt $2' : 'unknown/plaintext') : 'NULL');
    console.log('Password length:', u.password ? u.password.length : 0);
    console.log('Registration status:', u.registration_status);
    console.log('Department:', u.department);
    console.log('Batch ID:', u.batch_id);
    console.log('Program:', u.program);
    console.log('Created at:', u.created_at);
    console.log('');
  });
  
  // Compare with a known-good server-created user
  console.log('═══════════════════════════════════════════════════════');
  console.log('COMPARISON: Server-created user (known good)');
  console.log('═══════════════════════════════════════════════════════\n');
  
  const goodUser = await db.collection('users').findOne({ 
    role: 'student',
    created_at: { $exists: true }
  });
  
  if (goodUser) {
    console.log('Email:', goodUser.email);
    console.log('Role:', goodUser.role, '(Type:', typeof goodUser.role + ')');
    console.log('Active:', goodUser.active, '(Type:', typeof goodUser.active + ')');
    console.log('Active as Number:', Number(goodUser.active));
    console.log('Password format:', goodUser.password ? (goodUser.password.startsWith('$2') ? 'bcrypt $2' : 'unknown') : 'NULL');
    console.log('Registration status:', goodUser.registration_status);
  }
  
  await client.close();
}

inspect().catch(console.error);
