// The one folder every piece of persistent data (the database, login
// sessions, backups) lives under. Locally and in Docker this defaults to
// the project root — exactly where they've always lived, so nothing
// changes for you.
//
// On a host with an ephemeral filesystem (Render's free tier, and even
// Render's paid tier without a disk attached), anything written outside of
// a mounted persistent disk gets wiped on every restart or redeploy. To
// fix that in production, set the DATA_DIR environment variable to the
// path where your persistent disk is mounted (e.g. /var/data on Render),
// and everything below will read/write there instead.
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');

module.exports = DATA_DIR;
