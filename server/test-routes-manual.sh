#!/bin/bash

# Manual Route Testing Script
# Run this after starting the server manually with: node server.js

BASE_URL="http://localhost:5000"

# Generate CEO token
CEO_TOKEN=$(node -e "
const jwt = require('jsonwebtoken');
require('dotenv').config();
const token = jwt.sign(
  { role: 'ceo', email: process.env.CEO_EMAIL },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);
console.log(token);
")

echo "=========================================="
echo "CEO ROUTE ACCESS TESTS"
echo "=========================================="
echo ""
echo "CEO Token: $CEO_TOKEN"
echo ""

# Test /api/activities
echo "1. Testing GET /api/activities (CEO)..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $CEO_TOKEN" "$BASE_URL/api/activities")
if [ "$STATUS" -eq "200" ]; then
  echo "   ✓ PASS (200)"
else
  echo "   ✗ FAIL ($STATUS)"
fi

# Test /api/missions
echo "2. Testing GET /api/missions (CEO)..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $CEO_TOKEN" "$BASE_URL/api/missions")
if [ "$STATUS" -eq "200" ]; then
  echo "   ✓ PASS (200)"
else
  echo "   ✗ FAIL ($STATUS)"
fi

# Test /api/performance
echo "3. Testing GET /api/performance (CEO)..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $CEO_TOKEN" "$BASE_URL/api/performance")
if [ "$STATUS" -eq "200" ]; then
  echo "   ✓ PASS (200)"
else
  echo "   ✗ FAIL ($STATUS)"
fi

# Test /api/audit-logs
echo "4. Testing GET /api/audit-logs (CEO)..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $CEO_TOKEN" "$BASE_URL/api/audit-logs?page=1&limit=50")
if [ "$STATUS" -eq "200" ]; then
  echo "   ✓ PASS (200)"
else
  echo "   ✗ FAIL ($STATUS)"
fi

# Test /api/students
echo "5. Testing GET /api/students (CEO)..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $CEO_TOKEN" "$BASE_URL/api/students")
if [ "$STATUS" -eq "200" ]; then
  echo "   ✓ PASS (200)"
else
  echo "   ✗ FAIL ($STATUS)"
fi

# Test student-only route (should be 403)
echo "6. Testing GET /api/activities/me (CEO - should be blocked)..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $CEO_TOKEN" "$BASE_URL/api/activities/me")
if [ "$STATUS" -eq "403" ]; then
  echo "   ✓ PASS (403 - correctly blocked)"
else
  echo "   ✗ FAIL ($STATUS - should be 403)"
fi

echo ""
echo "=========================================="
echo "Test complete!"
echo "=========================================="
