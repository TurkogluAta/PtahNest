const { Pool, Client } = require('pg');
const { decrypt } = require('../utils/encryption');

// Safe JSON parse with fallback
function safeJsonParse(str, fallback = []) {
  try { return JSON.parse(str); } catch { return fallback; }
}

// Safe decrypt with fallback — used when surfacing the first chat message
// of a join request as a preview field. Returns null if decryption fails so
// the API never leaks ciphertext to clients.
function safeDecrypt(value) {
  if (!value) return null;
  try { return decrypt(value); } catch { return null; }
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

  // Join requests table — intro message is stored encrypted in
  // join_request_messages as the first chat message, never in plaintext here.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS join_requests (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      github_id BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(project_id, user_id)
    )
  `);

  // Temporary chat messages for join requests (deleted on accept/reject)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS join_request_messages (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      encrypted_content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      FOREIGN KEY (request_id) REFERENCES join_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_jrm_request ON join_request_messages(request_id, created_at)
  `);

  // Project chat messages (persistent, for all members)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      encrypted_content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pm_project ON project_messages(project_id, created_at)
  `);

  // Kick votes table — democratic kick system
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kick_votes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      target_user_id TEXT NOT NULL,
      initiated_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      threshold_percent INTEGER NOT NULL DEFAULT 70,
      expires_at TIMESTAMPTZ NOT NULL,
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (target_user_id) REFERENCES users(id),
      FOREIGN KEY (initiated_by) REFERENCES users(id)
    )
  `);

  // Partial unique index: only one open vote per (project, target)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS kick_votes_open_unique
    ON kick_votes (project_id, target_user_id)
    WHERE status = 'open'
  `);

  // Kick vote ballots table — one ballot per voter per vote
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kick_vote_ballots (
      id TEXT PRIMARY KEY,
      vote_id TEXT NOT NULL,
      voter_user_id TEXT NOT NULL,
      ballot TEXT NOT NULL,
      weight NUMERIC(6,2) NOT NULL DEFAULT 1,
      cast_at TIMESTAMPTZ DEFAULT NOW(),
      FOREIGN KEY (vote_id) REFERENCES kick_votes(id),
      FOREIGN KEY (voter_user_id) REFERENCES users(id),
      UNIQUE(vote_id, voter_user_id)
    )
  `);

  // Health issue acknowledgments — creator/mod can mark issues as read
  await pool.query(`
    CREATE TABLE IF NOT EXISTS health_reads (
      project_id TEXT NOT NULL,
      issue_key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      read_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (project_id, issue_key, user_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      project_id TEXT,
      project_name TEXT NOT NULL,
      meta JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      read_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS notifications_user_unread
      ON notifications(user_id) WHERE read_at IS NULL;
  `);

  // Project todos
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_todos (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      due_date DATE,
      assigned_to TEXT,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (assigned_to) REFERENCES users(id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pt_project ON project_todos(project_id, created_at)
  `);

  // Commit votes — members rate each other's commits (1-5 stars)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS commit_votes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      commit_sha TEXT NOT NULL,
      commit_author_github TEXT,
      voter_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (voter_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE (project_id, commit_sha, voter_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cv_project_sha ON commit_votes(project_id, commit_sha)
  `);

  // Certificates — one per (user, project), snapshot at time of issuance
  await pool.query(`
    CREATE TABLE IF NOT EXISTS certificates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      trigger_type TEXT NOT NULL,
      was_creator BOOLEAN NOT NULL DEFAULT FALSE,
      issued_at TIMESTAMPTZ DEFAULT NOW(),
      payload JSONB NOT NULL,
      UNIQUE (user_id, project_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_certificates_user ON certificates(user_id, issued_at DESC)
  `);

  // Mock commits table — stores fake commit metadata for mock projects (no GitHub token needed)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mock_commits (
      sha TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      author_github TEXT NOT NULL,
      message TEXT NOT NULL,
      date TIMESTAMPTZ NOT NULL,
      avatar_url TEXT
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mock_commits_project ON mock_commits(project_id, date DESC)
  `);

  console.log('Database initialized');
}

// User database operations
const userDb = {
  // Find all PtahNest user IDs that have ever been linked to a given github_id.
  // Combines: currently linked (users.github_id), past join request snapshots,
  // and past project membership snapshots. Used to prevent ban/cooldown bypass
  // via GitHub unlink + new account.
  async findUserIdsByGithubId(githubId) {
    if (!githubId) return [];
    const { rows } = await pool.query(
      `SELECT DISTINCT user_id FROM (
         SELECT id AS user_id FROM users WHERE github_id = $1
         UNION
         SELECT user_id FROM join_requests WHERE github_id = $1
         UNION
         SELECT user_id FROM project_members WHERE github_id = $1
       ) AS combined`,
      [githubId]
    );
    return rows.map(r => r.user_id);
  },

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
  },

  // Update profile fields dynamically — only provided fields are updated
  async updateProfile(userId, { username, email, password }) {
    const sets = [];
    const values = [];
    let i = 1;

    if (username !== undefined) {
      sets.push(`username = $${i++}`, `username_lower = $${i++}`);
      values.push(username, username.toLowerCase());
    }
    if (email !== undefined) {
      sets.push(`email = $${i++}`);
      values.push(email.toLowerCase());
    }
    if (password !== undefined) {
      sets.push(`password = $${i++}`);
      values.push(password);
    }

    if (sets.length === 0) return;
    values.push(userId);
    await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${i}`, values);
  },

  // Public profile: basic info + active project history (for join request preview)
  async getPublicProfile(userId, viewerUserId) {
    const { rows: userRows } = await pool.query(
      'SELECT id, username, created_at, github_username, github_id FROM users WHERE id = $1',
      [userId]
    );
    if (!userRows[0]) return null;
    const user = userRows[0];

    // Get all projects user is/was an active member of
    const { rows: projectRows } = await pool.query(
      `SELECT p.id, p.name, p.project_type, p.github_repo, pm.role, pm.membership_status, pm.joined_at
       FROM project_members pm
       JOIN projects p ON pm.project_id = p.id
       WHERE pm.user_id = $1 AND p.project_status != 'deleted'
       ORDER BY pm.joined_at DESC`,
      [userId]
    );

    // Get viewer's project memberships to check repo visibility
    const { rows: viewerProjects } = viewerUserId
      ? await pool.query(
          `SELECT project_id FROM project_members WHERE user_id = $1 AND membership_status = 'active'`,
          [viewerUserId]
        )
      : { rows: [] };
    const viewerProjectIds = new Set(viewerProjects.map(r => r.project_id));

    const projects = projectRows.map(p => ({
      id: p.id,
      name: p.name,
      role: p.role,
      membership_status: p.membership_status,
      project_type: p.project_type,
      joined_at: p.joined_at,
      // Only show repo if viewer is also a member of that project
      github_repo: viewerProjectIds.has(p.id) ? (p.github_repo || null) : (p.github_repo ? { private: true } : null)
    }));

    return {
      id: user.id,
      username: user.username,
      created_at: user.created_at,
      github_username: user.github_id ? user.github_username : null,
      projects
    };
  },

  // Just the github_username for a user (null if not linked)
  async getGithubUsername(userId) {
    const { rows } = await pool.query(
      `SELECT github_username FROM users WHERE id = $1`,
      [userId]
    );
    return rows[0]?.github_username || null;
  },

  // Encrypted github_token for a user (null if not linked) — caller must decrypt
  async getEncryptedGithubToken(userId) {
    const { rows } = await pool.query(
      `SELECT github_token FROM users WHERE id = $1`,
      [userId]
    );
    return rows[0]?.github_token || null;
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

    return { id, name, description, project_status: 'active', status: 'active', tags, lookingFor, recruitmentOpen, githubRepo, projectType, members: 1 };
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
      // Build the full set of user_ids that share this user's github_id (bypass prevention).
      // If user has no GitHub linked, list is just [userId].
      const githubInfo = await githubDb.getGithubInfo(userId);
      const linkedIds = githubInfo && githubInfo.github_id
        ? await userDb.findUserIdsByGithubId(githubInfo.github_id)
        : [];
      const allUserIds = Array.from(new Set([userId, ...linkedIds]));

      // Logged in: exclude projects where user is ACTIVE member, has pending request,
      // OR was previously kicked/left (under any account sharing the same github_id)
      const result = await pool.query(
        `SELECT p.*, u.username as creator_username,
          (SELECT COUNT(*) FROM project_members WHERE project_id = p.id AND membership_status = 'active') as members
        FROM projects p
        JOIN users u ON p.creator_id = u.id
        WHERE p.project_status = 'active'
          AND p.recruitment_open = TRUE
          AND p.id NOT IN (
            SELECT project_id FROM project_members WHERE user_id = ANY($1::text[]) AND membership_status = 'active'
          )
          AND p.id NOT IN (
            SELECT project_id FROM join_requests WHERE user_id = ANY($1::text[]) AND status = 'pending'
          )
          AND p.id NOT IN (
            SELECT project_id FROM project_members WHERE user_id = ANY($1::text[]) AND membership_status IN ('kicked', 'left')
          )
        ORDER BY p.created_at DESC`,
        [allUserIds]
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
        `SELECT p.*, pm.role, pm.membership_status AS member_status FROM projects p
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
      role: row.role || null,
      memberStatus: row.member_status || null
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

  // Get active software projects where user is a non-creator member (used for unlink check)
  async getActiveSoftwareProjectsAsMember(userId) {
    const { rows } = await pool.query(
      `SELECT p.id, p.name FROM project_members pm
       JOIN projects p ON pm.project_id = p.id
       WHERE pm.user_id = $1 AND pm.membership_status = 'active' AND pm.role != 'creator'
       AND p.project_status = 'active' AND p.project_type = 'software'`,
      [userId]
    );
    return rows;
  },

  // Get all members of a project (active members only)
  async getProjectMembers(projectId) {
    const { rows } = await pool.query(
      `SELECT pm.*, u.username, u.email, u.github_username
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

  // Check if user has moderator role on the project (active only)
  async isModerator(projectId, userId) {
    if (!userId) return false;
    const { rows } = await pool.query(
      `SELECT id FROM project_members WHERE project_id = $1 AND user_id = $2 AND role = 'moderator' AND membership_status = 'active'`,
      [projectId, userId]
    );
    return rows.length > 0;
  },

  // Check if user has management role (creator or moderator)
  async hasManagementRole(projectId, userId) {
    if (!userId) return false;
    const { rows } = await pool.query(
      `SELECT pm.role, p.creator_id FROM project_members pm
       JOIN projects p ON pm.project_id = p.id
       WHERE pm.project_id = $1 AND pm.user_id = $2 AND pm.membership_status = 'active'`,
      [projectId, userId]
    );
    if (rows.length === 0) return false;
    const row = rows[0];
    return row.creator_id === userId || row.role === 'moderator';
  },

  // Promote/demote member role (only between 'member' and 'moderator')
  async setRole(projectId, userId, newRole) {
    if (newRole !== 'member' && newRole !== 'moderator') return false;
    // Cannot change creator role via this method
    const { rowCount } = await pool.query(
      `UPDATE project_members SET role = $1
       WHERE project_id = $2 AND user_id = $3 AND membership_status = 'active' AND role != 'creator'`,
      [newRole, projectId, userId]
    );
    return rowCount > 0;
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
  },

  // Health: active members with no GitHub invite sent (software projects)
  async getInviteNotSent(projectId) {
    const { rows } = await pool.query(
      `SELECT pm.user_id, pm.github_id, u.username
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1
         AND pm.membership_status = 'active'
         AND pm.github_invited = 0
         AND pm.role != 'creator'`,
      [projectId]
    );
    return rows;
  },

  // Health: active members with invite pending > 7 days
  async getInviteStuck(projectId) {
    const { rows } = await pool.query(
      `SELECT pm.user_id, pm.github_id, u.username, pm.github_invited_at
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1
         AND pm.membership_status = 'active'
         AND pm.github_invited = 1
         AND pm.github_invited_at < NOW() - INTERVAL '7 days'`,
      [projectId]
    );
    return rows;
  },

  // Health: active members who accepted invite (github_invited=2) — used for collaborator check
  async getAcceptedMembers(projectId) {
    const { rows } = await pool.query(
      `SELECT pm.user_id, pm.github_id, u.username
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1
         AND pm.membership_status = 'active'
         AND pm.github_invited = 2
         AND pm.role != 'creator'`,
      [projectId]
    );
    return rows;
  },

  // Find any past or present membership for a given github_id (kicked/left/active snapshot check)
  async findByGithubId(projectId, githubId) {
    const { rows } = await pool.query(
      `SELECT membership_status FROM project_members WHERE project_id = $1 AND github_id = $2`,
      [projectId, githubId]
    );
    return rows[0] || null;
  },

  // Most recent past membership (left or kicked) across a set of linked user accounts
  async findMostRecentPastMembership(projectId, userIds) {
    const { rows } = await pool.query(
      `SELECT membership_status, left_at FROM project_members
       WHERE project_id = $1 AND user_id = ANY($2::text[]) AND membership_status IN ('left', 'kicked')
       ORDER BY left_at DESC LIMIT 1`,
      [projectId, userIds]
    );
    return rows[0] || null;
  },

  // Active membership row with joined_at (for kick-vote eligibility check)
  async findActiveWithJoinedAt(projectId, userId) {
    const { rows } = await pool.query(
      `SELECT joined_at FROM project_members WHERE project_id = $1 AND user_id = $2 AND membership_status = 'active'`,
      [projectId, userId]
    );
    return rows[0] || null;
  },

  // All active members except a target user, with github_username (for kick-vote eligibility list)
  async getEligibleVoters(projectId, excludeUserId) {
    const { rows } = await pool.query(
      `SELECT pm.user_id, u.github_username
       FROM project_members pm
       JOIN users u ON pm.user_id = u.id
       WHERE pm.project_id = $1 AND pm.membership_status = 'active' AND pm.user_id != $2`,
      [projectId, excludeUserId]
    );
    return rows;
  }
};

// Join requests database operations
const joinRequestDb = {
  // Create join request. Any intro message is stored encrypted in
  // join_request_messages by the caller; nothing is persisted in plaintext here.
  async create(projectId, userId, githubId = null) {
    const id = require('crypto').randomUUID();
    await pool.query(
      `INSERT INTO join_requests (id, project_id, user_id, status, github_id) VALUES ($1, $2, $3, 'pending', $4)`,
      [id, projectId, userId, githubId]
    );
    return { id, projectId, userId, status: 'pending' };
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
  // Accepts a single userId or an array of userIds (for github_id-based bypass prevention)
  async wasRecentlyRejected(projectId, userIdOrIds) {
    const userIds = Array.isArray(userIdOrIds) ? userIdOrIds : [userIdOrIds];
    if (userIds.length === 0) return { blocked: false };

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { rows } = await pool.query(
      `SELECT * FROM join_requests
      WHERE project_id = $1 AND user_id = ANY($2::text[]) AND status = 'rejected' AND created_at > $3
      ORDER BY created_at DESC LIMIT 1`,
      [projectId, userIds, thirtyDaysAgo.toISOString()]
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

  // Get all pending requests for a project (includes applicant's avg certificate rating)
  async getPendingRequests(projectId) {
    const { rows } = await pool.query(
      `SELECT jr.*, u.username, u.email, u.github_username,
              (SELECT m.encrypted_content FROM join_request_messages m WHERE m.request_id = jr.id AND m.sender_id = jr.user_id ORDER BY m.created_at ASC LIMIT 1) as intro_message_encrypted,
              (SELECT m.sender_id FROM join_request_messages m WHERE m.request_id = jr.id ORDER BY m.created_at DESC LIMIT 1) as last_message_sender_id,
              (SELECT COUNT(*) FROM join_request_messages m WHERE m.request_id = jr.id AND m.sender_id != jr.user_id) as management_message_count,
              (SELECT ROUND(AVG(sub.avg_rating), 1) FROM (
                SELECT (SELECT AVG((elem->>'rating')::numeric) FROM jsonb_array_elements(c.payload->'timeline') AS elem WHERE elem->>'rating' IS NOT NULL) AS avg_rating
                FROM certificates c WHERE c.user_id = jr.user_id
              ) sub WHERE sub.avg_rating IS NOT NULL) as applicant_avg_rating,
              (SELECT COUNT(*) FROM certificates c WHERE c.user_id = jr.user_id) as applicant_cert_count
      FROM join_requests jr
      JOIN users u ON jr.user_id = u.id
      WHERE jr.project_id = $1 AND jr.status = 'pending'
      ORDER BY jr.created_at DESC`,
      [projectId]
    );
    // Decrypt the applicant's first chat message and expose it as `message`
    // for backward compatibility with the existing frontend preview UI.
    return rows.map(r => {
      const { intro_message_encrypted, ...rest } = r;
      return { ...rest, message: safeDecrypt(intro_message_encrypted) };
    });
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
  },

  // Get all pending requests by user (applicant side)
  async cancelRequest(requestId, userId) {
    const { rowCount } = await pool.query(
      `DELETE FROM join_requests WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
      [requestId, userId]
    );
    return rowCount > 0;
  },

  async getByUserId(userId) {
    const { rows } = await pool.query(
      `SELECT jr.id, jr.project_id, jr.status, jr.created_at,
              p.name as project_name, p.description, p.tags, p.github_repo, p.project_type,
              (SELECT m.encrypted_content FROM join_request_messages m WHERE m.request_id = jr.id AND m.sender_id = jr.user_id ORDER BY m.created_at ASC LIMIT 1) as intro_message_encrypted,
              (SELECT m.created_at FROM join_request_messages m WHERE m.request_id = jr.id ORDER BY m.created_at DESC LIMIT 1) as last_message_at,
              (SELECT m.sender_id FROM join_request_messages m WHERE m.request_id = jr.id ORDER BY m.created_at DESC LIMIT 1) as last_message_sender_id
       FROM join_requests jr
       JOIN projects p ON p.id = jr.project_id
       WHERE jr.user_id = $1 AND jr.status = 'pending' AND p.project_status = 'active'
       ORDER BY jr.created_at DESC`,
      [userId]
    );
    return rows.map(r => {
      const { intro_message_encrypted, ...rest } = r;
      return { ...rest, message: safeDecrypt(intro_message_encrypted) };
    });
  },

  // Active (pending/accepted) request snapshot tied to a github_id (cross-account block)
  async findActiveByGithubId(projectId, githubId) {
    const { rows } = await pool.query(
      `SELECT status FROM join_requests WHERE project_id = $1 AND github_id = $2 AND status IN ('pending', 'accepted')`,
      [projectId, githubId]
    );
    return rows[0] || null;
  },

  // Any pending request across a set of linked user accounts
  async hasPendingForUsers(projectId, userIds) {
    const { rows } = await pool.query(
      `SELECT id FROM join_requests
       WHERE project_id = $1 AND user_id = ANY($2::text[]) AND status = 'pending' LIMIT 1`,
      [projectId, userIds]
    );
    return rows.length > 0;
  },

  // Purge old rejected requests across a set of linked user accounts
  async deleteRejectedForUsers(projectId, userIds) {
    await pool.query(
      `DELETE FROM join_requests WHERE project_id = $1 AND user_id = ANY($2::text[]) AND status = 'rejected'`,
      [projectId, userIds]
    );
  }
};

// Temporary chat messages for join requests
const joinRequestMessageDb = {
  async create(requestId, senderId, encryptedContent) {
    const id = require('crypto').randomUUID();
    await pool.query(
      `INSERT INTO join_request_messages (id, request_id, sender_id, encrypted_content) VALUES ($1, $2, $3, $4)`,
      [id, requestId, senderId, encryptedContent]
    );
    return id;
  },

  async getByRequestId(requestId) {
    const { rows } = await pool.query(
      `SELECT m.id, m.request_id, m.sender_id, m.encrypted_content, m.created_at,
              u.username as sender_username,
              pm.role as sender_role
       FROM join_request_messages m
       JOIN users u ON m.sender_id = u.id
       LEFT JOIN join_requests jr ON jr.id = m.request_id
       LEFT JOIN project_members pm ON pm.project_id = jr.project_id
                                   AND pm.user_id = m.sender_id
                                   AND pm.membership_status = 'active'
       WHERE m.request_id = $1
       ORDER BY m.created_at ASC`,
      [requestId]
    );
    return rows;
  },

  async deleteByRequestId(requestId) {
    await pool.query('DELETE FROM join_request_messages WHERE request_id = $1', [requestId]);
  }
};

// Kick voting database operations
const kickVoteDb = {
  // Create a new kick vote (72h expiry by default)
  async create(projectId, targetUserId, initiatedBy) {
    const id = require('crypto').randomUUID();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    await pool.query(
      `INSERT INTO kick_votes (id, project_id, target_user_id, initiated_by, status, expires_at)
       VALUES ($1, $2, $3, $4, 'open', $5)`,
      [id, projectId, targetUserId, initiatedBy, expiresAt]
    );
    return { id, projectId, targetUserId, initiatedBy, status: 'open', expiresAt };
  },

  // Get the open vote for a specific target (null if none)
  async getOpenVote(projectId, targetUserId) {
    const { rows } = await pool.query(
      `SELECT kv.*, u.username as target_username, ui.username as initiator_username
       FROM kick_votes kv
       JOIN users u ON kv.target_user_id = u.id
       JOIN users ui ON kv.initiated_by = ui.id
       WHERE kv.project_id = $1 AND kv.target_user_id = $2 AND kv.status = 'open'`,
      [projectId, targetUserId]
    );
    return rows[0] || null;
  },

  // Get all votes for a project (open + closed), with weighted ballot sums
  async getVotesForProject(projectId) {
    const { rows } = await pool.query(
      `SELECT kv.*,
         u.username as target_username,
         ui.username as initiator_username,
         COALESCE(SUM(CASE WHEN kvb.ballot = 'yes' THEN kvb.weight ELSE 0 END), 0) as yes_weight,
         COALESCE(SUM(CASE WHEN kvb.ballot = 'no' THEN kvb.weight ELSE 0 END), 0) as no_weight,
         COALESCE(SUM(kvb.weight), 0) as total_weight,
         COUNT(kvb.id) as total_voted
       FROM kick_votes kv
       JOIN users u ON kv.target_user_id = u.id
       JOIN users ui ON kv.initiated_by = ui.id
       LEFT JOIN kick_vote_ballots kvb ON kv.id = kvb.vote_id
       WHERE kv.project_id = $1
       GROUP BY kv.id, u.username, ui.username
       ORDER BY kv.created_at DESC`,
      [projectId]
    );
    return rows;
  },

  // Get a single vote by ID with weighted ballot sums
  async findById(voteId) {
    const { rows } = await pool.query(
      `SELECT kv.*,
         u.username as target_username,
         ui.username as initiator_username,
         COALESCE(SUM(CASE WHEN kvb.ballot = 'yes' THEN kvb.weight ELSE 0 END), 0) as yes_weight,
         COALESCE(SUM(CASE WHEN kvb.ballot = 'no' THEN kvb.weight ELSE 0 END), 0) as no_weight,
         COALESCE(SUM(kvb.weight), 0) as total_weight,
         COUNT(kvb.id) as total_voted
       FROM kick_votes kv
       JOIN users u ON kv.target_user_id = u.id
       JOIN users ui ON kv.initiated_by = ui.id
       LEFT JOIN kick_vote_ballots kvb ON kv.id = kvb.vote_id
       WHERE kv.id = $1
       GROUP BY kv.id, u.username, ui.username`,
      [voteId]
    );
    return rows[0] || null;
  },

  // Cast or update a ballot (upsert), weight stored for weighted threshold check
  async castBallot(voteId, voterUserId, ballot, weight = 1) {
    const id = require('crypto').randomUUID();
    await pool.query(
      `INSERT INTO kick_vote_ballots (id, vote_id, voter_user_id, ballot, weight)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (vote_id, voter_user_id) DO UPDATE SET ballot = $4, weight = $5, cast_at = NOW()`,
      [id, voteId, voterUserId, ballot, weight]
    );
  },

  // Get voter's ballot for a vote
  async getBallot(voteId, voterUserId) {
    const { rows } = await pool.query(
      `SELECT ballot FROM kick_vote_ballots WHERE vote_id = $1 AND voter_user_id = $2`,
      [voteId, voterUserId]
    );
    return rows[0] ? rows[0].ballot : null;
  },

  // Resolve a vote (passed/failed/cancelled)
  async resolve(voteId, finalStatus) {
    await pool.query(
      `UPDATE kick_votes SET status = $1, resolved_at = NOW() WHERE id = $2`,
      [finalStatus, voteId]
    );
  },

  // Get open votes for all projects where user is an active member (for bell notifications)
  async getPendingForUser(userId) {
    const { rows } = await pool.query(
      `SELECT kv.*, p.name as project_name,
         u.username as target_username,
         ui.username as initiator_username
       FROM kick_votes kv
       JOIN projects p ON kv.project_id = p.id
       JOIN users u ON kv.target_user_id = u.id
       JOIN users ui ON kv.initiated_by = ui.id
       JOIN project_members pm ON kv.project_id = pm.project_id AND pm.user_id = $1
       LEFT JOIN kick_vote_ballots kvb ON kv.id = kvb.vote_id AND kvb.voter_user_id = $1
       WHERE kv.status = 'open'
         AND kv.target_user_id != $1
         AND pm.membership_status = 'active'
         AND kvb.id IS NULL
       ORDER BY kv.created_at DESC`,
      [userId]
    );
    return rows;
  },

  // Health: open kick votes that have passed their expiry (lazy resolve didn't run)
  async getExpiredOpen(projectId) {
    const { rows } = await pool.query(
      `SELECT kv.id, kv.expires_at, u.username as target_username
       FROM kick_votes kv
       JOIN users u ON u.id = kv.target_user_id
       WHERE kv.project_id = $1
         AND kv.status = 'open'
         AND kv.expires_at < NOW()`,
      [projectId]
    );
    return rows;
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
  },

  // Mock commits for projects whose repo name contains "mock" (demo/testing flow)
  async getMockCommits(projectId) {
    const { rows } = await pool.query(
      `SELECT mc.sha, mc.author_github, mc.message, mc.date,
              u.username AS author
       FROM mock_commits mc
       LEFT JOIN users u ON u.github_username = mc.author_github
       WHERE mc.project_id = $1
       ORDER BY mc.date DESC`,
      [projectId]
    );
    return rows;
  }
};

const healthReadDb = {
  // Get all acks for a project — returns [{issue_key, role}, ...]
  async getReadsForProject(projectId) {
    const { rows } = await pool.query(
      `SELECT issue_key, role FROM health_reads WHERE project_id = $1`,
      [projectId]
    );
    return rows;
  },

  // Mark an issue as read — idempotent (ON CONFLICT DO NOTHING)
  async markRead(projectId, issueKey, userId, role) {
    await pool.query(
      `INSERT INTO health_reads (project_id, issue_key, user_id, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, issue_key, user_id) DO NOTHING`,
      [projectId, issueKey, userId, role]
    );
  },

  // Unmark an issue — delete the row
  async markUnread(projectId, issueKey, userId) {
    await pool.query(
      `DELETE FROM health_reads WHERE project_id = $1 AND issue_key = $2 AND user_id = $3`,
      [projectId, issueKey, userId]
    );
  },

  // Dismiss an issue entirely — removes all acks for this issue key
  async dismissIssue(projectId, issueKey) {
    await pool.query(
      `DELETE FROM health_reads WHERE project_id = $1 AND issue_key = $2`,
      [projectId, issueKey]
    );
  },

  // Check if issue is resolved by creator
  async isResolvedByCreator(projectId, issueKey) {
    const { rows } = await pool.query(
      `SELECT 1 FROM health_reads WHERE project_id = $1 AND issue_key = $2 AND role = 'creator' LIMIT 1`,
      [projectId, issueKey]
    );
    return rows.length > 0;
  }
};

// Project todos database operations
const projectTodoDb = {
  async create(projectId, createdBy, { title, description, dueDate, assignedTo }) {
    const id = require('crypto').randomUUID();
    await pool.query(
      `INSERT INTO project_todos (id, project_id, created_by, title, description, due_date, assigned_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, projectId, createdBy, title, description || null, dueDate || null, assignedTo || null]
    );
    return id;
  },

  async getByProjectId(projectId) {
    const { rows } = await pool.query(
      `SELECT t.id, t.project_id, t.created_by, t.assigned_to, t.title, t.description, t.due_date, t.completed, t.created_at,
              u.username as created_by_username,
              a.username as assigned_to_username
       FROM project_todos t
       JOIN users u ON t.created_by = u.id
       LEFT JOIN users a ON t.assigned_to = a.id
       WHERE t.project_id = $1
       ORDER BY t.created_at ASC`,
      [projectId]
    );
    return rows;
  },

  async findById(todoId, projectId) {
    const { rows } = await pool.query(
      `SELECT id, project_id, created_by, title, description, due_date, assigned_to, completed
       FROM project_todos WHERE id = $1 AND project_id = $2`,
      [todoId, projectId]
    );
    return rows[0] || null;
  },

  async toggleComplete(todoId, projectId) {
    await pool.query(
      `UPDATE project_todos SET completed = NOT completed
       WHERE id = $1 AND project_id = $2`,
      [todoId, projectId]
    );
  },

  async update(todoId, projectId, { title, description, dueDate, assignedTo }) {
    await pool.query(
      `UPDATE project_todos
       SET title = $3, description = $4, due_date = $5, assigned_to = $6
       WHERE id = $1 AND project_id = $2`,
      [todoId, projectId, title, description || null, dueDate || null, assignedTo || null]
    );
  },

  async delete(todoId, projectId) {
    await pool.query(
      `DELETE FROM project_todos WHERE id = $1 AND project_id = $2`,
      [todoId, projectId]
    );
  }
};

// Project chat messages database operations
const projectMessageDb = {
  async create(projectId, senderId, encryptedContent) {
    const id = require('crypto').randomUUID();
    await pool.query(
      `INSERT INTO project_messages (id, project_id, sender_id, encrypted_content) VALUES ($1, $2, $3, $4)`,
      [id, projectId, senderId, encryptedContent]
    );
    return id;
  },

  async getByProjectId(projectId) {
    const { rows } = await pool.query(
      `SELECT m.id, m.project_id, m.sender_id, m.encrypted_content, m.created_at,
              u.username as sender_username,
              pm.role as sender_role
       FROM project_messages m
       JOIN users u ON m.sender_id = u.id
       LEFT JOIN project_members pm ON pm.project_id = m.project_id
                                    AND pm.user_id = m.sender_id
                                    AND pm.membership_status = 'active'
       WHERE m.project_id = $1
       ORDER BY m.created_at ASC
       LIMIT 200`,
      [projectId]
    );
    return rows;
  }
};

const notificationDb = {
  async create(userId, type, projectId, projectName, meta = null) {
    const id = require('crypto').randomUUID();
    await pool.query(
      `INSERT INTO notifications (id, user_id, type, project_id, project_name, meta)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, userId, type, projectId, projectName, meta ? JSON.stringify(meta) : null]
    );
    return id;
  },

  async getUnread(userId) {
    const { rows } = await pool.query(
      `SELECT id, type, project_id, project_name, meta, created_at
       FROM notifications
       WHERE user_id = $1 AND read_at IS NULL
       ORDER BY created_at DESC`,
      [userId]
    );
    return rows;
  },

  async markRead(notificationId, userId) {
    await pool.query(
      `UPDATE notifications SET read_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [notificationId, userId]
    );
  },

  async markAllRead(userId) {
    await pool.query(
      `UPDATE notifications SET read_at = NOW()
       WHERE user_id = $1 AND read_at IS NULL`,
      [userId]
    );
  }
};

// Commit vote database operations
const commitVoteDb = {
  // Upsert: cast or update a rating for a commit (commitAuthorGithub stored for leaderboard)
  async upsert(projectId, sha, voterId, rating, commitAuthorGithub) {
    const id = crypto.randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO commit_votes (id, project_id, commit_sha, commit_author_github, voter_id, rating)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (project_id, commit_sha, voter_id)
       DO UPDATE SET rating = EXCLUDED.rating, commit_author_github = EXCLUDED.commit_author_github, updated_at = NOW()
       RETURNING *`,
      [id, projectId, sha, commitAuthorGithub || null, voterId, rating]
    );
    return rows[0];
  },

  // Remove a vote (toggle-off)
  async remove(projectId, sha, voterId) {
    await pool.query(
      `DELETE FROM commit_votes WHERE project_id=$1 AND commit_sha=$2 AND voter_id=$3`,
      [projectId, sha, voterId]
    );
  },

  // Get avg rating + count per sha for a list of shas
  async getAverages(projectId, shas) {
    if (!shas.length) return {};
    const { rows } = await pool.query(
      `SELECT commit_sha, AVG(rating)::numeric(3,1) AS avg_rating, COUNT(*)::int AS vote_count
       FROM commit_votes
       WHERE project_id = $1 AND commit_sha = ANY($2::text[])
       GROUP BY commit_sha`,
      [projectId, shas]
    );
    const map = {};
    rows.forEach(r => { map[r.commit_sha] = { avg: parseFloat(r.avg_rating), count: r.vote_count }; });
    return map;
  },

  // Leaderboard: sum of ratings per commit author (GitHub username), normalized to 100 pts total.
  // Returns array: [{ githubUsername, score, commits, avgRating, normalizedWeight }]
  // normalizedWeight is 0-100 float, all members sum to 100.
  async getLeaderboard(projectId) {
    // Pull vote stats per author
    const { rows: voteRows } = await pool.query(
      `SELECT commit_author_github AS github_username,
              COUNT(DISTINCT commit_sha)::int AS commits,
              SUM(rating)::numeric AS total_rating,
              AVG(rating)::numeric(3,1) AS avg_rating
       FROM commit_votes
       WHERE project_id = $1 AND commit_author_github IS NOT NULL
       GROUP BY commit_author_github`,
      [projectId]
    );

    // Pull all active members with linked GitHub so unstarred members still appear
    const { rows: memberRows } = await pool.query(
      `SELECT u.github_username
       FROM project_members pm
       JOIN users u ON pm.user_id = u.id
       WHERE pm.project_id = $1 AND pm.membership_status = 'active' AND u.github_username IS NOT NULL`,
      [projectId]
    );

    // Merge: every active member gets a base weight of 1; vote totals stack on top
    const map = {};
    for (const m of memberRows) {
      map[m.github_username] = { github_username: m.github_username, commits: 0, total_rating: 0, avg_rating: 0 };
    }
    for (const v of voteRows) {
      if (!map[v.github_username]) map[v.github_username] = { github_username: v.github_username, commits: 0, total_rating: 0, avg_rating: 0 };
      map[v.github_username].commits = v.commits;
      map[v.github_username].total_rating = parseFloat(v.total_rating);
      map[v.github_username].avg_rating = parseFloat(v.avg_rating);
    }

    const merged = Object.values(map).map(r => ({
      ...r,
      // Effective score = vote total + 5 base (gives early-stage members democratic weight,
      // meritocracy kicks in as votes accumulate)
      effective: r.total_rating + 5
    }));

    const totalEffective = merged.reduce((sum, r) => sum + r.effective, 0);
    return merged
      .map(r => ({
        githubUsername: r.github_username,
        commits: r.commits,
        avgRating: r.avg_rating,
        score: r.total_rating,
        normalizedWeight: totalEffective > 0 ? (r.effective / totalEffective) * 100 : 0
      }))
      .sort((a, b) => b.score - a.score);
  },

  // Get normalized weight (0-100) for a single GitHub username in a project.
  // Used by kick ballot to determine voter's influence.
  async getWeight(projectId, githubUsername) {
    const leaderboard = await this.getLeaderboard(projectId);
    const entry = leaderboard.find(e => e.githubUsername === githubUsername);
    return entry ? entry.normalizedWeight : 0;
  },

  // Get the current user's votes for a list of shas
  async getUserVotes(projectId, voterId, shas) {
    if (!shas.length) return {};
    const { rows } = await pool.query(
      `SELECT commit_sha, rating FROM commit_votes
       WHERE project_id=$1 AND voter_id=$2 AND commit_sha = ANY($3::text[])`,
      [projectId, voterId, shas]
    );
    const map = {};
    rows.forEach(r => { map[r.commit_sha] = r.rating; });
    return map;
  }
};

const certificateDb = {
  // Insert certificate — silently skip if one already exists for (user, project)
  async create(userId, projectId, triggerType, wasCreator, payload) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO certificates (id, user_id, project_id, trigger_type, was_creator, payload)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, project_id) DO NOTHING`,
      [id, userId, projectId, triggerType, wasCreator, JSON.stringify(payload)]
    );
    return id;
  },

  // Get all certificates for a user (newest first), without heavy payload
  async getByUser(userId) {
    const { rows } = await pool.query(
      `SELECT id, project_id, trigger_type, was_creator, issued_at,
              payload->>'projectName' AS project_name,
              payload->>'username' AS username,
              (
                SELECT ROUND(AVG((elem->>'rating')::numeric), 1)
                FROM jsonb_array_elements(payload->'timeline') AS elem
                WHERE elem->>'rating' IS NOT NULL
              ) AS avg_rating
       FROM certificates WHERE user_id = $1 ORDER BY issued_at DESC`,
      [userId]
    );
    return rows;
  },

  // Get single certificate by ID
  async findById(certId) {
    const { rows } = await pool.query(
      `SELECT * FROM certificates WHERE id = $1`,
      [certId]
    );
    return rows[0] || null;
  },

  // Public verification view — limited fields, no sensitive payload
  async findVerificationById(certId) {
    const { rows } = await pool.query(
      `SELECT c.id, c.trigger_type, c.was_creator, c.issued_at,
              c.payload->>'projectName' AS project_name,
              c.payload->>'username' AS username,
              c.payload->>'issuedMonth' AS issued_month,
              c.payload->>'projectType' AS project_type,
              jsonb_array_length(c.payload->'timeline') AS commit_count,
              (
                SELECT ROUND(AVG((elem->>'rating')::numeric), 1)
                FROM jsonb_array_elements(c.payload->'timeline') AS elem
                WHERE elem->>'rating' IS NOT NULL
              ) AS avg_rating,
              c.payload->>'githubUsername' AS github_username,
              c.payload->'monthlyEffortPie' AS effort_pie
       FROM certificates c WHERE c.id = $1`,
      [certId]
    );
    return rows[0] || null;
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
  joinRequestMessageDb,
  projectMessageDb,
  projectTodoDb,
  githubDb,
  kickVoteDb,
  healthReadDb,
  commitVoteDb,
  notificationDb,
  certificateDb
};
