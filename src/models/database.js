const Database = require('better-sqlite3');
const path = require('path');

// Database connection (store in project root)
const dbPath = path.join(__dirname, '../../ptahnest.sqlite');
const db = new Database(dbPath);

// Initialize database tables
function initDatabase() {
  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      username_lower TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Login attempts table (IP-based brute-force tracking)
  db.exec(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      last_attempt INTEGER,
      locked_until INTEGER,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    )
  `);

  console.log('Database initialized');
}

// User database operations
const userDb = {
  // Create new user
  create(username, email, password) {
    const id = require('crypto').randomUUID();
    const stmt = db.prepare('INSERT INTO users (id, username, username_lower, email, password) VALUES (?, ?, ?, ?, ?)');
    stmt.run(id, username, username.toLowerCase(), email.toLowerCase(), password);
    return { id, username, email: email.toLowerCase() };
  },

  // Find user by email or username (case-insensitive)
  findByEmailOrUsername(identifier) {
    const stmt = db.prepare('SELECT * FROM users WHERE email = ? OR username_lower = ?');
    return stmt.get(identifier.toLowerCase(), identifier.toLowerCase());
  },

  // Find user by ID
  findById(id) {
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    return stmt.get(id);
  }
};

// Login attempt tracking - IP-BASED BRUTE-FORCE PROTECTION
const loginAttemptDb = {
  // Check if login attempt is allowed (call BEFORE attempting login)
  check(ip) {
    const attempt = db.prepare('SELECT * FROM login_attempts WHERE ip = ?').get(ip);

    if (!attempt) {
      return { allowed: true }; // First attempt, allow
    }

    const now = Date.now();

    // Check if IP is locked (after 10+ failed attempts, lock for 30 minutes)
    if (attempt.locked_until) {
      if (attempt.locked_until > now) {
        const remainingSeconds = Math.ceil((attempt.locked_until - now) / 1000);
        return {
          allowed: false,
          reason: 'locked',
          message: `Too many failed attempts. Your IP is temporarily blocked. Try again in ${Math.floor(remainingSeconds / 60)} minutes ${remainingSeconds % 60} seconds.`
        };
      } else {
        // Lock expired, reset attempts
        this.clear(ip);
        return { allowed: true };
      }
    }

    // Exponential delay check (first 4 attempts are free, delay starts from 5th)
    if (attempt.attempts >= 5 && attempt.last_attempt) {
      // Delay = 5 * 2^(attempts-5) seconds
      // attempts=5: 5s, attempts=6: 10s, attempts=7: 20s, attempts=8: 40s, attempts=9: 80s
      const delaySeconds = 5 * Math.pow(2, attempt.attempts - 5);
      const delayMs = delaySeconds * 1000;
      const timeSinceLastAttempt = now - attempt.last_attempt;

      if (timeSinceLastAttempt < delayMs) {
        const waitSeconds = Math.ceil((delayMs - timeSinceLastAttempt) / 1000);
        return {
          allowed: false,
          reason: 'delay',
          message: `Too many attempts. Please wait ${waitSeconds} seconds before trying again.`
        };
      }
    }

    return { allowed: true };
  },

  // Record failed login attempt
  record(ip) {
    const existing = db.prepare('SELECT * FROM login_attempts WHERE ip = ?').get(ip);
    const now = Date.now();

    if (existing) {
      const newAttempts = existing.attempts + 1;

      // Lock IP for 30 minutes after 10+ failed attempts
      if (newAttempts >= 10) {
        const lockedUntil = now + 30 * 60 * 1000; // 30 minutes from now
        const stmt = db.prepare('UPDATE login_attempts SET attempts = ?, last_attempt = ?, locked_until = ? WHERE ip = ?');
        stmt.run(newAttempts, now, lockedUntil, ip);
      } else {
        const stmt = db.prepare('UPDATE login_attempts SET attempts = ?, last_attempt = ? WHERE ip = ?');
        stmt.run(newAttempts, now, ip);
      }
    } else {
      const stmt = db.prepare('INSERT INTO login_attempts (ip, attempts, last_attempt) VALUES (?, 1, ?)');
      stmt.run(ip, now);
    }
  },

  // Clear attempts (after successful login)
  clear(ip) {
    const stmt = db.prepare('DELETE FROM login_attempts WHERE ip = ?');
    stmt.run(ip);
  },

  // Get attempt info for IP
  get(ip) {
    const stmt = db.prepare('SELECT * FROM login_attempts WHERE ip = ?');
    return stmt.get(ip);
  }
};

module.exports = {
  db,
  initDatabase,
  userDb,
  loginAttemptDb
};
