// Service worker for push notifications. This runs in the background,
// separate from the page itself, which is what lets a notification show up
// even when the Morning Command Center tab isn't open.

self.addEventListener('push', function (event) {
    let data = { title: 'Morning Command Center', body: 'You have an update.' };
    try {
        if (event.data) data = event.data.json();
    } catch (error) {
        // fall back to the default text above
    }

    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body
        })
    );
});

// Clicking the notification focuses an already-open tab if there is one,
// otherwise opens a new one.
self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(function (clientList) {
            for (const client of clientList) {
                if ('focus' in client) return client.focus();
            }
            if (clients.openWindow) return clients.openWindow('/');
        })
    );
});
