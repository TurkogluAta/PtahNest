'use strict';

const express = require('express');
const router = express.Router();
const { param, validationResult } = require('express-validator');
const { certificateDb } = require('../models/database');

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  next();
}

const paramCertIdValidation = [
  param('id').isUUID().withMessage('Invalid certificate ID'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, message: errors.array()[0].msg });
    next();
  }
];

// GET /api/certificates/verify/:id — public, no auth needed
router.get('/verify/:id', async (req, res) => {
  try {
    const { rows } = await require('../models/database').pool.query(
      `SELECT c.id, c.trigger_type, c.was_creator, c.issued_at,
              c.payload->>'projectName' AS project_name,
              c.payload->>'username' AS username,
              c.payload->>'issuedMonth' AS issued_month
       FROM certificates c WHERE c.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Certificate not found' });
    res.json({ success: true, data: { certificate: rows[0] } });
  } catch (err) {
    console.error('Verify certificate error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/certificates/me — list current user's certificates (no heavy payload)
router.get('/me', requireAuth, async (req, res) => {
  try {
    const certs = await certificateDb.getByUser(req.session.userId);
    res.json({ success: true, data: { certificates: certs } });
  } catch (err) {
    console.error('Get certificates error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/certificates/:id — get single certificate with full payload (owner only)
router.get('/:id', requireAuth, paramCertIdValidation, async (req, res) => {
  try {
    const cert = await certificateDb.findById(req.params.id);
    if (!cert) return res.status(404).json({ success: false, message: 'Certificate not found' });
    if (cert.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, message: 'Not your certificate' });
    }
    res.json({ success: true, data: { certificate: cert } });
  } catch (err) {
    console.error('Get certificate error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Middleware: only adminAta user can access dev endpoints
async function requireDevAdmin(req, res, next) {
  const { userDb } = require('../models/database');
  const user = await userDb.findById(req.session.userId);
  if (!user || user.username !== 'adminAta') {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }
  next();
}

// POST /api/certificates/dev/reset-mock — adminAta only
router.post('/dev/reset-mock', requireAuth, requireDevAdmin, async (req, res) => {
  try {
    const { runResetMock } = require('../../scripts/reset-mock');
    await runResetMock();
    res.json({ success: true, message: 'Mock data reset complete' });
  } catch (err) {
    console.error('Reset mock error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/certificates/dev/seed-mock — adminAta only
router.post('/dev/seed-mock', requireAuth, requireDevAdmin, async (req, res) => {
  try {
    const { runSeedMock } = require('../../scripts/seed-mock');
    await runSeedMock();
    res.json({ success: true, message: 'Mock data seeded' });
  } catch (err) {
    console.error('Seed mock error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
