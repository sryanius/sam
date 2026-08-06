// 세력 AI — 컴퓨터가 조종하는 군주의 한 달.
//
// 도시마다 급한 것부터 채운다. 남는 무장은 내정을 돌리고,
// 힘이 넉넉하면 이웃을 친다.
//
// 반환: { news: string[], battle: battle|null }
//   battle 이 있으면 플레이어가 방어측이라 화면에서 직접 싸워야 한다는 뜻이다.

import { CITIES, ADJ, DIST } from '../data/cities.js';
import { OFFICERS } from '../data/officers.js';
import { clamp, num, iga, eul } from '../core/util.js';
import { rng } from '../core/rng.js';
import {
  base, NEUTRAL, officerState, membersIn, freeIn, captivesIn, factionCities,
  factionOfficers, power, isAllied,
} from './state.js';
import { caps, info, troopCap, goldIncome, conscriptMax } from './city.js';
import { eff, overall } from './officer.js';
import {
  develop, patrol, conscript, drill, doSearch, recruit, reward, appointGovernor,
  moveOfficer, transport, captiveAction, plot, diplomacy, joinFaction, DEV_KINDS,
} from './commands.js';
import { startBattle, resolveBattle, MAX_UNITS } from './battle/engine.js';
import { autoResolve } from './battle/ai.js';
import { gwa } from '../core/util.js';

export function runFactionAI(st, fid) {
  const news = [];
  const f = st.factions[fid];
  const cities = factionCities(st, fid);
  if (!cities.length) return { news, battle: null };

  // 태수가 빈 성부터 채운다
  for (const c of cities) {
    if (c.governor >= 0 && officerState(st, c.governor)?.city === c.id) continue;
    const here = membersIn(st, c.id, fid);
    if (!here.length) { c.governor = -1; continue; }
    here.sort((a, b) => base(b).pol + base(b).lead - base(a).pol - base(a).lead);
    appointGovernor(st, c.id, here[0].id);
  }

  // 포로 처분
  for (const c of cities) {
    for (const p of captivesIn(st, c.id)) {
      if (p.captiveOf !== fid) continue;
      const o = base(p);
      const persuader = membersIn(st, c.id, fid).find((s) => !s.acted);
      if (overall(o) >= 62 && rng.chance(0.75)) {
        const r = captiveAction(st, c.id, p.id, '등용', persuader?.id);
        if (r.success) news.push(`${iga(f.name)} ${eul(o.name)} 거두었다.`);
      } else if (o.duty >= 12 && rng.chance(0.5)) {
        captiveAction(st, c.id, p.id, '석방');
      } else if (rng.chance(0.30)) {
        captiveAction(st, c.id, p.id, '참수');
        news.push(`${iga(f.name)} ${eul(o.name)} 참했다.`);
      }
    }
  }

  // 도시별 명령
  for (const c of cities) cityOrders(st, fid, c, news);

  // 충성이 흔들리는 자를 다독인다
  const shaky = factionOfficers(st, fid)
    .filter((s) => s.loyalty < 62 && s.id !== f.ruler)
    .sort((a, b) => a.loyalty - b.loyalty);
  for (const s of shaky.slice(0, 2)) {
    const c = st.cities[s.city];
    if (c.gold >= 350) reward(st, c.id, f.ruler, s.id, 200);
  }

  // 외교
  if (rng.chance(0.16)) doDiplomacy(st, fid, news);

  // 출병
  const battle = maybeAttack(st, fid, news);
  return { news, battle };
}

/* ─────────────────────────── 도시 운영 ─────────────────────────── */

function cityOrders(st, fid, c, news) {
  const k = caps(c);
  const idle = () => membersIn(st, c.id, fid).filter((s) => !s.acted);
  const front = isFrontier(st, c.id, fid);

  // 급한 순서대로 필요 목록을 만든다
  const needs = [];
  if (c.loyal < 62) needs.push({ kind: '순찰', w: (62 - c.loyal) * 2.2 });
  if (c.food < c.troops * 1.4) needs.push({ kind: '개간', w: 70 });
  if (front && c.troops < troopCap(c) * 0.55) needs.push({ kind: '징병', w: 80 });
  if (front && c.train < 72) needs.push({ kind: '훈련', w: 62 });
  if (!front && c.troops < troopCap(c) * 0.3) needs.push({ kind: '징병', w: 40 });
  needs.push({ kind: '상업', w: 46 * (1 - c.comm / k.comm) + 12 });
  needs.push({ kind: '개간', w: 44 * (1 - c.land / k.land) + 10 });
  needs.push({ kind: '치수', w: 34 * (1 - c.flood / k.flood) });
  needs.push({ kind: '기술', w: 30 * (1 - c.tech / k.tech) });
  if (front) needs.push({ kind: '축성', w: 40 * (1 - c.wall / k.wall) });
  if (freeIn(st, c.id).length) needs.push({ kind: '등용', w: 66 });
  needs.push({ kind: '탐색', w: 22 });
  needs.sort((a, b) => b.w - a.w);

  for (const need of needs) {
    const pool = idle();
    if (!pool.length || c.gold < 60) break;
    const s = pickFor(pool, need.kind);
    if (!s) continue;
    runNeed(st, fid, c, s, need.kind, news);
  }

  // 그래도 남으면 내정을 돌린다
  for (const s of idle()) {
    if (c.gold < 150) break;
    const o = eff(s);
    const kind = o.pol >= o.lead ? (c.comm / k.comm < c.land / k.land ? '상업' : '개간') : '훈련';
    runNeed(st, fid, c, s, kind, news);
  }

  // 후방 성은 앞으로 물자를 밀어 준다 — 이게 있어야 세력이 힘을 모은다
  if (!front) forwardSupply(st, fid, c);
}

/** 안쪽 성이 국경 성으로 병력·금·군량을 보낸다 */
function forwardSupply(st, fid, c) {
  const front = ADJ[c.id].map((e) => st.cities[e.to])
    .filter((n) => n.faction === fid && isFrontier(st, n.id, fid));
  if (!front.length) return;
  const s = membersIn(st, c.id, fid).find((x) => !x.acted && st.cities[c.id].governor !== x.id);
  if (!s) return;
  // 가장 앞이 급한 성으로
  front.sort((a, b) => (a.troops / troopCap(a)) - (b.troops / troopCap(b)));
  const to = front[0];
  const keep = Math.round(troopCap(c) * 0.22);
  const troops = Math.max(0, Math.min(c.troops - keep, troopCap(to) - to.troops));
  const gold = c.gold > 900 ? Math.round(c.gold * 0.45) : 0;
  const food = c.food > c.troops * 3 ? Math.round(c.food * 0.35) : 0;
  if (troops < 1500 && gold < 300 && food < 3000) return;
  transport(st, c.id, to.id, s.id, { gold, food, troops });
}

function pickFor(pool, kind) {
  const score = {
    순찰: (o) => o.cha * 2 + o.pol,
    개간: (o) => o.pol * 2 + o.int,
    상업: (o) => o.pol * 2 + o.int,
    치수: (o) => o.pol * 2,
    기술: (o) => o.pol + o.int * 2,
    축성: (o) => o.pol * 2 + o.lead,
    징병: (o) => o.cha * 2,
    훈련: (o) => o.lead * 2 + o.war,
    등용: (o) => o.cha * 2 + o.int,
    탐색: (o) => o.int * 2 + o.cha,
  }[kind] || ((o) => o.pol);
  return pool.slice().sort((a, b) => score(eff(b)) - score(eff(a)))[0];
}

function runNeed(st, fid, c, s, kind, news) {
  if (kind === '순찰') return patrol(st, c.id, s.id);
  if (kind === '훈련') return drill(st, c.id, s.id);
  if (kind === '징병') {
    const want = Math.min(conscriptMax(c, eff(s)), Math.floor(c.gold / 0.08 / 3));
    if (want > 300) return conscript(st, c.id, s.id, want);
    return null;
  }
  if (kind === '탐색') return doSearch(st, c.id, s.id);
  if (kind === '등용') {
    const targets = freeIn(st, c.id).sort((a, b) => overall(base(b)) - overall(base(a)));
    if (!targets.length) return null;
    const r = recruit(st, c.id, s.id, targets[0].id);
    if (r.success) news.push(`${iga(st.factions[fid].name)} ${eul(base(targets[0]).name)} 맞아들였다.`);
    return r;
  }
  if (DEV_KINDS[kind]) return develop(st, c.id, s.id, kind);
  return null;
}

function isFrontier(st, cityId, fid) {
  return ADJ[cityId].some(({ to }) => {
    const n = st.cities[to];
    return n.faction !== fid && !(n.faction !== NEUTRAL && isAllied(st, fid, n.faction));
  });
}

/* ─────────────────────────── 외교 ─────────────────────────── */

function doDiplomacy(st, fid, news) {
  const f = st.factions[fid];
  const me = power(st, fid);
  const others = st.factions.filter((g) => g.alive && g.id !== fid);
  if (!others.length) return;

  const strong = others.filter((g) => power(st, g.id) > me * 1.4 && !f.truce[g.id]);
  const cities = factionCities(st, fid);
  const cap = cities.sort((a, b) => b.gold - a.gold)[0];
  if (!cap) return;
  const envoy = membersIn(st, cap.id, fid).filter((s) => !s.acted)
    .sort((a, b) => base(b).int + base(b).cha - base(a).int - base(a).cha)[0];
  if (!envoy || cap.gold < 400) return;

  if (strong.length && rng.chance(0.6)) {
    const t = rng.pick(strong);
    const r = diplomacy(st, cap.id, envoy.id, '화친', t.id, 300);
    if (r.success) news.push(`${gwa(f.name)} ${iga(t.name)} 화친을 맺었다.`);
    return;
  }
  // 공동의 적이 있으면 동맹
  const mid = others.filter((g) => Math.abs(power(st, g.id) - me) < me * 0.6 && !f.allies.includes(g.id));
  if (mid.length && rng.chance(0.35)) {
    const t = rng.pick(mid);
    const r = diplomacy(st, cap.id, envoy.id, '동맹', t.id, 400);
    if (r.success) news.push(`${gwa(f.name)} ${iga(t.name)} 동맹했다!`);
  }
}

/* ─────────────────────────── 출병 ─────────────────────────── */

function maybeAttack(st, fid, news) {
  const f = st.factions[fid];
  const cities = factionCities(st, fid);
  const ruler = OFFICERS[f.ruler];
  if (!ruler) return null;

  // 군주 성향 — 야망이 크고 세력이 클수록 자주 친다
  const zeal = 0.18 + ruler.amb * 0.022 + Math.min(0.24, cities.length * 0.016);
  if (!rng.chance(zeal)) return null;
  const myPower = power(st, fid);

  const plans = [];
  for (const c of cities) {
    const garrison = membersIn(st, c.id, fid);
    if (garrison.length < 2) continue;
    for (const { to } of ADJ[c.id]) {
      const t = st.cities[to];
      if (t.faction === fid) continue;
      if (t.faction !== NEUTRAL) {
        if (isAllied(st, fid, t.faction)) continue;
        if (f.truce[t.faction]) continue;
      }
      const send = Math.floor(c.troops * 0.85);
      if (send < 4000) continue;
      if (c.food < send * 1.3) continue;   // 원정 군량 + 남은 성의 여유
      // 성벽 뒤에 있는 적은 병력 이상으로 무겁다
      const defense = Math.max(800, t.troops) * (t.faction === NEUTRAL ? 0.8 : 1.25);
      const ratio = send / defense;
      if (ratio < 1.45) continue;
      // 약한 세력부터 먹는다 — 이래야 난세가 정리된다
      const weak = t.faction === NEUTRAL ? 2.2
        : clamp(myPower / Math.max(1, power(st, t.faction)), 0.45, 3.2);
      const value = (t.faction === NEUTRAL ? 1.5 : 1) * (CITIES[to].size + 1) * ratio * weak;
      plans.push({ from: c, to: t, send, value });
    }
  }
  if (!plans.length) return null;
  plans.sort((a, b) => b.value - a.value);
  const plan = plans[0];

  // 부대 편성 — 무력·지휘 높은 순
  const pool = membersIn(st, plan.from.id, fid)
    .sort((a, b) => (eff(b).lead + eff(b).war) - (eff(a).lead + eff(a).war))
    .slice(0, MAX_UNITS);
  if (pool.length < 1) return null;
  // 태수 한 명은 성에 남긴다
  const leaveBehind = membersIn(st, plan.from.id, fid).length > pool.length ? null : pool.pop();
  if (!pool.length) { if (leaveBehind) pool.push(leaveBehind); }

  const each = Math.floor(plan.send / pool.length);
  const picks = pool.map((s) => {
    const o = eff(s);
    const type = o.war >= 78 && o.lead >= 70 ? '기병' : o.int >= 78 ? '궁병' : '보병';
    return { officerId: s.id, troops: each, type };
  });

  const battle = startBattle(st, plan.from.id, plan.to.id, picks);
  if (battle.error) return null;

  const defenderIsPlayer = plan.to.faction === st.player;
  if (defenderIsPlayer) {
    battle.playerSide = 'D';
    return battle;   // 플레이어가 직접 싸운다
  }

  // 성 주인이 바뀌기 전에 이름을 붙잡아 둔다
  const attName = f.name;
  const defName = plan.to.faction === NEUTRAL ? '무주공산' : st.factions[plan.to.faction].name;
  const cityName = info(plan.to).name;

  autoResolve(battle);
  const res = resolveBattle(st, battle);
  if (res.taken) news.push(`${iga(attName)} ${defName}의 ${eul(cityName)} 빼앗았다.`);
  else news.push(`${iga(attName)} ${eul(cityName)} 쳤으나 물러났다.`);
  if (res.killed.length) news.push(`${res.killed.join(', ')} 전사.`);
  return null;
}
