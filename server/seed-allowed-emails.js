#!/usr/bin/env node
/**
 * Seed allowed emails into MongoDB
 * Idempotent - safe to run multiple times
 * Usage: node seed-allowed-emails.js
 */

require("dotenv").config();
const { MongoClient } = require("mongodb");

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "techins";

// Registration allowlist - stored in code, no CSV needed
const ALLOWED_EMAILS = [
  // Managers (4 total)
  { learnerId: "M001", name: "Manager 1", email: "manager1@techins.com", role: "manager" },
  { learnerId: "M002", name: "Manager 2", email: "manager2@techins.com", role: "manager" },
  { learnerId: "M003", name: "Manager 3", email: "manager3@techins.com", role: "manager" },
  { learnerId: "M004", name: "Manager 4", email: "manager4@techins.com", role: "manager" },
  
  // Students (66 total)
  { learnerId: "T60-001", name: "Hariram S", email: "hariram.s@techins60.com", role: "student" },
  { learnerId: "T60-002", name: "Kanishka RP", email: "kanishka.rp@techins60.com", role: "student" },
  { learnerId: "T60-003", name: "Haashish P", email: "haashish.p@techins60.com", role: "student" },
  { learnerId: "T60-004", name: "Shanmathi S", email: "shanmathi.s@techins60.com", role: "student" },
  { learnerId: "T60-005", name: "VAISHNAVI G", email: "vaishnavi.g@techins60.com", role: "student" },
  { learnerId: "T60-006", name: "Thomas Rupia", email: "thomas.rupia@techins60.com", role: "student" },
  { learnerId: "T60-007", name: "Logeshwari E", email: "logeshwari.e@techins60.com", role: "student" },
  { learnerId: "T60-008", name: "SWATHIKA D", email: "swathika.d@techins60.com", role: "student" },
  { learnerId: "T60-009", name: "Sruthi S", email: "sruthi.s@techins60.com", role: "student" },
  { learnerId: "T60-010", name: "Yuvanesh A", email: "yuvanesh.a@techins60.com", role: "student" },
  { learnerId: "T60-011", name: "G M Vishnu", email: "g.m.vishnu@techins60.com", role: "student" },
  { learnerId: "T60-012", name: "G.Monisha", email: "g.monisha@techins60.com", role: "student" },
  { learnerId: "T60-013", name: "Charu Sri R S", email: "charu.sri.r.s@techins60.com", role: "student" },
  { learnerId: "T60-014", name: "Karthikhaa MM", email: "karthikhaa.mm@techins60.com", role: "student" },
  { learnerId: "T60-015", name: "Pragashree B", email: "pragashree.b@techins60.com", role: "student" },
  { learnerId: "T60-016", name: "S Brindha Lakshmi", email: "s.brindha.lakshmi@techins60.com", role: "student" },
  { learnerId: "T60-017", name: "Sandhya Krishnamari", email: "sandhya.krishnamari@techins60.com", role: "student" },
  { learnerId: "T60-018", name: "Abhishek S", email: "abhishek.s@techins60.com", role: "student" },
  { learnerId: "T60-019", name: "Dharan B", email: "dharan.b@techins60.com", role: "student" },
  { learnerId: "T60-020", name: "Shahana S", email: "shahana.s@techins60.com", role: "student" },
  { learnerId: "T60-021", name: "Kirti R", email: "kirti.r@techins60.com", role: "student" },
  { learnerId: "T60-022", name: "RITHVIKA B", email: "rithvika.b@techins60.com", role: "student" },
  { learnerId: "T60-023", name: "Agalya", email: "agalya@techins60.com", role: "student" },
  { learnerId: "T60-024", name: "Mohammed Owais F", email: "mohammed.owais.f@techins60.com", role: "student" },
  { learnerId: "T60-025", name: "Subham Dev R", email: "subham.dev.r@techins60.com", role: "student" },
  { learnerId: "T60-026", name: "Sri Rangaa N", email: "sri.rangaa.n@techins60.com", role: "student" },
  { learnerId: "T60-027", name: "Nivashini S", email: "nivashini.s@techins60.com", role: "student" },
  { learnerId: "T60-028", name: "Anagha S Kumar", email: "anagha.s.kumar@techins60.com", role: "student" },
  { learnerId: "T60-029", name: "Sujithra K", email: "sujithra.k@techins60.com", role: "student" },
  { learnerId: "T60-030", name: "Swetha J", email: "swetha.j@techins60.com", role: "student" },
  { learnerId: "T60-031", name: "M.Padmanabhan", email: "m.padmanabhan@techins60.com", role: "student" },
  { learnerId: "T60-032", name: "Priyadharshini A", email: "priyadharshini.a@techins60.com", role: "student" },
  { learnerId: "T60-033", name: "KIRUTHIKA VARADHARAJ", email: "kiruthika.varadharaj@techins60.com", role: "student" },
  { learnerId: "T60-034", name: "Manoj Kumar P", email: "manoj.kumar.p@techins60.com", role: "student" },
  { learnerId: "T60-035", name: "Velvishal", email: "velvishal@techins60.com", role: "student" },
  { learnerId: "T60-036", name: "Sivashankar.R", email: "sivashankar.r@techins60.com", role: "student" },
  { learnerId: "T60-037", name: "Subashini N", email: "subashini.n@techins60.com", role: "student" },
  { learnerId: "T60-038", name: "R. Mugileshwaran", email: "r.mugileshwaran@techins60.com", role: "student" },
  { learnerId: "T60-039", name: "Vignesh B", email: "vignesh.b@techins60.com", role: "student" },
  { learnerId: "T60-040", name: "RAKSHNA.R", email: "rakshna.r@techins60.com", role: "student" },
  { learnerId: "T60-041", name: "S Varshini", email: "s.varshini@techins60.com", role: "student" },
  { learnerId: "T60-042", name: "Soorya R", email: "soorya.r@techins60.com", role: "student" },
  { learnerId: "T60-043", name: "H.SRUTHII", email: "h.sruthii@techins60.com", role: "student" },
  { learnerId: "T60-044", name: "Mathiyarasi C", email: "mathiyarasi.c@techins60.com", role: "student" },
  { learnerId: "T60-045", name: "S PAANKAJ RAAJ", email: "s.paankaj.raaj@techins60.com", role: "student" },
  { learnerId: "T60-046", name: "Sudarshan S", email: "sudarshan.s@techins60.com", role: "student" },
  { learnerId: "T60-047", name: "SANJAYKUMAR R", email: "sanjaykumar.r@techins60.com", role: "student" },
  { learnerId: "T60-048", name: "SHANMUGAPRIYAN S A", email: "shanmugapriyan.s.a@techins60.com", role: "student" },
  { learnerId: "T60-049", name: "Vishwa B", email: "vishwa.b@techins60.com", role: "student" },
  { learnerId: "T60-050", name: "TAMILARASAN M", email: "tamilarasan.m@techins60.com", role: "student" },
  { learnerId: "T60-051", name: "M.Padmashree", email: "m.padmashree@techins60.com", role: "student" },
  { learnerId: "T60-052", name: "S Sashwath Subramaniam", email: "s.sashwath.subramaniam@techins60.com", role: "student" },
  { learnerId: "T60-053", name: "Nifa Fathima O A", email: "nifa.fathima.o.a@techins60.com", role: "student" },
  { learnerId: "T60-054", name: "Vaishnavi S", email: "vaishnavi.s@techins60.com", role: "student" },
  { learnerId: "T60-055", name: "Monish G", email: "monish.g@techins60.com", role: "student" },
  { learnerId: "T60-056", name: "Yashwini K", email: "yashwini.k@techins60.com", role: "student" },
  { learnerId: "T60-057", name: "V.Sivakumar", email: "v.sivakumar@techins60.com", role: "student" },
  { learnerId: "T60-058", name: "S.Ritika", email: "s.ritika@techins60.com", role: "student" },
  { learnerId: "T60-059", name: "Sharan Sakthivel H", email: "sharan.sakthivel.h@techins60.com", role: "student" },
  { learnerId: "T60-060", name: "S. MOHAMMED Ayub", email: "s.mohammed.ayub@techins60.com", role: "student" },
  { learnerId: "T60-061", name: "Sujitha M S", email: "sujitha.m.s@techins60.com", role: "student" },
  { learnerId: "T60-062", name: "Kanimozhi J", email: "kanimozhi.j@techins60.com", role: "student" },
  { learnerId: "T60-063", name: "Yamini K", email: "yamini.k@techins60.com", role: "student" },
  { learnerId: "T60-064", name: "Raaghavi M", email: "raaghavi.m@techins60.com", role: "student" },
  { learnerId: "T60-065", name: "Dharshini P", email: "dharshini.p@techins60.com", role: "student" },
  { learnerId: "T60-066", name: "Dharun Shree C", email: "dharun.shree.c@techins60.com", role: "student" },
];

async function seedAllowedEmails() {
  if (!MONGODB_URI) {
    console.error("MONGODB_URI is required");
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log("Connected to MongoDB");
    
    const db = client.db(MONGODB_DB_NAME);
    const collection = db.collection("allowed_emails");
    
    // Create unique index on lowercase email
    await collection.createIndex({ email: 1 }, { unique: true });
    console.log("Index created on email field");
    
    let inserted = 0;
    let updated = 0;
    
    for (const entry of ALLOWED_EMAILS) {
      const normalizedEmail = entry.email.trim().toLowerCase();
      
      const result = await collection.updateOne(
        { email: normalizedEmail },
        {
          $setOnInsert: {
            email: normalizedEmail,
            name: entry.name,
            learnerId: entry.learnerId,
            role: entry.role,
            created_at: new Date().toISOString()
          }
        },
        { upsert: true }
      );
      
      if (result.upsertedCount > 0) {
        inserted++;
      } else if (result.matchedCount > 0) {
        updated++;
      }
    }
    
    const total = await collection.countDocuments();
    const managers = await collection.countDocuments({ role: "manager" });
    const students = await collection.countDocuments({ role: "student" });
    
    console.log(`\n✅ Seeding complete:`);
    console.log(`   Inserted: ${inserted}`);
    console.log(`   Existing: ${updated}`);
    console.log(`   Total: ${total}`);
    console.log(`   Managers: ${managers}`);
    console.log(`   Students: ${students}`);
    
    if (managers !== 4) {
      console.warn(`⚠️  Warning: Expected 4 managers, found ${managers}`);
    }
    if (students !== 66) {
      console.warn(`⚠️  Warning: Expected 66 students, found ${students}`);
    }
    
  } catch (error) {
    console.error("Seeding error:", error);
    process.exit(1);
  } finally {
    await client.close();
    console.log("Connection closed");
  }
}

seedAllowedEmails();
