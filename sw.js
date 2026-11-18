self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  e.waitUntil((async () => {
    const scope = self.registration.scope;
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const mine = list.filter(c => c.url.startsWith(scope));
    const target = mine.find(c => c.visibilityState === 'visible') || mine[0];

    if (target) {
      await target.focus();
      target.postMessage({ type: 'notif-click', uid: data.uid, alertType: data.alertType });
      return;
    }
    const q = data.uid ? `#jump=${encodeURIComponent(data.uid)}&t=${data.alertType || ''}` : '';
    await self.clients.openWindow(scope + q);
  })());
});
