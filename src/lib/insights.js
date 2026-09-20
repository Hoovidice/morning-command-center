// The "feels smart" calculations that power the dashboard's trend arrow,
// spending pace badge, and per-user push insights. Pulled out of the route
// handlers so both the dashboard route and the background notification
// jobs can share the exact same logic instead of two copies drifting apart.

const db = require('../db');

// Saves (or updates) today's total-balance snapshot for a user. Called every
// time that user loads the dashboard, so there's no separate scheduled job
// to worry about — "today" always reflects their latest balance, and once
// enough days have passed there's a real history to compare against.
function upsertBalanceSnapshot(userId, totalBalance) {
    const todayStr = new Date().toISOString().split('T')[0];
    db.prepare(`
        INSERT INTO balance_snapshots (user_id, date, total_balance)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, date) DO UPDATE SET total_balance = excluded.total_balance
    `).run(userId, todayStr, totalBalance);
}

// Compares the current balance to the closest snapshot that's at least 6
// days old, so the dashboard can show "up/down $X over the last Y days"
// instead of just a flat number. Returns null if there's no snapshot old
// enough yet (e.g. a brand new account) — the frontend just hides the arrow.
function getBalanceTrend(userId, currentBalance) {
    const sixDaysAgo = new Date();
    sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);
    const sixDaysAgoStr = sixDaysAgo.toISOString().split('T')[0];

    const past = db.prepare(
        'SELECT * FROM balance_snapshots WHERE user_id = ? AND date <= ? ORDER BY date DESC LIMIT 1'
    ).get(userId, sixDaysAgoStr);
    if (!past) return null;

    const diff = currentBalance - past.total_balance;
    const days = Math.max(1, Math.round((new Date() - new Date(past.date + 'T00:00:00')) / (1000 * 60 * 60 * 24)));

    return {
        direction: diff > 0.005 ? 'up' : diff < -0.005 ? 'down' : 'flat',
        amount: Math.round(Math.abs(diff) * 100) / 100,
        days
    };
}

// Compares how far into the month we are to how much of the monthly limit
// has already been spent — "on pace" means those two percentages roughly
// match. Returns null if the user hasn't set a limit yet.
function getBudgetPace(userId, monthlyLimit) {
    if (!monthlyLimit || monthlyLimit <= 0) return null;

    const now = new Date();
    const yearMonth = now.toISOString().slice(0, 7); // "2026-09"
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();

    const spentRow = db.prepare(
        "SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE user_id = ? AND date LIKE ?"
    ).get(userId, `${yearMonth}-%`);
    const spent = spentRow.total || 0;

    const expectedPct = dayOfMonth / daysInMonth;
    const actualPct = spent / monthlyLimit;

    // Green: on or under pace. Yellow: a bit ahead (up to 15 points over).
    // Red: meaningfully ahead of where spending should be by this point.
    let status = 'green';
    if (actualPct > expectedPct + 0.15) status = 'red';
    else if (actualPct > expectedPct) status = 'yellow';

    return {
        status,
        spent: Math.round(spent * 100) / 100,
        limit: monthlyLimit,
        dayOfMonth,
        daysInMonth,
        percentSpent: Math.round(actualPct * 1000) / 10
    };
}

module.exports = { upsertBalanceSnapshot, getBalanceTrend, getBudgetPace };
