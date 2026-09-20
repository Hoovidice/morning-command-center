const express = require('express');
const db = require('../db');
const logger = require('../logger');
const { requireAuth } = require('../auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
    try {
        const expenses = db.prepare('SELECT * FROM expenses WHERE user_id = ? ORDER BY id DESC').all(req.session.userId);
        res.json(expenses);
    } catch (error) {
        logger.error('Get expenses error', { error: error.message });
        res.status(500).json({ error: 'Failed to get expenses' });
    }
});

router.post('/', requireAuth, (req, res) => {
    try {
        const { category, description, amount, date } = req.body;
        const result = db.prepare(
            'INSERT INTO expenses (user_id, date, category, description, amount) VALUES (?, ?, ?, ?, ?)'
        ).run(req.session.userId, date, category, description, amount);
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
        logger.error('Add expense error', { error: error.message });
        res.status(500).json({ error: 'Failed to add expense' });
    }
});

module.exports = router;
