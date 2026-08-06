import { Game } from './ui/app.js';

window.game = new Game();

// 오프라인 실행.
// localhost 에서는 등록하지 않는다 — 캐시가 옛 모듈을 먹여서 고친 코드가 안 도는 함정이 있다.
// (이미 등록돼 있으면 벗겨낸다.)
const LOCAL = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', async () => {
    if (LOCAL) {
      for (const r of await navigator.serviceWorker.getRegistrations()) r.unregister();
      for (const k of await caches.keys()) caches.delete(k);
      return;
    }
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('sw 등록 실패', e));
  });
}

// 개발 편의 — 콘솔에서 상태를 들여다볼 수 있게
window.addEventListener('error', (e) => {
  console.error(e.error || e.message);
});
