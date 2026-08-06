// 화면 흐름 — 타이틀 → 전략 → 전투 → 전략.

import { CITIES } from '../data/cities.js';
import { OFFICERS } from '../data/officers.js';
import { SCENARIOS } from '../data/scenarios.js';
import { num, comma, dateLabel, eun, euro } from '../core/util.js';
import { rng } from '../core/rng.js';
import {
  newGame, base, NEUTRAL, factionCities, factionOfficers, officerState, isRulerOf,
  saveLocal, loadLocal, saveSlots, deleteSlot, serialize, deserialize, power,
} from '../game/state.js';
import { beginMonth, endMonth, rankings } from '../game/turn.js';
import { startBattle, resolveBattle } from '../game/battle/engine.js';
import { info } from '../game/city.js';
import { eff, overall } from '../game/officer.js';
import { MapView, cityTip } from './mapview.js';
import { BattleView } from './battleview.js';
import { renderSide } from './city.js';
import { infoDialog } from './lists.js';
import { el, clear, $, $$, showModal, closeModal, toast, sleep } from './dom.js';
import { portrait } from './portrait.js';

export class Game {
  constructor() {
    this.st = null;
    this.selected = -1;
    this.map = null;
    this.pickedScenario = null;
    this.pickedLord = -1;
    this.bindTitle();
    this.showScreen('title');
    this.buildScenarioList();
  }

  showScreen(id) {
    for (const s of $$('.screen')) s.classList.toggle('active', s.id === id);
  }

  /* ═══════════════ 타이틀 ═══════════════ */

  bindTitle() {
    $('#lord-back').onclick = () => {
      $('#lord-pick').classList.add('hidden');
      $('#scenario-list').classList.remove('hidden');
    };
    $('#lord-start').onclick = () => this.start();
    $('#btn-load').onclick = () => this.loadDialog();
  }

  buildScenarioList() {
    const host = clear($('#scenario-list'));
    for (const sc of SCENARIOS) {
      host.append(el('button', { class: 'scenario', onClick: () => this.pickScenario(sc) },
        el('div', { class: 'yr' }, `${sc.year}년 ${sc.month}월`),
        el('div', { class: 'nm' }, sc.title),
        el('div', { class: 'ds' }, sc.desc)));
    }
  }

  pickScenario(sc) {
    this.pickedScenario = sc;
    this.pickedLord = -1;
    // 미리 한 판 만들어 세력 상태를 보여준다
    const preview = newGame(sc.id, 0, 20260806);
    $('#scenario-list').classList.add('hidden');
    $('#lord-pick').classList.remove('hidden');
    $('#lord-pick-title').textContent = `${sc.title} — 군주를 고르시오`;
    const host = clear($('#lord-list'));
    const order = preview.factions
      .map((f, i) => ({ f, i, p: power(preview, i), cities: factionCities(preview, i).length }))
      .filter((x) => x.f.alive)
      .sort((a, b) => b.p - a.p);
    for (const { f, i, cities } of order) {
      const ro = OFFICERS[f.ruler];
      const offs = factionOfficers(preview, i).length;
      const troops = factionCities(preview, i).reduce((a, c) => a + c.troops, 0);
      const node = el('button', { class: 'lord', onClick: () => this.pickLord(i, node) },
        portrait(ro, 44),
        el('div', {},
          el('div', { class: 'nm' }, f.rulerName),
          el('div', { class: 'meta' }, `${f.name}  ·  성 ${cities}  무장 ${offs}`),
          el('div', { class: 'meta' }, `병력 ${num(troops)}`)));
      host.append(node);
    }
    $('#lord-start').disabled = true;
  }

  pickLord(i, node) {
    this.pickedLord = i;
    for (const n of $$('#lord-list .lord')) n.classList.remove('sel');
    node.classList.add('sel');
    $('#lord-start').disabled = false;
  }

  start() {
    if (!this.pickedScenario || this.pickedLord < 0) return;
    this.st = newGame(this.pickedScenario.id, this.pickedLord, (Date.now() >>> 0) || 1);
    beginMonth(this.st);
    this.enterStrategy();
    const f = this.st.factions[this.st.player];
    toast(`${euro(f.rulerName)} 시작한다. ${dateLabel(this.st.year, this.st.month)}`, 3600);
  }

  /* ═══════════════ 전략 ═══════════════ */

  enterStrategy() {
    this.showScreen('strategy');
    if (!this.map) {
      this.map = new MapView($('#map'), {
        onPick: (id) => { this.selected = id; this.map.selected = id; this.refresh(); },
        onHover: (id, x, y) => this.tip(id, x, y),
      });
      $('#btn-end').onclick = () => this.endTurn();
      $('#btn-save').onclick = () => this.saveDialog();
      $('#btn-info').onclick = () => infoDialog(this.st, this.ctx());
      $('#btn-fit').onclick = () => this.map.fit();
      $('#btn-log').onclick = () => this.logDialog();
      // 화면이 바뀌면 상단바 표기와 지도 크기를 다시 잡는다
      window.addEventListener('resize', () => { if (this.st) this.refresh(); });
    }
    // 시작 위치는 군주가 있는 성
    if (this.selected < 0) {
      const ruler = officerState(this.st, this.st.factions[this.st.player].ruler);
      const cs = factionCities(this.st, this.st.player);
      this.selected = ruler ? ruler.city : (cs.length ? cs[0].id : -1);
      this.map.selected = this.selected;
    }
    this.map.resize();
    this.refresh();
  }

  ctx() {
    return {
      refresh: () => this.refresh(),
      launchBattle: (from, to, picks) => this.launchBattle(from, to, picks),
    };
  }

  tip(id, x, y) {
    const t = $('#map-tip');
    if (id === null || id === undefined || id < 0) { t.classList.add('hidden'); return; }
    t.textContent = cityTip(this.st, id);
    t.classList.remove('hidden');
    const r = $('#map-wrap').getBoundingClientRect();
    t.style.left = `${Math.min(x + 14, r.width - 190)}px`;
    t.style.top = `${Math.min(y + 14, r.height - 96)}px`;
  }

  refresh() {
    const st = this.st;
    $('#date-label').textContent = dateLabel(st.year, st.month);
    $('#date-short').textContent = `${st.year}년 ${st.month}월`;
    const f = st.factions[st.player];
    $('#faction-badge').style.background = f.color;
    $('#faction-name').textContent = `${f.name} — ${f.rulerName}`;

    const cs = factionCities(st, st.player);
    const offs = factionOfficers(st, st.player);
    const idle = offs.filter((s) => !s.acted && st.cities[s.city].faction === st.player).length;
    const rank = rankings(st).findIndex((r) => r.f.id === st.player) + 1;
    // class="opt" 인 것은 폰 가로에서 숨는다 (style.css 의 .stats .opt)
    clear($('#top-stats')).append(
      el('span', {}, '성 ', el('b', {}, cs.length)),
      el('span', { class: 'opt' }, '무장 ', el('b', {}, offs.length)),
      el('span', {}, '병력 ', el('b', {}, num(cs.reduce((a, c) => a + c.troops, 0)))),
      el('span', {}, '금 ', el('b', {}, comma(cs.reduce((a, c) => a + c.gold, 0)))),
      el('span', { class: 'opt' }, '군량 ', el('b', {}, num(cs.reduce((a, c) => a + c.food, 0)))),
      el('span', { class: 'opt' }, '순위 ', el('b', {}, `${rank}/${rankings(st).length}`)),
      el('span', { style: { color: idle ? '#e2b271' : '' } }, '대기 ', el('b', {}, idle)),
    );

    this.map.resize();
    this.map.draw(st);
    renderSide(st, this.selected, this.ctx());
    this.renderLog();
  }

  /** 로그바가 없는 좁은 화면에서 기록을 본다 */
  logDialog() {
    const body = el('div', { style: { fontSize: '.86rem', lineHeight: '1.7' } });
    const lines = this.st.log.slice(-120).reverse();
    if (!lines.length) body.append(el('p', { class: 'muted' }, '아직 적을 것이 없다.'));
    for (const l of lines) body.append(el('div', {}, l));
    return showModal({ title: '기록', body, buttons: [{ label: '닫기', value: null }] });
  }

  renderLog() {
    const host = clear($('#log'));
    const lines = this.st.reports.length ? this.st.reports : this.st.log.slice(-40).map((l) => l);
    for (const line of lines.slice(-60)) {
      host.append(el('div', { class: /빼앗|무너|전사|자립|모반|돌아섰/.test(line) ? 'hot' : '' }, line));
    }
    host.scrollTop = host.scrollHeight;
  }

  /* ═══════════════ 턴 ═══════════════ */

  async endTurn() {
    const st = this.st;
    const idle = factionOfficers(st, st.player)
      .filter((s) => !s.acted && st.cities[s.city].faction === st.player).length;
    if (idle > 0) {
      const go = await showModal({
        title: '턴 종료',
        body: el('p', {}, `아직 명을 받지 않은 무장이 ${idle}명 있소. 그대로 달을 넘기겠소?`),
        buttons: [{ label: '더 쓰겠다', value: false }, { label: '넘긴다', value: true, primary: true }],
      });
      if (!go) return;
    }
    $('#btn-end').disabled = true;
    await this.advance();
    $('#btn-end').disabled = false;
  }

  async advance() {
    const st = this.st;
    let guard = 0;
    while (guard++ < 40) {
      const r = endMonth(st);
      if (!r.interrupted) break;
      // 적이 우리 성으로 밀려왔다
      const b = st.battle;
      const cityName = info(st.cities[b.cityId]).name;
      const attacker = st.factions[b.attFid].name;
      await showModal({
        title: '급보', body: el('p', {}, `${attacker}의 군세가 ${euro(cityName)} 밀려온다!`),
        buttons: [{ label: '맞선다', value: null, primary: true }],
      });
      await this.runBattle(b);
      st.battle = null;
    }
    this.refresh();
    if (st.reports.length) toast(st.reports[st.reports.length - 1], 3400);
    if (st.over) this.gameOver();
  }

  /* ═══════════════ 전투 ═══════════════ */

  launchBattle(fromId, toId, picks) {
    const b = startBattle(this.st, fromId, toId, picks);
    if (b.error) { toast(b.error); return; }
    b.playerSide = 'A';
    this.runBattle(b);
  }

  runBattle(battle) {
    return new Promise((resolve) => {
      this.showScreen('battle');
      const view = new BattleView(battle, (b) => {
        view.destroy();
        const res = resolveBattle(this.st, b);
        this.showScreen('strategy');
        this.map.resize();
        if (res.taken) this.selected = b.cityId;
        this.map.selected = this.selected;
        this.refresh();
        this.afterBattle(res, b).then(resolve);
      });
      this.view = view;
    });
  }

  async afterBattle(res, b) {
    const body = el('div');
    for (const line of res.lines) body.append(el('p', { style: { margin: '4px 0' } }, line));
    if (res.killed.length) body.append(el('p', {}, `전사 — ${res.killed.join(', ')}`));
    if (res.captured.length) body.append(el('p', {}, `포로 — ${res.captured.join(', ')}`));
    const surv = b.units.filter((u) => !u.dead);
    body.append(el('p', { class: 'muted', style: { fontSize: '.84rem' } },
      `${b.day}일 만에 끝났다. 남은 부대 ${surv.length}`));
    await showModal({ title: '전투 결과', body, buttons: [{ label: '알겠다', value: null, primary: true }] });

    // 우리가 이겨 포로를 잡았으면 바로 처분한다
    const mine = this.st.officers.filter((s) => s.status === 'captive' && s.captiveOf === this.st.player);
    for (const p of mine) await this.captiveDialog(p);
    this.refresh();
  }

  async captiveDialog(p) {
    const o = base(p);
    const ruler = isRulerOf(this.st, p);
    const body = el('div', { class: 'row', style: { gap: '14px' } },
      portrait(o, 80),
      el('div', {},
        el('div', { style: { fontSize: '1.2rem', fontWeight: '700' } }, o.name,
          ruler ? el('span', { style: { marginLeft: '8px', color: 'var(--seal)', fontSize: '.86rem' } }, '君') : null),
        el('div', { class: 'muted' }, `육지 ${o.lead}  무력 ${o.war}  지력 ${o.int}  정치 ${o.pol}`),
        el('div', { class: 'muted' }, `야망 ${o.amb}  의리 ${o.duty}`),
        // 군주는 거둘 수 없다 — 목을 베거나 놓아주는 수밖에
        ruler ? el('div', { style: { marginTop: '6px', fontSize: '.84rem' } },
          `${this.st.factions[p.faction].name}의 주인이다. 무릎 꿇릴 수는 없다.`) : null));
    const buttons = [{ label: '참수', value: '참수' }, { label: '석방', value: '석방' }];
    if (!ruler) buttons.push({ label: '등용', value: '등용', primary: true });
    const act = await showModal({ title: `포로 ${o.name}`, body, buttons });
    const { captiveAction } = await import('../game/commands.js');
    const cityId = p.city;
    if (act === '등용') {
      const here = this.st.officers.filter((s) => s.city === cityId && s.faction === this.st.player);
      const persuader = here.sort((a, b) => eff(b).cha - eff(a).cha)[0];
      const r = captiveAction(this.st, cityId, p.id, '등용', persuader?.id);
      toast(r.msg);
      if (!r.success) {
        const again = await showModal({
          title: '거절', body: el('p', {}, `${eun(o.name)} 응하지 않았다. 어찌하겠소?`),
          buttons: [{ label: '가두어 둔다', value: null }, { label: '석방', value: '석방' }, { label: '참수', value: '참수' }],
        });
        if (again) toast(captiveAction(this.st, cityId, p.id, again).msg);
      }
    } else if (act) {
      toast(captiveAction(this.st, cityId, p.id, act).msg);
    }
  }

  /* ═══════════════ 마무리 ═══════════════ */

  async gameOver() {
    const st = this.st;
    await showModal({
      title: st.over.win ? '천하통일' : '멸망',
      body: el('div', {},
        el('p', { style: { fontSize: '1.2rem' } }, st.over.msg),
        el('p', { class: 'muted' }, `${dateLabel(st.year, st.month)}`)),
      buttons: [{ label: '처음으로', value: null, primary: true }],
    });
    location.reload();
  }

  /* ═══════════════ 세이브 ═══════════════ */

  async saveDialog() {
    const body = el('div');
    for (const s of saveSlots()) {
      body.append(el('button', {
        class: 'btn wide', style: { marginBottom: '5px', textAlign: 'left' },
        onClick: () => closeModal(s.slot),
      }, s.empty ? `${s.slot}. — 빈 칸 —` : `${s.slot}. ${s.title}  ${s.year}년 ${s.month}월  ${s.faction} (${s.cities}성)`));
    }
    body.append(el('button', { class: 'btn wide', style: { marginTop: '8px' }, onClick: () => closeModal('file') }, '파일로 내보내기'));
    const slot = await showModal({ title: '저장', body, buttons: [{ label: '그만', value: null }] });
    if (slot === 'file') {
      const blob = new Blob([serialize(this.st)], { type: 'application/json' });
      const a = el('a', { href: URL.createObjectURL(blob), download: `삼국지_${this.st.year}년${this.st.month}월.json` });
      a.click();
      URL.revokeObjectURL(a.href);
      return;
    }
    if (slot) { saveLocal(this.st, slot); toast(`${slot}번에 저장했다.`); }
  }

  async loadDialog() {
    const body = el('div');
    for (const s of saveSlots()) {
      body.append(el('button', {
        class: 'btn wide', style: { marginBottom: '5px', textAlign: 'left' },
        disabled: s.empty, onClick: () => closeModal(s.slot),
      }, s.empty ? `${s.slot}. — 빈 칸 —` : `${s.slot}. ${s.title}  ${s.year}년 ${s.month}월  ${s.faction} (${s.cities}성)`));
    }
    const file = el('input', { type: 'file', accept: '.json', style: { marginTop: '8px' } });
    file.addEventListener('change', async () => {
      const f = file.files[0];
      if (!f) return;
      try {
        this.st = deserialize(await f.text());
        closeModal(null);
        this.enterStrategy();
        toast('불러왔다.');
      } catch (e) { toast('세이브를 읽지 못했다.'); }
    });
    body.append(el('div', { class: 'muted', style: { fontSize: '.82rem', marginTop: '8px' } }, '파일에서 불러오기'), file);

    const slot = await showModal({ title: '불러오기', body, buttons: [{ label: '그만', value: null }] });
    if (!slot) return;
    const st = loadLocal(slot);
    if (!st) { toast('빈 칸이다.'); return; }
    this.st = st;
    this.selected = -1;
    this.enterStrategy();
    toast('불러왔다.');
  }
}
