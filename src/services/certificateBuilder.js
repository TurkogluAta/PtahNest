'use strict';

const { pool, projectDb, memberDb, githubDb, commitVoteDb, certificateDb } = require('../models/database');
const { decrypt } = require('../utils/encryption');

// Fetch all commits by a specific GitHub author for a repo (paginated, max 500)
async function fetchAuthorCommits(repo, githubUsername, accessToken) {
  const commits = [];
  const perPage = 100;
  const maxPages = 5;

  for (let page = 1; page <= maxPages; page++) {
    const url = `https://api.github.com/repos/${repo}/commits?author=${encodeURIComponent(githubUsername)}&per_page=${perPage}&page=${page}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/vnd.github+json' }
    });
    if (!res.ok) break;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    data.forEach(c => commits.push({
      sha: c.sha,
      message: (c.commit?.message || '').split('\n')[0].slice(0, 100),
      date: c.commit?.author?.date || c.commit?.committer?.date || null
    }));
    if (data.length < perPage) break;
  }
  return commits.sort((a, b) => new Date(a.date) - new Date(b.date));
}

// Fetch all commits for the repo this month (for pie chart — all authors)
async function fetchMonthlyCommits(repo, accessToken) {
  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const url = `https://api.github.com/repos/${repo}/commits?per_page=100&since=${since}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/vnd.github+json' }
  });
  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.map(c => ({
    sha: c.sha,
    author: c.author?.login || c.commit?.author?.name || 'Unknown'
  }));
}

// Build weight history: for each of the user's commits (chronological), compute their
// normalized leaderboard weight using all votes cast up to that point.
// NOTE: Comparison is by commit order (index), not wall-clock time — mock commits have
// artificial past dates but votes are cast in real time, so time-based filtering
// would always exclude all votes. Instead we use all current votes for every point,
// which gives a meaningful "weight at time of certificate issue" view.
async function buildWeightHistory(projectId, githubUsername, authorCommits) {
  if (!authorCommits.length) return [];

  // Get all commit_votes for project grouped by author
  const { rows: allVotes } = await pool.query(
    `SELECT commit_author_github, SUM(rating)::float AS total_score
     FROM commit_votes
     WHERE project_id = $1 AND commit_author_github IS NOT NULL
     GROUP BY commit_author_github`,
    [projectId]
  );

  // Build author → score map from all current votes
  const byAuthor = {};
  for (const v of allVotes) {
    byAuthor[v.commit_author_github] = Number(v.total_score);
  }

  const totalScore = Object.values(byAuthor).reduce((s, x) => s + x, 0);
  const myScore = byAuthor[githubUsername] || 0;

  // If no votes at all, weight stays 0 — show flat line
  if (totalScore === 0) {
    return authorCommits.map(c => ({ sha: c.sha, date: c.date, weight: 0 }));
  }

  // Each commit point gets the same final weight (snapshot at certificate issue time)
  // This is honest: the certificate reflects the leaderboard at the moment it was issued
  const finalWeight = parseFloat(((myScore / totalScore) * 100).toFixed(2));
  return authorCommits.map(c => ({ sha: c.sha, date: c.date, weight: finalWeight }));
}

// Build the full certificate payload for one member
async function buildCertificatePayload(userId, projectId, triggerType) {
  const project = await projectDb.findById(projectId, userId);
  if (!project) throw new Error('Project not found');

  // Get user info
  const { rows: userRows } = await pool.query(
    `SELECT username, github_username, github_token FROM users WHERE id = $1`, [userId]
  );
  if (!userRows.length) throw new Error('User not found');
  const user = userRows[0];

  // Get membership dates
  const { rows: memberRows } = await pool.query(
    `SELECT joined_at, left_at FROM project_members WHERE project_id = $1 AND user_id = $2`,
    [projectId, userId]
  );
  const membership = memberRows[0] || {};

  const now = new Date();
  const issuedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const payload = {
    projectName: project.name,
    projectType: project.project_type || project.projectType || 'software',
    githubRepo: project.github_repo || null,
    username: user.username,
    githubUsername: user.github_username || null,
    joinedAt: membership.joined_at || null,
    endedAt: membership.left_at || now.toISOString(),
    issuedMonth,
    timeline: [],
    weightHistory: [],
    monthlyEffortPie: []
  };

  if (!project.github_repo) return payload;

  // Mock project bypass: build payload from mock_commits + commit_votes (no GitHub token needed)
  if (project.github_repo.includes('mock') && user.github_username) {
    try {
      const { rows: authorCommits } = await pool.query(
        `SELECT sha, message, date FROM mock_commits
         WHERE project_id = $1 AND author_github = $2
         ORDER BY date ASC`,
        [projectId, user.github_username]
      );

      const shas = authorCommits.map(c => c.sha);
      const ratingsMap = shas.length ? await commitVoteDb.getAverages(projectId, shas) : {};

      payload.timeline = authorCommits.map(c => ({
        sha: c.sha, date: c.date, message: c.message,
        rating: ratingsMap[c.sha]?.avg || null,
        voteCount: ratingsMap[c.sha]?.count || 0
      }));

      payload.weightHistory = await buildWeightHistory(projectId, user.github_username, authorCommits);

      // Pie: total star rating points earned per author (commit_votes SUM)
      const { rows: voteScores } = await pool.query(
        `SELECT commit_author_github, COALESCE(SUM(rating), 0)::float AS score
         FROM commit_votes WHERE project_id = $1 AND commit_author_github IS NOT NULL
         GROUP BY commit_author_github ORDER BY score DESC`,
        [projectId]
      );
      payload.monthlyEffortPie = voteScores.map(r => ({
        githubUsername: r.commit_author_github, commits: r.score
      }));
    } catch (err) {
      console.error(`Mock certificate payload failed for user ${userId}:`, err.message);
    }
    return payload;
  }

  // Real GitHub: token required
  if (!user.github_username || !user.github_token) return payload;

  const accessToken = decrypt(user.github_token);

  try {
    const authorCommits = await fetchAuthorCommits(project.github_repo, user.github_username, accessToken);

    const shas = authorCommits.map(c => c.sha);
    const ratingsMap = shas.length ? await commitVoteDb.getAverages(projectId, shas) : {};

    payload.timeline = authorCommits.map(c => ({
      sha: c.sha, date: c.date, message: c.message,
      rating: ratingsMap[c.sha]?.avg || null,
      voteCount: ratingsMap[c.sha]?.count || 0
    }));

    payload.weightHistory = await buildWeightHistory(projectId, user.github_username, authorCommits);

    // Pie: total star rating points earned per author (commit_votes SUM)
    const { rows: voteScores } = await pool.query(
      `SELECT commit_author_github, COALESCE(SUM(rating), 0)::float AS score
       FROM commit_votes WHERE project_id = $1 AND commit_author_github IS NOT NULL
       GROUP BY commit_author_github ORDER BY score DESC`,
      [projectId]
    );
    payload.monthlyEffortPie = voteScores.map(r => ({
      githubUsername: r.commit_author_github, commits: r.score
    }));

  } catch (err) {
    console.error(`Certificate payload GitHub fetch failed for user ${userId}:`, err.message);
  }

  return payload;
}

// Issue certificate for a single member — fire-and-forget safe (does not throw)
async function triggerForMember(userId, projectId, triggerType) {
  try {
    const { rows: memberRows } = await pool.query(
      `SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId]
    );
    const wasCreator = memberRows[0]?.role === 'creator';

    const payload = await buildCertificatePayload(userId, projectId, triggerType);
    await certificateDb.create(userId, projectId, triggerType, wasCreator, payload);
  } catch (err) {
    console.error(`Certificate generation failed [${triggerType}] user=${userId} project=${projectId}:`, err.message);
  }
}

// Issue certificates for all currently active members of a project
async function triggerForAllActiveMembers(projectId, triggerType) {
  try {
    const members = await memberDb.getProjectMembers(projectId);
    // Run sequentially to avoid hammering GitHub API
    for (const member of members) {
      await triggerForMember(member.user_id, projectId, triggerType);
    }
  } catch (err) {
    console.error(`Certificate bulk generation failed [${triggerType}] project=${projectId}:`, err.message);
  }
}

module.exports = { triggerForMember, triggerForAllActiveMembers };
