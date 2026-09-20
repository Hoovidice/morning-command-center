const express = require('express');
const fetch = require('node-fetch');
const db = require('../db');
const logger = require('../logger');
const { requireAuth } = require('../auth');
const { parseDate, formatDate } = require('../lib/dateHelpers');

const router = express.Router();

router.post('/', requireAuth, async (req, res) => {
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
        logger.error('Budget error', { error: error.message });
        res.status(500).json({ error: 'Failed to generate budget breakdown' });
    }
});

module.exports = router;
