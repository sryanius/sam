# 삼국지 (三國志)

코에이 삼국지3의 틀을 그대로 가져온 **브라우저 역사 시뮬레이션**.

- 중국 대륙 **46개 도시**, 무장 **408명**, 시나리오 **6개** (184 황건 ~ 221 삼국정립)
- 한 턴 = 한 달. 무장 한 명이 한 달에 명령 하나를 수행한다
- 내정 · 인사 · 군사 · 계략 · 외교 · 상인
- 전투는 **육각 타일 전술전** — 병종 상성, 계략(화계·수계·낙석·혼란·위보·설전),
  **일기토**, **공성**(성문·성벽 파괴)
- 무장은 **육지·수지·무력·지력·정치·매력** 여섯 능력에 **야망·의리·상성**을 지닌다.
  상성이 멀면 충성이 오르지 않고, 야망이 크면 성을 들고 돌아선다

## 실행

빌드 스텝이 없다. 정적 파일을 서빙하면 된다.

```bash
node tools/serve.mjs 5175
```

브라우저에서 `http://localhost:5175`.

> `python -m http.server` 는 쓰지 마라 — no-cache 헤더를 안 보내서 브라우저가 ES 모듈을
> 캐시한다. 소스를 고쳐도 옛 코드가 돈다. `tools/serve.mjs` 는 항상 `no-store` 로 답한다.

## 기술 구성

| 항목 | 내용 |
|---|---|
| 스택 | 순수 ES 모듈 + Canvas 2D. **빌드 스텝 없음, 외부 의존성 0** |
| 초상 | 절차 생성 픽셀아트 (48×60, 이름 해시 + 능력치 반영) |
| 지도 | 손으로 찍은 대륙 윤곽 · 황하 · 장강 폴리라인 + 도시 46 노드 |
| 세이브 | localStorage 슬롯 3개. 파일로 내보내기/불러오기 |

`docs/SPEC.md` 가 모듈 간 계약, `docs/HANDOFF.md` 가 현재 상태와 밸런스 근거다.

## 검증 도구

전부 node 로 바로 돈다 (실패 시 exit 1).

```bash
node tools/smoke.mjs      # 데이터 정합성 · 전투 · 24개월 진행 (5825건)
```

```bash
node tools/balance.mjs 25 # 25년 장기 진행 — 세력이 실제로 줄어드는지
```

```bash
node tools/imports.mjs    # import 이름이 실제 export 와 맞는지 + index.html 의 중복·미아 id
```

```bash
node tools/josa-scan.mjs  # `${이름}을` 처럼 조사를 박아 둔 자리 찾기
```

## 화면

**폰에서는 가로로 쓴다.** 세로로 들면 돌리라는 안내가 뜬다.
좁아져도 지도와 명령 패널은 가로로 나란히 둔다 — 위아래로 쌓으면 둘 다 못 쓴다.

지도는 휠·핀치로 1~4배 확대, 끌어서 이동, 두 번 누르면 전체 보기.
도시 이름은 배율과 무관하게 화면 크기로 그린다.

## 고치고 싶을 때 어디를 여는가

| 고칠 것 | 파일 |
|---|---|
| 도시 위치·연결·규모 | `src/data/cities.js` |
| 무장 능력치 | `src/data/officers.js` (한 줄에 한 명) |
| 무장 시작 위치 | `src/data/hometowns.js` |
| 시나리오 세력 구성 | `src/data/scenarios.js` |
| 보물 | `src/data/treasures.js` |
| 수입·수확·재해 | `src/game/city.js` |
| 커맨드 효과·비용 | `src/game/commands.js` |
| 충성·등용·배신 | `src/game/officer.js` |
| 컴퓨터 세력 판단 | `src/game/ai.js` |
| 전장 지형 생성 | `src/game/battle/map.js` |
| 전투 계산식 | `src/game/battle/engine.js` |
| 지도 그림 | `src/ui/mapview.js` |
| 초상 | `src/ui/portrait.js` |
