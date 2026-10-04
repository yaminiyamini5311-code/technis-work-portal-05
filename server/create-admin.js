const bcrypt = require("bcryptjs");
const db = require("./database");

async function main() {
  const [
    emailArg,
    passwordArg,
    nameArg = "TECHINS User",
    roleArg = "student"
  ] = process.argv.slice(2);

  if (!emailArg || !passwordArg) {
    console.error(
      "Usage: node create-admin.js <email> <password> [name] [role]"
    );
    console.error(
      "Roles: admin | manager | student"
    );
    process.exit(1);
  }

  const email = String(emailArg).trim().toLowerCase();
  const password = String(passwordArg);
  const name = String(nameArg).trim();
  const role = String(roleArg).trim().toLowerCase();

  const allowedRoles = ["admin", "manager", "student"];

  if (!allowedRoles.includes(role)) {
    console.error(
      "Invalid role. Use: admin, manager, or student"
    );
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const existing = db
    .prepare("SELECT id FROM users WHERE email=?")
    .get(email);

  if (existing) {
    db.prepare(`
      UPDATE users
      SET name=?,
          password=?,
          role=?,
          department='Techins',
          active=1
      WHERE email=?
    `).run(
      name,
      passwordHash,
      role,
      email
    );

    console.log(`${role.toUpperCase()} account updated.`);
  } else {
    db.prepare(`
      INSERT INTO users
      (name,email,password,role,department,active)
      VALUES (?,?,?,?,?,1)
    `).run(
      name,
      email,
      passwordHash,
      role,
      "Techins"
    );

    console.log(`${role.toUpperCase()} account created.`);
  }

  console.log(`Email: ${email}`);
  console.log(`Role: ${role}`);
  console.log("Password is not printed for security.");
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});