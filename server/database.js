const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const dbPath = path.join(__dirname, "techins.db");
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  department TEXT DEFAULT 'Techins',
  active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_code TEXT UNIQUE,
  title TEXT NOT NULL,
  category TEXT DEFAULT 'General',
  program TEXT DEFAULT 'TECHINS',
  team TEXT DEFAULT 'General',
  task_type TEXT DEFAULT 'General',
  description TEXT,
  what TEXT,
  why TEXT,
  how TEXT,
  expected_output TEXT,
  submission_requirements TEXT,
  resources TEXT,
  notes TEXT,
  assigned_to INTEGER NOT NULL,
  assigned_by INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  workflow_status TEXT NOT NULL DEFAULT 'Assigned',
  priority TEXT NOT NULL DEFAULT 'medium',
  start_date TEXT,
  due_date TEXT,
  completed_at TEXT,
  feedback TEXT,
  outcome TEXT,
  outcome_submitted_at TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (assigned_to) REFERENCES users(id),
  FOREIGN KEY (assigned_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS daily_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  work_title TEXT NOT NULL,
  description TEXT NOT NULL,
  hours_worked REAL DEFAULT 0,
  status TEXT DEFAULT 'completed',
  blockers TEXT,
  next_steps TEXT,
  attachment TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS missions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to INTEGER NOT NULL,
  assigned_by INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'assigned',
  progress INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  completed_at TEXT,
  feedback TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (assigned_to) REFERENCES users(id),
  FOREIGN KEY (assigned_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_code TEXT UNIQUE,
  task_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'Submitted',
  submitted_at TEXT NOT NULL,
  reviewer_id INTEGER,
  reviewed_at TEXT,
  review_comments TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id),
  FOREIGN KEY (reviewer_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS submission_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT,
  size INTEGER DEFAULT 0,
  storage_path TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS task_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT,
  size INTEGER DEFAULT 0,
  storage_path TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  message TEXT,
  related_task_id INTEGER,
  read_at TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS performance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  period TEXT NOT NULL,
  score INTEGER DEFAULT NULL,
  strengths TEXT,
  improvements TEXT,
  completed_missions INTEGER DEFAULT 0,
  feedback TEXT,
  reviewed_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  previous_value TEXT,
  new_value TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (actor_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS task_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by INTEGER NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES users(id)
);
`);

function columns(table) { return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name); }
function addColumnIfMissing(table, column, definition) {
  if (!columns(table).includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumnIfMissing("users", "department", "TEXT DEFAULT 'Techins'");
addColumnIfMissing("users", "program", "TEXT");
addColumnIfMissing("users", "active", "INTEGER NOT NULL DEFAULT 1");
for (const [c, d] of [
  ["task_code", "TEXT"], ["category", "TEXT DEFAULT 'General'"], ["program", "TEXT DEFAULT 'TECHINS'"], ["team", "TEXT DEFAULT 'General'"], ["task_type", "TEXT DEFAULT 'General'"],
  ["what", "TEXT"], ["why", "TEXT"], ["how", "TEXT"], ["how_to_do", "TEXT"], ["expected_output", "TEXT"], ["submission_requirements", "TEXT"], ["resources", "TEXT"], ["notes", "TEXT"],
  ["workflow_status", "TEXT DEFAULT 'Assigned'"], ["start_date", "TEXT"], ["updated_at", "TEXT"]
]) addColumnIfMissing("tasks", c, d);
for (const [c, d] of [["next_steps","TEXT"]]) addColumnIfMissing("daily_activities", c, d);
addColumnIfMissing("notifications", "related_task_id", "INTEGER");

// Backfill identifiers for legacy tasks without changing existing records.
const legacyTasks = db.prepare("SELECT id, task_code FROM tasks ORDER BY id").all();
const updateCode = db.prepare("UPDATE tasks SET task_code=? WHERE id=?");
for (const task of legacyTasks) {
  if (!task.task_code) updateCode.run(`TNS-${new Date().getFullYear()}-${String(task.id).padStart(4, "0")}`, task.id);
}
db.prepare("UPDATE tasks SET workflow_status=CASE LOWER(status) WHEN 'completed' THEN 'Approved' WHEN 'in_progress' THEN 'In Progress' WHEN 'pending' THEN 'Assigned' ELSE COALESCE(workflow_status,'Assigned') END WHERE workflow_status IS NULL OR workflow_status='' ").run();
db.prepare("UPDATE tasks SET updated_at=COALESCE(updated_at,created_at)").run();

for (const table of ["tasks","missions","daily_activities"]) {
  if (columns(table).includes("status")) db.prepare(`UPDATE ${table} SET status=LOWER(status) WHERE status IS NOT NULL`).run();
}

db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_task_code ON tasks(task_code); CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to); CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date); CREATE INDEX IF NOT EXISTS idx_submissions_task ON submissions(task_id); CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,read_at); CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);`);

// Preserve the existing transaction helper used by the project.
db.transaction = (callback) => { db.exec("BEGIN"); try { const result = callback(); db.exec("COMMIT"); return result; } catch (error) { try { db.exec("ROLLBACK"); } catch (_) {} throw error; } };

console.log(`SQLite database connected: ${dbPath}`);
module.exports = db;
