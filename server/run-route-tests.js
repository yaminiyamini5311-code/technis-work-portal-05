/**
 * Automated Route Testing Script
 * Starts server, runs tests, reports results
 */

const { spawn } = require("child_process");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const path = require("path");
require("dotenv").config();

const BASE_URL = "http://localhost:5000";
const JWT_SECRET = process.env.JWT_SECRET;
const CEO_EMAIL = process.env.CEO_EMAIL;

let serverProcess = null;

// Generate tokens
function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });
}

const tokens = {
  ceo: generateToken({ role: "ceo", email: CEO_EMAIL }),
  admin: generateToken({ id: "675e7e8b9c1d2e3f4a5b6c7d", role: "admin" }),
  manager: generateToken({ id: "675e7e8b9c1d2e3f4a5b6c7e", role: "manager" }),
  student: generateToken({ id: "675e7e8b9c1d2e3f4a5b6c7f", role: "student" })
};

// Test configuration
const tests = [
  // Shared READ routes
  { name: "CEO → /api/activities", url: "/api/activities", token: "ceo", expect: 200 },
  { name: "Manager → /api/activities", url: "/api/activities", token: "manager", expect: 200 },
  { name: "Admin → /api/activities", url: "/api/activities", token: "admin", expect: 200 },
  { name: "Student → /api/activities", url: "/api/activities", token: "student", expect: 403 },
  
  { name: "CEO → /api/missions", url: "/api/missions", token: "ceo", expect: 200 },
  { name: "Manager → /api/missions", url: "/api/missions", token: "manager", expect: 200 },
  { name: "Student → /api/missions", url: "/api/missions", token: "student", expect: 403 },
  
  { name: "CEO → /api/performance", url: "/api/performance", token: "ceo", expect: 200 },
  { name: "Manager → /api/performance", url: "/api/performance", token: "manager", expect: 200 },
  { name: "Student → /api/performance", url: "/api/performance", token: "student", expect: 403 },
  
  { name: "CEO → /api/audit-logs", url: "/api/audit-logs?page=1&limit=50", token: "ceo", expect: 200 },
  { name: "Admin → /api/audit-logs", url: "/api/audit-logs?page=1&limit=50", token: "admin", expect: 200 },
  { name: "Manager → /api/audit-logs", url: "/api/audit-logs?page=1&limit=50", token: "manager", expect: 403 },
  
  { name: "CEO → /api/students", url: "/api/students", token: "ceo", expect: 200 },
  { name: "Manager → /api/students", url: "/api/students", token: "manager", expect: 200 },
  { name: "Student → /api/students", url: "/api/students", token: "student", expect: 403 },
  
  { name: "CEO → /api/admin/stats", url: "/api/admin/stats", token: "ceo", expect: 200 },
  { name: "Manager → /api/admin/stats", url: "/api/admin/stats", token: "manager", expect: 200 },
  { name: "Student → /api/admin/stats", url: "/api/admin/stats", token: "student", expect: 403 },
  
  // Student-only routes (CEO should be blocked)
  { name: "CEO → /api/activities/me", url: "/api/activities/me", token: "ceo", expect: 403 },
  { name: "Student → /api/activities/me", url: "/api/activities/me", token: "student", expect: 200 },
  
  { name: "CEO → /api/tasks/my", url: "/api/tasks/my", token: "ceo", expect: 403 },
  { name: "Student → /api/tasks/my", url: "/api/tasks/my", token: "student", expect: 200 },
  
  { name: "CEO → /api/student/dashboard", url: "/api/student/dashboard", token: "ceo", expect: 403 },
  { name: "Admin → /api/student/dashboard", url: "/api/student/dashboard", token: "admin", expect: 403 },
  { name: "Student → /api/student/dashboard", url: "/api/student/dashboard", token: "student", expect: 200 },
];

async function waitForServer(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await axios.get(`${BASE_URL}/api/auth/me`, { 
        headers: { Authorization: `Bearer ${tokens.ceo}` },
        timeout: 1000 
      });
      return true;
    } catch (error) {
      if (i < maxAttempts - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  return false;
}

async function runTest(test) {
  try {
    const response = await axios.get(`${BASE_URL}${test.url}`, {
      headers: { Authorization: `Bearer ${tokens[test.token]}` },
      validateStatus: () => true,
      timeout: 5000
    });
    
    const passed = response.status === test.expect;
    return {
      ...test,
      actual: response.status,
      passed,
      message: passed ? "✓ PASS" : `✗ FAIL (expected ${test.expect}, got ${response.status})`
    };
  } catch (error) {
    return {
      ...test,
      actual: "ERROR",
      passed: false,
      message: `✗ ERROR: ${error.message}`
    };
  }
}

async function runAllTests() {
  console.log("\n" + "=".repeat(80));
  console.log("AUTOMATED ROUTE TESTING");
  console.log("=".repeat(80) + "\n");
  
  console.log("Starting server...");
  serverProcess = spawn("node", ["server.js"], {
    cwd: __dirname,
    stdio: ["ignore", "pipe", "pipe"]
  });
  
  serverProcess.stdout.on("data", (data) => {
    const output = data.toString();
    if (output.includes("Server running")) {
      console.log("✓ Server started");
    }
  });
  
  serverProcess.stderr.on("data", (data) => {
    // Suppress error output during testing
  });
  
  console.log("Waiting for server to be ready...");
  const serverReady = await waitForServer();
  
  if (!serverReady) {
    console.error("✗ Server failed to start");
    serverProcess.kill();
    process.exit(1);
  }
  
  console.log("✓ Server is ready\n");
  console.log("Running tests...\n");
  
  const results = [];
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    const result = await runTest(test);
    results.push(result);
    
    const color = result.passed ? "\x1b[32m" : "\x1b[31m";
    const reset = "\x1b[0m";
    console.log(`${color}${result.message}${reset} - ${result.name}`);
    
    if (result.passed) passed++;
    else failed++;
  }
  
  console.log("\n" + "=".repeat(80));
  console.log("TEST RESULTS");
  console.log("=".repeat(80));
  console.log(`Total: ${tests.length} | Passed: ${passed} | Failed: ${failed}`);
  
  if (failed > 0) {
    console.log("\n\x1b[31mFailed Tests:\x1b[0m");
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: expected ${r.expect}, got ${r.actual}`);
    });
  } else {
    console.log("\n\x1b[32m✓ All tests passed!\x1b[0m");
  }
  
  console.log("\n" + "=".repeat(80) + "\n");
  
  serverProcess.kill();
  return failed === 0;
}

runAllTests()
  .then(success => process.exit(success ? 0 : 1))
  .catch(error => {
    console.error("Test runner error:", error);
    if (serverProcess) serverProcess.kill();
    process.exit(1);
  });
