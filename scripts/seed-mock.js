'use strict';

/**
 * Mock data seed for PtahNest presentations.
 * Run: node scripts/seed-mock.js
 *
 * Creates 5 users, 4 projects, realistic commit histories (stored in mock_commits),
 * commit votes, leaderboard weights, kick vote, todos, chat, and certificates.
 * All mock entities labelled "(mock)".
 * Safe to re-run — skips existing rows.
 */

require('dotenv').config();

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool, initDatabase } = require('../src/models/database');
const { encrypt } = require('../src/utils/encryption');

// ─── Stable IDs ──────────────────────────────────────────────────────────────

const ID = {
  alice: '00000000-0000-4000-a000-000000000001',
  bob:   '00000000-0000-4000-a000-000000000002',
  carol: '00000000-0000-4000-a000-000000000003',
  dave:  '00000000-0000-4000-a000-000000000004',
  eve:   '00000000-0000-4000-a000-000000000005',

  proj1: '00000000-0000-4000-b000-000000000001', // software, completed
  proj2: '00000000-0000-4000-b000-000000000002', // software, active
  proj3: '00000000-0000-4000-b000-000000000003', // software, active + open kick vote
  proj4: '00000000-0000-4000-b000-000000000004', // research, active
  proj5: '00000000-0000-4000-b000-000000000005', // software, active — full cycle test (alice creator)
};

function uuid() { return crypto.randomUUID(); }

function daysAgo(n, h = 12) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
}

async function skip(table, col, val) {
  const r = await pool.query(`SELECT 1 FROM ${table} WHERE ${col}=$1`, [val]);
  return r.rows.length > 0;
}

async function run() {
  await initDatabase();
  console.log('Seeding mock data...\n');

  // ─── 1. USERS ─────────────────────────────────────────────────────────────
  const password = await bcrypt.hash('Mock1234!', 12);

  const users = [
    { id: ID.alice, username: 'alice_mock', email: 'alice@mock.ptahnest', ghId: 10000001, ghUser: 'alice-mock-gh' },
    { id: ID.bob,   username: 'bob_mock',   email: 'bob@mock.ptahnest',   ghId: 10000002, ghUser: 'bob-mock-gh'   },
    { id: ID.carol, username: 'carol_mock', email: 'carol@mock.ptahnest', ghId: 10000003, ghUser: 'carol-mock-gh' },
    { id: ID.dave,  username: 'dave_mock',  email: 'dave@mock.ptahnest',  ghId: 10000004, ghUser: 'dave-mock-gh'  },
    { id: ID.eve,   username: 'eve_mock',   email: 'eve@mock.ptahnest',   ghId: 10000005, ghUser: 'eve-mock-gh'   },
  ];

  for (const u of users) {
    if (await skip('users', 'id', u.id)) { console.log(`  skip user ${u.username}`); continue; }
    await pool.query(
      `INSERT INTO users (id, username, username_lower, email, password, github_id, github_username)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [u.id, u.username, u.username.toLowerCase(), u.email, password, u.ghId, u.ghUser]
    );
    console.log(`  + user ${u.username}`);
  }

  // ─── 2. PROJECTS ──────────────────────────────────────────────────────────

  const projects = [
    {
      id: ID.proj1, creator: ID.alice, status: 'active', type: 'software',
      name: 'PtahNest Platform (mock)',
      desc: 'The core PtahNest collaboration platform — commit voting, kick democracy, and certificates. (mock)',
      repo: 'alice-mock-gh/ptahnest-platform-mock',
      tags: ['node.js', 'postgresql', 'express'], looking: ['backend', 'devops'], recruit: true,
    },
    {
      id: ID.proj2, creator: ID.bob, status: 'active', type: 'software',
      name: 'EcoTrack App (mock)',
      desc: 'Mobile-first carbon footprint tracker with gamification and team challenges. (mock)',
      repo: 'bob-mock-gh/ecotrack-mock',
      tags: ['react', 'firebase', 'sustainability'], looking: ['frontend', 'ux designer'], recruit: true,
    },
    {
      id: ID.proj3, creator: ID.carol, status: 'active', type: 'software',
      name: 'HealthSync API (mock)',
      desc: 'REST API for syncing wearable health data with real-time anomaly detection. (mock)',
      repo: 'carol-mock-gh/healthsync-api-mock',
      tags: ['python', 'fastapi', 'iot'], looking: ['ml engineer', 'backend'], recruit: true,
    },
    {
      id: ID.proj4, creator: ID.dave, status: 'active', type: 'research',
      name: 'AI Ethics in Education (mock)',
      desc: 'Research on ethical implications of AI-generated content in third-level education. (mock)',
      repo: null,
      tags: ['ai ethics', 'education', 'policy'], looking: ['researcher', 'writer'], recruit: true,
    },
    {
      id: ID.proj5, creator: ID.alice, status: 'active', type: 'software',
      name: 'Ata App (mock)',
      desc: 'Full-stack personal dashboard with AI-powered insights and habit tracking. (mock)',
      repo: 'alice-mock-gh/ata-app-mock',
      tags: ['react', 'node.js', 'openai'], looking: ['frontend', 'ml engineer'], recruit: true,
    },
  ];

  for (const p of projects) {
    if (await skip('projects', 'id', p.id)) { console.log(`  skip project ${p.name}`); continue; }
    await pool.query(
      `INSERT INTO projects (id, name, description, project_status, project_type, creator_id,
        tags, looking_for, recruitment_open, github_repo, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [p.id, p.name, p.desc, p.status, p.type, p.creator,
       JSON.stringify(p.tags), JSON.stringify(p.looking), p.recruit, p.repo, daysAgo(90)]
    );
    console.log(`  + project ${p.name}`);
  }

  // ─── 3. MEMBERS ───────────────────────────────────────────────────────────

  async function addMember(projId, userId, role, status, joinDays, leftDays = null) {
    const exists = await pool.query(
      'SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2', [projId, userId]
    );
    if (exists.rows.length) return;
    await pool.query(
      `INSERT INTO project_members (id, project_id, user_id, role, membership_status, joined_at, left_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [uuid(), projId, userId, role, status, daysAgo(joinDays),
       leftDays ? daysAgo(leftDays) : null]
    );
  }

  // proj1 (active): alice creator, bob member, carol member, dave moderator
  await addMember(ID.proj1, ID.alice, 'creator',   'active', 90);
  await addMember(ID.proj1, ID.bob,   'member',    'active', 80);
  await addMember(ID.proj1, ID.carol, 'member',    'active', 75);
  await addMember(ID.proj1, ID.dave,  'moderator', 'active', 70);
  console.log('  + members proj1');

  // proj2 (active): bob creator, alice moderator, eve member
  await addMember(ID.proj2, ID.bob,   'creator',   'active', 62);
  await addMember(ID.proj2, ID.alice, 'moderator', 'active', 60);
  await addMember(ID.proj2, ID.eve,   'member',    'active', 45);
  console.log('  + members proj2');

  // proj3 (active): carol creator, dave member, eve member, bob member
  await addMember(ID.proj3, ID.carol, 'creator', 'active', 47);
  await addMember(ID.proj3, ID.dave,  'member',  'active', 45);
  await addMember(ID.proj3, ID.eve,   'member',  'active', 38);
  await addMember(ID.proj3, ID.bob,   'member',  'active', 35);
  console.log('  + members proj3');

  // proj4 (research): dave creator, alice member, eve member
  await addMember(ID.proj4, ID.dave,  'creator', 'active', 50);
  await addMember(ID.proj4, ID.alice, 'member',  'active', 45);
  await addMember(ID.proj4, ID.eve,   'member',  'active', 35);
  console.log('  + members proj4');

  // proj5 (active, Ata App): alice creator, all others members — join before any commit
  await addMember(ID.proj5, ID.alice, 'creator', 'active', 30);
  await addMember(ID.proj5, ID.bob,   'member',  'active', 28);
  await addMember(ID.proj5, ID.carol, 'member',  'active', 25);
  await addMember(ID.proj5, ID.dave,  'member',  'active', 22);
  await addMember(ID.proj5, ID.eve,   'member',  'active', 18);
  console.log('  + members proj5');

  // ─── 4. MOCK COMMITS (stored in DB — no GitHub token needed) ──────────────

  const mockCommits = [
    // ── proj1: PtahNest Platform ──────────────────────────────────────────────
    { sha: 'p1a001', proj: ID.proj1, gh: 'alice-mock-gh', msg: 'Initial project scaffold and Express setup (mock)',         date: daysAgo(88) },
    { sha: 'p1a002', proj: ID.proj1, gh: 'alice-mock-gh', msg: 'Add PostgreSQL connection pool and schema (mock)',          date: daysAgo(78) },
    { sha: 'p1a003', proj: ID.proj1, gh: 'alice-mock-gh', msg: 'Implement session-based authentication (mock)',             date: daysAgo(60) },
    { sha: 'p1a004', proj: ID.proj1, gh: 'alice-mock-gh', msg: 'Add bcrypt password hashing and brute-force protection (mock)', date: daysAgo(45) },
    { sha: 'p1a005', proj: ID.proj1, gh: 'alice-mock-gh', msg: 'Final deployment to EC2 with Nginx reverse proxy (mock)',   date: daysAgo(8)  },
    { sha: 'p1b001', proj: ID.proj1, gh: 'bob-mock-gh',   msg: 'Add project member system with roles (mock)',              date: daysAgo(75) },
    { sha: 'p1b002', proj: ID.proj1, gh: 'bob-mock-gh',   msg: 'Implement join request flow and notifications (mock)',     date: daysAgo(55) },
    { sha: 'p1b003', proj: ID.proj1, gh: 'bob-mock-gh',   msg: 'Add pagination to project list endpoint (mock)',          date: daysAgo(35) },
    { sha: 'p1c001', proj: ID.proj1, gh: 'carol-mock-gh', msg: 'Add initial UI components and dark theme (mock)',          date: daysAgo(72) },
    { sha: 'p1c002', proj: ID.proj1, gh: 'carol-mock-gh', msg: 'Profile page and GitHub OAuth integration (mock)',         date: daysAgo(58) },
    { sha: 'p1d001', proj: ID.proj1, gh: 'dave-mock-gh',  msg: 'Set up CircleCI pipeline with Docker (mock)',             date: daysAgo(65) },
    { sha: 'p1d002', proj: ID.proj1, gh: 'dave-mock-gh',  msg: 'Add Nginx config and Let\'s Encrypt SSL (mock)',          date: daysAgo(25) },

    // ── proj2: EcoTrack ───────────────────────────────────────────────────────
    { sha: 'p2b001', proj: ID.proj2, gh: 'bob-mock-gh',   msg: 'Bootstrap React app with Firebase config (mock)',         date: daysAgo(58) },
    { sha: 'p2b002', proj: ID.proj2, gh: 'bob-mock-gh',   msg: 'Implement carbon calculator core algorithm (mock)',       date: daysAgo(45) },
    { sha: 'p2b003', proj: ID.proj2, gh: 'bob-mock-gh',   msg: 'Add Firestore data schema and rules (mock)',             date: daysAgo(30) },
    { sha: 'p2a001', proj: ID.proj2, gh: 'alice-mock-gh', msg: 'Design onboarding flow UI components (mock)',            date: daysAgo(50) },
    { sha: 'p2a002', proj: ID.proj2, gh: 'alice-mock-gh', msg: 'Add challenge leaderboard screen (mock)',                date: daysAgo(20) },
    { sha: 'p2e001', proj: ID.proj2, gh: 'eve-mock-gh',   msg: 'Write API documentation with examples (mock)',           date: daysAgo(15) },

    // ── proj3: HealthSync API ─────────────────────────────────────────────────
    { sha: 'p3c001', proj: ID.proj3, gh: 'carol-mock-gh', msg: 'Define FHIR-compatible health data schema (mock)',       date: daysAgo(43) },
    { sha: 'p3c002', proj: ID.proj3, gh: 'carol-mock-gh', msg: 'Implement FastAPI base project structure (mock)',        date: daysAgo(38) },
    { sha: 'p3c003', proj: ID.proj3, gh: 'carol-mock-gh', msg: 'Add Z-score anomaly detection for BPM data (mock)',     date: daysAgo(22) },
    { sha: 'p3d001', proj: ID.proj3, gh: 'dave-mock-gh',  msg: 'Implement OAuth2 device pairing endpoint (mock)',       date: daysAgo(35) },
    { sha: 'p3d002', proj: ID.proj3, gh: 'dave-mock-gh',  msg: 'Add PostgreSQL timeseries storage for readings (mock)', date: daysAgo(18) },
    { sha: 'p3e001', proj: ID.proj3, gh: 'eve-mock-gh',   msg: 'Add Pytest integration test suite (mock)',              date: daysAgo(28) },
    { sha: 'p3e002', proj: ID.proj3, gh: 'eve-mock-gh',   msg: 'Docker Compose for local dev environment (mock)',       date: daysAgo(10) },
    { sha: 'p3b001', proj: ID.proj3, gh: 'bob-mock-gh',   msg: 'Add Swagger UI auto-docs endpoint (mock)',              date: daysAgo(12) },

    // ── proj5: Ata App ────────────────────────────────────────────────────────
    { sha: 'p5a001', proj: ID.proj5, gh: 'alice-mock-gh', msg: 'Init Next.js project with TypeScript config (mock)',        date: daysAgo(27) },
    { sha: 'p5a002', proj: ID.proj5, gh: 'alice-mock-gh', msg: 'Add PostgreSQL schema for user preferences (mock)',         date: daysAgo(20) },
    { sha: 'p5a003', proj: ID.proj5, gh: 'alice-mock-gh', msg: 'Integrate OpenAI API for daily summary generation (mock)',  date: daysAgo(10) },
    { sha: 'p5b001', proj: ID.proj5, gh: 'bob-mock-gh',   msg: 'Build dashboard widget component system (mock)',            date: daysAgo(24) },
    { sha: 'p5b002', proj: ID.proj5, gh: 'bob-mock-gh',   msg: 'Add drag-and-drop layout persistence (mock)',               date: daysAgo(14) },
    { sha: 'p5c001', proj: ID.proj5, gh: 'carol-mock-gh', msg: 'Implement OAuth2 login with Google (mock)',                 date: daysAgo(22) },
    { sha: 'p5c002', proj: ID.proj5, gh: 'carol-mock-gh', msg: 'Add session management and CSRF protection (mock)',         date: daysAgo(12) },
    { sha: 'p5d001', proj: ID.proj5, gh: 'dave-mock-gh',  msg: 'Set up Docker Compose for local dev environment (mock)',    date: daysAgo(19) },
    { sha: 'p5e001', proj: ID.proj5, gh: 'eve-mock-gh',   msg: 'Write Playwright E2E tests for auth flow (mock)',           date: daysAgo(15) },
  ];

  for (const c of mockCommits) {
    await pool.query(
      `INSERT INTO mock_commits (sha, project_id, author_github, message, date)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (sha) DO NOTHING`,
      [c.sha, c.proj, c.gh, c.msg, c.date]
    );
  }
  console.log(`  + ${mockCommits.length} mock commits`);

  // Commit votes intentionally empty — users will rate commits live during demo

  // ─── 6. KICK VOTE (proj3 — open vote against eve) ─────────────────────────

  const kickId = '00000000-0000-4000-c000-000000000001';
  if (await skip('kick_votes', 'id', kickId)) {
    console.log('  skip kick vote');
  } else {
    await pool.query(
      `INSERT INTO kick_votes (id, project_id, target_user_id, initiated_by, status, threshold_percent, expires_at)
       VALUES ($1,$2,$3,$4,'open',70,$5)`,
      [kickId, ID.proj3, ID.eve, ID.carol, new Date(Date.now() + 20 * 3600000).toISOString()]
    );
    // carol=50% weight (highest leaderboard), dave=~27% — together ~77% but bob hasn't voted
    await pool.query(
      `INSERT INTO kick_vote_ballots (id, vote_id, voter_user_id, ballot, weight) VALUES ($1,$2,$3,'yes',50) ON CONFLICT DO NOTHING`,
      [uuid(), kickId, ID.carol]
    );
    await pool.query(
      `INSERT INTO kick_vote_ballots (id, vote_id, voter_user_id, ballot, weight) VALUES ($1,$2,$3,'yes',27) ON CONFLICT DO NOTHING`,
      [uuid(), kickId, ID.dave]
    );
    console.log('  + kick vote (proj3 → eve_mock, 2 yes votes cast, bob pending)');
  }

  // ─── 7. TODOS ─────────────────────────────────────────────────────────────

  const todos = [
    { proj: ID.proj2, by: ID.bob,   title: 'Set up Firebase project (mock)',        desc: 'Create project and configure auth rules.',        due: '2026-05-15', to: ID.alice, done: true  },
    { proj: ID.proj2, by: ID.alice, title: 'Design onboarding flow (mock)',          desc: 'Wireframes for new user onboarding screens.',      due: '2026-05-20', to: ID.alice, done: false },
    { proj: ID.proj2, by: ID.bob,   title: 'Implement carbon calculator (mock)',     desc: 'Core footprint estimation algorithm.',             due: '2026-05-25', to: ID.bob,   done: false },
    { proj: ID.proj2, by: ID.eve,   title: 'Write API documentation (mock)',         desc: null,                                               due: null,         to: ID.eve,   done: false },
    { proj: ID.proj3, by: ID.carol, title: 'Define health data schema (mock)',       desc: 'FHIR-compatible data model for wearables.',        due: '2026-05-10', to: ID.dave,  done: true  },
    { proj: ID.proj3, by: ID.carol, title: 'Implement anomaly detection (mock)',     desc: 'Z-score based BPM outlier detection.',             due: '2026-05-18', to: ID.carol, done: false },
    { proj: ID.proj3, by: ID.dave,  title: 'Write integration tests (mock)',         desc: null,                                               due: '2026-05-22', to: ID.dave,  done: false },
    { proj: ID.proj4, by: ID.dave,  title: 'Literature review — AI in HE (mock)',   desc: 'Compile 20 key papers on AI in higher education.', due: '2026-05-12', to: ID.alice, done: true  },
    { proj: ID.proj4, by: ID.alice, title: 'Draft ethics framework section (mock)', desc: null,                                               due: '2026-05-28', to: ID.dave,  done: false },
    { proj: ID.proj5, by: ID.alice, title: 'Design AI insights UI (mock)',          desc: 'Wireframes for daily summary and habit cards.',     due: '2026-05-30', to: ID.bob,   done: false },
    { proj: ID.proj5, by: ID.bob,   title: 'Add dark mode support (mock)',          desc: null,                                               due: '2026-06-05', to: ID.carol, done: false },
    { proj: ID.proj5, by: ID.carol, title: 'Write E2E test plan (mock)',            desc: 'Cover login, dashboard, and AI summary flows.',    due: '2026-06-10', to: ID.eve,   done: false },
  ];

  for (const t of todos) {
    const exists = await pool.query(
      'SELECT 1 FROM project_todos WHERE title=$1 AND project_id=$2', [t.title, t.proj]
    );
    if (exists.rows.length) continue;
    await pool.query(
      `INSERT INTO project_todos (id, project_id, created_by, title, description, due_date, assigned_to, completed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [uuid(), t.proj, t.by, t.title, t.desc, t.due, t.to, t.done]
    );
  }
  console.log(`  + ${todos.length} todos`);

  // ─── 8. CHAT MESSAGES ─────────────────────────────────────────────────────

  const msgs = [
    { proj: ID.proj2, sender: ID.bob,   text: 'Hey team, Firebase is all set up! (mock)' },
    { proj: ID.proj2, sender: ID.alice, text: 'Great, starting on the onboarding wireframes this week. (mock)' },
    { proj: ID.proj2, sender: ID.eve,   text: 'Should we use Firestore or Realtime DB for challenges? (mock)' },
    { proj: ID.proj2, sender: ID.bob,   text: 'Firestore — better querying for leaderboard. (mock)' },
    { proj: ID.proj2, sender: ID.alice, text: 'Agreed. I\'ll document the schema once you push it. (mock)' },
    { proj: ID.proj3, sender: ID.carol, text: 'Schema is finalised and merged — check the todo. (mock)' },
    { proj: ID.proj3, sender: ID.dave,  text: 'On it, starting the anomaly detection PR today. (mock)' },
    { proj: ID.proj3, sender: ID.eve,   text: 'Can someone review my integration tests PR? (mock)' },
    { proj: ID.proj3, sender: ID.carol, text: 'Will review it after standup. (mock)' },
    { proj: ID.proj3, sender: ID.bob,   text: 'Swagger UI is live on /docs — looks clean. (mock)' },
    { proj: ID.proj4, sender: ID.dave,  text: 'Literature review done — 22 papers collected. (mock)' },
    { proj: ID.proj4, sender: ID.alice, text: 'Impressive! Starting cross-referencing for the ethics section. (mock)' },
    { proj: ID.proj4, sender: ID.eve,   text: 'Should we create a shared Zotero library? (mock)' },
    { proj: ID.proj4, sender: ID.dave,  text: 'Good idea, I\'ll set it up and share the link. (mock)' },
    { proj: ID.proj5, sender: ID.alice, text: 'Project is live! Starting with the OpenAI integration this week. (mock)' },
    { proj: ID.proj5, sender: ID.bob,   text: 'Dashboard widgets are looking great — drag-and-drop is in. (mock)' },
    { proj: ID.proj5, sender: ID.carol, text: 'Google OAuth is set up and working. Everyone can log in now. (mock)' },
    { proj: ID.proj5, sender: ID.dave,  text: 'Docker Compose is ready — run docker compose up and you\'re good. (mock)' },
    { proj: ID.proj5, sender: ID.eve,   text: 'First E2E tests passing! Auth flow is fully covered. (mock)' },
  ];

  for (const m of msgs) {
    await pool.query(
      `INSERT INTO project_messages (id, project_id, sender_id, encrypted_content) VALUES ($1,$2,$3,$4)`,
      [uuid(), m.proj, m.sender, encrypt(m.text)]
    );
  }
  console.log(`  + ${msgs.length} chat messages`);

  // ─── 9. NOTIFICATIONS ────────────────────────────────────────────────────

  const notifs = [
    { user: ID.eve, type: 'kick_vote_started', proj: ID.proj3, name: 'HealthSync API (mock)' },
  ];

  for (const n of notifs) {
    await pool.query(
      `INSERT INTO notifications (id, user_id, type, project_id, project_name) VALUES ($1,$2,$3,$4,$5)`,
      [uuid(), n.user, n.type, n.proj, n.name]
    );
  }
  console.log('  + 1 notification (eve: kick_vote_started)');

  console.log('\n✓ Mock seed complete.\n');
  console.log('Login credentials (password: Mock1234!):');
  console.log('  alice_mock — PtahNest Platform creator, EcoTrack mod, Ata App creator');
  console.log('  bob_mock   — EcoTrack creator, PtahNest member, Ata App member');
  console.log('  carol_mock — HealthSync creator (kick vote initiator), PtahNest member, Ata App member');
  console.log('  dave_mock  — AI Ethics creator, PtahNest moderator, Ata App member');
  console.log('  eve_mock   — Member of EcoTrack + HealthSync + Ata App (kick vote target in proj3)');
  console.log('\nAll projects are ACTIVE — no past/completed state. Customize from here.');
}

// Export for inline server use (pool stays open)
async function runSeedMock() { return run(); }

// Standalone: close pool after done
if (require.main === module) {
  run().then(() => pool.end()).catch(err => {
    console.error('Seed failed:', err.message);
    pool.end().catch(() => {});
    process.exit(1);
  });
}

module.exports = { runSeedMock };
