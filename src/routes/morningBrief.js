const express = require('express');
const fetch = require('node-fetch');
const db = require('../db');
const logger = require('../logger');
const { requireAuth } = require('../auth');
const { parseDate, formatDate } = require('../lib/dateHelpers');

const router = express.Router();

router.post('/', requireAuth, async (req, res) => {
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
        logger.error('Morning brief error', { error: error.message });
        res.status(500).json({ error: 'Failed to generate morning brief' });
    }
});

module.exports = router;
