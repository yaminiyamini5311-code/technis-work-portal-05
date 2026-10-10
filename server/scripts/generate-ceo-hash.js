#!/usr/bin/env node
/**
 * Generate bcrypt hash for CEO password
 * 
 * Usage:
 *   node scripts/generate-ceo-hash.js "your-password-here"
 * 
 * The script generates a bcrypt hash with cost factor 12 (high security).
 * Copy the output hash to your CEO_PASSWORD_HASH environment variable in Vercel.
 * 
 * SECURITY:
 * - Never commit the plaintext password to version control
 * - Never log the plaintext password in production
 * - Store only the hash in environment variables
 */

const bcrypt = require("bcryptjs");

async function generateHash() {
  // Get password from command line argument
  const password = process.argv[2];
  
  if (!password) {
    console.error("Error: Password argument required");
    console.error("Usage: node scripts/generate-ceo-hash.js \"your-password-here\"");
    process.exit(1);
  }
  
  if (password.length < 8) {
    console.error("Warning: Password should be at least 8 characters for security");
  }
  
  try {
    // Generate bcrypt hash with cost factor 12 (same as signup)
    const hash = await bcrypt.hash(password, 12);
    
    // Output only the hash (can be piped or copied)
    console.log(hash);
  } catch (error) {
    console.error("Error generating hash:", error.message);
    process.exit(1);
  }
}

generateHash();
