import { Game } from './ui/app.js';

window.game = new Game();

// 오프라인 실행 — file:// 로 열었을 때는 등록하지 않는다
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('sw 등록 실패', e));
  });
}

// 개발 편의 — 콘솔에서 상태를 들여다볼 수 있게
window.addEventListener('error', (e) => {
  console.error(e.error || e.message);
});
