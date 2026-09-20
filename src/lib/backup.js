// Automated database backups.
//
// Why this exists: even with a persistent disk protecting the database
// from disappearing on restart (see dataDir.js), a backup protects against
// the other ways data gets lost — a bad migration, an accidental bulk
// delete, or just wanting to look at what the data looked like yesterday.
// Every few hours, the whole database gets dumped to a timestamped JSON
// file inside DATA_DIR/backups, right alongside the database itself, so it
// gets the same persistence guarantees.

const fs = require('fs');
const path = require('path');
const db = require('../db');
const logger = require('../logger');
const DATA_DIR = require('../dataDir');

const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const MAX_BACKUPS_KEPT = 14; // roughly the last week+ if run every ~6 hours

const TABLES = [
    'users', 'accounts', 'credit_cards', 'bills', 'expenses', 'goals',
    'goal_action_steps', 'daily_tasks', 'weekly_reviews', 'daily_reflections',
    'monthly_reflections', 'push_subscriptions', 'balance_snapshots'
];

// Dumps every table to a single JSON file. Password hashes are included —
// this file is meant to fully restore the database, not to be shared —
// so it's kept out of git (see .gitignore) same as the database itself.
function createBackup() {
    try {
        if (!fs.existsSync(BACKUPS_DIR)) {
            fs.mkdirSync(BACKUPS_DIR, { recursive: true });
        }

        const snapshot = { createdAt: new Date().toISOString(), tables: {} };
        for (const table of TABLES) {
            try {
                snapshot.tables[table] = db.prepare(`SELECT * FROM ${table}`).all();
            } catch (err) {
                // A table that doesn't exist yet (e.g. right after a fresh
                // install) shouldn't fail the whole backup.
                snapshot.tables[table] = [];
            }
        }

        const filename = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        const filePath = path.join(BACKUPS_DIR, filename);
        fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));

        pruneOldBackups();
        logger.info('Database backup created', { filename });
        return filePath;
    } catch (error) {
        logger.error('Database backup failed', { error: error.message });
        return null;
    }
}

// Keeps only the most recent MAX_BACKUPS_KEPT files, so this doesn't grow
// forever and quietly eat disk space.
function pruneOldBackups() {
    const files = fs.readdirSync(BACKUPS_DIR)
        .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
        .map(f => ({ name: f, time: fs.statSync(path.join(BACKUPS_DIR, f)).mtimeMs }))
        .sort((a, b) => b.time - a.time);

    files.slice(MAX_BACKUPS_KEPT).forEach(f => {
        fs.unlinkSync(path.join(BACKUPS_DIR, f.name));
    });
}

// Runs a backup shortly after startup, then every 6 hours after that.
// Never called during tests.
function scheduleBackups() {
    setTimeout(createBackup, 30000);
    setInterval(createBackup, 6 * 60 * 60 * 1000);
}

module.exports = { createBackup, scheduleBackups, BACKUPS_DIR };
