// 정합성·크래시 검사. 실패하면 exit 1.
//   node tools/smoke.mjs

import { CITIES, ROUTES, ADJ, DIST } from '../src/data/cities.js';
import { OFFICERS, OFFICER_BY_NAME, troopType } from '../src/data/officers.js';
import { SHIPS, SHIP_ORDER, availableShips } from '../src/data/ships.js';
import { info } from '../src/game/city.js';
import { HOMETOWN, HOME_OF } from '../src/data/hometowns.js';
import { SCENARIOS } from '../src/data/scenarios.js';
import { TREASURES } from '../src/data/treasures.js';
import { newGame, factionCities, factionOfficers, NEUTRAL, base, isRulerOf } from '../src/game/state.js';
import { captiveAction } from '../src/game/commands.js';
import { endMonth, beginMonth, rankings } from '../src/game/turn.js';
import { startBattle, resolveBattle } from '../src/game/battle/engine.js';
import { autoResolve } from '../src/game/battle/ai.js';
import { makeBattleMap, TERRAIN } from '../src/game/battle/map.js';

let fails = 0, checks = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) { fails++; console.error('  ✗ ' + msg); }
};
const section = (s) => console.log('\n── ' + s);

/* ─────────────── 데이터 ─────────────── */
section('도시');
ok(CITIES.length === 46, `도시 46개여야 하는데 ${CITIES.length}개`);
ok(new Set(CITIES.map((c) => c.name)).size === 46, '도시 이름 중복');
CITIES.forEach((c, i) => ok(c.id === i, `도시 id 어긋남: ${c.name}`));
for (const [a, b, d, w] of ROUTES) {
  ok(CITIES[a] && CITIES[b], `없는 도시를 잇는 길: ${a}-${b}`);
  ok(d >= 1 && d <= 4, `길 거리 이상: ${a}-${b} = ${d}`);
}
// 연결성
{
  const seen = new Set([0]); const q = [0];
  while (q.length) for (const { to } of ADJ[q.pop()]) if (!seen.has(to)) { seen.add(to); q.push(to); }
  ok(seen.size === 46, `길이 끊긴 도시가 있다 (${seen.size}/46 연결)`);
}
ok(DIST.every((row) => row.every((v) => Number.isFinite(v))), '도달 못 하는 도시 쌍이 있다');

section('무장');
ok(OFFICERS.length >= 400, `무장 400명 이상이어야 하는데 ${OFFICERS.length}명`);
ok(new Set(OFFICERS.map((o) => o.name)).size === OFFICERS.length, '무장 이름 중복');
for (const o of OFFICERS) {
  const bad = ['lead', 'navy', 'war', 'int', 'pol', 'cha'].filter((k) => !(o[k] >= 1 && o[k] <= 100));
  ok(!bad.length, `${o.name} 능력치 범위 이상: ${bad.join(',')}`);
  ok(o.amb >= 1 && o.amb <= 15, `${o.name} 야망 범위 이상 (${o.amb})`);
  ok(o.duty >= 1 && o.duty <= 15, `${o.name} 의리 범위 이상 (${o.duty})`);
  ok(o.comp >= 0 && o.comp <= 149, `${o.name} 상성 범위 이상 (${o.comp})`);
  ok(o.born < o.died, `${o.name} 생몰 이상 (${o.born}~${o.died})`);
}

section('출신지');
{
  const seen = new Map();
  for (const [cid, names] of Object.entries(HOMETOWN)) {
    ok(CITIES[+cid], `없는 도시 ${cid}`);
    for (const n of names) {
      ok(OFFICER_BY_NAME[n], `출신지에 없는 무장: ${n}`);
      ok(!seen.has(n), `출신지 중복: ${n}`);
      seen.set(n, +cid);
    }
  }
  const missing = OFFICERS.filter((o) => !seen.has(o.name)).map((o) => o.name);
  ok(!missing.length, `출신지가 없는 무장 ${missing.length}명: ${missing.slice(0, 12).join(', ')}`);
}

section('보물');
ok(new Set(TREASURES.map((t) => t.id)).size === TREASURES.length, '보물 id 중복');

section('시나리오');
for (const sc of SCENARIOS) {
  const owned = new Set();
  for (const f of sc.factions) {
    ok(OFFICER_BY_NAME[f.ruler], `${sc.id}: 없는 군주 ${f.ruler}`);
    ok(f.cities.length > 0, `${sc.id}: ${f.ruler}군에 도시가 없다`);
    for (const c of f.cities) {
      ok(CITIES[c], `${sc.id}: 없는 도시 ${c}`);
      ok(!owned.has(c), `${sc.id}: ${CITIES[c]?.name} 도시가 두 세력에 속함`);
      owned.add(c);
    }
    for (const n of f.officers) ok(OFFICER_BY_NAME[n], `${sc.id} ${f.ruler}군: 없는 무장 ${n}`);
    for (const [cid, names] of Object.entries(f.at || {})) {
      ok(f.cities.includes(+cid), `${sc.id} ${f.ruler}군: at 에 남의 도시 ${cid}`);
      for (const n of names) ok(OFFICER_BY_NAME[n], `${sc.id} ${f.ruler}군 at: 없는 무장 ${n}`);
    }
    const ruler = OFFICER_BY_NAME[f.ruler];
    ok(ruler && sc.year >= ruler.born + 16 && sc.year <= ruler.died,
       `${sc.id}: 군주 ${f.ruler}가 그 해에 살아있지 않다 (${ruler?.born}~${ruler?.died})`);
  }
}

/* ─────────────── 게임 진행 ─────────────── */
section('새 게임');
for (const sc of SCENARIOS) {
  const st = newGame(sc.id, 0, 1234);
  ok(st.cities.length === 46, `${sc.id}: 도시 수 이상`);
  ok(st.officers.length > 40, `${sc.id}: 무장이 너무 적다 (${st.officers.length})`);
  ok(st.factions.filter((f) => f.alive).length >= 3, `${sc.id}: 살아있는 세력이 너무 적다`);
  for (const f of st.factions) {
    if (!f.alive) continue;
    ok(f.ruler >= 0, `${sc.id}: ${f.name}군에 군주가 없다`);
    const rs = st.officers.find((s) => s.id === f.ruler);
    ok(rs && rs.faction === f.id, `${sc.id}: ${f.name} 군주가 세력에 없다`);
  }
  const dup = st.officers.map((s) => s.id);
  ok(new Set(dup).size === dup.length, `${sc.id}: 무장 중복 배치`);
  console.log(`  ${sc.id} ${sc.title} — 세력 ${st.factions.filter((f) => f.alive).length}, 무장 ${st.officers.length}, 재야 ${st.officers.filter((s) => s.faction === NEUTRAL).length}`);
}

section('전장 생성');
for (let i = 0; i < 46; i++) {
  const m = makeBattleMap(i, true, false);
  const tiles = Object.values(m.tiles);
  ok(tiles.length === 17 * 13, `${CITIES[i].name}: 타일 수 이상 (${tiles.length})`);
  ok(tiles.every((t) => TERRAIN[t.terr]), `${CITIES[i].name}: 알 수 없는 지형`);
  ok(m.core && m.gate, `${CITIES[i].name}: 성이 없다`);
  ok(m.attackerZone.length >= 3 && m.defenderZone.length >= 3, `${CITIES[i].name}: 진입 구역이 좁다`);
}

section('전투 자동 판정');
{
  let battles = 0, taken = 0, days = 0, duels = 0;
  const TYPES = ['보병', '기병', '궁병'];
  // 전투마다 상태를 새로 만든다 — 앞선 전투가 병력을 갉아먹지 않게
  for (let seed = 0; seed < 40 && battles < 24; seed++) {
    const st = newGame(SCENARIOS[seed % SCENARIOS.length].id, 0, 900 + seed);
    const pairs = [];
    for (const c of st.cities) {
      if (c.faction === NEUTRAL || c.troops < 4000) continue;
      for (const { to } of ADJ[c.id]) if (st.cities[to].faction !== c.faction) pairs.push([c, st.cities[to]]);
    }
    if (!pairs.length) continue;
    const [from, tgt] = pairs[seed % pairs.length];
    const pool = st.officers.filter((s) => s.city === from.id && s.faction === from.faction).slice(0, 5);
    if (!pool.length) continue;
    const each = Math.floor(from.troops * 0.65 / pool.length);
    if (each < 300) continue;
    const b = startBattle(st, from.id, tgt.id,
      pool.map((s, i) => ({ officerId: s.id, troops: each, type: TYPES[i % 3] })));
    if (b.error) continue;
    battles++;
    const over = autoResolve(b);
    ok(over && over.winner, '전투가 끝나지 않았다');
    ok(b.day <= 32, `전투가 너무 길다 (${b.day}일)`);
    days += b.day;
    duels += b.log.filter((l) => l.includes(' vs ')).length;
    const res = resolveBattle(st, b);
    if (res.taken) taken++;
    ok(st.cities.every((c) => c.troops >= 0), '병력이 음수');
    ok(st.officers.every((s) => st.cities[s.city]), '전투 뒤 무장이 이상한 도시에 있다');
    ok(b.units.every((u) => u.troops >= 0), '부대 병력이 음수');
  }
  ok(battles >= 12, `전투를 충분히 못 돌렸다 (${battles}건)`);
  ok(taken > 0 && taken < battles, `함락 결과가 한쪽으로만 쏠렸다 (${taken}/${battles})`);
  console.log(`  전투 ${battles}건, 함락 ${taken}건, 평균 ${(days / Math.max(1, battles)).toFixed(1)}일, 일기토 ${duels}회`);
}

section('병종 고정 · 배');
{
  // 1) 모든 무장이 셋 중 하나로 떨어지고, 세 병종이 골고루 나온다
  const count = { 보병: 0, 기병: 0, 궁병: 0 };
  for (const o of OFFICERS) {
    const t = troopType(o);
    ok(count[t] !== undefined, `${o.name}: 알 수 없는 병종 ${t}`);
    if (count[t] !== undefined) count[t]++;
    ok(troopType(o) === t, `${o.name}: 병종이 부를 때마다 달라진다`);
  }
  for (const k of Object.keys(count)) ok(count[k] >= 40, `${k}이(가) 너무 적다 (${count[k]}명)`);
  console.log(`  병종 분포 — 보병 ${count.보병} / 기병 ${count.기병} / 궁병 ${count.궁병}`);
  // 태그로 못 박은 예외가 지켜지는가
  ok(troopType(OFFICER_BY_NAME['황충']) === '궁병', '황충은 궁병이어야 한다');
  ok(troopType(OFFICER_BY_NAME['전위']) === '보병', '전위는 보병이어야 한다');
  ok(troopType(OFFICER_BY_NAME['여포']) === '기병', '여포는 기병이어야 한다');

  // 2) 배 목록은 기술이 오를수록 늘어난다
  ok(availableShips(0).length === 0, '기술 0에 지을 수 있는 배가 있다');
  ok(availableShips(1).length === SHIP_ORDER.length, '기술을 채워도 못 짓는 배가 있다');
  for (let i = 1; i < SHIP_ORDER.length; i++) {
    const a = SHIPS[SHIP_ORDER[i - 1]], b = SHIPS[SHIP_ORDER[i]];
    ok(b.power > a.power && b.cost > a.cost, `${SHIP_ORDER[i]}: 등급이 올랐는데 세거나 비싸지 않다`);
  }
  ok(SHIPS['뗏목'].power < SHIPS[SHIP_ORDER[0]].power, '뗏목이 소선보다 세다');

  // 3) 수로로 이어진 성을 치면 수전, 육로면 육전
  const st = newGame('208', 0, 909);
  let checkedWater = false, checkedLand = false;
  for (const c of st.cities) {
    if (c.faction === NEUTRAL || c.troops < 3000) continue;
    for (const e of ADJ[c.id]) {
      const t = st.cities[e.to];
      if (t.faction === c.faction) continue;
      const pool = st.officers.filter((s) => s.city === c.id && s.faction === c.faction).slice(0, 3);
      if (!pool.length) continue;
      const each = Math.floor(c.troops * 0.5 / pool.length);
      if (each < 300) continue;
      const b = startBattle(st, c.id, t.id, pool.map((s) => ({ officerId: s.id, troops: each, ship: e.water ? '중선' : null })));
      if (b.error) continue;
      ok(b.naval === !!e.water, `${info(c).name}→${info(t).name}: 물길 ${!!e.water} 인데 수전 ${b.naval}`);
      // 병종은 무장이 정한다 — picks 에 넣은 적이 없다
      for (const u of b.units.filter((x) => x.side === 'A')) {
        const o = OFFICERS[u.officerId];
        ok(u.type === troopType(o), `${o.name}: 부대 병종(${u.type})이 무장 병종(${troopType(o)})과 다르다`);
      }
      if (e.water) checkedWater = true; else checkedLand = true;
      // 되돌린다 — 다음 조합에 영향 주지 않게
      c.troops += each * pool.length;
      if (checkedWater && checkedLand) break;
    }
    if (checkedWater && checkedLand) break;
  }
  ok(checkedWater, '수로 전투를 한 번도 못 만들었다');
  ok(checkedLand, '육로 전투를 한 번도 못 만들었다');
}

section('군주 포로 처분');
{
  const st = newGame('200', 0, 555);
  const foeFid = st.factions.findIndex((f) => f.alive && f.id !== st.player);
  const ruler = st.officers.find((s) => s.id === st.factions[foeFid].ruler);
  const myCity = st.cities.find((c) => c.faction === st.player);
  ruler.status = 'captive';
  ruler.captiveOf = st.player;
  ruler.city = myCity.id;

  ok(isRulerOf(st, ruler), '군주 판정이 안 된다');
  const r1 = captiveAction(st, myCity.id, ruler.id, '등용');
  ok(!r1.ok, '군주를 등용할 수 있어서는 안 된다');
  ok(ruler.faction === foeFid && ruler.status === 'captive', '실패한 등용이 상태를 건드렸다');

  // 세력이 무너지면 더는 군주가 아니다 — 그때는 거둘 수 있다
  for (const c of st.cities) if (c.faction === foeFid) c.faction = NEUTRAL;
  endMonth(st);
  ok(!st.factions[foeFid].alive, '도시를 다 잃었는데 세력이 남아 있다');
  ok(ruler.faction === NEUTRAL, '멸망한 세력의 포로가 재야가 되지 않았다');
  ok(!isRulerOf(st, ruler), '멸망한 세력의 군주가 아직 군주로 잡힌다');
  const r2 = captiveAction(st, ruler.city, ruler.id, '등용');
  ok(r2.ok, '멸망 후에는 등용을 시도할 수 있어야 한다');
  console.log(`  ${base(ruler).name} — 세력 생존 중 등용 거부, 멸망 후 시도 가능`);
}

section('24개월 진행');
for (const scId of ['184', '200', '221']) {
  const st = newGame(scId, 0, 4242);
  beginMonth(st);
  let interrupts = 0;
  for (let m = 0; m < 24; m++) {
    let guard = 0;
    let r = endMonth(st);
    while (r.interrupted && guard++ < 20) {
      interrupts++;
      // 플레이어가 방어하는 전투는 자동으로 처리
      autoResolve(st.battle);
      resolveBattle(st, st.battle);
      st.battle = null;
      r = endMonth(st);
    }
    ok(!r.interrupted, `${scId}: 전투 중단이 안 풀린다`);
    ok(st.cities.every((c) => c.gold >= 0), `${scId} ${m}월: 금이 음수`);
    ok(st.cities.every((c) => c.food >= 0), `${scId} ${m}월: 군량이 음수`);
    ok(st.cities.every((c) => c.pop > 0), `${scId} ${m}월: 인구가 0 이하`);
    ok(st.cities.every((c) => c.loyal >= 0 && c.loyal <= 100), `${scId} ${m}월: 민충 범위 이상`);
    ok(st.officers.every((s) => s.loyalty >= 0 && s.loyalty <= 100), `${scId} ${m}월: 충성 범위 이상`);
    ok(st.officers.every((s) => st.cities[s.city]), `${scId} ${m}월: 무장이 없는 도시에 있다`);
    if (st.over) break;
  }
  const alive = st.factions.filter((f) => f.alive).length;
  const top = rankings(st)[0];
  console.log(`  ${scId}: ${st.year}년 ${st.month}월, 세력 ${alive}, 선두 ${top.f.name}(${top.cities}성), 플레이어 전투 ${interrupts}건`);
  ok(alive >= 1, `${scId}: 세력이 전멸했다`);
}

console.log(`\n${fails ? '✗' : '✓'} ${checks - fails}/${checks} 통과`);
process.exit(fails ? 1 : 0);
