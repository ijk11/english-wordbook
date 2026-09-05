/* 오프라인용 서비스워커.
 *
 * 앱 파일과 단어 데이터는 네트워크 우선, 실패하면 캐시로 넘어간다.
 * (캐시 우선으로 뒀더니 새로 배포해도 폰에 설치된 앱은 옛날 화면을 계속 띄웠다.
 *  파일이 다 합쳐 300KB 남짓이라 매번 받아도 부담이 없다.)
 * 아이콘은 바뀔 일이 없으니 캐시 우선. */
const CACHE = 'wordbook-v3';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './data/cards.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const put = (request, response) => {
  const copy = response.clone();
  caches.open(CACHE).then(c => c.put(request, copy));
  return response;
};

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  // 아이콘: 캐시에 있으면 그대로
  if (request.url.includes('/icons/')) {
    e.respondWith(caches.match(request).then(hit => hit || fetch(request).then(r => put(request, r))));
    return;
  }

  // 나머지: 네트워크 우선, 끊기면 캐시 (문서 요청은 index.html 로 폴백)
  e.respondWith(
    fetch(request)
      .then(res => put(request, res))
      .catch(() => caches.match(request)
        .then(hit => hit || (request.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
