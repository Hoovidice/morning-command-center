const express = require('express');
const db = require('../db');
const logger = require('../logger');
const { requireAuth } = require('../auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
    try {
        const goals = db.prepare("SELECT * FROM goals WHERE user_id = ? AND status != 'deleted'").all(req.session.userId);

        // Pull in every action step for these goals in one query, then group them by goal
        const goalIds = goals.map(g => g.id);
        let stepsByGoal = {};
        if (goalIds.length > 0) {
            const placeholders = goalIds.map(() => '?').join(',');
            const allSteps = db.prepare(
                `SELECT * FROM goal_action_steps WHERE goal_id IN (${placeholders}) ORDER BY step_order ASC`
            ).all(...goalIds);
            allSteps.forEach(s => {
                if (!stepsByGoal[s.goal_id]) stepsByGoal[s.goal_id] = [];
                stepsByGoal[s.goal_id].push({ id: s.id, text: s.step_text, order: s.step_order, completed: !!s.completed });
            });
        }

        res.json(goals.map(g => ({
            id: g.id, title: g.title, category: g.category, recurrence: g.recurrence,
            deadline: g.deadline, lastCompleted: g.last_completed, streak: g.streak,
            status: g.status, notes: g.notes, whyIWantIt: g.why_i_want_it, reward: g.reward,
            targetAmount: g.target_amount, savedAmount: g.saved_amount || 0,
            actionSteps: stepsByGoal[g.id] || []
        })));
    } catch (error) {
        logger.error('Get goals error', { error: error.message });
        res.status(500).json({ error: 'Failed to get goals' });
    }
});

router.post('/', requireAuth, (req, res) => {
    try {
        const { title, category, recurrence, deadline, notes, whyIWantIt, reward, targetAmount } = req.body;
        const target = (targetAmount === undefined || targetAmount === null || targetAmount === '') ? null : parseFloat(targetAmount);
        const result = db.prepare(
            'INSERT INTO goals (user_id, title, category, recurrence, deadline, notes, why_i_want_it, reward, status, target_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(req.session.userId, title, category, recurrence, deadline || '', notes || '', whyIWantIt || '', reward || '', 'active', target);
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
        logger.error('Add goal error', { error: error.message });
        res.status(500).json({ error: 'Failed to add goal' });
    }
});

// Moves money "into" a goal (a dollar target it's being saved toward) —
// YNAB-style, so leftover balance in an account can be assigned a job
// instead of just sitting there unlabeled. amount can be negative to
// move money back out of the goal; savedAmount never goes below 0.
router.post('/:id/assign', requireAuth, (req, res) => {
    try {
        const goal = db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
        if (!goal) return res.status(404).json({ error: 'Goal not found' });

        const amount = parseFloat(req.body.amount);
        if (!Number.isFinite(amount)) {
            return res.status(400).json({ error: 'A valid amount is required' });
        }

        const newSaved = Math.max(0, (goal.saved_amount || 0) + amount);
        db.prepare('UPDATE goals SET saved_amount = ? WHERE id = ?').run(newSaved, req.params.id);
        res.json({ success: true, savedAmount: newSaved });
    } catch (error) {
        logger.error('Assign to goal error', { error: error.message });
        res.status(500).json({ error: 'Failed to assign money to goal' });
    }
});

router.post('/:id/complete', requireAuth, (req, res) => {
    try {
        const goal = db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
        if (!goal) return res.status(404).json({ error: 'Goal not found' });

        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        const newStreak = (goal.last_completed === yesterdayStr || goal.last_completed === today)
            ? goal.streak + 1 : 1;

        db.prepare('UPDATE goals SET last_completed = ?, streak = ? WHERE id = ?')
            .run(today, newStreak, req.params.id);
        res.json({ success: true, streak: newStreak });
    } catch (error) {
        logger.error('Complete goal error', { error: error.message });
        res.status(500).json({ error: 'Failed to complete goal' });
    }
});

router.post('/:id/uncomplete', requireAuth, (req, res) => {
    try {
        const goal = db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
        if (!goal) return res.status(404).json({ error: 'Goal not found' });
        const newStreak = Math.max(0, goal.streak - 1);
        db.prepare('UPDATE goals SET last_completed = NULL, streak = ? WHERE id = ?').run(newStreak, req.params.id);
        res.json({ success: true });
    } catch (error) {
        logger.error('Uncomplete goal error', { error: error.message });
        res.status(500).json({ error: 'Failed to uncomplete goal' });
    }
});

router.delete('/:id', requireAuth, (req, res) => {
    try {
        db.prepare("UPDATE goals SET status = 'deleted' WHERE id = ? AND user_id = ?")
            .run(req.params.id, req.session.userId);
        res.json({ success: true });
    } catch (error) {
        logger.error('Remove goal error', { error: error.message });
        res.status(500).json({ error: 'Failed to remove goal' });
    }
});

// ── GOAL ACTION STEPS ────────────────────────────────────

router.post('/:id/steps', requireAuth, (req, res) => {
    try {
        const goal = db.prepare('SELECT id FROM goals WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
        if (!goal) return res.status(404).json({ error: 'Goal not found' });

        const { stepText } = req.body;
        if (!stepText || !stepText.trim()) {
            return res.status(400).json({ error: 'Step text is required' });
        }

        const maxOrder = db.prepare('SELECT MAX(step_order) as maxOrder FROM goal_action_steps WHERE goal_id = ?').get(req.params.id);
        const nextOrder = (maxOrder.maxOrder || 0) + 1;

        const result = db.prepare(
            'INSERT INTO goal_action_steps (goal_id, step_text, step_order) VALUES (?, ?, ?)'
        ).run(req.params.id, stepText, nextOrder);
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
        logger.error('Add action step error', { error: error.message });
        res.status(500).json({ error: 'Failed to add action step' });
    }
});

router.post('/:goalId/steps/:stepId/toggle', requireAuth, (req, res) => {
    try {
        const goal = db.prepare('SELECT id FROM goals WHERE id = ? AND user_id = ?').get(req.params.goalId, req.session.userId);
        if (!goal) return res.status(404).json({ error: 'Goal not found' });

        const step = db.prepare('SELECT * FROM goal_action_steps WHERE id = ? AND goal_id = ?').get(req.params.stepId, req.params.goalId);
        if (!step) return res.status(404).json({ error: 'Step not found' });

        db.prepare('UPDATE goal_action_steps SET completed = ? WHERE id = ?').run(step.completed ? 0 : 1, req.params.stepId);
        res.json({ success: true });
    } catch (error) {
        logger.error('Toggle action step error', { error: error.message });
        res.status(500).json({ error: 'Failed to toggle action step' });
    }
});

router.delete('/:goalId/steps/:stepId', requireAuth, (req, res) => {
    try {
        const goal = db.prepare('SELECT id FROM goals WHERE id = ? AND user_id = ?').get(req.params.goalId, req.session.userId);
        if (!goal) return res.status(404).json({ error: 'Goal not found' });

        db.prepare('DELETE FROM goal_action_steps WHERE id = ? AND goal_id = ?').run(req.params.stepId, req.params.goalId);
        res.json({ success: true });
    } catch (error) {
        logger.error('Remove action step error', { error: error.message });
        res.status(500).json({ error: 'Failed to remove action step' });
    }
});

module.exports = router;
