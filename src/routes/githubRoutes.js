const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { githubDb, projectDb, memberDb, commitVoteDb } = require('../models/database');
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
    const existingUser = await githubDb.findByGithubId(githubUser.id);
    if (existingUser && existingUser.id !== req.session.userId) {
      return res.redirect(`${redirectBase}?github=error&reason=already_linked`);
    }

    // Encrypt token and save to DB
    const encryptedToken = encrypt(accessToken);
    await githubDb.linkAccount(req.session.userId, githubUser.id, githubUser.login, encryptedToken);

    res.redirect(`${redirectBase}?github=success`);
  } catch (error) {
    console.error('GitHub OAuth callback error:', error);
    res.redirect(`${redirectBase}?github=error&reason=server_error`);
  }
});

// GET /status - Get GitHub connection status
router.get('/status', requireAuth, async (req, res) => {
  const info = await githubDb.getGithubInfo(req.session.userId);

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
    const info = await githubDb.getGithubInfo(req.session.userId);

    // Return empty array if GitHub not linked
    if (!info || !info.github_token) {
      return res.json({ success: true, repos: [] });
    }

    // Decrypt stored token
    const accessToken = decrypt(info.github_token);

    // Fetch only repos owned by the user (excludes collaborator/organization repos)
    const response = await fetch('https://api.github.com/user/repos?affiliation=owner&per_page=100&sort=updated', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github+json'
      }
    });

    if (!response.ok) {
      return res.status(502).json({ success: false, message: 'Failed to fetch repos from GitHub' });
    }

    const repos = await response.json();

    // Defensive owner filter in case API param is ignored
    const ownerLogin = (info.github_username || '').toLowerCase();
    const repoList = repos
      .filter(repo => repo.owner && repo.owner.login && repo.owner.login.toLowerCase() === ownerLogin)
      .map(repo => ({
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
    const project = await projectDb.findById(req.params.projectId);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    // Check if user is member or creator
    if (project.creator_id !== req.session.userId && !await memberDb.isMember(req.params.projectId, req.session.userId)) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    if (!project.github_repo) {
      return res.json({ success: true, commits: [], totalCount: 0 });
    }

    // Mock bypass: if repo name contains "mock", serve commits from mock_commits table
    if (project.github_repo.includes('mock')) {
      const page = parseInt(req.query.page) || 1;
      const perPage = 5;
      const mockCommits = await githubDb.getMockCommits(project.id);
      const paginated = mockCommits.slice((page - 1) * perPage, page * perPage);
      return res.json({
        success: true,
        commits: paginated.map(c => ({
          sha: c.sha,
          message: c.message,
          author: c.author_github,
          githubUsername: c.author_github,
          date: c.date,
          url: `https://github.com/${project.github_repo}/commit/${c.sha}`,
          avatar: null,
        })),
        page,
        hasNextPage: mockCommits.length > page * perPage
      });
    }

    // Use the requesting user's own GitHub token (they are a collaborator on the repo)
    const info = await githubDb.getGithubInfo(req.session.userId);
    if (!info || !info.github_token) {
      return res.status(403).json({ success: false, message: 'GitHub account not linked', githubRequired: true });
    }

    const accessToken = decrypt(info.github_token);
    const page = parseInt(req.query.page) || 1;
    const perPage = 5;

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
    // Prefer GitHub login (c.author.login) over git config name (c.commit.author.name)
    // so that frontend self-vote check matches against member.github_username correctly.
    const commitList = commits.map(c => ({
      sha: c.sha,
      message: c.commit.message,
      author: c.author ? c.author.login : c.commit.author.name,
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

// Create a GitHub repo on behalf of the user using their token.
// Returns { success, fullName } or { success: false, error }
async function createGithubRepo(userId, repoName) {
  try {
    const info = await githubDb.getGithubInfo(userId);
    if (!info || !info.github_token) {
      return { success: false, error: 'no_token' };
    }

    const accessToken = decrypt(info.github_token);

    const response = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: repoName,
        private: false,
        auto_init: true
      })
    });

    if (response.status === 201) {
      const repo = await response.json();
      return { success: true, fullName: repo.full_name };
    }

    // 422 = repo name already exists on user's account
    if (response.status === 422) {
      return { success: false, error: 'duplicate' };
    }

    const errBody = await response.json().catch(() => ({}));
    return { success: false, error: errBody.message || `GitHub API error (${response.status})` };
  } catch (err) {
    console.error('Create GitHub repo error:', err);
    return { success: false, error: 'Failed to create GitHub repository' };
  }
}

// Resolve GitHub username from a github_id (public API, no token needed)
async function resolveGithubUsername(githubId) {
  try {
    const res = await fetch(`https://api.github.com/user/${githubId}`, {
      headers: { 'Accept': 'application/vnd.github+json' }
    });
    if (res.ok) {
      const data = await res.json();
      return data.login || null;
    }
    return null;
  } catch {
    return null;
  }
}

// Send GitHub collaborator invite and auto-accept on behalf of the invited user.
// Returns an object: { sent: true/false, autoAccepted?: true, error?: string }
async function sendCollaboratorInvite(projectId, invitedUserId, githubRepo, creatorId, snapshotGithubId = null) {
  // Check if invited user has a GitHub account linked
  const invitedUser = await githubDb.getGithubInfo(invitedUserId);
  let githubUsername = invitedUser?.github_username || null;

  // Fallback: resolve username from snapshot github_id if user unlinked
  if (!githubUsername && snapshotGithubId) {
    githubUsername = await resolveGithubUsername(snapshotGithubId);
  }
  if (!githubUsername) {
    return { sent: false, error: 'User has no GitHub account linked' };
  }

  // Check if creator has a GitHub token
  const creatorGithub = await githubDb.getGithubInfo(creatorId);
  if (!creatorGithub || !creatorGithub.github_token) {
    return { sent: false, error: 'Link your GitHub account first to send invites' };
  }

  // Rate limit: max 24 invites per project per 24 hours
  const inviteCount = await githubDb.getInviteCount(projectId, 24);
  if (inviteCount >= 24) {
    return { sent: false, error: 'Invite rate limit exceeded (24/24h). Try again later' };
  }

  try {
    const accessToken = decrypt(creatorGithub.github_token);
    const [owner, repo] = githubRepo.split('/');

    // Send collaborator invite via GitHub API
    const ghResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/collaborators/${githubUsername}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github+json'
        }
      }
    );

    if (ghResponse.status === 201) {
      // 201 = invite sent
      await githubDb.updateInviteStatus(projectId, invitedUserId, 1);

      // Auto-accept: use invited user's token to accept the invite (skip if unlinked)
      try {
        if (!invitedUser?.github_token) throw new Error('No user token for auto-accept');
        const userToken = decrypt(invitedUser.github_token);

        // Fetch pending invitations for the user
        const invitesRes = await fetch('https://api.github.com/user/repository_invitations', {
          headers: {
            'Authorization': `Bearer ${userToken}`,
            'Accept': 'application/vnd.github+json'
          }
        });

        if (invitesRes.ok) {
          const invites = await invitesRes.json();
          const repoInvite = invites.find(inv => inv.repository.full_name === githubRepo);

          if (repoInvite) {
            const acceptRes = await fetch(
              `https://api.github.com/user/repository_invitations/${repoInvite.id}`, {
                method: 'PATCH',
                headers: {
                  'Authorization': `Bearer ${userToken}`,
                  'Accept': 'application/vnd.github+json'
                }
              }
            );

            if (acceptRes.status === 204) {
              await githubDb.updateInviteStatus(projectId, invitedUserId, 2);
              return { sent: true, autoAccepted: true };
            }
          }
        }
      } catch (autoErr) {
        // Auto-accept failed but invite was still sent
        console.error('GitHub auto-accept error:', autoErr);
      }

      return { sent: true };

    } else if (ghResponse.status === 204) {
      // 204 = already a collaborator
      await githubDb.updateInviteStatus(projectId, invitedUserId, 2);
      return { sent: true, autoAccepted: true };

    } else {
      const ghError = await ghResponse.json().catch(() => ({}));
      return { sent: false, error: ghError.message || `GitHub API error (${ghResponse.status})` };
    }

  } catch (ghErr) {
    console.error('GitHub invite error:', ghErr);
    return { sent: false, error: 'Failed to send GitHub invite' };
  }
}

// Remove a GitHub collaborator using snapshot github_id
async function removeGithubCollaborator(snapshotGithubId, githubRepo, creatorId) {
  // Resolve GitHub username from snapshot ID
  let githubUsername = null;
  if (snapshotGithubId) {
    githubUsername = await resolveGithubUsername(snapshotGithubId);
  }
  if (!githubUsername) {
    return { removed: false, error: 'Could not resolve GitHub username' };
  }

  const creatorGithub = await githubDb.getGithubInfo(creatorId);
  if (!creatorGithub || !creatorGithub.github_token) {
    return { removed: false, error: 'Creator has no GitHub token' };
  }

  try {
    const accessToken = decrypt(creatorGithub.github_token);
    const [owner, repo] = githubRepo.split('/');
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/collaborators/${githubUsername}`,
      { method: 'DELETE', headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/vnd.github+json' } }
    );
    // 204 = removed, 404 = already not a collaborator
    if (res.status === 204 || res.status === 404) {
      return { removed: true };
    }
    const err = await res.json().catch(() => ({}));
    return { removed: false, error: err.message || `GitHub API error (${res.status})` };
  } catch (e) {
    console.error('Remove GitHub collaborator error:', e);
    return { removed: false, error: 'Failed to remove GitHub collaborator' };
  }
}

// POST /unlink - Unlink GitHub account
router.post('/unlink', requireAuth, async (req, res) => {
  const info = await githubDb.getGithubInfo(req.session.userId);

  if (!info || !info.github_id) {
    return res.status(400).json({ success: false, message: 'No GitHub account linked' });
  }

  // Block unlink if user has any active software project membership (creator or member)
  const [creatorProjects, memberProjects] = await Promise.all([
    projectDb.getActiveSoftwareProjectsAsCreator(req.session.userId),
    memberDb.getActiveSoftwareProjectsAsMember(req.session.userId)
  ]);

  const blockedProjects = [...creatorProjects, ...memberProjects];
  if (blockedProjects.length > 0) {
    const names = blockedProjects.map(p => p.name).join(', ');
    return res.status(400).json({
      success: false,
      message: `You are an active member of software project(s): ${names}. Leave or complete these projects before unlinking GitHub.`,
      blockedProjects: blockedProjects.map(p => ({ id: p.id, name: p.name }))
    });
  }

  await githubDb.unlinkAccount(req.session.userId);
  res.json({ success: true, message: 'GitHub account unlinked' });
});

module.exports = router;
module.exports.sendCollaboratorInvite = sendCollaboratorInvite;
module.exports.createGithubRepo = createGithubRepo;
module.exports.removeGithubCollaborator = removeGithubCollaborator;
module.exports.resolveGithubUsername = resolveGithubUsername;
