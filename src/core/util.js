export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** 1234567 -> "123만4567" (삼국지식 수 표기) */
export function num(n) {
  n = Math.round(n);
  if (Math.abs(n) < 10000) return String(n);
  const man = Math.floor(n / 10000);
  const rest = n % 10000;
  return rest === 0 ? `${man}만` : `${man}만${rest}`;
}

/** 3자리 콤마 */
export function comma(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 연/월을 "건안 5년(200년) 3월" 형태로 */
const ERAS = [
  { from: 184, to: 188, name: '중평' , base: 184 },
  { from: 189, to: 189, name: '영한' , base: 189 },
  { from: 190, to: 193, name: '초평' , base: 190 },
  { from: 194, to: 195, name: '흥평' , base: 194 },
  { from: 196, to: 219, name: '건안' , base: 196 },
  { from: 220, to: 220, name: '연강' , base: 220 },
  { from: 221, to: 300, name: '황초' , base: 221 },
];
export function eraName(year) {
  for (const e of ERAS) if (year >= e.from && year <= e.to) return `${e.name} ${year - e.base + 1}년`;
  return `${year}년`;
}
export function dateLabel(year, month) {
  return `${eraName(year)} (${year}년) ${month}월`;
}

/** 상성 거리 — 0~74. 작을수록 궁합이 좋다. (삼국지3 방식: 0~149 원형) */
export function affinityGap(a, b) {
  const d = Math.abs(a - b) % 150;
  return Math.min(d, 150 - d);
}

/** 능력 수치를 등급 문자로 */
export function grade(v) {
  if (v >= 95) return 'S';
  if (v >= 85) return 'A';
  if (v >= 70) return 'B';
  if (v >= 55) return 'C';
  if (v >= 40) return 'D';
  return 'E';
}

export function sum(arr, f = (x) => x) {
  let t = 0;
  for (const x of arr) t += f(x);
  return t;
}

export function byDesc(f) {
  return (a, b) => f(b) - f(a);
}

/** 얕은 배열 제거 */
export function remove(arr, item) {
  const i = arr.indexOf(item);
  if (i >= 0) arr.splice(i, 1);
  return arr;
}

/**
 * 한글 조사 자동 선택: 받침 유무.
 * 숫자가 들어와도 죽지 않게 문자열로 바꾼다 — 숫자 뒤 조사는 읽는 법을 따르므로
 * 1·3·6·7·8·0 은 받침 있음(일·삼·육·칠·팔·영), 2·4·5·9 는 없음으로 본다.
 */
export function josa(word, withBatchim, withoutBatchim) {
  const s = String(word ?? '');
  if (!s) return withoutBatchim;
  const ch = s[s.length - 1];
  if (ch >= '0' && ch <= '9') return '013678'.includes(ch) ? withBatchim : withoutBatchim;
  const last = s.charCodeAt(s.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return withoutBatchim;
  return (last - 0xac00) % 28 !== 0 ? withBatchim : withoutBatchim;
}
export const eul = (w) => w + josa(w, '을', '를');
export const eun = (w) => w + josa(w, '은', '는');
export const iga = (w) => w + josa(w, '이', '가');
export const gwa = (w) => w + josa(w, '과', '와');

/** -(으)로 만 규칙이 다르다. ㄹ 받침은 '로' 다 — 마철로, 진류로. */
export function euro(w) {
  const s = String(w ?? '');
  const last = s.charCodeAt(s.length - 1);
  if (last >= 0xac00 && last <= 0xd7a3) {
    const jong = (last - 0xac00) % 28;      // 8 = ㄹ
    return s + (jong === 0 || jong === 8 ? '로' : '으로');
  }
  return s + josa(s, '으로', '로');
}
