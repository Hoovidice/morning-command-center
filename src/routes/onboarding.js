const express = require('express');
const db = require('../db');
const logger = require('../logger');
const { requireAuth } = require('../auth');

const router = express.Router();

// Marks the current user as having finished (or skipped) the first-time
// onboarding walkthrough, so it doesn't show again on future logins.
router.post('/complete', requireAuth, (req, res) => {
    try {
        db.prepare('UPDATE users SET onboarded = 1 WHERE id = ?').run(req.session.userId);
        res.json({ success: true });
    } catch (error) {
        logger.error('Complete onboarding error', { error: error.message });
        res.status(500).json({ error: 'Failed to save onboarding status' });
    }
});

module.exports = router;
