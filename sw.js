/* 삼국지 — 서비스 워커 (오프라인 실행 + 새 배포 반영)
 *
 * 이 파일은 ES 모듈이 아니라 **클래식 워커 스크립트**다. import 를 쓰지 마라
 * (`navigator.serviceWorker.register('./sw.js')` 를 모듈 타입 없이 부른다).
 *
 * ── 경로 규약 ──────────────────────────────────────────────────────────────
 * 배포 위치가 `https://sryanius.github.io/sam/` 이라 도메인 루트가 아니다.
 * 절대 경로(`/src/...`)를 쓰면 전부 404 다. 아래 목록과 폴백은 **전부 상대 경로**이고
 * 등록도 `./sw.js` 로 한다. 워커 기본 스코프 = 자기 파일이 있는 디렉터리라 scope 를 따로 줄 필요가 없다.
 *
 * ── 배포 절차 (★ 안 하면 폰에 옛 버전이 남는다) ────────────────────────────
 *   1. CACHE 버전을 올린다 (`sam-v1` → `sam-v2`).
 *   2. 모듈을 추가·삭제했으면 APP_SHELL 도 손본다.
 *   깜빡해도 완전히 망가지지는 않는다 — 정적 자산은 stale-while-revalidate 라
 *   한 번 더 새로고침하면 최신이 된다. 다만 즉시 반영되게 하려면 버전을 올려라.
 *
 * ── 캐시 전략 ──────────────────────────────────────────────────────────────
 *   · 내비게이션(문서 요청) → network-first + 캐시 폴백(`./index.html`)
 *   · 그 외 동일 출처 GET → cache-first + 백그라운드 갱신
 *   · 다른 출처 / GET 아닌 요청 → 손대지 않는다
 *
 * APP_SHELL 에서 빠진 파일이 있어도 앱은 죽지 않는다.
 * install 은 allSettled 라 몇 개 실패해도 통과하고, 목록에 없던 파일도
 * 온라인에서 처음 쓰는 순간 캐시에 들어간다.
 */

const CACHE = 'sam-v1';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './src/main.js',
  './src/core/rng.js',
  './src/core/util.js',
  './src/data/cities.js',
  './src/data/officers.js',
  './src/data/hometowns.js',
  './src/data/scenarios.js',
  './src/data/treasures.js',
  './src/game/state.js',
  './src/game/city.js',
  './src/game/officer.js',
  './src/game/commands.js',
  './src/game/turn.js',
  './src/game/ai.js',
  './src/game/battle/map.js',
  './src/game/battle/engine.js',
  './src/game/battle/ai.js',
  './src/ui/app.js',
  './src/ui/dom.js',
  './src/ui/mapview.js',
  './src/ui/city.js',
  './src/ui/battleview.js',
  './src/ui/lists.js',
  './src/ui/portrait.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(APP_SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 문서 — 온라인이면 항상 최신을, 끊기면 캐시된 셸을
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const net = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', net.clone());
        return net;
      } catch {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // 그 외 — 캐시로 즉시 띄우고 뒤에서 갱신
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    const net = fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return hit || (await net) || Response.error();
  })());
});
