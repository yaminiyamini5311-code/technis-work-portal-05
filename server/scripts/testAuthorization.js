#!/usr/bin/env node
/**
 * Test Authorization System
 * 
 * This script tests the CEO notification authorization system
 * Run after seeding: npm run seed:authorized && node scripts/testAuthorization.js
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { MongoClient } = require("mongodb");
const { isAuthorized, getStats, COLLECTION_NAME } = require("../models/AuthorizedUser");

async function test() {
  const MONGODB_URI = process.env.MONGODB_URI;
  
  if (!MONGODB_URI) {
    console.error("❌ MONGODB_URI not configured");
    process.exit(1);
  }
  
  console.log("=" .repeat(70));
  console.log("Authorization System Test");
  console.log("=" .repeat(70));
  console.log("");
  
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log("✓ Connected to MongoDB Atlas");
    console.log("");
    
    const db = client.db();
    
    // Test 1: Check statistics
    console.log("Test 1: Verify counts");
    console.log("-".repeat(70));
    const stats = await getStats(db);
    console.log(`Total authorized users: ${stats.total}`);
    console.log(`Active users: ${stats.active}`);
    console.log(`Students: ${stats.students}`);
    console.log(`Managers: ${stats.managers}`);
    console.log("");
    
    if (stats.students !== 67) {
      console.error(`❌ FAIL: Expected 67 students, found ${stats.students}`);
      process.exit(1);
    }
    
    if (stats.managers !== 4) {
      console.error(`❌ FAIL: Expected 4 managers, found ${stats.managers}`);
      process.exit(1);
    }
    
    console.log("✅ PASS: Counts match (67 students, 4 managers)");
    console.log("");
    
    // Test 2: Test authorized student
    console.log("Test 2: Authorized student");
    console.log("-".repeat(70));
    const authorizedStudent = "yamini.k@techins60.com";
    const isAuth1 = await isAuthorized(db, authorizedStudent);
    if (isAuth1) {
      console.log(`✅ PASS: ${authorizedStudent} is authorized`);
    } else {
      console.error(`❌ FAIL: ${authorizedStudent} should be authorized`);
      process.exit(1);
    }
    console.log("");
    
    // Test 3: Test authorized manager
    console.log("Test 3: Authorized manager");
    console.log("-".repeat(70));
    const authorizedManager = "manager1@techins.com";
    const isAuth2 = await isAuthorized(db, authorizedManager);
    if (isAuth2) {
      console.log(`✅ PASS: ${authorizedManager} is authorized`);
    } else {
      console.error(`❌ FAIL: ${authorizedManager} should be authorized`);
      process.exit(1);
    }
    console.log("");
    
    // Test 4: Test unauthorized email
    console.log("Test 4: Unauthorized email");
    console.log("-".repeat(70));
    const unauthorizedEmail = "hacker@evil.com";
    const isAuth3 = await isAuthorized(db, unauthorizedEmail);
    if (!isAuth3) {
      console.log(`✅ PASS: ${unauthorizedEmail} is NOT authorized`);
    } else {
      console.error(`❌ FAIL: ${unauthorizedEmail} should NOT be authorized`);
      process.exit(1);
    }
    console.log("");
    
    // Test 5: Test Demo user
    console.log("Test 5: Demo user (should be authorized)");
    console.log("-".repeat(70));
    const demoEmail = "demo@techins60.com";
    const isAuth4 = await isAuthorized(db, demoEmail);
    if (isAuth4) {
      console.log(`✅ PASS: ${demoEmail} is authorized (Demo is an authorized student)`);
    } else {
      console.error(`❌ FAIL: ${demoEmail} should be authorized`);
      process.exit(1);
    }
    console.log("");
    
    // Test 6: Verify all learner IDs
    console.log("Test 6: Verify learner IDs (T60-001 to T60-067)");
    console.log("-".repeat(70));
    const learnerIds = await db.collection(COLLECTION_NAME)
      .find({ role: "student", active: true }, { projection: { learnerId: 1, _id: 0 } })
      .sort({ learnerId: 1 })
      .toArray();
    
    const foundIds = learnerIds.map(doc => doc.learnerId).filter(Boolean);
    const expected = Array.from({ length: 67 }, (_, i) => `T60-${String(i + 1).padStart(3, '0')}`);
    
    const missing = expected.filter(id => !foundIds.includes(id));
    
    if (missing.length > 0) {
      console.error(`❌ FAIL: Missing learner IDs: ${missing.join(", ")}`);
      process.exit(1);
    }
    
    console.log(`✅ PASS: All 67 learner IDs present (T60-001 to T60-067)`);
    console.log("");
    
    // Test 7: Check for duplicates
    console.log("Test 7: Check for duplicate emails");
    console.log("-".repeat(70));
    const duplicates = await db.collection(COLLECTION_NAME).aggregate([
      { $match: { active: true } },
      { $group: { _id: "$email", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }
    ]).toArray();
    
    if (duplicates.length > 0) {
      console.error("❌ FAIL: Duplicate emails found:");
      duplicates.forEach(dup => console.error(`   ${dup._id}: ${dup.count} records`));
      process.exit(1);
    }
    
    console.log("✅ PASS: No duplicate emails");
    console.log("");
    
    // Test 8: Case insensitivity
    console.log("Test 8: Case insensitivity");
    console.log("-".repeat(70));
    const upperCase = "YAMINI.K@TECHINS60.COM";
    const mixedCase = "Yamini.K@TechIns60.Com";
    const isAuth5 = await isAuthorized(db, upperCase);
    const isAuth6 = await isAuthorized(db, mixedCase);
    
    if (isAuth5 && isAuth6) {
      console.log("✅ PASS: Authorization is case-insensitive");
    } else {
      console.error("❌ FAIL: Authorization should be case-insensitive");
      process.exit(1);
    }
    console.log("");
    
    // Summary
    console.log("=" .repeat(70));
    console.log("🎉 All tests passed!");
    console.log("=" .repeat(70));
    console.log("• 67 students + 4 managers = 71 authorized users");
    console.log("• All learner IDs present (T60-001 to T60-067)");
    console.log("• No duplicates");
    console.log("• Authorization working correctly");
    console.log("• Demo user is authorized");
    console.log("");
    
  } catch (error) {
    console.error("");
    console.error("❌ TEST FAILED");
    console.error("Error:", error.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  test();
}

module.exports = { test };
