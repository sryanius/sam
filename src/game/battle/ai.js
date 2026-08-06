// 전투 AI — 한 부대씩 판단해서 움직인다.
//
// 판단 순서
//   1. 사기·병력이 바닥이면 뒤로 뺀다
//   2. 계략이 확실히 먹힐 자리면 쓴다
//   3. 붙어 있는 적 중 가장 이득이 큰 쪽을 친다 (일기토가 유리하면 일기토)
//   4. 갈 곳이 있으면 목표를 향해 전진한다

import { OFFICERS } from '../../data/officers.js';
import { clamp } from '../../core/util.js';
import { rng } from '../../core/rng.js';
import {
  UNIT_TYPES, unitsOf, tileOf, moveOptions, moveUnit, attack, canAttack,
  useTactic, tacticAvailable, TACTICS, canDuel, duelAccepted, duel, retreat,
  canBreak, breakWall,
} from './engine.js';
import { axial, hexDistance, neighborsOf, TERRAIN } from './map.js';

/** 한 측의 모든 부대를 움직인다. 연출용으로 행동 기록을 돌려준다. */
export function playSide(battle, side) {
  const acts = [];
  const mine = unitsOf(battle, side);
  const foes = unitsOf(battle, side === 'A' ? 'D' : 'A');
  if (!foes.length) return acts;

  // 전면 붕괴 직전이면 철수
  const strength = mine.reduce((a, u) => a + u.troops, 0);
  const foeStrength = foes.reduce((a, u) => a + u.troops, 0);
  const avgMorale = mine.reduce((a, u) => a + u.morale, 0) / mine.length;
  if (side === 'A' && (strength < foeStrength * 0.3 || avgMorale < 18) && battle.day > 3) {
    retreat(battle, 'A');
    acts.push({ kind: '철수' });
    return acts;
  }

  // 무력이 센 부대부터 — 좋은 자리를 먼저 잡는다
  const order = mine.slice().sort((a, b) => (b.stat?.war || 0) - (a.stat?.war || 0));
  for (const u of order) {
    if (u.dead || u.acted) continue;
    const a = actUnit(battle, u, side);
    if (a) acts.push(a);
    if (battle.over) break;
  }
  return acts;
}

/**
 * 부대 하나만 움직인다 — 화면에서 한 수씩 보여주려고 쓴다.
 * 더 움직일 부대가 없으면 null.
 */
export function aiStep(battle, side) {
  const mine = unitsOf(battle, side);
  if (!mine.length || battle.over) return null;

  // 그 측의 첫 수라면 전체 철수 여부를 먼저 본다
  if (mine.every((u) => !u.acted)) {
    const foes = unitsOf(battle, side === 'A' ? 'D' : 'A');
    const strength = mine.reduce((a, u) => a + u.troops, 0);
    const foeStrength = foes.reduce((a, u) => a + u.troops, 0);
    const avgMorale = mine.reduce((a, u) => a + u.morale, 0) / mine.length;
    if (side === 'A' && foes.length && (strength < foeStrength * 0.3 || avgMorale < 18) && battle.day > 3) {
      retreat(battle, 'A');
      return { kind: '철수' };
    }
  }

  const todo = mine.filter((u) => !u.acted).sort((a, b) => (b.stat?.war || 0) - (a.stat?.war || 0));
  if (!todo.length) return null;
  const u = todo[0];
  const a = actUnit(battle, u, side);
  u.acted = true;
  return a || { kind: '대기', unit: u };
}

function actUnit(battle, u, side) {
  const foes = unitsOf(battle, side === 'A' ? 'D' : 'A');
  if (!foes.length) return null;

  // 1) 물러날 때
  if ((u.morale < 16 || u.troops < u.maxTroops * 0.14) && u.retreatFor === 0) {
    const back = fallBack(battle, u);
    if (back) return { kind: '후퇴', unit: u, tile: back };
  }

  // 2) 계략 — 지력이 있고 아직 남았으면
  if (u.tactics > 0 && u.stat && u.stat.int >= 62) {
    const plan = pickTactic(battle, u, foes);
    if (plan && rng.chance(0.62)) {
      const r = useTactic(battle, u, plan.kind, plan.tile);
      return { kind: '계략', unit: u, tactic: plan.kind, tile: plan.tile, result: r };
    }
  }

  // 3) 붙어 있는 적
  let best = null;
  for (const f of foes) {
    if (!canAttack(battle, u, f)) continue;
    const s = attackScore(battle, u, f);
    if (!best || s > best.score) best = { foe: f, score: s };
  }
  if (best) {
    // 일기토가 확실히 유리하면 한번 걸어본다
    if (canDuel(battle, u, best.foe) && u.stat && best.foe.stat
        && u.stat.war - best.foe.stat.war > 14 && rng.chance(0.35)) {
      if (duelAccepted(u, best.foe)) {
        const r = duel(battle, u, best.foe);
        return { kind: '일기토', unit: u, foe: best.foe, result: r };
      }
    }
    const r = attack(battle, u, best.foe);
    return { kind: '공격', unit: u, foe: best.foe, result: r };
  }

  // 4) 앞을 막은 성벽 부수기 — 공격측만
  if (side === 'A') {
    const walls = neighborsOf(battle.map, u.q, u.r).filter((t) => canBreak(battle, u, t));
    if (walls.length) {
      walls.sort((a, b) => (a.terr === '성문' ? 0 : 1) - (b.terr === '성문' ? 0 : 1) || a.hp - b.hp);
      const r = breakWall(battle, u, walls[0]);
      return { kind: '공성', unit: u, tile: walls[0], result: r };
    }
  }

  // 5) 전진
  const goal = pickGoal(battle, u, side, foes);
  if (!goal) return null;
  const seen = moveOptions(battle, u);
  let target = null, bestD = Infinity;
  for (const k of Object.keys(seen)) {
    const t = seen[k].tile;
    const d = hexDistance(t, goal) * 10 - TERRAIN[t.terr].def * 2 + seen[k].cost * 0.2;
    if (d < bestD) { bestD = d; target = t; }
  }
  if (target && (target.q !== u.q || target.r !== u.r)) {
    moveUnit(battle, u, target);
    // 이동 후에 칠 수 있으면 친다
    for (const f of foes) {
      if (canAttack(battle, u, f)) {
        const r = attack(battle, u, f);
        return { kind: '이동공격', unit: u, tile: target, foe: f, result: r };
      }
    }
    u.acted = true;
    return { kind: '이동', unit: u, tile: target };
  }
  u.acted = true;
  return null;
}

function attackScore(battle, u, f) {
  const wounded = 1 - f.troops / f.maxTroops;
  const weak = 1 - f.morale / 100;
  const near = hexDistance(u, f) === 1 ? 1 : 0.8;
  const tileDef = TERRAIN[tileOf(battle, f).terr].def;
  return (wounded * 40 + weak * 35 + f.troops / 400) * near / tileDef;
}

function pickTactic(battle, u, foes) {
  const opts = [];
  for (const f of foes) {
    const t = tileOf(battle, f);
    for (const kind of Object.keys(TACTICS)) {
      if (!tacticAvailable(battle, u, kind, t)) continue;
      let v = 10;
      if (kind === '화계') v = 40 + (t.terr === '숲' ? 25 : 0);
      if (kind === '수계') v = 42;
      if (kind === '낙석') v = 34;
      if (kind === '혼란') v = 26 + (f.troops > u.troops ? 12 : 0);
      if (kind === '위보') v = 18;
      if (kind === '설전') v = 20 + (u.stat.int - (f.stat?.int || 40)) * 0.5;
      opts.push({ kind, tile: t, v });
    }
  }
  if (!opts.length) return null;
  opts.sort((a, b) => b.v - a.v);
  return opts[0].v >= 24 ? opts[0] : null;
}

function pickGoal(battle, u, side, foes) {
  // 공격측은 성문·본성을 노린다. 다만 앞에 적이 있으면 그쪽 먼저.
  const nearest = foes.slice().sort((a, b) => hexDistance(u, a) - hexDistance(u, b))[0];
  if (side === 'A') {
    const core = battle.map.core;
    const gate = battle.map.gate;
    if (nearest && hexDistance(u, nearest) <= 4) return nearest;
    // 성문이 아직 성하면 그 앞으로 몰려간다
    if (gate && gate.hp > 0) return gate;
    if (core && !core.unit) return core;
    return nearest;
  }
  // 방어측은 성 앞을 지키며 다가온 적을 친다
  if (nearest && hexDistance(u, nearest) <= 5) return nearest;
  return battle.map.gate || nearest;
}

function fallBack(battle, u) {
  const seen = moveOptions(battle, u);
  const homeCol = u.side === 'A' ? 0 : battle.map.W - 1;
  let best = null, bestV = -Infinity;
  for (const k of Object.keys(seen)) {
    const t = seen[k].tile;
    const v = -Math.abs(t.col - homeCol) * 4 + TERRAIN[t.terr].def * 6;
    if (v > bestV) { bestV = v; best = t; }
  }
  if (best && (best.q !== u.q || best.r !== u.r)) {
    moveUnit(battle, u, best);
    u.acted = true;
    return best;
  }
  return null;
}

/* ─────────────────── AI 대 AI 전투는 즉시 판정한다 ─────────────────── */

/** 화면 없이 끝까지 돌린다. 결과는 engine.resolveBattle 로 넘긴다. */
export function autoResolve(battle, maxDays = 30) {
  let guard = 0;
  while (!battle.over && guard++ < maxDays * 4) {
    playSide(battle, battle.side);
    if (battle.over) break;
    if (battle.side === 'A') { battle.side = 'D'; beginAll(battle, 'D'); }
    else { battle.side = 'A'; nextDay(battle); }
  }
  if (!battle.over) battle.over = { winner: 'D', reason: '해를 넘겨 공격군이 물러났다' };
  return battle.over;
}

function beginAll(battle, side) {
  for (const u of unitsOf(battle, side)) {
    u.mp = UNIT_TYPES[u.type].mp;
    u.moved = false; u.acted = false;
    if (u.confusedFor > 0) { u.confusedFor--; u.acted = true; u.mp = 0; }
  }
}

function nextDay(battle) {
  battle.day++;
  for (const u of unitsOf(battle, 'A').concat(unitsOf(battle, 'D'))) {
    u.morale = clamp(u.morale + 1, 0, 100);
  }
  beginAll(battle, 'A');
  if (battle.day > 30) battle.over = { winner: 'D', reason: '기한이 다해 공격군이 물러났다' };
}
