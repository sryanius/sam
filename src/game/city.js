// 도시 경제 — 수입, 수확, 소비, 인구, 재해.
//
// 눈금 감각:
//   금  1000 이면 대도시 한 달 수입쯤. 징병 1만에 800금.
//   군량 1만석이면 병사 1만이 열 달 버틴다(주둔 기준).

import { CITIES, cityCaps } from '../data/cities.js';
import { clamp } from '../core/util.js';
import { NEUTRAL } from './state.js';

export const caps = (c) => cityCaps(CITIES[c.id].size);
export const info = (c) => CITIES[c.id];

/** 매월 금 수입 */
export function goldIncome(c) {
  const k = caps(c);
  return Math.round(c.comm * 0.75 * (0.5 + (c.pop / k.pop) * 0.9) * (c.loyal / 100));
}

/** 9월 수확량(석) */
export function harvest(c, weather = 1) {
  const k = caps(c);
  return Math.round(c.land * 40 * (0.6 + (c.pop / k.pop) * 0.8) * weather);
}

/** 매월 군량 소비 — 주둔군은 적게, 원정군은 많이 먹는다 */
export function foodUpkeep(c) {
  return Math.round(c.troops * 0.08);
}
export const marchUpkeep = (troops) => Math.round(troops * 0.5);

/** 기술 수준 -> 무기 보정 (0.85 ~ 1.30) */
export function weaponBonus(c) {
  const k = caps(c);
  return 0.85 + (c.tech / k.tech) * 0.45;
}

/** 성벽 방어 배수 (1.0 ~ 1.8) */
export function wallBonus(c) {
  const k = caps(c);
  return 1.0 + (c.wall / k.wall) * 0.8;
}

/** 이 도시가 감당 가능한 병력 상한 — 인구의 1/6 을 넘길 수 없다 */
export function troopCap(c) {
  return Math.min(caps(c).troops, Math.floor(c.pop / 6));
}

/** 도시 종합 평가 — 목록 정렬·AI 판단용 */
export function cityValue(c) {
  const k = caps(c);
  return Math.round(((c.land / k.land) + (c.comm / k.comm) + (c.pop / k.pop) + (c.wall / k.wall)) * 25);
}

/* ─────────────────────────── 월간 정산 ─────────────────────────── */

/**
 * 도시 하나의 한 달 정산. 보고할 사건을 문자열 배열로 돌려준다.
 * rng 는 호출부(turn.js)가 넘긴다 — 시드 일관성을 위해서.
 */
export function monthlyUpdate(st, c, rng) {
  const ev = [];
  const k = caps(c);
  const cityName = info(c).name;

  // 수입
  if (c.faction !== NEUTRAL) c.gold += goldIncome(c);

  // 군량
  if (st.month === 9) {
    let weather = 1;
    const r = rng.next();
    if (r < 0.10) { weather = 1.35; ev.push(`${cityName}에 풍년이 들었다.`); }
    else if (r < 0.20) { weather = 0.62; ev.push(`${cityName}에 흉년이 들었다.`); }
    const h = harvest(c, weather);
    c.food += h;
    if (c.faction !== NEUTRAL && weather === 1) ev.push(null); // 조용한 추수
  }
  c.food -= foodUpkeep(c);

  // 군량이 바닥나면 병사가 흩어지고 민심이 떨어진다
  if (c.food < 0) {
    const lost = Math.min(c.troops, Math.round(-c.food / 0.1 * 0.35));
    c.troops = Math.max(0, c.troops - lost);
    c.food = 0;
    c.loyal = clamp(c.loyal - 4, 0, 100);
    if (lost > 0) ev.push(`${cityName}에 군량이 떨어져 병사 ${lost}명이 흩어졌다.`);
  }

  // 인구
  const growth = (c.loyal - 45) / 1800 + (c.land / k.land) * 0.004;
  c.pop = clamp(Math.round(c.pop * (1 + growth)), 1000, k.pop);

  // 민심은 천천히 제자리로 — 태수가 없으면 떨어진다
  const drift = c.governor >= 0 ? 0.6 : -1.2;
  c.loyal = clamp(c.loyal + drift, 0, 100);

  // 병력·사기·훈련도는 손대지 않으면 서서히 무뎌진다
  c.train = clamp(c.train - 0.5, 0, 100);
  c.morale = clamp(c.morale + (c.loyal > 60 ? 0.4 : -0.6), 0, 100);

  // 재해
  ev.push(...disasters(st, c, rng));

  return ev.filter(Boolean);
}

function disasters(st, c, rng) {
  const ev = [];
  const k = caps(c);
  const name = info(c).name;
  const m = st.month;

  // 수해 — 치수가 낮을수록. 여름 장마철.
  if (m >= 6 && m <= 8) {
    const risk = 0.11 * (1 - c.flood / k.flood);
    if (rng.chance(risk)) {
      const dmg = 0.10 + rng.next() * 0.12;
      c.pop = Math.round(c.pop * (1 - dmg * 0.5));
      c.land = Math.round(c.land * (1 - dmg));
      c.food = Math.round(c.food * (1 - dmg));
      c.loyal = clamp(c.loyal - 8, 0, 100);
      ev.push(`${name}에 큰물이 져 농지와 백성이 상했다.`);
    }
  }
  // 가뭄
  if (m >= 4 && m <= 7) {
    const risk = 0.06 * (1 - c.flood / k.flood * 0.5);
    if (rng.chance(risk)) {
      c.food = Math.round(c.food * 0.78);
      c.loyal = clamp(c.loyal - 6, 0, 100);
      ev.push(`${name}에 가뭄이 들어 곡식이 말랐다.`);
    }
  }
  // 메뚜기
  if (m >= 7 && m <= 9 && rng.chance(0.035)) {
    c.food = Math.round(c.food * 0.7);
    c.loyal = clamp(c.loyal - 5, 0, 100);
    ev.push(`${name}에 황충이 날아들어 곡식을 갉아먹었다.`);
  }
  // 역병 — 인구가 많고 민심이 나쁠수록
  if (rng.chance(0.018 * (c.pop / k.pop) * (1.6 - c.loyal / 100))) {
    const dmg = 0.06 + rng.next() * 0.08;
    c.pop = Math.round(c.pop * (1 - dmg));
    c.troops = Math.round(c.troops * (1 - dmg * 0.7));
    c.loyal = clamp(c.loyal - 7, 0, 100);
    ev.push(`${name}에 역병이 돌았다.`);
  }
  // 유민 유입 — 민심이 좋으면
  if (c.loyal > 78 && rng.chance(0.05)) {
    const add = Math.round(c.pop * 0.03);
    c.pop = clamp(c.pop + add, 0, k.pop);
    ev.push(`${name}의 다스림을 듣고 유민이 흘러들었다.`);
  }
  // 폭동 — 민심이 바닥이면
  if (c.loyal < 22 && c.faction !== NEUTRAL && rng.chance(0.14)) {
    const lost = Math.round(c.troops * 0.12);
    c.troops = Math.max(0, c.troops - lost);
    c.gold = Math.round(c.gold * 0.85);
    c.loyal = clamp(c.loyal + 6, 0, 100);
    ev.push(`${name}에서 백성이 들고일어났다!`);
  }
  return ev;
}

/* ─────────────────────────── 내정 실행값 ─────────────────────────── */

/** 내정 커맨드 1회 상승폭 — 정치력이 핵심, 상한에 가까울수록 둔해진다 */
export function devGain(o, cur, cap, invest) {
  const room = 1 - cur / cap;                       // 상한에 붙을수록 0
  const eff = (o.pol * 0.75 + o.int * 0.25) / 100;  // 0 ~ 1
  const money = invest / 100;                       // 투입 금 100 당 1
  return Math.max(1, Math.round(12 * eff * money * (0.35 + room * 0.65)));
}

/** 순찰(민심) 상승폭 — 매력 */
export function patrolGain(o, cur) {
  const room = 1 - cur / 100;
  return Math.max(1, Math.round((o.cha * 0.7 + o.pol * 0.3) / 9 * (0.4 + room * 0.6)));
}

/** 훈련 상승폭 — 육지 지휘 */
export function trainGain(o, cur) {
  const room = 1 - cur / 100;
  return Math.max(1, Math.round((o.lead * 0.7 + o.war * 0.3) / 9 * (0.4 + room * 0.6)));
}

/** 징병 가능 인원 — 인구·민심·매력. o 는 원본 무장 데이터. */
export function conscriptMax(c, o) {
  const byPop = Math.floor(c.pop * 0.02 * (c.loyal / 100));
  const byCha = Math.floor(o.cha * 120);
  const room = troopCap(c) - c.troops;
  return Math.max(0, Math.min(byPop, byCha, room));
}

/** 징병 비용 — 병사 1명당 금 0.08, 민심 하락은 커맨드 쪽에서 */
export const conscriptCost = (n) => Math.round(n * 0.08);
