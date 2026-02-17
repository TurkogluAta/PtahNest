const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { githubDb } = require('../models/database');
const { encrypt } = require('../utils/encryption');

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
