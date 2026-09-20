const express = require('express');
const db = require('../db');
const logger = require('../logger');
const { requireAuth } = require('../auth');

const router = express.Router();

router.get('/:date', requireAuth, (req, res) => {
    try {
        const reflection = db.prepare('SELECT * FROM daily_reflections WHERE user_id = ? AND date = ?')
            .get(req.session.userId, req.params.date);
        if (!reflection) return res.json({ date: req.params.date, gratitude: '', affirmation: '' });
        res.json({ id: reflection.id, date: reflection.date, gratitude: reflection.gratitude, affirmation: reflection.affirmation });
    } catch (error) {
        logger.error('Get reflection error', { error: error.message });
        res.status(500).json({ error: 'Failed to get reflection' });
    }
});

// Upserts by date, same pattern as weekly reviews — saving the same day
// again edits it instead of creating a duplicate.
router.post('/', requireAuth, (req, res) => {
    try {
        const { date, gratitude, affirmation } = req.body;
        if (!date) return res.status(400).json({ error: 'Date is required' });

        const existing = db.prepare('SELECT id FROM daily_reflections WHERE user_id = ? AND date = ?')
            .get(req.session.userId, date);

        if (existing) {
            db.prepare('UPDATE daily_reflections SET gratitude = ?, affirmation = ? WHERE id = ?')
                .run(gratitude || '', affirmation || '', existing.id);
            res.json({ success: true, id: existing.id });
        } else {
            const result = db.prepare(
                'INSERT INTO daily_reflections (user_id, date, gratitude, affirmation) VALUES (?, ?, ?, ?)'
            ).run(req.session.userId, date, gratitude || '', affirmation || '');
            res.json({ success: true, id: result.lastInsertRowid });
        }
    } catch (error) {
        logger.error('Save reflection error', { error: error.message });
        res.status(500).json({ error: 'Failed to save reflection' });
    }
});

module.exports = router;
