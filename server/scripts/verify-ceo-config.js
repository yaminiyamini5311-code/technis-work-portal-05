#!/usr/bin/env node
/**
 * Verify CEO configuration without starting the server
 * 
 * Usage:
 *   node scripts/verify-ceo-config.js
 * 
 * Checks:
 * - .env file exists and loads properly
 * - CEO_EMAIL is set
 * - CEO_PASSWORD_HASH is set and valid bcrypt format
 * - JWT_SECRET is set
 * 
 * SECURITY: Never logs actual values, only validation status
 */

require("dotenv").config();
const bcrypt = require("bcryptjs");

function isBcryptHash(str) {
  // Bcrypt hashes start with $2a$, $2b$, or $2y$ followed by cost and salt/hash
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(str);
}

async function verifyConfig() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("CEO CONFIGURATION VERIFICATION");
  console.log("═══════════════════════════════════════════════════════════\n");
  
  let allValid = true;
  
  // Check CEO_EMAIL
  const ceoEmail = process.env.CEO_EMAIL;
  if (!ceoEmail) {
    console.log("❌ CEO_EMAIL: NOT SET");
    console.log("   Set this to the CEO's email address (e.g., ceo@techins.com)\n");
    allValid = false;
  } else {
    const normalized = ceoEmail.trim().toLowerCase();
    console.log("✓ CEO_EMAIL: SET");
    console.log(`   Length: ${ceoEmail.length} characters`);
    console.log(`   Normalized: ${normalized.length} characters`);
    if (ceoEmail !== normalized) {
      console.log("   ⚠️  WARNING: Email has whitespace or uppercase - will be normalized");
    }
    console.log();
  }
  
  // Check CEO_PASSWORD_HASH
  const ceoPasswordHash = process.env.CEO_PASSWORD_HASH;
  if (!ceoPasswordHash) {
    console.log("❌ CEO_PASSWORD_HASH: NOT SET");
    console.log("   Generate with: node scripts/generate-ceo-hash.js \"your-password\"\n");
    allValid = false;
  } else {
    console.log("✓ CEO_PASSWORD_HASH: SET");
    console.log(`   Length: ${ceoPasswordHash.length} characters`);
    
    if (!isBcryptHash(ceoPasswordHash.trim())) {
      console.log("   ❌ INVALID: Not a valid bcrypt hash format");
      console.log("   Expected format: $2b$12$... (60 characters)");
      console.log("   Generate with: node scripts/generate-ceo-hash.js \"your-password\"\n");
      allValid = false;
    } else {
      console.log("   ✓ Valid bcrypt hash format");
      
      // Extract cost factor
      const costMatch = ceoPasswordHash.match(/^\$2[aby]\$(\d{2})\$/);
      if (costMatch) {
        console.log(`   Cost factor: ${costMatch[1]} (recommended: 12)`);
      }
      console.log();
    }
  }
  
  // Check JWT_SECRET
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    console.log("❌ JWT_SECRET: NOT SET");
    console.log("   Generate with: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"\n");
    allValid = false;
  } else {
    console.log("✓ JWT_SECRET: SET");
    console.log(`   Length: ${jwtSecret.length} characters`);
    if (jwtSecret.length < 32) {
      console.log("   ⚠️  WARNING: Secret is short, consider using at least 64 characters");
    }
    console.log();
  }
  
  // Check MONGODB_URI
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.log("❌ MONGODB_URI: NOT SET");
    console.log("   Required for database connection\n");
    allValid = false;
  } else {
    console.log("✓ MONGODB_URI: SET");
    console.log(`   Length: ${mongoUri.length} characters`);
    if (mongoUri.includes(" ")) {
      console.log("   ⚠️  WARNING: URI contains spaces - will be trimmed");
    }
    console.log();
  }
  
  // Check CORS_ORIGINS
  const corsOrigins = process.env.CORS_ORIGINS;
  if (!corsOrigins) {
    console.log("⚠️  CORS_ORIGINS: NOT SET");
    console.log("   CORS will use localhost only. Set for production frontend URL\n");
  } else {
    console.log("✓ CORS_ORIGINS: SET");
    const origins = corsOrigins.split(",").map(o => o.trim());
    console.log(`   Allowed origins: ${origins.length}`);
    origins.forEach(o => console.log(`   - ${o}`));
    console.log();
  }
  
  // Summary
  console.log("═══════════════════════════════════════════════════════════");
  if (allValid) {
    console.log("✓ ALL REQUIRED VARIABLES SET");
    console.log("\nYou can now start the server with: npm start");
  } else {
    console.log("❌ CONFIGURATION INCOMPLETE");
    console.log("\nFix the issues above before starting the server");
    process.exit(1);
  }
  console.log("═══════════════════════════════════════════════════════════");
}

verifyConfig().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
