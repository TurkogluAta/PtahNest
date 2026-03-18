const { Pool, Client } = require('pg');

// Safe JSON parse with fallback
function safeJsonParse(str, fallback = []) {
  try { return JSON.parse(str); } catch { return fallback; }
}

// Auto-create database if it doesn't exist
async function ensureDatabaseExists() {
  const connStr = process.env.DATABASE_URL;
  const dbName = connStr.split('/').pop().split('?')[0]; // extract db name from URL
  const baseUrl = connStr.substring(0, connStr.lastIndexOf('/')) + '/postgres'; // connect to default 'postgres' db

  const client = new Client({ connectionString: baseUrl });
  try {
    await client.connect();
    const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (res.rowCount === 0) {
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log(`Database "${dbName}" created automatically.`);
    }
  } finally {
    await client.end();
  }
}

// PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Initialize all database tables
async function initDatabase() {
  await ensureDatabaseExists();
  // Users table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      username_lower TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      github_id BIGINT UNIQUE,
      github_username TEXT,
      github_token TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Login attempts table (IP-based brute-force tracking)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      id SERIAL PRIMARY KEY,
      ip TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      last_attempt BIGINT,
      locked_until BIGINT,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000
    )
  `);

  // Projects table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      project_status TEXT NOT NULL,
      project_type TEXT NOT NULL DEFAULT 'software',
      creator_id TEXT NOT NULL,
      tags TEXT NOT NULL,
      looking_for TEXT NOT NULL,
      recruitment_open BOOLEAN NOT NULL DEFAULT TRUE,
      github_repo TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    )
  `);

  // Project members table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_members (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      membership_status TEXT NOT NULL DEFAULT 'active',
      github_id BIGINT,
      github_invited INTEGER DEFAULT 0,
      github_invited_at TIMESTAMPTZ,
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      left_at TIMESTAMPTZ,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(project_id, user_id)
    )
  `);

  // Add github_id column to project_members if it doesn't exist (migration)
  await pool.query(`
    ALTER TABLE project_members ADD COLUMN IF NOT EXISTS github_id BIGINT
  `);

  // Join requests table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS join_requests (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      github_id BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(project_id, user_id)
    )
  `);

  // Add github_id column to join_requests if it doesn't exist (migration)
  await pool.query(`
    ALTER TABLE join_requests ADD COLUMN IF NOT EXISTS github_id BIGINT
  `);

  console.log('Database initialized');
}

// User database operations
const userDb = {
  // Create new user
  async create(username, email, password) {
    const id = require('crypto').randomUUID();
    await pool.query(
      'INSERT INTO users (id, username, username_lower, email, password) VALUES ($1, $2, $3, $4, $5)',
      [id, username, username.toLowerCase(), email.toLowerCase(), password]
    );
    return { id, username, email: email.toLowerCase() };
  },

  // Find user by email or username (case-insensitive)
  async findByEmailOrUsername(identifier) {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR username_lower = $1',
      [identifier.toLowerCase()]
    );
    return rows[0] || null;
  },

  // Find user by ID
  async findById(id) {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] || null;
  }
};

// Login attempt tracking - IP-BASED BRUTE-FORCE PROTECTION
const loginAttemptDb = {
  // Check if login attempt is allowed (call BEFORE attempting login)
  async check(ip) {
    const { rows } = await pool.query('SELECT * FROM login_attempts WHERE ip = $1', [ip]);
    const attempt = rows[0];

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
        await this.clear(ip);
        return { allowed: true };
      }
    }

    // Exponential delay check (first 4 attempts are free, delay starts from 5th)
    if (attempt.attempts >= 5 && attempt.last_attempt) {
      // Delay = 5 * 2^(attempts-5) seconds
      const delaySeconds = 5 * Math.pow(2, attempt.attempts - 5);
      const delayMs = delaySeconds * 1000;
      const timeSinceLastAttempt = now - Number(attempt.last_attempt);

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
  async record(ip) {
    const { rows } = await pool.query('SELECT * FROM login_attempts WHERE ip = $1', [ip]);
    const existing = rows[0];
    const now = Date.now();

    if (existing) {
      const newAttempts = existing.attempts + 1;

      // Lock IP for 30 minutes after 10+ failed attempts
      if (newAttempts >= 10) {
        const lockedUntil = now + 30 * 60 * 1000;
        await pool.query(
          'UPDATE login_attempts SET attempts = $1, last_attempt = $2, locked_until = $3 WHERE ip = $4',
          [newAttempts, now, lockedUntil, ip]
        );
      } else {
        await pool.query(
          'UPDATE login_attempts SET attempts = $1, last_attempt = $2 WHERE ip = $3',
          [newAttempts, now, ip]
        );
      }
    } else {
      await pool.query(
        'INSERT INTO login_attempts (ip, attempts, last_attempt) VALUES ($1, 1, $2)',
        [ip, now]
      );
    }
  },

  // Clear attempts (after successful login)
  async clear(ip) {
    await pool.query('DELETE FROM login_attempts WHERE ip = $1', [ip]);
  },

  // Get attempt info for IP
  async get(ip) {
    const { rows } = await pool.query('SELECT * FROM login_attempts WHERE ip = $1', [ip]);
    return rows[0] || null;
  }
};

// Project database operations
const projectDb = {
  // CREATE
  async create(name, description, creatorId, tags, lookingFor, recruitmentOpen, githubRepo = null, projectType = 'software') {
    const id = require('crypto').randomUUID();
    const memberId = require('crypto').randomUUID();

    // Use a transaction: insert project + creator member together
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO projects (id, name, description, project_status, creator_id, tags, looking_for, recruitment_open, github_repo, project_type)
         VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9)`,
        [id, name, description, creatorId, JSON.stringify(tags), JSON.stringify(lookingFor), recruitmentOpen, githubRepo, projectType]
      );

      // Add creator as member with role 'creator'
      await client.query(
        `INSERT INTO project_members (id, project_id, user_id, role, membership_status)
         VALUES ($1, $2, $3, 'creator', 'active')`,
        [memberId, id, creatorId]
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return { id, name, description, project_status: 'active', status: 'active', tags, lookingFor, recruitmentOpen, projectType, members: 1 };
  },

  // Check if creator already has an active project with the same name
  async hasActiveDuplicateName(creatorId, name) {
    const { rows } = await pool.query(
      `SELECT id FROM projects WHERE creator_id = $1 AND name = $2 AND project_status = 'active'`,
      [creatorId, name]
    );
    return rows.length > 0;
  },

  // Check if a GitHub repo is already used by an active project
  async isRepoInUse(repoFullName, excludeProjectId = null) {
    if (excludeProjectId) {
      const { rows } = await pool.query(
        `SELECT id FROM projects WHERE github_repo = $1 AND project_status = 'active' AND id != $2`,
        [repoFullName, excludeProjectId]
      );
      return rows.length > 0;
    }
    const { rows } = await pool.query(
      `SELECT id FROM projects WHERE github_repo = $1 AND project_status = 'active'`,
      [repoFullName]
    );
    return rows.length > 0;
  },

  // READ: Get all user's projects (creator + member) - FOR PROJECTS PAGE
  async findUserProjects(userId) {
    const { rows } = await pool.query(
      `SELECT DISTINCT p.*,
        pm.membership_status,
        pm.role,
        pm.left_at,
        (SELECT COUNT(*) FROM project_members WHERE project_id = p.id AND membership_status = 'active') as members,
        CASE
          WHEN pm.membership_status = 'active' AND p.project_status = 'active' THEN 0
          ELSE 1
        END as sort_priority
      FROM projects p
      LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = $1
      WHERE (p.creator_id = $2 OR pm.user_id = $3)
      ORDER BY sort_priority, p.created_at DESC`,
      [userId, userId, userId]
    );

    // Parse JSON fields and determine display status for frontend
    return rows.map(row => {
      // Display status priority: membership_status > project_status
      let displayStatus = row.project_status;
      if (row.membership_status === 'left') displayStatus = 'left';
      if (row.membership_status === 'kicked') displayStatus = 'kicked';
      if (row.project_status === 'deleted') displayStatus = 'deleted';

      return {
        ...row,
        status: displayStatus,
        tags: safeJsonParse(row.tags, []),
        lookingFor: safeJsonParse(row.looking_for, []),
        role: row.role,
        recruitmentOpen: Boolean(row.recruitment_open),
        githubRepo: row.github_repo || null,
        projectType: row.project_type,
        members: Number(row.members)
      };
    });
  },

  // READ: Get discover projects (public - active + recruitment open)
  async findDiscoverProjects(userId = null) {
    let rows;

    if (userId) {
      // Logged in: exclude projects where user is ACTIVE member
      const result = await pool.query(
        `SELECT p.*, u.username as creator_username,
          (SELECT COUNT(*) FROM project_members WHERE project_id = p.id AND membership_status = 'active') as members
        FROM projects p
        JOIN users u ON p.creator_id = u.id
        WHERE p.project_status = 'active'
          AND p.recruitment_open = TRUE
          AND p.id NOT IN (
            SELECT project_id FROM project_members WHERE user_id = $1 AND membership_status = 'active'
          )
        ORDER BY p.created_at DESC`,
        [userId]
      );
      rows = result.rows;
    } else {
      // Not logged in: show all active projects
      const result = await pool.query(
        `SELECT p.*, u.username as creator_username,
          (SELECT COUNT(*) FROM project_members WHERE project_id = p.id AND membership_status = 'active') as members
        FROM projects p
        JOIN users u ON p.creator_id = u.id
        WHERE p.project_status = 'active' AND p.recruitment_open = TRUE
        ORDER BY p.created_at DESC`
      );
      rows = result.rows;
    }

    return rows.map(row => ({
      ...row,
      status: row.project_status,
      tags: safeJsonParse(row.tags, []),
      lookingFor: safeJsonParse(row.looking_for, []),
      recruitmentOpen: Boolean(row.recruitment_open),
      githubRepo: row.github_repo || null,
      projectType: row.project_type,
      members: Number(row.members)
    }));
  },

  // READ: Get single project by ID (optional userId to include viewer's role)
  async findById(id, userId = null) {
    let row;
    if (userId) {
      const { rows } = await pool.query(
        `SELECT p.*, pm.role FROM projects p
         LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = $2
         WHERE p.id = $1`,
        [id, userId]
      );
      row = rows[0];
    } else {
      const { rows } = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
      row = rows[0];
    }

    if (!row) return null;

    return {
      ...row,
      status: row.project_status,
      tags: safeJsonParse(row.tags, []),
      lookingFor: safeJsonParse(row.looking_for, []),
      recruitmentOpen: Boolean(row.recruitment_open),
      githubRepo: row.github_repo || null,
      projectType: row.project_type,
      role: row.role || null
    };
  },

  // UPDATE: Update project (github_repo and project_type are immutable after creation)
  async update(id, creatorId, { name, description, tags, lookingFor, recruitmentOpen }) {
    const { rowCount } = await pool.query(
      `UPDATE projects
       SET name = $1, description = $2, tags = $3, looking_for = $4, recruitment_open = $5, updated_at = NOW()
       WHERE id = $6 AND creator_id = $7 AND project_status = 'active'`,
      [name, description, JSON.stringify(tags), JSON.stringify(lookingFor), recruitmentOpen, id, creatorId]
    );
    return rowCount > 0;
  },

  // UPDATE: Toggle recruitment status
  async toggleRecruitment(id, creatorId) {
    const project = await this.findById(id);
    if (!project || project.creator_id !== creatorId) return false;

    const { rowCount } = await pool.query(
      `UPDATE projects SET recruitment_open = $1, updated_at = NOW() WHERE id = $2 AND creator_id = $3 AND project_status = 'active'`,
      [!project.recruitmentOpen, id, creatorId]
    );
    return rowCount > 0;
  },

  // READ: Get active software projects where user is the creator (used for unlink check)
  async getActiveSoftwareProjectsAsCreator(userId) {
    const { rows } = await pool.query(
      `SELECT id, name FROM projects WHERE creator_id = $1 AND project_status = 'active' AND project_type = 'software'`,
      [userId]
    );
    return rows;
  },

  // COMPLETE: Mark project as completed (creator only)
  async complete(id, creatorId) {
    const { rowCount } = await pool.query(
      `UPDATE projects SET project_status = 'completed', recruitment_open = FALSE, updated_at = NOW()
       WHERE id = $1 AND creator_id = $2 AND project_status = 'active'`,
      [id, creatorId]
    );
    return rowCount > 0;
  },

  // DELETE: Soft delete project
  async delete(id, creatorId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Soft delete: mark project as deleted
      const { rowCount } = await client.query(
        `UPDATE projects SET project_status = 'deleted', updated_at = NOW() WHERE id = $1 AND creator_id = $2 AND project_status = 'active'`,
        [id, creatorId]
      );

      // Delete join requests (no longer needed)
      await client.query('DELETE FROM join_requests WHERE project_id = $1', [id]);

      await client.query('COMMIT');
      return rowCount > 0;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
};

// Project members database operations
const memberDb = {
  // Check if user is member of project (active members only)
  async isMember(projectId, userId) {
    const { rows } = await pool.query(
      `SELECT id FROM project_members WHERE project_id = $1 AND user_id = $2 AND membership_status = 'active'`,
      [projectId, userId]
    );
    return rows.length > 0;
  },

  // Get all members of a project (active members only)
  async getProjectMembers(projectId) {
    const { rows } = await pool.query(
      `SELECT pm.*, u.username, u.email
      FROM project_members pm
      JOIN users u ON pm.user_id = u.id
      WHERE pm.project_id = $1 AND pm.membership_status = 'active'
      ORDER BY pm.joined_at ASC`,
      [projectId]
    );
    return rows;
  },

  // Add member to project (github_id snapshot from join request)
  async addMember(projectId, userId, role = 'member', githubId = null) {
    const id = require('crypto').randomUUID();
    await pool.query(
      `INSERT INTO project_members (id, project_id, user_id, role, membership_status, github_id) VALUES ($1, $2, $3, $4, 'active', $5)`,
      [id, projectId, userId, role, githubId]
    );
    return { id, projectId, userId, role };
  },

  // Kick member from project (creator action)
  async kickMember(projectId, userId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get github_id before updating status
      const { rows } = await client.query(
        `SELECT github_id FROM project_members WHERE project_id = $1 AND user_id = $2 AND membership_status = 'active' AND role != 'creator'`,
        [projectId, userId]
      );
      if (rows.length === 0) {
        await client.query('COMMIT');
        return null;
      }
      const githubId = rows[0].github_id;

      // Mark as kicked
      await client.query(
        `UPDATE project_members SET membership_status = 'kicked', left_at = NOW(), github_invited = 0
         WHERE project_id = $1 AND user_id = $2`,
        [projectId, userId]
      );

      await client.query('COMMIT');
      return { kicked: true, githubId };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  // Remove member from project (soft delete — self-leave)
  async removeMember(projectId, userId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Soft delete: mark as left
      const { rowCount } = await client.query(
        `UPDATE project_members SET membership_status = 'left', left_at = NOW() WHERE project_id = $1 AND user_id = $2`,
        [projectId, userId]
      );

      // Delete join requests to allow re-joining
      await client.query(
        'DELETE FROM join_requests WHERE project_id = $1 AND user_id = $2',
        [projectId, userId]
      );

      await client.query('COMMIT');
      return rowCount > 0;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
};

// Join requests database operations
const joinRequestDb = {
  // Create join request (github_id snapshot for software projects)
  async create(projectId, userId, message = null, githubId = null) {
    const id = require('crypto').randomUUID();
    await pool.query(
      `INSERT INTO join_requests (id, project_id, user_id, status, message, github_id) VALUES ($1, $2, $3, 'pending', $4, $5)`,
      [id, projectId, userId, message, githubId]
    );
    return { id, projectId, userId, status: 'pending', message };
  },

  // Check if user has pending request
  async hasPendingRequest(projectId, userId) {
    const { rows } = await pool.query(
      `SELECT id FROM join_requests WHERE project_id = $1 AND user_id = $2 AND status = 'pending'`,
      [projectId, userId]
    );
    return rows.length > 0;
  },

  // Check if user was recently rejected (within 30 days)
  async wasRecentlyRejected(projectId, userId) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { rows } = await pool.query(
      `SELECT * FROM join_requests
      WHERE project_id = $1 AND user_id = $2 AND status = 'rejected' AND created_at > $3`,
      [projectId, userId, thirtyDaysAgo.toISOString()]
    );
    const request = rows[0];

    if (request) {
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
  async getPendingRequests(projectId) {
    const { rows } = await pool.query(
      `SELECT jr.*, u.username, u.email
      FROM join_requests jr
      JOIN users u ON jr.user_id = u.id
      WHERE jr.project_id = $1 AND jr.status = 'pending'
      ORDER BY jr.created_at DESC`,
      [projectId]
    );
    return rows;
  },

  // Get request by ID
  async findById(requestId) {
    const { rows } = await pool.query('SELECT * FROM join_requests WHERE id = $1', [requestId]);
    return rows[0] || null;
  },

  // Accept request
  async accept(requestId) {
    const { rowCount } = await pool.query(
      `UPDATE join_requests SET status = 'accepted' WHERE id = $1`,
      [requestId]
    );
    return rowCount > 0;
  },

  // Reject request
  async reject(requestId) {
    const { rowCount } = await pool.query(
      `UPDATE join_requests SET status = 'rejected' WHERE id = $1`,
      [requestId]
    );
    return rowCount > 0;
  }
};

// GitHub account database operations
const githubDb = {
  // Link GitHub account to user (save encrypted token + github info)
  async linkAccount(userId, githubId, githubUsername, encryptedToken) {
    await pool.query(
      `UPDATE users SET github_id = $1, github_username = $2, github_token = $3 WHERE id = $4`,
      [githubId, githubUsername, encryptedToken, userId]
    );
  },

  // Unlink GitHub account from user
  async unlinkAccount(userId) {
    await pool.query(
      `UPDATE users SET github_id = NULL, github_username = NULL, github_token = NULL WHERE id = $1`,
      [userId]
    );
  },

  // Find user by GitHub ID (for duplicate check)
  async findByGithubId(githubId) {
    const { rows } = await pool.query('SELECT id, username FROM users WHERE github_id = $1', [githubId]);
    return rows[0] || null;
  },

  // Get GitHub info for a user
  async getGithubInfo(userId) {
    const { rows } = await pool.query(
      'SELECT github_id, github_username, github_token FROM users WHERE id = $1',
      [userId]
    );
    return rows[0] || null;
  },

  // Update GitHub invite status for a project member
  async updateInviteStatus(projectId, userId, status) {
    await pool.query(
      `UPDATE project_members SET github_invited = $1, github_invited_at = NOW()
       WHERE project_id = $2 AND user_id = $3 AND membership_status = 'active'`,
      [status, projectId, userId]
    );
  },

  // Count invites sent for a project in the last X hours (rate limit)
  async getInviteCount(projectId, hours) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) as count FROM project_members
       WHERE project_id = $1 AND github_invited > 0
         AND github_invited_at >= NOW() - (INTERVAL '1 hour' * $2)`,
      [projectId, hours]
    );
    return Number(rows[0].count);
  }
};

module.exports = {
  pool,
  initDatabase,
  userDb,
  loginAttemptDb,
  projectDb,
  memberDb,
  joinRequestDb,
  githubDb
};
