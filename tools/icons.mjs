#!/usr/bin/env node
// PWA 아이콘 생성기 — icons/*.png 를 직접 그려서 떨군다.
//
// 외부 의존성 0 이 이 프로젝트의 규칙이라 sharp·canvas 를 쓸 수 없다.
// 그래서 픽셀 버퍼를 손으로 채우고 PNG 를 직접 쓴다
// (시그니처 + IHDR + IDAT + IEND, zlib 은 node 표준 라이브러리).
//
// 그림은 지도의 성 표식과 같은 어법이다 — 주사(朱砂) 도장 테두리 안에
// 총안이 있는 성벽과 성문. 글꼴을 못 쓰므로 글자는 넣지 않는다.
//
//   node tools/icons.mjs        # icons/ 에 6장 (재실행해도 결과 동일)

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = join(ROOT, 'icons');

/* ─────────────────────────── PNG 쓰기 ─────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** rgba: Uint8Array(w*h*4) -> PNG Buffer */
function encodePng(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;                       // 필터 없음
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 6;      // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ─────────────────────────── 그림 ─────────────────────────── */

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

function makeCanvas(size) {
  const px = new Uint8Array(size * size * 4);
  const put = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    if (a === 255) { px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; return; }
    const t = a / 255, inv = 1 - t;
    px[i] = px[i] * inv + r * t;
    px[i + 1] = px[i + 1] * inv + g * t;
    px[i + 2] = px[i + 2] * inv + b * t;
    px[i + 3] = 255;
  };
  const rect = (x, y, w, h, col, a) => {
    for (let yy = Math.round(y); yy < Math.round(y + h); yy++)
      for (let xx = Math.round(x); xx < Math.round(x + w); xx++) put(xx, yy, col, a);
  };
  const frame = (x, y, w, h, t, col) => {
    rect(x, y, w, t, col); rect(x, y + h - t, w, t, col);
    rect(x, y, t, h, col); rect(x + w - t, y, t, h, col);
  };
  return { px, put, rect, frame };
}

/**
 * @param size    한 변 픽셀
 * @param maskable true 면 안전 영역(가운데 80%) 안으로 그림을 몰아넣는다
 */
function drawIcon(size, maskable) {
  const c = makeCanvas(size);
  const S = size;
  const INK = hex('#1c1913'), PANEL = hex('#2c261c'), SEAL = hex('#a3352b');
  const PAPER = hex('#ded1b4'), PAPER_D = hex('#b6a888'), DARK = hex('#141109');

  // 바탕
  c.rect(0, 0, S, S, INK);

  // 안전 영역 — 마스커블은 원형으로 잘려도 살아남게 안쪽으로 민다
  const pad = Math.round(S * (maskable ? 0.17 : 0.055));
  const box = S - pad * 2;

  c.rect(pad, pad, box, box, PANEL);

  // 주사 도장 테두리 두 겹
  const t1 = Math.max(1, Math.round(S * 0.026));
  const t2 = Math.max(1, Math.round(S * 0.012));
  c.frame(pad, pad, box, box, t1, SEAL);
  const g = Math.round(S * 0.055);
  c.frame(pad + g, pad + g, box - g * 2, box - g * 2, t2, SEAL);

  // 성 — 지도의 표식과 같은 어법
  const cw = Math.round(box * 0.50);          // 성벽 폭
  const ch = Math.round(box * 0.30);          // 성벽 높이
  const cx = Math.round((S - cw) / 2);
  const cy = Math.round(S / 2 - ch * 0.28);

  // 총안 다섯
  const merW = Math.round(cw / 9);
  const merH = Math.round(ch * 0.34);
  for (let i = 0; i < 5; i++) {
    const mx = cx + Math.round(i * (cw - merW) / 4);
    c.rect(mx, cy - merH, merW, merH, PAPER);
  }
  // 성벽 몸통
  c.rect(cx, cy, cw, ch, PAPER);
  c.rect(cx, cy, cw, Math.max(1, Math.round(ch * 0.09)), PAPER_D);

  // 성문 — 아치 대신 위가 둥근 사각
  const gw = Math.round(cw * 0.26);
  const gh = Math.round(ch * 0.62);
  const gx = Math.round(S / 2 - gw / 2);
  const gy = cy + ch - gh;
  c.rect(gx, gy + Math.round(gw / 2), gw, gh - Math.round(gw / 2), DARK);
  const r = gw / 2;
  for (let yy = 0; yy < r; yy++) {
    const half = Math.round(Math.sqrt(Math.max(0, r * r - (r - yy) * (r - yy))));
    c.rect(S / 2 - half, gy + yy, half * 2, 1, DARK);
  }

  // 성 아래 지반
  c.rect(cx - Math.round(cw * 0.07), cy + ch, cw + Math.round(cw * 0.14), Math.max(1, Math.round(ch * 0.10)), PAPER_D);

  // 깃대와 붉은 깃발
  const px0 = Math.round(S / 2 - Math.max(1, S * 0.008) / 2);
  const poleW = Math.max(1, Math.round(S * 0.016));
  const poleH = Math.round(box * 0.17);
  c.rect(px0, cy - merH - poleH, poleW, poleH, PAPER_D);
  c.rect(px0 + poleW, cy - merH - poleH, Math.round(box * 0.10), Math.round(box * 0.075), SEAL);

  return encodePng(c.px, size, size);
}

/* ─────────────────────────── 실행 ─────────────────────────── */

mkdirSync(OUT, { recursive: true });
const files = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-192.png', 192, true],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
  ['store_icon.png', 512, false],
];
for (const [name, size, maskable] of files) {
  const buf = drawIcon(size, maskable);
  writeFileSync(join(OUT, name), buf);
  console.log(`  ${name}  ${size}×${size}  ${(buf.length / 1024).toFixed(1)}KB`);
}
console.log(`✓ 아이콘 ${files.length}장`);
