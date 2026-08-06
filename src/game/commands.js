// 커맨드 — 무장 하나가 한 달에 하나씩 실행한다.
//
// 모든 커맨드는 { ok, msg, ...extra } 를 돌려준다. ok:false 면 아무것도 바뀌지 않는다.
// 실행에 성공하면 무장의 acted 가 true 가 되어 그 달에는 더 못 움직인다.

import { CITIES, ADJ, DIST } from '../data/cities.js';
import { OFFICERS } from '../data/officers.js';
import { TREASURE_BY_ID, TREASURES } from '../data/treasures.js';
import { clamp, num, eul, eun, iga, gwa, euro } from '../core/util.js';
import { rng } from '../core/rng.js';
import {
  base, NEUTRAL, officerState, membersIn, factionCities, factionOfficers, isAllied,
} from './state.js';
import {
  caps, devGain, patrolGain, trainGain, conscriptMax, conscriptCost, troopCap, info,
} from './city.js';
import {
  eff, recruitChance, rewardGain, treasureGain, search, plotChance,
  executeEffect, releaseEffect, isHermit,
} from './officer.js';

const ok = (msg, extra = {}) => ({ ok: true, msg, ...extra });
const no = (msg) => ({ ok: false, msg });

function spend(s) { s.acted = true; }

/* ══════════════════════════════ 내정 ══════════════════════════════ */

export const DEV_KINDS = {
  개간: { field: 'land',  cap: 'land',  cost: 120, desc: '농지를 넓혀 수확을 늘린다' },
  치수: { field: 'flood', cap: 'flood', cost: 120, desc: '제방을 쌓아 수해를 막는다' },
  상업: { field: 'comm',  cap: 'comm',  cost: 120, desc: '저자를 키워 금 수입을 늘린다' },
  기술: { field: 'tech',  cap: 'tech',  cost: 150, desc: '무기와 공성 병기의 질을 올린다' },
  축성: { field: 'wall',  cap: 'wall',  cost: 200, desc: '성벽을 높여 농성에 대비한다' },
};

export function develop(st, cityId, officerId, kind, invest = null) {
  const K = DEV_KINDS[kind];
  if (!K) return no('그런 내정은 없다');
  const c = st.cities[cityId];
  const s = officerState(st, officerId);
  if (!s || s.acted) return no('이미 명을 받았다');
  const cost = invest ?? K.cost;
  if (c.gold < cost) return no(`금이 모자라다 (${cost} 필요)`);

  const k = caps(c);
  if (c[K.field] >= k[K.cap]) return no(`${info(c).name}의 ${eun(kind)} 더 올릴 곳이 없다`);

  const g = devGain(eff(s), c[K.field], k[K.cap], cost);
  c.gold -= cost;
  c[K.field] = Math.min(k[K.cap], c[K.field] + g);
  spend(s);
  return ok(`${iga(base(s).name)} ${info(c).name}의 ${eul(kind)} 맡았다. ${kind} +${g}`, { gain: g });
}

export function patrol(st, cityId, officerId) {
  const c = st.cities[cityId];
  const s = officerState(st, officerId);
  if (!s || s.acted) return no('이미 명을 받았다');
  if (c.gold < 80) return no('금이 모자라다 (80 필요)');
  const g = patrolGain(eff(s), c.loyal);
  c.gold -= 80;
  c.loyal = clamp(c.loyal + g, 0, 100);
  spend(s);
  return ok(`${iga(base(s).name)} 성 안팎을 돌며 백성을 위무했다. 민충 +${g}`, { gain: g });
}

/* ══════════════════════════════ 군사 ══════════════════════════════ */

export function conscript(st, cityId, officerId, amount) {
  const c = st.cities[cityId];
  const s = officerState(st, officerId);
  if (!s || s.acted) return no('이미 명을 받았다');
  const max = conscriptMax(c, eff(s));
  if (max <= 0) return no('더 이상 뽑을 장정이 없다');
  const n = clamp(Math.round(amount), 100, max);
  const cost = conscriptCost(n);
  if (c.gold < cost) return no(`금이 모자라다 (${cost} 필요)`);

  c.gold -= cost;
  c.troops += n;
  c.pop -= n;
  c.loyal = clamp(c.loyal - Math.round(n / max * 7) - 1, 0, 100);
  c.train = Math.round((c.train * (c.troops - n) + 20 * n) / c.troops); // 신병이 훈련도를 깎는다
  spend(s);
  return ok(`${info(c).name}에서 ${num(n)}명을 징집했다. (금 ${cost})`, { n });
}

export function drill(st, cityId, officerId) {
  const c = st.cities[cityId];
  const s = officerState(st, officerId);
  if (!s || s.acted) return no('이미 명을 받았다');
  if (c.gold < 60) return no('금이 모자라다 (60 필요)');
  if (c.troops <= 0) return no('훈련시킬 병사가 없다');
  const g = trainGain(eff(s), c.train);
  c.gold -= 60;
  c.train = clamp(c.train + g, 0, 100);
  c.morale = clamp(c.morale + Math.round(g / 3), 0, 100);
  spend(s);
  return ok(`${iga(base(s).name)} 군을 조련했다. 훈련도 +${g}`, { gain: g });
}

/** 수송 — 인접한 아군 도시로 금·군량·병력을 보낸다 */
export function transport(st, fromId, toId, officerId, { gold = 0, food = 0, troops = 0 }) {
  const a = st.cities[fromId], b = st.cities[toId];
  const s = officerState(st, officerId);
  if (!s || s.acted) return no('이미 명을 받았다');
  if (a.faction !== b.faction) return no('아군 도시로만 보낼 수 있다');
  const link = ADJ[fromId].find((e) => e.to === toId);
  if (!link) return no('길이 이어지지 않았다');
  if (gold > a.gold || food > a.food || troops > a.troops) return no('보낼 만큼 있지 않다');
  if (gold + food + troops <= 0) return no('보낼 것을 정하라');

  // 먼 길에는 축이 난다
  const loss = 1 - link.dist * 0.02;
  a.gold -= gold; a.food -= food; a.troops -= troops;
  b.gold += Math.round(gold * loss);
  b.food += Math.round(food * loss);
  b.troops += Math.round(troops * loss);
  spend(s);
  return ok(`${info(a).name}에서 ${euro(info(b).name)} 수송했다.`);
}

/* ══════════════════════════════ 인사 ══════════════════════════════ */

export function doSearch(st, cityId, officerId) {
  const s = officerState(st, officerId);
  if (!s || s.acted) return no('이미 명을 받았다');
  const c = st.cities[cityId];
  if (c.gold < 50) return no('금이 모자라다 (50 필요)');
  c.gold -= 50;
  spend(s);
  const r = search(st, cityId, s, rng);
  if (!r) return ok('두루 살폈으나 이렇다 할 것이 없었다.');
  if (r.kind === '인재') {
    const o = base(r.officer);
    return ok(`재야의 ${eul(o.name)} 찾아냈다! (${o.hanja})`, { found: r.officer });
  }
  s.treasures.push(r.treasure.id);
  return ok(`${eul(r.treasure.name)} 손에 넣었다!`, { treasure: r.treasure });
}

export function recruit(st, cityId, persuaderId, targetId) {
  const p = officerState(st, persuaderId);
  const t = officerState(st, targetId);
  if (!p || p.acted) return no('이미 명을 받았다');
  if (!t) return no('그런 무장이 없다');
  const c = st.cities[cityId];
  const fid = p.faction;
  if (t.faction === fid) return no('이미 우리 사람이다');
  if (c.gold < 100) return no('금이 모자라다 (100 필요)');

  c.gold -= 100;
  spend(p);
  const ch = recruitChance(st, fid, p, t);
  const name = base(t).name;
  if (!rng.pct(ch)) {
    if (t.faction !== NEUTRAL) t.loyalty = clamp(t.loyalty + 2, 0, 100); // 들킨 값
    return ok(`${eun(name)} 응하지 않았다. (성공률 ${ch}%)`, { chance: ch, success: false });
  }
  joinFaction(st, t, fid, cityId);
  return ok(`${iga(name)} 휘하에 들어왔다! (성공률 ${ch}%)`, { chance: ch, success: true });
}

export function joinFaction(st, s, fid, cityId) {
  const wasCaptive = s.status === 'captive';
  s.faction = fid;
  s.status = 'normal';
  s.captiveOf = -1;
  s.found = true;
  if (cityId !== undefined) s.city = cityId;
  const ruler = OFFICERS[st.factions[fid].ruler];
  const o = base(s);
  const gap = ruler ? Math.abs(((o.comp - ruler.comp) % 150 + 150) % 150) : 40;
  const g = Math.min(gap, 150 - gap);
  s.loyalty = clamp(Math.round(78 - g * 0.5 + (o.duty - o.amb) - (wasCaptive ? 10 : 0)), 25, 95);
}

export function reward(st, cityId, rulerOfficerId, targetId, gold) {
  const c = st.cities[cityId];
  const t = officerState(st, targetId);
  if (!t || t.faction === NEUTRAL) return no('우리 무장이 아니다');
  if (gold > c.gold) return no('금이 모자라다');
  if (gold < 50) return no('50 이상은 내려야 체면이 선다');
  const g = rewardGain(base(t), gold, t.loyalty);
  c.gold -= gold;
  t.loyalty = clamp(t.loyalty + g, 0, 100);
  return ok(`${base(t).name}에게 ${eul(`금 ${gold}`)} 내렸다. 충성 +${g}`, { gain: g });
}

export function giveTreasure(st, fromId, toId, treasureId) {
  const from = officerState(st, fromId), to = officerState(st, toId);
  if (!from || !to) return no('대상이 없다');
  const i = from.treasures.indexOf(treasureId);
  if (i < 0) return no('그 보물을 가지고 있지 않다');
  const tr = TREASURE_BY_ID[treasureId];
  from.treasures.splice(i, 1);
  to.treasures.push(treasureId);
  const g = treasureGain(base(to), tr);
  to.loyalty = clamp(to.loyalty + g, 0, 100);
  return ok(`${base(to).name}에게 ${eul(tr.name)} 하사했다. 충성 +${g}`, { gain: g });
}

/** 무장 이동 — 아군 도시로. 거리가 멀면 도착이 늦다. */
export function moveOfficer(st, officerId, toId) {
  const s = officerState(st, officerId);
  if (!s || s.acted) return no('이미 명을 받았다');
  const to = st.cities[toId];
  if (to.faction !== s.faction) return no('아군 도시로만 갈 수 있다');
  if (s.city === toId) return no('이미 그곳에 있다');
  const d = DIST[s.city][toId];
  if (d > 8) return no('너무 멀어 한 달에 닿지 못한다');
  const from = st.cities[s.city];
  if (from.governor === s.id) from.governor = -1;
  s.city = toId;
  spend(s);
  return ok(`${iga(base(s).name)} ${euro(info(to).name)} 떠났다.`);
}

export function appointGovernor(st, cityId, officerId) {
  const c = st.cities[cityId];
  const s = officerState(st, officerId);
  if (!s || s.city !== cityId || s.faction !== c.faction) return no('그 도시에 있는 아군 무장이라야 한다');
  c.governor = officerId;
  return ok(`${eul(base(s).name)} ${info(c).name} 태수로 삼았다.`);
}

export function dismiss(st, officerId) {
  const s = officerState(st, officerId);
  if (!s) return no('그런 무장이 없다');
  const f = st.factions[s.faction];
  if (f && f.ruler === s.id) return no('군주를 내칠 수는 없다');
  const c = st.cities[s.city];
  if (c.governor === s.id) c.governor = -1;
  const name = base(s).name;
  s.faction = NEUTRAL;
  s.loyalty = 0;
  s.found = true;
  return ok(`${eul(name)} 내쳤다.`);
}

/* ─── 포로 ─── */

export function captiveAction(st, cityId, captiveId, action, persuaderId) {
  const t = officerState(st, captiveId);
  if (!t || t.status !== 'captive') return no('포로가 아니다');
  const fid = st.cities[cityId].faction;
  const name = base(t).name;

  if (action === '참수') {
    executeEffect(st, fid, t);
    killOfficer(st, t);
    return ok(`${eul(name)} 목 베었다.`, { dead: true });
  }
  if (action === '석방') {
    releaseEffect(st, fid, t);
    t.status = 'normal';
    const home = t.captiveOf;
    t.captiveOf = -1;
    // 원래 세력 도시 중 가까운 곳으로 돌아간다
    const own = st.cities.filter((c) => c.faction === t.faction);
    if (own.length) own.sort((a, b) => DIST[cityId][a.id] - DIST[cityId][b.id]);
    t.city = own.length ? own[0].id : cityId;
    if (!own.length) t.faction = NEUTRAL;
    return ok(`${eul(name)} 놓아주었다.`);
  }
  if (action === '등용') {
    const p = persuaderId !== undefined ? officerState(st, persuaderId) : null;
    const ch = recruitChance(st, fid, p, t);
    if (!rng.pct(ch)) return ok(`${eun(name)} 고개를 젓는다. (성공률 ${ch}%)`, { chance: ch, success: false });
    joinFaction(st, t, fid, cityId);
    return ok(`${iga(name)} 무릎을 꿇고 따르기로 했다! (성공률 ${ch}%)`, { chance: ch, success: true });
  }
  return no('알 수 없는 처분');
}

export function killOfficer(st, s) {
  const c = st.cities[s.city];
  if (c && c.governor === s.id) c.governor = -1;
  // 보물은 그 도시에 남는다 — 가장 높은 무장이 접수
  const i = st.officers.indexOf(s);
  if (i >= 0) st.officers.splice(i, 1);
  // 군주가 죽으면 후계
  for (const f of st.factions) if (f.alive && f.ruler === s.id) succeed(st, f);
}

/** 군주 사망 시 후계자 — 아들격(성이 같고 나이 어린)이나 최고 실력자 */
export function succeed(st, f) {
  const mine = st.officers.filter((s) => s.faction === f.id && s.status === 'normal');
  if (!mine.length) { f.alive = false; return null; }
  const oldSurname = f.rulerName[0];
  const score = (s) => {
    const o = base(s);
    return (o.name[0] === oldSurname ? 400 : 0) + o.cha * 2 + o.pol + o.lead + s.loyalty;
  };
  mine.sort((a, b) => score(b) - score(a));
  const heir = mine[0];
  f.ruler = heir.id;
  f.rulerName = base(heir).name;
  heir.loyalty = 100;
  // 새 군주와 상성이 다르면 충성이 흔들린다
  for (const s of mine) {
    if (s === heir) continue;
    s.loyalty = clamp(s.loyalty - rng.range(3, 12), 0, 100);
  }
  return heir;
}

/* ══════════════════════════════ 계략 ══════════════════════════════ */

export const PLOTS = {
  유언비어: { cost: 200, desc: '적 무장의 충성을 흔든다' },
  이간:     { cost: 300, desc: '적 무장을 우리 쪽으로 돌아서게 한다' },
  선동:     { cost: 200, desc: '적 도시의 민심을 어지럽힌다' },
  매수:     { cost: 250, desc: '적 도시의 금을 빼돌린다' },
};

export function plot(st, cityId, officerId, kind, targetCityId, targetOfficerId) {
  const P = PLOTS[kind];
  if (!P) return no('그런 계략은 없다');
  const c = st.cities[cityId];
  const s = officerState(st, officerId);
  if (!s || s.acted) return no('이미 명을 받았다');
  if (c.gold < P.cost) return no(`금이 모자라다 (${P.cost} 필요)`);
  const tc = st.cities[targetCityId];
  if (tc.faction === NEUTRAL || tc.faction === s.faction) return no('적 도시라야 한다');

  c.gold -= P.cost;
  spend(s);

  const target = targetOfficerId !== undefined && targetOfficerId >= 0
    ? { type: 'officer', state: officerState(st, targetOfficerId) }
    : { type: 'city', city: tc };
  if (target.type === 'officer' && !target.state) return ok('대상이 이미 그곳에 없다.');

  const ch = plotChance(st, kind, s, target);
  if (!rng.pct(ch)) {
    // 간파당하면 상대 민심/충성이 되레 오른다
    if (target.type === 'city') tc.loyal = clamp(tc.loyal + 2, 0, 100);
    else target.state.loyalty = clamp(target.state.loyalty + 3, 0, 100);
    return ok(`계략이 간파당했다. (성공률 ${ch}%)`, { chance: ch, success: false });
  }

  if (kind === '유언비어') {
    const t = target.state;
    const d = rng.range(10, 24);
    t.loyalty = clamp(t.loyalty - d, 0, 100);
    return ok(`${base(t).name}에 대한 헛소문이 퍼졌다. 충성 -${d}`, { chance: ch, success: true });
  }
  if (kind === '이간') {
    const t = target.state;
    if (t.loyalty > 55) {
      const d = rng.range(12, 22);
      t.loyalty = clamp(t.loyalty - d, 0, 100);
      return ok(`${iga(base(t).name)} 주군을 의심하기 시작했다. 충성 -${d}`, { chance: ch, success: true });
    }
    joinFaction(st, t, s.faction, cityId);
    return ok(`${iga(base(t).name)} 우리 쪽으로 돌아섰다!`, { chance: ch, success: true });
  }
  if (kind === '선동') {
    const d = rng.range(9, 18);
    tc.loyal = clamp(tc.loyal - d, 0, 100);
    return ok(`${info(tc).name}의 민심이 어지러워졌다. 민충 -${d}`, { chance: ch, success: true });
  }
  if (kind === '매수') {
    const take = Math.min(tc.gold, rng.range(200, 700));
    tc.gold -= take;
    c.gold += Math.round(take * 0.7);
    return ok(`${info(tc).name}의 ${eul(`금 ${take}`)} 빼돌렸다.`, { chance: ch, success: true });
  }
  return ok('…');
}

/* ══════════════════════════════ 외교 ══════════════════════════════ */

export function diplomacy(st, cityId, officerId, kind, targetFid, gold = 0) {
  const c = st.cities[cityId];
  const s = officerState(st, officerId);
  if (!s || s.acted) return no('이미 명을 받았다');
  const fid = s.faction;
  if (targetFid === fid) return no('우리 세력이다');
  const tf = st.factions[targetFid];
  if (!tf || !tf.alive) return no('이미 없는 세력이다');
  if (gold > c.gold) return no('금이 모자라다');

  c.gold -= gold;
  spend(s);
  const rel = tf.relation[fid] ?? 0;
  const o = eff(s);
  const ruler = OFFICERS[st.factions[fid].ruler];
  const tRuler = OFFICERS[tf.ruler];
  const bonus = o.int * 0.2 + o.cha * 0.3 + gold / 40 + rel * 0.4;

  if (kind === '우호') {
    const gain = Math.round(6 + bonus / 6);
    tf.relation[fid] = clamp(rel + gain, -100, 100);
    return ok(`${gwa(tf.name)}의 관계가 좋아졌다. (우호 ${tf.relation[fid]})`, { rel: tf.relation[fid] });
  }
  if (kind === '동맹') {
    const ch = clamp(Math.round(bonus - 15), 3, 92);
    if (!rng.pct(ch)) return ok(`${iga(tf.name)} 동맹을 거절했다. (성공률 ${ch}%)`, { chance: ch, success: false });
    if (!st.factions[fid].allies.includes(targetFid)) st.factions[fid].allies.push(targetFid);
    if (!tf.allies.includes(fid)) tf.allies.push(fid);
    tf.relation[fid] = clamp(rel + 30, -100, 100);
    return ok(`${gwa(tf.name)} 동맹을 맺었다!`, { chance: ch, success: true });
  }
  if (kind === '화친') {
    const ch = clamp(Math.round(bonus + 5), 5, 95);
    if (!rng.pct(ch)) return ok(`${iga(tf.name)} 화친을 거절했다. (성공률 ${ch}%)`, { chance: ch, success: false });
    const months = rng.range(12, 30);
    st.factions[fid].truce[targetFid] = months;
    tf.truce[fid] = months;
    return ok(`${gwa(tf.name)} ${months}개월 화친했다.`, { chance: ch, success: true });
  }
  if (kind === '파기') {
    st.factions[fid].allies = st.factions[fid].allies.filter((x) => x !== targetFid);
    tf.allies = tf.allies.filter((x) => x !== fid);
    delete st.factions[fid].truce[targetFid];
    delete tf.truce[fid];
    tf.relation[fid] = clamp(rel - 45, -100, 100);
    st.factions[fid].fame = clamp(st.factions[fid].fame - 8, -60, 200);
    return ok(`${gwa(tf.name)}의 맹약을 깼다.`);
  }
  return no('알 수 없는 외교');
}

/* ══════════════════════════════ 상인 ══════════════════════════════ */

/** 상인은 몇 달에 한 번 도시에 들른다. 시세는 도시 상업에 따라 조금 다르다. */
export function merchantRates(c) {
  const k = caps(c);
  const q = 0.9 + (c.comm / k.comm) * 0.3;
  return {
    buyFood: +(1 / (q * 1.1)).toFixed(3),   // 금 1 당 살 수 있는 군량 배수
    sellFood: +(q * 0.55).toFixed(3),       // 군량 1 당 받는 금
  };
}

export function trade(st, cityId, kind, amount) {
  const c = st.cities[cityId];
  const r = merchantRates(c);
  if (kind === '군량구입') {
    const cost = Math.round(amount);
    if (c.gold < cost) return no('금이 모자라다');
    const got = Math.round(amount * 10 * r.buyFood);
    c.gold -= cost; c.food += got;
    return ok(`군량 ${num(got)}석을 사들였다. (금 ${cost})`);
  }
  if (kind === '군량매각') {
    if (c.food < amount) return no('군량이 모자라다');
    const got = Math.round(amount / 10 * r.sellFood);
    c.food -= amount; c.gold += got;
    return ok(`군량 ${num(amount)}석을 팔아 ${eul(`금 ${got}`)} 얻었다.`);
  }
  return no('알 수 없는 거래');
}

export function buyTreasure(st, cityId, officerId, treasureId, price) {
  const c = st.cities[cityId];
  const s = officerState(st, officerId);
  if (!s) return no('무장이 없다');
  if (c.gold < price) return no('금이 모자라다');
  c.gold -= price;
  s.treasures.push(treasureId);
  return ok(`${eul(TREASURE_BY_ID[treasureId].name)} 사들였다.`);
}

export { TREASURES, TREASURE_BY_ID };
