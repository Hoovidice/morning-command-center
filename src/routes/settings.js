const express = require('express');
const db = require('../db');
const logger = require('../logger');
const { requireAuth } = require('../auth');

const router = express.Router();

// Lets a user set (or clear, by sending null) a monthly spending ceiling.
// This is separate from the AI paycheck planner under Budget — it's a
// simple dollar limit used to power the "pace" badge on the dashboard.
router.post('/budget-limit', requireAuth, (req, res) => {
    try {
        const { monthlyBudgetLimit } = req.body;
        const value = (monthlyBudgetLimit === null || monthlyBudgetLimit === undefined || monthlyBudgetLimit === '')
            ? null : parseFloat(monthlyBudgetLimit);
        if (value !== null && (!Number.isFinite(value) || value < 0)) {
            return res.status(400).json({ error: 'Monthly budget limit must be a positive number' });
        }
        db.prepare('UPDATE users SET monthly_budget_limit = ? WHERE id = ?').run(value, req.session.userId);
        res.json({ success: true, monthlyBudgetLimit: value });
    } catch (error) {
        logger.error('Set budget limit error', { error: error.message });
        res.status(500).json({ error: 'Failed to save budget limit' });
    }
});

module.exports = router;
