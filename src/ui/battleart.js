// 전장 그림 — 지형 장식과 병사 그림.
//
// 왜 따로 뺐나
//   battleview.js 는 조작과 판정 흐름을 맡는다. 붓질까지 거기 두면 둘 다 읽기 어렵다.
//
// 크기 규약
//   모든 함수는 육각형 반지름 `s`(화면 픽셀)를 받아 그 안에서 알아서 줄인다.
//   폰 가로에서 s 는 15px 안팎이고 데스크톱에서는 25px 를 넘는다.
//   **s 가 작을 때는 스스로 생략한다** — 작은 화면에서 다 그리면 뭉개진다.
//
// 결정성
//   장식 위치는 타일 좌표에서 뽑은 해시로 정한다. 같은 성은 언제나 같은 그림이다.

import { shipOf } from '../data/ships.js';

/* ─────────────────────────── 잡일 ─────────────────────────── */

/** 타일마다 고정된 0~1 난수. salt 를 바꾸면 다른 계열이 나온다. */
function rnd(q, r, salt) {
  let h = Math.imul(q + 4096, 73856093) ^ Math.imul(r + 4096, 19349663) ^ Math.imul(salt + 1, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function shade(hex, m) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * m)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

/* ═══════════════════════════ 지형 ═══════════════════════════ */

/**
 * 타일 하나의 장식. 바탕색은 호출부가 이미 칠했다고 본다.
 * @param g   2D 컨텍스트
 * @param t   타일 {q,r,terr,hp,maxHp,core,breached}
 * @param x,y 화면 중심
 * @param s   육각형 반지름
 * @param base 바탕색 (#rrggbb)
 */
export function paintTerrain(g, t, x, y, s, base) {
  const tiny = s < 11;                     // 너무 작으면 장식을 접는다
  const R = (salt) => rnd(t.q, t.r, salt);

  switch (t.terr) {
    case '평지': {
      if (tiny) break;
      g.strokeStyle = shade(base, 0.82);
      g.lineWidth = Math.max(1, s * 0.06);
      for (let i = 0; i < 4; i++) {
        const a = R(i) * Math.PI * 2, d = 0.25 + R(i + 20) * 0.5;
        const gx = x + Math.cos(a) * s * d, gy = y + Math.sin(a) * s * d;
        g.beginPath();
        g.moveTo(gx, gy + s * 0.12);
        g.lineTo(gx - s * 0.05, gy - s * 0.08);
        g.moveTo(gx, gy + s * 0.12);
        g.lineTo(gx + s * 0.06, gy - s * 0.06);
        g.stroke();
      }
      break;
    }
    case '가도': {
      g.strokeStyle = shade(base, 1.12);
      g.lineWidth = Math.max(1, s * 0.09);
      for (let i = 0; i < 3; i++) {
        const gy = y + (R(i) - 0.5) * s * 0.9;
        g.beginPath();
        g.moveTo(x - s * (0.3 + R(i + 5) * 0.4), gy);
        g.lineTo(x + s * (0.3 + R(i + 9) * 0.4), gy);
        g.stroke();
      }
      if (tiny) break;
      g.fillStyle = shade(base, 0.8);
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(x + (R(i + 30) - 0.5) * s * 1.2, y + (R(i + 40) - 0.5) * s * 1.1, s * 0.07, 0, 7);
        g.fill();
      }
      break;
    }
    case '숲': {
      const n = tiny ? 2 : 3;
      for (let i = 0; i < n; i++) {
        const gx = x + (R(i) - 0.5) * s * 1.15;
        const gy = y + (R(i + 7) - 0.5) * s * 0.95;
        const h = s * (0.5 + R(i + 11) * 0.22);
        g.fillStyle = '#4a3320';                       // 줄기
        g.fillRect(gx - s * 0.045, gy, s * 0.09, h * 0.35);
        g.fillStyle = shade(base, 0.72);               // 그늘진 잎
        g.beginPath();
        g.moveTo(gx, gy - h);
        g.lineTo(gx + h * 0.45, gy + h * 0.06);
        g.lineTo(gx - h * 0.45, gy + h * 0.06);
        g.closePath(); g.fill();
        g.fillStyle = shade(base, 1.18);               // 볕 든 쪽
        g.beginPath();
        g.moveTo(gx, gy - h);
        g.lineTo(gx - h * 0.45, gy + h * 0.06);
        g.lineTo(gx - h * 0.1, gy + h * 0.06);
        g.closePath(); g.fill();
      }
      break;
    }
    case '산': {
      const n = tiny ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const gx = x + (i - (n - 1) / 2) * s * 0.75 + (R(i) - 0.5) * s * 0.25;
        const gy = y + s * 0.42;
        const h = s * (0.85 + R(i + 3) * 0.3);
        const w = h * 0.78;
        g.fillStyle = shade(base, 0.66);               // 오른쪽 그늘
        g.beginPath();
        g.moveTo(gx, gy - h); g.lineTo(gx + w, gy); g.lineTo(gx - w, gy);
        g.closePath(); g.fill();
        g.fillStyle = shade(base, 1.22);               // 왼쪽 볕
        g.beginPath();
        g.moveTo(gx, gy - h); g.lineTo(gx - w, gy); g.lineTo(gx - w * 0.15, gy);
        g.closePath(); g.fill();
        if (!tiny) {                                   // 봉우리에 흰 눈
          g.fillStyle = 'rgba(240,238,230,.8)';
          g.beginPath();
          g.moveTo(gx, gy - h);
          g.lineTo(gx + w * 0.26, gy - h * 0.66);
          g.lineTo(gx - w * 0.26, gy - h * 0.66);
          g.closePath(); g.fill();
        }
      }
      break;
    }
    case '늪': {
      g.fillStyle = shade(base, 0.7);
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.ellipse(x + (R(i) - 0.5) * s * 1.1, y + (R(i + 6) - 0.5) * s, s * 0.3, s * 0.16, 0, 0, 7);
        g.fill();
      }
      if (tiny) break;
      g.strokeStyle = shade(base, 1.3);
      g.lineWidth = Math.max(1, s * 0.05);
      for (let i = 0; i < 4; i++) {
        const gx = x + (R(i + 12) - 0.5) * s * 1.2, gy = y + (R(i + 18) - 0.5) * s * 0.9;
        g.beginPath(); g.moveTo(gx, gy + s * 0.2); g.lineTo(gx + s * 0.05, gy - s * 0.25); g.stroke();
      }
      break;
    }
    case '사막': {
      g.strokeStyle = shade(base, 0.86);
      g.lineWidth = Math.max(1, s * 0.07);
      for (let i = 0; i < 3; i++) {
        const gy = y + (i - 1) * s * 0.42 + (R(i) - 0.5) * s * 0.2;
        g.beginPath();
        g.moveTo(x - s * 0.7, gy);
        g.quadraticCurveTo(x, gy - s * 0.24, x + s * 0.7, gy);
        g.stroke();
      }
      break;
    }
    case '강': {
      g.strokeStyle = 'rgba(190,225,245,.55)';
      g.lineWidth = Math.max(1, s * 0.08);
      for (let i = 0; i < 3; i++) {
        const gy = y + (i - 1) * s * 0.44 + (R(i) - 0.5) * s * 0.18;
        const w = s * 0.34;
        g.beginPath();
        g.moveTo(x - w * 1.7, gy);
        g.quadraticCurveTo(x - w * 0.85, gy - s * 0.16, x, gy);
        g.quadraticCurveTo(x + w * 0.85, gy + s * 0.16, x + w * 1.7, gy);
        g.stroke();
      }
      break;
    }
    case '성벽': case '성문': {
      paintWall(g, t, x, y, s, base);
      break;
    }
    case '본성': {
      if (tiny) break;
      g.strokeStyle = shade(base, 0.82);
      g.lineWidth = 1;
      for (let i = -1; i <= 1; i++) {
        g.beginPath();
        g.moveTo(x - s * 0.72, y + i * s * 0.4);
        g.lineTo(x + s * 0.72, y + i * s * 0.4);
        g.stroke();
      }
      for (let i = -1; i <= 1; i++) {
        g.beginPath();
        g.moveTo(x + i * s * 0.46, y - s * 0.6);
        g.lineTo(x + i * s * 0.46, y + s * 0.6);
        g.stroke();
      }
      break;
    }
    default: break;
  }
}

/** 성벽·성문 — 돌 쌓기와 판자 */
function paintWall(g, t, x, y, s, base) {
  const gate = t.terr === '성문';
  if (gate) {
    g.fillStyle = shade(base, 0.72);                   // 문짝
    g.fillRect(x - s * 0.62, y - s * 0.7, s * 1.24, s * 1.4);
    g.strokeStyle = shade(base, 1.3);
    g.lineWidth = Math.max(1, s * 0.06);
    for (let i = -1; i <= 1; i++) {                    // 판자 이음
      g.beginPath();
      g.moveTo(x + i * s * 0.31, y - s * 0.7);
      g.lineTo(x + i * s * 0.31, y + s * 0.7);
      g.stroke();
    }
    g.fillStyle = '#4c4238';                           // 쇠띠
    g.fillRect(x - s * 0.62, y - s * 0.34, s * 1.24, s * 0.14);
    g.fillRect(x - s * 0.62, y + s * 0.2, s * 1.24, s * 0.14);
    return;
  }
  // 성벽 — 어긋나게 쌓은 돌
  const rows = 4;
  for (let i = 0; i < rows; i++) {
    const gy = y - s * 0.75 + i * (s * 1.5 / rows);
    const off = (i % 2) * s * 0.3;
    for (let j = -2; j <= 2; j++) {
      const gx = x + j * s * 0.6 + off;
      if (Math.abs(gx - x) > s * 0.95) continue;
      g.fillStyle = shade(base, 0.86 + rnd(t.q + j, t.r + i, 3) * 0.3);
      g.fillRect(gx - s * 0.27, gy, s * 0.54, s * 1.5 / rows - Math.max(1, s * 0.05));
    }
  }
  // 총안
  g.fillStyle = shade(base, 1.25);
  for (let j = -1; j <= 1; j++) g.fillRect(x + j * s * 0.42 - s * 0.12, y - s * 0.92, s * 0.24, s * 0.2);
}

/* ═══════════════════════════ 병사 ═══════════════════════════ */

const SKIN = '#e0b48c';
const STEEL = '#c9cdd4';
const HORSE = '#6b4a33';

/** 병력에 따른 인원 수 — 눈으로 세력 차이가 보이게 */
export function figureCount(u) {
  const max = u.type === '기병' ? 3 : 5;               // 더 넣으면 서로 겹쳐 뭉갠다
  return Math.max(1, Math.min(max, Math.round(u.troops / (u.type === '기병' ? 2800 : 2000))));
}

/**
 * 대열 자리 — 뒷줄부터 그리도록 정렬해서 돌려준다.
 * 아래쪽은 이름 띠가 쓰므로 전체를 조금 위로 올려 둔다.
 */
function formation(n, s) {
  if (n === 1) return [[0, s * 0.18]];
  const front = Math.ceil(n / 2), back = n - front;
  const out = [];
  const place = (count, dy) => {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      out.push([(t - 0.5) * s * (count === 1 ? 0 : 1.12), dy]);
    }
  };
  place(back, s * 0.04);
  place(front, s * 0.34);
  return out;
}

/**
 * 부대 하나를 그린다.
 * @param u        부대
 * @param x,y      타일 중심
 * @param s        육각형 반지름
 * @param mine     아군인가 (색)
 * @param selected 골라 놓은 부대인가
 */
export function paintUnit(g, u, x, y, s, mine, selected, water) {
  const body = mine ? '#31538f' : '#8e2f26';
  const trim = mine ? '#7ea6de' : '#dd8b7c';
  const dark = mine ? '#1d3358' : '#5a1c16';
  const forward = u.side === 'A' ? 1 : -1;

  // 발밑 그늘 — 무리가 하나로 읽히게. 진하면 흙바닥처럼 보여 얕게 깐다.
  g.fillStyle = 'rgba(10,8,4,.17)';
  g.beginPath();
  g.ellipse(x, y + s * 0.62, s * 0.74, s * 0.16, 0, 0, 7);
  g.fill();

  if (selected) {
    g.strokeStyle = '#ffe9a8';
    g.lineWidth = Math.max(2, s * 0.10);
    g.beginPath(); g.ellipse(x, y + s * 0.62, s * 0.82, s * 0.22, 0, 0, 7); g.stroke();
  }

  if (water) { paintBoat(g, x, y, s, body, trim, dark, forward, u); }
  else {
    const n = figureCount(u);
    const k = s * (u.type === '기병' ? 0.44 : 0.5);    // 병사 키
    for (const [dx, dy] of formation(n, s)) {
      const fx = x + dx, fy = y + dy;
      if (u.type === '기병') paintRider(g, fx, fy, k, body, trim, dark, forward);
      else if (u.type === '궁병') paintArcher(g, fx, fy, k, body, trim, dark, forward);
      else paintSpearman(g, fx, fy, k, body, trim, dark, forward);
    }
  }

  if (u.acted && mine) {                               // 이미 움직인 부대는 가라앉힌다
    g.fillStyle = 'rgba(8,10,16,.42)';
    g.beginPath(); g.ellipse(x, y, s * 0.95, s * 0.9, 0, 0, 7); g.fill();
  }
}

/** 창과 방패를 든 보병 */
function paintSpearman(g, x, y, k, body, trim, dark, f) {
  const head = k * 0.26;
  g.strokeStyle = '#8a6a44';                            // 창대
  g.lineWidth = Math.max(1, k * 0.11);
  g.beginPath();
  g.moveTo(x + f * k * 0.34, y - k * 0.95);
  g.lineTo(x + f * k * 0.16, y + k * 0.55);
  g.stroke();
  g.fillStyle = STEEL;                                  // 창날
  g.beginPath();
  g.moveTo(x + f * k * 0.34, y - k * 1.18);
  g.lineTo(x + f * k * 0.46, y - k * 0.88);
  g.lineTo(x + f * k * 0.22, y - k * 0.88);
  g.closePath(); g.fill();

  g.fillStyle = body;                                   // 몸통
  g.fillRect(x - k * 0.26, y - k * 0.34, k * 0.52, k * 0.78);
  g.fillStyle = dark;                                   // 다리
  g.fillRect(x - k * 0.22, y + k * 0.4, k * 0.16, k * 0.28);
  g.fillRect(x + k * 0.06, y + k * 0.4, k * 0.16, k * 0.28);
  g.fillStyle = trim;                                   // 방패
  g.beginPath();
  g.ellipse(x - f * k * 0.3, y + k * 0.02, k * 0.2, k * 0.3, 0, 0, 7);
  g.fill();

  g.fillStyle = SKIN;                                   // 머리
  g.beginPath(); g.arc(x, y - k * 0.56, head, 0, 7); g.fill();
  g.fillStyle = dark;                                   // 투구
  g.beginPath(); g.arc(x, y - k * 0.6, head * 1.06, Math.PI, 0); g.fill();
}

/** 활을 당기는 궁병 */
function paintArcher(g, x, y, k, body, trim, dark, f) {
  const head = k * 0.25;
  g.fillStyle = body;
  g.fillRect(x - k * 0.24, y - k * 0.32, k * 0.48, k * 0.74);
  g.fillStyle = dark;
  g.fillRect(x - k * 0.2, y + k * 0.38, k * 0.15, k * 0.28);
  g.fillRect(x + k * 0.05, y + k * 0.38, k * 0.15, k * 0.28);

  // 활 — 앞쪽에 세워 든다. 크게 그리면 고리처럼 보여서 작고 얇게.
  const bx = x + f * k * 0.44, by = y - k * 0.12, br = k * 0.44;
  g.strokeStyle = '#7a5a34';
  g.lineWidth = Math.max(1, k * 0.09);
  g.beginPath();
  g.arc(bx, by, br, f > 0 ? -Math.PI * 0.44 : Math.PI * 0.56, f > 0 ? Math.PI * 0.44 : Math.PI * 1.44);
  g.stroke();
  g.strokeStyle = 'rgba(245,240,225,.9)';               // 시위 — 활 안쪽을 곧게
  g.lineWidth = Math.max(1, k * 0.045);
  g.beginPath();
  g.moveTo(bx - f * Math.sin(Math.PI * 0.44) * 0, by - br * Math.cos(Math.PI * 0.06));
  g.lineTo(bx, by + br * Math.cos(Math.PI * 0.06));
  g.stroke();
  g.fillStyle = STEEL;                                   // 살촉
  g.fillRect(bx + f * br * 0.2, by - k * 0.03, br * 0.5, Math.max(1, k * 0.06));

  g.fillStyle = SKIN;
  g.beginPath(); g.arc(x, y - k * 0.54, head, 0, 7); g.fill();
  g.fillStyle = dark;
  g.beginPath(); g.arc(x, y - k * 0.58, head * 1.06, Math.PI, 0); g.fill();
}

/** 말 탄 기병 — 말이 덩어리로 뭉치지 않게 다리·목·꼬리를 또렷이 */
function paintRider(g, x, y, k, body, trim, dark, f) {
  const HL = '#8a6144';                                  // 말 밝은 면

  g.strokeStyle = HORSE;                                 // 다리 먼저(몸통 뒤로)
  g.lineWidth = Math.max(1.2, k * 0.14);
  g.lineCap = 'round';
  for (const [dx, lean] of [[-0.52, -0.12], [-0.2, 0.06], [0.24, -0.06], [0.54, 0.12]]) {
    g.beginPath();
    g.moveTo(x + f * dx * k, y + k * 0.34);
    g.lineTo(x + f * (dx + lean) * k, y + k * 0.9);
    g.stroke();
  }

  g.fillStyle = '#33241a';                               // 꼬리
  g.beginPath();
  g.moveTo(x - f * k * 0.72, y - k * 0.02);
  g.quadraticCurveTo(x - f * k * 1.12, y + k * 0.18, x - f * k * 0.92, y + k * 0.62);
  g.lineTo(x - f * k * 0.66, y + k * 0.3);
  g.closePath(); g.fill();

  g.fillStyle = HORSE;                                   // 몸통
  g.beginPath();
  g.ellipse(x, y + k * 0.16, k * 0.72, k * 0.3, 0, 0, 7);
  g.fill();
  g.fillStyle = HL;                                      // 등에 볕
  g.beginPath();
  g.ellipse(x - f * k * 0.08, y + k * 0.04, k * 0.6, k * 0.13, 0, 0, 7);
  g.fill();

  g.fillStyle = HORSE;                                   // 목
  g.beginPath();
  g.moveTo(x + f * k * 0.5, y + k * 0.16);
  g.lineTo(x + f * k * 0.9, y - k * 0.36);
  g.lineTo(x + f * k * 1.06, y - k * 0.2);
  g.lineTo(x + f * k * 0.72, y + k * 0.28);
  g.closePath(); g.fill();
  g.beginPath();                                         // 머리
  g.ellipse(x + f * k * 1.02, y - k * 0.34, k * 0.24, k * 0.14, f * 0.5, 0, 7);
  g.fill();
  g.fillStyle = '#1a1208';                               // 갈기
  g.beginPath();
  g.moveTo(x + f * k * 0.48, y - k * 0.04);
  g.lineTo(x + f * k * 0.9, y - k * 0.44);
  g.lineTo(x + f * k * 0.78, y - k * 0.5);
  g.lineTo(x + f * k * 0.4, y - k * 0.12);
  g.closePath(); g.fill();

  // 기수 — 창을 먼저 그려 몸 뒤로 지나가게
  g.strokeStyle = '#7a5a34';
  g.lineWidth = Math.max(1.2, k * 0.11);
  g.beginPath();
  g.moveTo(x + f * k * 0.62, y - k * 1.12);
  g.lineTo(x - f * k * 0.16, y + k * 0.16);
  g.stroke();
  g.fillStyle = STEEL;
  g.beginPath();
  g.moveTo(x + f * k * 0.72, y - k * 1.34);
  g.lineTo(x + f * k * 0.8, y - k * 1.0);
  g.lineTo(x + f * k * 0.54, y - k * 1.06);
  g.closePath(); g.fill();

  // 기수는 작게 — 크면 말을 다 덮어 갈색 다리 위의 파란 덩어리가 된다
  const rx = x - f * k * 0.16;
  g.fillStyle = body;                                    // 상체
  g.fillRect(rx - k * 0.15, y - k * 0.5, k * 0.32, k * 0.44);
  g.fillStyle = trim;                                    // 허리띠
  g.fillRect(rx - k * 0.15, y - k * 0.18, k * 0.32, k * 0.09);
  g.fillStyle = SKIN;                                    // 머리
  g.beginPath(); g.arc(rx, y - k * 0.62, k * 0.17, 0, 7); g.fill();
  g.fillStyle = dark;                                    // 투구
  g.beginPath(); g.arc(rx, y - k * 0.65, k * 0.19, Math.PI, 0); g.fill();
  g.fillStyle = trim;                                    // 투구 술
  g.fillRect(rx - k * 0.03, y - k * 0.9, k * 0.06, k * 0.12);
}

/** 물 위에서는 배로 그린다. 등급이 높을수록 크고 층집이 붙는다. */
function paintBoat(g, x, y, s, body, trim, dark, f, u) {
  const S = shipOf(u.ship);
  const w = s * S.beam, h = s * 0.30;
  const raft = !u.ship;

  if (raft) {                                           // 뗏목 — 통나무를 엮었을 뿐이다
    g.fillStyle = '#6b4a2e';
    for (let i = -2; i <= 2; i++) {
      g.fillRect(x - w * 0.9, y - h * 0.2 + i * s * 0.11, w * 1.8, s * 0.08);
    }
    g.strokeStyle = '#3f2c1a';
    g.lineWidth = Math.max(1, s * 0.05);
    g.beginPath(); g.moveTo(x - w * 0.4, y - h * 0.4); g.lineTo(x - w * 0.4, y + h * 0.5); g.stroke();
    g.beginPath(); g.moveTo(x + w * 0.4, y - h * 0.4); g.lineTo(x + w * 0.4, y + h * 0.5); g.stroke();
  } else {
    g.strokeStyle = '#8a6a44';                          // 노 — 배가 클수록 많다
    g.lineWidth = Math.max(1, s * 0.05);
    const oars = 2 + Math.round(S.power * 2.5);
    for (let i = 0; i < oars; i++) {
      const ox = x - w * 0.7 + (i / (oars - 1 || 1)) * w * 1.4;
      g.beginPath();
      g.moveTo(ox, y + h * 0.1);
      g.lineTo(ox - f * s * 0.16, y + h * 0.85);
      g.stroke();
    }
    g.fillStyle = '#6b4a2e';                            // 선체
    g.beginPath();
    g.moveTo(x - w, y - h * 0.2);
    g.lineTo(x + w, y - h * 0.2);
    g.quadraticCurveTo(x + w * 0.5, y + h * 1.1, x, y + h * 1.1);
    g.quadraticCurveTo(x - w * 0.5, y + h * 1.1, x - w, y - h * 0.2);
    g.closePath(); g.fill();
    g.fillStyle = '#8a6540';
    g.fillRect(x - w, y - h * 0.24, w * 2, h * 0.2);

    // 층집 — 대선·누선은 갑판 위에 집을 올린다
    for (let d = 0; d < S.decks; d++) {
      const dw = w * (0.66 - d * 0.16), dh = s * 0.22;
      const dy = y - h * 0.24 - (d + 1) * dh;
      g.fillStyle = '#7a5636';
      g.fillRect(x - dw, dy, dw * 2, dh);
      g.fillStyle = '#4c3a24';
      g.fillRect(x - dw, dy, dw * 2, s * 0.05);
    }

    const mastTop = y - h * 0.3 - S.decks * s * 0.22 - s * 0.36;
    g.strokeStyle = '#5a4630';                          // 돛대
    g.lineWidth = Math.max(1, s * 0.07);
    g.beginPath(); g.moveTo(x, y - h * 0.3); g.lineTo(x, mastTop); g.stroke();
    g.fillStyle = body;                                 // 돛
    g.fillRect(x - w * 0.5, mastTop + s * 0.04, w, s * 0.3);
    g.fillStyle = trim;
    g.fillRect(x - w * 0.5, mastTop + s * 0.04, w, s * 0.07);
  }

  // 갑판 위 병사 — 병력이 많으면 셋
  const crew = u.troops > 5000 ? 3 : 2;
  for (let i = 0; i < crew; i++) {
    const dx = (i / (crew - 1 || 1) - 0.5) * w * 1.1;
    g.fillStyle = dark;
    g.fillRect(x + dx - s * 0.05, y - h * 0.52, s * 0.11, s * 0.22);
    g.fillStyle = SKIN;
    g.beginPath(); g.arc(x + dx, y - h * 0.64, s * 0.065, 0, 7); g.fill();
  }
}
