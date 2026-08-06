// 전장 — 육각 타일. 축좌표(axial q,r)를 쓴다.
//
// 지형은 도시마다 고정이다(도시 id 로 시드를 만든다). 같은 성을 여러 번 치면
// 같은 지형이 나오므로, 플레이어가 전장을 외워서 쓸 수 있다.

import { CITIES } from '../../data/cities.js';
import { makeRng } from '../../core/rng.js';

export const W = 17;   // 가로 타일 수
export const H = 13;   // 세로 타일 수

/** 지형 정의 — cost 는 이동 소모, atk/def 는 전투 보정 */
export const TERRAIN = {
  평지: { cost: 1, atk: 1.00, def: 1.00, color: '#7d9c5a', short: '평' },
  가도: { cost: 1, atk: 1.05, def: 0.92, color: '#b6a077', short: '도' },
  숲:   { cost: 2, atk: 0.88, def: 1.22, color: '#3f6b3b', short: '숲' },
  산:   { cost: 3, atk: 0.80, def: 1.45, color: '#7a6a52', short: '산' },
  늪:   { cost: 2, atk: 0.82, def: 0.95, color: '#5d6b4a', short: '늪' },
  사막: { cost: 2, atk: 0.92, def: 0.90, color: '#c4b280', short: '사' },
  강:   { cost: 99, atk: 0.90, def: 0.85, color: '#3f6f9c', short: '강' },
  성벽: { cost: 99, atk: 1.00, def: 2.20, color: '#8b8378', short: '벽' },
  성문: { cost: 2, atk: 0.85, def: 1.70, color: '#6b5b46', short: '문' },
  본성: { cost: 1, atk: 1.00, def: 1.25, color: '#a89070', short: '성' },
};

export const axial = (q, r) => `${q},${r}`;
export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export function hexDistance(a, b) {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

export function neighborsOf(map, q, r) {
  const out = [];
  for (const [dq, dr] of DIRS) {
    const t = map.tiles[axial(q + dq, r + dr)];
    if (t) out.push(t);
  }
  return out;
}

/** 화면 좌표 (pointy-top). size 는 육각형 외접원 반지름. */
export function hexToPixel(q, r, size) {
  return {
    x: size * Math.sqrt(3) * (q + r / 2),
    y: size * 1.5 * r,
  };
}

export function pixelToHex(x, y, size) {
  const r = (2 / 3 * y) / size;
  const q = (Math.sqrt(3) / 3 * x - y / 3) / size;
  return roundHex(q, r);
}

function roundHex(q, r) {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

/* ─────────────────────────── 전장 생성 ─────────────────────────── */

/**
 * @param cityId  방어측 도시
 * @param siege   true 면 성이 놓인 공성전, false 면 야전
 * @param naval   true 면 수전 — 물이 대부분이다
 */
export function makeBattleMap(cityId, siege = true, naval = false) {
  const ci = CITIES[cityId];
  const rng = makeRng(9000 + cityId * 137 + (naval ? 51 : 0));
  const tiles = {};

  const mix = terrainMix(ci.terr, naval);
  for (let r = 0; r < H; r++) {
    const qOff = -Math.floor(r / 2);
    for (let i = 0; i < W; i++) {
      const q = qOff + i;
      tiles[axial(q, r)] = { q, r, col: i, row: r, terr: pickTerrain(mix, rng), unit: null, fire: 0 };
    }
  }

  // 강 한 줄기 — 수변 도시는 넓게
  if (!naval && (ci.terr === '수변' || rng.chance(0.45))) carveRiver(tiles, rng, ci.terr === '수변' ? 2 : 1);

  // 가운데를 가로지르는 가도
  carveRoad(tiles, rng);

  const map = { cityId, siege, naval, W, H, tiles, name: ci.name };

  if (siege && !naval) placeCastle(map);

  // 진입 구역 — 공격측은 왼쪽 끝.
  // 방어측은 성 안(본성)에 자리 잡는다. 나가 싸울지 농성할지는 전투 중에 정한다.
  map.attackerZone = zoneCols(map, 0, 1).filter((t) => TERRAIN[t.terr].cost < 90);
  map.defenderZone = siege && !naval
    ? zoneCols(map, W - 3, W - 1).filter((t) => TERRAIN[t.terr].cost < 90)
    : zoneCols(map, W - 2, W - 1).filter((t) => TERRAIN[t.terr].cost < 90);
  if (!map.attackerZone.length) map.attackerZone = zoneCols(map, 0, 2);
  if (!map.defenderZone.length) map.defenderZone = zoneCols(map, W - 3, W - 1);
  return map;
}

function zoneCols(map, from, to) {
  return Object.values(map.tiles).filter((t) => t.col >= from && t.col <= to);
}

function terrainMix(terr, naval) {
  if (naval) return [['강', 74], ['평지', 14], ['늪', 8], ['숲', 4]];
  switch (terr) {
    case '산악': return [['평지', 34], ['산', 34], ['숲', 24], ['늪', 8]];
    case '삼림': return [['평지', 30], ['숲', 50], ['늪', 12], ['산', 8]];
    case '수변': return [['평지', 48], ['늪', 22], ['숲', 22], ['산', 8]];
    case '사막': return [['사막', 62], ['평지', 26], ['산', 12]];
    case '남만': return [['숲', 46], ['늪', 26], ['산', 16], ['평지', 12]];
    default:     return [['평지', 62], ['숲', 22], ['산', 8], ['늪', 8]];
  }
}

function pickTerrain(mix, rng) {
  const total = mix.reduce((a, m) => a + m[1], 0);
  let x = rng.next() * total;
  for (const [k, w] of mix) { x -= w; if (x <= 0) return k; }
  return mix[0][0];
}

function carveRiver(tiles, rng, width) {
  let r = rng.range(2, H - 3);
  for (let i = 0; i < W; i++) {
    for (let w = 0; w < width; w++) {
      const rr = r + w;
      const q = -Math.floor(rr / 2) + i;
      const t = tiles[axial(q, rr)];
      if (t) t.terr = '강';
    }
    if (rng.chance(0.34)) r += rng.chance(0.5) ? 1 : -1;
    r = Math.max(1, Math.min(H - 2 - width, r));
  }
}

function carveRoad(tiles, rng) {
  let r = Math.floor(H / 2);
  for (let i = 0; i < W; i++) {
    const q = -Math.floor(r / 2) + i;
    const t = tiles[axial(q, r)];
    if (t && t.terr !== '강') t.terr = '가도';
    if (rng.chance(0.25)) r += rng.chance(0.5) ? 1 : -1;
    r = Math.max(1, Math.min(H - 2, r));
  }
}

/**
 * 오른쪽에 성을 세운다. 성벽은 전장을 위아래로 완전히 가로막는다 —
 * 돌아갈 길이 없어야 공성전이 된다. 뚫는 길은 성문뿐이고, 성벽도 부술 수는 있다.
 *
 * hp 는 도시의 성벽 수치에 따라 startBattle 에서 다시 매긴다.
 */
function placeCastle(map) {
  const midRow = Math.floor(H / 2);
  const wallCol = W - 4;

  for (let r = 0; r < H; r++) {
    const q0 = -Math.floor(r / 2);
    const wt = map.tiles[axial(q0 + wallCol, r)];
    if (wt) {
      wt.terr = r === midRow ? '성문' : '성벽';
      wt.hp = wt.maxHp = r === midRow ? 120 : 200;
    }
    for (let i = wallCol + 1; i < W; i++) {
      const t = map.tiles[axial(q0 + i, r)];
      if (t) { t.terr = '본성'; t.fire = 0; }
    }
  }
  // 본성 중심 — 여기를 밟으면 성이 떨어진다
  const cr = midRow, cq = -Math.floor(cr / 2) + (W - 2);
  const core = map.tiles[axial(cq, cr)];
  if (core) { core.core = true; core.terr = '본성'; }
  map.core = core;
  map.gate = map.tiles[axial(-Math.floor(midRow / 2) + wallCol, midRow)];
  map.wallCol = wallCol;
}

/** 성벽/성문 타일인가 */
export const isWall = (t) => t.terr === '성벽' || t.terr === '성문';

/** 성벽이 부서지면 길이 된다 */
export function breach(tile) {
  tile.terr = '가도';
  tile.hp = 0;
  tile.breached = true;
}

/* ─────────────────────────── 길찾기 ─────────────────────────── */

/** 이동 가능 타일 — { key: {tile, cost, from} } */
export function reachable(map, from, mp, unit) {
  const start = map.tiles[axial(from.q, from.r)];
  const seen = { [axial(start.q, start.r)]: { tile: start, cost: 0, from: null } };
  const queue = [start];
  while (queue.length) {
    queue.sort((a, b) => seen[axial(a.q, a.r)].cost - seen[axial(b.q, b.r)].cost);
    const cur = queue.shift();
    const curCost = seen[axial(cur.q, cur.r)].cost;
    for (const nb of neighborsOf(map, cur.q, cur.r)) {
      const k = axial(nb.q, nb.r);
      const step = moveCost(nb, unit);
      if (step >= 90) continue;
      if (nb.unit && nb.unit.side !== unit.side) continue;   // 적 부대는 통과 못 한다
      const nc = curCost + step;
      if (nc > mp) continue;
      if (seen[k] && seen[k].cost <= nc) continue;
      seen[k] = { tile: nb, cost: nc, from: cur };
      queue.push(nb);
    }
  }
  // 아군이 서 있는 칸에는 멈출 수 없다
  for (const k of Object.keys(seen)) if (seen[k].tile.unit && seen[k].tile !== start) delete seen[k];
  return seen;
}

export function moveCost(tile, unit) {
  const T = TERRAIN[tile.terr];
  // 닫힌 성문과 성벽은 부수기 전에는 못 지난다
  if ((tile.terr === '성문' || tile.terr === '성벽') && tile.hp > 0) return 99;
  if (unit.type === '수군') return tile.terr === '강' ? 1 : (T.cost >= 90 ? 99 : T.cost + 2);
  if (tile.terr === '강') return 99;
  if (tile.terr === '성벽') return 99;
  if (unit.type === '기병' && (tile.terr === '산' || tile.terr === '숲')) return T.cost + 1;
  return T.cost;
}

/** from 에서 to 까지의 경로 타일 배열 (reachable 결과 이용) */
export function pathTo(seen, toTile) {
  const out = [];
  let cur = seen[axial(toTile.q, toTile.r)];
  while (cur) { out.unshift(cur.tile); cur = cur.from ? seen[axial(cur.from.q, cur.from.r)] : null; }
  return out;
}
