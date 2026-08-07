// 배 — 물 위에서만 쓰인다.
//
// 병종이 아니다. 어느 부대든 배를 가지고 나갈 수 있고, 뭍에서는 아무 쓸모가 없다.
// 물 타일(강·수전 전장)에 들어가는 순간 그 배를 타고, 배가 없으면 뗏목을 엮는다.
//
// power  물 위 전투력 배수. 뗏목은 반토막이다.
// mp     물 위 이동력 (뭍에서는 병종의 이동력을 그대로 쓴다)
// cost   출진할 때 부대 하나당 드는 금
// tech   그 배를 지으려면 출발하는 성의 기술이 상한 대비 얼마여야 하는가 (0~1)
// beam   그림 크기 — 클수록 배가 크게 그려진다

export const SHIPS = {
  뗏목: { power: 0.55, mp: 3, cost: 0,    tech: 0,    beam: 0.62, decks: 0,
         desc: '배 없이 물에 들면 이것이다. 싸움이 되지 않는다.' },
  소선: { power: 0.88, mp: 6, cost: 240,  tech: 0.15, beam: 0.78, decks: 0,
         desc: '작고 빠르다. 강을 건너기에는 넉넉하다.' },
  중선: { power: 1.08, mp: 5, cost: 620,  tech: 0.40, beam: 0.92, decks: 1,
         desc: '돛을 크게 달았다. 웬만한 수전을 감당한다.' },
  대선: { power: 1.30, mp: 4, cost: 1300, tech: 0.62, beam: 1.06, decks: 1,
         desc: '뱃전이 높아 화살이 잘 닿지 않는다.' },
  누선: { power: 1.58, mp: 4, cost: 2300, tech: 0.82, beam: 1.20, decks: 2,
         desc: '층집을 올린 큰 배. 물 위의 성이다.' },
};

export const SHIP_ORDER = ['소선', '중선', '대선', '누선'];
export const RAFT = '뗏목';

/** 배가 없을 때 물에 들면 이것을 탄다 */
export const shipOf = (name) => SHIPS[name] || SHIPS[RAFT];

/** 그 도시의 기술로 지을 수 있는 배 목록 */
export function availableShips(techRatio) {
  return SHIP_ORDER.filter((n) => techRatio >= SHIPS[n].tech);
}

/** 부대 하나당 드는 금 */
export const shipCost = (name) => (SHIPS[name] ? SHIPS[name].cost : 0);
