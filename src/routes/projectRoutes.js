const express = require('express');
const router = express.Router();
const { projectDb, userDb, memberDb, joinRequestDb, joinRequestMessageDb, projectMessageDb, projectTodoDb, githubDb, kickVoteDb, healthReadDb, notificationDb, commitVoteDb, pool } = require('../models/database');
const { encrypt, decrypt } = require('../utils/encryption');
const { sendCollaboratorInvite, createGithubRepo, removeGithubCollaborator, resolveGithubUsername } = require('./githubRoutes');
const { triggerForMember, triggerForAllActiveMembers } = require('../services/certificateBuilder');
const {
  createProjectValidation,
  updateProjectValidation,
  joinRequestValidation,
  manageRequestValidation,
  paramIdValidation,
  paramRequestIdValidation,
  paramMemberIdValidation,
  paramVoteIdValidation,
  moderatorValidation,
  kickVoteValidation,
  ballotValidation,
  messageContentValidation,
  paramUserIdValidation,
  healthReadValidation,
  createTodoValidation,
  paramTodoIdValidation,
  commitVoteValidation,
  commitShasValidation,
  paramCommitShaValidation
} = require('../middleware/validators');

// Middleware: Check if user is authenticated
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }
  next();
}

// Middleware: Check if user is creator or moderator of the project
async function requireManagement(req, res, next) {
  try {
    const project = await projectDb.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }
    const userId = req.session.userId;
    const isCreator = project.creator_id === userId;
    const isMod = await memberDb.isModerator(req.params.id, userId);
    if (!isCreator && !isMod) {
      return res.status(403).json({ success: false, message: 'Management role required' });
    }
    req.project = project;
    req.isCreator = isCreator;
    req.isMod = isMod;
    next();
  } catch (err) {
    console.error('requireManagement error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
}

// CREATE: New project
router.post('/', requireAuth, createProjectValidation, async (req, res) => {
  try {
    const { name, description, tags, lookingFor, githubRepo, projectType } = req.body;
    let repoValue = githubRepo || null;
    const typeValue = projectType || 'software';

    // Software projects require GitHub to be linked
    if (typeValue === 'software') {
      const githubInfo = await githubDb.getGithubInfo(req.session.userId);
      if (!githubInfo || !githubInfo.github_id) {
        return res.status(400).json({
          success: false,
          message: 'Software projects require a linked GitHub account. Please link your GitHub account first.',
          githubRequired: true
        });
      }
    }

    // Check if user already has an active project with the same name
    if (await projectDb.hasActiveDuplicateName(req.session.userId, name)) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active project with this name'
      });
    }

    // Auto-create GitHub repo if software project and no repo selected
    if (typeValue === 'software' && !repoValue) {
      const repoResult = await createGithubRepo(req.session.userId, name);
      if (!repoResult.success) {
        if (repoResult.error === 'duplicate') {
          return res.status(400).json({
            success: false,
            message: 'A GitHub repository with this name already exists on your account'
          });
        }
        return res.status(500).json({
          success: false,
          message: 'Failed to create GitHub repository'
        });
      }
      repoValue = repoResult.fullName;
    }

    // Verify the selected repo is owned by the requesting user (block collaborator repos)
    if (typeValue === 'software' && repoValue) {
      const githubInfo = await githubDb.getGithubInfo(req.session.userId);
      const ownerLogin = (githubInfo?.github_username || '').toLowerCase();
      const repoOwner = repoValue.split('/')[0]?.toLowerCase();
      if (!ownerLogin || ownerLogin !== repoOwner) {
        return res.status(400).json({
          success: false,
          message: 'You can only link a repository that you own'
        });
      }
    }

    // Check if repo is already used by another active project
    if (repoValue && await projectDb.isRepoInUse(repoValue)) {
      return res.status(400).json({
        success: false,
        message: 'This GitHub repository is already linked to another active project'
      });
    }

    // New projects always start with recruitment open
    const recruitmentOpen = true;

    // Create project
    const project = await projectDb.create(
      name,
      description,
      req.session.userId,
      tags,
      lookingFor,
      recruitmentOpen,
      repoValue,
      typeValue
    );

    res.status(201).json({
      success: true,
      message: 'Project created successfully',
      project
    });

  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// READ: Get user's projects (creator + member, active + past)
router.get('/', requireAuth, async (req, res) => {
  try {
    // Get all projects where user is creator OR member
    const projects = await projectDb.findUserProjects(req.session.userId);

    res.json({
      success: true,
      projects
    });

  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// READ: Get current user's pending join requests (applicant side)
router.get('/my-requests', requireAuth, async (req, res) => {
  try {
    const requests = await joinRequestDb.getByUserId(req.session.userId);
    res.json({ success: true, requests });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// CANCEL: Withdraw own pending join request
router.delete('/my-requests/:requestId', requireAuth, async (req, res) => {
  try {
    const cancelled = await joinRequestDb.cancelRequest(req.params.requestId, req.session.userId);
    if (!cancelled) {
      return res.status(404).json({ success: false, message: 'Request not found or already processed' });
    }
    res.json({ success: true, message: 'Request cancelled' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// READ: Get discover projects (PUBLIC - no auth required, but filters if logged in)
router.get('/discover', async (req, res) => {
  try {
    // Pass userId if logged in (to filter out projects user is already in)
    const userId = req.session.userId || null;
    const projects = await projectDb.findDiscoverProjects(userId);

    res.json({
      success: true,
      projects
    });

  } catch (error) {
    console.error('Get discover projects error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// READ: Get single project by ID
router.get('/:id', paramIdValidation, async (req, res) => {
  try {
    const userId = req.session.userId || null;
    const project = await projectDb.findById(req.params.id, userId);

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Get creator username
    const creator = await userDb.findById(project.creator_id);
    project.creator_username = creator ? creator.username : 'Unknown';

    res.json({
      success: true,
      project
    });

  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// UPDATE: Update project (creator or moderator)
router.put('/:id', requireAuth, paramIdValidation, updateProjectValidation, requireManagement, async (req, res) => {
  try {
    const { name, description, tags, lookingFor, recruitmentOpen } = req.body;
    const project = req.project;

    // Bypass creator_id check in projectDb.update by running the query directly via pool
    const { rowCount } = await pool.query(
      `UPDATE projects
       SET name = $1, description = $2, tags = $3, looking_for = $4, recruitment_open = $5, updated_at = NOW()
       WHERE id = $6 AND project_status = 'active'`,
      [name, description, JSON.stringify(tags), JSON.stringify(lookingFor), recruitmentOpen, project.id]
    );

    if (rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Project not found or not active'
      });
    }

    res.json({
      success: true,
      message: 'Project updated successfully'
    });

  } catch (error) {
    console.error('Update project error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// PATCH: Toggle recruitment status (creator or moderator)
router.patch('/:id/recruitment', requireAuth, paramIdValidation, requireManagement, async (req, res) => {
  try {
    const project = req.project;

    const { rowCount } = await pool.query(
      `UPDATE projects SET recruitment_open = $1, updated_at = NOW()
       WHERE id = $2 AND project_status = 'active'`,
      [!project.recruitmentOpen, project.id]
    );

    if (rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Project not found or not active'
      });
    }

    res.json({
      success: true,
      message: 'Recruitment status updated',
      recruitment_open: !project.recruitmentOpen
    });

  } catch (error) {
    console.error('Toggle recruitment error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// COMPLETE: Mark project as completed (creator only)
router.patch('/:id/complete', requireAuth, paramIdValidation, async (req, res) => {
  try {
    const projectId = req.params.id;
    const project = await projectDb.findById(projectId);
    const success = await projectDb.complete(projectId, req.session.userId);

    if (!success) {
      return res.status(404).json({
        success: false,
        message: 'Project not found, unauthorized, or already completed'
      });
    }

    // Notify all members + issue certificates
    if (project) {
      const allMembers = await memberDb.getProjectMembers(projectId);
      allMembers
        .filter(m => m.user_id !== req.session.userId)
        .forEach(m => notificationDb.create(m.user_id, 'project_completed', projectId, project.name).catch(() => {}));
      // Also issue certificate for creator
      triggerForMember(req.session.userId, projectId, 'completed').catch(() => {});
      allMembers
        .filter(m => m.user_id !== req.session.userId)
        .forEach(m => triggerForMember(m.user_id, projectId, 'completed').catch(() => {}));
    }

    res.json({
      success: true,
      message: 'Project marked as completed'
    });

  } catch (error) {
    console.error('Complete project error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// DELETE: Delete project
router.delete('/:id', requireAuth, paramIdValidation, async (req, res) => {
  try {
    const projectId = req.params.id;
    const project = await projectDb.findById(projectId);
    const allMembers = project ? await memberDb.getProjectMembers(projectId) : [];
    const success = await projectDb.delete(projectId, req.session.userId);

    if (!success) {
      return res.status(404).json({
        success: false,
        message: 'Project not found or unauthorized'
      });
    }

    // Notify all members + issue certificates (including creator)
    allMembers
      .filter(m => m.user_id !== req.session.userId)
      .forEach(m => notificationDb.create(m.user_id, 'project_deleted', projectId, project.name).catch(() => {}));
    triggerForMember(req.session.userId, projectId, 'deleted').catch(() => {});
    allMembers
      .filter(m => m.user_id !== req.session.userId)
      .forEach(m => triggerForMember(m.user_id, projectId, 'deleted').catch(() => {}));

    res.json({
      success: true,
      message: 'Project deleted successfully'
    });

  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// JOIN REQUEST: Send join request to project
router.post('/:id/join', requireAuth, paramIdValidation, joinRequestValidation, async (req, res) => {
  try {
    const projectId = req.params.id;
    const userId = req.session.userId;
    const { message } = req.body;

    // Check if project exists
    const project = await projectDb.findById(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Check if user is the creator
    if (project.creator_id === userId) {
      return res.status(400).json({
        success: false,
        message: "You can't join your own project"
      });
    }

    // Software projects require GitHub to be linked
    let snapshotGithubId = null;
    if (project.projectType === 'software') {
      const githubInfo = await githubDb.getGithubInfo(userId);
      if (!githubInfo || !githubInfo.github_id) {
        return res.status(400).json({
          success: false,
          message: 'This is a software project. Please link your GitHub account before sending a join request.',
          githubRequired: true
        });
      }
      snapshotGithubId = githubInfo.github_id;

      // Block if this GitHub account was previously a member (kicked or left) under any PtahNest user
      const githubMember = await memberDb.findByGithubId(projectId, snapshotGithubId);
      if (githubMember) {
        const msg = githubMember.membership_status === 'kicked'
          ? 'This GitHub account was removed from this project and cannot rejoin.'
          : 'This GitHub account has already been part of this project.';
        return res.status(400).json({ success: false, message: msg });
      }

      // Block if this GitHub account has a pending/accepted join request under any PtahNest user
      const githubRequest = await joinRequestDb.findActiveByGithubId(projectId, snapshotGithubId);
      if (githubRequest) {
        return res.status(400).json({ success: false, message: 'This GitHub account already has an active request for this project.' });
      }
    }

    // Bypass prevention: collect all user_ids that share this user's github_id
    // (if any). Past restrictions on those accounts apply to this one too.
    const linkedUserIds = snapshotGithubId
      ? await userDb.findUserIdsByGithubId(snapshotGithubId)
      : [];
    const allUserIds = Array.from(new Set([userId, ...linkedUserIds]));

    // Check if user is already a member
    if (await memberDb.isMember(projectId, userId)) {
      return res.status(400).json({
        success: false,
        message: 'You are already a member of this project'
      });
    }

    // Check if any linked account has left or been kicked from this project
    const pastMembership = await memberDb.findMostRecentPastMembership(projectId, allUserIds);

    if (pastMembership) {
      if (pastMembership.membership_status === 'kicked') {
        return res.status(400).json({
          success: false,
          message: 'You were removed from this project and cannot rejoin.'
        });
      }
      // Left: 30-day cooldown
      const leftAt = new Date(pastMembership.left_at);
      const cooldownEnd = new Date(leftAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      if (new Date() < cooldownEnd) {
        const daysLeft = Math.ceil((cooldownEnd - new Date()) / (1000 * 60 * 60 * 24));
        return res.status(400).json({
          success: false,
          message: `You left this project. You can reapply in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`
        });
      }
    }

    // Check if any linked account has a pending request
    if (await joinRequestDb.hasPendingForUsers(projectId, allUserIds)) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending request for this project'
      });
    }

    // Check if any linked account was recently rejected (within 30 days)
    const rejectionCheck = await joinRequestDb.wasRecentlyRejected(projectId, allUserIds);
    if (rejectionCheck.blocked) {
      return res.status(400).json({
        success: false,
        message: `Your previous request was rejected. You can apply again in ${rejectionCheck.daysRemaining} days.`
      });
    }

    // If there's an old rejected request (>30 days), delete it before creating new one
    await joinRequestDb.deleteRejectedForUsers(projectId, allUserIds);

    // Create join request (snapshot github_id for software projects).
    // The intro message is NOT stored on the join_requests row — it is
    // seeded below as the first encrypted message in the request chat.
    const joinRequest = await joinRequestDb.create(projectId, userId, snapshotGithubId);

    // If applicant included an intro message, also seed the request chat with it
    if (message && message.trim().length > 0) {
      try {
        const encrypted = encrypt(message.trim());
        await joinRequestMessageDb.create(joinRequest.id, userId, encrypted);
      } catch (msgErr) {
        // Chat seed failure shouldn't break the join request itself
        console.error('Failed to seed join request chat with intro message:', msgErr);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Join request sent successfully',
      joinRequest
    });

  } catch (error) {
    console.error('Join request error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// GET: Get all join requests for a project (creator or moderator)
router.get('/:id/requests', requireAuth, paramIdValidation, requireManagement, async (req, res) => {
  try {
    const requests = await joinRequestDb.getPendingRequests(req.params.id);

    res.json({
      success: true,
      requests
    });

  } catch (error) {
    console.error('Get join requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// PATCH: Accept/reject join request (creator or moderator)
router.patch('/:id/requests/:requestId', requireAuth, paramIdValidation, paramRequestIdValidation, manageRequestValidation, requireManagement, async (req, res) => {
  try {
    const projectId = req.params.id;
    const requestId = req.params.requestId;
    const { action } = req.body; // 'accept' or 'reject'
    const project = req.project;

    // Get join request
    const joinRequest = await joinRequestDb.findById(requestId);
    if (!joinRequest) {
      return res.status(404).json({
        success: false,
        message: 'Join request not found'
      });
    }

    // Check if request belongs to this project
    if (joinRequest.project_id !== projectId) {
      return res.status(400).json({
        success: false,
        message: 'Join request does not belong to this project'
      });
    }

    if (action === 'accept') {
      // Accept request, delete chat messages, add user as member
      await joinRequestDb.accept(requestId);
      await joinRequestMessageDb.deleteByRequestId(requestId);
      await memberDb.addMember(projectId, joinRequest.user_id, 'member', joinRequest.github_id || null);

      // Send GitHub collaborator invite if software project has a linked repo
      const githubInvite = project.github_repo
        ? await sendCollaboratorInvite(projectId, joinRequest.user_id, project.github_repo, project.creator_id, joinRequest.github_id || null)
        : null;

      // Notify applicant
      notificationDb.create(joinRequest.user_id, 'accepted', projectId, project.name).catch(() => {});

      res.json({
        success: true,
        message: 'Join request accepted',
        githubInvite
      });
    } else if (action === 'reject') {
      // Reject request and delete chat messages
      await joinRequestDb.reject(requestId);
      await joinRequestMessageDb.deleteByRequestId(requestId);

      // Notify applicant
      notificationDb.create(joinRequest.user_id, 'rejected', projectId, project.name).catch(() => {});

      res.json({
        success: true,
        message: 'Join request rejected'
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Use "accept" or "reject"'
      });
    }

  } catch (error) {
    console.error('Manage join request error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// GET: Get all members of a project
router.get('/:id/members', requireAuth, paramIdValidation, async (req, res) => {
  try {
    const projectId = req.params.id;
    const userId = req.session.userId;

    // Check if project exists
    const project = await projectDb.findById(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Check if user is member or creator
    if (project.creator_id !== userId && !await memberDb.isMember(projectId, userId)) {
      return res.status(403).json({
        success: false,
        message: 'You must be a member to view project members'
      });
    }

    const members = await memberDb.getProjectMembers(projectId);

    res.json({
      success: true,
      members,
      currentUserId: userId // Send current user ID to frontend
    });

  } catch (error) {
    console.error('Get members error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Direct kick endpoint removed — use kick voting system (POST /:id/kick-votes)

// DELETE: Leave project (member self-removal)
router.delete('/:id/leave', requireAuth, paramIdValidation, async (req, res) => {
  try {
    const projectId = req.params.id;
    const userId = req.session.userId;

    // Check if project exists
    const project = await projectDb.findById(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Creator cannot leave their own project
    if (project.creator_id === userId) {
      return res.status(400).json({
        success: false,
        message: 'Project creator cannot leave. Delete the project instead.'
      });
    }

    // Check if user is member
    if (!await memberDb.isMember(projectId, userId)) {
      return res.status(400).json({
        success: false,
        message: 'You are not a member of this project'
      });
    }

    // Remove member
    await memberDb.removeMember(projectId, userId);

    // Issue certificate asynchronously — does not affect response
    triggerForMember(userId, projectId, 'left').catch(() => {});

    res.json({
      success: true,
      message: 'You have left the project'
    });

  } catch (error) {
    console.error('Leave project error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// POST: Promote member to moderator (creator only)
router.post('/:id/moderators', requireAuth, paramIdValidation, moderatorValidation, async (req, res) => {
  try {
    const { userId } = req.body;
    const project = await projectDb.findById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    if (project.creator_id !== req.session.userId) {
      return res.status(403).json({ success: false, message: 'Only project creator can assign moderators' });
    }

    // Cannot promote yourself or the creator
    if (userId === req.session.userId) {
      return res.status(400).json({ success: false, message: 'You are already the creator' });
    }

    const success = await memberDb.setRole(req.params.id, userId, 'moderator');
    if (!success) {
      return res.status(400).json({ success: false, message: 'Member not found or is already moderator/creator' });
    }

    res.json({ success: true, message: 'Member promoted to moderator' });
  } catch (error) {
    console.error('Promote moderator error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// DELETE: Demote moderator back to member (creator only)
router.delete('/:id/moderators/:memberId', requireAuth, paramIdValidation, paramMemberIdValidation, async (req, res) => {
  try {
    const project = await projectDb.findById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    if (project.creator_id !== req.session.userId) {
      return res.status(403).json({ success: false, message: 'Only project creator can remove moderators' });
    }

    const success = await memberDb.setRole(req.params.id, req.params.memberId, 'member');
    if (!success) {
      return res.status(400).json({ success: false, message: 'Member not found or cannot be demoted' });
    }

    res.json({ success: true, message: 'Moderator demoted to member' });
  } catch (error) {
    console.error('Demote moderator error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// --- KICK VOTING ---

// Helper: resolve a vote if threshold met or expired, returns updated status.
// Uses weighted ballots: yes_weight / total_possible_weight >= 0.70.
// For research projects (no github_repo), each eligible member has equal weight (1).
// For software projects, weight comes from commit ratings (stored on ballot cast).
// total_possible_weight = sum of all eligible voters' weights (including those who haven't voted).
async function resolveVoteIfNeeded(vote, project) {
  if (vote.status !== 'open') return vote;

  const now = new Date();
  const expired = new Date(vote.expires_at) < now;

  // Get all eligible voters (active members except target)
  const eligible = await memberDb.getEligibleVoters(vote.project_id, vote.target_user_id);
  const totalEligible = eligible.length;
  if (totalEligible === 0) return vote;

  let totalPossibleWeight;
  const yesWeight = Number(vote.yes_weight || 0);

  if (project.projectType === 'software' && project.github_repo) {
    // Weighted: sum of all eligible members' leaderboard weights
    const leaderboard = await commitVoteDb.getLeaderboard(vote.project_id);
    const weightMap = {};
    leaderboard.forEach(e => { weightMap[e.githubUsername] = e.normalizedWeight; });
    totalPossibleWeight = eligible.reduce((sum, m) => sum + (weightMap[m.github_username] || 0), 0);
  } else {
    // Research project: each member weight = 1
    totalPossibleWeight = totalEligible;
  }

  const threshold = totalPossibleWeight > 0 ? yesWeight / totalPossibleWeight : 0;
  const passed = threshold >= 0.70;

  if (passed) {
    await kickVoteDb.resolve(vote.id, 'passed');
    const kickResult = await memberDb.kickMember(vote.project_id, vote.target_user_id);
    if (kickResult && project.projectType === 'software' && project.github_repo && kickResult.githubId) {
      await removeGithubCollaborator(kickResult.githubId, project.github_repo, project.creator_id);
    }
    notificationDb.create(vote.target_user_id, 'kicked', vote.project_id, project.name).catch(() => {});
    triggerForMember(vote.target_user_id, vote.project_id, 'kicked').catch(() => {});
    return { ...vote, status: 'passed' };
  }

  if (expired) {
    await kickVoteDb.resolve(vote.id, 'failed');
    return { ...vote, status: 'failed' };
  }

  return vote;
}

// POST: Start a kick vote (creator or moderator)
router.post('/:id/kick-votes', requireAuth, paramIdValidation, kickVoteValidation, requireManagement, async (req, res) => {
  try {
    const { targetUserId } = req.body;
    const project = req.project;

    // Cannot kick creator
    if (targetUserId === project.creator_id) {
      return res.status(400).json({ success: false, message: 'Cannot start a kick vote against the project creator' });
    }

    // Cannot kick yourself
    if (targetUserId === req.session.userId) {
      return res.status(400).json({ success: false, message: 'Cannot start a kick vote against yourself' });
    }

    // Target must be active member
    if (!await memberDb.isMember(project.id, targetUserId)) {
      return res.status(400).json({ success: false, message: 'Target user is not an active member of this project' });
    }

    // Check if open vote already exists for this target
    const existing = await kickVoteDb.getOpenVote(project.id, targetUserId);
    if (existing) {
      return res.status(409).json({ success: false, message: 'An open kick vote already exists for this member' });
    }

    const vote = await kickVoteDb.create(project.id, targetUserId, req.session.userId);

    res.status(201).json({ success: true, message: 'Kick vote started', vote });
  } catch (error) {
    console.error('Start kick vote error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET: List all kick votes for a project (active members only)
router.get('/:id/kick-votes', requireAuth, paramIdValidation, async (req, res) => {
  try {
    const projectId = req.params.id;
    const userId = req.session.userId;

    const project = await projectDb.findById(projectId);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    // Must be active member or creator
    if (project.creator_id !== userId && !await memberDb.isMember(projectId, userId)) {
      return res.status(403).json({ success: false, message: 'You must be a project member to view kick votes' });
    }

    let votes = await kickVoteDb.getVotesForProject(projectId);

    // Lazy-resolve open votes
    votes = await Promise.all(votes.map(v => resolveVoteIfNeeded(v, project)));

    // Attach current user's ballot for each vote
    const withBallots = await Promise.all(votes.map(async v => ({
      ...v,
      myBallot: v.status === 'open' ? await kickVoteDb.getBallot(v.id, userId) : null
    })));

    res.json({ success: true, votes: withBallots });
  } catch (error) {
    console.error('Get kick votes error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST: Cast a ballot on a kick vote
router.post('/:id/kick-votes/:voteId/ballot', requireAuth, paramIdValidation, paramVoteIdValidation, ballotValidation, async (req, res) => {
  try {
    const { ballot } = req.body;
    const userId = req.session.userId;
    const projectId = req.params.id;

    const project = await projectDb.findById(projectId);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    // Must be active member — fetch with joined_at for eligibility check
    const memberRow = await memberDb.findActiveWithJoinedAt(projectId, userId);
    const isCreator = project.creator_id === userId;
    if (!isCreator && !memberRow) {
      return res.status(403).json({ success: false, message: 'You must be a project member to vote' });
    }

    const vote = await kickVoteDb.findById(req.params.voteId);
    if (!vote || vote.project_id !== projectId) {
      return res.status(404).json({ success: false, message: 'Vote not found' });
    }

    // Members who joined after the vote started cannot vote
    if (!isCreator && memberRow.joined_at > vote.created_at) {
      return res.status(403).json({ success: false, message: 'You joined after this vote started and cannot participate' });
    }

    if (vote.status !== 'open') {
      return res.status(400).json({ success: false, message: 'This vote is already closed' });
    }

    // Target cannot vote on their own kick
    if (vote.target_user_id === userId) {
      return res.status(403).json({ success: false, message: 'You cannot vote on your own kick' });
    }

    // Already voted — no changes allowed
    if (await kickVoteDb.getBallot(vote.id, userId) !== null) {
      return res.status(400).json({ success: false, message: 'You have already voted and cannot change your vote' });
    }

    // Check if expired before accepting vote
    if (new Date(vote.expires_at) < new Date()) {
      await kickVoteDb.resolve(vote.id, 'failed');
      return res.status(400).json({ success: false, message: 'This vote has expired' });
    }

    // Determine voter's weight: leaderboard share for software projects, 1 for research
    let voterWeight = 1;
    if (project.projectType === 'software' && project.github_repo) {
      const githubUsername = await userDb.getGithubUsername(userId);
      if (githubUsername) {
        voterWeight = await commitVoteDb.getWeight(projectId, githubUsername);
      }
    }

    await kickVoteDb.castBallot(vote.id, userId, ballot, voterWeight);

    // Re-fetch with updated counts for early resolution check
    const updatedVote = await kickVoteDb.findById(vote.id);
    const resolved = await resolveVoteIfNeeded(updatedVote, project);

    res.json({
      success: true,
      message: 'Ballot cast successfully',
      voteStatus: resolved.status
    });
  } catch (error) {
    console.error('Cast ballot error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST: Cancel a kick vote (creator only)
router.post('/:id/kick-votes/:voteId/cancel', requireAuth, paramIdValidation, paramVoteIdValidation, async (req, res) => {
  try {
    const project = await projectDb.findById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    if (project.creator_id !== req.session.userId) {
      return res.status(403).json({ success: false, message: 'Only project creator can cancel a kick vote' });
    }

    const vote = await kickVoteDb.findById(req.params.voteId);
    if (!vote || vote.project_id !== req.params.id) {
      return res.status(404).json({ success: false, message: 'Vote not found' });
    }

    if (vote.status !== 'open') {
      return res.status(400).json({ success: false, message: 'Vote is already closed' });
    }

    await kickVoteDb.resolve(vote.id, 'cancelled');

    res.json({ success: true, message: 'Kick vote cancelled' });
  } catch (error) {
    console.error('Cancel kick vote error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET: Pending kick votes for current user (for notification bell)
router.get('/me/kick-votes/pending', requireAuth, async (req, res) => {
  try {
    const votes = await kickVoteDb.getPendingForUser(req.session.userId);
    res.json({ success: true, votes });
  } catch (error) {
    console.error('Get pending kick votes error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ========================================
// JOIN REQUEST CHAT
// ========================================

// Middleware: allow request participant (applicant) or management (mod/creator)
async function requireRequestParticipant(req, res, next) {
  try {
    const requestId = req.params.requestId;
    const joinRequest = await joinRequestDb.findById(requestId);
    if (!joinRequest) return res.status(404).json({ success: false, message: 'Request not found' });

    const userId = req.session.userId;
    // Applicant can access their own request
    if (joinRequest.user_id === userId) return next();

    // Management can access via requireManagement logic
    const project = await projectDb.findById(req.params.id, userId);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    const role = project.role;
    if (role === 'creator' || role === 'moderator') return next();

    return res.status(403).json({ success: false, message: 'Access denied' });
  } catch (err) {
    console.error('requireRequestParticipant error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
}

// POST: Send a chat message on a join request
router.post('/:id/requests/:requestId/messages', requireAuth, paramIdValidation, paramRequestIdValidation, messageContentValidation, requireRequestParticipant, async (req, res) => {
  try {
    const { content } = req.body;
    const encrypted = encrypt(content);
    await joinRequestMessageDb.create(req.params.requestId, req.session.userId, encrypted);
    res.json({ success: true });
  } catch (error) {
    console.error('Send request message error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET: Fetch chat messages for a join request
router.get('/:id/requests/:requestId/messages', requireAuth, paramIdValidation, paramRequestIdValidation, requireRequestParticipant, async (req, res) => {
  try {
    const rows = await joinRequestMessageDb.getByRequestId(req.params.requestId);
    const messages = rows.map(m => ({
      id: m.id,
      sender_id: m.sender_id,
      sender_username: m.sender_username,
      sender_role: m.sender_role || null,
      content: decrypt(m.encrypted_content),
      created_at: m.created_at
    }));
    res.json({ success: true, messages });
  } catch (error) {
    console.error('Get request messages error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ========================================
// PROJECT CHAT
// ========================================

// Middleware: allow active project members only (creator/mod/member)
// Blocks left/kicked users and non-active projects (completed/deleted)
// Read-only: any past or current member can access (for viewing history on past projects)
async function requireMemberAny(req, res, next) {
  try {
    const project = await projectDb.findById(req.params.id, req.session.userId);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    if (!project.role) return res.status(403).json({ success: false, message: 'Members only' });
    next();
  } catch (err) {
    console.error('requireMemberAny error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
}

// Read actions: user must be active member, project can be completed/deleted
async function requireActiveProject(req, res, next) {
  try {
    const project = await projectDb.findById(req.params.id, req.session.userId);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    if (!project.role) return res.status(403).json({ success: false, message: 'Members only' });
    if (project.memberStatus !== 'active') return res.status(403).json({ success: false, message: 'You are no longer an active member of this project' });
    next();
  } catch (err) {
    console.error('requireActiveProject error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
}

// Write actions: only active members of an active project
async function requireActiveMember(req, res, next) {
  try {
    const project = await projectDb.findById(req.params.id, req.session.userId);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    if (!project.role) return res.status(403).json({ success: false, message: 'Members only' });
    if (project.memberStatus !== 'active') return res.status(403).json({ success: false, message: 'You are no longer an active member of this project' });
    if (project.status !== 'active') return res.status(403).json({ success: false, message: 'This project is no longer active' });
    next();
  } catch (err) {
    console.error('requireActiveMember error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
}

// POST: Send a project chat message
router.post('/:id/messages', requireAuth, paramIdValidation, messageContentValidation, requireActiveMember, async (req, res) => {
  try {
    const encrypted = encrypt(req.body.content);
    await projectMessageDb.create(req.params.id, req.session.userId, encrypted);
    res.json({ success: true });
  } catch (error) {
    console.error('Send project message error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET: Fetch project chat messages
router.get('/:id/messages', requireAuth, paramIdValidation, requireActiveProject, async (req, res) => {
  try {
    const rows = await projectMessageDb.getByProjectId(req.params.id);
    const messages = rows.map(m => ({
      id: m.id,
      sender_id: m.sender_id,
      sender_username: m.sender_username,
      sender_role: m.sender_role || null,
      content: decrypt(m.encrypted_content),
      created_at: m.created_at
    }));
    res.json({ success: true, messages });
  } catch (error) {
    console.error('Get project messages error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ========================================
// PUBLIC USER PROFILE
// ========================================

// GET: Public profile for join request preview
router.get('/users/:userId/profile', requireAuth, paramUserIdValidation, async (req, res) => {
  try {
    const profile = await userDb.getPublicProfile(req.params.userId, req.session.userId);
    if (!profile) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, profile });
  } catch (error) {
    console.error('Get public profile error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET: Project health diagnostics (creator + moderator only)
router.get('/:id/health', requireAuth, paramIdValidation, requireManagement, async (req, res) => {
  try {
    const projectId = req.params.id;
    const project = await projectDb.findById(projectId, req.session.userId);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    const issues = [];
    const isSoftware = project.projectType === 'software';

    // #1 Invite not sent (software only)
    if (isSoftware) {
      const notSent = await memberDb.getInviteNotSent(projectId);
      for (const m of notSent) {
        issues.push({ type: 'invite_not_sent', userId: m.user_id, username: m.username });
      }
    }

    // #2 Invite stuck > 7 days (software only)
    if (isSoftware) {
      const stuck = await memberDb.getInviteStuck(projectId);
      for (const m of stuck) {
        const days = Math.floor((Date.now() - new Date(m.github_invited_at)) / 86400000);
        issues.push({ type: 'invite_stuck', userId: m.user_id, username: m.username, days });
      }
    }

    // #3 Expired open kick votes
    const expiredVotes = await kickVoteDb.getExpiredOpen(projectId);
    for (const v of expiredVotes) {
      issues.push({ type: 'vote_expired', voteId: v.id, targetUsername: v.target_username });
    }

    // #4 Not a GitHub collaborator (software only, requires creator token)
    if (isSoftware && project.githubRepo) {
      const encryptedToken = await userDb.getEncryptedGithubToken(project.creator_id);
      if (encryptedToken) {
        const token = decrypt(encryptedToken);
        const accepted = await memberDb.getAcceptedMembers(projectId);

        for (const m of accepted) {
          if (!m.github_id) continue;
          try {
            const username = await resolveGithubUsername(m.github_id);
            if (!username) continue;
            const checkRes = await fetch(
              `https://api.github.com/repos/${project.githubRepo}/collaborators/${username}`,
              { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' } }
            );
            if (checkRes.status === 404) {
              issues.push({ type: 'not_collaborator', userId: m.user_id, username: m.username });
            }
          } catch { /* skip individual member on error */ }
        }
      }
    }

    res.json({ success: true, issues });
  } catch (err) {
    console.error('Health check error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET: Health issue read state for a project (creator + moderator)
router.get('/:id/health-reads', requireAuth, paramIdValidation, requireManagement, async (req, res) => {
  try {
    const reads = await healthReadDb.getReadsForProject(req.params.id);
    res.json({ success: true, reads });
  } catch (err) {
    console.error('Health reads GET error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST: Toggle health issue read state (creator or moderator, own role only)
router.post('/:id/health-reads', requireAuth, paramIdValidation, requireManagement, healthReadValidation, async (req, res) => {
  try {
    const { issueKey, role, read } = req.body;
    const userId = req.session.userId;

    // Enforce: user can only toggle their own role's mark
    if (role === 'creator' && !req.isCreator) {
      return res.status(403).json({ success: false, message: 'Only the creator can mark as creator' });
    }
    if (role === 'moderator' && !req.isMod) {
      return res.status(403).json({ success: false, message: 'Only moderators can mark as moderator' });
    }

    if (read) {
      await healthReadDb.markRead(req.params.id, issueKey, userId, role);
    } else {
      await healthReadDb.markUnread(req.params.id, issueKey, userId);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Health reads POST error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// DELETE: Dismiss a health issue entirely (creator only)
router.delete('/:id/health-reads/:issueKey', requireAuth, paramIdValidation, requireManagement, async (req, res) => {
  try {
    if (!req.isCreator) {
      return res.status(403).json({ success: false, message: 'Only the creator can dismiss issues' });
    }
    const issueKey = decodeURIComponent(req.params.issueKey);
    await healthReadDb.dismissIssue(req.params.id, issueKey);
    res.json({ success: true });
  } catch (err) {
    console.error('Health reads DELETE error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ========================================
// PROJECT TODOS
// ========================================

// GET: List all todos for a project (active members only)
router.get('/:id/todos', requireAuth, paramIdValidation, requireActiveProject, async (req, res) => {
  try {
    const todos = await projectTodoDb.getByProjectId(req.params.id);
    res.json({ success: true, todos });
  } catch (err) {
    console.error('Get todos error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Helper: check if user is creator/moderator of a project
async function isManagementOf(projectId, userId) {
  const project = await projectDb.findById(projectId, userId);
  return project && (project.role === 'creator' || project.role === 'moderator');
}

// POST: Create a todo (any active member; assignedTo restricted to mgmt only)
router.post('/:id/todos', requireAuth, paramIdValidation, createTodoValidation, requireActiveMember, async (req, res) => {
  try {
    const { title, description, dueDate, assignedTo } = req.body;

    // Only creator/moderator can assign todos to a user
    if (assignedTo) {
      const isMgmt = await isManagementOf(req.params.id, req.session.userId);
      if (!isMgmt) {
        return res.status(403).json({ success: false, message: 'Only creator or moderator can assign todos' });
      }
    }

    const id = await projectTodoDb.create(req.params.id, req.session.userId, { title, description, dueDate, assignedTo });
    res.status(201).json({ success: true, id });
  } catch (err) {
    console.error('Create todo error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PATCH: Toggle todo complete/incomplete (creator/mod, author, or assignee)
router.patch('/:id/todos/:todoId', requireAuth, paramIdValidation, paramTodoIdValidation, requireActiveMember, async (req, res) => {
  try {
    const todo = await projectTodoDb.findById(req.params.todoId, req.params.id);
    if (!todo) return res.status(404).json({ success: false, message: 'Todo not found' });

    const isMgmt = await isManagementOf(req.params.id, req.session.userId);
    const isAuthor = todo.created_by === req.session.userId;
    const isAssignee = todo.assigned_to === req.session.userId;
    if (!isMgmt && !isAuthor && !isAssignee) {
      return res.status(403).json({ success: false, message: 'Only creator/moderator, todo author, or assignee can toggle' });
    }

    await projectTodoDb.toggleComplete(req.params.todoId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Toggle todo error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PUT: Edit a todo (creator/mod, or original author)
router.put('/:id/todos/:todoId', requireAuth, paramIdValidation, paramTodoIdValidation, createTodoValidation, requireActiveMember, async (req, res) => {
  try {
    const todo = await projectTodoDb.findById(req.params.todoId, req.params.id);
    if (!todo) return res.status(404).json({ success: false, message: 'Todo not found' });

    const isMgmt = await isManagementOf(req.params.id, req.session.userId);
    const isAuthor = todo.created_by === req.session.userId;
    if (!isMgmt && !isAuthor) {
      return res.status(403).json({ success: false, message: 'Only creator/moderator or todo author can edit' });
    }

    const { title, description, dueDate, assignedTo } = req.body;

    // Only mgmt can set or change assignment
    if (!isMgmt && assignedTo !== (todo.assigned_to || null)) {
      return res.status(403).json({ success: false, message: 'Only creator or moderator can change assignment' });
    }

    await projectTodoDb.update(req.params.todoId, req.params.id, { title, description, dueDate, assignedTo });
    res.json({ success: true });
  } catch (err) {
    console.error('Update todo error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// DELETE: Delete a todo (creator/mod, or original author)
router.delete('/:id/todos/:todoId', requireAuth, paramIdValidation, paramTodoIdValidation, requireActiveMember, async (req, res) => {
  try {
    const todo = await projectTodoDb.findById(req.params.todoId, req.params.id);
    if (!todo) return res.status(404).json({ success: false, message: 'Todo not found' });

    const isMgmt = await isManagementOf(req.params.id, req.session.userId);
    const isAuthor = todo.created_by === req.session.userId;
    if (!isMgmt && !isAuthor) {
      return res.status(403).json({ success: false, message: 'Only creator/moderator or todo author can delete' });
    }

    await projectTodoDb.delete(req.params.todoId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete todo error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ========================================
// COMMIT VOTES

// GET: Fetch avg ratings + user's votes for a list of commit SHAs
router.get('/:id/commit-votes', requireAuth, paramIdValidation, commitShasValidation, requireActiveProject, async (req, res) => {
  try {
    const projectId = req.params.id;
    const shas = req.query.shas.split(',').map(s => s.trim()).filter(Boolean).slice(0, 50);
    if (!shas.length) return res.json({ success: true, data: { averages: {}, userVotes: {} } });

    const [averages, userVotes] = await Promise.all([
      commitVoteDb.getAverages(projectId, shas),
      commitVoteDb.getUserVotes(projectId, req.session.userId, shas)
    ]);

    res.json({ success: true, data: { averages, userVotes } });
  } catch (err) {
    console.error('Get commit votes error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET: Leaderboard for a project (active members only)
router.get('/:id/leaderboard', requireAuth, paramIdValidation, requireActiveProject, async (req, res) => {
  try {
    const leaderboard = await commitVoteDb.getLeaderboard(req.params.id);
    res.json({ success: true, data: { leaderboard } });
  } catch (err) {
    console.error('Get leaderboard error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST: Cast or update a commit vote
router.post('/:id/commit-votes', requireAuth, paramIdValidation, commitVoteValidation, requireActiveMember, async (req, res) => {
  try {
    const projectId = req.params.id;
    const { sha, rating, commitAuthor } = req.body;

    await commitVoteDb.upsert(projectId, sha, req.session.userId, rating, commitAuthor || null);

    // Return updated avg for instant UI feedback
    const averages = await commitVoteDb.getAverages(projectId, [sha]);
    const info = averages[sha] || { avg: rating, count: 1 };

    res.json({ success: true, data: { sha, rating, avg: info.avg, count: info.count } });
  } catch (err) {
    console.error('Cast commit vote error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// DELETE: Remove a commit vote (toggle-off)
router.delete('/:id/commit-votes/:sha', requireAuth, paramIdValidation, paramCommitShaValidation, requireActiveMember, async (req, res) => {
  try {
    const projectId = req.params.id;
    const sha = req.params.sha;

    await commitVoteDb.remove(projectId, sha, req.session.userId);

    // Return updated avg so UI reflects removal
    const averages = await commitVoteDb.getAverages(projectId, [sha]);
    const info = averages[sha] || { avg: null, count: 0 };

    res.json({ success: true, data: { sha, avg: info.avg, count: info.count } });
  } catch (err) {
    console.error('Remove commit vote error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
