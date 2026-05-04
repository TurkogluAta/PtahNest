'use strict';

/**
 * Resets mock data to its initial demo state.
 * Run this before a demo to undo any test actions (complete, kick, leave, etc.).
 *
 * What it resets:
 *   - proj2 (EcoTrack) + proj3 (HealthSync) → status: active, recruitment_open: true
 *   - proj4 (Research) → status: active
 *   - All mock project_members → membership_status: active, left_at: null
 *   - Re-creates the open kick vote on proj3 against eve_mock
 *   - Deletes certificates for proj2 / proj3 / proj4 (keeps proj1 demo certs)
 *   - Clears commit_votes for mock projects (so leaderboard is fresh for live demo)
 *   - Clears kick_vote_ballots and re-seeds carol + dave yes votes
 *   - Resets any kick_vote that resolved (status back to open, resolved_at null)
 *
 * Does NOT touch:
 *   - Users / passwords
 *   - mock_commits
 *   - proj1 (PtahNest Platform) — intentionally completed with demo certs
 *   - Chat messages / todos
 */

require('dotenv').config();
const crypto = require('crypto');
const { pool } = require('../src/models/database');

const ID = {
  alice: '00000000-0000-4000-a000-000000000001',
  bob:   '00000000-0000-4000-a000-000000000002',
  carol: '00000000-0000-4000-a000-000000000003',
  dave:  '00000000-0000-4000-a000-000000000004',
  eve:   '00000000-0000-4000-a000-000000000005',

  proj1: '00000000-0000-4000-b000-000000000001',
  proj2: '00000000-0000-4000-b000-000000000002',
  proj3: '00000000-0000-4000-b000-000000000003',
  proj4: '00000000-0000-4000-b000-000000000004',
  proj5: '00000000-0000-4000-b000-000000000005',

  kickVote: '00000000-0000-4000-c000-000000000001',
};

function uuid() { return crypto.randomUUID(); }

async function run() {
  console.log('Resetting mock data to demo state...\n');

  // ── 1. Restore all mock project statuses to active ──────────────────────────
  await pool.query(
    `UPDATE projects SET project_status = 'active', recruitment_open = TRUE, updated_at = NOW()
     WHERE id IN ($1,$2,$3,$4,$5)`,
    [ID.proj1, ID.proj2, ID.proj3, ID.proj4, ID.proj5]
  );
  console.log('✓ all mock projects → active');

  // ── 2. Restore all mock project_members to active ────────────────────────────
  await pool.query(
    `UPDATE project_members
     SET membership_status = 'active', left_at = NULL
     WHERE project_id IN ($1,$2,$3,$4,$5)`,
    [ID.proj1, ID.proj2, ID.proj3, ID.proj4, ID.proj5]
  );
  console.log('✓ project_members → active');

  // ── 3. Delete all certificates for mock projects ─────────────────────────────
  const { rowCount: certDel } = await pool.query(
    `DELETE FROM certificates WHERE project_id IN ($1,$2,$3,$4,$5)`,
    [ID.proj1, ID.proj2, ID.proj3, ID.proj4, ID.proj5]
  );
  console.log(`✓ deleted ${certDel} certificates`);

  // ── 4. Clear commit_votes for all mock projects ──────────────────────────────
  const { rowCount: voteDel } = await pool.query(
    `DELETE FROM commit_votes WHERE project_id IN ($1,$2,$3,$4,$5)`,
    [ID.proj1, ID.proj2, ID.proj3, ID.proj4, ID.proj5]
  );
  console.log(`✓ deleted ${voteDel} commit votes (fresh leaderboard for demo)`);

  // ── 5. Reset kick vote state ─────────────────────────────────────────────────

  // Delete all kick vote ballots for the mock kick vote
  await pool.query(
    `DELETE FROM kick_vote_ballots WHERE vote_id = $1`, [ID.kickVote]
  );

  // Upsert the kick vote itself back to open state
  await pool.query(
    `INSERT INTO kick_votes (id, project_id, target_user_id, initiated_by, status, threshold_percent, expires_at)
     VALUES ($1,$2,$3,$4,'open',70,$5)
     ON CONFLICT (id) DO UPDATE
       SET status = 'open', resolved_at = NULL,
           expires_at = $5`,
    [ID.kickVote, ID.proj3, ID.eve, ID.carol, new Date(Date.now() + 20 * 3600000).toISOString()]
  );

  // Re-seed carol + dave yes votes (bob still pending — for live demo)
  await pool.query(
    `INSERT INTO kick_vote_ballots (id, vote_id, voter_user_id, ballot, weight)
     VALUES ($1,$2,$3,'yes',50) ON CONFLICT DO NOTHING`,
    [uuid(), ID.kickVote, ID.carol]
  );
  await pool.query(
    `INSERT INTO kick_vote_ballots (id, vote_id, voter_user_id, ballot, weight)
     VALUES ($1,$2,$3,'yes',27) ON CONFLICT DO NOTHING`,
    [uuid(), ID.kickVote, ID.dave]
  );
  console.log('✓ kick vote → open (carol+dave yes, bob pending)');

  // ── 6. Also cancel any other open kick votes that were created during testing
  await pool.query(
    `UPDATE kick_votes SET status = 'cancelled', resolved_at = NOW()
     WHERE project_id IN ($1,$2,$3,$4,$5)
       AND id != $6
       AND status = 'open'`,
    [ID.proj1, ID.proj2, ID.proj3, ID.proj4, ID.proj5, ID.kickVote]
  );

  // ── 7. Clear any extra notifications created during test runs ────────────────
  // Keep only the seed notifications (re-insert on conflict ignore)
  await pool.query(
    `DELETE FROM notifications
     WHERE project_id IN ($1,$2,$3,$4,$5)
       AND type IN ('project_completed','project_deleted')`,
    [ID.proj1, ID.proj2, ID.proj3, ID.proj4, ID.proj5]
  );
  console.log('✓ cleared test-run notifications');

  console.log('\nMock reset complete. Ready for demo.\n');
}

// Export for inline server use (pool stays open)
async function runResetMock() { return run(); }

// Standalone: close pool after done
if (require.main === module) {
  run().then(() => pool.end()).catch(err => {
    console.error('Reset failed:', err.message);
    process.exit(1);
  });
}

module.exports = { runResetMock };
