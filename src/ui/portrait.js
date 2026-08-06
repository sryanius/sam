// 무장 초상 — 절차 생성. 이름으로 시드를 만들어 같은 무장은 언제나 같은 얼굴이 나온다.
//
// 논리 크기 48×60 픽셀에 그린 뒤 확대한다(픽셀 보간 끄기).
// 능력치가 생김새에 반영된다 — 무력이 높으면 눈꼬리가 서고 투구를 쓰고,
// 지력이 높으면 문관 관을 쓰며, 나이가 많으면 수염이 세다.

const PW = 48, PH = 60;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h += 0x6d2b79f5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const SKIN = ['#e0b48c', '#d6a678', '#c79468', '#e8c19c', '#bd8a5e'];
const ROBE = ['#4a5d7e', '#6b3f3f', '#3f5f47', '#5a4a6b', '#6b5a3a', '#3f5a6b', '#6b4a3a', '#4a4a4a'];
const HAIR = ['#2a231c', '#332a20', '#1e1a15'];

/**
 * @param o 원본 무장 데이터
 * @param size 화면 픽셀 크기(정사각 기준 폭). 높이는 5/4 배.
 * @returns HTMLCanvasElement
 */
export function portrait(o, size = 96) {
  const cv = document.createElement('canvas');
  const scale = Math.max(1, Math.round(size / PW));
  cv.width = PW * scale;
  cv.height = PH * scale;
  cv.style.width = `${PW * scale}px`;
  cv.style.height = `${PH * scale}px`;
  cv.style.imageRendering = 'pixelated';
  cv.style.border = '1px solid #6d6144';
  cv.style.background = '#cbbb99';

  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.scale(scale, scale);
  paint(g, o);
  return cv;
}

function paint(g, o) {
  const rnd = hash(o.name + o.hanja);
  const px = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };

  const female = o.tags.includes('여성');
  const tribal = o.tags.includes('이민족');
  const royal = o.tags.includes('황족');
  const eunuch = o.tags.includes('환관');
  const scholar = o.int >= 78 && o.war < 70;
  const warrior = o.war >= 78;
  const age = 2026;  // 표시용 나이는 밖에서 계산 — 여기서는 수염 길이만 본다
  const old = o.born <= 150;

  const skin = SKIN[Math.floor(rnd() * SKIN.length)];
  const robe = tribal ? '#7a5a3a' : ROBE[Math.floor(rnd() * ROBE.length)];
  const hair = old ? '#8d8578' : HAIR[Math.floor(rnd() * HAIR.length)];

  // 배경
  const bg = g.createLinearGradient(0, 0, 0, PH);
  bg.addColorStop(0, '#e2d6b8');
  bg.addColorStop(1, '#bfae8b');
  g.fillStyle = bg; g.fillRect(0, 0, PW, PH);

  // 어깨·옷
  px(8, 44, 32, 16, robe);
  px(8, 44, 32, 2, shade(robe, 1.25));
  // 옷깃
  px(20, 44, 8, 16, shade(robe, 0.72));
  px(23, 46, 2, 14, '#d9cba8');

  // 목
  px(21, 39, 6, 6, shade(skin, 0.85));

  // 얼굴
  const fw = female ? 16 : warrior ? 20 : 18;
  const fx = 24 - fw / 2;
  px(fx, 16, fw, 24, skin);
  px(fx, 16, fw, 2, shade(skin, 1.12));
  px(fx, 38, fw, 2, shade(skin, 0.88));
  // 귀
  px(fx - 1, 25, 1, 4, shade(skin, 0.9));
  px(fx + fw, 25, 1, 4, shade(skin, 0.9));

  // 머리카락
  px(fx - 1, 13, fw + 2, 6, hair);
  if (female) { px(fx - 3, 16, 2, 18, hair); px(fx + fw + 1, 16, 2, 18, hair); }

  // 눈썹 — 무력이 높으면 치켜올라간다
  const fierce = o.war >= 75 ? 1 : o.war >= 55 ? 0 : -1;
  const ey = 25;
  for (const side of [-1, 1]) {
    const bx = 24 + side * 5 - 2;
    px(bx, ey - 3 + (fierce > 0 ? (side < 0 ? 1 : 0) : 0), 4, 1, hair);
    if (fierce > 0) px(bx + (side < 0 ? 0 : 3), ey - 4, 1, 1, hair);
  }
  // 눈
  for (const side of [-1, 1]) {
    const bx = 24 + side * 5 - 2;
    px(bx, ey, 4, 2, '#f2ead8');
    px(bx + (side < 0 ? 2 : 1), ey, 1, 2, '#2a231c');
  }
  // 코·입
  px(23, 29, 2, 4, shade(skin, 0.88));
  px(21, 35, 6, 1, '#8d5f4a');

  // 수염
  if (!female && !eunuch) {
    const beard = o.war >= 70 || old || rnd() > 0.42;
    if (beard) {
      const bc = old ? '#a89f90' : hair;
      px(20, 36, 8, 2, bc);                       // 콧수염
      const len = old ? 12 : o.war >= 85 ? 10 : 6;
      px(21, 38, 6, len, bc);                     // 턱수염
      if (o.war >= 88 || old) { px(19, 38, 2, len - 2, bc); px(27, 38, 2, len - 2, bc); }
    }
  }

  // 머리에 쓰는 것
  if (royal) {                                    // 면류관
    px(fx - 3, 8, fw + 6, 4, '#2a2418');
    px(fx - 5, 7, fw + 10, 2, '#1a1610');
    for (let i = 0; i < 5; i++) px(fx - 3 + i * 4, 11, 2, 3, '#c9a94a');
  } else if (tribal) {                            // 두건과 깃털
    px(fx - 2, 11, fw + 4, 5, '#8a3f2f');
    px(fx + fw - 1, 6, 2, 6, '#d8c46a');
  } else if (warrior) {                           // 투구
    px(fx - 2, 10, fw + 4, 6, '#5a5f68');
    px(fx - 2, 10, fw + 4, 2, '#7d838c');
    px(23, 5, 2, 6, '#a3352b');                   // 붉은 술
    px(22, 4, 4, 2, '#c9503f');
    px(fx - 3, 16, 2, 8, '#4a4f57');
    px(fx + fw + 1, 16, 2, 8, '#4a4f57');
  } else if (scholar) {                           // 문관의 관
    px(fx, 8, fw, 6, '#2a2418');
    px(fx + 3, 4, fw - 6, 5, '#2a2418');
    px(fx, 13, fw, 1, '#4a4438');
  } else if (female) {                            // 비녀
    px(fx + 2, 10, fw - 4, 4, hair);
    px(fx + fw - 4, 8, 6, 1, '#c9a94a');
  } else {                                        // 두건
    px(fx - 1, 10, fw + 2, 5, '#3a3428');
    px(fx - 1, 10, fw + 2, 1, '#544d3c');
  }

  // 액자 테두리
  g.strokeStyle = 'rgba(60,50,30,.5)';
  g.lineWidth = 1;
  g.strokeRect(0.5, 0.5, PW - 1, PH - 1);
}

function shade(hex, m) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * m));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * m));
  const b = Math.min(255, Math.round((n & 255) * m));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
