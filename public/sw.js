
self.addEventListener('push', function (event) {
    if (event.data) {
        const data = event.data.json();
        const options = {
            body: data.body,
            icon: 'https://cdn-icons-png.flaticon.com/512/5968/5968292.png',
            badge: 'https://cdn-icons-png.flaticon.com/512/5968/5968292.png',
            vibrate: [200, 100, 200],
            tag: 'boleto-vencimento',
            renotify: true,
            requireInteraction: true,
            data: {
                url: data.url || '/'
            }
        };
        event.waitUntil(
            self.registration.showNotification(data.title, options)
        );
    }
});

self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(event.notification.data.url)
    );
});
