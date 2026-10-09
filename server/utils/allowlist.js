const fs = require('fs');
const path = require('path');

/**
 * Get allowed student emails from environment variable or local file
 * Never expose this list through any API
 */
function getAllowedStudentEmails() {
  let emails = [];

  // Try environment variable first
  const envEmails = process.env.ALLOWED_STUDENT_EMAILS;
  if (envEmails) {
    emails = envEmails
      .split(/[,\n]/)
      .map(email => email.trim().toLowerCase())
      .filter(email => email.length > 0);
  } 
  // Fallback to local file for development (gitignored)
  else {
    try {
      const filePath = path.join(__dirname, '../allowed-students.txt');
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        emails = content
          .split(/[\r\n]+/)
          .map(email => email.trim().toLowerCase())
          .filter(email => email.length > 0);
      }
    } catch (error) {
      console.error('Error reading allowed students file:', error.message);
    }
  }

  return new Set(emails);
}

/**
 * Check if a student email is in the allowlist
 */
function isStudentEmailAllowed(email) {
  const allowedEmails = getAllowedStudentEmails();
  const normalizedEmail = String(email).trim().toLowerCase();
  return allowedEmails.has(normalizedEmail);
}

module.exports = { isStudentEmailAllowed, getAllowedStudentEmails };
