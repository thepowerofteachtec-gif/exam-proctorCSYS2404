// SQLite storage using Node's built-in driver (no native build step).
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'exam.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true }); // works for a hosted disk mount too
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode = WAL;`);

db.exec(`
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,            -- Canvas user id (LTI) or roster student id
  name TEXT NOT NULL,
  email TEXT,
  access_code TEXT,               -- only used for fallback login
  extra_minutes INTEGER DEFAULT 0 -- accommodations
);
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  exam_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress', -- in_progress | submitted
  started_at INTEGER NOT NULL,
  deadline INTEGER NOT NULL,
  submitted_at INTEGER,
  submit_reason TEXT,             -- student | time_expired | instructor
  question_order TEXT NOT NULL,   -- JSON: [{qid, options:[optId...]}]
  answers TEXT NOT NULL DEFAULT '{}',
  flags TEXT NOT NULL DEFAULT '[]',
  current_q INTEGER DEFAULT 0,
  score REAL,
  max_score REAL,
  risk_score INTEGER DEFAULT 0,
  first_ip TEXT,
  last_ip TEXT,
  user_agent TEXT,
  active_session TEXT,
  last_seen INTEGER,
  lti_outcome_url TEXT,
  lti_sourcedid TEXT,
  grade_synced INTEGER DEFAULT 0,
  UNIQUE(student_id, exam_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  ip TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  qid TEXT,
  detail TEXT,
  weight INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_events_attempt ON events(attempt_id, ts);
CREATE TABLE IF NOT EXISTS lti_nonces (
  nonce TEXT PRIMARY KEY,
  ts INTEGER NOT NULL
);
`);

// --- lightweight migrations (safe to run every start) ---
function addColumnIfMissing(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
// Active time spent per question, JSON { qid: milliseconds }
addColumnIfMissing('attempts', 'timings', "TEXT NOT NULL DEFAULT '{}'");

module.exports = db;
