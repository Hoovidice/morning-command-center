require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');

const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, '../google-credentials.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

async function getSheets() {
    const client = await auth.getClient();
    return google.sheets({ version: 'v4', auth: client });
}

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// ── BILLS ──────────────────────────────────────────────

async function getBills() {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Bills!A:J',
    });
    const rows = res.data.values || [];
    if (rows.length <= 1) return [];
    return rows.slice(1).map(row => ({
        id: row[0],
        name: row[1],
        amount: parseFloat(row[2]) || 0,
        dueDate: row[3],
        frequency: row[4],
        type: row[5],
        active: row[6] === 'TRUE',
        account: row[7] || '',
        lastPaid: row[8] || '',
        paidFromId: row[9] || ''
    })).filter(bill => bill.active);
}

async function addBill(bill) {
    const sheets = await getSheets();
    const id = Date.now().toString();
    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: 'Bills!A:J',
        valueInputOption: 'RAW',
        resource: {
            values: [[
                id,
                bill.name,
                bill.amount,
                bill.dueDate,
                bill.frequency,
                bill.type,
                'TRUE',
                bill.account || '',
                '',
                ''
            ]]
        }
    });
    return id;
}

async function removeBill(id) {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Bills!A:J',
    });
    const rows = res.data.values || [];
    const rowIndex = rows.findIndex(row => row[0] === id);
    if (rowIndex === -1) return;
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `Bills!G${rowIndex + 1}`,
        valueInputOption: 'RAW',
        resource: { values: [['FALSE']] }
    });
}

async function markBillPaid(id, date, paidFromId) {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Bills!A:J',
    });
    const rows = res.data.values || [];
    const rowIndex = rows.findIndex(row => row[0] === id);
    if (rowIndex === -1) return;
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `Bills!I${rowIndex + 1}:J${rowIndex + 1}`,
        valueInputOption: 'RAW',
        resource: { values: [[date, paidFromId]] }
    });
}

async function unmarkBillPaid(id) {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Bills!A:J',
    });
    const rows = res.data.values || [];
    const rowIndex = rows.findIndex(row => row[0] === id);
    if (rowIndex === -1) return null;
    const bill = rows[rowIndex];
    const paidFromId = bill[9] || null;
    const amount = parseFloat(bill[2]) || 0;
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `Bills!I${rowIndex + 1}:J${rowIndex + 1}`,
        valueInputOption: 'RAW',
        resource: { values: [['', '']] }
    });
    return { paidFromId, amount };
}

// ── PAYMENTS ───────────────────────────────────────────

async function addPayment(payment) {
    const sheets = await getSheets();
    const id = Date.now().toString();
    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: 'Payments!A:G',
        valueInputOption: 'RAW',
        resource: {
            values: [[
                id,
                payment.date,
                payment.billName,
                payment.amount,
                payment.paidFrom,
                payment.type,
                payment.paycheckId || ''
            ]]
        }
    });
    return id;
}

async function getPayments() {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Payments!A:G',
    });
    const rows = res.data.values || [];
    if (rows.length <= 1) return [];
    return rows.slice(1).map(row => ({
        id: row[0],
        date: row[1],
        billName: row[2],
        amount: parseFloat(row[3]) || 0,
        paidFrom: row[4],
        type: row[5],
        paycheckId: row[6]
    }));
}

// ── PAYCHECKS ──────────────────────────────────────────

async function addPaycheck(paycheck) {
    const sheets = await getSheets();
    const id = Date.now().toString();
    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: 'Paychecks!A:D',
        valueInputOption: 'RAW',
        resource: {
            values: [[
                id,
                paycheck.date,
                paycheck.amount,
                paycheck.notes || ''
            ]]
        }
    });
    return id;
}

async function getPaychecks() {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Paychecks!A:D',
    });
    const rows = res.data.values || [];
    if (rows.length <= 1) return [];
    return rows.slice(1).map(row => ({
        id: row[0],
        date: row[1],
        amount: parseFloat(row[2]) || 0,
        notes: row[3]
    }));
}

// ── EXPENSES ───────────────────────────────────────────

async function addExpense(expense) {
    const sheets = await getSheets();
    const id = Date.now().toString();
    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: 'Expenses!A:F',
        valueInputOption: 'RAW',
        resource: {
            values: [[
                id,
                expense.date,
                expense.category,
                expense.description,
                expense.amount,
                expense.paycheckId || ''
            ]]
        }
    });
    return id;
}

async function getExpenses() {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Expenses!A:F',
    });
    const rows = res.data.values || [];
    if (rows.length <= 1) return [];
    return rows.slice(1).map(row => ({
        id: row[0],
        date: row[1],
        category: row[2],
        description: row[3],
        amount: parseFloat(row[4]) || 0,
        paycheckId: row[5]
    }));
}

// ── HISTORY ────────────────────────────────────────────

async function addHistory(entry) {
    const sheets = await getSheets();
    const id = Date.now().toString();
    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: 'History!A:F',
        valueInputOption: 'RAW',
        resource: {
            values: [[
                id,
                entry.paycheckId,
                entry.date,
                entry.billName,
                entry.amount,
                entry.status
            ]]
        }
    });
    return id;
}

// ── ACCOUNTS ───────────────────────────────────────────

async function getAccounts() {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Accounts!A:F',
    });
    const rows = res.data.values || [];
    if (rows.length <= 1) return [];
    return rows.slice(1).filter(row => row[0] !== 'DELETED').map(row => ({
        id: row[0],
        name: row[1],
        type: row[2],
        balance: parseFloat(row[3]) || 0,
        allocation: parseFloat(row[4]) || 0,
        notes: row[5] || ''
    }));
}

async function addAccount(account) {
    const sheets = await getSheets();
    const id = Date.now().toString();
    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: 'Accounts!A:F',
        valueInputOption: 'RAW',
        resource: {
            values: [[
                id,
                account.name,
                account.type,
                account.balance,
                account.allocation,
                account.notes || ''
            ]]
        }
    });
    return id;
}

async function updateAccountBalance(id, newBalance) {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Accounts!A:F',
    });
    const rows = res.data.values || [];
    const rowIndex = rows.findIndex(row => row[0] === id);
    if (rowIndex === -1) return;
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `Accounts!D${rowIndex + 1}`,
        valueInputOption: 'RAW',
        resource: { values: [[newBalance]] }
    });
}

async function removeAccount(id) {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Accounts!A:F',
    });
    const rows = res.data.values || [];
    const rowIndex = rows.findIndex(row => row[0] === id);
    if (rowIndex === -1) return;
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `Accounts!A${rowIndex + 1}:F${rowIndex + 1}`,
        valueInputOption: 'RAW',
        resource: { values: [['DELETED', '', '', '', '', '']] }
    });
}

// ── CREDIT CARDS ───────────────────────────────────────

async function getCreditCards() {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'CreditCards!A:F',
    });
    const rows = res.data.values || [];
    if (rows.length <= 1) return [];
    return rows.slice(1).filter(row => row[0] !== 'DELETED').map(row => ({
        id: row[0],
        name: row[1],
        balance: parseFloat(row[2]) || 0,
        limit: parseFloat(row[3]) || 0,
        purpose: row[4] || '',
        linkedAccount: row[5] || ''
    }));
}

async function addCreditCard(card) {
    const sheets = await getSheets();
    const id = Date.now().toString();
    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: 'CreditCards!A:F',
        valueInputOption: 'RAW',
        resource: {
            values: [[
                id,
                card.name,
                card.balance,
                card.limit,
                card.purpose,
                card.linkedAccount
            ]]
        }
    });
    return id;
}

async function updateCreditCardBalance(id, newBalance) {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'CreditCards!A:F',
    });
    const rows = res.data.values || [];
    const rowIndex = rows.findIndex(row => row[0] === id);
    if (rowIndex === -1) return;
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `CreditCards!C${rowIndex + 1}`,
        valueInputOption: 'RAW',
        resource: { values: [[newBalance]] }
    });
}

async function removeCreditCard(id) {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'CreditCards!A:F',
    });
    const rows = res.data.values || [];
    const rowIndex = rows.findIndex(row => row[0] === id);
    if (rowIndex === -1) return;
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `CreditCards!A${rowIndex + 1}:F${rowIndex + 1}`,
        valueInputOption: 'RAW',
        resource: { values: [['DELETED', '', '', '', '', '']] }
    });
}

// ── GOALS ──────────────────────────────────────────────

async function getGoals() {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Goals!A:I',
    });
    const rows = res.data.values || [];
    if (rows.length <= 1) return [];
    return rows.slice(1).filter(row => row[0] && row[7] !== 'DELETED').map(row => ({
        id: row[0],
        title: row[1],
        category: row[2],
        recurrence: row[3],
        deadline: row[4] || '',
        lastCompleted: row[5] || '',
        streak: parseInt(row[6]) || 0,
        status: row[7] || 'active',
        notes: row[8] || ''
    }));
}

async function addGoal(goal) {
    const sheets = await getSheets();
    const id = Date.now().toString();
    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: 'Goals!A:I',
        valueInputOption: 'RAW',
        resource: {
            values: [[
                id,
                goal.title,
                goal.category,
                goal.recurrence,
                goal.deadline || '',
                '',
                0,
                'active',
                goal.notes || ''
            ]]
        }
    });
    return id;
}

async function completeGoal(id) {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Goals!A:I',
    });
    const rows = res.data.values || [];
    const rowIndex = rows.findIndex(row => row[0] === id);
    if (rowIndex === -1) return;
    const today = new Date().toISOString().split('T')[0];
    const currentStreak = parseInt(rows[rowIndex][6]) || 0;
    const lastCompleted = rows[rowIndex][5] || '';
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const newStreak = lastCompleted === yesterdayStr || lastCompleted === today
        ? currentStreak + 1
        : 1;
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `Goals!F${rowIndex + 1}:G${rowIndex + 1}`,
        valueInputOption: 'RAW',
        resource: { values: [[today, newStreak]] }
    });
    return newStreak;
}

async function uncompleteGoal(id) {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Goals!A:I',
    });
    const rows = res.data.values || [];
    const rowIndex = rows.findIndex(row => row[0] === id);
    if (rowIndex === -1) return;
    const currentStreak = Math.max(0, (parseInt(rows[rowIndex][6]) || 1) - 1);
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `Goals!F${rowIndex + 1}:G${rowIndex + 1}`,
        valueInputOption: 'RAW',
        resource: { values: [['', currentStreak]] }
    });
}

async function removeGoal(id) {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Goals!A:I',
    });
    const rows = res.data.values || [];
    const rowIndex = rows.findIndex(row => row[0] === id);
    if (rowIndex === -1) return;
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `Goals!H${rowIndex + 1}`,
        valueInputOption: 'RAW',
        resource: { values: [['DELETED']] }
    });
}

module.exports = {
    getBills,
    addBill,
    removeBill,
    markBillPaid,
    unmarkBillPaid,
    addPayment,
    getPayments,
    addPaycheck,
    getPaychecks,
    addExpense,
    getExpenses,
    addHistory,
    getAccounts,
    addAccount,
    updateAccountBalance,
    removeAccount,
    getCreditCards,
    addCreditCard,
    updateCreditCardBalance,
    removeCreditCard,
    getGoals,
    addGoal,
    completeGoal,
    uncompleteGoal,
    removeGoal
};