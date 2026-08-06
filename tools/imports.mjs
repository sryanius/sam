// import 이름이 실제로 export 되는지 훑는다.
// UI 모듈은 node 에서 실행할 수 없어서(document 가 없다) 정적으로만 본다.
//   node tools/imports.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js') || p.endsWith('.mjs')) out.push(p);
  }
  return out;
}

/** 파일이 내보내는 이름 집합 */
function exportsOf(file) {
  const src = readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/^\s*export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const as = t.split(/\s+as\s+/);
      names.add((as[1] || as[0]).trim());
    }
  }
  if (/^\s*export\s+default/m.test(src)) names.add('default');
  return names;
}

const files = walk(join(ROOT, 'src')).concat(walk(join(ROOT, 'tools')));
const cache = new Map();
const exp = (f) => { if (!cache.has(f)) cache.set(f, exportsOf(f)); return cache.get(f); };

let bad = 0, seen = 0;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const spec = m[2];
    if (!spec.startsWith('.')) continue;
    const target = resolve(dirname(file), spec);
    let names;
    try { names = exp(target); } catch { console.error(`  ✗ ${relative(ROOT, file)} → 없는 파일 ${spec}`); bad++; continue; }
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const want = t.split(/\s+as\s+/)[0].trim();
      seen++;
      if (!names.has(want)) {
        console.error(`  ✗ ${relative(ROOT, file)} : '${want}' 은(는) ${spec} 에 없다`);
        bad++;
      }
    }
  }
}
console.log(`${bad ? '✗' : '✓'} import ${seen - bad}/${seen} 확인`);

/* ── index.html 의 id 배선 ──
   중복 id 하나 때문에 전투 옆패널이 헤더의 뱃지로 잡힌 적이 있다. 그래서 검사한다. */
{
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const dup = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
  if (dup.length) { console.error(`  ✗ index.html 중복 id: ${dup.join(', ')}`); bad++; }

  const missing = new Set();
  for (const file of files) {
    if (!file.includes('src')) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/[$]\('#([A-Za-z0-9_-]+)'\)/g)) if (!ids.includes(m[1])) missing.add(`${m[1]} ← ${relative(ROOT, file)}`);
    for (const m of src.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)) if (!ids.includes(m[1])) missing.add(`${m[1]} ← ${relative(ROOT, file)}`);
  }
  for (const x of missing) { console.error(`  ✗ 없는 id 참조: ${x}`); bad++; }
  console.log(`${dup.length || missing.size ? '✗' : '✓'} id ${ids.length}개, 중복·미아 없음`);
}

/* ── 서비스 워커의 APP_SHELL 목록 ──
   손으로 적는 목록이라 모듈을 추가하면 쉽게 낡는다. 빠져도 앱은 돌지만
   첫 오프라인 실행에서 그 파일만 없다. 그래서 검사한다. */
{
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const shell = [...sw.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]).filter((p) => p && !p.endsWith('/'));
  const gone = shell.filter((p) => {
    try { statSync(join(ROOT, p)); return false; } catch { return true; }
  });
  for (const p of gone) { console.error(`  ✗ sw.js APP_SHELL 에 없는 파일: ${p}`); bad++; }

  const mods = walk(join(ROOT, 'src')).map((p) => relative(ROOT, p).replace(/\\/g, '/'));
  const missing = mods.filter((p) => !shell.includes(p));
  for (const p of missing) { console.error(`  ✗ sw.js APP_SHELL 에 빠진 모듈: ${p}`); bad++; }
  console.log(`${gone.length || missing.length ? '✗' : '✓'} sw.js APP_SHELL ${shell.length}개, 실제 모듈과 일치`);
}

process.exit(bad ? 1 : 0);
