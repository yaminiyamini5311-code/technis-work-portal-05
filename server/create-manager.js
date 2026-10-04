const bcrypt = require("bcryptjs");
const db = require("./database");

async function main() {
  const [emailArg, passwordArg, nameArg = "TECHINS Manager"] = process.argv.slice(2);
  if (!emailArg || !passwordArg) {
    console.error('Usage: node create-manager.js <email> <password> [name]');
    process.exit(1);
  }
  const email = String(emailArg).trim().toLowerCase();
  const passwordHash = await bcrypt.hash(String(passwordArg), 12);
  const existing = db.prepare("SELECT id FROM users WHERE email=?").get(email);
  if (existing) {
    db.prepare("UPDATE users SET name=?,password=?,role='manager',department='Techins',active=1 WHERE email=?").run(String(nameArg).trim(), passwordHash, email);
    console.log("Manager account updated.");
  } else {
    db.prepare("INSERT INTO users (name,email,password,role,department,active) VALUES (?,?,?,'manager','Techins',1)").run(String(nameArg).trim(), email, passwordHash);
    console.log("Manager account created.");
  }
  console.log(`Manager email: ${email}`);
  console.log("Password is not printed for security.");
}
main().catch((error) => { console.error(error.message); process.exit(1); });
