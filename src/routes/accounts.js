const express = require('express');
const db = require('../db');
const logger = require('../logger');
const { requireAuth } = require('../auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
    try {
        const accounts = db.prepare('SELECT * FROM accounts WHERE user_id = ?').all(req.session.userId);
        res.json(accounts);
    } catch (error) {
        logger.error('Get accounts error', { error: error.message });
        res.status(500).json({ error: 'Failed to get accounts' });
    }
});

router.post('/', requireAuth, (req, res) => {
    try {
        const { name, type, balance, allocation, notes } = req.body;
        const result = db.prepare(
            'INSERT INTO accounts (user_id, name, type, balance, allocation, notes) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(req.session.userId, name, type, balance, allocation || 0, notes || '');
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
        logger.error('Add account error', { error: error.message });
        res.status(500).json({ error: 'Failed to add account' });
    }
});

router.put('/:id', requireAuth, (req, res) => {
    try {
        db.prepare('UPDATE accounts SET balance = ? WHERE id = ? AND user_id = ?')
            .run(req.body.balance, req.params.id, req.session.userId);
        res.json({ success: true });
    } catch (error) {
        logger.error('Update account error', { error: error.message });
        res.status(500).json({ error: 'Failed to update account' });
    }
});

router.delete('/:id', requireAuth, (req, res) => {
    try {
        db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?')
            .run(req.params.id, req.session.userId);
        res.json({ success: true });
    } catch (error) {
        logger.error('Remove account error', { error: error.message });
        res.status(500).json({ error: 'Failed to remove account' });
    }
});

module.exports = router;
