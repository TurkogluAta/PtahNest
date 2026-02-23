const express = require('express');
const router = express.Router();
const { projectDb, userDb, memberDb, joinRequestDb, githubDb } = require('../models/database');
const { sendCollaboratorInvite } = require('./githubRoutes');
const {
  createProjectValidation,
  updateProjectValidation,
  joinRequestValidation,
  manageRequestValidation,
  paramIdValidation,
  paramRequestIdValidation
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

// CREATE: New project
router.post('/', requireAuth, createProjectValidation, async (req, res) => {
  try {
    const { name, description, tags, lookingFor, githubRepo, projectType } = req.body;
    const repoValue = githubRepo || null;
    const typeValue = projectType || 'software';

    // Software projects require GitHub to be linked
    if (typeValue === 'software') {
      const githubInfo = githubDb.getGithubInfo(req.session.userId);
      if (!githubInfo || !githubInfo.github_id) {
        return res.status(400).json({
          success: false,
          message: 'Software projects require a linked GitHub account. Please link your GitHub account first.',
          githubRequired: true
        });
      }
    }

    // Check if user already has an active project with the same name
    if (projectDb.hasActiveDuplicateName(req.session.userId, name)) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active project with this name'
      });
    }

    // Check if repo is already used by another active project
    if (repoValue && projectDb.isRepoInUse(repoValue)) {
      return res.status(400).json({
        success: false,
        message: 'This GitHub repository is already linked to another active project'
      });
    }

    // Auto-set recruitment status
    const recruitmentOpen = lookingFor.length > 0;

    // Create project
    const project = projectDb.create(
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
    const projects = projectDb.findUserProjects(req.session.userId);

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

// READ: Get discover projects (PUBLIC - no auth required, but filters if logged in)
router.get('/discover', async (req, res) => {
  try {
    // Pass userId if logged in (to filter out projects user is already in)
    const userId = req.session.userId || null;
    const projects = projectDb.findDiscoverProjects(userId);

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
    const project = projectDb.findById(req.params.id);

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Get creator username
    const creator = userDb.findById(project.creator_id);
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

// UPDATE: Update project
router.put('/:id', requireAuth, paramIdValidation, updateProjectValidation, async (req, res) => {
  try {
    const { name, description, tags, lookingFor, recruitmentOpen, githubRepo } = req.body;
    const repoValue = githubRepo || null;

    // Check if repo is already used by another active project (exclude current project)
    if (repoValue && projectDb.isRepoInUse(repoValue, req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'This GitHub repository is already linked to another active project'
      });
    }

    // Update project (ownership check in projectDb.update)
    const success = projectDb.update(req.params.id, req.session.userId, {
      name,
      description,
      tags,
      lookingFor,
      recruitmentOpen,
      githubRepo: repoValue
    });

    if (!success) {
      return res.status(404).json({
        success: false,
        message: 'Project not found or unauthorized'
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

// PATCH: Toggle recruitment status
router.patch('/:id/recruitment', requireAuth, paramIdValidation, async (req, res) => {
  try {
    const success = projectDb.toggleRecruitment(req.params.id, req.session.userId);

    if (!success) {
      return res.status(404).json({
        success: false,
        message: 'Project not found or unauthorized'
      });
    }

    const project = projectDb.findById(req.params.id);

    res.json({
      success: true,
      message: 'Recruitment status updated',
      recruitment_open: project.recruitmentOpen
    });

  } catch (error) {
    console.error('Toggle recruitment error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// DELETE: Delete project
router.delete('/:id', requireAuth, paramIdValidation, async (req, res) => {
  try {
    const success = projectDb.delete(req.params.id, req.session.userId);

    if (!success) {
      return res.status(404).json({
        success: false,
        message: 'Project not found or unauthorized'
      });
    }

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
    const project = projectDb.findById(projectId);
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
    if (project.projectType === 'software') {
      const githubInfo = githubDb.getGithubInfo(userId);
      if (!githubInfo || !githubInfo.github_id) {
        return res.status(400).json({
          success: false,
          message: 'This is a software project. Please link your GitHub account before sending a join request.',
          githubRequired: true
        });
      }
    }

    // Check if user is already a member
    if (memberDb.isMember(projectId, userId)) {
      return res.status(400).json({
        success: false,
        message: 'You are already a member of this project'
      });
    }

    // Check if user has left or been kicked
    const { db } = require('../models/database');
    const pastMembership = db.prepare(`
      SELECT membership_status FROM project_members
      WHERE project_id = ? AND user_id = ? AND membership_status IN ('left', 'kicked')
    `).get(projectId, userId);

    if (pastMembership) {
      const message = pastMembership.membership_status === 'kicked'
        ? 'You were removed from this project and cannot rejoin.'
        : 'You have already left this project. Please contact the project creator to rejoin.';

      return res.status(400).json({
        success: false,
        message
      });
    }

    // Check if user already has a pending request
    if (joinRequestDb.hasPendingRequest(projectId, userId)) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending request for this project'
      });
    }

    // Check if user was recently rejected (within 30 days)
    const rejectionCheck = joinRequestDb.wasRecentlyRejected(projectId, userId);
    if (rejectionCheck.blocked) {
      return res.status(400).json({
        success: false,
        message: `Your previous request was rejected. You can apply again in ${rejectionCheck.daysRemaining} days.`
      });
    }

    // If there's an old rejected request (>30 days), delete it before creating new one
    const stmt = require('../models/database').db.prepare(`
      DELETE FROM join_requests
      WHERE project_id = ? AND user_id = ? AND status = 'rejected'
    `);
    stmt.run(projectId, userId);

    // Create join request
    const joinRequest = joinRequestDb.create(projectId, userId, message);

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

// GET: Get all join requests for a project (creator only)
router.get('/:id/requests', requireAuth, paramIdValidation, async (req, res) => {
  try {
    const projectId = req.params.id;
    const userId = req.session.userId;

    // Check if project exists
    const project = projectDb.findById(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Check if user is the creator
    if (project.creator_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only project creator can view join requests'
      });
    }

    const requests = joinRequestDb.getPendingRequests(projectId);

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

// PATCH: Accept/reject join request
router.patch('/:id/requests/:requestId', requireAuth, paramIdValidation, paramRequestIdValidation, manageRequestValidation, async (req, res) => {
  try {
    const projectId = req.params.id;
    const requestId = req.params.requestId;
    const userId = req.session.userId;
    const { action } = req.body; // 'accept' or 'reject'

    // Check if project exists
    const project = projectDb.findById(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Check if user is the creator
    if (project.creator_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only project creator can manage join requests'
      });
    }

    // Get join request
    const joinRequest = joinRequestDb.findById(requestId);
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
      // Accept request and add user as member
      joinRequestDb.accept(requestId);
      memberDb.addMember(projectId, joinRequest.user_id, 'member');

      // Send GitHub collaborator invite if project has a linked repo
      const githubInvite = project.github_repo
        ? await sendCollaboratorInvite(projectId, joinRequest.user_id, project.github_repo, project.creator_id)
        : null;

      res.json({
        success: true,
        message: 'Join request accepted',
        githubInvite
      });
    } else if (action === 'reject') {
      // Reject request
      joinRequestDb.reject(requestId);

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
    const project = projectDb.findById(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Check if user is member or creator
    if (project.creator_id !== userId && !memberDb.isMember(projectId, userId)) {
      return res.status(403).json({
        success: false,
        message: 'You must be a member to view project members'
      });
    }

    const members = memberDb.getProjectMembers(projectId);

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

// DELETE: Leave project (member self-removal)
router.delete('/:id/leave', requireAuth, paramIdValidation, async (req, res) => {
  try {
    const projectId = req.params.id;
    const userId = req.session.userId;

    // Check if project exists
    const project = projectDb.findById(projectId);
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
    if (!memberDb.isMember(projectId, userId)) {
      return res.status(400).json({
        success: false,
        message: 'You are not a member of this project'
      });
    }

    // Remove member
    memberDb.removeMember(projectId, userId);

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

module.exports = router;
