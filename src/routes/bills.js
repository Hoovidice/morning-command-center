const express = require('express');
const db = require('../db');
const logger = require('../logger');
const { requireAuth } = require('../auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
    try {
        const bills = db.prepare('SELECT * FROM bills WHERE user_id = ? AND active = 1').all(req.session.userId);
        res.json(bills.map(b => ({
            id: b.id, name: b.name, amount: b.amount, dueDate: b.due_date,
            frequency: b.frequency, type: b.type, lastPaid: b.last_paid, paidFromId: b.paid_from_id
        })));
    } catch (error) {
        logger.error('Get bills error', { error: error.message });
        res.status(500).json({ error: 'Failed to get bills' });
    }
});

router.post('/', requireAuth, (req, res) => {
    try {
        const { name, amount, dueDate, frequency, type } = req.body;
        const result = db.prepare(
            'INSERT INTO bills (user_id, name, amount, due_date, frequency, type, active) VALUES (?, ?, ?, ?, ?, ?, 1)'
        ).run(req.session.userId, name, amount, dueDate, frequency, type);
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
        logger.error('Add bill error', { error: error.message });
        res.status(500).json({ error: 'Failed to add bill' });
    }
});

router.delete('/:id', requireAuth, (req, res) => {
    try {
        db.prepare('UPDATE bills SET active = 0 WHERE id = ? AND user_id = ?')
            .run(req.params.id, req.session.userId);
        res.json({ success: true });
    } catch (error) {
        logger.error('Remove bill error', { error: error.message });
        res.status(500).json({ error: 'Failed to remove bill' });
    }
});

router.post('/:id/pay', requireAuth, (req, res) => {
    try {
        const { date, amount, accountId, newAccountBalance } = req.body;
        db.prepare('UPDATE bills SET last_paid = ?, paid_from_id = ? WHERE id = ? AND user_id = ?')
            .run(date, accountId, req.params.id, req.session.userId);

        const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(accountId, req.session.userId);
        if (account) {
            db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(newAccountBalance, accountId);
        } else {
            db.prepare('UPDATE credit_cards SET balance = ? WHERE id = ?').run(newAccountBalance, accountId);
        }
        res.json({ success: true });
    } catch (error) {
        logger.error('Pay bill error', { error: error.message });
        res.status(500).json({ error: 'Failed to mark bill as paid' });
    }
});

router.post('/:id/unpay', requireAuth, (req, res) => {
    try {
        const bill = db.prepare('SELECT * FROM bills WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
        if (!bill) return res.status(404).json({ error: 'Bill not found' });

        if (bill.paid_from_id) {
            const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(bill.paid_from_id);
            const card = db.prepare('SELECT * FROM credit_cards WHERE id = ?').get(bill.paid_from_id);
            if (account) {
                db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(account.balance + bill.amount, bill.paid_from_id);
            } else if (card) {
                db.prepare('UPDATE credit_cards SET balance = ? WHERE id = ?').run(card.balance - bill.amount, bill.paid_from_id);
            }
        }

        db.prepare('UPDATE bills SET last_paid = NULL, paid_from_id = NULL WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (error) {
        logger.error('Unpay bill error', { error: error.message });
        res.status(500).json({ error: 'Failed to unmark bill as paid' });
    }
});

module.exports = router;
