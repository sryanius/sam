import { Game } from './ui/app.js';
import { BUILD } from './version.js';

window.game = new Game();
window.BUILD = BUILD;

// 타이틀 구석에 판 번호 — 폰에서 어느 판이 도는지 이걸로 확인한다
const stamp = document.getElementById('build-stamp');
if (stamp) stamp.textContent = BUILD;

window.addEventListener('error', (e) => {
  console.error(e.error || e.message);
});

/* ─────────────────────────── 화면 방향 ───────────────────────────
 *
 * 앱(TWA)으로 설치하면 안드로이드 쪽에서 가로로 못 박지만,
 * 브라우저로 열었을 때도 가로로 잡아 두면 좋다.
 * 설치형(standalone)일 때만 건다 — 일반 탭에서 잠그면 무례하다.
 * 폰의 회전 잠금과 무관하게 걸린다. 안 되는 환경에서는 조용히 넘어간다.
 */
(function lockLandscape() {
  const standalone = matchMedia('(display-mode: standalone)').matches
    || matchMedia('(display-mode: fullscreen)').matches
    || navigator.standalone === true;
  if (!standalone || !screen.orientation?.lock) return;
  screen.orientation.lock('landscape').catch(() => { /* 지원 안 하면 안내 화면이 대신 뜬다 */ });
})();

/* ─────────────────────────── 서비스 워커 ───────────────────────────
 *
 * localhost 에서는 아예 등록하지 않는다 — 캐시가 옛 모듈을 먹여서
 * 고친 코드가 안 도는 함정이 있다. 배포 환경에서만 켠다.
 *
 * 배포판에서는 **새 판이 올라오면 스스로 갈아탄다.**
 * 안 그러면 폰에 옛 화면이 남아서 "고쳤는데 왜 그대로지?" 가 된다.
 *   1. 열 때마다 reg.update() 로 새 sw.js 를 확인한다
 *   2. 새 워커가 자리를 잡으면(controllerchange) 한 번만 다시 불러온다
 */
const LOCAL = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', async () => {
    if (LOCAL) {
      for (const r of await navigator.serviceWorker.getRegistrations()) r.unregister();
      for (const k of await caches.keys()) caches.delete(k);
      return;
    }

    // 새 워커가 키를 넘겨받으면 한 번만 새로고침 (무한 새로고침 방지)
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });

    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      reg.update();                                   // 열 때마다 확인
      setInterval(() => reg.update(), 30 * 60 * 1000); // 오래 켜 두는 경우
    } catch (e) {
      console.warn('sw 등록 실패', e);
    }
  });
}
