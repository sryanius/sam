// 46개 도시. 좌표는 전략맵 논리 좌표(1000×780) — 중국 대륙 개형에 맞춰 배치했다.
//
// size   1~5. 도시 규모. 최대 인구/토지/상업 상한과 초기 병력 상한을 결정한다.
// terr   전투가 벌어질 때 쓰이는 주변 지형 성향 (평지/산악/삼림/수변/사막/남만)
// port   수군을 편성할 수 있는 도시 (강/바다에 접함)
// key    관문 도시 — 방어 보정 +. 낙양/장안/한중처럼 험지에 낀 곳.
//
// routes 는 아래 ROUTES 배열에서 양방향으로 만들어진다.
//   [a, b, dist, water]  dist 는 행군 일수(1턴=1개월 기준 이동 비용), water 는 수로.

export const REGIONS = {
  하북: '#7a8fb8', 중원: '#b8a06a', 관중: '#b87a6a',
  파촉: '#7ab88a', 형주: '#a67ab8', 강동: '#6aa8b8', 남중: '#b8967a',
};

/** @type {{id:number,name:string,hanja:string,region:string,x:number,y:number,size:number,terr:string,port:boolean,key:boolean}[]} */
export const CITIES = [
  // ─── 하북 ───
  { id: 0,  name: '양평', hanja: '襄平', region: '하북', x: 906, y: 72,  size: 2, terr: '평지', port: true,  key: false },
  { id: 1,  name: '북평', hanja: '北平', region: '하북', x: 792, y: 132, size: 2, terr: '산악', port: false, key: true  },
  { id: 2,  name: '계',   hanja: '薊',   region: '하북', x: 731, y: 160, size: 3, terr: '평지', port: false, key: false },
  { id: 3,  name: '남피', hanja: '南皮', region: '하북', x: 700, y: 228, size: 3, terr: '평지', port: true,  key: false },
  { id: 4,  name: '진양', hanja: '晋陽', region: '하북', x: 574, y: 214, size: 3, terr: '산악', port: false, key: true  },
  { id: 5,  name: '평원', hanja: '平原', region: '하북', x: 702, y: 285, size: 3, terr: '평지', port: true,  key: false },
  { id: 6,  name: '업',   hanja: '鄴',   region: '하북', x: 641, y: 268, size: 5, terr: '평지', port: true,  key: false },

  // ─── 중원 ───
  { id: 7,  name: '북해', hanja: '北海', region: '중원', x: 794, y: 312, size: 3, terr: '평지', port: true,  key: false },
  { id: 8,  name: '복양', hanja: '濮陽', region: '중원', x: 672, y: 330, size: 3, terr: '평지', port: true,  key: false },
  { id: 9,  name: '진류', hanja: '陳留', region: '중원', x: 632, y: 360, size: 4, terr: '평지', port: false, key: false },
  { id: 10, name: '낙양', hanja: '洛陽', region: '중원', x: 543, y: 346, size: 5, terr: '평지', port: true,  key: true  },
  { id: 11, name: '홍농', hanja: '弘農', region: '중원', x: 487, y: 342, size: 2, terr: '산악', port: false, key: true  },
  { id: 12, name: '허창', hanja: '許昌', region: '중원', x: 607, y: 398, size: 5, terr: '평지', port: false, key: false },
  { id: 13, name: '소패', hanja: '小沛', region: '중원', x: 714, y: 372, size: 2, terr: '평지', port: false, key: false },
  { id: 14, name: '하비', hanja: '下邳', region: '중원', x: 751, y: 404, size: 3, terr: '수변', port: true,  key: false },
  { id: 15, name: '여남', hanja: '汝南', region: '중원', x: 624, y: 443, size: 3, terr: '평지', port: false, key: false },
  { id: 16, name: '수춘', hanja: '壽春', region: '중원', x: 706, y: 452, size: 4, terr: '수변', port: true,  key: false },
  { id: 17, name: '노강', hanja: '廬江', region: '중원', x: 726, y: 484, size: 2, terr: '수변', port: true,  key: false },
  { id: 18, name: '완',   hanja: '宛',   region: '중원', x: 545, y: 430, size: 4, terr: '평지', port: false, key: false },

  // ─── 관중·서량 ───
  { id: 19, name: '장안', hanja: '長安', region: '관중', x: 417, y: 340, size: 5, terr: '평지', port: false, key: true  },
  { id: 20, name: '안정', hanja: '安定', region: '관중', x: 366, y: 290, size: 2, terr: '산악', port: false, key: false },
  { id: 21, name: '천수', hanja: '天水', region: '관중', x: 298, y: 330, size: 3, terr: '산악', port: false, key: false },
  { id: 22, name: '무위', hanja: '武威', region: '관중', x: 223, y: 226, size: 2, terr: '사막', port: false, key: false },
  { id: 23, name: '서평', hanja: '西平', region: '관중', x: 198, y: 322, size: 2, terr: '사막', port: false, key: false },

  // ─── 파촉 ───
  { id: 24, name: '한중', hanja: '漢中', region: '파촉', x: 330, y: 402, size: 3, terr: '산악', port: false, key: true  },
  { id: 25, name: '재동', hanja: '梓潼', region: '파촉', x: 279, y: 452, size: 2, terr: '산악', port: false, key: true  },
  { id: 26, name: '성도', hanja: '成都', region: '파촉', x: 232, y: 497, size: 5, terr: '평지', port: false, key: false },
  { id: 27, name: '강주', hanja: '江州', region: '파촉', x: 320, y: 527, size: 3, terr: '수변', port: true,  key: false },
  { id: 28, name: '영안', hanja: '永安', region: '파촉', x: 392, y: 501, size: 2, terr: '산악', port: true,  key: true  },
  { id: 29, name: '건녕', hanja: '建寧', region: '남중', x: 251, y: 612, size: 2, terr: '남만', port: false, key: false },
  { id: 30, name: '운남', hanja: '雲南', region: '남중', x: 178, y: 601, size: 2, terr: '남만', port: false, key: false },

  // ─── 형주 ───
  { id: 31, name: '상용', hanja: '上庸', region: '형주', x: 421, y: 431, size: 2, terr: '산악', port: false, key: false },
  { id: 32, name: '신야', hanja: '新野', region: '형주', x: 541, y: 452, size: 2, terr: '평지', port: false, key: false },
  { id: 33, name: '양양', hanja: '襄陽', region: '형주', x: 524, y: 492, size: 4, terr: '수변', port: true,  key: true  },
  { id: 34, name: '강릉', hanja: '江陵', region: '형주', x: 519, y: 542, size: 4, terr: '수변', port: true,  key: false },
  { id: 35, name: '무릉', hanja: '武陵', region: '형주', x: 489, y: 592, size: 2, terr: '삼림', port: false, key: false },
  { id: 36, name: '강하', hanja: '江夏', region: '형주', x: 610, y: 531, size: 3, terr: '수변', port: true,  key: false },
  { id: 37, name: '장사', hanja: '長沙', region: '형주', x: 566, y: 601, size: 3, terr: '삼림', port: true,  key: false },
  { id: 38, name: '영릉', hanja: '零陵', region: '형주', x: 510, y: 651, size: 2, terr: '삼림', port: false, key: false },
  { id: 39, name: '계양', hanja: '桂陽', region: '형주', x: 571, y: 662, size: 2, terr: '삼림', port: false, key: false },

  // ─── 강동 ───
  { id: 40, name: '시상', hanja: '柴桑', region: '강동', x: 679, y: 552, size: 3, terr: '수변', port: true,  key: false },
  { id: 41, name: '건업', hanja: '建業', region: '강동', x: 758, y: 507, size: 4, terr: '수변', port: true,  key: false },
  { id: 42, name: '오',   hanja: '吳',   region: '강동', x: 814, y: 532, size: 4, terr: '수변', port: true,  key: false },
  { id: 43, name: '회계', hanja: '會稽', region: '강동', x: 803, y: 582, size: 3, terr: '수변', port: true,  key: false },

  // ─── 남방 ───
  { id: 44, name: '남해', hanja: '南海', region: '남중', x: 654, y: 712, size: 3, terr: '삼림', port: true,  key: false },
  { id: 45, name: '교지', hanja: '交趾', region: '남중', x: 479, y: 731, size: 2, terr: '남만', port: true,  key: false },
];

/** [a, b, 거리(1~4), 수로여부] — 거리가 클수록 행군에 시간과 군량이 든다. */
export const ROUTES = [
  // 하북
  [0, 1, 3, false], [0, 3, 3, true],
  [1, 2, 1, false],
  [2, 3, 2, false], [2, 4, 3, false],
  [3, 5, 1, false], [3, 6, 1, false],
  [4, 6, 2, false], [4, 10, 3, false], [4, 20, 3, false],
  [5, 6, 1, false], [5, 7, 2, false], [5, 8, 1, false],
  [6, 8, 1, false], [6, 9, 2, false],
  // 중원
  [7, 8, 2, false], [7, 14, 2, false], [7, 13, 2, false],
  [8, 9, 1, false], [8, 13, 2, false],
  [9, 10, 2, false], [9, 12, 1, false], [9, 13, 1, false],
  [10, 11, 1, false], [10, 12, 2, false], [10, 18, 2, false],
  [11, 19, 2, false],
  [12, 15, 1, false], [12, 18, 1, false], [12, 13, 2, false],
  [13, 14, 1, false], [13, 16, 2, false],
  [14, 16, 2, false], [14, 41, 3, true],
  [15, 16, 2, false], [15, 18, 1, false], [15, 36, 3, false],
  [16, 17, 1, false], [16, 41, 3, false],
  [17, 40, 2, true], [17, 41, 2, true], [17, 36, 3, true],
  [18, 32, 1, false],
  // 관중·서량
  [19, 20, 2, false], [19, 21, 3, false], [19, 24, 3, false],
  [20, 21, 2, false], [20, 22, 3, false],
  [21, 23, 2, false], [21, 24, 3, false],
  [22, 23, 2, false],
  // 파촉
  [24, 25, 2, false], [24, 31, 2, false],
  [25, 26, 1, false], [25, 27, 2, false],
  [26, 27, 2, false], [26, 30, 3, false],
  [27, 28, 2, true], [27, 29, 3, false],
  [28, 34, 3, true],
  [29, 30, 2, false], [29, 45, 4, false],
  // 형주
  [31, 33, 2, false],
  [32, 33, 1, false],
  [33, 34, 1, false], [33, 36, 2, true],
  [34, 35, 1, false], [34, 36, 2, true], [34, 37, 2, false],
  [35, 38, 2, false], [35, 37, 1, false],
  [36, 37, 2, false], [36, 40, 2, true],
  [37, 38, 1, false], [37, 39, 1, false], [37, 40, 2, true],
  [38, 39, 1, false], [38, 45, 4, false],
  [39, 44, 3, false],
  // 강동
  [40, 41, 2, true],
  [41, 42, 1, true],
  [42, 43, 1, true],
  [43, 44, 3, true],
  // 남방
  [44, 45, 3, true],
];

export const CITY_BY_NAME = Object.fromEntries(CITIES.map((c) => [c.name, c]));

/** cityId -> [{ to, dist, water }] */
export const ADJ = (() => {
  const m = CITIES.map(() => []);
  for (const [a, b, d, w] of ROUTES) {
    m[a].push({ to: b, dist: d, water: w });
    m[b].push({ to: a, dist: d, water: w });
  }
  return m;
})();

/** 규모별 상한 — 도시 성장의 천장 */
export function cityCaps(size) {
  return {
    land: 400 + size * 200,      // 토지(농업 생산)
    flood: 400 + size * 200,     // 치수(수해 저항)
    comm: 400 + size * 200,      // 상업
    tech: 300 + size * 140,      // 기술(무기 품질)
    pop: 120000 + size * 90000,  // 인구
    troops: 15000 + size * 13000,// 병력 상한
    wall: 300 + size * 200,      // 성벽
  };
}

/** 두 도시 간 최단 행군일 (BFS on dist) — 사전 계산 */
export function buildDistanceTable() {
  const n = CITIES.length;
  const D = Array.from({ length: n }, () => new Array(n).fill(Infinity));
  for (let i = 0; i < n; i++) D[i][i] = 0;
  for (const [a, b, d] of ROUTES) { D[a][b] = Math.min(D[a][b], d); D[b][a] = D[a][b]; }
  for (let k = 0; k < n; k++)
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        if (D[i][k] + D[k][j] < D[i][j]) D[i][j] = D[i][k] + D[k][j];
  return D;
}

export const DIST = buildDistanceTable();
