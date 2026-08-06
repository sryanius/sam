// 보간 바로 뒤에 조사가 박혀 있는 자리를 찾는다.
//   `${from.name}을 떠나`  →  `${eul(from.name)} 떠나`
// 이름·세력명처럼 받침이 갈리는 값 뒤에 을/이/은/과/로 를 그냥 붙이면 어색해진다.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const walk = (d, o = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    statSync(p).isDirectory() ? walk(p, o) : p.endsWith('.js') && o.push(p);
  }
  return o;
};

const RE = /\}(을|를|이|가|은|는|와|과|으로|로)(?=[\s.,!?)`]|$)/g;
const hits = [];
for (const f of walk(join(ROOT, 'src'))) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    for (const m of line.matchAll(RE)) {
      hits.push(`  ${relative(ROOT, f)}:${i + 1}  …}${m[1]}   ${line.trim().slice(0, 100)}`);
    }
  });
}
console.log(hits.length ? hits.join('\n') : '(없음)');
console.log(`${hits.length ? '✗' : '✓'} 조사 직접 표기 ${hits.length}곳`);
process.exit(hits.length ? 1 : 0);
