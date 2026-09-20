const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('../logger');
const { createUser, verifyUser, getUserById } = require('../auth');

const router = express.Router();

// Slows down repeated login/signup attempts against the same IP address,
// so someone can't sit there guessing passwords or spamming fake accounts.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 attempts per IP per window is plenty for a real person, not a script
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait a few minutes and try again.' }
});

router.post('/signup', authLimiter, async (req, res) => {
    try {
        let { email, password, name } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        // Emails are matched exactly in the database, so normalizing here
        // means "Zac@gmail.com" and "zac@gmail.com" are always treated as
        // the same account — otherwise a phone auto-capitalizing the first
        // letter, or someone typing it differently later, would silently
        // create a second account or fail to log in.
        email = email.trim().toLowerCase();
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        const userId = await createUser(email, password, name);
        req.session.userId = userId;
        res.json({ success: true, user: { id: userId, email, name } });
    } catch (error) {
        logger.error('Signup error', { error: error.message });
        res.status(400).json({ error: error.message || 'Failed to create account' });
    }
});

router.post('/login', authLimiter, async (req, res) => {
    try {
        let { email, password } = req.body;
        if (email) email = email.trim().toLowerCase();
        const user = await verifyUser(email, password);
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        req.session.userId = user.id;
        res.json({ success: true, user });
    } catch (error) {
        logger.error('Login error', { error: error.message });
        res.status(500).json({ error: 'Failed to log in' });
    }
});

router.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

router.get('/me', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    const user = getUserById(req.session.userId);
    res.json({ user });
});

module.exports = router;
