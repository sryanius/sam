// 보물 — 탐색으로 얻고, 하사해서 충성을 사고, 지닌 무장의 능력을 올린다.
//
// kind  명마 / 무기 / 병서 / 보물
// value 하사했을 때 충성도에 미치는 무게. 그리고 상인이 부르는 값의 기준.
// 능력 보정은 그 보물을 가진 무장에게 그대로 더해진다(상한 100).

export const TREASURES = [
  { id: 't01', name: '적토마',     kind: '명마', value: 200, war: 5, lead: 3, mount: 1 },
  { id: 't02', name: '적로',       kind: '명마', value: 120, war: 3, lead: 2, mount: 1 },
  { id: 't03', name: '절영',       kind: '명마', value: 130, war: 3, lead: 3, mount: 1 },
  { id: 't04', name: '조황비전',   kind: '명마', value: 140, war: 4, lead: 2, mount: 1 },
  { id: 't05', name: '대완마',     kind: '명마', value: 110, war: 3, lead: 2, mount: 1 },
  { id: 't06', name: '자류마',     kind: '명마', value: 100, war: 2, lead: 2, mount: 1 },
  { id: 't07', name: '청룡언월도', kind: '무기', value: 190, war: 6 },
  { id: 't08', name: '장팔사모',   kind: '무기', value: 180, war: 6 },
  { id: 't09', name: '방천화극',   kind: '무기', value: 200, war: 7 },
  { id: 't10', name: '의천검',     kind: '무기', value: 170, war: 4, cha: 4 },
  { id: 't11', name: '청강검',     kind: '무기', value: 150, war: 5 },
  { id: 't12', name: '칠성검',     kind: '무기', value: 140, war: 4 },
  { id: 't13', name: '고정도',     kind: '무기', value: 130, war: 4 },
  { id: 't14', name: '양유기궁',   kind: '무기', value: 120, war: 3, lead: 2 },
  { id: 't15', name: '쌍고검',     kind: '무기', value: 110, war: 3 },
  { id: 't16', name: '손자병법',   kind: '병서', value: 200, int: 5, lead: 4 },
  { id: 't17', name: '육도',       kind: '병서', value: 170, int: 4, lead: 3 },
  { id: 't18', name: '삼략',       kind: '병서', value: 160, int: 4, lead: 3 },
  { id: 't19', name: '맹덕신서',   kind: '병서', value: 150, int: 3, lead: 3 },
  { id: 't20', name: '병법이십사편', kind: '병서', value: 180, int: 5, lead: 3 },
  { id: 't21', name: '태평요술서', kind: '병서', value: 160, int: 6, cha: -2 },
  { id: 't22', name: '청낭서',     kind: '병서', value: 150, int: 4, pol: 3 },
  { id: 't23', name: '둔갑천서',   kind: '병서', value: 140, int: 5 },
  { id: 't24', name: '논어',       kind: '병서', value: 110, pol: 4, cha: 2 },
  { id: 't25', name: '사기',       kind: '병서', value: 110, pol: 3, int: 2 },
  { id: 't26', name: '전국옥새',   kind: '보물', value: 250, cha: 6, fame: 20 },
  { id: 't27', name: '동작대금',   kind: '보물', value: 120, cha: 4 },
  { id: 't28', name: '옥대',       kind: '보물', value: 100, cha: 3, pol: 2 },
  { id: 't29', name: '백옥배',     kind: '보물', value: 90,  cha: 3 },
  { id: 't30', name: '금인',       kind: '보물', value: 100, pol: 4 },
  { id: 't31', name: '수정반',     kind: '보물', value: 80,  cha: 2, pol: 2 },
  { id: 't32', name: '야명주',     kind: '보물', value: 130, cha: 4, pol: 2 },
];

export const TREASURE_BY_ID = Object.fromEntries(TREASURES.map((t) => [t.id, t]));

/** 무장이 지닌 보물의 능력 보정 합 */
export function treasureBonus(ids) {
  const b = { war: 0, int: 0, lead: 0, navy: 0, pol: 0, cha: 0, mount: 0, fame: 0 };
  for (const id of ids || []) {
    const t = TREASURE_BY_ID[id];
    if (!t) continue;
    for (const k of Object.keys(b)) if (t[k]) b[k] += t[k];
  }
  return b;
}
