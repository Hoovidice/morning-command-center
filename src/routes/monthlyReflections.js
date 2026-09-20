const express = require('express');
const db = require('../db');
const logger = require('../logger');
const { requireAuth } = require('../auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
    try {
        const reflections = db.prepare('SELECT * FROM monthly_reflections WHERE user_id = ? ORDER BY month DESC')
            .all(req.session.userId);
        res.json(reflections);
    } catch (error) {
        logger.error('Get monthly reflections error', { error: error.message });
        res.status(500).json({ error: 'Failed to get monthly reflections' });
    }
});

router.post('/', requireAuth, (req, res) => {
    try {
        const { month, health, career, financial, personal, family, home, notes } = req.body;
        if (!month) return res.status(400).json({ error: 'Month is required' });

        const existing = db.prepare('SELECT id FROM monthly_reflections WHERE user_id = ? AND month = ?')
            .get(req.session.userId, month);

        const vals = [health, career, financial, personal, family, home].map(v => {
            const n = parseInt(v, 10);
            return Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 5;
        });

        if (existing) {
            db.prepare(
                'UPDATE monthly_reflections SET health = ?, career = ?, financial = ?, personal = ?, family = ?, home = ?, notes = ? WHERE id = ?'
            ).run(...vals, notes || '', existing.id);
            res.json({ success: true, id: existing.id });
        } else {
            const result = db.prepare(
                'INSERT INTO monthly_reflections (user_id, month, health, career, financial, personal, family, home, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
            ).run(req.session.userId, month, ...vals, notes || '');
            res.json({ success: true, id: result.lastInsertRowid });
        }
    } catch (error) {
        logger.error('Save monthly reflection error', { error: error.message });
        res.status(500).json({ error: 'Failed to save monthly reflection' });
    }
});

router.delete('/:id', requireAuth, (req, res) => {
    try {
        db.prepare('DELETE FROM monthly_reflections WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
        res.json({ success: true });
    } catch (error) {
        logger.error('Remove monthly reflection error', { error: error.message });
        res.status(500).json({ error: 'Failed to remove monthly reflection' });
    }
});

module.exports = router;
