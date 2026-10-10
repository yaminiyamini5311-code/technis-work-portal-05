#!/usr/bin/env node

/**
 * Environment Variable Verification Script
 * 
 * Run this before deploying to check if all required variables are set.
 * Usage: node verify-env.js
 */

require("dotenv").config();

console.log("╔═══════════════════════════════════════════════════════════════╗");
console.log("║         TECHINS Portal - Environment Verification            ║");
console.log("╚═══════════════════════════════════════════════════════════════╝");
console.log();

const REQUIRED = [
  { name: "JWT_SECRET", minLength: 32 },
  { name: "MONGODB_URI", pattern: /^mongodb(\+srv)?:\/\// },
];

const OPTIONAL = [
  "MONGODB_DB_NAME",
  "NODE_ENV",
  "FRONTEND_URL",
  "PORT",
  "APP_URL",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "ALLOWED_STUDENT_EMAILS",
];

let errors = 0;
let warnings = 0;

console.log("Required Variables:");
console.log("─".repeat(63));

REQUIRED.forEach(({ name, minLength, pattern }) => {
  const value = process.env[name];
  
  if (!value) {
    console.log(`❌ ${name.padEnd(20)} MISSING`);
    errors++;
  } else if (minLength && value.length < minLength) {
    console.log(`⚠️  ${name.padEnd(20)} TOO SHORT (min: ${minLength} chars)`);
    warnings++;
  } else if (pattern && !pattern.test(value)) {
    console.log(`⚠️  ${name.padEnd(20)} INVALID FORMAT`);
    warnings++;
  } else {
    const masked = value.substring(0, 10) + "***" + value.substring(value.length - 4);
    console.log(`✅ ${name.padEnd(20)} ${masked}`);
  }
});

console.log();
console.log("Optional Variables:");
console.log("─".repeat(63));

OPTIONAL.forEach((name) => {
  const value = process.env[name];
  
  if (!value) {
    console.log(`○  ${name.padEnd(20)} not set (using defaults)`);
  } else {
    const display = value.length > 30 
      ? value.substring(0, 20) + "..." + value.substring(value.length - 7)
      : value;
    console.log(`✓  ${name.padEnd(20)} ${display}`);
  }
});

console.log();
console.log("═".repeat(63));

if (errors > 0) {
  console.log(`❌ ${errors} critical error(s) found. Fix before deploying!`);
  console.log();
  console.log("To fix:");
  console.log("1. Copy .env.example to .env");
  console.log("2. Fill in the required values");
  console.log("3. For Vercel: Add these in Settings → Environment Variables");
  process.exit(1);
}

if (warnings > 0) {
  console.log(`⚠️  ${warnings} warning(s) found. Review before deploying.`);
  process.exit(0);
}

console.log("✅ All environment variables are properly configured!");
console.log();
console.log("Next steps:");
console.log("• For local dev: npm start");
console.log("• For Vercel: Add these variables in Settings → Environment Variables");
console.log("• After deployment: Test with /api/health endpoint");
process.exit(0);
