require('dotenv').config();
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');

async function verify() {
  const client = new MongoClient(process.env.MONGODB_URI.trim());
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME.trim());
  
  console.log('═══════════════════════════════════════════════════════');
  console.log('PASSWORD HASH VERIFICATION');
  console.log('═══════════════════════════════════════════════════════\n');
  
  const users = await db.collection('users').find({
    email: { $in: ['s.ritika@techins60.com', 'soorya.r@techins60.com'] }
  }).toArray();
  
  for (const user of users) {
    console.log(`Testing: ${user.email}`);
    console.log(`  Hash format: ${user.password.substring(0, 7)}...`);
    console.log(`  Hash length: ${user.password.length}`);
    
    // Test if this is a valid bcrypt hash
    const isBcrypt = user.password.startsWith('$2a$') || 
                     user.password.startsWith('$2b$') || 
                     user.password.startsWith('$2y$');
    console.log(`  Valid bcrypt format: ${isBcrypt}`);
    
    if (isBcrypt) {
      // Extract cost factor
      const costMatch = user.password.match(/^\$2[aby]\$(\d+)\$/);
      if (costMatch) {
        console.log(`  Bcrypt cost: ${costMatch[1]}`);
      }
    }
    
    // Test with common passwords to see if bcrypt.compare works
    const testPasswords = ['Test@123', 'Password@123', 'Techins@123'];
    console.log('  Testing common passwords...');
    
    for (const testPw of testPasswords) {
      try {
        const match = await bcrypt.compare(testPw, user.password);
        if (match) {
          console.log(`  ✓ Password matches: ${testPw} (DO NOT USE IN PRODUCTION)`);
        }
      } catch (err) {
        console.log(`  ✗ bcrypt.compare error: ${err.message}`);
      }
    }
    console.log('');
  }
  
  // Compare with a known-good user
  console.log('═══════════════════════════════════════════════════════');
  console.log('COMPARISON: Known-good server-created user');
  console.log('═══════════════════════════════════════════════════════\n');
  
  const goodUser = await db.collection('users').findOne({
    email: 'hariram.s@techins60.com'
  });
  
  if (goodUser) {
    console.log(`Email: ${goodUser.email}`);
    console.log(`Hash format: ${goodUser.password.substring(0, 7)}...`);
    console.log(`Hash length: ${goodUser.password.length}`);
    console.log(`Active: ${goodUser.active} (${typeof goodUser.active})`);
    console.log(`Reg status: ${goodUser.registration_status}`);
  }
  
  await client.close();
}

verify().catch(console.error);
