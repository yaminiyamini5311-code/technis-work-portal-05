/**
 * TECHINS 60 Student Approval Script
 * 
 * This script reads the TECHINS_60_Master_Credentials.xlsx file and:
 * 1. Activates students whose email+password match the Excel
 * 2. Creates missing students from the Excel
 * 3. Deactivates students not listed in the Excel
 * 
 * IDEMPOTENT: Can be run multiple times safely.
 * 
 * Usage: node approve-techins60-students.js path/to/TECHINS_60_Master_Credentials.xlsx
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./database');

// Simple Excel/CSV parser
function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  
  if (ext === '.csv') {
    // Parse CSV
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    const headers = lines[0].split(',').map(h => h.trim());
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] ? values[index].trim() : '';
      });
      data.push(row);
    }
    return data;
  } else if (ext === '.xlsx' || ext === '.xls') {
    // Parse Excel
    const xlsx = require('xlsx');
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return xlsx.utils.sheet_to_json(sheet, { raw: false, defval: '' });
  } else {
    throw new Error('Unsupported file format. Use .csv, .xlsx, or .xls');
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('❌ Usage: node approve-techins60-students.js <path-to-excel-file>');
    console.error('   Example: node approve-techins60-students.js ../TECHINS_60_Master_Credentials.xlsx');
    process.exit(1);
  }

  const excelPath = args[0];
  
  if (!fs.existsSync(excelPath)) {
    console.error(`❌ Excel file not found: ${excelPath}`);
    process.exit(1);
  }

  console.log('📋 TECHINS 60 Student Approval Script');
  console.log('=====================================\n');
  console.log(`📂 Reading Excel file: ${excelPath}`);

  let rows;
  try {
    rows = parseFile(excelPath);
  } catch (error) {
    console.error(`❌ Failed to parse file: ${error.message}`);
    console.error('   Make sure xlsx package is installed: npm install xlsx');
    process.exit(1);
  }

  console.log(`✓ Found ${rows.length} rows in Excel\n`);

  // Parse and validate Excel data
  const approvedStudents = [];
  const errors = [];
  const emailsSeen = new Set();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // +2 because Excel is 1-indexed and has header

    // Extract fields (handle various column name formats)
    const email = String(row['Portal Email'] || row['email'] || '').trim().toLowerCase();
    const password = String(row['Temporary Password'] || row['password'] || '').trim();
    const name = String(row['Name'] || row['name'] || '').trim();
    const learnerId = String(row['Learner ID'] || row['id'] || '').trim();

    // Skip empty rows
    if (!email && !password && !name) {
      continue;
    }

    // Validate required fields
    if (!email) {
      errors.push(`Row ${rowNum}: Missing email`);
      continue;
    }

    if (!password) {
      errors.push(`Row ${rowNum}: Missing password for ${email}`);
      continue;
    }

    if (!name) {
      errors.push(`Row ${rowNum}: Missing name for ${email}`);
      continue;
    }

    // Check for duplicates
    if (emailsSeen.has(email)) {
      errors.push(`Row ${rowNum}: Duplicate email ${email}`);
      continue;
    }

    emailsSeen.add(email);

    // Note: Passwords in Excel are plain text, we'll hash them
    approvedStudents.push({
      email,
      password, // Will be hashed before storage
      name,
      learnerId,
      rowNum
    });
  }

  console.log(`✓ Parsed ${approvedStudents.length} valid student records`);
  
  if (errors.length > 0) {
    console.log(`\n⚠️  Found ${errors.length} errors:`);
    errors.forEach(err => console.log(`   ${err}`));
    console.log();
  }

  if (approvedStudents.length === 0) {
    console.error('❌ No valid student records found in Excel. Aborting.');
    process.exit(1);
  }

  // Process students
  console.log('\n🔄 Processing students...\n');

  let created = 0;
  let updated = 0;
  let activated = 0;
  let deactivated = 0;

  // Process each approved student
  for (const student of approvedStudents) {
    const { email, password, name } = student;

    // Check if user exists
    const existing = db.prepare(
      'SELECT id, password, active, name FROM users WHERE LOWER(email) = ?'
    ).get(email);

    // Hash the password from Excel
    const hashedPassword = await bcrypt.hash(password, 12);

    if (existing) {
      // Update existing user
      db.prepare(`
        UPDATE users 
        SET password = ?, 
            name = ?, 
            role = 'student', 
            active = 1,
            program = 'techins 60'
        WHERE id = ?
      `).run(hashedPassword, name, existing.id);

      if (existing.active === 0) {
        console.log(`   ✓ Activated: ${email}`);
        activated++;
      } else {
        console.log(`   ✓ Updated: ${email}`);
        updated++;
      }
    } else {
      // Create new user
      db.prepare(`
        INSERT INTO users (name, email, password, role, department, program, active)
        VALUES (?, ?, ?, 'student', 'Techins', 'techins 60', 1)
      `).run(name, email, hashedPassword);

      console.log(`   ✓ Created: ${email}`);
      created++;
    }
  }

  // Deactivate students not in the Excel
  const approvedEmails = approvedStudents.map(s => s.email);
  const placeholders = approvedEmails.map(() => '?').join(',');
  
  const deactivateQuery = `
    UPDATE users 
    SET active = 0 
    WHERE LOWER(role) = 'student' 
      AND active = 1 
      AND LOWER(email) NOT IN (${placeholders})
  `;
  
  const deactivateResult = db.prepare(deactivateQuery).run(...approvedEmails);
  deactivated = deactivateResult.changes;

  if (deactivated > 0) {
    const deactivatedUsers = db.prepare(`
      SELECT email FROM users 
      WHERE LOWER(role) = 'student' 
        AND active = 0 
        AND LOWER(email) NOT IN (${placeholders})
    `).all(...approvedEmails);

    console.log(`\n⚠️  Deactivated ${deactivated} students not in Excel:`);
    deactivatedUsers.slice(0, 10).forEach(u => console.log(`   - ${u.email}`));
    if (deactivatedUsers.length > 10) {
      console.log(`   ... and ${deactivatedUsers.length - 10} more`);
    }
  }

  // Summary
  console.log('\n=====================================');
  console.log('📊 SUMMARY');
  console.log('=====================================');
  console.log(`✓ Created: ${created} new students`);
  console.log(`✓ Updated: ${updated} existing students`);
  console.log(`✓ Activated: ${activated} previously inactive students`);
  console.log(`⚠️  Deactivated: ${deactivated} students not in Excel`);
  console.log(`📋 Total approved students: ${approvedStudents.length}`);
  
  if (errors.length > 0) {
    console.log(`⚠️  Errors/warnings: ${errors.length}`);
  }
  
  console.log('\n✅ Student approval process completed successfully!');
  console.log('\n💡 Note: Passwords are never logged for security.');
}

main().catch(error => {
  console.error('\n❌ Fatal error:', error.message);
  console.error(error.stack);
  process.exit(1);
});
