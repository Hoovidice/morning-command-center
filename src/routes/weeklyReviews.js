const express = require('express');
const db = require('../db');
const logger = require('../logger');
const { requireAuth } = require('../auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
    try {
        const reviews = db.prepare('SELECT * FROM weekly_reviews WHERE user_id = ? ORDER BY week_start DESC')
            .all(req.session.userId);
        res.json(reviews.map(r => ({
            id: r.id, weekStart: r.week_start, mainGoal: r.main_goal,
            wins: r.wins, improveNextWeek: r.improve_next_week
        })));
    } catch (error) {
        logger.error('Get weekly reviews error', { error: error.message });
        res.status(500).json({ error: 'Failed to get weekly reviews' });
    }
});

// Creates a new review for a week, or updates the existing one for that same
// week if you already saved one — so re-saving the same week edits it instead
// of creating a duplicate.
router.post('/', requireAuth, (req, res) => {
    try {
        const { weekStart, mainGoal, wins, improveNextWeek } = req.body;
        if (!weekStart) return res.status(400).json({ error: 'Week start date is required' });

        const existing = db.prepare('SELECT id FROM weekly_reviews WHERE user_id = ? AND week_start = ?')
            .get(req.session.userId, weekStart);

        if (existing) {
            db.prepare('UPDATE weekly_reviews SET main_goal = ?, wins = ?, improve_next_week = ? WHERE id = ?')
                .run(mainGoal || '', wins || '', improveNextWeek || '', existing.id);
            res.json({ success: true, id: existing.id });
        } else {
            const result = db.prepare(
                'INSERT INTO weekly_reviews (user_id, week_start, main_goal, wins, improve_next_week) VALUES (?, ?, ?, ?, ?)'
            ).run(req.session.userId, weekStart, mainGoal || '', wins || '', improveNextWeek || '');
            res.json({ success: true, id: result.lastInsertRowid });
        }
    } catch (error) {
        logger.error('Save weekly review error', { error: error.message });
        res.status(500).json({ error: 'Failed to save weekly review' });
    }
});

router.delete('/:id', requireAuth, (req, res) => {
    try {
        db.prepare('DELETE FROM weekly_reviews WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
        res.json({ success: true });
    } catch (error) {
        logger.error('Remove weekly review error', { error: error.message });
        res.status(500).json({ error: 'Failed to remove weekly review' });
    }
});

module.exports = router;
