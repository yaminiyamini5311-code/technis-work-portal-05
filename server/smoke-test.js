/**
 * Smoke Test - Verify server starts and basic routes work
 */

const axios = require("axios");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const BASE_URL = "http://localhost:5000";
const JWT_SECRET = process.env.JWT_SECRET;
const CEO_EMAIL = process.env.CEO_EMAIL;

const ceoToken = jwt.sign({ role: "ceo", email: CEO_EMAIL }, JWT_SECRET, { expiresIn: "1h" });

async function smokeTest() {
  console.log("\n" + "=".repeat(80));
  console.log("SMOKE TEST - Server Health Check");
  console.log("=".repeat(80) + "\n");

  const tests = [
    {
      name: "GET /api/health",
      test: async () => {
        try {
          const response = await axios.get(`${BASE_URL}/api/health`, { timeout: 5000, validateStatus: () => true });
          return { status: response.status, success: response.status === 200 || response.status === 404 };
        } catch (error) {
          return { status: "ERROR", success: false, error: error.message };
        }
      }
    },
    {
      name: "OPTIONS /api/auth/login (CORS preflight)",
      test: async () => {
        try {
          const response = await axios.options(`${BASE_URL}/api/auth/login`, { timeout: 5000, validateStatus: () => true });
          return { status: response.status, success: response.status === 200 || response.status === 204 };
        } catch (error) {
          return { status: "ERROR", success: false, error: error.message };
        }
      }
    },
    {
      name: "GET /api/activities (CEO token)",
      test: async () => {
        try {
          const response = await axios.get(`${BASE_URL}/api/activities`, {
            headers: { Authorization: `Bearer ${ceoToken}` },
            timeout: 5000,
            validateStatus: () => true
          });
          return { status: response.status, success: response.status === 200, data: response.data };
        } catch (error) {
          return { status: "ERROR", success: false, error: error.message };
        }
      }
    },
    {
      name: "GET /api/missions (CEO token)",
      test: async () => {
        try {
          const response = await axios.get(`${BASE_URL}/api/missions`, {
            headers: { Authorization: `Bearer ${ceoToken}` },
            timeout: 5000,
            validateStatus: () => true
          });
          return { status: response.status, success: response.status === 200, data: response.data };
        } catch (error) {
          return { status: "ERROR", success: false, error: error.message };
        }
      }
    },
    {
      name: "GET /api/performance (CEO token)",
      test: async () => {
        try {
          const response = await axios.get(`${BASE_URL}/api/performance`, {
            headers: { Authorization: `Bearer ${ceoToken}` },
            timeout: 5000,
            validateStatus: () => true
          });
          return { status: response.status, success: response.status === 200, data: response.data };
        } catch (error) {
          return { status: "ERROR", success: false, error: error.message };
        }
      }
    },
    {
      name: "GET /api/audit-logs (CEO token)",
      test: async () => {
        try {
          const response = await axios.get(`${BASE_URL}/api/audit-logs?page=1&limit=50`, {
            headers: { Authorization: `Bearer ${ceoToken}` },
            timeout: 5000,
            validateStatus: () => true
          });
          return { status: response.status, success: response.status === 200, data: response.data };
        } catch (error) {
          return { status: "ERROR", success: false, error: error.message };
        }
      }
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    process.stdout.write(`${test.name}... `);
    const result = await test.test();
    
    if (result.success) {
      console.log(`\x1b[32m✓ PASS\x1b[0m (${result.status})`);
      passed++;
    } else {
      console.log(`\x1b[31m✗ FAIL\x1b[0m (${result.status})`);
      if (result.error) console.log(`  Error: ${result.error}`);
      if (result.data) console.log(`  Response:`, JSON.stringify(result.data, null, 2).substring(0, 200));
      failed++;
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(80) + "\n");

  return failed === 0;
}

smokeTest()
  .then(success => process.exit(success ? 0 : 1))
  .catch(error => {
    console.error("Smoke test error:", error);
    process.exit(1);
  });
