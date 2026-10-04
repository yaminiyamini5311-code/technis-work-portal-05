const bcrypt = require("bcryptjs");
const db = require("./database");

async function main() {
  const [name, emailArg, passwordArg, roleArg = "student"] = process.argv.slice(2);
  if (!name || !emailArg || !passwordArg) {
    console.error('Usage: node createUsers.js <name> <email> <password> [student|manager|admin]');
    process.exit(1);
  }
  const role = String(roleArg).toLowerCase();
  if (!["student", "manager", "admin"].includes(role)) throw new Error("Role must be student, manager or admin");
  const email = String(emailArg).trim().toLowerCase();
  if (db.prepare("SELECT id FROM users WHERE email=?").get(email)) throw new Error("A user with this email already exists");
  if (role === "student" && Number(db.prepare("SELECT COUNT(*) c FROM users WHERE LOWER(role)='student' AND active=1").get().c) >= 25) throw new Error("Maximum of 25 active students has been reached");
  const hash = await bcrypt.hash(String(passwordArg), 12);
  const result = db.prepare("INSERT INTO users (name,email,password,role,department,active) VALUES (?,?,?,?,?,1)").run(String(name).trim(),email,hash,role,"Techins");
  console.log(`Created ${role} account: ${email} (id ${Number(result.lastInsertRowid)})`);
  console.log("Password is not printed for security.");
}
main().catch(error => { console.error(error.message); process.exit(1); });
