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

/* ─────────────────────────── 확대 차단 ───────────────────────────
 *
 * 손가락으로 벌려 페이지가 커지면 배치가 다 어긋난다.
 * 막는 일은 CSS 의 `touch-action: pan-x pan-y` 가 한다 — 훑어 넘기기만 허용하므로
 * 핀치도 두 번 두드리기도 확대되지 않는다. 지도와 전장은 `touch-action: none` 이라
 * 브라우저가 손대지 않고 제 확대 코드가 직접 받는다.
 *
 * 아래는 touch-action 을 안 보는 옛 웹킷용 보험이다.
 * 두 번 두드리기를 자바스크립트로 막는 짓은 하지 않는다 — 멀쩡한 빠른 탭까지 먹는다.
 */
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

/* ─────────────────────────── 화면 방향 ───────────────────────────
 *
 * 가로로 보아야 하는 게임이다. 거는 자리가 셋인데 환경마다 듣는 게 다르다.
 *   1) 앱(TWA)의 안드로이드 쪽 요청 — Chrome 이 받아 줄 때만 듣는다
 *   2) 여기서 조용히 거는 screen.orientation.lock — 설치형에서만 시도
 *   3) 안내 화면의 "가로로 전환" 단추 — **사람이 누른 뒤**라 가장 잘 듣는다
 *
 * 2번이 조용히 실패하면 원인을 알 길이 없어 한참 헤맨다.
 * 그래서 3번은 결과를 화면에 그대로 찍는다.
 */
const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches
  || matchMedia('(display-mode: fullscreen)').matches
  || navigator.standalone === true;

/** @returns {Promise<string>} 사람이 읽을 결과 */
async function lockLandscape(withFullscreen) {
  const notes = [];
  if (!screen.orientation?.lock) return '이 브라우저는 화면 방향 고정을 지원하지 않는다';

  if (withFullscreen && !document.fullscreenElement) {
    const el = document.documentElement;
    const ask = el.requestFullscreen || el.webkitRequestFullscreen;
    try {
      // 옵션 인자를 안 받는 구현이 있어 실패하면 인자 없이 한 번 더
      try { await ask.call(el, { navigationUI: 'hide' }); }
      catch { await ask.call(el); }
      notes.push('전체화면 ○');
    } catch (e) {
      notes.push(`전체화면 ✕ ${e?.name || e}: ${e?.message ?? ''}`);
    }
  }
  try {
    await screen.orientation.lock('landscape');
    notes.push('가로 고정 ○');
  } catch (e) {
    notes.push(`가로 고정 ✕ ${e.name}: ${e.message}`);
  }
  return notes.join('  ·  ');
}

// 열 때 한 번 조용히 시도 — 설치형일 때만. 일반 탭에서 잠그면 무례하다.
if (isStandalone()) lockLandscape(false);

// 안내 화면의 단추 — 사람이 누른 직후라 가장 잘 듣는다
const rotateBtn = document.getElementById('rotate-force');
const diag = document.getElementById('rotate-diag');
if (rotateBtn) {
  rotateBtn.addEventListener('click', async () => {
    diag.textContent = '거는 중…';
    const result = await lockLandscape(true);
    const mode = isStandalone() ? '설치형' : '브라우저 탭';
    diag.textContent = `${result}\n${mode} · ${screen.orientation?.type ?? '방향 정보 없음'}`
      + `\n화면 ${innerWidth}×${innerHeight} · 판 ${BUILD}`;
  });
}

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
