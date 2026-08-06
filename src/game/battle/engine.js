// 헥스 전투 — 부대 편성, 이동, 공격, 계략, 일기토, 승패 처리.
//
// 하루(턴)에 공격측 → 방어측 순으로 움직인다. 최대 30일.
// 부대 하나는 이동 + 행동 하나. 행동은 공격/계략/일기토/설전/대기 중 하나.

import { CITIES } from '../../data/cities.js';
import { OFFICERS } from '../../data/officers.js';
import { clamp, num, iga, eul, eun, euro } from '../../core/util.js';
import { rng } from '../../core/rng.js';
import { base, NEUTRAL, officerState, membersIn } from '../state.js';
import { weaponBonus, wallBonus, info, caps } from '../city.js';
import { eff } from '../officer.js';
import {
  makeBattleMap, TERRAIN, axial, hexDistance, neighborsOf, reachable, pathTo, moveCost,
  isWall, breach, W, H,
} from './map.js';

export const UNIT_TYPES = {
  보병: { mp: 4, desc: '단단하다. 산과 숲에서 잘 버틴다.' },
  기병: { mp: 7, desc: '멀리 달린다. 평지에서 강하다.' },
  궁병: { mp: 4, range: 2, desc: '두 칸 밖에서 쏜다. 반격을 받지 않는다.' },
  수군: { mp: 6, desc: '물 위에서만 제 힘을 낸다.' },
};

export const MAX_UNITS = 6;
export const MAX_DAYS = 30;

/* ─────────────────────────── 편성과 개전 ─────────────────────────── */

/**
 * 출진. picks = [{ officerId, troops, type }]
 * @returns battle 객체 (또는 { error })
 */
export function startBattle(st, fromCityId, toCityId, picks) {
  const from = st.cities[fromCityId];
  const to = st.cities[toCityId];
  const attFid = from.faction;
  const defFid = to.faction;
  if (attFid === defFid) return { error: '아군 도시다' };
  if (!picks.length) return { error: '출진할 부대가 없다' };

  const total = picks.reduce((a, p) => a + p.troops, 0);
  if (total > from.troops) return { error: '병력이 모자라다' };
  const foodNeed = Math.round(total * 1.0);   // 한 달치 원정 군량
  if (from.food < foodNeed) return { error: `군량이 모자라다 (${num(foodNeed)}석 필요)` };

  const naval = picks.every((p) => p.type === '수군');
  const map = makeBattleMap(toCityId, true, naval);

  const battle = {
    cityId: toCityId, fromCityId, naval,
    attFid, defFid,
    map,
    units: [],
    day: 1,
    side: 'A',
    log: [],
    over: null,
    playerSide: st.player === attFid ? 'A' : (st.player === defFid ? 'D' : null),
    spoils: null,
  };

  // 공격군
  from.troops -= total;
  from.food -= foodNeed;
  const attWeapon = weaponBonus(from);
  picks.forEach((p, i) => {
    const s = officerState(st, p.officerId);
    s.acted = true;
    battle.units.push(makeUnit(battle, 'A', s, p.troops, p.type, from, attWeapon, i));
  });

  // 방어군 — 그 도시에 있는 무장으로 자동 편성
  const defenders = membersIn(st, toCityId, defFid).slice(0, MAX_UNITS);
  const defWeapon = weaponBonus(to);
  if (defenders.length === 0) {
    // 무장이 없는 성 — 병사만 남은 수비대
    battle.units.push({
      ...blankUnit(), id: 'D0', side: 'D', officerId: -1, name: '수비대',
      troops: Math.max(200, to.troops), maxTroops: Math.max(200, to.troops),
      morale: to.morale, train: to.train, type: '보병', weapon: defWeapon,
    });
  } else {
    const share = Math.floor(to.troops / defenders.length);
    defenders.forEach((s, i) => {
      const o = eff(s);
      const type = naval ? '수군' : (o.war >= 78 && o.lead >= 70 ? '기병' : o.int >= 76 ? '궁병' : '보병');
      battle.units.push(makeUnit(battle, 'D', s, share, type, to, defWeapon, i));
    });
  }
  to.troops = 0;

  battle.__defCity = to;
  // 성벽의 두께는 그 도시의 성벽 수치를 따른다
  const wq = to.wall / caps(to).wall;
  for (const t of Object.values(map.tiles)) {
    if (!isWall(t)) continue;
    t.maxHp = Math.round((t.terr === '성문' ? 90 : 150) * (0.6 + wq * 1.1));
    t.hp = t.maxHp;
  }
  placeUnits(battle);
  battle.log.push(`${info(from).name}의 ${num(total)} 군세가 ${euro(info(to).name)} 밀려든다.`);
  return battle;
}

function blankUnit() {
  return {
    q: 0, r: 0, mp: 0, moved: false, acted: false,
    status: 'ok', confusedFor: 0, retreatFor: 0, dead: false, tactics: 2,
  };
}

function makeUnit(battle, side, s, troops, type, city, weapon, idx) {
  const o = eff(s);
  return {
    ...blankUnit(),
    id: `${side}${idx}`,
    side,
    officerId: s.id,
    name: o.name,
    troops: Math.max(0, Math.round(troops)),
    maxTroops: Math.max(1, Math.round(troops)),
    morale: clamp(city.morale + (o.cha - 55) * 0.2, 20, 100),
    train: city.train,
    type,
    weapon,
    stat: { lead: o.lead, navy: o.navy, war: o.war, int: o.int, cha: o.cha },
    tactics: o.int >= 85 ? 4 : o.int >= 70 ? 3 : o.int >= 50 ? 2 : 1,
  };
}

function placeUnits(battle) {
  const put = (list, zone) => {
    const spots = zone.filter((t) => !t.unit).sort((a, b) => a.row - b.row);
    const mid = Math.floor(spots.length / 2);
    const order = [];
    for (let i = 0; i < spots.length; i++) {
      order.push(spots[mid + (i % 2 ? Math.ceil(i / 2) : -Math.ceil(i / 2))]);
    }
    let i = 0;
    for (const u of list) {
      while (i < order.length && (!order[i] || order[i].unit)) i++;
      const t = order[i] || spots.find((x) => !x.unit);
      if (!t) break;
      t.unit = u; u.q = t.q; u.r = t.r;
      i++;
    }
  };
  put(battle.units.filter((u) => u.side === 'A'), battle.map.attackerZone);
  put(battle.units.filter((u) => u.side === 'D'), battle.map.defenderZone);
}

export const tileOf = (battle, u) => battle.map.tiles[axial(u.q, u.r)];
export const unitsOf = (battle, side) => battle.units.filter((u) => u.side === side && !u.dead);
export const aliveUnits = (battle) => battle.units.filter((u) => !u.dead);

/* ─────────────────────────── 하루의 흐름 ─────────────────────────── */

export function beginSide(battle, side) {
  battle.side = side;
  for (const u of unitsOf(battle, side)) {
    u.mp = UNIT_TYPES[u.type].mp + (u.train >= 80 ? 1 : 0);
    u.moved = false;
    u.acted = false;
    if (u.confusedFor > 0) { u.confusedFor--; u.acted = true; u.mp = 0; }
  }
}

/** 한 측의 행동이 끝났을 때 */
export function endSide(battle) {
  if (battle.side === 'A') { beginSide(battle, 'D'); return 'D'; }
  endDay(battle);
  return 'A';
}

function endDay(battle) {
  // 불이 번지고 잦아든다
  const burning = Object.values(battle.map.tiles).filter((t) => t.fire > 0);
  for (const t of burning) {
    if (t.unit) {
      const dmg = Math.round(t.unit.troops * (0.05 + t.fire * 0.02));
      damage(battle, t.unit, dmg, '화염');
      t.unit.morale = clamp(t.unit.morale - 6, 0, 100);
    }
    t.fire--;
    if (t.fire > 0 && rng.chance(0.28)) {
      const nb = rng.pick(neighborsOf(battle.map, t.q, t.r));
      if (nb && (nb.terr === '숲' || nb.terr === '평지' || nb.terr === '가도') && !nb.fire) nb.fire = Math.max(1, t.fire - 1);
    }
  }
  // 사기 회복 — 훈련이 잘 된 군은 잘 버틴다
  for (const u of aliveUnits(battle)) {
    u.morale = clamp(u.morale + (u.train > 60 ? 1.5 : 0.6), 0, 100);
    if (u.retreatFor > 0) u.retreatFor--;
  }
  battle.day++;
  beginSide(battle, 'A');
  checkOver(battle);
}

export function checkOver(battle) {
  if (battle.over) return battle.over;
  const A = unitsOf(battle, 'A'), D = unitsOf(battle, 'D');
  if (!A.length) battle.over = { winner: 'D', reason: '공격군이 전멸했다' };
  else if (!D.length) battle.over = { winner: 'A', reason: '수비군이 전멸했다' };
  else if (battle.map.core && battle.map.core.unit && battle.map.core.unit.side === 'A')
    battle.over = { winner: 'A', reason: '본성이 떨어졌다' };
  else if (battle.day > MAX_DAYS) battle.over = { winner: 'D', reason: '기한이 다해 공격군이 물러났다' };
  return battle.over;
}

export function retreat(battle, side) {
  battle.over = { winner: side === 'A' ? 'D' : 'A', reason: `${side === 'A' ? '공격' : '수비'}군이 물러났다`, retreated: side };
  return battle.over;
}

/* ─────────────────────────── 이동 ─────────────────────────── */

export function moveOptions(battle, u) {
  if (u.mp <= 0 || u.moved) return {};
  return reachable(battle.map, u, u.mp, u);
}

export function moveUnit(battle, u, toTile) {
  const seen = moveOptions(battle, u);
  const k = axial(toTile.q, toTile.r);
  if (!seen[k]) return { ok: false, msg: '거기까지 갈 수 없다' };
  const cur = tileOf(battle, u);
  cur.unit = null;
  toTile.unit = u;
  u.q = toTile.q; u.r = toTile.r;
  u.mp -= seen[k].cost;
  if (u.mp <= 0) u.moved = true;
  // 불붙은 칸에 들어가면 탄다
  if (toTile.fire > 0) {
    damage(battle, u, Math.round(u.troops * 0.06), '화염');
    u.morale = clamp(u.morale - 5, 0, 100);
  }
  return { ok: true, path: pathTo(seen, toTile) };
}

/* ─────────────────────────── 공격 ─────────────────────────── */

export function canAttack(battle, u, target) {
  if (u.acted || u.dead || target.dead || u.side === target.side) return false;
  const d = hexDistance(u, target);
  const range = UNIT_TYPES[u.type].range || 1;
  return d <= range;
}

/* ─────────────────────────── 공성 ─────────────────────────── */

/** 성문·성벽을 칠 수 있는가 — 공격측만, 맞닿아 있을 때 */
export function canBreak(battle, u, tile) {
  if (!u || u.acted || u.dead || u.side !== 'A') return false;
  if (!isWall(tile) || tile.hp <= 0) return false;
  return hexDistance(u, tile) === 1;
}

/** 성벽 때리기. 병력이 많고 기술(무기)이 좋을수록 빨리 무너진다. */
export function breakWall(battle, u, tile) {
  if (!canBreak(battle, u, tile)) return { ok: false, msg: '칠 수 없다' };
  const war = u.stat ? u.stat.war : 50;
  const dmg = Math.max(4, Math.round(u.troops / 130 * u.weapon * (0.7 + war / 220)));
  tile.hp -= dmg;
  u.acted = true; u.moved = true;
  // 성벽에 붙으면 화살을 맞는다
  const back = Math.round(u.troops * 0.012);
  damage(battle, u, back, '공성');

  const name = tile.terr === '성문' ? '성문' : '성벽';
  const lines = [];
  if (tile.hp <= 0) {
    breach(tile);
    lines.push(`${iga(name)} 무너졌다!`);
    for (const d of unitsOf(battle, 'D')) d.morale = clamp(d.morale - 8, 0, 100);
  } else {
    lines.push(`${iga(u.name)} ${eul(name)} 두들긴다 — 남은 내구 ${tile.hp}/${tile.maxHp}`);
  }
  battle.log.push(...lines);
  checkOver(battle);
  return { ok: true, lines, broken: tile.hp <= 0 };
}

export function attack(battle, u, target) {
  if (!canAttack(battle, u, target)) return { ok: false, msg: '칠 수 없다' };
  const lines = [];
  const at = tileOf(battle, u), dt = tileOf(battle, target);
  const ranged = hexDistance(u, target) > 1;

  const ap = unitPower(battle, u, at, true, target, dt);
  const dp = unitPower(battle, target, dt, false, u, at);
  const ratio = clamp(ap / Math.max(1, dp), 0.40, 2.6);

  let lossDef = Math.round(u.troops * 0.062 * ratio * (0.85 + rng.next() * 0.3));
  if (ranged) lossDef = Math.round(lossDef * 0.62);
  lossDef = Math.min(lossDef, target.troops);

  let lossAtt = 0;
  if (!ranged) {
    lossAtt = Math.round(target.troops * 0.034 / ratio * (0.85 + rng.next() * 0.3));
    lossAtt = Math.min(lossAtt, u.troops - 1 < 0 ? 0 : Math.round(u.troops * 0.5));
  }

  damage(battle, target, lossDef, '전투');
  if (lossAtt) damage(battle, u, lossAtt, '전투');

  const swing = clamp(Math.round((ratio - 1) * 9 + 4), 1, 18);
  target.morale = clamp(target.morale - swing, 0, 100);
  u.morale = clamp(u.morale + Math.round(swing * 0.35), 0, 100);

  lines.push(`${iga(u.name)} ${eul(target.name)} 쳤다 — 적 ${num(lossDef)}, 아군 ${num(lossAtt)} 잃음`);

  // 사기가 꺾이면 무너진다
  if (target.morale <= 0 && !target.dead) {
    lines.push(`${iga(target.name)} 사기를 잃고 무너졌다!`);
    removeUnit(battle, target, '붕괴');
  }
  u.acted = true;
  u.moved = true;
  battle.log.push(...lines);
  checkOver(battle);
  return { ok: true, lines, lossDef, lossAtt };
}

/** 부대의 전투력 */
function unitPower(battle, u, tile, attacking, foe, foeTile) {
  const o = u.stat;
  const cmd = o ? (battle.naval || tile.terr === '강' ? o.navy : o.lead) : 45;
  const war = o ? o.war : 45;
  const T = TERRAIN[tile.terr];

  let p = u.troops
    * (0.35 + cmd / 155)
    * (0.55 + u.morale / 215)
    * (0.62 + u.train / 260)
    * u.weapon
    * (attacking ? T.atk : T.def);

  p *= 1 + (war - 55) / 420;

  // 병종 상성
  if (foe) {
    const m = typeMatch(u, foe, tile, foeTile);
    p *= m;
  }
  // 성벽 안에서 지키면 단단하다 — 다만 성문이 부서진 뒤에는 그 이점이 거의 사라진다
  if (!attacking && (tile.terr === '본성' || tile.terr === '성문' || tile.terr === '성벽')) {
    const breached = battle.map.gate ? battle.map.gate.hp <= 0 : true;
    const c = battle.__defCity;
    p *= breached ? 1.12 : (c ? wallBonus(c) : 1.3);
  }
  if (u.status === 'confused') p *= 0.6;
  return Math.max(1, p);
}

function typeMatch(u, foe, tile, foeTile) {
  let m = 1;
  const flat = tile.terr === '평지' || tile.terr === '가도' || tile.terr === '사막';
  if (u.type === '기병') {
    if (foe.type === '궁병') m *= 1.28;
    if (foe.type === '보병') m *= 1.06;
    m *= flat ? 1.14 : 0.9;
  } else if (u.type === '보병') {
    if (foe.type === '기병') m *= 1.18;
    if (tile.terr === '산' || tile.terr === '숲') m *= 1.1;
  } else if (u.type === '궁병') {
    if (foe.type === '보병') m *= 1.12;
    if (foe.type === '기병') m *= 0.92;
  } else if (u.type === '수군') {
    m *= tile.terr === '강' ? 1.32 : 0.68;
  }
  if (foe.type === '수군' && foeTile && foeTile.terr !== '강') m *= 1.2;
  return m;
}

function damage(battle, u, n, cause) {
  u.troops -= n;
  if (u.troops <= 0) {
    u.troops = 0;
    removeUnit(battle, u, cause);
  }
}

export function removeUnit(battle, u, cause) {
  if (u.dead) return;
  u.dead = true;
  const t = battle.map.tiles[axial(u.q, u.r)];
  if (t && t.unit === u) t.unit = null;
  u.cause = cause;
}

/* ─────────────────────────── 계략 ─────────────────────────── */

export const TACTICS = {
  화계: { need: '연소', range: 3, desc: '숲과 들에 불을 놓는다' },
  수계: { need: '강변', range: 3, desc: '둑을 터뜨려 물을 흘려보낸다' },
  낙석: { need: '산곁', range: 3, desc: '산 위에서 바위를 굴린다' },
  혼란: { need: null,   range: 3, desc: '적을 어지럽혀 한동안 움직이지 못하게 한다' },
  위보: { need: null,   range: 4, desc: '거짓 소식으로 적을 물러나게 한다' },
  설전: { need: '인접', range: 1, desc: '말로 꺾어 적의 사기를 무너뜨린다' },
};

export function tacticAvailable(battle, u, kind, targetTile) {
  const T = TACTICS[kind];
  if (!T) return false;
  if (u.acted || u.tactics <= 0) return false;
  if (hexDistance(u, targetTile) > T.range) return false;
  if (T.need === '연소') return ['숲', '평지', '가도', '사막'].includes(targetTile.terr) && !targetTile.fire;
  if (T.need === '강변') return neighborsOf(battle.map, targetTile.q, targetTile.r).some((t) => t.terr === '강') || targetTile.terr === '강';
  if (T.need === '산곁') return neighborsOf(battle.map, targetTile.q, targetTile.r).some((t) => t.terr === '산');
  if (T.need === '인접') return hexDistance(u, targetTile) === 1 && !!targetTile.unit;
  return true;
}

export function useTactic(battle, u, kind, targetTile) {
  if (!tacticAvailable(battle, u, kind, targetTile)) return { ok: false, msg: '지금은 쓸 수 없다' };
  const lines = [];
  const me = { int: u.stat ? u.stat.int : 40, name: u.name };
  const foe = targetTile.unit;
  const foeInt = foe && foe.stat ? foe.stat.int : 30;

  let ch = 34 + (me.int - foeInt) * 0.85;
  if (kind === '화계') ch += targetTile.terr === '숲' ? 16 : 4;
  if (kind === '설전') ch += 8;
  if (kind === '위보') ch -= 8;
  ch = clamp(Math.round(ch), 5, 92);

  u.acted = true; u.moved = true; u.tactics--;

  if (!rng.pct(ch)) {
    lines.push(`${me.name}의 ${iga(kind)} 간파당했다. (${ch}%)`);
    if (foe) foe.morale = clamp(foe.morale + 4, 0, 100);
    battle.log.push(...lines);
    return { ok: true, success: false, lines, chance: ch };
  }

  if (kind === '화계') {
    targetTile.fire = 3;
    for (const t of [targetTile, ...neighborsOf(battle.map, targetTile.q, targetTile.r)]) {
      if (t !== targetTile && !rng.chance(0.45)) continue;
      if (['숲', '평지', '가도', '사막'].includes(t.terr)) t.fire = Math.max(t.fire, 2);
    }
    lines.push(`불길이 치솟는다!`);
    if (foe) { damage(battle, foe, Math.round(foe.troops * 0.14), '화계'); foe.morale = clamp(foe.morale - 16, 0, 100); }
  } else if (kind === '수계') {
    const hit = [targetTile, ...neighborsOf(battle.map, targetTile.q, targetTile.r)];
    lines.push(`둑이 터져 물이 쏟아진다!`);
    for (const t of hit) {
      if (!t.unit) continue;
      damage(battle, t.unit, Math.round(t.unit.troops * (t === targetTile ? 0.20 : 0.11)), '수계');
      t.unit.morale = clamp(t.unit.morale - 18, 0, 100);
    }
  } else if (kind === '낙석') {
    lines.push(`바위가 굴러 떨어진다!`);
    if (foe) {
      damage(battle, foe, Math.round(foe.troops * 0.17), '낙석');
      foe.morale = clamp(foe.morale - 12, 0, 100);
      foe.mp = 0; foe.moved = true;
    }
  } else if (kind === '혼란') {
    if (foe) {
      foe.confusedFor = 1;
      foe.status = 'confused';
      foe.morale = clamp(foe.morale - 10, 0, 100);
      lines.push(`${iga(foe.name)} 대오가 흐트러졌다!`);
    }
  } else if (kind === '위보') {
    if (foe) {
      foe.retreatFor = 2;
      foe.morale = clamp(foe.morale - 14, 0, 100);
      lines.push(`거짓 소식에 ${iga(foe.name)} 뒤로 물러난다!`);
      pushBack(battle, foe);
    }
  } else if (kind === '설전') {
    if (foe) {
      const d = clamp(Math.round((me.int - foeInt) * 0.5 + 20), 10, 40);
      foe.morale = clamp(foe.morale - d, 0, 100);
      lines.push(`${me.name}의 말에 ${iga(foe.name)} 할 말을 잃었다. 사기 -${d}`);
      if (foe.morale <= 0) { lines.push(`${iga(foe.name)} 무너졌다!`); removeUnit(battle, foe, '설전'); }
    }
  }
  battle.log.push(...lines);
  checkOver(battle);
  return { ok: true, success: true, lines, chance: ch };
}

function pushBack(battle, u) {
  const dir = u.side === 'A' ? -1 : 1;
  const t = battle.map.tiles[axial(u.q + dir, u.r)];
  if (t && !t.unit && moveCost(t, u) < 90) {
    const cur = battle.map.tiles[axial(u.q, u.r)];
    cur.unit = null; t.unit = u; u.q = t.q; u.r = t.r;
  }
}

/* ─────────────────────────── 일기토 ─────────────────────────── */

export function canDuel(battle, u, target) {
  if (u.acted || u.dead || target.dead || u.side === target.side) return false;
  if (u.officerId < 0 || target.officerId < 0) return false;
  return hexDistance(u, target) === 1;
}

/** 상대가 일기토를 받아들일지 */
export function duelAccepted(u, target) {
  const a = OFFICERS[u.officerId], d = OFFICERS[target.officerId];
  if (!a || !d) return false;
  const conf = d.war - a.war + (d.amb - 8) * 1.5 + (target.morale - u.morale) * 0.15;
  return rng.pct(clamp(52 + conf * 1.6, 6, 96));
}

/**
 * 일기토. 합(合)을 겨뤄 셋을 먼저 따내는 쪽이 이긴다.
 * @returns { rounds:[{a,d,win}], winner:'A'|'D', outcome:'항복'|'부상'|'전사'|'무승부' }
 */
export function duel(battle, u, target) {
  const a = OFFICERS[u.officerId], d = OFFICERS[target.officerId];
  const rounds = [];
  let sa = 0, sd = 0;
  for (let i = 0; i < 12 && sa < 3 && sd < 3; i++) {
    const ra = a.war + rng.range(0, 34) + (u.morale - 50) * 0.1;
    const rd = d.war + rng.range(0, 34) + (target.morale - 50) * 0.1;
    const win = ra >= rd ? 'A' : 'D';
    if (win === 'A') sa++; else sd++;
    rounds.push({ a: Math.round(ra), d: Math.round(rd), win });
  }
  const winnerSide = sa > sd ? 'A' : 'D';
  const win = winnerSide === 'A' ? u : target;
  const lose = winnerSide === 'A' ? target : u;
  const gap = Math.abs(sa - sd);

  let outcome = '무승부';
  if (gap >= 3) outcome = rng.pct(42) ? '전사' : '항복';
  else if (gap === 2) outcome = rng.pct(22) ? '전사' : rng.pct(45) ? '항복' : '부상';
  else outcome = rng.pct(60) ? '부상' : '항복';

  win.morale = clamp(win.morale + 14, 0, 100);
  lose.morale = clamp(lose.morale - 22, 0, 100);
  damage(battle, lose, Math.round(lose.troops * 0.07), '일기토');

  if (outcome === '전사') { lose.duelResult = '전사'; removeUnit(battle, lose, '일기토'); }
  else if (outcome === '항복') { lose.duelResult = '포로'; removeUnit(battle, lose, '일기토'); }
  else if (outcome === '부상') { lose.acted = true; lose.mp = 0; lose.confusedFor = 1; }

  u.acted = true; u.moved = true;
  battle.log.push(`${a.name} vs ${d.name} — ${sa}:${sd} ${winnerSide === 'A' ? a.name : d.name} 승, ${outcome}`);
  checkOver(battle);
  return { rounds, winner: winnerSide, outcome, winnerName: winnerSide === 'A' ? a.name : d.name, loserName: winnerSide === 'A' ? d.name : a.name };
}

/* ─────────────────────────── 결과 반영 ─────────────────────────── */

/**
 * 전투가 끝난 뒤 전략 상태에 반영한다.
 * 남은 병력은 도시로 돌아가고, 성이 떨어지면 주인이 바뀐다.
 */
export function resolveBattle(st, battle) {
  const from = st.cities[battle.fromCityId];
  const to = st.cities[battle.cityId];
  const res = { lines: [], captured: [], killed: [], taken: false };
  const winner = battle.over ? battle.over.winner : 'D';

  const survA = battle.units.filter((u) => u.side === 'A' && !u.dead);
  const survD = battle.units.filter((u) => u.side === 'D' && !u.dead);
  const troopsA = survA.reduce((a, u) => a + u.troops, 0);
  const troopsD = survD.reduce((a, u) => a + u.troops, 0);

  // 쓰러진 부대의 무장 처리
  for (const u of battle.units) {
    if (!u.dead || u.officerId < 0) continue;
    const s = officerState(st, u.officerId);
    if (!s) continue;
    if (u.duelResult === '전사' || (u.cause === '전투' && rng.pct(14))) {
      res.killed.push(base(s).name);
      s.__dead = true;
      continue;
    }
    if (u.duelResult === '포로' || rng.pct(38)) {
      s.status = 'captive';
      s.captiveOf = u.side === 'A' ? battle.defFid : battle.attFid;
      res.captured.push(base(s).name);
    }
  }

  if (winner === 'A') {
    res.taken = true;
    const oldFid = to.faction;
    // 성을 접수한다
    to.faction = battle.attFid;
    to.troops = troopsA;
    to.morale = clamp(Math.round(survA.reduce((a, u) => a + u.morale, 0) / Math.max(1, survA.length)), 10, 100);
    to.loyal = clamp(to.loyal - 12, 0, 100);
    to.governor = -1;
    to.wall = Math.round(to.wall * 0.7);
    // 성에 있던 금·군량은 그대로 넘어온다
    res.lines.push(`${eul(info(to).name)} 손에 넣었다. (금 ${to.gold}, 군량 ${num(to.food)})`);

    // 이긴 부대의 무장은 그 성으로
    for (const u of survA) {
      const s = officerState(st, u.officerId);
      if (s) { s.city = battle.cityId; s.merit += Math.round(u.maxTroops / 200); }
    }
    if (survA.length) {
      const gov = survA.map((u) => officerState(st, u.officerId)).filter(Boolean)
        .sort((a, b) => base(b).pol - base(a).pol)[0];
      if (gov) to.governor = gov.id;
    }
    // 패한 수비 무장 중 포로가 아닌 자는 가까운 아군 도시로 도망
    fleeSurvivors(st, survD, oldFid, battle.cityId);
    if (oldFid !== NEUTRAL) {
      const left = st.cities.filter((c) => c.faction === oldFid).length;
      if (left === 0) res.lines.push(`${iga(st.factions[oldFid].name)} 터전을 잃었다.`);
    }
  } else {
    to.troops = troopsD;
    to.morale = clamp(Math.round(survD.reduce((a, u) => a + u.morale, 0) / Math.max(1, survD.length)) || to.morale, 10, 100);
    from.troops += troopsA;
    for (const u of survA) {
      const s = officerState(st, u.officerId);
      if (s) s.city = battle.fromCityId;
    }
    res.lines.push(`${info(to).name} 공략에 실패했다.`);
  }

  // 전사자 정리
  for (const s of [...st.officers]) {
    if (!s.__dead) continue;
    const i = st.officers.indexOf(s);
    if (i >= 0) st.officers.splice(i, 1);
    for (const c of st.cities) if (c.governor === s.id) c.governor = -1;
    for (const f of st.factions) if (f.alive && f.ruler === s.id) f.__needHeir = true;
  }

  // 포로를 성으로 옮긴다
  for (const s of st.officers) {
    if (s.status !== 'captive') continue;
    s.city = s.captiveOf === battle.attFid && winner === 'A' ? battle.cityId
      : s.captiveOf === battle.attFid ? battle.fromCityId
      : battle.cityId;
  }

  res.lines.unshift(battle.over ? battle.over.reason : '전투가 끝났다');
  return res;
}

function fleeSurvivors(st, survD, fid, fromCityId) {
  const homes = st.cities.filter((c) => c.faction === fid);
  for (const u of survD) {
    const s = officerState(st, u.officerId);
    if (!s || s.status === 'captive') continue;
    if (!homes.length) { s.faction = NEUTRAL; s.loyalty = 0; continue; }
    homes.sort((a, b) => Math.abs(a.id - fromCityId) - Math.abs(b.id - fromCityId));
    s.city = homes[0].id;
  }
}

export { hexDistance, TERRAIN, axial, neighborsOf, tileOf as tileUnder };
