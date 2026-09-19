const fetch = require('node-fetch');
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const webpush = require('web-push');
const dotenv = require('dotenv');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { createUser, verifyUser, getUserById, requireAuth } = require('./auth');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Render (and most cloud hosts) sit the app behind their own reverse proxy,
// which handles the real HTTPS connection and forwards plain HTTP to us.
// Without this, Express can't tell the original connection was secure, and
// "secure" cookies below would never get set.
if (isProduction) {
    app.set('trust proxy', 1);
}

// Adds a set of well-known security-related HTTP response headers
// (e.g. stops the site from being embedded in someone else's page,
// blocks browsers from guessing/sniffing content types). This is the
// "small bit of security" baseline almost every production app has.
app.use(helmet({
    // The AI brief and calendar rely on inline <script> tags in index.html,
    // so a fully locked-down default Content-Security-Policy would break
    // the app. Turning it off here still keeps every other helmet
    // protection (clickjacking, MIME sniffing, etc).
    contentSecurityPolicy: false
}));

// Slows down repeated login/signup attempts against the same IP address,
// so someone can't sit there guessing passwords or spamming fake accounts.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 attempts per IP per window is plenty for a real person, not a script
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait a few minutes and try again.' }
});

// Push notifications only work once both VAPID keys are set (see .env).
// If they're missing, we skip setup instead of crashing the server.
const pushNotificationsEnabled = !!(process.env.WEB_PUSH_PUBLIC_KEY && process.env.WEB_PUSH_PRIVATE_KEY);
if (pushNotificationsEnabled) {
    webpush.setVapidDetails(
        'mailto:' + (process.env.VAPID_CONTACT_EMAIL || 'no-reply@example.com'),
        process.env.WEB_PUSH_PUBLIC_KEY,
        process.env.WEB_PUSH_PRIVATE_KEY
    );
} else {
    console.log('Push notifications disabled — WEB_PUSH_PUBLIC_KEY/WEB_PUSH_PRIVATE_KEY not set in .env');
}

app.use(express.json());
app.use(session({
    // Sessions are saved to disk (in the "sessions" folder) instead of just
    // living in memory, so restarting the app (or the Docker container)
    // doesn't silently log everyone out anymore.
    store: new FileStore({
        path: path.join(__dirname, '../sessions'),
        retries: 0,
        logFn: function () {} // quiet — we don't need file-store's own console noise
    }),
    secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        // "secure" means the browser will only ever send this cookie over
        // HTTPS. That's exactly what we want once this is deployed for real
        // — but during local testing at http://localhost there IS no HTTPS,
        // so turning this on unconditionally would break login on your own
        // machine. isProduction only becomes true once NODE_ENV=production
        // is set (we'll set that on the hosting platform, not locally).
        secure: isProduction,
        sameSite: 'lax'
    }
}));

if (!isProduction && process.env.SESSION_SECRET === undefined) {
    console.log('Using the default session secret — fine for local testing, but set a real SESSION_SECRET before deploying anywhere public.');
}
app.use(express.static(path.join(__dirname, '../public')));

function parseDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('-');
    if (parts[0].length === 2) {
        return new Date(`${parts[2]}-${parts[0]}-${parts[1]}`);
    }
    return new Date(dateStr);
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts[0].length === 4) {
        return `${parts[1]}-${parts[2]}-${parts[0]}`;
    }
    return dateStr;
}

// ── AUTH ROUTES ─────────────────────────────────────────

app.post('/api/auth/signup', authLimiter, async (req, res) => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        const userId = await createUser(email, password, name);
        req.session.userId = userId;
        res.json({ success: true, user: { id: userId, email, name } });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(400).json({ error: error.message || 'Failed to create account' });
    }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await verifyUser(email, password);
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        req.session.userId = user.id;
        res.json({ success: true, user });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Failed to log in' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

app.get('/api/auth/me', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    const user = getUserById(req.session.userId);
    res.json({ user });
});

// ── DASHBOARD ──────────────────────────────────────────

app.get('/api/dashboard', requireAuth, async (req, res) => {
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

        res.json({
            accounts,
            cards: cards.map(c => ({ ...c, limit: c.credit_limit })),
            dueSoon: [...overdueBills, ...dueSoon],
            todayGoals,
            totalBalance,
            totalDebt,
            todayStr
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ error: 'Failed to load dashboard' });
    }
});

// ── MORNING BRIEF ──────────────────────────────────────

app.post('/api/morning-brief', requireAuth, async (req, res) => {
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

        const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);
        const totalDebt = cards.reduce((sum, c) => sum + c.balance, 0);

        const accountsSummary = accounts.map(a => `${a.name}: $${a.balance.toFixed(2)}`).join(', ');
        const billsSummary = [...overdueBills, ...dueSoon].length > 0
            ? [...overdueBills.map(b => `OVERDUE: ${b.name} $${b.amount}`), ...dueSoon.map(b => `${b.name} $${b.amount} due ${formatDate(b.due_date)}`)].join(', ')
            : 'No bills due in the next 7 days';
        const goalsSummary = goals.map(g =>
            `${g.title} (${g.recurrence}${g.deadline ? ', due ' + g.deadline : ''}${g.streak > 0 ? ', streak: ' + g.streak + ' days' : ''})`
        ).join(', ');

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: 1024,
                messages: [{
                    role: 'user',
                    content: `You are a personal morning briefing assistant. Give me a focused morning brief for ${todayStr}.

FINANCIAL SNAPSHOT:
Total liquid balance: $${totalBalance.toFixed(2)}
Total credit card debt: $${totalDebt.toFixed(2)}
Accounts: ${accountsSummary}

BILLS DUE SOON OR OVERDUE: ${billsSummary}

MY GOALS AND TASKS: ${goalsSummary}

Reply using EXACTLY this format — five section markers, each on its own line, followed by the content for that section. Do not use markdown (no #, no *, no **). Plain sentences and plain lines only.

###FINANCIAL###
One honest, no-sugarcoating sentence about my financial position today.
###PRIORITIES###
The single most important thing to accomplish today, one short line.
A second important thing, one short line.
A third important thing, one short line (omit this line if there are fewer than 3).
###HEADSUP###
One short line calling out anything urgent (an overdue or soon-due bill, a tight deadline). If nothing is urgent, write exactly: NONE
###MOTIVATION###
One real, specific motivating sentence to start the day — not generic.
###END###

Keep it tight — this is a quick glance, not an essay.`
                }]
            })
        });

        const data = await response.json();
        res.json({ brief: data.content[0].text });
    } catch (error) {
        console.error('Morning brief error:', error);
        res.status(500).json({ error: 'Failed to generate morning brief' });
    }
});

// ── PUSH NOTIFICATIONS ─────────────────────────────────

// Public — the browser needs this key to set up a subscription, before login
// even matters for this particular call.
app.get('/api/push/vapid-public-key', (req, res) => {
    if (!pushNotificationsEnabled) {
        return res.status(503).json({ error: 'Push notifications are not configured on this server' });
    }
    res.json({ publicKey: process.env.WEB_PUSH_PUBLIC_KEY });
});

app.post('/api/push/subscribe', requireAuth, (req, res) => {
    try {
        const sub = req.body;
        if (!sub || !sub.endpoint) {
            return res.status(400).json({ error: 'Invalid subscription' });
        }
        db.prepare(`
            INSERT INTO push_subscriptions (user_id, endpoint, subscription_json)
            VALUES (?, ?, ?)
            ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, subscription_json = excluded.subscription_json
        `).run(req.session.userId, sub.endpoint, JSON.stringify(sub));
        res.json({ success: true });
    } catch (error) {
        console.error('Push subscribe error:', error);
        res.status(500).json({ error: 'Failed to save subscription' });
    }
});

app.post('/api/push/unsubscribe', requireAuth, (req, res) => {
    try {
        const { endpoint } = req.body;
        if (endpoint) {
            db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(req.session.userId, endpoint);
        } else {
            db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(req.session.userId);
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Push unsubscribe error:', error);
        res.status(500).json({ error: 'Failed to remove subscription' });
    }
});

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
                        console.error('Push send error:', err.message);
                    }
                });
            });

            db.prepare('UPDATE bills SET last_notified = ? WHERE id = ?').run(todayStr, bill.id);
        });
    } catch (error) {
        console.error('Bill notification check error:', error);
    }
}

if (pushNotificationsEnabled) {
    // Give the server a few seconds to fully start, then check hourly after that.
    setTimeout(checkBillNotifications, 10000);
    setInterval(checkBillNotifications, 60 * 60 * 1000);
}

// ── ACCOUNTS ───────────────────────────────────────────

app.get('/api/accounts', requireAuth, (req, res) => {
    try {
        const accounts = db.prepare('SELECT * FROM accounts WHERE user_id = ?').all(req.session.userId);
        res.json(accounts);
    } catch (error) {
        console.error('Get accounts error:', error);
        res.status(500).json({ error: 'Failed to get accounts' });
    }
});

app.post('/api/accounts', requireAuth, (req, res) => {
    try {
        const { name, type, balance, allocation, notes } = req.body;
        const result = db.prepare(
            'INSERT INTO accounts (user_id, name, type, balance, allocation, notes) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(req.session.userId, name, type, balance, allocation || 0, notes || '');
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
        console.error('Add account error:', error);
        res.status(500).json({ error: 'Failed to add account' });
    }
});

app.put('/api/accounts/:id', requireAuth, (req, res) => {
    try {
        db.prepare('UPDATE accounts SET balance = ? WHERE id = ? AND user_id = ?')
            .run(req.body.balance, req.params.id, req.session.userId);
        res.json({ success: true });
    } catch (error) {
        console.error('Update account error:', error);
        res.status(500).json({ error: 'Failed to update account' });
    }
});

app.delete('/api/accounts/:id', requireAuth, (req, res) => {
    try {
        db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?')
            .run(req.params.id, req.session.userId);
        res.json({ success: true });
    } catch (error) {
        console.error('Remove account error:', error);
        res.status(500).json({ error: 'Failed to remove account' });
    }
});

// ── CREDIT CARDS ───────────────────────────────────────

app.get('/api/creditcards', requireAuth, (req, res) => {
    try {
        const cards = db.prepare('SELECT * FROM credit_cards WHERE user_id = ?').all(req.session.userId);
        res.json(cards.map(c => ({ ...c, limit: c.credit_limit })));
    } catch (error) {
        console.error('Get credit cards error:', error);
        res.status(500).json({ error: 'Failed to get credit cards' });
    }
});

app.post('/api/creditcards', requireAuth, (req, res) => {
    try {
        const { name, balance, limit, purpose, linkedAccount } = req.body;
        const result = db.prepare(
            'INSERT INTO credit_cards (user_id, name, balance, credit_limit, purpose, linked_account) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(req.session.userId, name, balance, limit, purpose || '', linkedAccount || '');
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
        console.error('Add credit card error:', error);
        res.status(500).json({ error: 'Failed to add credit card' });
    }
});

app.put('/api/creditcards/:id', requireAuth, (req, res) => {
    try {
        db.prepare('UPDATE credit_cards SET balance = ? WHERE id = ? AND user_id = ?')
            .run(req.body.balance, req.params.id, req.session.userId);
        res.json({ success: true });
    } catch (error) {
        console.error('Update credit card error:', error);
        res.status(500).json({ error: 'Failed to update credit card' });
    }
});

app.delete('/api/creditcards/:id', requireAuth, (req, res) => {
    try {
        db.prepare('DELETE FROM credit_cards WHERE id = ? AND user_id = ?')
            .run(req.params.id, req.session.userId);
        res.json({ success: true });
    } catch (error) {
        console.error('Remove credit card error:', error);
        res.status(500).json({ error: 'Failed to remove credit card' });
    }
});

// ── BILLS ──────────────────────────────────────────────

app.get('/api/bills', requireAuth, (req, res) => {
    try {
        const bills = db.prepare('SELECT * FROM bills WHERE user_id = ? AND active = 1').all(req.session.userId);
        res.json(bills.map(b => ({
            id: b.id, name: b.name, amount: b.amount, dueDate: b.due_date,
            frequency: b.frequency, type: b.type, lastPaid: b.last_paid, paidFromId: b.paid_from_id
        })));
    } catch (error) {
        console.error('Get bills error:', error);
        res.status(500).json({ error: 'Failed to get bills' });
    }
});

app.post('/api/bills', requireAuth, (req, res) => {
    try {
        const { name, amount, dueDate, frequency, type } = req.body;
        const result = db.prepare(
            'INSERT INTO bills (user_id, name, amount, due_date, frequency, type, active) VALUES (?, ?, ?, ?, ?, ?, 1)'
        ).run(req.session.userId, name, amount, dueDate, frequency, type);
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
        console.error('Add bill error:', error);
        res.status(500).json({ error: 'Failed to add bill' });
    }
});

app.delete('/api/bills/:id', requireAuth, (req, res) => {
    try {
        db.prepare('UPDATE bills SET active = 0 WHERE id = ? AND user_id = ?')
            .run(req.params.id, req.session.userId);
        res.json({ success: true });
    } catch (error) {
        console.error('Remove bill error:', error);
        res.status(500).json({ error: 'Failed to remove bill' });
    }
});

app.post('/api/bills/:id/pay', requireAuth, (req, res) => {
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
        console.error('Pay bill error:', error);
        res.status(500).json({ error: 'Failed to mark bill as paid' });
    }
});

app.post('/api/bills/:id/unpay', requireAuth, (req, res) => {
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
        console.error('Unpay bill error:', error);
        res.status(500).json({ error: 'Failed to unmark bill as paid' });
    }
});

// ── BUDGET BREAKDOWN ───────────────────────────────────

app.post('/api/budget', requireAuth, async (req, res) => {
    const { paycheckAmount, paycheckDate } = req.body;
    try {
        const userId = req.session.userId;
        const bills = db.prepare('SELECT * FROM bills WHERE user_id = ? AND active = 1').all(userId);
        const accounts = db.prepare('SELECT * FROM accounts WHERE user_id = ?').all(userId);
        const creditCards = db.prepare('SELECT * FROM credit_cards WHERE user_id = ?').all(userId);

        const today = new Date(paycheckDate);
        const twoWeeksOut = new Date(today);
        twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

        const dueBills = bills.filter(b => {
            if (!b.due_date) return false;
            const dueDate = parseDate(b.due_date);
            if (!dueDate) return false;
            return dueDate >= today && dueDate <= twoWeeksOut;
        });

        const totalAllocation = accounts.reduce((sum, a) => sum + (parseFloat(a.allocation) || 0), 0);
        const accountDisbursements = accounts.map(a => {
            const pct = totalAllocation > 0 ? (a.allocation / totalAllocation) : (1 / accounts.length);
            const disbursement = (paycheckAmount * pct).toFixed(2);
            const newBalance = (a.balance + parseFloat(disbursement)).toFixed(2);
            return `${a.name}: receives $${disbursement} → new balance $${newBalance}`;
        }).join('\n');

        const billsList = dueBills.length > 0
            ? dueBills.map(b => `${b.name} - $${b.amount} due ${formatDate(b.due_date)} (${b.frequency})`).join('\n')
            : 'No bills due in this pay period';

        const accountsList = accounts.map(a =>
            `${a.name} (${a.type}) current balance: $${a.balance}, paycheck allocation: ${a.allocation}%`
        ).join('\n');

        const cardsList = creditCards.map(c =>
            `${c.name}: current balance $${c.balance} of $${c.credit_limit} limit, used for: ${c.purpose}, paid from: ${c.linked_account}`
        ).join('\n');

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: 2048,
                messages: [{
                    role: 'user',
                    content: `You are a personal cash flow manager. Here is my complete financial picture for this pay period.

PAYCHECK: $${paycheckAmount} received on ${paycheckDate}

PAYCHECK DISBURSEMENT AFTER THIS PAYCHECK:
${accountDisbursements}

CURRENT ACCOUNT BALANCES:
${accountsList}

CREDIT CARDS:
${cardsList}

BILLS DUE IN THIS PAY PERIOD (next 14 days):
${billsList}

Please provide a clear financial plan for this pay period:

1. ACCOUNT BALANCES AFTER PAYCHECK
2. BILLS DUE THIS PERIOD - which account to pay each from
3. CREDIT CARD STATUS
4. SHORTFALLS - flag any account that cannot cover its bills
5. SAFE TO SPEND per account
6. ADVICE - one honest sentence

Be specific with dollar amounts. Be direct.`
                }]
            })
        });

        const data = await response.json();
        res.json({ result: data.content[0].text });
    } catch (error) {
        console.error('Budget error:', error);
        res.status(500).json({ error: 'Failed to generate budget breakdown' });
    }
});

// ── EXPENSES ───────────────────────────────────────────

app.get('/api/expenses', requireAuth, (req, res) => {
    try {
        const expenses = db.prepare('SELECT * FROM expenses WHERE user_id = ? ORDER BY id DESC').all(req.session.userId);
        res.json(expenses);
    } catch (error) {
        console.error('Get expenses error:', error);
        res.status(500).json({ error: 'Failed to get expenses' });
    }
});

app.post('/api/expenses', requireAuth, (req, res) => {
    try {
        const { category, description, amount, date } = req.body;
        const result = db.prepare(
            'INSERT INTO expenses (user_id, date, category, description, amount) VALUES (?, ?, ?, ?, ?)'
        ).run(req.session.userId, date, category, description, amount);
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
        console.error('Add expense error:', error);
        res.status(500).json({ error: 'Failed to add expense' });
    }
});

// ── GOALS ──────────────────────────────────────────────

app.get('/api/goals', requireAuth, (req, res) => {
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
            actionSteps: stepsByGoal[g.id] || []
        })));
    } catch (error) {
        console.error('Get goals error:', error);
        res.status(500).json({ error: 'Failed to get goals' });
    }
});

app.post('/api/goals', requireAuth, (req, res) => {
    try {
        const { title, category, recurrence, deadline, notes, whyIWantIt, reward } = req.body;
        const result = db.prepare(
            'INSERT INTO goals (user_id, title, category, recurrence, deadline, notes, why_i_want_it, reward, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(req.session.userId, title, category, recurrence, deadline || '', notes || '', whyIWantIt || '', reward || '', 'active');
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
        console.error('Add goal error:', error);
        res.status(500).json({ error: 'Failed to add goal' });
    }
});

app.post('/api/goals/:id/complete', requireAuth, (req, res) => {
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
        console.error('Complete goal error:', error);
        res.status(500).json({ error: 'Failed to complete goal' });
    }
});

app.post('/api/goals/:id/uncomplete', requireAuth, (req, res) => {
    try {
        const goal = db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
        if (!goal) return res.status(404).json({ error: 'Goal not found' });
        const newStreak = Math.max(0, goal.streak - 1);
        db.prepare('UPDATE goals SET last_completed = NULL, streak = ? WHERE id = ?').run(newStreak, req.params.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Uncomplete goal error:', error);
        res.status(500).json({ error: 'Failed to uncomplete goal' });
    }
});

app.delete('/api/goals/:id', requireAuth, (req, res) => {
    try {
        db.prepare("UPDATE goals SET status = 'deleted' WHERE id = ? AND user_id = ?")
            .run(req.params.id, req.session.userId);
        res.json({ success: true });
    } catch (error) {
        console.error('Remove goal error:', error);
        res.status(500).json({ error: 'Failed to remove goal' });
    }
});

// ── GOAL ACTION STEPS ────────────────────────────────────

app.post('/api/goals/:id/steps', requireAuth, (req, res) => {
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
        console.error('Add action step error:', error);
        res.status(500).json({ error: 'Failed to add action step' });
    }
});

app.post('/api/goals/:goalId/steps/:stepId/toggle', requireAuth, (req, res) => {
    try {
        const goal = db.prepare('SELECT id FROM goals WHERE id = ? AND user_id = ?').get(req.params.goalId, req.session.userId);
        if (!goal) return res.status(404).json({ error: 'Goal not found' });

        const step = db.prepare('SELECT * FROM goal_action_steps WHERE id = ? AND goal_id = ?').get(req.params.stepId, req.params.goalId);
        if (!step) return res.status(404).json({ error: 'Step not found' });

        db.prepare('UPDATE goal_action_steps SET completed = ? WHERE id = ?').run(step.completed ? 0 : 1, req.params.stepId);
        res.json({ success: true });
    } catch (error) {
        console.error('Toggle action step error:', error);
        res.status(500).json({ error: 'Failed to toggle action step' });
    }
});

app.delete('/api/goals/:goalId/steps/:stepId', requireAuth, (req, res) => {
    try {
        const goal = db.prepare('SELECT id FROM goals WHERE id = ? AND user_id = ?').get(req.params.goalId, req.session.userId);
        if (!goal) return res.status(404).json({ error: 'Goal not found' });

        db.prepare('DELETE FROM goal_action_steps WHERE id = ? AND goal_id = ?').run(req.params.stepId, req.params.goalId);
        res.json({ success: true });
    } catch (error) {
        console.error('Remove action step error:', error);
        res.status(500).json({ error: 'Failed to remove action step' });
    }
});

// ── DAILY TASKS (for calendar) ──────────────────────────

// Returns every task in a given month (e.g. /api/tasks/month/2026-09) in one
// request, so the calendar grid can mark which days have something on them
// without fetching each day one at a time.
app.get('/api/tasks/month/:yearMonth', requireAuth, (req, res) => {
    try {
        const tasks = db.prepare('SELECT * FROM daily_tasks WHERE user_id = ? AND date LIKE ?')
            .all(req.session.userId, `${req.params.yearMonth}-%`);
        res.json(tasks);
    } catch (error) {
        console.error('Get month tasks error:', error);
        res.status(500).json({ error: 'Failed to get month tasks' });
    }
});

app.get('/api/tasks/:date', requireAuth, (req, res) => {
    try {
        const tasks = db.prepare('SELECT * FROM daily_tasks WHERE user_id = ? AND date = ?')
            .all(req.session.userId, req.params.date);
        res.json(tasks);
    } catch (error) {
        console.error('Get tasks error:', error);
        res.status(500).json({ error: 'Failed to get tasks' });
    }
});

app.post('/api/tasks', requireAuth, (req, res) => {
    try {
        const { date, taskText, source, time } = req.body;
        const result = db.prepare(
            'INSERT INTO daily_tasks (user_id, date, task_text, source, time) VALUES (?, ?, ?, ?, ?)'
        ).run(req.session.userId, date, taskText, source || 'manual', time || null);
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
        console.error('Add task error:', error);
        res.status(500).json({ error: 'Failed to add task' });
    }
});

// Creates one real task per matching day of the week between startDate and
// endDate (inclusive) — e.g. "Gym" at 6pm on Mon/Tue/Thu/Fri until Dec 1
// creates a separate row for every one of those days, so each can be
// checked off or deleted on its own, same as any other task.
app.post('/api/tasks/recurring', requireAuth, (req, res) => {
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
        console.error('Add recurring task error:', error);
        res.status(500).json({ error: 'Failed to add recurring task' });
    }
});

app.post('/api/tasks/:id/toggle', requireAuth, (req, res) => {
    try {
        const task = db.prepare('SELECT * FROM daily_tasks WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        db.prepare('UPDATE daily_tasks SET completed = ? WHERE id = ?').run(task.completed ? 0 : 1, req.params.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Toggle task error:', error);
        res.status(500).json({ error: 'Failed to toggle task' });
    }
});

app.delete('/api/tasks/:id', requireAuth, (req, res) => {
    try {
        db.prepare('DELETE FROM daily_tasks WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
        res.json({ success: true });
    } catch (error) {
        console.error('Remove task error:', error);
        res.status(500).json({ error: 'Failed to remove task' });
    }
});

// ── WEEKLY REVIEWS ───────────────────────────────────────

app.get('/api/weekly-reviews', requireAuth, (req, res) => {
    try {
        const reviews = db.prepare('SELECT * FROM weekly_reviews WHERE user_id = ? ORDER BY week_start DESC')
            .all(req.session.userId);
        res.json(reviews.map(r => ({
            id: r.id, weekStart: r.week_start, mainGoal: r.main_goal,
            wins: r.wins, improveNextWeek: r.improve_next_week
        })));
    } catch (error) {
        console.error('Get weekly reviews error:', error);
        res.status(500).json({ error: 'Failed to get weekly reviews' });
    }
});

// Creates a new review for a week, or updates the existing one for that same
// week if you already saved one — so re-saving the same week edits it instead
// of creating a duplicate.
app.post('/api/weekly-reviews', requireAuth, (req, res) => {
    try {
        const { weekStart, mainGoal, wins, improveNextWeek } = req.body;
        if (!weekStart) return res.status(400).json({ error: 'Week start date is required' });

        const existing = db.prepare('SELECT id FROM weekly_reviews WHERE user_id = ? AND week_start = ?')
            .get(req.session.userId, weekStart);

        if (existing) {
            db.prepare('UPDATE weekly_reviews SET main_goal = ?, wins = ?, improve_next_week = ? WHERE id = ?')
                .run(mainGoal || '', wins || '', improveNextWeek || '', existing.id);
            res.json({ success: true, id: existing.id });
        } else {
            const result = db.prepare(
                'INSERT INTO weekly_reviews (user_id, week_start, main_goal, wins, improve_next_week) VALUES (?, ?, ?, ?, ?)'
            ).run(req.session.userId, weekStart, mainGoal || '', wins || '', improveNextWeek || '');
            res.json({ success: true, id: result.lastInsertRowid });
        }
    } catch (error) {
        console.error('Save weekly review error:', error);
        res.status(500).json({ error: 'Failed to save weekly review' });
    }
});

app.delete('/api/weekly-reviews/:id', requireAuth, (req, res) => {
    try {
        db.prepare('DELETE FROM weekly_reviews WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
        res.json({ success: true });
    } catch (error) {
        console.error('Remove weekly review error:', error);
        res.status(500).json({ error: 'Failed to remove weekly review' });
    }
});

// ── DAILY REFLECTIONS (gratitude / affirmation) ─────────

app.get('/api/reflections/:date', requireAuth, (req, res) => {
    try {
        const reflection = db.prepare('SELECT * FROM daily_reflections WHERE user_id = ? AND date = ?')
            .get(req.session.userId, req.params.date);
        if (!reflection) return res.json({ date: req.params.date, gratitude: '', affirmation: '' });
        res.json({ id: reflection.id, date: reflection.date, gratitude: reflection.gratitude, affirmation: reflection.affirmation });
    } catch (error) {
        console.error('Get reflection error:', error);
        res.status(500).json({ error: 'Failed to get reflection' });
    }
});

// Upserts by date, same pattern as weekly reviews — saving the same day
// again edits it instead of creating a duplicate.
app.post('/api/reflections', requireAuth, (req, res) => {
    try {
        const { date, gratitude, affirmation } = req.body;
        if (!date) return res.status(400).json({ error: 'Date is required' });

        const existing = db.prepare('SELECT id FROM daily_reflections WHERE user_id = ? AND date = ?')
            .get(req.session.userId, date);

        if (existing) {
            db.prepare('UPDATE daily_reflections SET gratitude = ?, affirmation = ? WHERE id = ?')
                .run(gratitude || '', affirmation || '', existing.id);
            res.json({ success: true, id: existing.id });
        } else {
            const result = db.prepare(
                'INSERT INTO daily_reflections (user_id, date, gratitude, affirmation) VALUES (?, ?, ?, ?)'
            ).run(req.session.userId, date, gratitude || '', affirmation || '');
            res.json({ success: true, id: result.lastInsertRowid });
        }
    } catch (error) {
        console.error('Save reflection error:', error);
        res.status(500).json({ error: 'Failed to save reflection' });
    }
});

// ── MONTHLY REFLECTION (wheel of life) ──────────────────

app.get('/api/monthly-reflections', requireAuth, (req, res) => {
    try {
        const reflections = db.prepare('SELECT * FROM monthly_reflections WHERE user_id = ? ORDER BY month DESC')
            .all(req.session.userId);
        res.json(reflections);
    } catch (error) {
        console.error('Get monthly reflections error:', error);
        res.status(500).json({ error: 'Failed to get monthly reflections' });
    }
});

app.post('/api/monthly-reflections', requireAuth, (req, res) => {
    try {
        const { month, health, career, financial, personal, family, home, notes } = req.body;
        if (!month) return res.status(400).json({ error: 'Month is required' });

        const existing = db.prepare('SELECT id FROM monthly_reflections WHERE user_id = ? AND month = ?')
            .get(req.session.userId, month);

        const vals = [health, career, financial, personal, family, home].map(v => {
            const n = parseInt(v, 10);
            return Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 5;
        });

        if (existing) {
            db.prepare(
                'UPDATE monthly_reflections SET health = ?, career = ?, financial = ?, personal = ?, family = ?, home = ?, notes = ? WHERE id = ?'
            ).run(...vals, notes || '', existing.id);
            res.json({ success: true, id: existing.id });
        } else {
            const result = db.prepare(
                'INSERT INTO monthly_reflections (user_id, month, health, career, financial, personal, family, home, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
            ).run(req.session.userId, month, ...vals, notes || '');
            res.json({ success: true, id: result.lastInsertRowid });
        }
    } catch (error) {
        console.error('Save monthly reflection error:', error);
        res.status(500).json({ error: 'Failed to save monthly reflection' });
    }
});

app.delete('/api/monthly-reflections/:id', requireAuth, (req, res) => {
    try {
        db.prepare('DELETE FROM monthly_reflections WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
        res.json({ success: true });
    } catch (error) {
        console.error('Remove monthly reflection error:', error);
        res.status(500).json({ error: 'Failed to remove monthly reflection' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});