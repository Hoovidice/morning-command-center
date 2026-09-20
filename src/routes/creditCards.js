const express = require('express');
const db = require('../db');
const logger = require('../logger');
const { requireAuth } = require('../auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
    try {
        const cards = db.prepare('SELECT * FROM credit_cards WHERE user_id = ?').all(req.session.userId);
        res.json(cards.map(c => ({ ...c, limit: c.credit_limit })));
    } catch (error) {
        logger.error('Get credit cards error', { error: error.message });
        res.status(500).json({ error: 'Failed to get credit cards' });
    }
});

router.post('/', requireAuth, (req, res) => {
    try {
        const { name, balance, limit, purpose, linkedAccount } = req.body;
        const result = db.prepare(
            'INSERT INTO credit_cards (user_id, name, balance, credit_limit, purpose, linked_account) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(req.session.userId, name, balance, limit, purpose || '', linkedAccount || '');
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
        logger.error('Add credit card error', { error: error.message });
        res.status(500).json({ error: 'Failed to add credit card' });
    }
});

router.put('/:id', requireAuth, (req, res) => {
    try {
        db.prepare('UPDATE credit_cards SET balance = ? WHERE id = ? AND user_id = ?')
            .run(req.body.balance, req.params.id, req.session.userId);
        res.json({ success: true });
    } catch (error) {
        logger.error('Update credit card error', { error: error.message });
        res.status(500).json({ error: 'Failed to update credit card' });
    }
});

router.delete('/:id', requireAuth, (req, res) => {
    try {
        db.prepare('DELETE FROM credit_cards WHERE id = ? AND user_id = ?')
            .run(req.params.id, req.session.userId);
        res.json({ success: true });
    } catch (error) {
        logger.error('Remove credit card error', { error: error.message });
        res.status(500).json({ error: 'Failed to remove credit card' });
    }
});

module.exports = router;
