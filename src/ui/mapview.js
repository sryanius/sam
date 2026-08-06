// 전략 지도 — Canvas 2D.
//
// 논리 좌표 1000×780 을 캔버스에 맞춰 그린다.
// 땅·강·길은 배율을 먹여 그리고, **도시 표식과 이름은 화면 좌표로 따로 그린다.**
// 그래야 폰처럼 좁은 화면에서 지도를 줄여도 글씨가 읽힌다.
//
// 확대/이동: 휠·핀치로 확대, 끌어서 이동. 끌었으면 클릭으로 치지 않는다.

import { CITIES, ROUTES, REGIONS } from '../data/cities.js';
import { NEUTRAL } from '../game/state.js';
import { num, clamp } from '../core/util.js';

const LW = 1000, LH = 780;
const MIN_ZOOM = 1, MAX_ZOOM = 4;

const COAST = [
  [940, 40], [962, 108], [898, 150], [828, 176], [788, 214], [744, 250],
  [830, 288], [846, 334], [790, 360], [776, 400], [802, 442], [842, 490],
  [860, 542], [830, 602], [770, 642], [700, 690], [690, 746], [600, 766],
  [500, 774], [430, 760], [380, 700], [300, 660], [200, 650], [130, 600],
  [120, 520], [160, 452], [140, 380], [150, 300], [170, 220], [230, 160],
  [330, 130], [420, 150], [500, 120], [560, 90], [650, 70], [760, 45], [850, 24],
];

const HUANGHE = [
  [172, 316], [250, 290], [320, 268], [392, 300], [452, 330], [520, 338],
  [590, 325], [660, 312], [712, 286], [762, 256], [812, 234],
];
const CHANGJIANG = [
  [148, 522], [232, 510], [320, 536], [392, 510], [460, 530], [520, 550],
  [576, 546], [612, 538], [680, 556], [730, 540], [760, 512], [812, 536], [872, 540],
];

const REGION_LABELS = [
  { t: '幽州', x: 800, y: 108 }, { t: '冀州', x: 660, y: 214 }, { t: '幷州', x: 520, y: 200 },
  { t: '靑州', x: 812, y: 272 }, { t: '兗州', x: 640, y: 316 }, { t: '徐州', x: 776, y: 356 },
  { t: '司隷', x: 470, y: 300 }, { t: '豫州', x: 620, y: 466 }, { t: '揚州', x: 760, y: 596 },
  { t: '涼州', x: 232, y: 268 }, { t: '益州', x: 208, y: 448 }, { t: '荊州', x: 452, y: 560 },
  { t: '交州', x: 560, y: 730 },
];

export class MapView {
  constructor(canvas, { onPick, onHover }) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.onPick = onPick;
    this.onHover = onHover;
    this.selected = -1;
    this.highlight = new Set();
    this.st = null;

    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this._ptrs = new Map();      // pointerId -> {x,y}
    this._dragged = false;

    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('pointerleave', () => { this.onHover && this.onHover(null); });
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    canvas.addEventListener('dblclick', () => this.fit());
    this.resize();
  }

  /* ─────────────────────── 크기와 변환 ─────────────────────── */

  /**
   * forceW/forceH 를 주면 화면과 무관하게 그 크기로 그린다(이미지 내보내기용).
   * 숨겨진 탭에서 열리면 사각형이 0×0 이라 다음 프레임에 다시 시도한다.
   */
  resize(forceW, forceH) {
    const r = this.cv.getBoundingClientRect();
    const w = forceW || r.width, h = forceH || r.height;
    if (w < 2 || h < 2) {
      if (!this._pending) {
        this._pending = true;
        requestAnimationFrame(() => { this._pending = false; this.resize(); });
      }
      return;
    }
    const dpr = forceW ? 1 : Math.min(2, window.devicePixelRatio || 1);
    this.vw = w; this.vh = h;
    this.cv.width = Math.max(1, Math.round(w * dpr));
    this.cv.height = Math.max(1, Math.round(h * dpr));
    this.dpr = dpr;
    this.fitScale = Math.min(w / LW, h / LH) * 0.98;
    this.clampPan();
    if (this.st) this.draw(this.st);
  }

  get scale() { return this.fitScale * this.zoom; }

  /** 확대해도 지도가 화면 밖으로 달아나지 않게 */
  clampPan() {
    const s = this.scale;
    const mw = LW * s, mh = LH * s;
    this.baseOx = (this.vw - mw) / 2;
    this.baseOy = (this.vh - mh) / 2;
    const slackX = Math.max(0, (mw - this.vw) / 2);
    const slackY = Math.max(0, (mh - this.vh) / 2);
    this.panX = clamp(this.panX, -slackX, slackX);
    this.panY = clamp(this.panY, -slackY, slackY);
    this.ox = this.baseOx + this.panX;
    this.oy = this.baseOy + this.panY;
  }

  toScreen(x, y) { return [this.ox + x * this.scale, this.oy + y * this.scale]; }
  toLogical(px, py) { return [(px - this.ox) / this.scale, (py - this.oy) / this.scale]; }

  /** 화면 전체가 보이게 되돌린다 */
  fit() { this.zoom = 1; this.panX = this.panY = 0; this.clampPan(); this.draw(this.st); }

  /** 특정 도시가 가운데 오게 */
  centerOn(cityId, zoom) {
    const c = CITIES[cityId];
    if (!c) return;
    if (zoom) this.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    this.clampPan();
    this.panX = this.vw / 2 - (this.baseOx + c.x * this.scale) + this.panX;
    this.panY = this.vh / 2 - (this.baseOy + c.y * this.scale) + this.panY;
    this.clampPan();
    if (this.st) this.draw(this.st);
  }

  zoomAt(px, py, factor) {
    const before = this.toLogical(px, py);
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    this.clampPan();
    const after = this.toLogical(px, py);
    this.panX += (after[0] - before[0]) * this.scale;
    this.panY += (after[1] - before[1]) * this.scale;
    this.clampPan();
    this.draw(this.st);
  }

  /* ─────────────────────── 입력 ─────────────────────── */

  local(e) {
    const r = this.cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  down(e) {
    this.cv.setPointerCapture?.(e.pointerId);
    const [x, y] = this.local(e);
    this._ptrs.set(e.pointerId, { x, y });
    this._dragged = false;
    if (this._ptrs.size === 2) {
      const [a, b] = [...this._ptrs.values()];
      this._pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }

  move(e) {
    const [x, y] = this.local(e);
    const prev = this._ptrs.get(e.pointerId);

    if (this._ptrs.size === 2 && prev) {
      this._ptrs.set(e.pointerId, { x, y });
      const [a, b] = [...this._ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this._pinchDist > 0) {
        this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / this._pinchDist);
        this._dragged = true;
      }
      this._pinchDist = d;
      e.preventDefault();
      return;
    }

    if (prev) {                       // 끌기
      const dx = x - prev.x, dy = y - prev.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) this._dragged = true;
      this.panX += dx; this.panY += dy;
      this._ptrs.set(e.pointerId, { x, y });
      this.clampPan();
      this.draw(this.st);
      e.preventDefault();
      return;
    }

    // 그냥 지나가는 중 — 툴팁
    const id = this.cityAt(x, y);
    if (id !== this._hover) {
      this._hover = id;
      if (this.onHover) this.onHover(id, x, y);
    }
  }

  up(e) {
    const had = this._ptrs.has(e.pointerId);
    this._ptrs.delete(e.pointerId);
    if (this._ptrs.size < 2) this._pinchDist = 0;
    if (!had || this._dragged) return;
    const [x, y] = this.local(e);
    const id = this.cityAt(x, y);
    if (id >= 0 && this.onPick) this.onPick(id);
  }

  wheel(e) {
    e.preventDefault();
    const [x, y] = this.local(e);
    this.zoomAt(x, y, e.deltaY < 0 ? 1.16 : 1 / 1.16);
  }

  /** 화면 좌표에서 가장 가까운 도시. 손가락을 감안해 넉넉히 잡는다. */
  cityAt(px, py) {
    const R = 22;
    let best = -1, bd = R * R;
    for (const c of CITIES) {
      const [x, y] = this.toScreen(c.x, c.y);
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d < bd) { bd = d; best = c.id; }
    }
    return best;
  }

  /* ─────────────────────── 그리기 ─────────────────────── */

  draw(st) {
    if (!st) return;
    this.st = st;
    if (!this.vw) { this.resize(); if (!this.vw) return; }
    const g = this.ctx, dpr = this.dpr;
    const r = { width: this.vw, height: this.vh };
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.width, r.height);

    g.fillStyle = '#1d2b38';
    g.fillRect(0, 0, r.width, r.height);
    this._sea(g, r);

    // 땅·강·주 이름·길 — 배율 안에서
    g.save();
    g.translate(this.ox, this.oy);
    g.scale(this.scale, this.scale);
    this._land(g);
    this._rivers(g);
    this._regions(g);
    this._routes(g, st);
    g.restore();

    // 도시와 이름 — 화면 좌표로. 지도를 줄여도 읽힌다.
    this._cities(g, st);
  }

  _sea(g, r) {
    g.save();
    g.globalAlpha = 0.16;
    g.strokeStyle = '#5f7f96';
    g.lineWidth = 1;
    for (let y = 0; y < r.height; y += 22) {
      g.beginPath();
      for (let x = 0; x <= r.width; x += 8) g.lineTo(x, y + Math.sin((x + y) / 26) * 2.6);
      g.stroke();
    }
    g.restore();
  }

  _poly(g, pts, close) {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      g.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    }
    g.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    if (close) g.closePath();
  }

  _land(g) {
    g.save();
    this._poly(g, COAST, true);
    g.fillStyle = '#ded1b4';
    g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 22; g.shadowOffsetY = 5;
    g.fill();
    g.shadowColor = 'transparent';
    g.strokeStyle = '#6d6144'; g.lineWidth = 2.2 / this.zoom; g.stroke();

    g.clip();
    g.globalAlpha = 0.05;
    g.fillStyle = '#5a4a2a';
    for (let i = 0; i < 900; i++) {
      const x = Math.sin(i * 12.9898) * 43758.5453 % 1 * LW;
      const y = Math.sin(i * 78.233) * 43758.5453 % 1 * LH;
      g.fillRect(Math.abs(x), Math.abs(y), 2, 2);
    }
    g.restore();
  }

  _rivers(g) {
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const [pts, w, label, lx, ly] of [
      [HUANGHE, 4.5, '黃河', 300, 262], [CHANGJIANG, 5, '長江', 430, 524],
    ]) {
      this._poly(g, pts, false);
      g.strokeStyle = '#4a7a9c'; g.lineWidth = w; g.stroke();
      g.strokeStyle = 'rgba(140,190,220,.5)'; g.lineWidth = w * 0.4; g.stroke();
      g.fillStyle = '#3b6a8c'; g.font = 'italic 15px serif'; g.globalAlpha = .8;
      g.fillText(label, lx, ly);
      g.globalAlpha = 1;
    }
    g.restore();
  }

  _regions(g) {
    g.save();
    g.fillStyle = 'rgba(90,74,42,.30)';
    g.font = '22px serif';
    g.textAlign = 'center';
    for (const r of REGION_LABELS) g.fillText(r.t, r.x, r.y);
    g.restore();
  }

  _routes(g, st) {
    g.save();
    for (const [a, b, dist, water] of ROUTES) {
      const A = CITIES[a], B = CITIES[b];
      const fa = st.cities[a].faction, fb = st.cities[b].faction;
      const same = fa === fb && fa !== NEUTRAL;
      g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y);
      g.strokeStyle = water ? 'rgba(70,120,155,.75)' : same ? 'rgba(90,74,42,.55)' : 'rgba(90,74,42,.30)';
      g.lineWidth = (water ? 2.6 : 1.8) / Math.max(1, this.zoom * 0.7);
      g.setLineDash(water ? [7, 5] : []);
      g.stroke();
      g.setLineDash([]);
    }
    g.restore();
  }

  _cities(g, st) {
    g.save();
    g.textAlign = 'center';
    // 표식은 지도가 아무리 작아져도 손으로 짚을 만큼은 남긴다
    const k = clamp(this.scale, 0.62, 1.25);
    const small = this.vw < 620;
    const fs = small ? 11 : 13;
    const placed = [];   // 이름표가 겹치면 위로 올린다

    for (const ci of CITIES) {
      const c = st.cities[ci.id];
      const f = c.faction === NEUTRAL ? null : st.factions[c.faction];
      const col = f ? f.color : '#8c8270';
      const sz = (5.5 + ci.size * 1.5) * k;
      const [x, y] = this.toScreen(ci.x, ci.y);
      if (x < -40 || y < -40 || x > this.vw + 40 || y > this.vh + 40) continue;

      if (this.highlight.has(ci.id)) {
        g.beginPath(); g.arc(x, y, sz + 9, 0, Math.PI * 2);
        g.fillStyle = 'rgba(163,53,43,.22)'; g.fill();
        g.strokeStyle = '#a3352b'; g.lineWidth = 2; g.setLineDash([4, 3]); g.stroke(); g.setLineDash([]);
      }

      // 성 — 네모에 총안
      g.beginPath();
      g.rect(x - sz, y - sz * 0.82, sz * 2, sz * 1.64);
      g.fillStyle = col;
      g.fill();
      g.lineWidth = c.faction === st.player ? 2.4 : 1.2;
      g.strokeStyle = c.faction === st.player ? '#fff4d8' : 'rgba(20,16,10,.85)';
      g.stroke();
      g.fillStyle = 'rgba(20,16,10,.7)';
      for (let i = -1; i <= 1; i++) g.fillRect(x + i * sz * 0.62 - sz * 0.16, y - sz * 1.06, sz * 0.32, sz * 0.3);

      if (ci.id === this.selected) {
        g.beginPath(); g.arc(x, y, sz + 6, 0, Math.PI * 2);
        g.strokeStyle = '#a3352b'; g.lineWidth = 2.6; g.stroke();
      }

      // 이름 — 화면 크기 고정. 아래에 놓되 겹치면 위로 올린다.
      g.font = `${ci.size >= 4 ? 'bold ' : ''}${fs}px 'Noto Serif KR', serif`;
      const lw = ci.name.length * fs * 0.98 + 3, lh = fs + 2;
      const below = y + sz + fs, above = y - sz - 4;
      const hit = (cy) => placed.some((p) =>
        Math.abs(p.x - x) < (p.w + lw) / 2 && Math.abs(p.y - cy) < lh);
      const ly = hit(below) && !hit(above) ? above : below;
      placed.push({ x, y: ly, w: lw });

      g.lineWidth = 3.4; g.strokeStyle = 'rgba(222,209,180,.92)';
      g.strokeText(ci.name, x, ly);
      g.fillStyle = '#221f18';
      g.fillText(ci.name, x, ly);

      // 군세 — 점 개수로
      if (c.troops > 0 && !small) {
        const t = Math.min(4, Math.round(c.troops / 12000));
        g.fillStyle = 'rgba(35,28,18,.72)';
        for (let i = 0; i < t; i++) g.fillRect(x - sz + i * 4.5, y + sz * 0.9, 3, 3);
      }
    }
    g.restore();
  }

  destroy() { window.removeEventListener('resize', this._resize); }
}

/** 툴팁 문구 */
export function cityTip(st, id) {
  const ci = CITIES[id];
  const c = st.cities[id];
  const f = c.faction === NEUTRAL ? '공백지' : st.factions[c.faction].name;
  const offs = st.officers.filter((s) => s.city === id && s.faction === c.faction && s.status === 'normal').length;
  return `${ci.name} ${ci.hanja}  [${ci.region}]\n`
       + `${f}   무장 ${offs}\n`
       + `병력 ${num(c.troops)}  금 ${num(c.gold)}\n`
       + `군량 ${num(c.food)}  민충 ${Math.round(c.loyal)}`;
}
