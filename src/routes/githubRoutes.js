const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { githubDb, projectDb, memberDb } = require('../models/database');
const { encrypt, decrypt } = require('../utils/encryption');

// Auth middleware - require logged in user
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  next();
}

// GET /auth - Redirect user to GitHub OAuth authorization page
router.get('/auth', requireAuth, (req, res) => {
  // Generate random state for CSRF protection
  const state = crypto.randomBytes(32).toString('hex');
  req.session.githubOAuthState = state;

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: `${req.protocol}://${req.get('host')}/api/github/callback`,
    scope: 'repo',
    state: state
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

// GET /callback - Handle GitHub OAuth callback
router.get('/callback', requireAuth, async (req, res) => {
  const { code, state } = req.query;
  const redirectBase = '/pages/profile.html';

  // Validate state parameter (CSRF protection)
  if (!state || state !== req.session.githubOAuthState) {
    return res.redirect(`${redirectBase}?github=error&reason=state_mismatch`);
  }

  // Clear used state
  delete req.session.githubOAuthState;

  if (!code) {
    return res.redirect(`${redirectBase}?github=error&reason=no_code`);
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code: code
      })
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error || !tokenData.access_token) {
      return res.redirect(`${redirectBase}?github=error&reason=token_failed`);
    }

    const accessToken = tokenData.access_token;

    // Get GitHub user info
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github+json'
      }
    });

    if (!userResponse.ok) {
      return res.redirect(`${redirectBase}?github=error&reason=user_fetch_failed`);
    }

    const githubUser = await userResponse.json();

    // Check if this GitHub account is already linked to another user
    const existingUser = githubDb.findByGithubId(githubUser.id);
    if (existingUser && existingUser.id !== req.session.userId) {
      return res.redirect(`${redirectBase}?github=error&reason=already_linked`);
    }

    // Encrypt token and save to DB
    const encryptedToken = encrypt(accessToken);
    githubDb.linkAccount(req.session.userId, githubUser.id, githubUser.login, encryptedToken);

    res.redirect(`${redirectBase}?github=success`);
  } catch (error) {
    console.error('GitHub OAuth callback error:', error);
    res.redirect(`${redirectBase}?github=error&reason=server_error`);
  }
});

// GET /status - Get GitHub connection status
router.get('/status', requireAuth, (req, res) => {
  const info = githubDb.getGithubInfo(req.session.userId);

  if (info && info.github_id) {
    return res.json({
      success: true,
      linked: true,
      github_username: info.github_username
    });
  }

  res.json({ success: true, linked: false });
});

// GET /repos - List user's GitHub repositories
router.get('/repos', requireAuth, async (req, res) => {
  try {
    const info = githubDb.getGithubInfo(req.session.userId);

    // Return empty array if GitHub not linked
    if (!info || !info.github_token) {
      return res.json({ success: true, repos: [] });
    }

    // Decrypt stored token
    const accessToken = decrypt(info.github_token);

    // Fetch repos from GitHub API
    const response = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github+json'
      }
    });

    if (!response.ok) {
      return res.status(502).json({ success: false, message: 'Failed to fetch repos from GitHub' });
    }

    const repos = await response.json();

    // Return only needed fields
    const repoList = repos.map(repo => ({
      full_name: repo.full_name,
      private: repo.private
    }));

    res.json({ success: true, repos: repoList });
  } catch (error) {
    console.error('Fetch GitHub repos error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /commits/:projectId - Fetch all commits for a project's GitHub repo
router.get('/commits/:projectId', requireAuth, async (req, res) => {
  try {
    const project = projectDb.findById(req.params.projectId);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    // Check if user is member or creator
    if (project.creator_id !== req.session.userId && !memberDb.isMember(req.params.projectId, req.session.userId)) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    if (!project.github_repo) {
      return res.json({ success: true, commits: [], totalCount: 0 });
    }

    // Get creator's GitHub token to fetch commits
    const info = githubDb.getGithubInfo(project.creator_id);
    if (!info || !info.github_token) {
      return res.json({ success: true, commits: [], totalCount: 0 });
    }

    const accessToken = decrypt(info.github_token);
    const page = parseInt(req.query.page) || 1;
    const perPage = 30;

    // Fetch commits from GitHub API (paginated)
    const response = await fetch(
      `https://api.github.com/repos/${project.github_repo}/commits?per_page=${perPage}&page=${page}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github+json'
        }
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('GitHub commits API error:', response.status, errorBody);
      return res.status(502).json({ success: false, message: 'Failed to fetch commits from GitHub' });
    }

    const commits = await response.json();

    // Parse Link header for total page info
    const linkHeader = response.headers.get('link');
    let hasNextPage = false;
    if (linkHeader && linkHeader.includes('rel="next"')) {
      hasNextPage = true;
    }

    // Return only needed fields
    const commitList = commits.map(c => ({
      sha: c.sha,
      message: c.commit.message,
      author: c.commit.author.name,
      date: c.commit.author.date,
      url: c.html_url,
      avatar: c.author ? c.author.avatar_url : null
    }));

    res.json({
      success: true,
      commits: commitList,
      page,
      hasNextPage
    });
  } catch (error) {
    console.error('Fetch commits error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /unlink - Unlink GitHub account
router.post('/unlink', requireAuth, (req, res) => {
  const info = githubDb.getGithubInfo(req.session.userId);

  if (!info || !info.github_id) {
    return res.status(400).json({ success: false, message: 'No GitHub account linked' });
  }

  githubDb.unlinkAccount(req.session.userId);
  res.json({ success: true, message: 'GitHub account unlinked' });
});

module.exports = router;
