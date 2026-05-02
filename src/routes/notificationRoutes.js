const express = require('express');
const router = express.Router();
const { notificationDb } = require('../models/database');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ success: false, message: 'Not authenticated' });
  next();
}

// GET /api/notifications — unread notifications for current user
router.get('/', requireAuth, async (req, res) => {
  try {
    const notifications = await notificationDb.getUnread(req.session.userId);
    res.json({ success: true, notifications });
  } catch (err) {
    console.error('Get notifications error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/notifications/read/:id — mark one as read
router.post('/read/:id', requireAuth, async (req, res) => {
  try {
    await notificationDb.markRead(req.params.id, req.session.userId);
    res.json({ success: true });
  } catch (err) {
    console.error('Mark read error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/notifications/read-all — mark all as read
router.post('/read-all', requireAuth, async (req, res) => {
  try {
    await notificationDb.markAllRead(req.session.userId);
    res.json({ success: true });
  } catch (err) {
    console.error('Mark all read error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
