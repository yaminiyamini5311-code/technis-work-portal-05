#!/usr/bin/env node
/**
 * Seed Authorized Users
 * 
 * This script is INSERT-ONLY and idempotent. It will:
 * - Insert new authorized users that don't exist
 * - NEVER overwrite, reset, or delete existing records
 * - Safe to run on every deploy
 * 
 * Uses bulkWrite with $setOnInsert to ensure existing records are untouched
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { MongoClient } = require("mongodb");
const { COLLECTION_NAME, createIndexes } = require("../models/AuthorizedUser");

// Authorized Managers (4)
const MANAGERS = [
  { email: "manager1@techins.com", role: "manager", name: "Manager 1", isDemo: false },
  { email: "manager2@techins.com", role: "manager", name: "Manager 2", isDemo: false },
  { email: "manager3@techins.com", role: "manager", name: "Manager 3", isDemo: false },
  { email: "manager4@techins.com", role: "manager", name: "Manager 4", isDemo: false }
];

// Authorized Students (67, including Demo)
const STUDENTS = [
  { learnerId: "T60-001", name: "Hariram S", email: "hariram.s@techins60.com" },
  { learnerId: "T60-002", name: "Kanishka RP", email: "kanishka.rp@techins60.com" },
  { learnerId: "T60-003", name: "Haashish P", email: "haashish.p@techins60.com" },
  { learnerId: "T60-004", name: "Shanmathi S", email: "shanmathi.s@techins60.com" },
  { learnerId: "T60-005", name: "VAISHNAVI G", email: "vaishnavi.g@techins60.com" },
  { learnerId: "T60-006", name: "Thomas Rupia", email: "thomas.rupia@techins60.com" },
  { learnerId: "T60-007", name: "Logeshwari E", email: "logeshwari.e@techins60.com" },
  { learnerId: "T60-008", name: "SWATHIKA D", email: "swathika.d@techins60.com" },
  { learnerId: "T60-009", name: "Sruthi S", email: "sruthi.s@techins60.com" },
  { learnerId: "T60-010", name: "Yuvanesh A", email: "yuvanesh.a@techins60.com" },
  { learnerId: "T60-011", name: "G M Vishnu", email: "g.m.vishnu@techins60.com" },
  { learnerId: "T60-012", name: "G.Monisha", email: "g.monisha@techins60.com" },
  { learnerId: "T60-013", name: "Charu Sri R S", email: "charu.sri.r.s@techins60.com" },
  { learnerId: "T60-014", name: "Karthikhaa MM", email: "karthikhaa.mm@techins60.com" },
  { learnerId: "T60-015", name: "Pragashree B", email: "pragashree.b@techins60.com" },
  { learnerId: "T60-016", name: "S Brindha Lakshmi", email: "s.brindha.lakshmi@techins60.com" },
  { learnerId: "T60-017", name: "Sandhya Krishnamari", email: "sandhya.krishnamari@techins60.com" },
  { learnerId: "T60-018", name: "Abhishek S", email: "abhishek.s@techins60.com" },
  { learnerId: "T60-019", name: "Dharan B", email: "dharan.b@techins60.com" },
  { learnerId: "T60-020", name: "Shahana S", email: "shahana.s@techins60.com" },
  { learnerId: "T60-021", name: "Kirti R", email: "kirti.r@techins60.com" },
  { learnerId: "T60-022", name: "RITHVIKA B", email: "rithvika.b@techins60.com" },
  { learnerId: "T60-023", name: "Agalya", email: "agalya@techins60.com" },
  { learnerId: "T60-024", name: "Mohammed Owais F", email: "mohammed.owais.f@techins60.com" },
  { learnerId: "T60-025", name: "Subham Dev R", email: "subham.dev.r@techins60.com" },
  { learnerId: "T60-026", name: "Sri Rangaa N", email: "sri.rangaa.n@techins60.com" },
  { learnerId: "T60-027", name: "Nivashini S", email: "nivashini.s@techins60.com" },
  { learnerId: "T60-028", name: "Anagha S Kumar", email: "anagha.s.kumar@techins60.com" },
  { learnerId: "T60-029", name: "Sujithra K", email: "sujithra.k@techins60.com" },
  { learnerId: "T60-030", name: "Swetha J", email: "swetha.j@techins60.com" },
  { learnerId: "T60-031", name: "M.Padmanabhan", email: "m.padmanabhan@techins60.com" },
  { learnerId: "T60-032", name: "Priyadharshini A", email: "priyadharshini.a@techins60.com" },
  { learnerId: "T60-033", name: "KIRUTHIKA VARADHARAJ", email: "kiruthika.varadharaj@techins60.com" },
  { learnerId: "T60-034", name: "Manoj Kumar P", email: "manoj.kumar.p@techins60.com" },
  { learnerId: "T60-035", name: "Velvishal", email: "velvishal@techins60.com" },
  { learnerId: "T60-036", name: "Sivashankar.R", email: "sivashankar.r@techins60.com" },
  { learnerId: "T60-037", name: "Subashini N", email: "subashini.n@techins60.com" },
  { learnerId: "T60-038", name: "R. Mugileshwaran", email: "r.mugileshwaran@techins60.com" },
  { learnerId: "T60-039", name: "Vignesh B", email: "vignesh.b@techins60.com" },
  { learnerId: "T60-040", name: "RAKSHNA.R", email: "rakshna.r@techins60.com" },
  { learnerId: "T60-041", name: "S Varshini", email: "s.varshini@techins60.com" },
  { learnerId: "T60-042", name: "Soorya R", email: "soorya.r@techins60.com" },
  { learnerId: "T60-043", name: "H.SRUTHII", email: "h.sruthii@techins60.com" },
  { learnerId: "T60-044", name: "Mathiyarasi C", email: "mathiyarasi.c@techins60.com" },
  { learnerId: "T60-045", name: "S PAANKAJ RAAJ", email: "s.paankaj.raaj@techins60.com" },
  { learnerId: "T60-046", name: "Sudarshan S", email: "sudarshan.s@techins60.com" },
  { learnerId: "T60-047", name: "SANJAYKUMAR R", email: "sanjaykumar.r@techins60.com" },
  { learnerId: "T60-048", name: "SHANMUGAPRIYAN S A", email: "shanmugapriyan.s.a@techins60.com" },
  { learnerId: "T60-049", name: "Vishwa B", email: "vishwa.b@techins60.com" },
  { learnerId: "T60-050", name: "TAMILARASAN M", email: "tamilarasan.m@techins60.com" },
  { learnerId: "T60-051", name: "M.Padmashree", email: "m.padmashree@techins60.com" },
  { learnerId: "T60-052", name: "S Sashwath Subramaniam", email: "s.sashwath.subramaniam@techins60.com" },
  { learnerId: "T60-053", name: "Nifa Fathima O A", email: "nifa.fathima.o.a@techins60.com" },
  { learnerId: "T60-054", name: "Vaishnavi S", email: "vaishnavi.s@techins60.com" },
  { learnerId: "T60-055", name: "Monish G", email: "monish.g@techins60.com" },
  { learnerId: "T60-056", name: "Yashwini K", email: "yashwini.k@techins60.com" },
  { learnerId: "T60-057", name: "V.Sivakumar", email: "v.sivakumar@techins60.com" },
  { learnerId: "T60-058", name: "S.Ritika", email: "s.ritika@techins60.com" },
  { learnerId: "T60-059", name: "Sharan Sakthivel H", email: "sharan.sakthivel.h@techins60.com" },
  { learnerId: "T60-060", name: "S. MOHAMMED Ayub", email: "s.mohammed.ayub@techins60.com" },
  { learnerId: "T60-061", name: "Sujitha M S", email: "sujitha.m.s@techins60.com" },
  { learnerId: "T60-062", name: "Kanimozhi J", email: "kanimozhi.j@techins60.com" },
  { learnerId: "T60-063", name: "Yamini K", email: "yamini.k@techins60.com" },
  { learnerId: "T60-064", name: "Raaghavi M", email: "raaghavi.m@techins60.com" },
  { learnerId: "T60-065", name: "Dharshini P", email: "dharshini.p@techins60.com" },
  { learnerId: "T60-066", name: "Dharun Shree C", email: "dharun.shree.c@techins60.com" },
  { learnerId: "T60-067", name: "Demo", email: "demo@techins60.com", isDemo: true }
];

async function seed() {
  const MONGODB_URI = process.env.MONGODB_URI;
  
  if (!MONGODB_URI) {
    console.error("❌ MONGODB_URI not configured in .env file");
    process.exit(1);
  }
  
  console.log("=" .repeat(70));
  console.log("Seeding Authorized Users (INSERT-ONLY, IDEMPOTENT)");
  console.log("=" .repeat(70));
  console.log(`Total to seed: ${STUDENTS.length} students + ${MANAGERS.length} managers = ${STUDENTS.length + MANAGERS.length}`);
  console.log("");
  
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log("✓ Connected to MongoDB Atlas");
    
    const db = client.db();
    const collection = db.collection(COLLECTION_NAME);
    
    // Create indexes
    await createIndexes(db);
    console.log("✓ Indexes created/verified");
    console.log("");
    
    // Prepare bulkWrite operations
    const operations = [];
    const now = new Date();
    
    // Add managers
    for (const manager of MANAGERS) {
      operations.push({
        updateOne: {
          filter: { email: manager.email.trim().toLowerCase() },
          update: {
            $setOnInsert: {
              email: manager.email.trim().toLowerCase(),
              role: manager.role,
              name: manager.name,
              isDemo: manager.isDemo,
              active: true,
              createdAt: now,
              updatedAt: now
            }
          },
          upsert: true
        }
      });
    }
    
    // Add students
    for (const student of STUDENTS) {
      operations.push({
        updateOne: {
          filter: { email: student.email.trim().toLowerCase() },
          update: {
            $setOnInsert: {
              email: student.email.trim().toLowerCase(),
              role: "student",
              learnerId: student.learnerId,
              name: student.name,
              isDemo: student.isDemo || false,
              active: true,
              createdAt: now,
              updatedAt: now
            }
          },
          upsert: true
        }
      });
    }
    
    // Execute bulk insert-only operation
    console.log("Executing bulk upsert (insert-only, no overwrites)...");
    const result = await collection.bulkWrite(operations, { ordered: false });
    
    console.log("");
    console.log("=" .repeat(70));
    console.log("Bulk Operation Results:");
    console.log("=" .repeat(70));
    console.log(`Inserted: ${result.upsertedCount} new records`);
    console.log(`Matched existing: ${result.matchedCount} records (no changes)`);
    console.log(`Modified: ${result.modifiedCount} records`);
    console.log("");
    
    // Verify counts
    const [totalCount, studentCount, managerCount] = await Promise.all([
      collection.countDocuments({ active: true }),
      collection.countDocuments({ role: "student", active: true }),
      collection.countDocuments({ role: "manager", active: true })
    ]);
    
    console.log("=" .repeat(70));
    console.log("Verification - Current Database State:");
    console.log("=" .repeat(70));
    console.log(`Total active authorized users: ${totalCount}`);
    console.log(`Active students: ${studentCount}`);
    console.log(`Active managers: ${managerCount}`);
    console.log("");
    
    // Expected counts
    const EXPECTED_STUDENTS = 67;
    const EXPECTED_MANAGERS = 4;
    const EXPECTED_TOTAL = 71;
    
    // Validate counts
    if (studentCount !== EXPECTED_STUDENTS) {
      console.error(`❌ MISMATCH: Expected ${EXPECTED_STUDENTS} students, found ${studentCount}`);
      process.exit(1);
    }
    
    if (managerCount !== EXPECTED_MANAGERS) {
      console.error(`❌ MISMATCH: Expected ${EXPECTED_MANAGERS} managers, found ${managerCount}`);
      process.exit(1);
    }
    
    if (totalCount < EXPECTED_TOTAL) {
      console.error(`❌ MISMATCH: Expected at least ${EXPECTED_TOTAL} total, found ${totalCount}`);
      process.exit(1);
    }
    
    console.log("✅ PASS: All counts match expected values");
    console.log(`   Students: ${studentCount} = ${EXPECTED_STUDENTS} ✓`);
    console.log(`   Managers: ${managerCount} = ${EXPECTED_MANAGERS} ✓`);
    console.log(`   Total: ${totalCount} >= ${EXPECTED_TOTAL} ✓`);
    console.log("");
    
    // Verify learner IDs
    console.log("=" .repeat(70));
    console.log("Verifying learner IDs (T60-001 to T60-067):");
    console.log("=" .repeat(70));
    
    const learnerIds = await collection.find(
      { role: "student", active: true },
      { projection: { learnerId: 1, _id: 0 } }
    ).sort({ learnerId: 1 }).toArray();
    
    const foundIds = learnerIds.map(doc => doc.learnerId).filter(Boolean);
    const expectedIds = STUDENTS.map(s => s.learnerId);
    
    const missing = expectedIds.filter(id => !foundIds.includes(id));
    const unexpected = foundIds.filter(id => !expectedIds.includes(id));
    
    if (missing.length > 0) {
      console.error(`❌ Missing learner IDs: ${missing.join(", ")}`);
      process.exit(1);
    }
    
    if (unexpected.length > 0) {
      console.warn(`⚠️  Unexpected learner IDs: ${unexpected.join(", ")}`);
    }
    
    console.log(`✅ PASS: All ${expectedIds.length} learner IDs present`);
    console.log(`   Range: ${expectedIds[0]} to ${expectedIds[expectedIds.length - 1]}`);
    console.log("");
    
    // Check for duplicates
    const duplicateCheck = await collection.aggregate([
      { $match: { active: true } },
      { $group: { _id: "$email", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }
    ]).toArray();
    
    if (duplicateCheck.length > 0) {
      console.error("❌ Duplicate emails found:");
      duplicateCheck.forEach(dup => console.error(`   ${dup._id}: ${dup.count} records`));
      process.exit(1);
    }
    
    console.log("✅ PASS: No duplicate emails");
    console.log("");
    
    console.log("=" .repeat(70));
    console.log("🎉 Seed completed successfully!");
    console.log("=" .repeat(70));
    console.log("• All 71 authorized users are in the database");
    console.log("• Existing records were NOT modified");
    console.log("• Safe to run this script again anytime");
    console.log("");
    
  } catch (error) {
    console.error("");
    console.error("=" .repeat(70));
    console.error("❌ SEED FAILED");
    console.error("=" .repeat(70));
    console.error("Error:", error.message);
    console.error("");
    console.error("No data was modified or deleted.");
    console.error("Fix the error and run the script again.");
    console.error("");
    process.exit(1);
  } finally {
    await client.close();
  }
}

// Run seed
if (require.main === module) {
  seed();
}

module.exports = { seed };
