// Tests for signup, login, logout, and the "who am I" check. These are the
// most important tests in the whole app — if auth is broken, everything
// behind it is unreachable no matter how well the rest works.

const path = require('path');
const fs = require('fs');
const os = require('os');

// Point the database at a throwaway file for this test file only, so
// running the suite never touches your real data.db.
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `mcc-test-auth-${Date.now()}-${Math.random()}.db`);
process.env.SESSION_SECRET = 'test-secret';

const request = require('supertest');
const app = require('../src/app');

afterAll(() => {
    ['', '-wal', '-shm'].forEach(suffix => {
        try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch (error) { /* already gone */ }
    });
});

describe('POST /api/auth/signup', () => {
    test('creates a new account with valid details', async () => {
        const res = await request(app)
            .post('/api/auth/signup')
            .send({ email: 'alice@example.com', password: 'password123', name: 'Alice' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.user.email).toBe('alice@example.com');
    });

    test('rejects a signup missing an email', async () => {
        const res = await request(app)
            .post('/api/auth/signup')
            .send({ password: 'password123' });

        expect(res.status).toBe(400);
    });

    test('rejects a password shorter than 6 characters', async () => {
        const res = await request(app)
            .post('/api/auth/signup')
            .send({ email: 'shortpw@example.com', password: '123' });

        expect(res.status).toBe(400);
    });

    test('rejects signing up twice with the same email', async () => {
        await request(app)
            .post('/api/auth/signup')
            .send({ email: 'dupe@example.com', password: 'password123' });

        const res = await request(app)
            .post('/api/auth/signup')
            .send({ email: 'dupe@example.com', password: 'password123' });

        expect(res.status).toBe(400);
    });

    test('treats email case-insensitively, so the same email twice (different case) is still a duplicate', async () => {
        await request(app)
            .post('/api/auth/signup')
            .send({ email: 'CaseTest@example.com', password: 'password123' });

        const res = await request(app)
            .post('/api/auth/signup')
            .send({ email: 'casetest@example.com', password: 'password123' });

        expect(res.status).toBe(400);
    });
});

describe('POST /api/auth/login', () => {
    beforeAll(async () => {
        await request(app)
            .post('/api/auth/signup')
            .send({ email: 'loginuser@example.com', password: 'correcthorse', name: 'Login User' });
    });

    test('logs in with the correct email and password', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'loginuser@example.com', password: 'correcthorse' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('logs in even if the email is typed in a different case', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'LoginUser@Example.com', password: 'correcthorse' });

        expect(res.status).toBe(200);
    });

    test('rejects the wrong password', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'loginuser@example.com', password: 'wrongpassword' });

        expect(res.status).toBe(401);
    });

    test('rejects a login for an email that was never signed up', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'nobody@example.com', password: 'whatever123' });

        expect(res.status).toBe(401);
    });
});

describe('GET /api/auth/me and logout', () => {
    test('rejects checking "who am I" when not logged in', async () => {
        const res = await request(app).get('/api/auth/me');
        expect(res.status).toBe(401);
    });

    test('returns the logged-in user after signing up, then 401 after logging out', async () => {
        const agent = request.agent(app);

        await agent
            .post('/api/auth/signup')
            .send({ email: 'sessiontest@example.com', password: 'password123', name: 'Session Test' });

        const meRes = await agent.get('/api/auth/me');
        expect(meRes.status).toBe(200);
        expect(meRes.body.user.email).toBe('sessiontest@example.com');

        await agent.post('/api/auth/logout');

        const meAfterLogout = await agent.get('/api/auth/me');
        expect(meAfterLogout.status).toBe(401);
    });
});
