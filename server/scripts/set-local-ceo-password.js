// Set CEO_PASSWORD_HASH to a known local-test password (local .env only, value never printed)
const fs = require("fs");
const bcrypt = require("bcryptjs");
const file = "D:\\Techins Portal\\technis-work-portal-05\\server\\.env";
const password = process.argv[2] || "CeoTest@2026!Portal";
bcrypt.hash(password, 12).then(hash => {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const out = lines.map(l => /^\s*CEO_PASSWORD_HASH\s*=/.test(l) ? "CEO_PASSWORD_HASH=" + hash : l);
  fs.writeFileSync(file, out.join("\n"));
  console.log("CEO_PASSWORD_HASH updated for local testing (password not logged)");
});
