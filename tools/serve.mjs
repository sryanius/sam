// 개발용 정적 서버. 항상 no-store 로 응답한다 — ES 모듈 캐시에 물리지 않기 위해서.
//
//   node tools/serve.mjs 5175
//
// python -m http.server 는 쓰지 마라. 캐시 헤더를 안 보내서 소스를 고쳐도 옛 코드가 돈다.

import { createServer } from 'node:http';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const PORT = Number(process.argv[2]) || 5175;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

/**
 * 캔버스를 파일로 떨구는 개발용 창구.
 *   fetch('/__shot?name=battle', { method:'POST', body: canvas.toDataURL('image/png') })
 * → tools/shots/battle.png
 *
 * 그림을 눈으로 확인할 수 없는 환경(헤드리스·숨은 탭)에서 결과를 꺼내 보려고 둔다.
 * 개발 서버에만 있고 배포물에는 없다.
 */
async function saveShot(req, res, name) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString('utf8');
  const m = /^data:image\/(png|jpeg);base64,(.+)$/s.exec(body);
  if (!m) { res.writeHead(400).end('data URL 이 아니다'); return; }
  const dir = join(ROOT, 'tools', 'shots');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${name.replace(/[^\w.-]/g, '_')}.${m[1] === 'jpeg' ? 'jpg' : 'png'}`);
  await writeFile(file, Buffer.from(m[2], 'base64'));
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(file);
  console.log(`  shot → ${file}`);
}

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (req.method === 'POST' && p === '/__shot') {
      const name = new URL(req.url, 'http://x').searchParams.get('name') || 'shot';
      await saveShot(req, res, name);
      return;
    }
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const s = await stat(file);
    if (s.isDirectory()) { res.writeHead(302, { Location: p + '/' }).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store, must-revalidate',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
  }
}).listen(PORT, () => {
  console.log(`삼국지  http://localhost:${PORT}`);
});
