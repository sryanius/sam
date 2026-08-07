// 전투 화면 — 육각 전장 그리기와 조작.

import { OFFICERS } from '../data/officers.js';
import { num, clamp, iga, eul } from '../core/util.js';
import {
  TERRAIN, axial, hexToPixel, hexDistance, neighborsOf, DIRS, W, H,
} from '../game/battle/map.js';
import {
  UNIT_TYPES, unitsOf, tileOf, moveOptions, moveUnit, attack, canAttack,
  useTactic, tacticAvailable, TACTICS, canDuel, duelAccepted, duel, retreat,
  canBreak, breakWall, beginSide, endSide, checkOver, MAX_DAYS,
} from '../game/battle/engine.js';
import { aiStep, playSide } from '../game/battle/ai.js';
import { el, clear, $, showModal, closeModal, toast, sleep, bar } from './dom.js';
import { portrait } from './portrait.js';

export class BattleView {
  constructor(battle, onFinish) {
    this.b = battle;
    this.onFinish = onFinish;
    this.cv = $('#bmap');
    this.g = this.cv.getContext('2d');
    this.sel = null;
    this.mode = 'move';
    this.tacticKind = null;
    this.busy = false;
    this.mySide = battle.playerSide || 'A';

    this._resize = () => { this.layout(); this.draw(); };
    window.addEventListener('resize', this._resize);
    this.cv.onpointerdown = (e) => this.click(e);

    $('#btn-battle-end').onclick = () => this.endMyTurn();
    $('#btn-battle-retreat').onclick = () => this.doRetreat();
    $('#btn-battle-auto').onclick = () => this.auto();

    beginSide(battle, 'A');
    this.layout();
    this.render();
    if (this.b.side !== this.mySide) this.runAI();
  }

  destroy() {
    window.removeEventListener('resize', this._resize);
    this._stopPulse();
  }

  /* 범위 표시를 천천히 뛰게 한다 — 부대를 고른 동안에만 돈다.
     느린 맥박이라 60fps 가 필요 없다. 폰 배터리를 생각해 20fps 로 조인다. */
  _startPulse() {
    if (this._raf) return;
    let last = 0;
    const step = (now) => {
      if (!this.sel || this.sel.dead || this.b.over || this._done) {
        this._raf = null; this._pulse = 0; this.draw(); return;
      }
      if (now - last >= 50) {
        last = now;
        this._pulse = (now % 1400) / 1400;
        this.draw();
      }
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  _stopPulse() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._pulse = 0;
  }

  /* ─────────── 배치 ─────────── */

  /** forceW/forceH 를 주면 그 크기로 그린다(이미지 내보내기용). */
  layout(forceW, forceH) {
    const r = this.cv.getBoundingClientRect();
    const w = forceW || r.width, h = forceH || r.height;
    if (w < 2 || h < 2) {
      if (!this._pending) {
        this._pending = true;
        requestAnimationFrame(() => { this._pending = false; this.layout(); this.draw(); });
      }
      return;
    }
    const dpr = forceW ? 1 : Math.min(2, window.devicePixelRatio || 1);
    this.vw = w; this.vh = h;
    this.cv.width = Math.max(1, Math.round(w * dpr));
    this.cv.height = Math.max(1, Math.round(h * dpr));
    this.dpr = dpr;

    // 타일 전체가 들어가는 크기를 찾는다
    const sizeW = w / (Math.sqrt(3) * (W + 0.5) + 0.6);
    const sizeH = h / (1.5 * (H - 1) + 2.2);
    this.size = Math.max(9, Math.min(sizeW, sizeH));

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of Object.values(this.b.map.tiles)) {
      const p = hexToPixel(t.q, t.r, this.size);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    this.ox = (w - (maxX - minX)) / 2 - minX;
    this.oy = (h - (maxY - minY)) / 2 - minY;
  }

  center(t) {
    const p = hexToPixel(t.q, t.r, this.size);
    return [p.x + this.ox, p.y + this.oy];
  }

  tileAt(px, py) {
    let best = null, bd = Infinity;
    for (const t of Object.values(this.b.map.tiles)) {
      const [x, y] = this.center(t);
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d < bd) { bd = d; best = t; }
    }
    // 손가락으로 짚는 것을 감안해 조금 넉넉히 — 어차피 가장 가까운 칸을 고른다
    return bd <= (this.size * 1.25) ** 2 ? best : null;
  }

  /* ─────────── 그리기 ─────────── */

  draw() {
    if (!this.vw) { this.layout(); if (!this.vw) return; }
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#14120e';
    g.fillRect(0, 0, this.vw, this.vh);

    // 길찾기는 render() 에서 한 번만 돌린다 — 맥박 때문에 매 프레임 다시 돌면 아깝다
    const reach = this._reach || {};

    for (const t of Object.values(this.b.map.tiles)) {
      const [x, y] = this.center(t);
      this.hexPath(x, y);
      g.fillStyle = TERRAIN[t.terr].color;
      g.fill();
      if (t.fire > 0) {
        g.fillStyle = `rgba(220,90,30,${0.25 + t.fire * 0.16})`;
        g.fill();
      }
      g.strokeStyle = 'rgba(20,17,12,.5)';
      g.lineWidth = 1;
      g.stroke();
      if (t.core) {
        g.fillStyle = 'rgba(200,60,50,.35)';
        g.fill();
      }

      // 성벽·성문의 내구
      if ((t.terr === '성벽' || t.terr === '성문') && t.maxHp) {
        const p = clamp(t.hp / t.maxHp, 0, 1);
        const bw = this.size * 1.1, bh = Math.max(2, this.size * 0.14);
        g.fillStyle = 'rgba(15,12,8,.8)';
        g.fillRect(x - bw / 2, y + this.size * 0.4, bw, bh);
        g.fillStyle = p > 0.5 ? '#b9a97e' : p > 0.22 ? '#d8a03a' : '#c05545';
        g.fillRect(x - bw / 2, y + this.size * 0.4, bw * p, bh);
        if (t.terr === '성문') {
          g.fillStyle = '#efe0bc';
          g.font = `${Math.max(8, this.size * 0.5)}px serif`;
          g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText('門', x, y - this.size * 0.12);
        }
      }
      if (t.breached) {
        g.fillStyle = 'rgba(160,60,40,.25)';
        g.fill();
      }
    }

    // 갈 수 있는 곳 / 칠 수 있는 곳 — 지형 위에 따로 얹는다.
    // 옅게 칠하기만 하면 지형에 묻힌다. 굵은 윤곽과 표식을 같이 준다.
    this._highlights(g, reach);

    // 부대
    for (const u of this.b.units) {
      if (u.dead) continue;
      const t = this.b.map.tiles[axial(u.q, u.r)];
      if (!t) continue;
      const [x, y] = this.center(t);
      const mine = u.side === this.mySide;
      const s = this.size;

      // 병종에 따라 실루엣이 다르다 — 색(아군/적군)만으로는 한눈에 안 들어온다
      const forward = u.side === 'A' ? 1 : -1;
      const r = s * 0.74;
      this._unitPath(g, x, y, r, u.type, forward);
      g.fillStyle = mine ? '#2f5fa8' : '#a3352b';
      g.fill();
      g.lineWidth = u === this.sel ? 3.2 : 1.4;
      g.strokeStyle = u === this.sel ? '#ffe9a8' : 'rgba(15,12,8,.85)';
      g.stroke();
      if (u.acted && mine) { g.fillStyle = 'rgba(0,0,0,.38)'; g.fill(); }
      if (u.type === '수군') {                     // 돛대
        g.strokeStyle = mine ? '#8fb4e8' : '#e0a49a';
        g.lineWidth = Math.max(1.2, s * 0.08);
        g.beginPath();
        g.moveTo(x, y - r * 0.42); g.lineTo(x, y - r * 1.0);
        g.stroke();
      }

      // 이름 — 삼각형은 무게중심이 아래라 조금 내린다
      const dy = u.type === '궁병' ? s * 0.16 : u.type === '수군' ? s * 0.14 : -s * 0.06;
      g.fillStyle = '#f4e7c8';
      g.font = `${Math.max(9, s * (u.type === '궁병' ? 0.6 : 0.68))}px 'Noto Serif KR', serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(u.name.length > 2 ? u.name.slice(0, 2) : u.name, x, y + dy);

      // 병력 막대
      const bw = s * 1.3, bh = Math.max(2, s * 0.15);
      g.fillStyle = 'rgba(15,12,8,.75)';
      g.fillRect(x - bw / 2, y + s * 0.5, bw, bh);
      g.fillStyle = u.troops / u.maxTroops > 0.4 ? '#6cc06c' : '#d8a03a';
      g.fillRect(x - bw / 2, y + s * 0.5, bw * clamp(u.troops / u.maxTroops, 0, 1), bh);
      // 사기 막대
      g.fillStyle = 'rgba(15,12,8,.75)';
      g.fillRect(x - bw / 2, y + s * 0.5 + bh + 1, bw, bh);
      g.fillStyle = '#7fa8d8';
      g.fillRect(x - bw / 2, y + s * 0.5 + bh + 1, bw * clamp(u.morale / 100, 0, 1), bh);

      if (u.type === '기병') this.mark(g, x + s * 0.55, y - s * 0.55, '騎');
      else if (u.type === '궁병') this.mark(g, x + s * 0.55, y - s * 0.55, '弓');
      else if (u.type === '수군') this.mark(g, x + s * 0.55, y - s * 0.55, '水');
      if (u.confusedFor > 0) this.mark(g, x - s * 0.55, y - s * 0.55, '亂', '#d8a03a');
    }
  }

  /* ─────────── 범위 표시 ───────────
     지형 색이 다양해서 옅게 칠하기만 하면 묻힌다.
     칠 + **영역 바깥 테두리** + 칸마다 표식, 셋을 같이 준다. */

  // 육각형 꼭짓점 e 와 e+1 사이의 변이 향하는 이웃 방향 (map.js 의 DIRS 순서)
  static EDGE_DIR = [1, 0, 5, 4, 3, 2];

  _highlights(g, reach) {
    if (!this.sel) return;
    const moving = this.mode === 'move';
    const tiles = moving
      ? Object.values(reach).map((r) => r.tile)
      : Object.values(this.b.map.tiles).filter((t) => this.inTargetRange(t));
    if (!tiles.length) return;

    const inSet = new Set(tiles.map((t) => axial(t.q, t.r)));
    const s = this.size;
    // 0~1 을 오가는 맥박 — 눈에 걸리라고
    const p = 0.5 + 0.5 * Math.sin((this._pulse ?? 0) * Math.PI * 2);

    // 1) 칠
    g.save();
    g.fillStyle = moving
      ? `rgba(255,226,120,${0.22 + p * 0.12})`
      : `rgba(238,74,58,${0.30 + p * 0.14})`;
    for (const t of tiles) {
      const [x, y] = this.center(t);
      this.hexPath(x, y);
      g.fill();
    }

    // 2) 영역 바깥 테두리 — 안쪽 선이 겹쳐 지저분해지지 않게 경계만
    g.beginPath();
    for (const t of tiles) {
      const [x, y] = this.center(t);
      for (let e = 0; e < 6; e++) {
        const [dq, dr] = DIRS[BattleView.EDGE_DIR[e]];
        if (inSet.has(axial(t.q + dq, t.r + dr))) continue;
        const a0 = Math.PI / 180 * (60 * e - 90);
        const a1 = Math.PI / 180 * (60 * (e + 1) - 90);
        g.moveTo(x + s * Math.cos(a0), y + s * Math.sin(a0));
        g.lineTo(x + s * Math.cos(a1), y + s * Math.sin(a1));
      }
    }
    g.lineWidth = Math.max(2.5, s * 0.16);
    g.lineCap = 'round';
    g.strokeStyle = moving ? '#2a2113' : '#3a1008';
    g.stroke();                                   // 어두운 밑선 — 밝은 지형에서도 뜬다
    g.lineWidth = Math.max(1.6, s * 0.10);
    g.strokeStyle = moving ? '#ffe066' : '#ff8a6e';
    g.stroke();

    // 3) 칸마다 표식
    g.lineWidth = Math.max(1.4, s * 0.09);
    for (const t of tiles) {
      const [x, y] = this.center(t);
      if (moving) {
        g.beginPath();
        g.arc(x, y, s * 0.17, 0, Math.PI * 2);
        g.fillStyle = 'rgba(40,32,16,.55)'; g.fill();
        g.fillStyle = '#ffe066';
        g.beginPath(); g.arc(x, y, s * 0.11, 0, Math.PI * 2); g.fill();
      } else {
        const r = s * (0.30 + p * 0.05);
        g.strokeStyle = 'rgba(40,10,6,.6)';
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = '#ff8a6e';
        g.beginPath();
        g.moveTo(x - r * 0.7, y - r * 0.7); g.lineTo(x + r * 0.7, y + r * 0.7);
        g.moveTo(x + r * 0.7, y - r * 0.7); g.lineTo(x - r * 0.7, y + r * 0.7);
        g.stroke();
      }
    }
    g.restore();
  }

  /* ─────────── 병종별 실루엣 ───────────
     보병 방패 / 기병 화살촉 / 궁병 삼각 / 수군 배.
     forward 는 그 부대가 나아가는 쪽(공격측 +1, 수비측 -1). */
  _unitPath(g, x, y, r, type, forward) {
    g.beginPath();
    if (type === '기병') {                         // 화살촉 — 나아가는 쪽이 뾰족하다
      const f = forward;
      g.moveTo(x + f * r * 1.05, y);
      g.lineTo(x + f * r * 0.20, y - r * 0.92);
      g.lineTo(x - f * r * 0.88, y - r * 0.92);
      g.lineTo(x - f * r * 0.60, y);
      g.lineTo(x - f * r * 0.88, y + r * 0.92);
      g.lineTo(x + f * r * 0.20, y + r * 0.92);
    } else if (type === '궁병') {                  // 위가 뾰족한 삼각
      g.moveTo(x, y - r * 1.05);
      g.lineTo(x + r * 0.98, y + r * 0.72);
      g.lineTo(x - r * 0.98, y + r * 0.72);
    } else if (type === '수군') {                  // 배 — 아래가 좁은 선체
      g.moveTo(x - r, y - r * 0.42);
      g.lineTo(x + r, y - r * 0.42);
      g.lineTo(x + r * 0.62, y + r * 0.86);
      g.lineTo(x - r * 0.62, y + r * 0.86);
    } else {                                       // 보병 — 아래가 뾰족한 방패
      g.moveTo(x - r * 0.88, y - r * 0.92);
      g.lineTo(x + r * 0.88, y - r * 0.92);
      g.lineTo(x + r * 0.88, y + r * 0.18);
      g.lineTo(x, y + r * 1.02);
      g.lineTo(x - r * 0.88, y + r * 0.18);
    }
    g.closePath();
  }

  mark(g, x, y, ch, color = '#f0e0b8') {
    g.fillStyle = 'rgba(15,12,8,.8)';
    g.beginPath(); g.arc(x, y, this.size * 0.30, 0, Math.PI * 2); g.fill();
    g.fillStyle = color;
    g.font = `${Math.max(7, this.size * 0.4)}px serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ch, x, y + 0.5);
  }

  hexPath(x, y) {
    const g = this.g, s = this.size;
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i - 90);
      const px = x + s * Math.cos(a), py = y + s * Math.sin(a);
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath();
  }

  inTargetRange(t) {
    if (!this.sel) return false;
    if (this.mode === 'attack') return t.unit && t.unit.side !== this.sel.side && canAttack(this.b, this.sel, t.unit);
    if (this.mode === 'duel') return t.unit && t.unit.side !== this.sel.side && canDuel(this.b, this.sel, t.unit);
    if (this.mode === 'tactic') return tacticAvailable(this.b, this.sel, this.tacticKind, t);
    if (this.mode === 'siege') return canBreak(this.b, this.sel, t);
    return false;
  }

  /* ─────────── 조작 ─────────── */

  async click(e) {
    if (this.busy || this.b.over || this.b.side !== this.mySide) return;
    const r = this.cv.getBoundingClientRect();
    const t = this.tileAt(e.clientX - r.left, e.clientY - r.top);
    if (!t) return;

    if (this.mode !== 'move' && this.sel && this.inTargetRange(t)) {
      await this.resolveAction(t);
      return;
    }
    if (t.unit && t.unit.side === this.mySide) {
      this.sel = t.unit;
      this.mode = 'move';
      this.render();
      return;
    }
    if (this.sel && this.mode === 'move' && !this.sel.moved) {
      const r2 = moveUnit(this.b, this.sel, t);
      if (r2.ok) { this.render(); return; }
    }
    if (t.unit && this.sel && canAttack(this.b, this.sel, t.unit)) {
      this.mode = 'attack';
      await this.resolveAction(t);
    }
  }

  async resolveAction(t) {
    const u = this.sel;
    this.busy = true;
    try {
      if (this.mode === 'attack') {
        attack(this.b, u, t.unit);
      } else if (this.mode === 'siege') {
        breakWall(this.b, u, t);
      } else if (this.mode === 'tactic') {
        useTactic(this.b, u, this.tacticKind, t);
      } else if (this.mode === 'duel') {
        const foe = t.unit;
        if (!duelAccepted(u, foe)) {
          this.b.log.push(`${iga(foe.name)} 일기토를 마다했다.`);
          u.acted = true;
        } else {
          const d = duel(this.b, u, foe);
          await this.showDuel(u, foe, d);
        }
      }
    } finally {
      this.busy = false;
      this.mode = 'move';
      this.sel = u.dead || u.acted ? null : u;
      this.render();
      this.afterAction();
    }
  }

  afterAction() {
    if (checkOver(this.b)) { this.finish(); return; }
    // 내 부대가 다 움직였으면 자동으로 넘긴다
    if (unitsOf(this.b, this.mySide).every((u) => u.acted)) setTimeout(() => this.endMyTurn(), 350);
  }

  async endMyTurn() {
    if (this.busy || this.b.over) return;
    this.sel = null; this.mode = 'move';
    endSide(this.b);
    this.render();
    if (this.b.over) { this.finish(); return; }
    if (this.b.side !== this.mySide) await this.runAI();
    else this.render();
  }

  async runAI() {
    this.busy = true;
    const foe = this.b.side;
    let guard = 0;
    while (!this.b.over && guard++ < 40) {
      const a = aiStep(this.b, foe);
      if (!a) break;
      this.render();
      await sleep(a.kind === '이동' ? 190 : 340);
      if (a.kind === '일기토' && a.result) await this.showDuel(a.unit, a.foe, a.result);
    }
    this.busy = false;
    if (this.b.over) { this.finish(); return; }
    endSide(this.b);
    this.render();
    if (this.b.over) this.finish();
  }

  async doRetreat() {
    if (this.busy || this.b.over) return;
    const yes = await showModal({
      title: '철수', body: el('p', {}, '군을 물리겠소?'),
      buttons: [{ label: '아니오', value: false }, { label: '물린다', value: true, primary: true }],
    });
    if (!yes) return;
    retreat(this.b, this.mySide);
    this.finish();
  }

  async auto() {
    if (this.busy || this.b.over) return;
    this.busy = true;
    let guard = 0;
    while (!this.b.over && guard++ < 200) {
      playSide(this.b, this.b.side);
      if (this.b.over) break;
      endSide(this.b);
      this.render();
      await sleep(70);
    }
    this.busy = false;
    this.finish();
  }

  finish() {
    if (this._done) return;
    this._done = true;
    this.render();
    setTimeout(() => this.onFinish(this.b), 400);
  }

  /* ─────────── 옆 패널 ─────────── */

  render() {
    // 갈 수 있는 칸은 상태가 바뀔 때만 다시 센다
    this._reach = (this.sel && !this.sel.dead && this.mode === 'move')
      ? moveOptions(this.b, this.sel) : {};
    if (this.sel && !this.sel.dead && !this.b.over) this._startPulse();
    else this._stopPulse();

    this.draw();
    const b = this.b;
    $('#battle-title').textContent = `${b.map.name} 공방전`;
    $('#battle-day').textContent = `${b.day}일 / ${MAX_DAYS}`;
    $('#battle-turn').textContent = b.over ? '끝' : (b.side === this.mySide ? '아군 차례' : '적 차례');

    const info = clear($('#unit-info'));
    const acts = clear($('#unit-actions'));

    // 양군 요약
    const sum = (side) => {
      const us = unitsOf(b, side);
      return `${us.length}부대 ${num(us.reduce((a, u) => a + u.troops, 0))}`;
    };
    info.append(el('div', { style: { fontSize: '.8rem', marginBottom: '5px', display: 'flex', justifyContent: 'space-between' } },
      el('span', {}, `아군 ${sum(this.mySide)}`),
      el('span', {}, `적 ${sum(this.mySide === 'A' ? 'D' : 'A')}`)));

    const u = this.sel;
    if (u && !u.dead) {
      const o = OFFICERS[u.officerId];
      const card = el('div', { class: 'unit-card' });
      card.append(el('div', { class: 'nm' }, u.name, el('span', { style: { fontSize: '.74rem', marginLeft: '6px' } }, u.type)));
      card.append(el('div', {}, `병력 ${num(u.troops)} / ${num(u.maxTroops)}`), bar(u.troops, u.maxTroops));
      card.append(el('div', {}, `사기 ${Math.round(u.morale)}`), bar(u.morale, 100));
      card.append(el('div', {}, `훈련 ${Math.round(u.train)}   이동력 ${u.mp}   계략 ${u.tactics}`));
      if (o) card.append(el('div', { style: { fontSize: '.78rem', color: '#6d6553' } },
        `육지 ${o.lead} 수지 ${o.navy} 무력 ${o.war} 지력 ${o.int}`));
      info.append(card);

      if (b.side === this.mySide && !b.over) {
        const grid = el('div', { class: 'act-grid' });
        const btn = (label, mode, on) => grid.append(el('button', {
          class: 'btn' + (this.mode === mode && (!on || this.tacticKind === on) ? ' on' : ''),
          disabled: u.acted,
          onClick: () => { this.mode = mode; this.tacticKind = on || null; this.render(); },
        }, label));
        btn('이동', 'move');
        btn('공격', 'attack');
        btn('일기토', 'duel');
        if (this.mySide === 'A') {
          const anyWall = Object.values(b.map.tiles).some((t) => canBreak(b, u, t));
          grid.append(el('button', {
            class: 'btn' + (this.mode === 'siege' ? ' on' : ''),
            disabled: u.acted || !anyWall,
            title: '맞닿은 성문·성벽을 두들긴다',
            onClick: () => { this.mode = 'siege'; this.tacticKind = null; this.render(); },
          }, '공성'));
        }
        grid.append(el('button', {
          class: 'btn', disabled: u.acted,
          onClick: () => { u.acted = true; u.moved = true; this.sel = null; this.render(); this.afterAction(); },
        }, '대기'));
        acts.append(grid);

        const tg = el('div', { class: 'act-grid', style: { marginTop: '5px' } });
        for (const kind of Object.keys(TACTICS)) {
          const any = Object.values(b.map.tiles).some((t) => tacticAvailable(b, u, kind, t));
          tg.append(el('button', {
            class: 'btn' + (this.mode === 'tactic' && this.tacticKind === kind ? ' on' : ''),
            disabled: u.acted || u.tactics <= 0 || !any,
            title: TACTICS[kind].desc,
            onClick: () => { this.mode = 'tactic'; this.tacticKind = kind; this.render(); },
          }, kind));
        }
        acts.append(tg);
        acts.append(el('p', { class: 'muted', style: { fontSize: '.74rem', margin: '6px 0 0' } },
          this.mode === 'move' ? '빈 칸을 눌러 옮긴다.'
            : this.mode === 'attack' ? '붉게 표시된 적을 누른다.'
            : this.mode === 'duel' ? '맞닿은 적장에게 일기토를 건다.'
            : this.mode === 'siege' ? '맞닿은 성문·성벽을 눌러 두들긴다.'
            : `${this.tacticKind}: ${TACTICS[this.tacticKind].desc}`));
      }
    } else {
      info.append(el('p', { class: 'muted', style: { fontSize: '.84rem' } },
        b.side === this.mySide ? '부대를 고르시오.' : '적이 움직이고 있다…'));
    }

    const log = clear($('#battle-log'));
    for (const line of b.log.slice(-40)) log.append(el('div', {}, line));
    log.scrollTop = log.scrollHeight;
  }

  /* ─────────── 일기토 연출 ─────────── */

  async showDuel(u, foe, d) {
    const a = OFFICERS[u.officerId], dd = OFFICERS[foe.officerId];
    const body = el('div');
    const head = el('div', { class: 'row', style: { justifyContent: 'space-around', marginBottom: '10px' } });
    head.append(el('div', { style: { textAlign: 'center' } }, portrait(a, 80), el('div', {}, a.name), el('div', { class: 'muted' }, `무력 ${a.war}`)));
    head.append(el('div', { style: { fontSize: '1.6rem', color: 'var(--seal)' } }, '一騎討'));
    head.append(el('div', { style: { textAlign: 'center' } }, portrait(dd, 80), el('div', {}, dd.name), el('div', { class: 'muted' }, `무력 ${dd.war}`)));
    body.append(head);
    const list = el('div');
    body.append(list);

    const p = showModal({ title: '일기토', body, buttons: [{ label: '보았다', value: null, primary: true }] });
    for (let i = 0; i < d.rounds.length; i++) {
      await sleep(340);
      const r = d.rounds[i];
      list.append(el('div', { class: 'duel-line' + (r.win === 'A' ? ' w' : '') },
        `${i + 1}합   ${a.name} ${r.a}  —  ${dd.name} ${r.d}   →  ${r.win === 'A' ? a.name : dd.name}`));
    }
    await sleep(300);
    list.append(el('div', { style: { marginTop: '8px', fontSize: '1.06rem', color: 'var(--seal)', fontWeight: '700' } },
      `${d.winnerName} 승 — ${d.loserName} ${d.outcome}`));
    await p;
  }
}
