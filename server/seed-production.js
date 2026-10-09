const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const db = require('./database');

const excelPath = process.argv[2] || process.env.EXCEL_PATH;

if (!excelPath) {
  console.error('Error: Excel path must be provided as CLI argument or EXCEL_PATH env var');
  console.error('Usage: node seed-production.js <path-to-excel-file>');
  console.error('Or: EXCEL_PATH=<path> node seed-production.js');
  process.exit(1);
}

async function seedProduction() {
  try {
    console.log('Reading Excel file...');
    const workbook = XLSX.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { defval: null });

    console.log(`Found ${data.length} student records in Excel file`);

    const validStudentEmails = new Set();
    let studentsUpdated = 0;
    let studentsInserted = 0;
    let studentsDeactivated = 0;
    let managersInserted = 0;
    let errors = 0;

    for (const row of data) {
      try {
        const name = row['Name'];
        const email = row['Portal Email'];
        const password = row['Temporary Password'];

        if (!name || !email || !password) {
          console.log(`Skipping row with missing data`);
          errors++;
          continue;
        }

        const emailNormalized = email.trim().toLowerCase();
        const nameNormalized = name.trim();
        const passwordHash = await bcrypt.hash(password, 10);

        validStudentEmails.add(emailNormalized);

        const existingUser = db
          .prepare(`
            SELECT id, role, active
            FROM users
            WHERE LOWER(TRIM(email)) = ?
            LIMIT 1
          `)
          .get(emailNormalized);

        if (existingUser) {
          if (String(existingUser.role).toLowerCase() === 'student') {
            db
              .prepare(`
                UPDATE users
                SET name = ?,
                    password = ?,
                    role = 'student',
                    department = 'edutins',
                    program = 'techins 60',
                    active = 1
                WHERE id = ?
              `)
              .run(nameNormalized, passwordHash, existingUser.id);
            
            console.log(`Updated student: ${emailNormalized} (ID: ${existingUser.id})`);
            studentsUpdated++;
          } else {
            console.log(`Skipping ${emailNormalized} - existing role is ${existingUser.role}, not student`);
          }
        } else {
          const result = db
            .prepare(`
              INSERT INTO users (name, email, password, role, department, program, active)
              VALUES (?, ?, ?, 'student', 'edutins', 'techins 60', 1)
            `)
            .run(nameNormalized, emailNormalized, passwordHash);
          
          console.log(`Inserted student: ${emailNormalized} (ID: ${result.lastInsertRowid})`);
          studentsInserted++;
        }
      } catch (error) {
        console.error(`Error processing row`, error.message);
        errors++;
      }
    }

    const managers = [
      { email: 'manager1@techins.com', password: 'manager1@123', name: 'Manager 1' },
      { email: 'manager2@techins.com', password: 'manager2@456', name: 'Manager 2' },
      { email: 'manager3@techins.com', password: 'manager3@789', name: 'Manager 3' }
    ];

    for (const manager of managers) {
      const emailNormalized = manager.email.trim().toLowerCase();
      const existingUser = db
        .prepare(`
          SELECT id, role
          FROM users
          WHERE LOWER(TRIM(email)) = ?
          LIMIT 1
        `)
        .get(emailNormalized);

      if (!existingUser) {
        const passwordHash = await bcrypt.hash(manager.password, 10);
        const result = db
          .prepare(`
            INSERT INTO users (name, email, password, role, department, active)
            VALUES (?, ?, ?, 'manager', 'Techins', 1)
          `)
          .run(manager.name, emailNormalized, passwordHash);
        
        console.log(`Inserted manager: ${emailNormalized} (ID: ${result.lastInsertRowid})`);
        managersInserted++;
      } else {
        console.log(`Manager ${emailNormalized} already exists (ID: ${existingUser.id}), skipping`);
      }
    }

    const allStudents = db
      .prepare(`
        SELECT id, email, role
        FROM users
        WHERE LOWER(role) = 'student'
      `)
      .all();

    for (const student of allStudents) {
      const emailNormalized = student.email.trim().toLowerCase();
      if (!validStudentEmails.has(emailNormalized)) {
        db
          .prepare(`
            UPDATE users
            SET active = 0
            WHERE id = ?
          `)
          .run(student.id);
        
        console.log(`Deactivated student not in Excel: ${emailNormalized} (ID: ${student.id})`);
        studentsDeactivated++;
      }
    }

    console.log('\n=== Seed Summary ===');
    console.log(`Students in Excel: ${data.length}`);
    console.log(`Students updated: ${studentsUpdated}`);
    console.log(`Students inserted: ${studentsInserted}`);
    console.log(`Students deactivated: ${studentsDeactivated}`);
    console.log(`Managers inserted: ${managersInserted}`);
    console.log(`Errors: ${errors}`);

    const activeStudentCount = db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM users
        WHERE LOWER(role) = 'student'
        AND active = 1
      `)
      .get();

    console.log(`\nTotal active students in database: ${activeStudentCount.count}`);

    console.log('\nSeed completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Fatal error during seed:', error);
    process.exit(1);
  }
}

seedProduction();
