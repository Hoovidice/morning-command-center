const express = require('express');
const db = require('../db');
const logger = require('../logger');
const { requireAuth } = require('../auth');

const router = express.Router();

// Lets a logged-in user download everything that belongs to their own
// account as a JSON file — a personal backup they control, separate from
// the server-side automated backups in src/lib/backup.js. Deliberately
// scoped to just this user's rows (never the whole database), since this
// route is reachable by any logged-in user, not just an admin.
router.get('/my-data', requireAuth, (req, res) => {
    try {
        const userId = req.session.userId;

        const user = db.prepare('SELECT id, email, name, created_at FROM users WHERE id = ?').get(userId);
        const accounts = db.prepare('SELECT * FROM accounts WHERE user_id = ?').all(userId);
        const creditCards = db.prepare('SELECT * FROM credit_cards WHERE user_id = ?').all(userId);
        const bills = db.prepare('SELECT * FROM bills WHERE user_id = ?').all(userId);
        const expenses = db.prepare('SELECT * FROM expenses WHERE user_id = ?').all(userId);
        const goals = db.prepare('SELECT * FROM goals WHERE user_id = ?').all(userId);
        const goalIds = goals.map(g => g.id);
        const actionSteps = goalIds.length > 0
            ? db.prepare(`SELECT * FROM goal_action_steps WHERE goal_id IN (${goalIds.map(() => '?').join(',')})`).all(...goalIds)
            : [];
        const dailyTasks = db.prepare('SELECT * FROM daily_tasks WHERE user_id = ?').all(userId);
        const weeklyReviews = db.prepare('SELECT * FROM weekly_reviews WHERE user_id = ?').all(userId);
        const dailyReflections = db.prepare('SELECT * FROM daily_reflections WHERE user_id = ?').all(userId);
        const monthlyReflections = db.prepare('SELECT * FROM monthly_reflections WHERE user_id = ?').all(userId);

        const exportData = {
            exportedAt: new Date().toISOString(),
            user,
            accounts,
            creditCards,
            bills,
            expenses,
            goals,
            goalActionSteps: actionSteps,
            dailyTasks,
            weeklyReviews,
            dailyReflections,
            monthlyReflections
        };

        res.setHeader('Content-Disposition', `attachment; filename="morning-command-center-export-${new Date().toISOString().split('T')[0]}.json"`);
        res.setHeader('Content-Type', 'application/json');
        res.json(exportData);
    } catch (error) {
        logger.error('Export data error', { error: error.message });
        res.status(500).json({ error: 'Failed to export your data' });
    }
});

module.exports = router;
