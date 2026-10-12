/**
 * E2E verification against the running dev server (http://localhost:5000).
 * Verifies the login/approval fix. Never prints credentials, hashes or tokens.
 *
 *   node e2e-verify-auth-fix.js
 */
require('dotenv').config();
const axios = require('axios');

const API = process.env.TEST_API || 'http://localhost:5000';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@techins.com';
const ADMIN_PW = process.env.ADMIN_PASSWORD || 'Admin@123';
const CEO_EMAIL = (process.env.CEO_EMAIL || '').trim().toLowerCase();
const CEO_PW = process.env.CEO_PASSWORD || '';
// one master-list student credential (from the gitignored CSV) — used in memory only
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

async function api(method, url, { token, body } = {}) {
  try {
    const res = await axios({ method, url: API + url, data: body,
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' } });
    return { status: res.status, body: res.data };
  } catch (e) {
    return { status: e.response?.status || 0, body: e.response?.data || { message: e.message } };
  }
}

function firstCsvRow() {
  const lines = fs.readFileSync(path.join(__dirname, '..', 'TECHINS_60_Master_Credentials.csv'), 'utf8')
    .replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',');
  const cells = lines[1].split(',');
  const row = {};
  header.forEach((h, i) => { row[h.trim()] = (cells[i] || '').trim(); });
  return { email: row['Portal Email'], password: row['Temporary Password'] };
}

async function main() {
  console.log('── E2E: login / approval fix ──────────────────────────');
  const stamp = Date.now();
  const testEmail = `e2e.${stamp}@example.com`;
  const testPw = 'E2eTest@12345';

  // 0. Control: admin + CEO login
  const adminLogin = await api('POST', '/api/auth/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PW } });
  ok('Admin logs in', adminLogin.status === 200);
  const adminToken = adminLogin.body?.token;
  const ceoLogin = await api('POST', '/api/auth/login', { body: { email: CEO_EMAIL, password: CEO_PW } });
  ok('CEO logs in', ceoLogin.status === 200);

  // 1. Existing (repaired) student logs in and reaches the Student Portal
  const csv = firstCsvRow();
  const stuLogin = await api('POST', '/api/auth/login', { body: { email: csv.email, password: csv.password } });
  ok('Existing student logs in with current credentials', stuLogin.status === 200, `status=${stuLogin.status} ${stuLogin.body?.message || ''}`);
  const dash = await api('GET', '/api/student/dashboard', { token: stuLogin.body?.token });
  ok('Student reaches the Student Portal (dashboard 200)', dash.status === 200, `status=${dash.status}`);
  const stuToken = stuLogin.body?.token;

  // 2. New signup starts pending: blocked at login, appears in approval list
  const signup = await api('POST', '/api/auth/signup', { body: { name: 'E2E Pending Student', email: testEmail, password: testPw, role: 'student', phone: '999', batchId: undefined } });
  // batchId required for students — fetch a real batch first if needed
  let pendingUserId = null;
  if (signup.status === 400 && /[Bb]atch/.test(signup.body?.message || '')) {
    const batches = await api('GET', '/api/batches');
    const bid = (batches.body?.batches || [])[0]?.id;
    const signup2 = await api('POST', '/api/auth/signup', { body: { name: 'E2E Pending Student', email: testEmail, password: testPw, role: 'student', phone: '999', batchId: bid } });
    ok('New student signup created (201)', signup2.status === 201, JSON.stringify(signup2.body));
    ok('Signup message says pending', /pending/i.test(signup2.body?.message || ''));
  } else {
    ok('New student signup created (201)', signup.status === 201, JSON.stringify(signup.body));
  }

  const blockedLogin = await api('POST', '/api/auth/login', { body: { email: testEmail, password: testPw } });
  ok('Genuinely pending user is blocked at login (401)', blockedLogin.status === 401, `status=${blockedLogin.status} msg=${blockedLogin.body?.message}`);

  const pendingList = await api('GET', '/api/admin/pending-registrations', { token: adminToken });
  const pendingRow = (pendingList.body?.pending || []).find(p => p.email === testEmail);
  ok('New signup appears in the CEO approval list', Boolean(pendingRow));
  pendingUserId = pendingRow?.id;

  // 3. After approval it can log in and reach the portal
  const approve = await api('POST', `/api/admin/approve-registration/${pendingUserId}`, { token: adminToken });
  ok('Admin approves registration (200)', approve.status === 200, JSON.stringify(approve.body));
  const afterLogin = await api('POST', '/api/auth/login', { body: { email: testEmail, password: testPw } });
  ok('Student can log in only after approval', afterLogin.status === 200, `status=${afterLogin.status} ${afterLogin.body?.message || ''}`);
  const dash2 = await api('GET', '/api/student/dashboard', { token: afterLogin.body?.token });
  ok('Approved student reaches the portal', dash2.status === 200);

  // 4. Deactivated user still blocked
  const deact = await api('PATCH', `/api/admin/students/${pendingUserId}/deactivate`, { token: adminToken });
  ok('Admin deactivates the test student (200)', deact.status === 200, JSON.stringify(deact.body));
  const deactLogin = await api('POST', '/api/auth/login', { body: { email: testEmail, password: testPw } });
  ok('Deactivated user is still blocked (401)', deactLogin.status === 401, `status=${deactLogin.status} msg=${deactLogin.body?.message}`);

  // 5. Duplicate-email signup rejected; login does not trigger the duplicate error
  const batches = await api('GET', '/api/batches');
  const bid = (batches.body?.batches || [])[0]?.id;
  const dup = await api('POST', '/api/auth/signup', { body: { name: 'Dup', email: testEmail.toUpperCase(), password: testPw, role: 'student', phone: '999', batchId: bid } });
  ok('Duplicate-email signup rejected (409)', dup.status === 409, `status=${dup.status}`);
  const loginAgain = await api('POST', '/api/auth/login', { body: { email: testEmail, password: testPw });
  ok('Login never returns the duplicate error', loginAgain.status === 401 && !/already exists/i.test(loginAgain.body?.message || ''), `status=${loginAgain.status}`);

  // 6. Students cannot access CEO/manager routes
  const adminRoute = await api('GET', '/api/admin/students', { token: stuToken });
  ok('Student blocked from CEO/admin routes (403)', adminRoute.status === 403, `status=${adminRoute.status}`);
  const pendingRoute = await api('GET', '/api/admin/pending-registrations', { token: stuToken });
  ok('Student blocked from approval list (403)', pendingRoute.status === 403, `status=${pendingRoute.status}`);
  const createRoute = await api('POST', '/api/admin/students', { token: stuToken, body: { name: 'X', email: `x.${stamp}@example.com`, password: 'Password123!' } });
  ok('Student cannot create students (403)', createRoute.status === 403, `status=${createRoute.status}`);

  // Wrong-password message stays generic (no enumeration)
  const wrong = await api('POST', '/api/auth/login', { body: { email: csv.email, password: 'definitely-wrong' } });
  ok('Wrong password → generic message', wrong.status === 401 && wrong.body?.message === 'Invalid email or password');

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('E2E ERROR:', e.message); process.exit(1); });
