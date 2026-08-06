// 한 달의 진행 — 명령 페이즈가 끝난 뒤 호출된다.
//
//  1. 컴퓨터 세력이 움직인다
//  2. 도시 정산 (수입·수확·소비·재해)
//  3. 충성도 표류와 배신
//  4. 사망·등장
//  5. 화친 만료, 세력 멸망, 천하통일 판정
//  6. 달을 넘기고 명령권을 되돌린다

import { CITIES } from '../data/cities.js';
import { OFFICERS } from '../data/officers.js';
import { rng } from '../core/rng.js';
import { dateLabel, clamp, eul, eun, iga } from '../core/util.js';
import {
  base, NEUTRAL, officerState, factionCities, factionOfficers, power,
} from './state.js';
import { monthlyUpdate, info } from './city.js';
import { loyaltyDrift, defectionCheck, debutOfficers, ageDeaths } from './officer.js';
import { killOfficer, succeed } from './commands.js';
import { runFactionAI } from './ai.js';

/** 새 달을 시작한다 — 모든 무장이 다시 명령을 받을 수 있게 */
export function beginMonth(st) {
  for (const s of st.officers) s.acted = false;
  st.reports = [];
}

/**
 * 한 달을 마감한다.
 *
 * 컴퓨터 세력이 플레이어의 성을 치면 여기서 멈추고 { interrupted, battle } 을 돌려준다.
 * 화면에서 그 전투를 치른 뒤 다시 endMonth 를 부르면 멈춘 자리에서 이어간다.
 */
export function endMonth(st) {
  rng.seed = st.seed;
  if (!st._phase) { st._phase = 'ai'; st._aiCursor = 0; st._rep = []; }
  const rep = st._rep;

  // 1) 컴퓨터 세력
  if (st._phase === 'ai') {
    while (st._aiCursor < st.factions.length) {
      const f = st.factions[st._aiCursor];
      st._aiCursor++;
      if (!f.alive || f.id === st.player) continue;
      const { news, battle } = runFactionAI(st, f.id);
      rep.push(...news);
      if (battle) {
        st.seed = rng.seed;
        st.battle = battle;
        return { interrupted: true, battle };
      }
    }
    st._phase = 'settle';
  }

  // 2) 도시 정산
  for (const c of st.cities) rep.push(...monthlyUpdate(st, c, rng));

  // 3) 충성도와 배신
  for (const s of st.officers) {
    if (s.faction === NEUTRAL || s.status !== 'normal') continue;
    s.loyalty = clamp(s.loyalty + loyaltyDrift(st, s), 0, 100);
  }
  for (const s of [...st.officers]) {
    const d = defectionCheck(st, s, rng);
    if (!d) continue;
    rep.push(...applyDefection(st, s, d));
  }

  // 4) 사망과 등장
  for (const { officer, state } of ageDeaths(st, rng)) {
    const fid = state.faction;
    const wasRuler = fid !== NEUTRAL && st.factions[fid].ruler === state.id;
    const fname = fid !== NEUTRAL ? st.factions[fid].name : '재야';
    killOfficer(st, state);   // 군주였다면 안에서 후계를 세운다
    rep.push(`${fname}의 ${iga(officer.name)} 세상을 떠났다. (향년 ${st.year - officer.born}세)`);
    if (wasRuler && st.factions[fid].alive) {
      rep.push(`${st.factions[fid].name}의 뒤를 ${iga(st.factions[fid].rulerName)} 이었다.`);
    }
  }
  if (st.month === 1) {
    for (const o of debutOfficers(st)) {
      const s = officerState(st, o.id);
      const where = s ? info(st.cities[s.city]).name : '';
      rep.push(`${where}에 ${iga(o.name)} 세상에 나왔다.`);
    }
  }

  // 5) 화친·동맹 만료, 멸망 판정
  for (const f of st.factions) {
    for (const k of Object.keys(f.truce)) {
      f.truce[k] -= 1;
      if (f.truce[k] <= 0) delete f.truce[k];
    }
  }
  for (const f of st.factions) {
    if (!f.alive) continue;
    const cs = factionCities(st, f.id);
    if (cs.length === 0) {
      f.alive = false;
      rep.push(`${f.name}군이 무너졌다.`);
      // 남은 무장은 재야로. 사로잡혀 있던 자도 더는 섬길 주인이 없다 —
      // 이래야 갇힌 군주를 그제야 거둘 수 있다.
      for (const s of st.officers) {
        if (s.faction !== f.id) continue;
        s.faction = NEUTRAL;
        s.loyalty = 0;
        s.found = true;
      }
      for (const g of st.factions) {
        g.allies = g.allies.filter((x) => x !== f.id);
        delete g.truce[f.id];
      }
    }
  }

  // 6) 달 넘기기
  st.month += 1;
  if (st.month > 12) { st.month = 1; st.year += 1; }
  st.turn += 1;
  st.seed = rng.seed;

  st.log.push(...rep.map((m) => `[${dateLabel(st.year, st.month)}] ${m}`));
  if (st.log.length > 600) st.log.splice(0, st.log.length - 600);

  checkGameOver(st);
  beginMonth(st);
  st.reports = rep;
  st._phase = null; st._aiCursor = 0; st._rep = [];
  return { interrupted: false, reports: rep };
}

function applyDefection(st, s, d) {
  const rep = [];
  const o = base(s);
  const c = st.cities[s.city];
  const from = st.factions[s.faction];

  if (d.kind === '자립') {
    rep.push(`${info(c).name} 태수 ${iga(o.name)} 자립을 선언했다!`);
    const fid = st.factions.length;
    st.factions.push({
      id: fid, name: o.name, color: '#a06a8a', rulerName: o.name, ruler: s.id,
      alive: true, allies: [], truce: {}, relation: {}, fame: 0,
    });
    c.faction = fid;
    s.faction = fid;
    s.loyalty = 100;
    c.governor = s.id;
    // 같은 도시의 무장 중 상성이 맞는 자는 따라간다
    for (const m of st.officers) {
      if (m === s || m.city !== c.id || m.faction !== from.id) continue;
      if (m.loyalty < 55 && rng.chance(0.5)) { m.faction = fid; m.loyalty = 60; }
    }
    return rep;
  }
  if (d.kind === '모반' && d.to !== undefined) {
    const to = st.factions[d.to];
    rep.push(`${info(c).name} 태수 ${iga(o.name)} ${to.name}에 성을 바치고 돌아섰다!`);
    c.faction = d.to;
    s.faction = d.to;
    s.loyalty = 70;
    c.governor = s.id;
    return rep;
  }
  // 이탈
  if (d.to !== undefined) {
    const to = st.factions[d.to];
    const dest = factionCities(st, d.to);
    rep.push(`${iga(o.name)} ${eul(from.name)} 떠나 ${to.name}에 몸을 맡겼다.`);
    s.faction = d.to;
    s.loyalty = 65;
    if (dest.length) s.city = dest.sort((a, b) => a.id - b.id)[0].id;
  } else {
    rep.push(`${iga(o.name)} ${eul(from.name)} 떠나 자취를 감췄다.`);
    s.faction = NEUTRAL;
    s.loyalty = 0;
  }
  if (c.governor === s.id) c.governor = -1;
  return rep;
}

function checkGameOver(st) {
  const total = CITIES.length;
  const mine = factionCities(st, st.player).length;
  if (mine === total) { st.over = { win: true, msg: '천하를 통일했다.' }; return; }
  if (mine === 0) { st.over = { win: false, msg: '세력이 무너졌다.' }; return; }
  const alive = st.factions.filter((f) => f.alive);
  if (alive.length === 1 && alive[0].id === st.player) {
    st.over = { win: true, msg: '천하를 통일했다.' };
  }
}

/** 세력 순위 — 국력 순 */
export function rankings(st) {
  return st.factions
    .filter((f) => f.alive)
    .map((f) => ({
      f,
      cities: factionCities(st, f.id).length,
      officers: factionOfficers(st, f.id).length,
      troops: factionCities(st, f.id).reduce((a, c) => a + c.troops, 0),
      power: power(st, f.id),
    }))
    .sort((a, b) => b.power - a.power);
}
