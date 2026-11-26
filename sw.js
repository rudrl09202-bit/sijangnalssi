// 시장날씨 — 서비스 워커: 오프라인 캐시 + 푸시 알림 수신
const VERSION = 'snw-v3.20.13';
const FILES = ['./', './index.html', './styles.css', './manifest.webmanifest', './icons/icon.svg', './icons/apple-touch-icon.png', './icons/icon-192.png',
  './js/config.js', './js/snapshot.js', './js/rules.js', './js/api.js', './js/tickers.js', './js/universe.js', './js/ta.js', './js/chart.js', './js/app.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES).catch(() => {}))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))));
  self.clients.claim();
});
// 앱 파일: 인터넷이 되면 항상 새 파일(매일 자동 배포되므로), 안 되면 저장해 둔 파일
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return; // 외부 시세 API는 건드리지 않음
  const live = /(holdings-live|market-live|alerts-live|paper-live)\.js$/.test(url.pathname) || url.pathname.includes('/js/history/');
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((res) => { // 브라우저 임시 저장본 말고 서버에 새 버전 확인
    if (res.ok && !live) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
// 푸시 알림 받기: { title, body, url, tag }
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: '시장날씨', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || '시장날씨', {
    body: d.body || '', tag: d.tag || 'snw', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: d.url || './index.html#alerts' }
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data && e.notification.data.url || './index.html#alerts', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) if (c.url.startsWith(self.registration.scope)) { c.navigate(target); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
