/**
 * seed-students.js
 *
 * Idempotent, synchronous student seeder.
 *
 * Data source when called from server.js: the STUDENT_SEED_DATA env var (CSV text).
 *
 * CLI (local use only — never commit a data file with credentials):
 *   node seed-students.js path/to/gitignored-local.csv
 *   STUDENT_SEED_DATA="<csv text>" node seed-students.js
 *
 * Rules:
 *   - Normalises emails (trim + lowercase).
 *   - Hashes passwords with bcrypt.hashSync (synchronous — safe at CommonJS startup).
 *   - For each listed student: creates if missing, otherwise updates password/role/active.
 *     Sets role=student, active=1, department=edutins, program=techins 60.
 *   - Sets active=0 for every role=student account NOT in the approved list.
 *   - Never touches Admin, CEO, or Manager accounts (rows with those roles are skipped).
 *   - Logs only counts (created / updated / deactivated), never passwords.
 */

const bcrypt = require('bcryptjs');
const db = require('./database');

const PROTECTED_ROLES = new Set(['admin', 'manager', 'ceo']);
const BCRYPT_ROUNDS = 10;

/**
 * Parse CSV with no header row.
 * Columns: LearnerID, Name, PortalEmail, TemporaryPassword
 * Splits on first 3 commas only so passwords that contain commas are handled safely.
 */
function parseCSV(csvText) {
  const students = [];
  const lines = csvText.replace(/\r/g, '').split('\n');

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const i1 = line.indexOf(',');
    const i2 = i1 >= 0 ? line.indexOf(',', i1 + 1) : -1;
    const i3 = i2 >= 0 ? line.indexOf(',', i2 + 1) : -1;
    if (i1 < 0 || i2 < 0 || i3 < 0) continue;

    const learnerId = line.slice(0, i1).trim();
    const name      = line.slice(i1 + 1, i2).trim();
    const email     = line.slice(i2 + 1, i3).trim();
    const password  = line.slice(i3 + 1).trim();

    if (!learnerId || !name || !email || !password) continue;
    students.push({ learnerId, name, email, password });
  }

  return students;
}

/**
 * Run the seed synchronously.
 * @param {string} csvText  Raw CSV content (no header row).
 */
function seedStudents(csvText) {
  const students = parseCSV(csvText);

  if (students.length === 0) {
    throw new Error('[seed-students] CSV parsed 0 records — aborting to protect existing students.');
  }

  console.log(`[seed-students] Parsed ${students.length} student records.`);

  const validEmails = new Set();
  let created = 0, updated = 0, skipped = 0, errors = 0;

  const findByEmail   = db.prepare('SELECT id, role FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1');
  const insertStudent = db.prepare(
    "INSERT INTO users (name, email, password, role, department, program, active) VALUES (?, ?, ?, 'student', 'edutins', 'techins 60', 1)"
  );
  const updateStudent = db.prepare(
    "UPDATE users SET name=?, password=?, role='student', department='edutins', program='techins 60', active=1 WHERE id=?"
  );

  for (const { name, email, password } of students) {
    try {
      const emailNorm = email.trim().toLowerCase();
      const nameNorm  = name.trim();
      validEmails.add(emailNorm);

      const hash     = bcrypt.hashSync(password, BCRYPT_ROUNDS);
      const existing = findByEmail.get(emailNorm);

      if (existing) {
        const role = String(existing.role).toLowerCase();
        if (PROTECTED_ROLES.has(role)) {
          console.log(`[seed-students] SKIP protected account (${role}): ${emailNorm}`);
          skipped++;
          continue;
        }
        updateStudent.run(nameNorm, hash, existing.id);
        updated++;
      } else {
        insertStudent.run(nameNorm, emailNorm, hash);
        created++;
      }
    } catch (err) {
      console.error(`[seed-students] Error processing ${email}: ${err.message}`);
      errors++;
    }
  }

  // Deactivate any student not in the approved list
  const allStudents = db.prepare("SELECT id, email FROM users WHERE LOWER(role) = 'student'").all();
  let deactivated = 0;
  const deactivate = db.prepare('UPDATE users SET active=0 WHERE id=?');

  for (const row of allStudents) {
    if (!validEmails.has(String(row.email).trim().toLowerCase())) {
      deactivate.run(row.id);
      deactivated++;
    }
  }

  console.log('[seed-students] === Seed Summary ===');
  console.log(`[seed-students] Records in CSV  : ${students.length}`);
  console.log(`[seed-students] Created         : ${created}`);
  console.log(`[seed-students] Updated         : ${updated}`);
  console.log(`[seed-students] Deactivated     : ${deactivated}`);
  console.log(`[seed-students] Skipped (prot.) : ${skipped}`);
  console.log(`[seed-students] Errors          : ${errors}`);

  return { total: students.length, created, updated, deactivated, skipped, errors };
}

module.exports = { seedStudents };

/* ------------------------------------------------------------------
   CLI — local use only. Add your CSV file to .gitignore first.
   node seed-students.js path/to/students-seed-data.csv
   STUDENT_SEED_DATA="<csv text>" node seed-students.js
   ------------------------------------------------------------------ */
if (require.main === module) {
  const fs = require('fs');

  let csvText = process.env.STUDENT_SEED_DATA || null;

  if (!csvText && process.argv[2]) {
    const filePath = process.argv[2];
    if (!fs.existsSync(filePath)) {
      console.error(`[seed-students] File not found: ${filePath}`);
      process.exit(1);
    }
    csvText = fs.readFileSync(filePath, 'utf8');
  }

  if (!csvText) {
    console.error('[seed-students] Provide CSV via STUDENT_SEED_DATA env var or a file path argument.');
    console.error('  node seed-students.js <path-to-csv>');
    process.exit(1);
  }

  try {
    seedStudents(csvText);
    console.log('[seed-students] Completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('[seed-students] FATAL:', err.message);
    process.exit(1);
  }
}

