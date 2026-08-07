// 일람 — 세력 순위, 무장, 도시, 연표.

import { CITIES } from '../data/cities.js';
import { OFFICERS, troopType } from '../data/officers.js';
import { num, comma, grade, dateLabel } from '../core/util.js';
import { base, NEUTRAL, factionCities, factionOfficers, power } from '../game/state.js';
import { caps, info, troopCap } from '../game/city.js';
import { eff, overall } from '../game/officer.js';
import { rankings } from '../game/turn.js';
import { el, clear, showModal, closeModal } from './dom.js';
import { officerDialog } from './city.js';

export function infoDialog(st, ctx) {
  const body = el('div');
  const tabs = el('div', { class: 'tabs' });
  const pane = el('div', { style: { maxHeight: '58vh', overflow: 'auto' } });
  const TABS = [
    ['세력', () => factionsPane(st)],
    ['무장', () => officersPane(st, ctx)],
    ['도시', () => citiesPane(st)],
    ['연표', () => logPane(st)],
  ];
  let cur = 0;
  const show = (i) => {
    cur = i;
    [...tabs.children].forEach((b, j) => b.classList.toggle('on', j === i));
    clear(pane).append(TABS[i][1]());
  };
  TABS.forEach(([label], i) => tabs.append(el('button', { class: 'btn', onClick: () => show(i) }, label)));
  body.append(tabs, pane);
  show(0);
  return showModal({ title: '일람', body, buttons: [{ label: '닫기', value: null }] });
}

function table(headers, rows) {
  const t = el('table', { class: 'grid' });
  t.append(el('tr', {}, ...headers.map((h) => el('th', {}, h))));
  for (const r of rows) t.append(r);
  return el('div', { class: 'scroll-x' }, t);   // 좁은 화면에서는 가로로 굴린다
}

function factionsPane(st) {
  const rows = rankings(st).map((r, i) => el('tr', {},
    el('td', { class: 'n' }, i + 1),
    el('td', {}, el('span', { class: 'badge', style: { background: r.f.color } }), ' ' + r.f.name + (r.f.id === st.player ? ' ★' : '')),
    el('td', {}, r.f.rulerName),
    el('td', { class: 'n' }, r.cities),
    el('td', { class: 'n' }, r.officers),
    el('td', { class: 'n' }, num(r.troops)),
    el('td', { class: 'n' }, comma(factionCities(st, r.f.id).reduce((a, c) => a + c.gold, 0))),
    el('td', {}, r.f.allies.map((x) => st.factions[x]?.name).filter(Boolean).join(', ') || '—'),
  ));
  return table(['', '세력', '군주', '성', '무장', '병력', '금', '동맹'], rows);
}

function officersPane(st, ctx) {
  const wrap = el('div');
  const ctrl = el('div', { class: 'row', style: { marginBottom: '6px' } });
  const search = el('input', { type: 'text', placeholder: '이름으로 찾기', style: { flex: '1', padding: '4px 6px' } });
  const scope = el('select', {},
    el('option', { value: 'mine' }, '우리 세력'),
    el('option', { value: 'all' }, '전체'),
    el('option', { value: 'free' }, '재야'));
  const sortSel = el('select', {},
    ...[['overall', '종합'], ['lead', '육지'], ['navy', '수지'], ['war', '무력'], ['int', '지력'], ['pol', '정치'], ['cha', '매력'], ['loyalty', '충성']]
      .map(([v, l]) => el('option', { value: v }, l)));
  ctrl.append(search, scope, sortSel);
  const host = el('div');

  const rebuild = () => {
    const q = search.value.trim();
    let list = st.officers.filter((s) => s.status !== 'dead');
    if (scope.value === 'mine') list = list.filter((s) => s.faction === st.player);
    else if (scope.value === 'free') list = list.filter((s) => s.faction === NEUTRAL);
    if (q) list = list.filter((s) => base(s).name.includes(q) || base(s).hanja.includes(q));
    const key = sortSel.value;
    list.sort((a, b) => key === 'overall' ? overall(base(b)) - overall(base(a))
      : key === 'loyalty' ? b.loyalty - a.loyalty
      : eff(b)[key] - eff(a)[key]);

    const rows = list.slice(0, 300).map((s) => {
      const o = eff(s);
      const f = s.faction === NEUTRAL ? '재야' : st.factions[s.faction].name;
      return el('tr', { style: { cursor: 'pointer' }, onClick: () => { closeModal(); officerDialog(st, s, ctx); } },
        el('td', {}, o.name),
        el('td', {}, f),
        el('td', {}, info(st.cities[s.city]).name),
        el('td', {}, troopType(o)),
        el('td', { class: 'n' }, o.lead), el('td', { class: 'n' }, o.navy),
        el('td', { class: 'n' }, o.war), el('td', { class: 'n' }, o.int),
        el('td', { class: 'n' }, o.pol), el('td', { class: 'n' }, o.cha),
        el('td', { class: 'n' }, s.faction === NEUTRAL ? '—' : Math.round(s.loyalty)),
        el('td', { class: 'n' }, st.year - o.born));
    });
    clear(host).append(table(['무장', '소속', '위치', '병종', '육지', '수지', '무력', '지력', '정치', '매력', '충성', '나이'], rows));
    if (list.length > 300) host.append(el('p', { class: 'muted' }, `… 외 ${list.length - 300}명`));
  };
  search.addEventListener('input', rebuild);
  scope.addEventListener('change', rebuild);
  sortSel.addEventListener('change', rebuild);
  rebuild();
  wrap.append(ctrl, host);
  return wrap;
}

function citiesPane(st) {
  const rows = st.cities
    .slice()
    .sort((a, b) => (a.faction === st.player ? -1 : 0) - (b.faction === st.player ? -1 : 0) || a.id - b.id)
    .map((c) => {
      const ci = CITIES[c.id];
      const k = caps(c);
      const f = c.faction === NEUTRAL ? '공백지' : st.factions[c.faction].name;
      return el('tr', {},
        el('td', {}, ci.name),
        el('td', {}, ci.region),
        el('td', {}, f),
        el('td', { class: 'n' }, num(c.troops)),
        el('td', { class: 'n' }, comma(c.gold)),
        el('td', { class: 'n' }, num(c.food)),
        el('td', { class: 'n' }, num(c.pop)),
        el('td', { class: 'n' }, `${c.land}/${k.land}`),
        el('td', { class: 'n' }, `${c.comm}/${k.comm}`),
        el('td', { class: 'n' }, Math.round(c.loyal)));
    });
  return table(['도시', '주', '세력', '병력', '금', '군량', '인구', '토지', '상업', '민충'], rows);
}

function logPane(st) {
  const d = el('div', { style: { fontSize: '.84rem', lineHeight: '1.7' } });
  for (const line of st.log.slice(-200).reverse()) d.append(el('div', {}, line));
  if (!st.log.length) d.append(el('p', { class: 'muted' }, '아직 적을 것이 없다.'));
  return d;
}
