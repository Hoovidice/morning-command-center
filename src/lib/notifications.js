// Everything related to web push notifications: setting up the VAPID keys,
// and the three background jobs that check the database on a schedule and
// push alerts to subscribed devices (bill due-dates, the weekly digest,
// and over-budget pace alerts). Pulled out of server.js so the route files
// that also need to send a push (like the on-demand test notification) can
// share the same setup instead of each re-configuring web-push themselves.

const webpush = require('web-push');
const db = require('../db');
const logger = require('../logger');
const { parseDate, formatDate } = require('./dateHelpers');
const { getBudgetPace } = require('./insights');

// Push notifications only work once both VAPID keys are set (see .env).
// If they're missing, every function below quietly no-ops instead of
// crashing the server.
const pushNotificationsEnabled = !!(process.env.WEB_PUSH_PUBLIC_KEY && process.env.WEB_PUSH_PRIVATE_KEY);

if (pushNotificationsEnabled) {
    webpush.setVapidDetails(
        'mailto:' + (process.env.VAPID_CONTACT_EMAIL || 'no-reply@example.com'),
        process.env.WEB_PUSH_PUBLIC_KEY,
        process.env.WEB_PUSH_PRIVATE_KEY
    );
} else {
    logger.info('Push notifications disabled — WEB_PUSH_PUBLIC_KEY/WEB_PUSH_PRIVATE_KEY not set in .env');
}

// Looks for bills that are overdue or due within the next 2 days and pushes
// a notification to every device the bill's owner has subscribed from —
// once per bill per day, tracked via bills.last_notified.
function checkBillNotifications() {
    if (!pushNotificationsEnabled) return;
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString().split('T')[0];

        const bills = db.prepare('SELECT * FROM bills WHERE active = 1').all();

        bills.forEach(bill => {
            if (!bill.due_date || bill.last_paid) return;
            if (bill.last_notified === todayStr) return;

            const dueDate = parseDate(bill.due_date);
            if (!dueDate) return;
            dueDate.setHours(0, 0, 0, 0);
            const daysUntil = Math.round((dueDate - today) / (1000 * 60 * 60 * 24));

            const isOverdue = daysUntil < 0;
            const isDueSoon = daysUntil >= 0 && daysUntil <= 2;
            if (!isOverdue && !isDueSoon) return;

            const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(bill.user_id);
            if (subs.length === 0) return;

            const title = isOverdue ? '⚠️ Bill overdue' : '📄 Bill due soon';
            const body = isOverdue
                ? `${bill.name} ($${bill.amount.toFixed(2)}) is overdue`
                : `${bill.name} ($${bill.amount.toFixed(2)}) is due ${formatDate(bill.due_date)}`;

            subs.forEach(sub => {
                let subscription;
                try {
                    subscription = JSON.parse(sub.subscription_json);
                } catch (parseErr) {
                    return;
                }
                webpush.sendNotification(subscription, JSON.stringify({ title, body })).catch(err => {
                    // 404/410 means the browser subscription no longer exists — clean it up
                    if (err.statusCode === 404 || err.statusCode === 410) {
                        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
                    } else {
                        logger.error('Push send error', { error: err.message });
                    }
                });
            });

            db.prepare('UPDATE bills SET last_notified = ? WHERE id = ?').run(todayStr, bill.id);
        });
    } catch (error) {
        logger.error('Bill notification check error', { error: error.message });
    }
}

// Sends each user a once-a-week summary — bills paid, bills still due, goal
// streaks, and their spending pace if they've set a monthly limit. Purely
// computed from the database (no AI call), so it's fast, free, and never
// fails from an API outage. Runs on the same hourly check as bill alerts,
// but only actually sends once ~7 days have passed since a user's last one.
function checkWeeklyDigest() {
    if (!pushNotificationsEnabled) return;
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString().split('T')[0];
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const users = db.prepare('SELECT * FROM users').all();

        users.forEach(user => {
            const dueForDigest = !user.last_digest_sent || new Date(user.last_digest_sent) <= sevenDaysAgo;
            if (!dueForDigest) return;

            const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(user.id);
            if (subs.length === 0) return;

            const weekStartStr = sevenDaysAgo.toISOString().split('T')[0];

            const billsPaidThisWeek = db.prepare(
                'SELECT COUNT(*) as count FROM bills WHERE user_id = ? AND last_paid >= ?'
            ).get(user.id, weekStartStr).count;

            const upcomingBills = db.prepare(
                "SELECT COUNT(*) as count FROM bills WHERE user_id = ? AND active = 1 AND last_paid IS NULL"
            ).get(user.id).count;

            const bestStreak = db.prepare(
                "SELECT MAX(streak) as best FROM goals WHERE user_id = ? AND status != 'deleted'"
            ).get(user.id).best || 0;

            const accounts = db.prepare('SELECT * FROM accounts WHERE user_id = ?').all(user.id);
            const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);

            let paceLine = '';
            if (user.monthly_budget_limit) {
                const pace = getBudgetPace(user.id, user.monthly_budget_limit);
                if (pace) {
                    const paceWord = pace.status === 'green' ? 'on pace' : pace.status === 'yellow' ? 'a bit ahead of pace' : 'over pace';
                    paceLine = ` You're ${paceWord} on your monthly budget.`;
                }
            }

            const streakLine = bestStreak > 0 ? ` Best streak: ${bestStreak} days.` : '';
            const body = `$${totalBalance.toFixed(2)} balance · ${billsPaidThisWeek} bill${billsPaidThisWeek === 1 ? '' : 's'} paid this week · ${upcomingBills} outstanding.${streakLine}${paceLine}`;

            const payload = JSON.stringify({
                title: '📊 Your Weekly Digest',
                body
            });

            subs.forEach(sub => {
                let subscription;
                try {
                    subscription = JSON.parse(sub.subscription_json);
                } catch (parseErr) {
                    return;
                }
                webpush.sendNotification(subscription, payload).catch(err => {
                    if (err.statusCode === 404 || err.statusCode === 410) {
                        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
                    } else {
                        logger.error('Weekly digest send error', { error: err.message });
                    }
                });
            });

            db.prepare('UPDATE users SET last_digest_sent = ? WHERE id = ?').run(todayStr, user.id);
        });
    } catch (error) {
        logger.error('Weekly digest check error', { error: error.message });
    }
}

// Pushes a one-a-day heads-up when a user is meaningfully over pace on
// their monthly budget — an insight the AI brief already implies, but this
// makes it proactive instead of something they only see by opening the app.
function checkPaceInsights() {
    if (!pushNotificationsEnabled) return;
    try {
        const todayStr = new Date().toISOString().split('T')[0];
        const users = db.prepare('SELECT * FROM users WHERE monthly_budget_limit IS NOT NULL').all();

        users.forEach(user => {
            if (user.last_pace_alert === todayStr) return;

            const pace = getBudgetPace(user.id, user.monthly_budget_limit);
            if (!pace || pace.status !== 'red') return;

            const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(user.id);
            if (subs.length === 0) return;

            const payload = JSON.stringify({
                title: '⚠️ Spending pace alert',
                body: `You've spent $${pace.spent.toFixed(2)} of your $${pace.limit.toFixed(2)} monthly budget by day ${pace.dayOfMonth} of ${pace.daysInMonth} — running ahead of pace.`
            });

            subs.forEach(sub => {
                let subscription;
                try {
                    subscription = JSON.parse(sub.subscription_json);
                } catch (parseErr) {
                    return;
                }
                webpush.sendNotification(subscription, payload).catch(err => {
                    if (err.statusCode === 404 || err.statusCode === 410) {
                        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
                    } else {
                        logger.error('Pace insight send error', { error: err.message });
                    }
                });
            });

            db.prepare('UPDATE users SET last_pace_alert = ? WHERE id = ?').run(todayStr, user.id);
        });
    } catch (error) {
        logger.error('Pace insight check error', { error: error.message });
    }
}

// Kicks off all three background jobs on a staggered delay (so they don't
// all hit the database in the same instant at startup) and then repeats
// each one hourly. Only called from server.js — never during tests.
function startNotificationJobs() {
    if (!pushNotificationsEnabled) return;
    setTimeout(checkBillNotifications, 10000);
    setInterval(checkBillNotifications, 60 * 60 * 1000);
    setTimeout(checkWeeklyDigest, 15000);
    setInterval(checkWeeklyDigest, 60 * 60 * 1000);
    setTimeout(checkPaceInsights, 20000);
    setInterval(checkPaceInsights, 60 * 60 * 1000);
}

module.exports = {
    pushNotificationsEnabled,
    webpush,
    checkBillNotifications,
    checkWeeklyDigest,
    checkPaceInsights,
    startNotificationJobs
};
