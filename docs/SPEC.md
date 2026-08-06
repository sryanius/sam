# SPEC — 모듈 간 계약

한 줄 요약: **`data/` 는 불변, `game/` 은 상태를 고치는 순수 함수, `ui/` 는 그것을 부르기만 한다.**

---

## 1. 데이터 (`src/data/`) — 게임 중에 절대 바뀌지 않는다

| 파일 | 내보내는 것 |
|---|---|
| `cities.js` | `CITIES[46]`, `ROUTES`, `ADJ`, `DIST`, `cityCaps(size)`, `REGIONS` |
| `officers.js` | `OFFICERS[408]`, `OFFICER_BY_NAME`, `overall(o)` |
| `hometowns.js` | `HOMETOWN` (도시 → 무장 이름), `HOME_OF` (무장 → 도시) |
| `scenarios.js` | `SCENARIOS[6]`, `SCENARIO_BY_ID` |
| `treasures.js` | `TREASURES[32]`, `treasureBonus(ids)` |

**무장 한 명** — `officers.js` 의 한 줄:

```
이름 한자 생년 몰년 육지 수지 무력 지력 정치 매력 야망 의리 상성 [#태그]
```

- 능력 여섯은 1~100, 야망·의리는 1~15, 상성은 0~149 원형.
- 상성 거리는 `affinityGap(a,b)` — 0~74. 작을수록 궁합이 좋다.
- 태그: `여성` `이민족` `의원` `방사` `황족` `환관`.

**도시 상한**은 `cityCaps(size)` 하나가 정한다. 토지/치수/상업/기술/인구/병력/성벽.
도시를 크게 하고 싶으면 `size` 를 올려라 — 나머지는 따라온다.

---

## 2. 상태 (`src/game/state.js`)

`newGame(scenarioId, playerFactionIdx, seed)` 가 만드는 순수 JSON.
`serialize`/`deserialize` 로 그대로 저장된다. **함수나 참조를 넣지 마라.**

```js
st = {
  scenarioId, seed, year, month, turn, player,
  factions: [{ id, name, color, rulerName, ruler, alive, allies[], truce{}, relation{}, fame }],
  cities:   [{ id, faction, land, flood, comm, tech, wall, pop, loyal,
               gold, food, troops, train, morale, governor }],
  officers: [{ id, faction, city, loyalty, acted, status, captiveOf,
               troops, treasures[], merit, found?, deathMonth? }],
  log[], reports[], battle, over,
}
```

- `faction === -1` (`NEUTRAL`) 은 공백지 / 재야를 뜻한다.
- `officers[].id` 는 `OFFICERS` 의 인덱스다. `base(s)` 가 원본을, `eff(s)` 가 보물까지 얹은 값을 준다.
- **전투·판정은 언제나 `eff(s)` 를 쓴다.** `base(s)` 는 이름·생몰·야망처럼 안 변하는 것에만.

조회 헬퍼: `officersIn` `membersIn` `freeIn` `captivesIn` `factionCities` `factionOfficers`
`rulerOf` `power` `frontiers` `isAllied`.

---

## 3. 커맨드 (`src/game/commands.js`)

모든 커맨드는 **`{ ok, msg, ...extra }`** 를 돌려준다. `ok:false` 면 상태는 하나도 안 바뀐다.
성공하면 무장의 `acted` 가 `true` 가 되어 그 달엔 더 못 움직인다.

```
내정  develop(st, cityId, officerId, kind, invest)   kind: 개간/치수/상업/기술/축성
      patrol(st, cityId, officerId)
군사  conscript / drill / transport
인사  doSearch / recruit / reward / giveTreasure / moveOfficer /
      appointGovernor / dismiss / captiveAction
계략  plot(st, cityId, officerId, kind, targetCityId, targetOfficerId)
외교  diplomacy(st, cityId, officerId, kind, targetFid, gold)
상인  trade / buyTreasure / merchantRates
```

효과 계산은 `city.js`(`devGain` `patrolGain` `trainGain` `conscriptMax`)와
`officer.js`(`recruitChance` `rewardGain` `plotChance`)에 모여 있다.
**수치를 만지려면 커맨드가 아니라 이 두 곳을 봐라.**

---

## 4. 한 달의 흐름 (`src/game/turn.js`)

```
beginMonth(st)          모든 무장의 acted 를 푼다
  ↓ (플레이어가 명령을 내린다)
endMonth(st) →
   1. 컴퓨터 세력  runFactionAI(st, fid)
        └ 플레이어 성을 치면 { interrupted:true, battle } 로 즉시 반환
   2. 도시 정산    monthlyUpdate  (수입·수확·소비·인구·재해)
   3. 충성 표류와 배신
   4. 사망·등장
   5. 화친 만료 · 세력 멸망 · 천하통일 판정
   6. 달을 넘기고 beginMonth
→ { interrupted:false, reports[] }
```

**중단·재개 규약**: `endMonth` 가 `interrupted` 를 돌려주면 화면이 `st.battle` 을 치른 뒤
`endMonth(st)` 를 **다시** 부른다. 진행 위치는 `st._phase` / `st._aiCursor` 에 남아 있다.

---

## 5. 전투 (`src/game/battle/`)

### map.js — 전장

- 육각 축좌표 `(q, r)`, 17×13. 타일 키는 `axial(q,r)` = `"q,r"`.
- 지형은 **도시 id 로 시드**를 만든다 → 같은 성은 언제나 같은 전장.
- 성은 오른쪽 `col = W-4` 에 **위아래를 완전히 가로막는 성벽** + 가운데 `성문`.
  성벽·성문은 `hp` 를 가지며 `hp > 0` 이면 못 지난다. `breach(tile)` 로 뚫리면 `가도` 가 된다.
- `map.core` 를 공격측이 밟으면 성이 떨어진다.

### engine.js — 진행

```js
startBattle(st, fromCityId, toCityId, picks) → battle | { error }
   picks: [{ officerId, troops, type }]   type: 보병/기병/궁병/수군
```

`battle.units[]` 각각은 **편성 시점의 능력치를 `u.stat` 에 복사해 둔다** —
전투 중에 원본을 다시 뒤지지 않는다.

| 행동 | 함수 |
|---|---|
| 이동 | `moveOptions` → `moveUnit` |
| 공격 | `canAttack` → `attack` |
| 공성 | `canBreak` → `breakWall` (공격측만, 맞닿은 성문·성벽) |
| 계략 | `tacticAvailable` → `useTactic` (화계·수계·낙석·혼란·위보·설전) |
| 일기토 | `canDuel` → `duelAccepted` → `duel` |

하루는 공격측 → 방어측. `beginSide` / `endSide`. 최대 30일.
승패는 `checkOver`: 전멸 · 본성 점령 · 기한 만료 · 철수.

**전투가 끝나면 반드시 `resolveBattle(st, battle)`** 를 불러야 전략 상태에 반영된다
(성 주인 교체, 생존 병력 귀환, 전사·포로 처리).

### ai.js — 전투 AI

- `aiStep(battle, side)` — 부대 하나만 움직인다(화면에서 한 수씩 보여줄 때).
- `playSide(battle, side)` — 그 측 전부.
- `autoResolve(battle)` — 화면 없이 끝까지. **AI 대 AI 전투는 이걸로 즉시 판정한다.**

---

## 6. 화면 (`src/ui/`)

| 파일 | 맡은 것 |
|---|---|
| `app.js` | 화면 흐름 전체. `Game` 클래스 하나가 상태를 쥔다 |
| `mapview.js` | 전략 지도 Canvas. `resize(forceW, forceH)` 로 크기를 강제할 수 있다 |
| `city.js` | 도시 패널과 모든 커맨드 대화상자 |
| `battleview.js` | 전장 Canvas와 조작 |
| `lists.js` | 일람(세력·무장·도시·연표) |
| `portrait.js` | 절차 생성 초상 |
| `dom.js` | `el` `showModal` `toast` `slider` 등 잡일 |

**ui 는 게임 규칙을 갖지 않는다.** 화면에서 수치를 계산하고 있다면 `game/` 으로 옮겨라.

`ctx` 객체 하나가 화면↔게임을 잇는다:

```js
ctx = { refresh(), launchBattle(fromId, toId, picks) }
```

---

## 7. 난수

`core/rng.js` 의 **전역 `rng` 하나**만 쓴다. 시드는 `st.seed` 에 실려 세이브된다.
`endMonth` 가 시작할 때 `rng.seed = st.seed`, 끝날 때 `st.seed = rng.seed`.
`Math.random()` 을 쓰면 세이브가 재현되지 않는다 — 쓰지 마라.

전장 지형만 예외로 `makeRng(9000 + cityId*137)` 를 따로 만든다(도시마다 고정이어야 하므로).

---

## 8. 한글 조사

`core/util.js` 의 `eul` `eun` `iga` `gwa` `euro` 를 써라.
`${name}이(가)` 같은 표기를 새로 만들지 마라 — `${iga(name)}` 이면 된다.
