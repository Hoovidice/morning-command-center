const express = require('express');
const db = require('../db');
const logger = require('../logger');
const { requireAuth } = require('../auth');

const router = express.Router();

// Returns every task in a given month (e.g. /api/tasks/month/2026-09) in one
// request, so the calendar grid can mark which days have something on them
// without fetching each day one at a time.
router.get('/month/:yearMonth', requireAuth, (req, res) => {
    try {
        const tasks = db.prepare('SELECT * FROM daily_tasks WHERE user_id = ? AND date LIKE ?')
            .all(req.session.userId, `${req.params.yearMonth}-%`);
        res.json(tasks);
    } catch (error) {
        logger.error('Get month tasks error', { error: error.message });
        res.status(500).json({ error: 'Failed to get month tasks' });
    }
});

router.get('/:date', requireAuth, (req, res) => {
    try {
        const tasks = db.prepare('SELECT * FROM daily_tasks WHERE user_id = ? AND date = ?')
            .all(req.session.userId, req.params.date);
        res.json(tasks);
    } catch (error) {
        logger.error('Get tasks error', { error: error.message });
        res.status(500).json({ error: 'Failed to get tasks' });
    }
});

router.post('/', requireAuth, (req, res) => {
    try {
        const { date, taskText, source, time } = req.body;
        const result = db.prepare(
            'INSERT INTO daily_tasks (user_id, date, task_text, source, time) VALUES (?, ?, ?, ?, ?)'
        ).run(req.session.userId, date, taskText, source || 'manual', time || null);
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
        logger.error('Add task error', { error: error.message });
        res.status(500).json({ error: 'Failed to add task' });
    }
});

// Creates one real task per matching day of the week between startDate and
// endDate (inclusive) — e.g. "Gym" at 6pm on Mon/Tue/Thu/Fri until Dec 1
// creates a separate row for every one of those days, so each can be
// checked off or deleted on its own, same as any other task.
router.post('/recurring', requireAuth, (req, res) => {
    try {
        const { taskText, time, startDate, endDate, weekdays } = req.body;
        if (!taskText || !startDate || !endDate || !Array.isArray(weekdays) || weekdays.length === 0) {
            return res.status(400).json({ error: 'Task text, a date range, and at least one weekday are required' });
        }

        const dates = [];
        let cursor = new Date(startDate + 'T00:00:00');
        const end = new Date(endDate + 'T00:00:00');
        while (cursor <= end) {
            if (weekdays.includes(cursor.getDay())) {
                dates.push(cursor.toISOString().split('T')[0]);
            }
            cursor.setDate(cursor.getDate() + 1);
        }

        if (dates.length === 0) {
            return res.status(400).json({ error: 'No matching days fall in that date range' });
        }

        const insert = db.prepare(
            'INSERT INTO daily_tasks (user_id, date, task_text, source, time) VALUES (?, ?, ?, ?, ?)'
        );
        const insertMany = db.transaction((allDates) => {
            for (const d of allDates) {
                insert.run(req.session.userId, d, taskText, 'recurring', time || null);
            }
        });
        insertMany(dates);

        res.json({ success: true, count: dates.length });
    } catch (error) {
        logger.error('Add recurring task error', { error: error.message });
        res.status(500).json({ error: 'Failed to add recurring task' });
    }
});

router.post('/:id/toggle', requireAuth, (req, res) => {
    try {
        const task = db.prepare('SELECT * FROM daily_tasks WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        db.prepare('UPDATE daily_tasks SET completed = ? WHERE id = ?').run(task.completed ? 0 : 1, req.params.id);
        res.json({ success: true });
    } catch (error) {
        logger.error('Toggle task error', { error: error.message });
        res.status(500).json({ error: 'Failed to toggle task' });
    }
});

router.delete('/:id', requireAuth, (req, res) => {
    try {
        db.prepare('DELETE FROM daily_tasks WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
        res.json({ success: true });
    } catch (error) {
        logger.error('Remove task error', { error: error.message });
        res.status(500).json({ error: 'Failed to remove task' });
    }
});

module.exports = router;
