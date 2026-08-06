// 게임 상태 — 시나리오에서 만들고, 세이브/로드하고, 조회한다.
//
// 상태는 순수 데이터(JSON 직렬화 가능)만 담는다. 원본 무장/도시 데이터는
// data/ 에 있고, 여기서는 id 로만 참조한다.

import { CITIES, cityCaps, ADJ } from '../data/cities.js';
import { OFFICERS, OFFICER_BY_NAME, findOfficer } from '../data/officers.js';
import { HOME_OF } from '../data/hometowns.js';
import { SCENARIO_BY_ID, SCENARIOS } from '../data/scenarios.js';
import { makeRng } from '../core/rng.js';
import { clamp, affinityGap } from '../core/util.js';

export const NEUTRAL = -1;   // 공백지 / 재야

/* ────────────────────────────── 새 게임 ────────────────────────────── */

export function newGame(scenarioId, playerFactionIdx, seed = 20260806) {
  const sc = SCENARIO_BY_ID[scenarioId];
  if (!sc) throw new Error(`알 수 없는 시나리오: ${scenarioId}`);
  const rng = makeRng(seed);

  const st = {
    scenarioId,
    seed,
    year: sc.year,
    month: sc.month,
    turn: 0,
    player: playerFactionIdx,
    factions: [],
    cities: [],
    officers: [],
    log: [],
    /** 이번 달 플레이어에게 보여줄 보고 */
    reports: [],
    battle: null,
    over: null,
  };

  // ── 세력 ──
  sc.factions.forEach((f, i) => {
    st.factions.push({
      id: i,
      name: f.name,
      color: f.color,
      rulerName: f.ruler,
      ruler: -1,          // officer id — 아래에서 채운다
      alive: true,
      allies: [],         // 동맹 세력 id
      truce: {},          // fid -> 남은 개월
      relation: {},       // fid -> -100(적대) ~ 100(우호)
      fame: 0,            // 명성 — 등용·외교에 쓰인다
    });
  });

  // ── 도시 ──
  const ownerOf = new Array(CITIES.length).fill(NEUTRAL);
  sc.factions.forEach((f, i) => f.cities.forEach((c) => { ownerOf[c] = i; }));

  CITIES.forEach((c) => {
    const cap = cityCaps(c.size);
    const owned = ownerOf[c.id] !== NEUTRAL;
    const dev = owned ? 0.34 + rng.next() * 0.24 : 0.22 + rng.next() * 0.14;
    const mil = owned ? 0.30 + rng.next() * 0.25 : 0.10 + rng.next() * 0.08;
    st.cities.push({
      id: c.id,
      faction: ownerOf[c.id],
      land:  Math.round(cap.land  * dev),
      flood: Math.round(cap.flood * dev * 0.9),
      comm:  Math.round(cap.comm  * dev),
      tech:  Math.round(cap.tech  * dev * 0.8),
      wall:  Math.round(cap.wall  * (owned ? 0.45 + rng.next() * 0.25 : 0.3)),
      pop:   Math.round(cap.pop   * (0.42 + rng.next() * 0.22)),
      loyal: owned ? rng.range(55, 80) : rng.range(40, 60),
      gold:  Math.round((owned ? 1500 : 400) * (0.6 + rng.next())),
      food:  Math.round(cap.pop * 0.12 * (0.6 + rng.next() * 0.8)),
      troops: Math.min(Math.round(cap.troops * mil), Math.floor(cap.pop * 0.42 / 6)),
      train: owned ? rng.range(45, 70) : rng.range(25, 45),
      morale: owned ? rng.range(50, 75) : rng.range(35, 55),
      governor: -1,       // 태수 officer id
      order: null,        // 위임 방침
    });
  });

  // ── 무장 ──
  // 시나리오 연도에 만 16세 이상이고 아직 살아 있는 무장만 등장한다.
  // 사망 연도 당해에는 살아 있는 것으로 본다 — 장각(184년 몰)이 184 시나리오에 서야 하므로.
  const alive = (o) => sc.year >= o.born + 16 && sc.year <= o.died;
  const assigned = new Map();   // officer name -> { fid, city }

  sc.factions.forEach((f, i) => {
    const capital = f.cities[0];
    const pinned = new Set();
    // at 에 명시된 배치 먼저
    for (const [cidStr, names] of Object.entries(f.at || {})) {
      const cid = +cidStr;
      if (!f.cities.includes(cid)) continue;
      for (const n of names) {
        if (!OFFICER_BY_NAME[n]) throw new Error(`시나리오 ${sc.id} at.${cid}: 알 수 없는 무장 ${n}`);
        if (!alive(OFFICER_BY_NAME[n])) continue;
        assigned.set(n, { fid: i, city: cid });
        pinned.add(n);
      }
    }
    // 나머지는 수도부터 고르게
    const rest = f.officers.filter((n) => !pinned.has(n));
    let k = 0;
    for (const n of rest) {
      if (!OFFICER_BY_NAME[n]) throw new Error(`시나리오 ${sc.id} ${f.ruler}군: 알 수 없는 무장 ${n}`);
      if (assigned.has(n)) continue;
      if (!alive(OFFICER_BY_NAME[n])) continue;
      const city = n === f.ruler ? capital : f.cities[k++ % f.cities.length];
      assigned.set(n, { fid: i, city });
    }
  });

  // 자동 소속 — 고향이 어느 세력 땅이고 상성이 맞으면 그 세력의 무장이 된다
  if (sc.autoJoin) {
    for (const o of OFFICERS) {
      if (assigned.has(o.name) || !alive(o)) continue;
      const home = HOME_OF[o.name];
      if (home === undefined) continue;
      const fid = ownerOf[home];
      if (fid === NEUTRAL) continue;
      const ruler = OFFICER_BY_NAME[sc.factions[fid].ruler];
      if (ruler && affinityGap(o.comp, ruler.comp) <= 35) assigned.set(o.name, { fid, city: home });
    }
  }

  for (const o of OFFICERS) {
    if (!alive(o)) continue;
    const a = assigned.get(o.name);
    const home = HOME_OF[o.name];
    const city = a ? a.city : (home !== undefined ? home : 10);
    const fid = a ? a.fid : NEUTRAL;
    st.officers.push({
      id: o.id,
      faction: fid,
      city,
      loyalty: 0,       // 아래에서 계산
      acted: false,
      status: 'normal', // normal | captive
      captiveOf: -1,
      troops: 0,        // 출진 중일 때만
      treasures: [],
      merit: 0,         // 공적
    });
  }

  // 군주 지정 + 충성도
  st.factions.forEach((f) => {
    const ro = OFFICER_BY_NAME[f.rulerName];
    const rs = ro && st.officers.find((x) => x.id === ro.id);
    if (rs) { f.ruler = ro.id; rs.loyalty = 100; }
  });
  // 군주가 시나리오 연도에 없으면(요절 등) 그 세력의 최고 능력자로 대체
  st.factions.forEach((f) => {
    if (f.ruler >= 0) return;
    const mine = st.officers.filter((s) => s.faction === f.id);
    if (!mine.length) { f.alive = false; return; }
    mine.sort((a, b) => base(b).cha - base(a).cha);
    f.ruler = mine[0].id;
    f.rulerName = base(mine[0]).name;
    mine[0].loyalty = 100;
  });

  for (const s of st.officers) {
    if (s.faction === NEUTRAL) { s.loyalty = 0; continue; }
    const f = st.factions[s.faction];
    if (s.id === f.ruler) { s.loyalty = 100; continue; }
    s.loyalty = initialLoyalty(base(s), OFFICERS[f.ruler], rng);
  }

  // 태수 — 각 도시에서 가장 유능한 무장
  for (const c of st.cities) {
    if (c.faction === NEUTRAL) continue;
    const here = st.officers.filter((s) => s.faction === c.faction && s.city === c.id);
    if (!here.length) continue;
    const ruler = here.find((s) => s.id === st.factions[c.faction].ruler);
    c.governor = (ruler || here.sort((a, b) => govScore(b) - govScore(a))[0]).id;
  }

  // 세력이 없어진 경우 정리
  st.factions.forEach((f) => {
    if (!st.cities.some((c) => c.faction === f.id)) f.alive = false;
  });

  st.seed = rng.seed;
  return st;
}

function govScore(s) {
  const o = base(s);
  return o.pol * 1.2 + o.lead + o.int * 0.8 + o.cha;
}

function initialLoyalty(o, ruler, rng) {
  const gap = affinityGap(o.comp, ruler.comp);          // 0~74
  const base0 = 92 - gap * 0.62;                        // 상성이 멀수록 낮게
  const bias = (o.duty - o.amb) * 1.4;                  // 의리 높고 야망 낮으면 +
  return clamp(Math.round(base0 + bias + rng.range(-4, 4)), 25, 100);
}

/* ────────────────────────────── 조회 ────────────────────────────── */

/** 무장 상태 -> 원본 데이터 */
export const base = (s) => OFFICERS[s.id];

export const officerState = (st, id) => st.officers.find((s) => s.id === id);
export const officerName = (id) => OFFICERS[id]?.name ?? '?';

export function officersIn(st, cityId) {
  return st.officers.filter((s) => s.city === cityId && s.status === 'normal');
}
export function membersIn(st, cityId, fid) {
  return st.officers.filter((s) => s.city === cityId && s.faction === fid && s.status === 'normal');
}
export function freeIn(st, cityId) {
  return st.officers.filter((s) => s.city === cityId && s.faction === NEUTRAL && s.status === 'normal');
}
export function captivesIn(st, cityId) {
  return st.officers.filter((s) => s.city === cityId && s.status === 'captive');
}
export function factionCities(st, fid) {
  return st.cities.filter((c) => c.faction === fid);
}
export function factionOfficers(st, fid) {
  return st.officers.filter((s) => s.faction === fid && s.status === 'normal');
}
export function rulerOf(st, fid) {
  return st.factions[fid] ? officerState(st, st.factions[fid].ruler) : null;
}

/**
 * 살아 있는 세력의 군주인가.
 * 군주는 사로잡아도 등용할 수 없다 — 목을 베거나 놓아주는 수밖에 없다.
 * 다만 그 세력이 무너지면 군주가 아니게 되므로 그때는 거둘 수 있다.
 */
export function isRulerOf(st, s) {
  if (!s || s.faction === NEUTRAL) return false;
  const f = st.factions[s.faction];
  return !!f && f.alive && f.ruler === s.id;
}
export const isPlayer = (st, fid) => fid === st.player;

/** 세력 총합 국력 — 순위·AI 판단·승리 판정에 쓴다 */
export function power(st, fid) {
  const cs = factionCities(st, fid);
  const troops = cs.reduce((a, c) => a + c.troops, 0);
  const gold = cs.reduce((a, c) => a + c.gold, 0);
  const offs = factionOfficers(st, fid);
  return Math.round(cs.length * 1000 + troops / 10 + gold / 50 + offs.length * 120);
}

/** 인접 도시 id — 수로 포함 */
export function neighbors(cityId) { return ADJ[cityId]; }

/** 어떤 세력의 도시와 인접한 적/공백 도시 목록 */
export function frontiers(st, fid) {
  const out = new Set();
  for (const c of st.cities) {
    if (c.faction !== fid) continue;
    for (const { to } of ADJ[c.id]) if (st.cities[to].faction !== fid) out.add(to);
  }
  return [...out];
}

export function isAllied(st, a, b) {
  if (a === b) return true;
  return st.factions[a]?.allies.includes(b);
}

/* ────────────────────────────── 세이브 ────────────────────────────── */

const SAVE_KEY = 'sam3.save';

export function serialize(st) { return JSON.stringify(st); }

export function deserialize(json) {
  const st = JSON.parse(json);
  if (!st.scenarioId || !Array.isArray(st.cities)) throw new Error('세이브 형식이 아니다');
  return st;
}

export function saveLocal(st, slot = 1) {
  localStorage.setItem(`${SAVE_KEY}.${slot}`, serialize(st));
}
export function loadLocal(slot = 1) {
  const raw = localStorage.getItem(`${SAVE_KEY}.${slot}`);
  return raw ? deserialize(raw) : null;
}
export function saveSlots() {
  return [1, 2, 3].map((slot) => {
    const raw = localStorage.getItem(`${SAVE_KEY}.${slot}`);
    if (!raw) return { slot, empty: true };
    try {
      const st = JSON.parse(raw);
      const sc = SCENARIO_BY_ID[st.scenarioId];
      return {
        slot, empty: false, year: st.year, month: st.month,
        title: sc ? sc.title : st.scenarioId,
        faction: st.factions[st.player]?.name ?? '?',
        cities: st.cities.filter((c) => c.faction === st.player).length,
      };
    } catch { return { slot, empty: true, broken: true }; }
  });
}
export function deleteSlot(slot) { localStorage.removeItem(`${SAVE_KEY}.${slot}`); }

export { SCENARIOS, findOfficer };
