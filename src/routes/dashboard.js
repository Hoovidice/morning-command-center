const express = require('express');
const db = require('../db');
const logger = require('../logger');
const { requireAuth } = require('../auth');
const { parseDate } = require('../lib/dateHelpers');
const { upsertBalanceSnapshot, getBalanceTrend, getBudgetPace } = require('../lib/insights');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const accounts = db.prepare('SELECT * FROM accounts WHERE user_id = ?').all(userId);
        const cards = db.prepare('SELECT * FROM credit_cards WHERE user_id = ?').all(userId);
        const bills = db.prepare('SELECT * FROM bills WHERE user_id = ? AND active = 1').all(userId);
        const goals = db.prepare("SELECT * FROM goals WHERE user_id = ? AND status != 'deleted'").all(userId);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString().split('T')[0];
        const sevenDaysOut = new Date(today);
        sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);

        const dueSoon = bills.filter(b => {
            if (!b.due_date) return false;
            const dueDate = parseDate(b.due_date);
            if (!dueDate) return false;
            dueDate.setHours(0, 0, 0, 0);
            return dueDate >= today && dueDate <= sevenDaysOut;
        });

        const overdueBills = bills.filter(b => {
            if (!b.due_date || b.last_paid) return false;
            const dueDate = parseDate(b.due_date);
            if (!dueDate) return false;
            dueDate.setHours(0, 0, 0, 0);
            return dueDate < today;
        });

        const todayGoals = goals.filter(g => {
            if (g.recurrence === 'daily') return true;
            if (g.recurrence === 'weekly') {
                if (!g.last_completed) return true;
                const last = new Date(g.last_completed);
                const diffDays = Math.floor((today - last) / (1000 * 60 * 60 * 24));
                return diffDays >= 7;
            }
            if (g.deadline) {
                const deadline = new Date(g.deadline);
                const diffDays = Math.floor((deadline - today) / (1000 * 60 * 60 * 24));
                return diffDays <= 14;
            }
            return false;
        });

        const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);
        const totalDebt = cards.reduce((sum, c) => sum + c.balance, 0);

        upsertBalanceSnapshot(userId, totalBalance);
        const balanceTrend = getBalanceTrend(userId, totalBalance);

        // Last 14 days of balance snapshots, oldest first, so the dashboard
        // can draw a small sparkline chart instead of just a flat number.
        // Fewer than 2 points isn't enough to draw a line, so the frontend
        // hides the chart entirely until there's something worth showing.
        const balanceHistory = db.prepare(
            'SELECT date, total_balance FROM balance_snapshots WHERE user_id = ? ORDER BY date DESC LIMIT 14'
        ).all(userId).reverse().map(row => ({ date: row.date, balance: row.total_balance }));

        const userRow = db.prepare('SELECT monthly_budget_limit FROM users WHERE id = ?').get(userId);
        const budgetPace = getBudgetPace(userId, userRow ? userRow.monthly_budget_limit : null);

        // "Unassigned" money — total balance minus whatever's already been
        // earmarked (assigned) toward a goal's dollar target. Lets leftover
        // cash get a job instead of just sitting there unlabeled.
        const totalAssigned = goals.reduce((sum, g) => sum + (g.saved_amount || 0), 0);
        const unassignedBalance = Math.round((totalBalance - totalAssigned) * 100) / 100;

        // The database columns are snake_case (due_date, last_paid, ...), but
        // the frontend everywhere else expects camelCase (dueDate, lastPaid) —
        // matching what /api/bills and /api/goals already send. Mapping it
        // here the same way keeps the dashboard brief's "Bills Due Soon" and
        // "Today's Priorities" sections from showing "undefined".
        const mapBill = (b) => ({
            id: b.id, name: b.name, amount: b.amount, dueDate: b.due_date,
            frequency: b.frequency, type: b.type, lastPaid: b.last_paid, paidFromId: b.paid_from_id
        });
        const mapGoal = (g) => ({
            id: g.id, title: g.title, category: g.category, recurrence: g.recurrence,
            deadline: g.deadline, lastCompleted: g.last_completed, streak: g.streak,
            status: g.status, notes: g.notes
        });

        res.json({
            hasAccounts: accounts.length > 0,
            hasBills: bills.length > 0,
            hasGoals: goals.length > 0,
            accounts,
            cards: cards.map(c => ({ ...c, limit: c.credit_limit })),
            dueSoon: [...overdueBills, ...dueSoon].map(mapBill),
            todayGoals: todayGoals.map(mapGoal),
            totalBalance,
            totalDebt,
            balanceTrend,
            balanceHistory,
            budgetPace,
            unassignedBalance,
            todayStr
        });
    } catch (error) {
        logger.error('Dashboard error', { error: error.message });
        res.status(500).json({ error: 'Failed to load dashboard' });
    }
});

module.exports = router;
