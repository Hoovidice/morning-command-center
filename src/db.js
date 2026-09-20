const Database = require('better-sqlite3');
const path = require('path');
const logger = require('./logger');

// Normally the real database file. Tests set DB_PATH to a throwaway file
// (or ':memory:') before this module loads, so running the test suite
// never touches your actual data.
const dbPath = process.env.DB_PATH || path.join(__dirname, '../data.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        type TEXT,
        balance REAL DEFAULT 0,
        allocation REAL DEFAULT 0,
        notes TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS credit_cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        balance REAL DEFAULT 0,
        credit_limit REAL DEFAULT 0,
        purpose TEXT,
        linked_account TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        amount REAL NOT NULL,
        due_date TEXT,
        frequency TEXT,
        type TEXT,
        active INTEGER DEFAULT 1,
        last_paid TEXT,
        paid_from_id TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        date TEXT,
        category TEXT,
        description TEXT,
        amount REAL,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        category TEXT,
        recurrence TEXT,
        deadline TEXT,
        last_completed TEXT,
        streak INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        notes TEXT,
        why_i_want_it TEXT,
        reward TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS goal_action_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id INTEGER NOT NULL,
        step_text TEXT,
        step_order INTEGER,
        completed INTEGER DEFAULT 0,
        FOREIGN KEY (goal_id) REFERENCES goals(id)
    );

    CREATE TABLE IF NOT EXISTS daily_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        task_text TEXT NOT NULL,
        completed INTEGER DEFAULT 0,
        source TEXT DEFAULT 'manual',
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS weekly_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        week_start TEXT NOT NULL,
        main_goal TEXT,
        wins TEXT,
        improve_next_week TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS daily_reflections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        gratitude TEXT,
        affirmation TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS monthly_reflections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        month TEXT NOT NULL,
        health INTEGER DEFAULT 5,
        career INTEGER DEFAULT 5,
        financial INTEGER DEFAULT 5,
        personal INTEGER DEFAULT 5,
        family INTEGER DEFAULT 5,
        home INTEGER DEFAULT 5,
        notes TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        subscription_json TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- One row per user per day: the total balance across all their accounts
    -- at snapshot time. Lets the dashboard show "trending up/down" instead
    -- of just a flat number, by comparing today's total to one from ~7 days ago.
    CREATE TABLE IF NOT EXISTS balance_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        total_balance REAL NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(user_id, date)
    );
`);

// daily_tasks was created before "time" existed as a column. SQLite has no
// "ADD COLUMN IF NOT EXISTS", so this just tries to add it and quietly
// ignores the error on every startup after the first, once it's already there.
try {
    db.exec('ALTER TABLE daily_tasks ADD COLUMN time TEXT');
} catch (error) {
    // already added — nothing to do
}

// Tracks the last date a bill triggered a push notification, so the
// notification check doesn't send the same "due soon" alert every hour.
try {
    db.exec('ALTER TABLE bills ADD COLUMN last_notified TEXT');
} catch (error) {
    // already added — nothing to do
}

// A user-set monthly spending ceiling (separate from the paycheck-planner
// "Budget" feature). Powers the pace badge: how much of the month has
// passed vs. how much of this limit has been spent.
try {
    db.exec('ALTER TABLE users ADD COLUMN monthly_budget_limit REAL');
} catch (error) {
    // already added — nothing to do
}

// Marks whether a user has been through the first-time guided walkthrough,
// so it only ever shows once per account.
try {
    db.exec('ALTER TABLE users ADD COLUMN onboarded INTEGER DEFAULT 0');
} catch (error) {
    // already added — nothing to do
}

// A dollar target and running saved-so-far amount per goal, so leftover
// balance can be "assigned" to a goal (YNAB-style) instead of just sitting
// in an account unlabeled.
try {
    db.exec('ALTER TABLE goals ADD COLUMN target_amount REAL');
} catch (error) {
    // already added — nothing to do
}
try {
    db.exec('ALTER TABLE goals ADD COLUMN saved_amount REAL DEFAULT 0');
} catch (error) {
    // already added — nothing to do
}

// Tracks the last date a user's weekly digest push was sent, so it goes
// out once every ~7 days per user instead of every time the check runs.
try {
    db.exec('ALTER TABLE users ADD COLUMN last_digest_sent TEXT');
} catch (error) {
    // already added — nothing to do
}

// Tracks the last date a user got an "over pace" spending alert, so it
// only fires once per day even though the check runs hourly.
try {
    db.exec('ALTER TABLE users ADD COLUMN last_pace_alert TEXT');
} catch (error) {
    // already added — nothing to do
}

logger.info('Database initialized successfully');

module.exports = db;
