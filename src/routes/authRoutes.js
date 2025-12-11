const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { userDb, loginAttemptDb } = require('../models/database');
const { setSessionFingerprint } = require('../middleware/sessionSecurity');

// REGISTER endpoint
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Basic validation
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    // Check if email or username already exists (case-insensitive)
    const existing = userDb.findByEmailOrUsername(email) || userDb.findByEmailOrUsername(username);
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Email or username already exists'
      });
    }

    // Hash password (bcrypt with 12 rounds)
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user with hashed password
    const user = userDb.create(username, email, hashedPassword);

    // Session fixation prevention: Generate new session ID
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regeneration error:', err);
      }

      // Create session (auto-login after registration)
      req.session.userId = user.id;

      // Set session fingerprint (IP + User-Agent)
      setSessionFingerprint(req);

      res.status(201).json({
        success: true,
        message: 'Account created successfully',
        user: { id: user.id, username: user.username, email: user.email }
      });
    });

  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// LOGIN endpoint
router.post('/login', async (req, res) => {
  try {
    const { identifier, password, remember } = req.body;

    // Basic validation
    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email/username and password are required'
      });
    }

    // Brute-force protection check (IP-based)
    const clientIp = req.ip || req.connection.remoteAddress;
    const bruteForceCheck = loginAttemptDb.check(clientIp);
    if (!bruteForceCheck.allowed) {
      return res.status(429).json({
        success: false,
        message: bruteForceCheck.message
      });
    }

    // Find user by email or username
    const user = userDb.findByEmailOrUsername(identifier);

    // Timing attack prevention: Always run bcrypt.compare
    // Even if user doesn't exist, compare with dummy hash to keep timing constant
    const dummyHash = '$2a$12$7h4Z2wVXj/q4RjZ.K6Z8wuHl5rP8tK6/9xA6F3C9qZDl.4wX6e8P.';
    const hashToCompare = user ? user.password : dummyHash;
    const isValidPassword = await bcrypt.compare(password, hashToCompare);

    if (!user || !isValidPassword) {
      // Record failed attempt (IP-based)
      loginAttemptDb.record(clientIp);

      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Successful login - Clear IP's failed attempts
    loginAttemptDb.clear(clientIp);

    // Session fixation prevention: Generate new session ID
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regeneration error:', err);
      }

      // Create session
      req.session.userId = user.id;

      // Set session fingerprint (IP + User-Agent)
      setSessionFingerprint(req);

      // Remember me functionality
      if (remember) {
        req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
      }

      res.json({
        success: true,
        message: 'Login successful',
        user: { id: user.id, username: user.username, email: user.email }
      });
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// LOGOUT endpoint
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: 'Logout failed'
      });
    }
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  });
});

// ME endpoint (get current user) - Protected route
router.get('/me', (req, res) => {
  // Check if user is authenticated
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated'
    });
  }

  const user = userDb.findById(req.session.userId);

  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'User not found'
    });
  }

  res.json({
    success: true,
    user: { id: user.id, username: user.username, email: user.email }
  });
});

module.exports = router;
