// Builds and configures the Express app, but never starts it listening.
// That split matters for testing: the automated test suite (see
// __tests__/) imports this file directly and drives it with supertest,
// without ever binding to a real port. server.js is the only file that
// actually starts the server for real traffic.

const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const dotenv = require('dotenv');
const path = require('path');
const helmet = require('helmet');
const logger = require('./logger');

dotenv.config();

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

// Render (and most cloud hosts) sit the app behind their own reverse proxy,
// which handles the real HTTPS connection and forwards plain HTTP to us.
// Without this, Express can't tell the original connection was secure, and
// "secure" cookies below would never get set.
if (isProduction) {
    app.set('trust proxy', 1);
}

// Adds a set of well-known security-related HTTP response headers
// (e.g. stops the site from being embedded in someone else's page,
// blocks browsers from guessing/sniffing content types). This is the
// "small bit of security" baseline almost every production app has.
app.use(helmet({
    // The AI brief and calendar rely on inline <script> tags in index.html,
    // so a fully locked-down default Content-Security-Policy would break
    // the app. Turning it off here still keeps every other helmet
    // protection (clickjacking, MIME sniffing, etc).
    contentSecurityPolicy: false
}));

app.use(express.json());
app.use(session({
    // Sessions are saved to disk (in the "sessions" folder) instead of just
    // living in memory, so restarting the app (or the Docker container)
    // doesn't silently log everyone out anymore.
    store: new FileStore({
        path: path.join(__dirname, '../sessions'),
        retries: 0,
        logFn: function () {} // quiet — we don't need file-store's own console noise
    }),
    secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        // "secure" means the browser will only ever send this cookie over
        // HTTPS. That's exactly what we want once this is deployed for real
        // — but during local testing at http://localhost there IS no HTTPS,
        // so turning this on unconditionally would break login on your own
        // machine. isProduction only becomes true once NODE_ENV=production
        // is set (we'll set that on the hosting platform, not locally).
        secure: isProduction,
        sameSite: 'lax'
    }
}));

if (!isProduction && process.env.SESSION_SECRET === undefined && process.env.NODE_ENV !== 'test') {
    logger.warn('Using the default session secret — fine for local testing, but set a real SESSION_SECRET before deploying anywhere public.');
}

app.use(express.static(path.join(__dirname, '../public')));

// A simple, unauthenticated endpoint that just confirms the server is up
// and can reach its own process info. Standard practice for anything you'd
// run in production — a host or monitoring tool can hit this instead of
// guessing whether the app is alive from a real page load.
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// ── ROUTES ───────────────────────────────────────────────
// Each of these used to be defined inline in one 1,200+ line server.js.
// Splitting them into their own files means a change to, say, how bills
// work can't accidentally break something in goals — each file only knows
// about its own piece of the app.
app.use('/api/auth', require('./routes/auth'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/onboarding', require('./routes/onboarding'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/morning-brief', require('./routes/morningBrief'));
app.use('/api/push', require('./routes/push'));
app.use('/api/accounts', require('./routes/accounts'));
app.use('/api/creditcards', require('./routes/creditCards'));
app.use('/api/bills', require('./routes/bills'));
app.use('/api/budget', require('./routes/budget'));
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api/goals', require('./routes/goals'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/weekly-reviews', require('./routes/weeklyReviews'));
app.use('/api/reflections', require('./routes/reflections'));
app.use('/api/monthly-reflections', require('./routes/monthlyReflections'));
app.use('/api/export', require('./routes/exportData'));

// ── 404 (no route matched) ────────────────────────────────
// Anything that reaches here didn't match a static file or a route above.
// An API path gets a small JSON error; anything else gets a plain page
// instead of Express's default unstyled error screen.
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Not found' });
    }
    res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Page not found</title></head>
        <body style="font-family:sans-serif;background:#080c14;color:#c8d8e8;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
            <div style="text-align:center;">
                <h1 style="color:#4a9eff;">404</h1>
                <p>That page doesn't exist.</p>
                <a href="/" style="color:#4a9eff;">Back to Morning Command Center</a>
            </div>
        </body>
        </html>
    `);
});

// ── GLOBAL ERROR HANDLER ───────────────────────────────────
// A safety net for anything a route didn't already catch itself (most do
// their own try/catch and respond directly). Express only recognizes this
// as an error handler because it takes four arguments — logs the real
// error server-side, but never leaks stack traces or internals to the
// client.
app.use((err, req, res, next) => {
    logger.error('Unhandled error', { error: err.message, path: req.path });
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Something went wrong on our end.' });
});

module.exports = app;
