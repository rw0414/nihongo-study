// 오프라인 지원: 한 번 연 앱 화면 파일을 저장해 두고 인터넷 없이도 실행.
// 페이지 이동(HTML)은 최신 버전을 먼저 시도하고, 실패하면 저장본 사용.
const CACHE = 'app-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return
  const save = res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)) }
    return res
  }
  e.respondWith(
    req.mode === 'navigate'
      ? fetch(req).then(save).catch(() => caches.match(req).then(r => r || caches.match('./')))
      : caches.match(req).then(r => r || fetch(req).then(save)),
  )
})
