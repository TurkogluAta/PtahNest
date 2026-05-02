const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { userDb, loginAttemptDb } = require('../models/database');
const { setSessionFingerprint } = require('../middleware/sessionSecurity');
const { registerValidation, loginValidation, updateProfileValidation } = require('../middleware/validators');

// REGISTER endpoint
router.post('/register', registerValidation, async (req, res) => {
  try {
    const { username, email, password, deviceId, deviceFingerprint } = req.body;

    // Check if email or username already exists (case-insensitive)
    const existing = await userDb.findByEmailOrUsername(email) || await userDb.findByEmailOrUsername(username);
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Email or username already exists'
      });
    }

    // Hash password (bcrypt with 12 rounds)
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user with hashed password
    const user = await userDb.create(username, email, hashedPassword);

    // Session fixation prevention: Generate new session ID
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regeneration error:', err);
      }

      // Create session (auto-login after registration)
      req.session.userId = user.id;

      // Set session fingerprint (Device ID + fingerprint)
      setSessionFingerprint(req, { deviceId, deviceFingerprint });

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
router.post('/login', loginValidation, async (req, res) => {
  try {
    const { identifier, password, remember, deviceId, deviceFingerprint } = req.body;

    // Brute-force protection check (IP-based)
    const clientIp = req.ip || req.connection.remoteAddress;
    const bruteForceCheck = await loginAttemptDb.check(clientIp);
    if (!bruteForceCheck.allowed) {
      return res.status(429).json({
        success: false,
        message: bruteForceCheck.message
      });
    }

    // Find user by email or username
    const user = await userDb.findByEmailOrUsername(identifier);

    // Timing attack prevention: Always run bcrypt.compare
    // Even if user doesn't exist, compare with dummy hash to keep timing constant
    const dummyHash = '$2a$12$7h4Z2wVXj/q4RjZ.K6Z8wuHl5rP8tK6/9xA6F3C9qZDl.4wX6e8P.';
    const hashToCompare = user ? user.password : dummyHash;
    const isValidPassword = await bcrypt.compare(password, hashToCompare);

    if (!user || !isValidPassword) {
      // Record failed attempt (IP-based)
      await loginAttemptDb.record(clientIp);

      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Successful login - Clear IP's failed attempts
    await loginAttemptDb.clear(clientIp);

    // Session fixation prevention: Generate new session ID
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regeneration error:', err);
      }

      // Create session
      req.session.userId = user.id;

      // Set session fingerprint (Device ID + fingerprint)
      setSessionFingerprint(req, { deviceId, deviceFingerprint });

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
router.get('/me', async (req, res) => {
  // Check if user is authenticated
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated'
    });
  }

  const user = await userDb.findById(req.session.userId);

  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'User not found'
    });
  }

  res.json({
    success: true,
    user: { id: user.id, username: user.username, email: user.email, created_at: user.created_at }
  });
});

// UPDATE PROFILE endpoint — username, email, and/or password
router.put('/profile', updateProfileValidation, async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }

  try {
    const { username, email, currentPassword, newPassword } = req.body;
    const user = await userDb.findById(req.session.userId);
    if (!user) return res.status(401).json({ success: false, message: 'User not found' });

    const updates = {};

    // Check username uniqueness if changing
    if (username && username !== user.username) {
      const existing = await userDb.findByEmailOrUsername(username);
      if (existing && existing.id !== user.id) {
        return res.status(409).json({ success: false, message: 'Username already taken' });
      }
      updates.username = username;
    }

    // Check email uniqueness if changing
    if (email && email.toLowerCase() !== user.email) {
      const existing = await userDb.findByEmailOrUsername(email);
      if (existing && existing.id !== user.id) {
        return res.status(409).json({ success: false, message: 'Email already in use' });
      }
      updates.email = email;
    }

    // Password change — requires currentPassword
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, message: 'Current password is required to set a new password' });
      }
      const isValid = await bcrypt.compare(currentPassword, user.password);
      if (!isValid) {
        return res.status(400).json({ success: false, message: 'Current password is incorrect' });
      }
      updates.password = await bcrypt.hash(newPassword, 12);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No changes provided' });
    }

    await userDb.updateProfile(req.session.userId, updates);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        username: updates.username || user.username,
        email: updates.email ? updates.email.toLowerCase() : user.email
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
