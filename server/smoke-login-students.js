/**
 * READ-ONLY login smoke test against the running dev server.
 * Uses credentials from the master CSV in memory only; prints outcomes only.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const API = process.env.TEST_API || 'http://localhost:5000';

function readCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',');
  const rows = lines.slice(1).map(l => {
    const cells = l.split(',');
    const o = {};
    header.forEach((h, i) => { o[h.trim()] = (cells[i] || '').trim(); });
    return o;
  });
  return rows;
}

async function main() {
  const csv = path.join(__dirname, '..', 'TECHINS_60_Master_Credentials.csv');
  const rows = readCsv(csv).filter(r => r['Portal Email'] && r['Temporary Password']);
  console.log(`csv rows with credentials: ${rows.length}`);
  const sample = rows.slice(0, 6);
  for (const r of sample) {
    const email = r['Portal Email'];
    const pw = r['Temporary Password'];
    try {
      const res = await axios.post(`${API}/api/auth/login`, { email, password: pw });
      console.log(`LOGIN OK   | user=${res.data.user.name} role=${res.data.user.role} reg=${res.data.user.registration_status}`);
    } catch (e) {
      const d = e.response?.data || {};
      console.log(`LOGIN FAIL | status=${e.response?.status} message="${d.message}" code=${d.code || '-'}`);
    }
  }
  // also a case-variant email to test normalization
  const first = rows[0];
  if (first) {
    const variant = first['Portal Email'].toUpperCase().replace('@', ' @');
    try {
      const res = await axios.post(`${API}/api/auth/login`, { email: variant, password: first['Temporary Password'] });
      console.log(`LOGIN OK (case/space variant) | role=${res.data.user.role}`);
    } catch (e) {
      console.log(`LOGIN FAIL (case/space variant) | status=${e.response?.status} message="${e.response?.data?.message}"`);
    }
  }
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
