/**
 * READ-ONLY full login sweep: every CSV student logs in, then reaches the portal.
 * Prints outcomes only (no credentials).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const API = process.env.TEST_API || 'http://localhost:5000';

function readCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(l => {
    const cells = l.split(',');
    const o = {};
    header.forEach((h, i) => { o[h] = (cells[i] || '').trim(); });
    return o;
  }).filter(r => r['Portal Email'] && r['Temporary Password']);
}

async function main() {
  const rows = readCsv(path.join(__dirname, '..', 'TECHINS_60_Master_Credentials.csv'));
  let ok = 0, fail = 0, portalOk = 0, portalFail = 0;
  const failures = [];
  for (const r of rows) {
    const email = r['Portal Email'], pw = r['Temporary Password'];
    try {
      const res = await axios.post(`${API}/api/auth/login`, { email, password: pw });
      ok++;
      try {
        const dash = await axios.get(`${API}/api/student/dashboard`, { headers: { Authorization: `Bearer ${res.data.token}` } });
        if (dash.status === 200) portalOk++; else { portalFail++; failures.push(`${email} login-ok portal-${dash.status}`); }
      } catch (e2) {
        portalFail++;
        failures.push(`${email} login-ok portal-${e2.response?.status} "${e2.response?.data?.message}"`);
      }
    } catch (e) {
      fail++;
      failures.push(`${email} login-${e.response?.status} "${e.response?.data?.message}"`);
    }
  }
  console.log(`sweep: total=${rows.length} login_ok=${ok} login_fail=${fail} portal_ok=${portalOk} portal_fail=${portalFail}`);
  failures.slice(0, 20).forEach(f => console.log('  FAIL: ' + f));
  if (failures.length > 20) console.log(`  ... and ${failures.length - 20} more`);
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
