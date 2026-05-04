const { body, param, query, validationResult } = require('express-validator');

// Validation error handler middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: errors.array()[0].msg, // Return first error message
      errors: errors.array()
    });
  }
  next();
};

// Register validation rules
const registerValidation = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 30 })
    .withMessage('Username must be between 3 and 30 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores')
    .escape(),

  body('email')
    .trim()
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail()
    .isLength({ max: 254 })
    .withMessage('Email must not exceed 254 characters'),

  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/[A-Z]/)
    .withMessage('Password must contain at least one uppercase letter')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one number')
    .matches(/[!@#$%^&*(),.?":{}|<>]/)
    .withMessage('Password must contain at least one special character'),

  handleValidationErrors
];

// Login validation rules
const loginValidation = [
  body('identifier')
    .trim()
    .notEmpty()
    .withMessage('Email or username is required')
    .isLength({ min: 1, max: 254 })
    .withMessage('Email or username must be between 1 and 254 characters')
    .escape(),

  body('password')
    .notEmpty()
    .withMessage('Password is required'),

  handleValidationErrors
];

// Create project validation rules
const createProjectValidation = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Project name must be between 1 and 100 characters')
    .escape(),

  body('description')
    .trim()
    .isLength({ min: 1, max: 2000 })
    .withMessage('Project description must be between 1 and 2000 characters')
    .escape(),

  body('tags')
    .isArray({ max: 10 })
    .withMessage('Tags must be an array with maximum 10 items')
    .custom((tags) => {
      // Validate each tag
      if (!tags.every(tag => typeof tag === 'string' && tag.trim().length > 0 && tag.length <= 30)) {
        throw new Error('Each tag must be a non-empty string with maximum 30 characters');
      }
      return true;
    }),

  body('tags.*')
    .trim()
    .escape(),

  body('lookingFor')
    .isArray({ max: 10 })
    .withMessage('Looking for must be an array with maximum 10 items')
    .custom((roles) => {
      // Validate each role
      if (!roles.every(role => typeof role === 'string' && role.trim().length > 0 && role.length <= 50)) {
        throw new Error('Each role must be a non-empty string with maximum 50 characters');
      }
      return true;
    }),

  body('lookingFor.*')
    .trim()
    .escape(),

  body('githubRepo')
    .optional({ values: 'null' })
    .trim()
    .isLength({ max: 200 })
    .withMessage('GitHub repository name must not exceed 200 characters')
    .matches(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/)
    .withMessage('Invalid repository format'),

  body('projectType')
    .optional()
    .isIn(['software', 'research'])
    .withMessage('Project type must be software or research'),

  handleValidationErrors
];

// Update project validation rules (only editable fields — no githubRepo or projectType)
const updateProjectValidation = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Project name must be between 1 and 100 characters')
    .escape(),

  body('description')
    .trim()
    .isLength({ min: 1, max: 2000 })
    .withMessage('Project description must be between 1 and 2000 characters')
    .escape(),

  body('tags')
    .isArray({ max: 10 })
    .withMessage('Tags must be an array with maximum 10 items')
    .custom((tags) => {
      if (!tags.every(tag => typeof tag === 'string' && tag.trim().length > 0 && tag.length <= 30)) {
        throw new Error('Each tag must be a non-empty string with maximum 30 characters');
      }
      return true;
    }),

  body('tags.*')
    .trim()
    .escape(),

  body('lookingFor')
    .isArray({ max: 10 })
    .withMessage('Looking for must be an array with maximum 10 items')
    .custom((roles) => {
      if (!roles.every(role => typeof role === 'string' && role.trim().length > 0 && role.length <= 50)) {
        throw new Error('Each role must be a non-empty string with maximum 50 characters');
      }
      return true;
    }),

  body('lookingFor.*')
    .trim()
    .escape(),

  body('recruitmentOpen')
    .isBoolean()
    .withMessage('Recruitment status must be true or false'),

  handleValidationErrors
];

// Join request validation rules
const joinRequestValidation = [
  body('message')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Message must not exceed 500 characters')
    .escape(),

  handleValidationErrors
];

// Manage request validation (accept/reject)
const manageRequestValidation = [
  body('action')
    .isIn(['accept', 'reject'])
    .withMessage('Action must be either "accept" or "reject"'),

  handleValidationErrors
];

// URL parameter validation (UUID)
const paramIdValidation = [
  param('id')
    .isUUID()
    .withMessage('Invalid project ID format'),

  handleValidationErrors
];

// Request ID parameter validation (UUID)
const paramRequestIdValidation = [
  param('requestId')
    .isUUID()
    .withMessage('Invalid request ID format'),

  handleValidationErrors
];

// Member ID parameter validation (UUID)
const paramMemberIdValidation = [
  param('memberId')
    .isUUID()
    .withMessage('Invalid member ID format'),

  handleValidationErrors
];

// Vote ID parameter validation (UUID)
const paramVoteIdValidation = [
  param('voteId')
    .isUUID()
    .withMessage('Invalid vote ID format'),

  handleValidationErrors
];

// Promote/demote moderator validation
const moderatorValidation = [
  body('userId')
    .isUUID()
    .withMessage('Invalid user ID format'),

  handleValidationErrors
];

// Start kick vote validation
const kickVoteValidation = [
  body('targetUserId')
    .isUUID()
    .withMessage('Invalid target user ID format'),

  handleValidationErrors
];

// Cast ballot validation
const ballotValidation = [
  body('ballot')
    .isIn(['yes', 'no'])
    .withMessage('Ballot must be "yes" or "no"'),

  handleValidationErrors
];

// Chat message content validation
const messageContentValidation = [
  body('content')
    .trim()
    .isLength({ min: 1, max: 1000 })
    .withMessage('Message must be between 1 and 1000 characters')
    .escape(),

  handleValidationErrors
];

// UUID param for user ID
const paramUserIdValidation = [
  param('userId')
    .isUUID()
    .withMessage('Invalid user ID format'),

  handleValidationErrors
];

// Update profile validation
const updateProfileValidation = [
  body('username')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: 3, max: 30 })
    .withMessage('Username must be between 3 and 30 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores')
    .escape(),

  body('email')
    .optional({ values: 'null' })
    .trim()
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail()
    .isLength({ max: 254 })
    .withMessage('Email must not exceed 254 characters'),

  body('currentPassword')
    .optional()
    .isString()
    .withMessage('Current password must be a string'),

  body('newPassword')
    .optional()
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters')
    .matches(/[A-Z]/)
    .withMessage('New password must contain at least one uppercase letter')
    .matches(/[0-9]/)
    .withMessage('New password must contain at least one number')
    .matches(/[!@#$%^&*(),.?":{}|<>]/)
    .withMessage('New password must contain at least one special character'),

  handleValidationErrors
];

const healthReadValidation = [
  body('issueKey').isString().isLength({ min: 1, max: 200 }).withMessage('Invalid issue key'),
  body('role').isIn(['creator', 'moderator']).withMessage('Role must be creator or moderator'),
  body('read').isBoolean().withMessage('read must be a boolean'),
  handleValidationErrors
];

const createTodoValidation = [
  body('title').trim().isLength({ min: 1, max: 200 }).withMessage('Title is required (max 200 chars)'),
  body('description').optional({ nullable: true }).trim().isLength({ max: 1000 }).withMessage('Description too long'),
  body('dueDate').optional({ nullable: true }).isISO8601().withMessage('Invalid due date')
    .custom((value, { req }) => {
      // Only enforce future-or-today on create (POST). Edit (PUT) allows keeping past dates.
      if (!value || req.method !== 'POST') return true;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const due = new Date(value); due.setHours(0, 0, 0, 0);
      if (due < today) throw new Error('Due date cannot be in the past');
      return true;
    }),
  body('assignedTo').optional({ nullable: true }).isUUID().withMessage('Invalid assignedTo user ID'),
  handleValidationErrors
];

const paramTodoIdValidation = [
  param('todoId').isUUID().withMessage('Invalid todo ID'),
  handleValidationErrors
];

const commitVoteValidation = [
  body('sha').trim().notEmpty().isLength({ max: 40 }).withMessage('Invalid commit SHA'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be 1-5'),
  body('commitAuthor').optional().trim().isLength({ max: 100 }).escape().withMessage('Invalid commit author'),
  handleValidationErrors
];

const commitShasValidation = [
  query('shas').notEmpty().withMessage('shas query param required'),
  handleValidationErrors
];

const paramCommitShaValidation = [
  param('sha').trim().notEmpty().isLength({ max: 40 }).withMessage('Invalid commit SHA'),
  handleValidationErrors
];

module.exports = {
  registerValidation,
  loginValidation,
  updateProfileValidation,
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
};
