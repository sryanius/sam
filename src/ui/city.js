// 도시 패널과 커맨드 대화상자.

import { CITIES, ADJ, DIST } from '../data/cities.js';
import { OFFICERS } from '../data/officers.js';
import { TREASURE_BY_ID } from '../data/treasures.js';
import { num, comma, grade, clamp, affinityGap } from '../core/util.js';
import {
  base, NEUTRAL, officerState, membersIn, freeIn, captivesIn, factionCities, isAllied, isRulerOf,
} from '../game/state.js';
import { caps, info, goldIncome, harvest, foodUpkeep, troopCap, conscriptMax, conscriptCost } from '../game/city.js';
import { eff, recruitChance, overall, isHermit } from '../game/officer.js';
import * as CMD from '../game/commands.js';
import { MAX_UNITS } from '../game/battle/engine.js';
import { SHIPS, availableShips, shipCost } from '../data/ships.js';
import { troopType } from '../data/officers.js';
import { el, clear, showModal, closeModal, toast, bar, slider, $ } from './dom.js';
import { portrait } from './portrait.js';
import { eul, eun, gwa } from '../core/util.js';

/* ═══════════════════════════ 사이드 패널 ═══════════════════════════ */

/** 성 정보 / 무장 탭. 도시를 바꿔도 보던 탭을 유지한다. */
let sideTab = 'city';

export function renderSide(st, cityId, ctx) {
  renderCommandBar(st, cityId, ctx);

  const host = clear($('#side-content'));
  if (cityId < 0) { host.append(el('p', { class: 'muted' }, '도시를 고르시오.')); return; }

  const ci = CITIES[cityId];
  const c = st.cities[cityId];
  const f = c.faction === NEUTRAL ? null : st.factions[c.faction];

  host.append(el('div', { class: 'panel-h' },
    ci.name, el('span', { class: 'hanja' }, ci.hanja),
    el('span', { class: 'owner' },
      f ? el('span', { class: 'badge', style: { background: f.color } }) : null, ' ', f ? f.name : '공백지'),
  ));

  const pane = el('div');
  const tabs = el('div', { class: 'tabs side-tabs' });
  const tab = (label, id) => tabs.append(el('button', {
    class: 'btn' + (sideTab === id ? ' on' : ''),
    onClick: () => { sideTab = id; renderSide(st, cityId, ctx); },
  }, label));
  tab('성 정보', 'city');
  tab(`무장 ${membersIn(st, cityId, c.faction).length}`, 'officers');
  host.append(tabs, pane);

  if (sideTab === 'officers') officerPane(st, cityId, pane, ctx);
  else cityPane(st, cityId, pane, ctx);
}

function cityPane(st, cityId, host, ctx) {
  const c = st.cities[cityId];
  const k = caps(c);

  const kv = el('div', { class: 'kv' });
  const row = (kk, v, extra) => { kv.append(el('span', { class: 'k' }, kk), el('span', { class: 'v' }, v), el('span', {}, extra || '')); };
  row('금', comma(c.gold), `+${comma(goldIncome(c))}/월`);
  row('군량', num(c.food), `-${num(foodUpkeep(c))}/월`);
  row('병력', num(c.troops), `/${num(troopCap(c))}`);
  row('훈련', Math.round(c.train), grade(c.train));
  row('사기', Math.round(c.morale), grade(c.morale));
  row('민충', Math.round(c.loyal), grade(c.loyal));
  row('인구', num(c.pop), '');
  host.append(kv);

  for (const [label, cur, cap] of [
    ['토지', c.land, k.land], ['치수', c.flood, k.flood], ['상업', c.comm, k.comm],
    ['기술', c.tech, k.tech], ['성벽', c.wall, k.wall],
  ]) {
    host.append(el('div', { class: 'meter' },
      el('div', { class: 'meter-h' },
        el('span', { class: 'k' }, label),
        el('span', { class: 'v' }, `${cur} / ${cap}`)),
      bar(cur, cap, 1.01, 0.2)));
  }

  // 남의 성이면 외교 상태를 덧붙인다
  if (c.faction !== st.player && c.faction !== NEUTRAL && st.factions[st.player]) {
    const rel = st.factions[st.player].relation[c.faction] ?? 0;
    const ally = isAllied(st, st.player, c.faction);
    const truce = st.factions[st.player].truce[c.faction];
    host.append(el('p', { class: 'muted', style: { fontSize: '.8rem', marginTop: '10px' } },
      `우호 ${rel}${ally ? ' · 동맹' : ''}${truce ? ` · 화친 ${truce}개월` : ''}`));
  }
}

function officerPane(st, cityId, host, ctx) {
  const c = st.cities[cityId];
  const mine = c.faction === st.player;

  const here = membersIn(st, cityId, c.faction);
  if (!here.length) host.append(el('p', { class: 'muted', style: { fontSize: '.82rem' } }, '지키는 자가 없다.'));
  else {
    host.append(el('div', { class: 'sec' }, `소속 ${here.length}`));
    for (const s of here.sort((a, b) => overall(base(b)) - overall(base(a)))) {
      host.append(officerRow(st, s, c, ctx));
    }
  }

  const free = freeIn(st, cityId).filter((s) => s.found || mine);
  if (mine && free.length) {
    host.append(el('div', { class: 'sec' }, `재야 ${free.length}`));
    for (const s of free) host.append(officerRow(st, s, c, ctx, true));
  }
  const captives = captivesIn(st, cityId);
  if (captives.length) {
    host.append(el('div', { class: 'sec' }, `포로 ${captives.length}`));
    for (const s of captives) host.append(officerRow(st, s, c, ctx, true));
  }
  host.append(el('p', { class: 'muted', style: { fontSize: '.74rem', marginTop: '8px' } },
    '이름을 누르면 상세와 처분이 나온다.'));
}

/* ─────────────────── 왼쪽 명령 세로바 ─────────────────── */

function renderCommandBar(st, cityId, ctx) {
  const bar_ = clear($('#cmdbar'));
  if (cityId < 0) return;
  const c = st.cities[cityId];
  const mine = c.faction === st.player;

  const add = (label, fn, cls = 'btn') => bar_.append(el('button', { class: cls, onClick: fn }, label));

  if (mine) {
    bar_.append(el('div', { class: 'cmd-head' }, '명령'));
    add('내정', () => devDialog(st, cityId, ctx));
    add('군사', () => militaryDialog(st, cityId, ctx));
    add('인사', () => personnelDialog(st, cityId, ctx));
    add('계략', () => plotDialog(st, cityId, ctx));
    add('외교', () => diplomacyDialog(st, cityId, ctx));
    add('상인', () => merchantDialog(st, cityId, ctx));
    bar_.append(el('div', { class: 'cmd-gap' }));
    add('출진', () => marchTargetDialog(st, cityId, ctx), 'btn primary');
    return;
  }

  // 남의 성 — 인접한 아군 성이 있으면 칠 수 있다
  const froms = ADJ[cityId].map((e) => st.cities[e.to]).filter((x) => x.faction === st.player);
  bar_.append(el('div', { class: 'cmd-head' }, froms.length ? '군사' : '—'));
  if (froms.length) add('출진', () => marchDialog(st, cityId, ctx), 'btn primary');
  else bar_.append(el('p', { class: 'muted', style: { fontSize: '.7rem', textAlign: 'center', margin: '4px 2px' } },
    '이웃한 아군 성이 없다'));
}

function officerRow(st, s, c, ctx, plain = false) {
  const o = eff(s);
  const gov = c.governor === s.id;
  const isRuler = c.faction !== NEUTRAL && st.factions[c.faction].ruler === s.id;
  return el('div', {
    class: 'off-row' + (s.acted && !plain ? ' done' : ''),
    onClick: () => officerDialog(st, s, ctx),
  },
    el('span', { class: 'nm' }, o.name),
    isRuler ? el('span', { class: 'gov' }, '君') : gov ? el('span', { class: 'gov' }, '太') : null,
    el('span', { class: 'st' }, `${o.lead} ${o.war} ${o.int} ${o.pol} ${o.cha}`),
    el('span', { class: 'loy' }, s.status === 'captive' ? '포로' : s.faction === NEUTRAL ? '재야' : `충 ${Math.round(s.loyalty)}`),
  );
}

/* ═══════════════════════════ 무장 상세 ═══════════════════════════ */

export async function officerDialog(st, s, ctx) {
  const o = base(s), e = eff(s);
  const f = s.faction === NEUTRAL ? null : st.factions[s.faction];
  const ruler = f ? OFFICERS[f.ruler] : null;

  const body = el('div');
  const head = el('div', { class: 'row', style: { gap: '14px', alignItems: 'flex-start' } });
  head.append(portrait(o, 96));
  const meta = el('div');
  meta.append(el('div', { style: { fontSize: '1.5rem', fontWeight: '700' } }, o.name,
    el('span', { class: 'hanja', style: { marginLeft: '8px', fontSize: '.9rem', color: '#7d7259' } }, o.hanja)));
  meta.append(el('div', { class: 'muted', style: { fontSize: '.84rem' } },
    `${o.born}~${o.died}  ·  ${st.year - o.born}세  ·  ${f ? f.name + '군' : '재야'}`
    + (s.status === 'captive' ? '  · 포로' : '')));
  const tbl = el('table', { class: 'grid', style: { marginTop: '8px', maxWidth: '360px' } });
  const trow = (a, b, c2, d) => tbl.append(el('tr', {},
    el('td', {}, a), el('td', { class: 'n' }, b), el('td', {}, c2), el('td', { class: 'n' }, d)));
  // 해마다 자란 만큼을 옆에 보인다 — 어느 무장이 크고 있는지 알아야 키울 맛이 난다
  const stat = (k, label) => {
    const g = (s.growth || {})[k] || 0;
    return `${e[k]} ${grade(e[k])}${g ? `  +${g}` : ''}`;
  };
  trow('육지', stat('lead'), '수지', stat('navy'));
  trow('무력', stat('war'), '지력', stat('int'));
  trow('정치', stat('pol'), '매력', stat('cha'));
  trow('야망', o.amb, '의리', o.duty);
  trow('충성', s.faction === NEUTRAL ? '—' : Math.round(s.loyalty),
       '상성', ruler ? `${affinityGap(o.comp, ruler.comp)} (군주와)` : o.comp);
  trow('병종', troopType(o), '공적', s.merit);
  trow('보물', s.treasures.map((t) => TREASURE_BY_ID[t]?.name).join(', ') || '—', '', '');
  meta.append(tbl);
  head.append(meta);
  body.append(head);

  const buttons = [{ label: '닫기', value: null }];
  const c = st.cities[s.city];
  const mine = c && c.faction === st.player;

  if (mine && s.faction === st.player) {
    if (!s.acted) buttons.unshift({ label: '이동', value: 'move' });
    buttons.unshift({ label: '포상', value: 'reward' });
    if (c.governor !== s.id) buttons.unshift({ label: '태수로', value: 'gov' });
    if (st.factions[st.player].ruler !== s.id) buttons.unshift({ label: '추방', value: 'dismiss' });
  }
  if (mine && s.faction === NEUTRAL && s.status === 'normal') buttons.unshift({ label: '등용', value: 'recruit' });
  if (mine && s.status === 'captive' && s.captiveOf === st.player) {
    buttons.unshift({ label: '참수', value: 'exec' }, { label: '석방', value: 'free' });
    // 군주는 거둘 수 없다 — 목을 베거나 놓아주는 수밖에
    if (!isRulerOf(st, s)) buttons.unshift({ label: '등용', value: 'crecruit' });
    else body.append(el('p', { class: 'muted', style: { marginTop: '10px', fontSize: '.84rem' } },
      `${eun(o.name)} ${st.factions[s.faction].name}의 주인이다. 무릎 꿇릴 수는 없다.`));
  }

  const act = await showModal({ title: '무장', body, buttons });
  if (!act) return;

  if (act === 'gov') say(CMD.appointGovernor(st, c.id, s.id));
  else if (act === 'dismiss') {
    if (await confirmBox(`${eul(o.name)} 정말 내치겠소?`)) say(CMD.dismiss(st, s.id));
  } else if (act === 'reward') await rewardDialog(st, c.id, s);
  else if (act === 'move') await moveDialog(st, s);
  else if (act === 'recruit') await recruitDialog(st, c.id, s);
  else if (act === 'crecruit') {
    const p = await pickOfficer(st, c.id, { title: '누가 설득하겠소?', filter: (x) => !x.acted && x.faction === st.player });
    if (p) say(CMD.captiveAction(st, c.id, s.id, '등용', p.id));
  } else if (act === 'exec') {
    if (await confirmBox(`${o.name}의 목을 베겠소?`)) say(CMD.captiveAction(st, c.id, s.id, '참수'));
  } else if (act === 'free') say(CMD.captiveAction(st, c.id, s.id, '석방'));

  ctx.refresh();
}

/* ═══════════════════════════ 공통 고르기 ═══════════════════════════ */

export function pickOfficer(st, cityId, { title, filter = () => true, note, extra }) {
  const list = st.officers.filter((s) => s.city === cityId && filter(s));
  if (!list.length) { toast('명을 받을 무장이 없다.'); return Promise.resolve(null); }
  const body = el('div');
  if (note) body.append(el('p', { class: 'muted', style: { fontSize: '.84rem', marginTop: 0 } }, note));
  const tbl = el('table', { class: 'grid' });
  tbl.append(el('tr', {}, ...['무장', '육지', '무력', '지력', '정치', '매력', '충성', extra ? '적성' : ''].filter(Boolean).map((h) => el('th', {}, h))));
  for (const s of list.sort((a, b) => overall(base(b)) - overall(base(a)))) {
    const o = eff(s);
    const tr = el('tr', { style: { cursor: 'pointer' }, onClick: () => closeModal(s) },
      el('td', {}, o.name + (s.acted ? ' (수행)' : '')),
      el('td', { class: 'n' }, o.lead), el('td', { class: 'n' }, o.war), el('td', { class: 'n' }, o.int),
      el('td', { class: 'n' }, o.pol), el('td', { class: 'n' }, o.cha),
      el('td', { class: 'n' }, s.faction === NEUTRAL ? '—' : Math.round(s.loyalty)));
    if (extra) tr.append(el('td', { class: 'n' }, extra(s)));
    tbl.append(tr);
  }
  body.append(el('div', { class: 'scroll-x' }, tbl));
  return showModal({ title, body, buttons: [{ label: '그만', value: null }] });
}

function chooseList(title, items, label, note) {
  const body = el('div');
  if (note) body.append(el('p', { class: 'muted', style: { fontSize: '.84rem', marginTop: 0 } }, note));
  for (const it of items) {
    body.append(el('button', {
      class: 'btn wide', style: { marginBottom: '5px', textAlign: 'left' },
      onClick: () => closeModal(it),
    }, label(it)));
  }
  return showModal({ title, body, buttons: [{ label: '그만', value: null }] });
}

function confirmBox(msg) {
  return showModal({
    title: '확인', body: el('p', {}, msg),
    buttons: [{ label: '아니오', value: false }, { label: '그리하라', value: true, primary: true }],
  });
}

function say(r) { if (r && r.msg) toast(r.msg); return r; }

/* ═══════════════════════════ 내정 ═══════════════════════════ */

async function devDialog(st, cityId, ctx) {
  const c = st.cities[cityId];
  const k = caps(c);
  const kinds = [
    ...Object.entries(CMD.DEV_KINDS).map(([name, K]) => ({
      name, cost: K.cost, desc: K.desc, cur: c[K.field], cap: k[K.cap],
    })),
    { name: '순찰', cost: 80, desc: '민심을 다독인다', cur: Math.round(c.loyal), cap: 100 },
  ];
  const pick = await chooseList('내정', kinds,
    (x) => `${x.name}  ${x.cur}/${x.cap}   (금 ${x.cost})  — ${x.desc}`,
    `금 ${comma(c.gold)}`);
  if (!pick) return;

  const s = await pickOfficer(st, cityId, {
    title: `${pick.name} — 누구에게 맡기겠소?`,
    filter: (x) => x.faction === st.player && !x.acted && x.status === 'normal',
    extra: (x) => {
      const o = eff(x);
      return pick.name === '순찰' ? Math.round(o.cha * 0.7 + o.pol * 0.3) : Math.round(o.pol * 0.75 + o.int * 0.25);
    },
  });
  if (!s) return;

  if (pick.name === '순찰') say(CMD.patrol(st, cityId, s.id));
  else {
    const maxInvest = Math.min(c.gold, 600);
    const sl = slider('투입 금', pick.cost, Math.max(pick.cost, maxInvest), pick.cost, (v) => `${v}금`);
    const go = await showModal({
      title: `${pick.name} — 얼마를 쓰겠소?`, body: sl,
      buttons: [{ label: '그만', value: null }, { label: '시행', value: 'go', primary: true }],
    });
    if (go) say(CMD.develop(st, cityId, s.id, pick.name, sl.get()));
  }
  ctx.refresh();
}

/* ═══════════════════════════ 군사 ═══════════════════════════ */

async function militaryDialog(st, cityId, ctx) {
  const c = st.cities[cityId];
  const pick = await chooseList('군사', [
    { k: '징병', d: `병력 ${num(c.troops)} / ${num(troopCap(c))}` },
    { k: '훈련', d: `훈련도 ${Math.round(c.train)}` },
    { k: '수송', d: '인접 아군 성으로 금·군량·병력을 보낸다' },
    { k: '출진', d: '이웃한 성을 친다' },
  ], (x) => `${x.k} — ${x.d}`);
  if (!pick) return;

  if (pick.k === '출진') { await marchTargetDialog(st, cityId, ctx); return; }

  if (pick.k === '수송') {
    const dests = ADJ[cityId].map((e) => st.cities[e.to]).filter((x) => x.faction === st.player);
    if (!dests.length) { toast('이웃한 아군 성이 없다.'); return; }
    const to = await chooseList('어디로 보내겠소?', dests, (x) => info(x).name);
    if (!to) return;
    const s = await pickOfficer(st, cityId, { title: '누가 호송하겠소?', filter: (x) => x.faction === st.player && !x.acted });
    if (!s) return;
    const g = slider('금', 0, c.gold, 0, (v) => comma(v));
    const fd = slider('군량', 0, c.food, 0, (v) => num(v));
    const tr = slider('병력', 0, c.troops, 0, (v) => num(v));
    const go = await showModal({
      title: `${info(c).name} → ${info(to).name}`, body: el('div', {}, g, fd, tr),
      buttons: [{ label: '그만', value: null }, { label: '보낸다', value: 'go', primary: true }],
    });
    if (go) say(CMD.transport(st, cityId, to.id, s.id, { gold: g.get(), food: fd.get(), troops: tr.get() }));
    ctx.refresh();
    return;
  }

  const s = await pickOfficer(st, cityId, {
    title: `${pick.k} — 누구에게 맡기겠소?`,
    filter: (x) => x.faction === st.player && !x.acted && x.status === 'normal',
    extra: (x) => (pick.k === '징병' ? eff(x).cha : Math.round(eff(x).lead * 0.7 + eff(x).war * 0.3)),
  });
  if (!s) return;

  if (pick.k === '훈련') say(CMD.drill(st, cityId, s.id));
  else {
    const max = Math.min(conscriptMax(c, eff(s)), Math.floor(c.gold / 0.08));
    if (max < 100) { toast('뽑을 장정도, 낼 금도 없다.'); return; }
    const sl = slider('징집', 100, max, Math.min(max, Math.floor(max * 0.6)),
      (v) => `${num(v)}명 · 금 ${conscriptCost(v)}`);
    const go = await showModal({
      title: '징병', body: el('div', {}, el('p', { class: 'muted', style: { fontSize: '.84rem' } },
        '많이 뽑을수록 민심이 상하고 훈련도가 떨어진다.'), sl),
      buttons: [{ label: '그만', value: null }, { label: '징집', value: 'go', primary: true }],
    });
    if (go) say(CMD.conscript(st, cityId, s.id, sl.get()));
  }
  ctx.refresh();
}

/* ═══════════════════════════ 인사 ═══════════════════════════ */

async function personnelDialog(st, cityId, ctx) {
  const c = st.cities[cityId];
  const free = freeIn(st, cityId);
  const pick = await chooseList('인사', [
    { k: '탐색', d: '숨은 인재와 보물을 찾는다 (금 50)' },
    { k: '등용', d: `이 성의 재야 ${free.filter((s) => s.found).length}명 (금 100)` },
    { k: '포상', d: '금을 내려 충성을 산다' },
    { k: '임명', d: '태수를 세운다' },
    { k: '이동', d: '무장을 다른 성으로 보낸다' },
  ], (x) => `${x.k} — ${x.d}`);
  if (!pick) return;

  if (pick.k === '탐색') {
    const s = await pickOfficer(st, cityId, {
      title: '탐색 — 누구를 보내겠소?',
      filter: (x) => x.faction === st.player && !x.acted && x.status === 'normal',
      extra: (x) => Math.round(eff(x).int * 0.6 + eff(x).cha * 0.4),
    });
    if (s) say(CMD.doSearch(st, cityId, s.id));
  } else if (pick.k === '등용') {
    const target = await pickOfficer(st, cityId, {
      title: '누구를 부르겠소?',
      filter: (x) => x.faction === NEUTRAL && x.status === 'normal' && x.found,
      note: '탐색으로 찾아낸 재야만 부를 수 있다.',
    });
    if (target) await recruitDialog(st, cityId, target);
  } else if (pick.k === '포상') {
    const t = await pickOfficer(st, cityId, { title: '누구에게 내리겠소?', filter: (x) => x.faction === st.player });
    if (t) await rewardDialog(st, cityId, t);
  } else if (pick.k === '임명') {
    const t = await pickOfficer(st, cityId, { title: '누구를 태수로 삼겠소?', filter: (x) => x.faction === st.player });
    if (t) say(CMD.appointGovernor(st, cityId, t.id));
  } else if (pick.k === '이동') {
    const t = await pickOfficer(st, cityId, { title: '누구를 보내겠소?', filter: (x) => x.faction === st.player && !x.acted });
    if (t) await moveDialog(st, t);
  }
  ctx.refresh();
}

async function recruitDialog(st, cityId, target) {
  const p = await pickOfficer(st, cityId, {
    title: `${eul(base(target).name)} 누가 설득하겠소?`,
    filter: (x) => x.faction === st.player && !x.acted && x.status === 'normal',
    extra: (x) => `${recruitChance(st, st.player, x, target)}%`,
    note: isHermit(base(target)) ? '이 사람은 벼슬에 뜻이 없어 보인다.' : null,
  });
  if (p) say(CMD.recruit(st, cityId, p.id, target.id));
}

async function rewardDialog(st, cityId, target) {
  const c = st.cities[cityId];
  if (c.gold < 50) { toast('내릴 금이 없다.'); return; }
  const sl = slider('금', 50, Math.min(c.gold, 2000), Math.min(c.gold, 300), (v) => `${v}금`);
  const go = await showModal({
    title: `${base(target).name}에게 포상`,
    body: el('div', {}, el('p', { class: 'muted', style: { fontSize: '.84rem' } },
      `지금 충성 ${Math.round(target.loyalty)}`), sl),
    buttons: [{ label: '그만', value: null }, { label: '내린다', value: 'go', primary: true }],
  });
  if (go) say(CMD.reward(st, cityId, st.factions[st.player].ruler, target.id, sl.get()));
}

async function moveDialog(st, s) {
  const dests = factionCities(st, st.player)
    .filter((x) => x.id !== s.city && DIST[s.city][x.id] <= 8)
    .sort((a, b) => DIST[s.city][a.id] - DIST[s.city][b.id]);
  if (!dests.length) { toast('갈 만한 성이 없다.'); return; }
  const to = await chooseList(`${base(s).name} — 어디로?`, dests,
    (x) => `${info(x).name}   (${DIST[s.city][x.id]}일)   무장 ${membersIn(st, x.id, st.player).length}`);
  if (to) say(CMD.moveOfficer(st, s.id, to.id));
}

/* ═══════════════════════════ 계략 ═══════════════════════════ */

async function plotDialog(st, cityId, ctx) {
  const c = st.cities[cityId];
  const kind = await chooseList('계략', Object.entries(CMD.PLOTS).map(([k, P]) => ({ k, ...P })),
    (x) => `${x.k}  (금 ${x.cost}) — ${x.desc}`, `금 ${comma(c.gold)}`);
  if (!kind) return;

  const targets = ADJ[cityId].map((e) => st.cities[e.to])
    .filter((x) => x.faction !== NEUTRAL && x.faction !== st.player);
  if (!targets.length) { toast('이웃에 적의 성이 없다.'); return; }
  const tc = await chooseList('어느 성에?', targets,
    (x) => `${info(x).name}  [${st.factions[x.faction].name}]  민충 ${Math.round(x.loyal)}`);
  if (!tc) return;

  let targetOfficer = -1;
  if (kind.k === '유언비어' || kind.k === '이간') {
    const t = await pickOfficer(st, tc.id, {
      title: '누구를 겨냥하겠소?',
      filter: (x) => x.faction === tc.faction && x.status === 'normal',
    });
    if (!t) return;
    targetOfficer = t.id;
  }
  const s = await pickOfficer(st, cityId, {
    title: '누가 꾸미겠소?',
    filter: (x) => x.faction === st.player && !x.acted && x.status === 'normal',
    extra: (x) => eff(x).int,
  });
  if (s) say(CMD.plot(st, cityId, s.id, kind.k, tc.id, targetOfficer));
  ctx.refresh();
}

/* ═══════════════════════════ 외교 ═══════════════════════════ */

async function diplomacyDialog(st, cityId, ctx) {
  const c = st.cities[cityId];
  const me = st.factions[st.player];
  const others = st.factions.filter((f) => f.alive && f.id !== st.player);
  if (!others.length) { toast('상대할 세력이 없다.'); return; }

  const target = await chooseList('어느 세력과?', others, (f) => {
    const rel = f.relation[st.player] ?? 0;
    const ally = me.allies.includes(f.id) ? ' [동맹]' : '';
    const tr = me.truce[f.id] ? ` [화친 ${me.truce[f.id]}개월]` : '';
    return `${f.name}   군주 ${f.rulerName}   성 ${factionCities(st, f.id).length}   우호 ${rel}${ally}${tr}`;
  });
  if (!target) return;

  const kind = await chooseList('무엇을?', [
    { k: '우호', d: '예물을 보내 사이를 좋게 한다' },
    { k: '화친', d: '한동안 서로 치지 않기로 한다' },
    { k: '동맹', d: '함께 싸우기로 맹세한다' },
    { k: '파기', d: '맹약을 깬다 — 명성이 떨어진다' },
  ], (x) => `${x.k} — ${x.d}`);
  if (!kind) return;

  let gold = 0;
  if (kind.k !== '파기') {
    const sl = slider('예물(금)', 0, Math.min(c.gold, 3000), Math.min(c.gold, 300), (v) => `${v}금`);
    const go = await showModal({
      title: `${target.name}에 ${kind.k}`, body: sl,
      buttons: [{ label: '그만', value: null }, { label: '보낸다', value: 'go', primary: true }],
    });
    if (!go) return;
    gold = sl.get();
  }
  const s = await pickOfficer(st, cityId, {
    title: '누구를 사자로 보내겠소?',
    filter: (x) => x.faction === st.player && !x.acted && x.status === 'normal',
    extra: (x) => Math.round(eff(x).int * 0.4 + eff(x).cha * 0.6),
  });
  if (s) say(CMD.diplomacy(st, cityId, s.id, kind.k, target.id, gold));
  ctx.refresh();
}

/* ═══════════════════════════ 상인 ═══════════════════════════ */

async function merchantDialog(st, cityId, ctx) {
  const c = st.cities[cityId];
  const r = CMD.merchantRates(c);
  const kind = await chooseList('상인', [
    { k: '군량구입', d: `금 10 당 군량 ${Math.round(100 * r.buyFood)}석` },
    { k: '군량매각', d: `군량 10석 당 금 ${r.sellFood.toFixed(2)}` },
  ], (x) => `${x.k} — ${x.d}`, `금 ${comma(c.gold)}   군량 ${num(c.food)}`);
  if (!kind) return;
  const max = kind.k === '군량구입' ? c.gold : c.food;
  if (max < 10) { toast('거래할 것이 없다.'); return; }
  const sl = slider(kind.k === '군량구입' ? '금' : '군량', 10, max, Math.floor(max / 3), (v) => num(v));
  const go = await showModal({
    title: kind.k, body: sl,
    buttons: [{ label: '그만', value: null }, { label: '거래', value: 'go', primary: true }],
  });
  if (go) say(CMD.trade(st, cityId, kind.k, sl.get()));
  ctx.refresh();
}

/* ═══════════════════════════ 출진 ═══════════════════════════ */

async function marchTargetDialog(st, fromId, ctx) {
  const targets = ADJ[fromId].map((e) => st.cities[e.to]).filter((x) => x.faction !== st.player);
  if (!targets.length) { toast('이웃에 칠 성이 없다.'); return; }
  const to = await chooseList('어느 성을 치겠소?', targets, (x) => {
    const f = x.faction === NEUTRAL ? '공백지' : st.factions[x.faction].name;
    const blocked = x.faction !== NEUTRAL && (isAllied(st, st.player, x.faction) ? ' [동맹]'
      : st.factions[st.player].truce[x.faction] ? ' [화친 중]' : '');
    return `${info(x).name}  [${f}]  병력 ${num(x.troops)}  무장 ${membersIn(st, x.id, x.faction).length}${blocked}`;
  });
  if (to) await marchDialog(st, to.id, ctx, fromId);
}

export async function marchDialog(st, toId, ctx, fromId = -1) {
  const to = st.cities[toId];
  if (fromId < 0) {
    const froms = ADJ[toId].map((e) => st.cities[e.to]).filter((x) => x.faction === st.player);
    if (!froms.length) { toast('출진할 성이 없다.'); return; }
    const f = froms.length === 1 ? froms[0]
      : await chooseList('어느 성에서?', froms, (x) => `${info(x).name}  병력 ${num(x.troops)}  군량 ${num(x.food)}`);
    if (!f) return;
    fromId = f.id;
  }
  const from = st.cities[fromId];

  if (to.faction !== NEUTRAL) {
    if (isAllied(st, st.player, to.faction)) {
      if (!await confirmBox(`${eun(st.factions[to.faction].name)} 동맹이오. 맹약을 깨겠소?`)) return;
      CMD.diplomacy(st, fromId, st.factions[st.player].ruler, '파기', to.faction, 0);
    } else if (st.factions[st.player].truce[to.faction]) {
      if (!await confirmBox(`${gwa(st.factions[to.faction].name)} 화친 중이오. 깨겠소?`)) return;
      CMD.diplomacy(st, fromId, st.factions[st.player].ruler, '파기', to.faction, 0);
    }
  }

  const pool = membersIn(st, fromId, st.player).filter((s) => !s.acted);
  if (!pool.length) { toast('출진할 무장이 없다.'); return; }

  // 편성 화면 — 병종은 무장마다 고정이라 고르지 못한다. 배만 고른다.
  const chosen = new Map();   // officerId -> { troops }
  const waterRoute = !!(ADJ[fromId].find((e) => e.to === toId)?.water);
  const techRatio = from.tech / caps(from).tech;
  const ships = availableShips(techRatio);
  let ship = waterRoute && ships.length ? ships[ships.length - 1] : null;

  const body = el('div');
  body.append(el('p', { class: 'muted', style: { fontSize: '.84rem', marginTop: 0 } },
    `${info(from).name} → ${info(to).name}   ·   병력 ${num(from.troops)}   군량 ${num(from.food)}`
    + `   ·   적 병력 ${num(to.troops)}`
    + (waterRoute ? '   ·   물길이다 — 배가 없으면 뗏목으로 싸운다' : '')));

  // ─ 배 고르기 ─
  const shipRow = el('div', { style: { margin: '8px 0' } });
  const shipNote = el('div', { class: 'muted', style: { fontSize: '.78rem', marginTop: '3px' } });
  const shipBtns = el('div', { class: 'tabs' });
  const setShip = (v) => {
    ship = v;
    [...shipBtns.children].forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
    const S = v ? SHIPS[v] : null;
    shipNote.textContent = S
      ? `${S.desc}  ·  물 위 전투력 ×${S.power}, 이동 ${S.mp}  ·  부대당 금 ${S.cost}`
      : '배 없이 간다. 물에 들어가면 뗏목이라 전투력이 반토막 난다.';
    update();
  };
  for (const v of [null, ...ships]) {
    shipBtns.append(el('button', {
      class: 'btn', 'data-v': String(v),
      onClick: () => setShip(v),
    }, v || '없음'));
  }
  shipRow.append(el('div', { style: { fontSize: '.82rem', color: 'var(--seal)' } },
    `배  (${info(from).name}의 기술로 지을 수 있는 것)`), shipBtns, shipNote);
  if (ships.length === 0) shipNote.textContent = '기술이 모자라 아직 배를 짓지 못한다.';

  const totalLine = el('div', { style: { margin: '6px 0', fontWeight: '600' } });
  const tbl = el('table', { class: 'grid' });
  tbl.append(el('tr', {}, ...['출진', '무장', '병종', '육지', '수지', '무력', '지력', '병력'].map((h) => el('th', {}, h))));

  const update = () => {
    const t = [...chosen.values()].reduce((a, x) => a + x.troops, 0);
    const foodNeed = Math.round(t);
    const gold = shipCost(ship) * chosen.size;
    const bad = t > from.troops ? '  ← 병력 초과'
      : foodNeed > from.food ? '  ← 군량 부족'
      : gold > from.gold ? '  ← 금 부족' : '';
    totalLine.textContent = `부대 ${chosen.size}/${MAX_UNITS}   총 병력 ${num(t)}`
      + `   군량 ${num(foodNeed)}` + (gold ? `   배값 ${gold}` : '') + bad;
    totalLine.style.color = bad ? 'var(--bad)' : '';
  };

  const perUnit = Math.max(500, Math.floor(from.troops * 0.8 / Math.min(pool.length, MAX_UNITS)));
  for (const s of pool.sort((a, b) => eff(b).lead + eff(b).war - eff(a).lead - eff(a).war)) {
    const o = eff(s);
    const cb = el('input', { type: 'checkbox' });
    const nInput = el('input', {
      type: 'number', min: 100, max: from.troops, step: 100, value: perUnit,
      style: { width: '5.6em' },
    });
    const sync = () => {
      if (cb.checked) {
        if (!chosen.has(s.id) && chosen.size >= MAX_UNITS) { cb.checked = false; toast(`부대는 ${MAX_UNITS}개까지.`); return; }
        chosen.set(s.id, { troops: clamp(+nInput.value || 0, 100, from.troops) });
      } else chosen.delete(s.id);
      update();
    };
    cb.addEventListener('change', sync);
    nInput.addEventListener('input', sync);
    tbl.append(el('tr', {},
      el('td', {}, cb), el('td', {}, o.name),
      el('td', {}, troopType(o)),
      el('td', { class: 'n' }, o.lead), el('td', { class: 'n' }, o.navy),
      el('td', { class: 'n' }, o.war), el('td', { class: 'n' }, o.int),
      el('td', {}, nInput)));
  }
  body.append(shipRow, totalLine, el('div', { class: 'scroll-x' }, tbl));
  setShip(ship);

  const go = await showModal({
    title: '출진', body,
    buttons: [{ label: '그만', value: null }, { label: '진군', value: 'go', primary: true }],
  });
  if (!go) return;
  if (!chosen.size) { toast('부대를 골라야 하오.'); return; }
  const gold = shipCost(ship) * chosen.size;
  if (gold > from.gold) { toast('배를 지을 금이 모자라다.'); return; }
  from.gold -= gold;

  const picks = [...chosen.entries()].map(([officerId, v]) => ({ officerId, ...v, ship }));
  ctx.launchBattle(fromId, toId, picks);
}
