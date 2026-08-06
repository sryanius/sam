// 장기 진행 균형 — 시나리오를 몇 십 년 돌려 천하가 실제로 좁혀지는지 본다.
//   node tools/balance.mjs [연수=25]
//
// 보는 것
//   · 해마다 살아남은 세력 수 (줄어들어야 정상)
//   · 성 함락 횟수, 공격 성공률
//   · 도시 개발도·경제가 파탄나지 않는지
//   · 배신·자립이 너무 잦지 않은지

import { SCENARIOS } from '../src/data/scenarios.js';
import { CITIES } from '../src/data/cities.js';
import { newGame, factionCities, factionOfficers, NEUTRAL, base } from '../src/game/state.js';
import { endMonth, beginMonth, rankings } from '../src/game/turn.js';
import { resolveBattle } from '../src/game/battle/engine.js';
import { autoResolve } from '../src/game/battle/ai.js';
import { caps, goldIncome } from '../src/game/city.js';

const YEARS = Number(process.argv[2]) || 25;
let bad = 0;

for (const sc of ['184', '194', '200']) {
  const st = newGame(sc, 0, 31337);
  beginMonth(st);
  const start = st.factions.filter((f) => f.alive).length;
  const marks = [];
  let takes = 0, defects = 0, playerBattles = 0;

  for (let m = 0; m < YEARS * 12; m++) {
    let r = endMonth(st);
    let guard = 0;
    while (r.interrupted && guard++ < 20) {
      playerBattles++;
      autoResolve(st.battle);
      resolveBattle(st, st.battle);
      st.battle = null;
      r = endMonth(st);
    }
    for (const line of st.reports) {
      if (/빼앗았다/.test(line)) takes++;
      if (/자립|돌아섰|떠나/.test(line)) defects++;
    }
    if (st.month === 1) {
      const alive = st.factions.filter((f) => f.alive).length;
      const top = rankings(st)[0];
      marks.push(`${st.year}: 세력 ${alive}, 선두 ${top.f.name} ${top.cities}성`);
    }
    if (st.over) break;
  }

  const alive = st.factions.filter((f) => f.alive);
  const rank = rankings(st);
  const neutral = st.cities.filter((c) => c.faction === NEUTRAL).length;
  const avgDev = st.cities.reduce((a, c) => a + c.land / caps(c).land, 0) / 46;
  const avgLoyal = st.cities.reduce((a, c) => a + c.loyal, 0) / 46;
  const totalTroops = st.cities.reduce((a, c) => a + c.troops, 0);
  const brokeCities = st.cities.filter((c) => c.faction !== NEUTRAL && c.food < c.troops * 0.2).length;

  console.log(`\n══ ${sc} (${YEARS}년) ══`);
  console.log(marks.filter((_, i) => i % Math.max(1, Math.floor(YEARS / 8)) === 0).join('\n'));
  console.log(`  끝: ${st.year}년  세력 ${start} → ${alive.length}  공백지 ${neutral}`);
  console.log(`  상위: ${rank.slice(0, 4).map((r) => `${r.f.name} ${r.cities}성`).join(' / ')}`);
  console.log(`  함락 ${takes}회  이탈·모반 ${defects}회  총병력 ${Math.round(totalTroops / 10000)}만`);
  console.log(`  평균 개발도 ${(avgDev * 100).toFixed(0)}%  평균 민충 ${avgLoyal.toFixed(0)}  군량 위험 도시 ${brokeCities}`);

  if (alive.length >= start) { console.error('  ✗ 세력이 전혀 줄지 않았다 — AI가 확장을 못 하고 있다'); bad++; }
  if (takes < YEARS * 0.6) { console.error(`  ✗ 함락이 너무 적다 (${takes}회 / ${YEARS}년)`); bad++; }
  if (avgLoyal < 40) { console.error('  ✗ 민심이 전반적으로 무너졌다'); bad++; }
  if (avgDev < 0.35) { console.error('  ✗ 도시가 전혀 크지 않는다'); bad++; }
  if (brokeCities > 12) { console.error(`  ✗ 군량이 마른 도시가 너무 많다 (${brokeCities})`); bad++; }
}

console.log(bad ? `\n✗ ${bad}건 걸림` : '\n✓ 균형 이상 없음');
process.exit(bad ? 1 : 0);
