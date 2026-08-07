// 병종을 무장마다 officers.js 에 못 박는다. **한 번 돌리고 결과를 손으로 다듬는 도구다.**
//   node tools/assign-troops.mjs [--write]
//
// 능력치로 뽑던 규칙은 버렸다 — 강한 무장이 죄다 기병이 됐다.
// 이제는 열전에 근거가 있으면 그대로 두고, 없는 사람만 역할과 균형으로 채운다.
//
// 이미 태그가 붙어 있으면 건드리지 않는다. 그러니 나중에 손으로 고친 것은 안전하다.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OFFICERS } from '../src/data/officers.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FILE = resolve(ROOT, 'src/data/officers.js');
const WRITE = process.argv.includes('--write');

/* ─────────── 열전에 근거가 있는 사람들 ─────────── */

// 말 위에서 싸운 것으로 이름난 자, 기병을 이끈 자, 유목 계열
const CAVALRY = `
여포 장료 마초 마대 마등 마휴 마철 방덕 한수 성의 양추 후선 정은 이감 장횡 양흥 마완
조운 관우 장비 위연 관평 관흥 장포 관색 유봉
하후돈 조인 조홍 조순 조창 조진 조휴 하후패 하후상 하후덕 문빙
문추 안량 고람 장합 원담 원상 원희 여광 여상 마연 장남 초촉
공손찬 공손월 공손범 전해 엄강 단경 추단 공손도 공손강
손견 손책 손익 손환 손소 손유
동탁 화웅 이각 곽사 장제 번조 우보 호진 서영 성렴 학맹 조성 후성 송헌 위속 장수
기령 뇌박 진란 장훈 교유 양봉 한섬 이풍
장임 냉포 오란 뇌동 등현 장위 양앙 양임
답돈 어부라 거비 가비능 월길 미당대왕 철리길 맹획 맹우 대래동주 아회남 동도나 금환삼결 사마가
문앙 왕쌍 서질 등충 채양 사환 이통 주령 노초 조진2
조조 유비 강유 마충 장의 곽준 유반 왕위 진식 오돈 윤례 손관 창희 장연
`.trim().split(/\s+/);

// 활·쇠뇌로 이름난 자, 그리고 뒤에서 계략과 원거리로 싸운 지장·책사
const ARCHERS = `
황충 하후연 태사자 손권 제갈량 주유 육손 육항 노숙 여몽 감녕 능통 서성 정봉
순욱 순유 곽가 정욱 유엽 가후 사마의 사마사 사마소 사마부 진군 종회 방통 법정 서서
마량 마속 장완 비의 동윤 곽유지 황월영 유파 황권 이엄 등지 여개 이회
저수 전풍 심배 곽도 봉기 순침 허유 진궁 진규 진등 이유 이숙
괴량 괴월 한숭 부손 장송 왕루 초주 두경 양의 진지
우번 장소 장굉 고옹 제갈근 제갈각 감택 설종 보즐 주방 낙통 시의 호종 반준 등윤 종리목
만총 왕기 진태 곽회 신비 신평 가규 유복 두기 장기 종요 화흠 왕랑 모개 동소 최염 진교 양수 진림
목록대왕 타사대왕 아단 축융 염포 양송 장로
좌자 우길 관로 화타 길평 사마휘 방덕공 최주평 석도 맹건 채옹 채염 왕이 초선 견씨 대교 소교
`.trim().split(/\s+/);

// 창·방패로 발을 붙이고 싸운 자, 농성·수비·행군에 이름난 자, 그리고 살림꾼
const INFANTRY = `
전위 허저 고순 악진 이전 우금 서황 학소 한호 여건 설제 호준 제갈서
엄안 황개 정보 한당 주태 진무 동습 능조 장흠 조무 주치 주연 주환 여대 여범 하제 유찬 주이 당자 마충2 반장
등애 관구검 제갈탄 문흠 왕릉 견초 전예 손례 사찬
미축 미방 손건 간옹 이적 진진 종예 요화 주창 오의 오반 왕보 조루 호제 부첨 부동 장익
유선 제갈첨 제갈상 황호
원소 원술 유표 유기 유종 유장 유언 도겸 조표 장개 유요 착융 설례 장영 진횡 번능 우미
엄백호 엄여 주흔 공융 무안국 왕수 한복 경무 반봉 왕윤 하진 하묘 노식 황보숭 주준
동승 복완 양표 황완 장양 건석 헌제 유대 왕충 양대장
장각 장보 장량 관해 배원소 하의 공도 유벽 황소 하만 장만성 파재 고승 등무 정원지
올돌골 손상향 손준 손침 손호 손등 여일 조식 조모 조환 하후무 조상 맹달 고패 양회 유괴 사마랑 조앙
`.trim().split(/\s+/);

/* ─────────── 배정 ─────────── */

const explicit = new Map();
for (const [list, type] of [[CAVALRY, '기병'], [ARCHERS, '궁병'], [INFANTRY, '보병']]) {
  for (const n of list) {
    if (explicit.has(n)) console.error(`  ! ${n} 이(가) 두 목록에 있다 (${explicit.get(n)} / ${type})`);
    explicit.set(n, type);
  }
}
const known = new Set(OFFICERS.map((o) => o.name));
for (const n of explicit.keys()) if (!known.has(n)) console.error(`  ! 없는 무장: ${n}`);

const count = { 기병: 0, 궁병: 0, 보병: 0 };
const assigned = new Map();
for (const o of OFFICERS) {
  const t = explicit.get(o.name);
  if (t) { assigned.set(o.name, t); count[t]++; }
}

// 남은 사람은 역할 성향을 보되 **적은 쪽부터** 채워 균형을 맞춘다
const rest = OFFICERS.filter((o) => !assigned.has(o.name));
const lean = (o) => {
  // 무력이 두드러지면 앞줄, 지력·정치가 두드러지면 뒷줄, 어중간하면 보병
  const w = o.war, m = Math.max(o.int, o.pol);
  if (w - m >= 12) return ['기병', '보병', '궁병'];
  if (m - w >= 12) return ['궁병', '보병', '기병'];
  return ['보병', '기병', '궁병'];
};
for (const o of rest.sort((a, b) => a.name.localeCompare(b.name, 'ko'))) {
  const pref = lean(o);
  // 성향 순서를 따르되, 이미 많은 쪽이면 다음 후보로 미룬다
  const target = pref.reduce((best, t) =>
    (count[t] < count[best] - 12 ? t : best), pref[0]);
  assigned.set(o.name, target);
  count[target]++;
}

console.log(`  열전 근거 ${explicit.size}명 / 균형 배정 ${rest.length}명`);
console.log(`  결과 — 기병 ${count.기병} · 궁병 ${count.궁병} · 보병 ${count.보병}`);

/* ─────────── officers.js 에 쓰기 ─────────── */

const TYPES = new Set(['기병', '궁병', '보병']);
let src = readFileSync(FILE, 'utf8');
let touched = 0;
src = src.replace(/^([가-힣\w]+ \S+ \d+ \d+(?: \d+){9})(?:\s*#(\S+))?$/gm, (line, head, tags) => {
  const name = head.split(' ')[0];
  const t = assigned.get(name);
  if (!t) return line;
  const list = tags ? tags.split(',') : [];
  if (list.some((x) => TYPES.has(x))) return line;      // 이미 박혀 있으면 둔다
  touched++;
  return `${head} #${[...list, t].join(',')}`;
});
console.log(`  ${touched}줄에 태그를 붙였다`);
if (WRITE) { writeFileSync(FILE, src); console.log('  → officers.js 갱신'); }
else console.log('  (--write 를 붙이면 실제로 씁니다)');
