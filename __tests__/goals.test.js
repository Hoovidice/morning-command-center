// Tests for goals: adding one, completing it (and the streak counter that
// comes with that), and the YNAB-style dollar-target / assign-money feature.

const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `mcc-test-goals-${Date.now()}-${Math.random()}.db`);
process.env.SESSION_SECRET = 'test-secret';

const request = require('supertest');
const app = require('../src/app');

afterAll(() => {
    ['', '-wal', '-shm'].forEach(suffix => {
        try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch (error) { /* already gone */ }
    });
});

describe('Goals API', () => {
    let agent;

    beforeAll(async () => {
        agent = request.agent(app);
        await agent
            .post('/api/auth/signup')
            .send({ email: 'goalsuser@example.com', password: 'password123', name: 'Goals User' });
    });

    test('adds a goal and it shows up in the goal list with a zero streak', async () => {
        const addRes = await agent
            .post('/api/goals')
            .send({ title: 'Drink more water', category: 'health', recurrence: 'daily' });

        expect(addRes.status).toBe(200);

        const listRes = await agent.get('/api/goals');
        expect(listRes.status).toBe(200);
        expect(listRes.body.length).toBe(1);
        expect(listRes.body[0].title).toBe('Drink more water');
        expect(listRes.body[0].streak).toBe(0);
    });

    test('completing a goal for the first time sets its streak to 1', async () => {
        const listRes = await agent.get('/api/goals');
        const goalId = listRes.body[0].id;

        const completeRes = await agent.post(`/api/goals/${goalId}/complete`);
        expect(completeRes.status).toBe(200);
        expect(completeRes.body.streak).toBe(1);
    });

    test('uncompleting a goal brings the streak back down', async () => {
        const listRes = await agent.get('/api/goals');
        const goalId = listRes.body[0].id;

        const uncompleteRes = await agent.post(`/api/goals/${goalId}/uncomplete`);
        expect(uncompleteRes.status).toBe(200);

        const afterRes = await agent.get('/api/goals');
        expect(afterRes.body[0].streak).toBe(0);
        expect(afterRes.body[0].lastCompleted).toBeNull();
    });

    test('removing a goal takes it out of the goal list', async () => {
        const listRes = await agent.get('/api/goals');
        const goalId = listRes.body[0].id;

        const removeRes = await agent.delete(`/api/goals/${goalId}`);
        expect(removeRes.status).toBe(200);

        const afterRes = await agent.get('/api/goals');
        expect(afterRes.body.length).toBe(0);
    });

    test('a goal with a dollar target starts at $0 saved', async () => {
        const addRes = await agent
            .post('/api/goals')
            .send({ title: 'Save for a laptop', category: 'financial', recurrence: 'ongoing', targetAmount: 1000 });
        expect(addRes.status).toBe(200);

        const listRes = await agent.get('/api/goals');
        const goal = listRes.body.find(g => g.title === 'Save for a laptop');
        expect(goal.targetAmount).toBe(1000);
        expect(goal.savedAmount).toBe(0);
    });

    test('assigning money to a goal increases its saved amount', async () => {
        const listRes = await agent.get('/api/goals');
        const goal = listRes.body.find(g => g.title === 'Save for a laptop');

        const assignRes = await agent
            .post(`/api/goals/${goal.id}/assign`)
            .send({ amount: 250 });
        expect(assignRes.status).toBe(200);
        expect(assignRes.body.savedAmount).toBe(250);

        const afterRes = await agent.get('/api/goals');
        const updated = afterRes.body.find(g => g.id === goal.id);
        expect(updated.savedAmount).toBe(250);
    });

    test('assigning a negative amount moves money back out, but never below $0', async () => {
        const listRes = await agent.get('/api/goals');
        const goal = listRes.body.find(g => g.title === 'Save for a laptop');

        const assignRes = await agent
            .post(`/api/goals/${goal.id}/assign`)
            .send({ amount: -1000 }); // more than the $250 currently saved

        expect(assignRes.status).toBe(200);
        expect(assignRes.body.savedAmount).toBe(0);
    });

    test('rejects assigning a non-numeric amount', async () => {
        const listRes = await agent.get('/api/goals');
        const goal = listRes.body.find(g => g.title === 'Save for a laptop');

        const assignRes = await agent
            .post(`/api/goals/${goal.id}/assign`)
            .send({ amount: 'not-a-number' });

        expect(assignRes.status).toBe(400);
    });
});
