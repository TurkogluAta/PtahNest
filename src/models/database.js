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

  // Projects table
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      project_status TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      tags TEXT NOT NULL,
      looking_for TEXT NOT NULL,
      recruitment_open INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (creator_id) REFERENCES users(id)
    )
  `);

  // Project members table
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_members (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      membership_status TEXT NOT NULL DEFAULT 'active',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      left_at DATETIME,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(project_id, user_id)
    )
  `);

  // Join requests table
  db.exec(`
    CREATE TABLE IF NOT EXISTS join_requests (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(project_id, user_id)
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

// Project database operations
const projectDb = {
  // CREATE
  create(name, description, creatorId, tags, lookingFor, recruitmentOpen) {
    const id = require('crypto').randomUUID();
    const memberId = require('crypto').randomUUID();

    // Insert project
    const stmt = db.prepare(`
      INSERT INTO projects (id, name, description, project_status, creator_id, tags, looking_for, recruitment_open)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      name,
      description,
      creatorId,
      JSON.stringify(tags),
      JSON.stringify(lookingFor),
      recruitmentOpen ? 1 : 0
    );

    // Add creator as member with role 'creator'
    const memberStmt = db.prepare(`
      INSERT INTO project_members (id, project_id, user_id, role, membership_status)
      VALUES (?, ?, ?, 'creator', 'active')
    `);
    memberStmt.run(memberId, id, creatorId);

    return { id, name, description, project_status: 'active', tags, lookingFor, recruitmentOpen };
  },

  // READ: Get all user's projects (creator + member) - FOR PROJECTS PAGE
  findUserProjects(userId) {
    const stmt = db.prepare(`
      SELECT DISTINCT p.*,
        pm.membership_status,
        pm.left_at,
        (SELECT COUNT(*) FROM project_members WHERE project_id = p.id AND membership_status = 'active') as members
      FROM projects p
      LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = ?
      WHERE (p.creator_id = ? OR pm.user_id = ?)
      ORDER BY
        CASE
          WHEN pm.membership_status = 'active' AND p.project_status = 'active' THEN 0
          ELSE 1
        END,
        p.created_at DESC
    `);
    const rows = stmt.all(userId, userId, userId);

    // Parse JSON fields and determine display status for frontend
    return rows.map(row => {
      // Display status priority: membership_status > project_status
      // If user has specific membership status (left/kicked), show that
      // Otherwise show project status (active/deleted)
      let displayStatus = row.project_status; // Default to project status
      if (row.membership_status === 'left') displayStatus = 'left';
      if (row.membership_status === 'kicked') displayStatus = 'kicked';
      if (row.project_status === 'deleted') displayStatus = 'deleted'; // Deleted overrides all

      return {
        ...row,
        status: displayStatus, // Frontend uses this
        tags: JSON.parse(row.tags),
        lookingFor: JSON.parse(row.looking_for),
        recruitmentOpen: Boolean(row.recruitment_open),
        members: row.members
      };
    });
  },

  // READ: Get discover projects (public - active + recruitment open)
  findDiscoverProjects(userId = null) {
    let stmt;
    let rows;

    if (userId) {
      // Logged in: exclude projects where user is ACTIVE member
      // Show projects where user has left/been kicked (they can see but not rejoin)
      stmt = db.prepare(`
        SELECT p.*, u.username as creator_username,
          (SELECT COUNT(*) FROM project_members WHERE project_id = p.id AND membership_status = 'active') as members
        FROM projects p
        JOIN users u ON p.creator_id = u.id
        WHERE p.project_status = 'active'
          AND p.recruitment_open = 1
          AND p.id NOT IN (
            SELECT project_id FROM project_members WHERE user_id = ? AND membership_status = 'active'
          )
        ORDER BY p.created_at DESC
      `);
      rows = stmt.all(userId);
    } else {
      // Not logged in: show all active projects
      stmt = db.prepare(`
        SELECT p.*, u.username as creator_username,
          (SELECT COUNT(*) FROM project_members WHERE project_id = p.id AND membership_status = 'active') as members
        FROM projects p
        JOIN users u ON p.creator_id = u.id
        WHERE p.project_status = 'active' AND p.recruitment_open = 1
        ORDER BY p.created_at DESC
      `);
      rows = stmt.all();
    }

    return rows.map(row => ({
      ...row,
      status: row.project_status, // Frontend expects 'status' field
      tags: JSON.parse(row.tags),
      lookingFor: JSON.parse(row.looking_for),
      recruitmentOpen: Boolean(row.recruitment_open),
      members: row.members
    }));
  },

  // READ: Get single project by ID
  findById(id) {
    const stmt = db.prepare('SELECT * FROM projects WHERE id = ?');
    const row = stmt.get(id);

    if (!row) return null;

    return {
      ...row,
      status: row.project_status, // Frontend expects 'status' field
      tags: JSON.parse(row.tags),
      lookingFor: JSON.parse(row.looking_for),
      recruitmentOpen: Boolean(row.recruitment_open)
    };
  },

  // UPDATE: Update project
  update(id, creatorId, { name, description, tags, lookingFor, recruitmentOpen }) {
    const stmt = db.prepare(`
      UPDATE projects
      SET name = ?, description = ?, tags = ?, looking_for = ?, recruitment_open = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND creator_id = ?
    `);
    const result = stmt.run(
      name,
      description,
      JSON.stringify(tags),
      JSON.stringify(lookingFor),
      recruitmentOpen ? 1 : 0,
      id,
      creatorId
    );

    return result.changes > 0;
  },

  // UPDATE: Toggle recruitment status
  toggleRecruitment(id, creatorId) {
    const project = this.findById(id);
    if (!project || project.creator_id !== creatorId) return false;

    const stmt = db.prepare(`
      UPDATE projects
      SET recruitment_open = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND creator_id = ?
    `);
    const result = stmt.run(project.recruitment_open ? 0 : 1, id, creatorId);
    return result.changes > 0;
  },

  // DELETE: Soft delete project
  delete(id, creatorId) {
    // Soft delete: Mark project as deleted
    const stmt = db.prepare(`
      UPDATE projects
      SET project_status = 'deleted', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND creator_id = ?
    `);
    const result = stmt.run(id, creatorId);

    // Delete join requests (no longer needed)
    const deleteRequestsStmt = db.prepare(`
      DELETE FROM join_requests WHERE project_id = ?
    `);
    deleteRequestsStmt.run(id);

    return result.changes > 0;
  }
};

// Project members database operations
const memberDb = {
  // Check if user is member of project (active members only)
  isMember(projectId, userId) {
    const stmt = db.prepare(`
      SELECT * FROM project_members
      WHERE project_id = ? AND user_id = ? AND membership_status = 'active'
    `);
    return stmt.get(projectId, userId) !== undefined;
  },

  // Get all members of a project (active members only)
  getProjectMembers(projectId) {
    const stmt = db.prepare(`
      SELECT pm.*, u.username, u.email
      FROM project_members pm
      JOIN users u ON pm.user_id = u.id
      WHERE pm.project_id = ? AND pm.membership_status = 'active'
      ORDER BY pm.joined_at ASC
    `);
    return stmt.all(projectId);
  },

  // Add member to project
  addMember(projectId, userId, role = 'member') {
    const id = require('crypto').randomUUID();
    const stmt = db.prepare(`
      INSERT INTO project_members (id, project_id, user_id, role, membership_status)
      VALUES (?, ?, ?, ?, 'active')
    `);
    stmt.run(id, projectId, userId, role);
    return { id, projectId, userId, role };
  },

  // Remove member from project (soft delete)
  removeMember(projectId, userId) {
    // Soft delete: Mark as left
    const stmt = db.prepare(`
      UPDATE project_members
      SET membership_status = 'left', left_at = CURRENT_TIMESTAMP
      WHERE project_id = ? AND user_id = ?
    `);
    const result = stmt.run(projectId, userId);

    // Still delete join requests to allow re-joining
    const deleteRequestStmt = db.prepare(`
      DELETE FROM join_requests
      WHERE project_id = ? AND user_id = ?
    `);
    deleteRequestStmt.run(projectId, userId);

    return result.changes > 0;
  }
};

// Join requests database operations
const joinRequestDb = {
  // Create join request
  create(projectId, userId, message = null) {
    const id = require('crypto').randomUUID();
    const stmt = db.prepare(`
      INSERT INTO join_requests (id, project_id, user_id, status, message)
      VALUES (?, ?, ?, 'pending', ?)
    `);
    stmt.run(id, projectId, userId, message);
    return { id, projectId, userId, status: 'pending', message };
  },

  // Check if user has pending request
  hasPendingRequest(projectId, userId) {
    const stmt = db.prepare(`
      SELECT * FROM join_requests
      WHERE project_id = ? AND user_id = ? AND status = 'pending'
    `);
    return stmt.get(projectId, userId) !== undefined;
  },

  // Check if user was recently rejected (within 30 days)
  wasRecentlyRejected(projectId, userId) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString();

    const stmt = db.prepare(`
      SELECT * FROM join_requests
      WHERE project_id = ? AND user_id = ? AND status = 'rejected'
        AND created_at > ?
    `);
    const request = stmt.get(projectId, userId, thirtyDaysAgoStr);

    if (request) {
      // Calculate days remaining
      const rejectedDate = new Date(request.created_at);
      const now = new Date();
      const diffTime = Math.abs(now - rejectedDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      const daysRemaining = 30 - diffDays;

      return {
        blocked: true,
        daysRemaining: daysRemaining > 0 ? daysRemaining : 0
      };
    }

    return { blocked: false };
  },

  // Get all pending requests for a project
  getPendingRequests(projectId) {
    const stmt = db.prepare(`
      SELECT jr.*, u.username, u.email
      FROM join_requests jr
      JOIN users u ON jr.user_id = u.id
      WHERE jr.project_id = ? AND jr.status = 'pending'
      ORDER BY jr.created_at DESC
    `);
    return stmt.all(projectId);
  },

  // Get request by ID
  findById(requestId) {
    const stmt = db.prepare('SELECT * FROM join_requests WHERE id = ?');
    return stmt.get(requestId);
  },

  // Accept request
  accept(requestId) {
    const stmt = db.prepare(`
      UPDATE join_requests
      SET status = 'accepted'
      WHERE id = ?
    `);
    const result = stmt.run(requestId);
    return result.changes > 0;
  },

  // Reject request
  reject(requestId) {
    const stmt = db.prepare(`
      UPDATE join_requests
      SET status = 'rejected'
      WHERE id = ?
    `);
    const result = stmt.run(requestId);
    return result.changes > 0;
  }
};

module.exports = {
  db,
  initDatabase,
  userDb,
  loginAttemptDb,
  projectDb,
  memberDb,
  joinRequestDb
};
