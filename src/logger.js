// Structured logging instead of scattered console.log/console.error calls.
//
// Why this matters: console.log is fine while you're watching the terminal
// yourself, but once this is deployed (Render, or anywhere else) you're not
// watching a terminal — you're stuck guessing what happened from whatever
// the host's log viewer shows you. Winston gives every log line a
// timestamp and a severity level (info/warn/error), and writes them both
// to the console (so `docker logs` still works exactly like before) and to
// files on disk, so there's a real history to look back through.
//
// In tests (NODE_ENV=test) this drops to just errors and skips the file
// writes entirely, so running the test suite doesn't clutter your project
// folder with log files or noisy output.

const winston = require('winston');
const path = require('path');
const fs = require('fs');

const isTest = process.env.NODE_ENV === 'test';
const isProduction = process.env.NODE_ENV === 'production';

// winston's File transport doesn't create its own folder — make sure
// logs/ exists before anything tries to write into it.
if (!isTest) {
    const logsDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
}

const transports = [
    new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp({ format: 'HH:mm:ss' }),
            winston.format.printf(({ level, message, timestamp, ...meta }) => {
                const extra = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
                return `${timestamp} [${level}] ${message}${extra}`;
            })
        )
    })
];

// Skip writing log files during automated tests — nothing needs them, and
// it keeps the test run from leaving files behind in the project folder.
if (!isTest) {
    transports.push(
        new winston.transports.File({
            filename: path.join(__dirname, '../logs/error.log'),
            level: 'error',
            maxsize: 5 * 1024 * 1024, // 5MB — rotates instead of growing forever
            maxFiles: 3
        }),
        new winston.transports.File({
            filename: path.join(__dirname, '../logs/combined.log'),
            maxsize: 5 * 1024 * 1024,
            maxFiles: 3
        })
    );
}

const logger = winston.createLogger({
    level: isTest ? 'error' : (isProduction ? 'info' : 'debug'),
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true })
    ),
    transports,
    // Don't let a logging problem crash the app
    exitOnError: false
});

module.exports = logger;
