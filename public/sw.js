// The web app's background script. It only handles notifications: no caching, so a new version of the app is never
// held back. The shop's server sends each order update and message here (Web Push) even while the app is closed.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// A message from the shop: shown on the phone with its usual sound, and the app icon gets the unread count.
self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data ? event.data.text() : '' };
  }
  const shown = self.registration.showNotification(message.title || 'Vimalnath', {
    body: message.body || '',
    icon: '/icons/icon-192.png',
    data: message.data || {},
    // A newer update about the same order replaces the older one in the list.
    tag: message.data && (message.data.orderId || message.data.shopOrderId) ? `order-${message.data.orderId || message.data.shopOrderId}` : undefined,
    renotify: true,
  });
  const badge = typeof message.badge === 'number' && 'setAppBadge' in navigator ? navigator.setAppBadge(message.badge).catch(() => {}) : null;
  // An open app updates its bell and list now, not when it's next opened.
  const told = self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => clients.forEach((client) => client.postMessage({ type: 'refresh' })));
  event.waitUntil(Promise.all([shown, badge, told]));
});

// A tap opens the order it is about (or the Notifications screen), in the app if it's already open.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.orderId ? `/order/${encodeURIComponent(data.orderId)}` : data.shopOrderId ? `/shop-order/${encodeURIComponent(data.shopOrderId)}` : '/notifications';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows[0];
      if (!open) return self.clients.openWindow(url);
      open.postMessage({ type: 'open', url });
      return open.focus();
    }),
  );
});
