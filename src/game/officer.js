// 무장 — 충성도, 등용, 포상, 배신, 탐색, 계략 판정.

import { OFFICERS, OFFICER_BY_NAME, overall } from '../data/officers.js';
import { HOME_OF } from '../data/hometowns.js';
import { affinityGap, clamp } from '../core/util.js';
import { base, NEUTRAL, officerState, factionOfficers, membersIn } from './state.js';
import { TREASURES, treasureBonus } from '../data/treasures.js';

export const age = (o, year) => year - o.born;

/**
 * 실제 능력치 = 타고난 값 + **자란 값** + 보물 보정.
 * 전투·내정·판정은 전부 이 값을 쓴다. s 는 무장 상태(state.officers 의 원소).
 */
export function eff(s) {
  const o = base(s);
  const b = treasureBonus(s.treasures);
  const g = s.growth || EMPTY_GROWTH;
  const v = (k) => clamp(o[k] + (g[k] || 0) + b[k], 1, 100);
  return {
    ...o,
    lead: v('lead'), navy: v('navy'), war: v('war'),
    int: v('int'), pol: v('pol'), cha: v('cha'),
    mount: b.mount > 0,
  };
}

const EMPTY_GROWTH = Object.freeze({});
export const GROWABLE = ['lead', 'navy', 'war', 'int', 'pol', 'cha'];
export const STAT_NAME = { lead: '육지', navy: '수지', war: '무력', int: '지력', pol: '정치', cha: '매력' };

/** 타고난 값 + 자란 값 (보물 제외) — 성장 판정에 쓴다 */
const grown = (s, k) => base(s)[k] + ((s.growth || EMPTY_GROWTH)[k] || 0);

/**
 * 해가 바뀔 때의 성장. 매년 1월에 한 번 돈다.
 *
 * 눈금: **무장 하나가 10년에 능력 5쯤** 오르게 잡았다 — 해마다 0.5.
 * 한 번 오를 때 1씩 올리므로 성장 확률의 평균이 0.5여야 한다.
 * 젊을수록 잘 자라고 늙으면 더디다. 아래 나이별 확률의 평균이 대략 0.5가 된다.
 *
 * 이미 100인 항목은 건너뛴다. 타고난 값이 낮은 항목이 조금 더 잘 오른다 —
 * 못 하는 것을 익히는 편이 자연스럽고, 강한 무장만 계속 강해지는 것도 막는다.
 */
export function annualGrowth(st, rng) {
  const grew = [];
  for (const s of st.officers) {
    if (s.status !== 'normal') continue;
    const o = base(s);
    const age = st.year - o.born;
    const p = age < 25 ? 0.85 : age < 35 ? 0.62 : age < 45 ? 0.42 : age < 55 ? 0.26 : 0.12;
    if (!rng.chance(p)) continue;

    // 오를 수 있는 항목 중에서 고른다. 낮은 항목에 가중치를 준다.
    const pool = [];
    for (const k of GROWABLE) {
      const cur = grown(s, k);
      if (cur >= 100) continue;
      const w = 1 + Math.floor((100 - cur) / 25);   // 1~4
      for (let i = 0; i < w; i++) pool.push(k);
    }
    if (!pool.length) continue;

    const k = rng.pick(pool);
    if (!s.growth) s.growth = {};
    s.growth[k] = (s.growth[k] || 0) + 1;
    grew.push({ state: s, officer: o, stat: k, to: grown(s, k) });
  }
  return grew;
}

/** 은자·방사·의원은 벼슬에 뜻이 없다 */
export const isHermit = (o) => o.tags.some((t) => t === '방사' || t === '의원') || (o.amb <= 2 && o.int >= 88);

/* ─────────────────────────── 충성도 ─────────────────────────── */

/** 매월 충성도 표류. 군주와 상성이 맞으면 오르고, 야망가는 떨어진다. */
export function loyaltyDrift(st, s) {
  if (s.faction === NEUTRAL) return 0;
  const f = st.factions[s.faction];
  if (s.id === f.ruler) return 0;
  const o = base(s);
  const ruler = OFFICERS[f.ruler];
  if (!ruler) return 0;
  const gap = affinityGap(o.comp, ruler.comp);
  let d = (32 - gap) * 0.035 + (o.duty - o.amb) * 0.09;
  if (s.loyalty > 90) d -= 0.25;               // 꼭대기에선 잘 안 오른다
  return d;
}

/** 포상 — 금을 내려 충성을 산다. 돌려주는 값은 실제 상승폭. */
export function rewardGain(o, gold, curLoyalty) {
  const room = 100 - curLoyalty;
  const raw = Math.sqrt(gold) * 0.62 * (0.7 + o.amb / 22);
  return clamp(Math.round(Math.min(raw, room)), 0, 30);
}

/** 보물 하사 */
export function treasureGain(o, treasure) {
  return clamp(Math.round(treasure.value / 8 * (0.8 + o.amb / 20)), 3, 40);
}

/* ─────────────────────────── 등용 ─────────────────────────── */

/**
 * 등용 성공률(%). target 이 재야면 그냥 부르는 것이고,
 * 남의 세력 무장이면 빼내는 것이라 훨씬 어렵다.
 */
export function recruitChance(st, fid, persuaderState, targetState) {
  const f = st.factions[fid];
  const ruler = OFFICERS[f.ruler];
  const t = base(targetState);
  const p = persuaderState ? eff(persuaderState) : ruler;
  if (!ruler) return 0;

  const gap = affinityGap(t.comp, ruler.comp);
  let ch = 48 - gap * 0.78;
  ch += (p.cha - 55) * 0.34;
  ch += (p.int - 55) * 0.10;
  ch += f.fame * 0.14;
  ch += (t.amb - t.duty) * 1.5;

  if (targetState.faction === NEUTRAL) {
    if (isHermit(t)) ch -= 45;                       // 은자는 좀처럼 나오지 않는다
    if (targetState.captiveOf >= 0) ch += 12;
  } else {
    ch -= 24 + targetState.loyalty * 0.85;           // 섬기는 주인이 있다
    if (st.factions[targetState.faction].ruler === targetState.id) return 0;
  }
  // 같은 성씨 군주 밑의 황족은 잘 안 움직인다
  if (t.tags.includes('황족')) ch -= 10;
  return clamp(Math.round(ch), 1, 96);
}

/** 포로 처분 — 참수/석방/등용 */
export function executeEffect(st, fid, victimState) {
  const v = base(victimState);
  const f = st.factions[fid];
  f.fame = clamp(f.fame - Math.round(v.cha / 12), -60, 200);
  // 같은 세력 무장들이 냉혹함을 보고 충성이 흔들린다
  for (const s of factionOfficers(st, fid)) {
    if (base(s).duty >= 11) s.loyalty = clamp(s.loyalty - 2, 0, 100);
  }
}
export function releaseEffect(st, fid, victimState) {
  const v = base(victimState);
  st.factions[fid].fame = clamp(st.factions[fid].fame + Math.round(v.cha / 20), -60, 200);
}

/* ─────────────────────────── 배신 ─────────────────────────── */

/**
 * 매월 배신 판정. 배신하면 어떤 형태인지 돌려준다.
 *   null | { kind: '이탈' } | { kind: '모반', to: fid }
 */
export function defectionCheck(st, s, rng) {
  if (s.faction === NEUTRAL || s.status !== 'normal') return null;
  const f = st.factions[s.faction];
  if (s.id === f.ruler) return null;
  const o = base(s);
  if (s.loyalty >= 62) return null;

  const pressure = (62 - s.loyalty) * 0.6 + (o.amb - o.duty) * 1.4;
  if (pressure <= 0) return null;
  if (!rng.chance(pressure / 900)) return null;

  // 태수라면 성째로 넘어가거나 자립한다
  const c = st.cities[s.city];
  const isGov = c.governor === s.id;
  if (isGov && o.amb >= 11 && rng.chance(0.4)) return { kind: '자립' };

  // 상성이 더 맞는 이웃 세력이 있으면 그리로
  const cand = [];
  for (const nb of st.cities) {
    if (nb.faction === NEUTRAL || nb.faction === s.faction) continue;
    const r2 = OFFICERS[st.factions[nb.faction].ruler];
    if (!r2) continue;
    const g = affinityGap(o.comp, r2.comp);
    if (g < 30) cand.push({ fid: nb.faction, g });
  }
  if (cand.length) {
    cand.sort((a, b) => a.g - b.g);
    return { kind: isGov ? '모반' : '이탈', to: cand[0].fid };
  }
  return { kind: '이탈' };
}

/* ─────────────────────────── 탐색 ─────────────────────────── */

/** 탐색 — 그 도시의 재야 무장 하나를 찾아낸다. 못 찾으면 null 또는 보물. */
export function search(st, cityId, searcherState, rng) {
  const o = base(searcherState);
  const hidden = st.officers.filter(
    (s) => s.city === cityId && s.faction === NEUTRAL && s.status === 'normal' && !s.found,
  );
  const p = 26 + o.int * 0.25 + o.cha * 0.16;
  if (hidden.length && rng.pct(p)) {
    // 능력 높은 쪽이 더 늦게 발견된다
    hidden.sort((a, b) => overall(base(a)) - overall(base(b)));
    const pick = hidden[Math.min(hidden.length - 1, Math.floor(Math.pow(rng.next(), 1.7) * hidden.length))];
    pick.found = true;
    return { kind: '인재', officer: pick };
  }
  if (rng.pct(6 + o.int * 0.05)) {
    const owned = new Set(st.officers.flatMap((s) => s.treasures));
    const pool = TREASURES.filter((t) => !owned.has(t.id));
    if (pool.length) return { kind: '보물', treasure: rng.pick(pool) };
  }
  return null;
}

/* ─────────────────────────── 계략 ─────────────────────────── */

/**
 * 전략 화면 계략의 성공률.
 * kind: 유언비어(적 무장 충성 ↓) / 이간(적 무장 이탈) / 선동(적 도시 민심 ↓) / 매수(적 도시 금 강탈)
 */
export function plotChance(st, kind, actorState, target) {
  const a = eff(actorState);
  let ch = a.int * 0.55 - 12;
  if (kind === '유언비어') ch += 14;
  if (kind === '이간') ch -= 10;
  if (kind === '선동') ch += 6;
  if (kind === '매수') ch -= 4;

  if (target.type === 'officer') {
    const t = base(target.state);
    ch -= t.int * 0.28;
    ch -= target.state.loyalty * 0.30;
    ch += (t.amb - t.duty) * 1.1;
  } else {
    const c = target.city;
    ch -= c.loyal * 0.32;
    const gov = c.governor >= 0 ? OFFICERS[c.governor] : null;
    if (gov) ch -= gov.int * 0.18;
  }
  return clamp(Math.round(ch), 2, 88);
}

/* ─────────────────────────── 신규 등장·사망 ─────────────────────────── */

/** 그 해에 만 16세가 된 무장을 재야로 등장시킨다 */
export function debutOfficers(st) {
  const out = [];
  for (const o of OFFICERS) {
    if (o.born + 16 !== st.year) continue;
    if (st.officers.some((s) => s.id === o.id)) continue;
    if (st.year >= o.died) continue;
    const home = HOME_OF[o.name];
    st.officers.push({
      id: o.id, faction: NEUTRAL, city: home === undefined ? 10 : home,
      loyalty: 0, acted: false, status: 'normal', captiveOf: -1,
      troops: 0, treasures: [], merit: 0,
    });
    out.push(o);
  }
  return out;
}

/** 수명이 다한 무장을 거둔다 */
export function ageDeaths(st, rng) {
  const dead = [];
  for (const s of [...st.officers]) {
    const o = base(s);
    if (st.year < o.died) continue;
    // 역사 사망년에 도달하면 그 해 안에 죽는다 — 달은 무작위(지금 달 이후로)
    if (!s.deathMonth) s.deathMonth = rng.range(Math.max(1, st.month), 12);
    if (st.month < s.deathMonth) continue;
    dead.push({ officer: o, state: s });
  }
  return dead;
}

export { OFFICER_BY_NAME, overall };
