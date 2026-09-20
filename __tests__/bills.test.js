// Tests for bill tracking: adding, listing, paying, unpaying, and removing
// a bill, plus making sure none of this works without being logged in.

const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `mcc-test-bills-${Date.now()}-${Math.random()}.db`);
process.env.SESSION_SECRET = 'test-secret';

const request = require('supertest');
const app = require('../src/app');

afterAll(() => {
    ['', '-wal', '-shm'].forEach(suffix => {
        try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch (error) { /* already gone */ }
    });
});

describe('Bills API', () => {
    let agent;

    beforeAll(async () => {
        agent = request.agent(app);
        await agent
            .post('/api/auth/signup')
            .send({ email: 'billsuser@example.com', password: 'password123', name: 'Bills User' });
    });

    test('rejects adding a bill when not logged in', async () => {
        const res = await request(app)
            .post('/api/bills')
            .send({ name: 'Rent', amount: 1200, dueDate: '2026-10-01', frequency: 'monthly', type: 'fixed' });

        expect(res.status).toBe(401);
    });

    test('adds a bill and it shows up in the bill list', async () => {
        const addRes = await agent
            .post('/api/bills')
            .send({ name: 'Rent', amount: 1200, dueDate: '2026-10-01', frequency: 'monthly', type: 'fixed' });

        expect(addRes.status).toBe(200);
        expect(addRes.body.success).toBe(true);

        const listRes = await agent.get('/api/bills');
        expect(listRes.status).toBe(200);
        expect(listRes.body.length).toBe(1);
        expect(listRes.body[0].name).toBe('Rent');
        expect(listRes.body[0].amount).toBe(1200);
        expect(listRes.body[0].lastPaid).toBeNull();
    });

    test('marks a bill as paid and moves the amount out of the paying account', async () => {
        const accountRes = await agent
            .post('/api/accounts')
            .send({ name: 'Checking', type: 'checking', balance: 2000, allocation: 100, notes: '' });
        const accountId = accountRes.body.id;

        const billsRes = await agent.get('/api/bills');
        const billId = billsRes.body[0].id;

        const payRes = await agent
            .post(`/api/bills/${billId}/pay`)
            .send({ date: '2026-09-20', amount: 1200, accountId, newAccountBalance: 800 });

        expect(payRes.status).toBe(200);

        const afterRes = await agent.get('/api/bills');
        expect(afterRes.body[0].lastPaid).toBe('2026-09-20');

        const accountsAfter = await agent.get('/api/accounts');
        const updatedAccount = accountsAfter.body.find(a => a.id === accountId);
        expect(updatedAccount.balance).toBe(800);
    });

    test('unpaying a bill returns the money to the account it was paid from', async () => {
        const billsRes = await agent.get('/api/bills');
        const billId = billsRes.body[0].id;

        const unpayRes = await agent.post(`/api/bills/${billId}/unpay`);
        expect(unpayRes.status).toBe(200);

        const afterRes = await agent.get('/api/bills');
        expect(afterRes.body[0].lastPaid).toBeNull();

        const accountsAfter = await agent.get('/api/accounts');
        expect(accountsAfter.body[0].balance).toBe(2000);
    });

    test('removing a bill takes it out of the active bill list', async () => {
        const billsRes = await agent.get('/api/bills');
        const billId = billsRes.body[0].id;

        const removeRes = await agent.delete(`/api/bills/${billId}`);
        expect(removeRes.status).toBe(200);

        const afterRes = await agent.get('/api/bills');
        expect(afterRes.body.length).toBe(0);
    });
});
