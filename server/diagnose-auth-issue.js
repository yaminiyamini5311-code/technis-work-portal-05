/**
 * AUTH ISSUE DIAGNOSTIC SCRIPT
 * 
 * Usage:
 *   # Check local database
 *   node diagnose-auth-issue.js
 * 
 *   # Check production database
 *   MONGODB_URI="mongodb+srv://..." node diagnose-auth-issue.js
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');

const MONGODB_URI = process.env.MONGODB_URI.trim();
const MONGODB_DB_NAME = (process.env.MONGODB_DB_NAME || 'techins').trim();

async function diagnose() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('AUTH ISSUE DIAGNOSTIC');
  console.log('═══════════════════════════════════════════════════════\n');
  
  const isProduction = MONGODB_URI.includes('mongodb+srv');
  console.log(`Database: ${isProduction ? 'PRODUCTION (Atlas)' : 'LOCAL'}`);
  console.log(`URI prefix: ${MONGODB_URI.substring(0, 20)}...`);
  console.log(`Database name: ${MONGODB_DB_NAME}\n`);
  
  const client = new MongoClient(MONGODB_URI, {
    serverSelectionTimeoutMS: 10000
  });
  
  try {
    await client.connect();
    const db = client.db(MONGODB_DB_NAME);
    
    // Check affected users
    const affectedEmails = ['s.ritika@techins60.com', 'soorya.r@techins60.com'];
    const users = await db.collection('users').find({
      email: { $in: affectedEmails }
    }).toArray();
    
    console.log('─────────────────────────────────────────────────────');
    console.log('AFFECTED USERS');
    console.log('─────────────────────────────────────────────────────\n');
    
    if (users.length === 0) {
      console.log('✗ NO USERS FOUND');
      console.log('  Expected emails:', affectedEmails.join(', '));
      console.log('\n  ROOT CAUSE: Users do not exist in this database\n');
    } else {
      console.log(`Found ${users.length} user(s):\n`);
      
      for (const user of users) {
        console.log(`Email: ${user.email}`);
        console.log(`  Name: ${user.name}`);
        console.log(`  Role: ${user.role}`);
        console.log(`  Active: ${user.active} (Type: ${typeof user.active})`);
        console.log(`  Number(active): ${Number(user.active)}`);
        console.log(`  Number(active) === 1: ${Number(user.active) === 1 ? '✓ YES' : '✗ NO'}`);
        console.log(`  Password exists: ${user.password ? '✓ YES' : '✗ NO'}`);
        
        if (user.password) {
          const isBcrypt = user.password.match(/^\$2[aby]\$/);
          console.log(`  Password format: ${isBcrypt ? '✓ bcrypt' : '✗ NOT bcrypt'}`);
          console.log(`  Password prefix: ${user.password.substring(0, 7)}...`);
          console.log(`  Password length: ${user.password.length} (bcrypt = 60)`);
        }
        
        console.log(`  Reg status: ${user.registration_status}`);
        console.log(`  Department: ${user.department}`);
        console.log(`  Batch ID: ${user.batch_id || 'NULL'}`);
        console.log(`  Program: ${user.program || 'NULL'}`);
        console.log(`  Created: ${user.created_at || 'NULL'}`);
        
        // Determine why login would fail
        const issues = [];
        if (Number(user.active) !== 1) {
          issues.push(`active=${JSON.stringify(user.active)} (not Number 1)`);
        }
        if (!user.password) {
          issues.push('password is NULL');
        } else if (!user.password.match(/^\$2[aby]\$/)) {
          issues.push('password not bcrypt format');
        }
        
        if (issues.length > 0) {
          console.log(`\n  ✗ LOGIN WILL FAIL: ${issues.join(', ')}`);
        } else {
          console.log(`\n  ✓ Database fields are correct - login should work with correct password`);
        }
        console.log('');
      }
    }
    
    // Check for users with problematic active values
    console.log('─────────────────────────────────────────────────────');
    console.log('USERS WITH PROBLEMATIC active VALUES');
    console.log('─────────────────────────────────────────────────────\n');
    
    const problematic = await db.collection('users').find({
      role: 'student',
      $or: [
        { active: { $ne: 1 } },
        { active: { $type: 'string' } },
        { active: { $exists: false } }
      ]
    }).toArray();
    
    if (problematic.length === 0) {
      console.log('✓ No users found with problematic active values\n');
    } else {
      console.log(`Found ${problematic.length} user(s):\n`);
      problematic.forEach(u => {
        console.log(`- ${u.email}`);
        console.log(`  active: ${JSON.stringify(u.active)} (Type: ${typeof u.active})`);
      });
      console.log('');
    }
    
    // Check total user counts
    console.log('─────────────────────────────────────────────────────');
    console.log('SUMMARY');
    console.log('─────────────────────────────────────────────────────\n');
    
    const total = await db.collection('users').countDocuments();
    const students = await db.collection('users').countDocuments({ role: 'student' });
    const activeStudents = await db.collection('users').countDocuments({ role: 'student', active: 1 });
    
    console.log(`Total users: ${total}`);
    console.log(`Students: ${students}`);
    console.log(`Active students: ${activeStudents}`);
    
    await client.close();
    
  } catch (error) {
    console.error('\n✗ CONNECTION ERROR:', error.message);
    console.error('\nPossible causes:');
    console.error('  1. Wrong MONGODB_URI');
    console.error('  2. Network/firewall blocking connection');
    console.error('  3. Database credentials invalid');
    console.error('  4. IP not whitelisted (production only)');
  }
}

diagnose().catch(console.error);
