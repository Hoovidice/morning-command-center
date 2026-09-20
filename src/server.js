// The actual entry point that starts the server for real traffic. Kept
// deliberately thin — everything about how the app is built and configured
// lives in app.js, so that file (not this one) is what the test suite
// imports and drives directly.

const app = require('./app');
const logger = require('./logger');
const { startNotificationJobs } = require('./lib/notifications');
const { scheduleBackups } = require('./lib/backup');

const PORT = process.env.PORT || 3000;

startNotificationJobs();
scheduleBackups();

app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
});
