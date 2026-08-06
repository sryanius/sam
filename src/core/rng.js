// 결정적 난수 — 세이브/리플레이가 가능하도록 시드를 상태에 담아 굴린다.
// mulberry32. 게임 전체가 이 한 인스턴스를 공유한다.

export function makeRng(seed = 20260806) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    /** [0,1) */
    next,
    /** [0,n) 정수 */
    int: (n) => Math.floor(next() * n),
    /** [a,b] 정수 */
    range: (a, b) => a + Math.floor(next() * (b - a + 1)),
    /** 확률 p(0~1)로 참 */
    chance: (p) => next() < p,
    /** 백분율 p(0~100)로 참 */
    pct: (p) => next() * 100 < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    /** 평균 mid, ±spread 범위의 삼각분포 정수 */
    around(mid, spread) {
      const v = (next() + next()) / 2; // 0~1, 중앙 몰림
      return Math.round(mid + (v * 2 - 1) * spread);
    },
    get seed() { return s; },
    set seed(v) { s = v >>> 0; },
  };
}

/** 전역 인스턴스 — state.js 가 세이브/로드 시 seed 를 넣고 뺀다. */
export const rng = makeRng();
