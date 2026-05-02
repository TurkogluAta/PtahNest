const request = require('supertest');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool, initDatabase } = require('../src/models/database');

// Track if database is already initialized in this process
let dbInitialized = false;

// Initialize test database tables (only once per process)
async function setupDatabase() {
  if (dbInitialized) return;
  await initDatabase();
  dbInitialized = true;
}

// Clean all test data from database
async function cleanDatabase() {
  await pool.query('DELETE FROM notifications');
  await pool.query('DELETE FROM kick_vote_ballots');
  await pool.query('DELETE FROM kick_votes');
  await pool.query('DELETE FROM join_requests');
  await pool.query('DELETE FROM project_members');
  await pool.query('DELETE FROM projects');
  await pool.query('DELETE FROM login_attempts');
  await pool.query('DELETE FROM users');
}

// Create a test user directly in DB (bypasses API)
async function createTestUser(overrides = {}) {
  const id = crypto.randomUUID();
  const username = overrides.username || `testuser_${id.slice(0, 8)}`;
  const email = overrides.email || `${username}@test.com`;
  const password = overrides.password || 'TestPass1!';
  const hashedPassword = await bcrypt.hash(password, 4);

  await pool.query(
    'INSERT INTO users (id, username, username_lower, email, password) VALUES ($1, $2, $3, $4, $5)',
    [id, username, username.toLowerCase(), email.toLowerCase(), hashedPassword]
  );

  return { id, username, email: email.toLowerCase(), password };
}

// Register and login via API, returns agent with session cookie
async function registerAndLogin(app, overrides = {}) {
  const agent = request.agent(app);
  const username = overrides.username || `user_${crypto.randomUUID().slice(0, 8)}`;
  const email = overrides.email || `${username}@test.com`;
  const password = overrides.password || 'TestPass1!';

  await agent
    .post('/api/auth/register')
    .send({
      username,
      email,
      password,
      deviceId: 'test-device-id',
      deviceFingerprint: { screenResolution: '1920x1080', timezone: 'UTC' }
    });

  return { agent, username, email, password };
}

module.exports = {
  setupDatabase,
  cleanDatabase,
  createTestUser,
  registerAndLogin,
  pool
};
