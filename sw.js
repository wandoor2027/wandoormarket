const CACHE_NAME = 'kk-market-pwa-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(APP_SHELL.map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 僅快取同源靜態介面，絕不攔截 Firebase API、Worker 推播請求、HEAD 校時(?t=)或任何寫入
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.searchParams.has('t')) return;

  // 頁面導覽：網路優先，斷網時回退至快取的 index.html
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put('./index.html', copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // 靜態圖示、manifest、場館地圖：快取優先並背景更新
  if (/\.(png|jpe?g|webp|svg|json|ico)$/i.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((cached) => {
        const net = fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        }).catch(() => cached);
        return cached || net;
      })
    );
  }
});

// 背景推播接收（支援 FCM HTTP v1 data-only 與 notification payload，即使關掉網頁仍會彈出系統通知）
self.addEventListener('push', (e) => {
  if (!e.data) return;
  let payload = {};
  try {
    payload = e.data.json();
  } catch (err) {
    payload = { data: { title: '🏠 小門應援市集提醒', body: e.data.text() } };
  }
  const n = payload.notification || {};
  const d = payload.data || {};
  const title = d.title || n.title || '🏠 最愛攤主狀態更新';
  const body = d.body || n.body || '您關注的攤主已更新發放狀態，點擊查看位置！';
  const uid = d.uid || d.vendorId || '';
  const alertType = d.alertType || 'preparing';
  const dayKey = d.dayKey || '';
  const tag = d.tag || (uid ? `kk-fav-${dayKey}-${uid}-${alertType}` : 'kk-market-push');

  e.waitUntil((async () => {
    // 務必呼叫 showNotification（iOS 16.4+ Safari PWA 強制規定每次 push 皆須顯示通知）
    await self.registration.showNotification(title, {
      body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag,
      renotify: true,
      vibrate: [200, 100, 200],
      data: { uid, alertType, dayKey }
    });

    // 若前景已有開啟本頁，同步告知頁面顯示置頂橫幅並避免重複本地通知（不觸發額外 Firestore 讀取）
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope)) {
        c.postMessage({ type: 'fcm-push-received', uid, alertType, dayKey, title, body });
      }
    }
  })());
});

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
