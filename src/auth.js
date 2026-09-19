const bcrypt = require('bcrypt');
const db = require('./db');

const SALT_ROUNDS = 10;

async function createUser(email, password, name) {
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingUser) {
        throw new Error('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const result = db.prepare(
        'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)'
    ).run(email, passwordHash, name);

    return result.lastInsertRowid;
}

async function verifyUser(email, password) {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
        return null;
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
        return null;
    }

    return { id: user.id, email: user.email, name: user.name };
}

function getUserById(id) {
    const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(id);
    return user;
}

function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    next();
}

module.exports = {
    createUser,
    verifyUser,
    getUserById,
    requireAuth
};