const { body, param, validationResult } = require('express-validator');

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

  handleValidationErrors
];

// Update project validation rules (same as create)
const updateProjectValidation = [
  ...createProjectValidation
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

module.exports = {
  registerValidation,
  loginValidation,
  createProjectValidation,
  updateProjectValidation,
  joinRequestValidation,
  manageRequestValidation,
  paramIdValidation,
  paramRequestIdValidation
};
