const express = require('express');
const db = require('../db');
const logger = require('../logger');
const { requireAuth } = require('../auth');
const { pushNotificationsEnabled, webpush } = require('../lib/notifications');

const router = express.Router();

// Public — the browser needs this key to set up a subscription, before login
// even matters for this particular call.
router.get('/vapid-public-key', (req, res) => {
    if (!pushNotificationsEnabled) {
        return res.status(503).json({ error: 'Push notifications are not configured on this server' });
    }
    res.json({ publicKey: process.env.WEB_PUSH_PUBLIC_KEY });
});

router.post('/subscribe', requireAuth, (req, res) => {
    try {
        const sub = req.body;
        if (!sub || !sub.endpoint) {
            return res.status(400).json({ error: 'Invalid subscription' });
        }
        db.prepare(`
            INSERT INTO push_subscriptions (user_id, endpoint, subscription_json)
            VALUES (?, ?, ?)
            ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, subscription_json = excluded.subscription_json
        `).run(req.session.userId, sub.endpoint, JSON.stringify(sub));
        res.json({ success: true });
    } catch (error) {
        logger.error('Push subscribe error', { error: error.message });
        res.status(500).json({ error: 'Failed to save subscription' });
    }
});

router.post('/unsubscribe', requireAuth, (req, res) => {
    try {
        const { endpoint } = req.body;
        if (endpoint) {
            db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(req.session.userId, endpoint);
        } else {
            db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(req.session.userId);
        }
        res.json({ success: true });
    } catch (error) {
        logger.error('Push unsubscribe error', { error: error.message });
        res.status(500).json({ error: 'Failed to remove subscription' });
    }
});

// Sends an immediate, on-demand notification to every device the current
// user has subscribed from — lets someone confirm notifications actually
// arrive without waiting for a real bill to come due.
router.post('/test', requireAuth, async (req, res) => {
    if (!pushNotificationsEnabled) {
        return res.status(503).json({ error: 'Push notifications are not configured on this server' });
    }
    try {
        const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(req.session.userId);
        if (subs.length === 0) {
            return res.status(400).json({ error: 'No active notification subscription found — turn notifications on first.' });
        }

        const payload = JSON.stringify({
            title: '🧪 Test Notification',
            body: 'If you can see this, push notifications are working correctly!'
        });

        let sentCount = 0;
        for (const sub of subs) {
            try {
                const subscription = JSON.parse(sub.subscription_json);
                await webpush.sendNotification(subscription, payload);
                sentCount++;
            } catch (err) {
                if (err.statusCode === 404 || err.statusCode === 410) {
                    db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
                } else {
                    logger.error('Test push send error', { error: err.message });
                }
            }
        }

        if (sentCount === 0) {
            return res.status(500).json({ error: 'Could not deliver the test notification to any device.' });
        }
        res.json({ success: true, sentCount });
    } catch (error) {
        logger.error('Test notification error', { error: error.message });
        res.status(500).json({ error: 'Failed to send test notification' });
    }
});

module.exports = router;
