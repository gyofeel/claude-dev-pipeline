# 그래프 정리 · 리포트 개편 플러그인 이식 설계

- 작성일: 2026-11-10
- 대상 저장소: `claude-dev-pipeline` (플러그인 `dev-pipeline`)
- 원본: webui-remaster `src/ver_5.6.2` (그래프 정리 병합 `e0597ba6e0` 이후)
- 함께 읽을 문서: 10-29 리포트 이식 스펙·계획
  - `~/orca/workspaces/webui-remaster/Report개선/.agents/specs/e2e-report-plugin-port.md`
  - 같은 폴더 `e2e-report-plugin-port-plan.md` (14 태스크)

---

## 1. 왜 하는가

원본 저장소(B-TV WebUI)에서 두 가지를 다시 만들었다.

1. **그래프 정리**: 파이프라인을 노드와 게이트로 다시 짰다. `PRD ─G1→ TC ─G2→ PLAN ─G3a→ IMPL ─G3→ E2E ─G4`
   - 스킬 산문 규칙을 스크립트·lint·조립기로 옮겼다
   - 측정 결과(BPM-56450 r16): 메인 세션 비용이 원 회차의 0.26배, 원 회차 결정 4항목 일치, 거짓 통과 0
2. **리포트 개편**: LLM 판정을 결정적 규칙 판정으로 바꾸고, 기능 단위 결과 리포트(G4 한 화면)를 만들었다

플러그인은 아직 둘 다 이전 구조다(v0.2.0). 11월 중순 API 명세가 오면 다른 프로젝트(첫 사용처: euxp-admin-fe-v2)가 이 플러그인으로 실제 개발을 시작한다. 그 전에 두 개선을 **범용 형태로** 플러그인에 옮긴다.

## 2. 목표 · 비목표 · 반목표

### 목표

1. 플러그인을 쓰는 어떤 웹 프로젝트도 원본과 같은 노드·게이트 구조로 PRD→TC→계획→구현→E2E→G4 를 돈다
2. 결정적으로 확인할 수 있는 것은 스크립트가 확인하고, 게이트에서는 사람이 고를 것만 묻는다
3. E2E 판정은 결정적이다. LLM 키가 없어도 같은 결과가 나온다
4. 목업이 실제로 쓰이지 않았는데 통과하는 경우(거짓 통과)가 구조적으로 없다
5. 파이프라인 밖에서 작성된 PRD 로도 G1 을 거쳐 시작할 수 있다
6. 산출물 머리말·검사 라벨과 리포트 문구를 각각 설정으로 `en`/`ko` 중에서 고른다

### 비목표

- 원본(B-TV) 전용 기능: Native 송신·주입, 리모컨 키, 홈 블록, 구매 인증, PRE 환경 시험 데이터, fixture 캡처, 응답 서명 검사
- 원본 전용 에이전트: `spec-semantic-checker`, `store-nav-advisor`, 44KB `interview.md`
- AI 해설(리포트의 coverageGap·relatedTests). 10-29 스펙대로 범위 밖
- 구형 spec 자동 변환 도구
- 시험 데이터 대체 조회 도구(원본 r16-9 의 남은 일)

### 반목표 (이러면 기술적으로 돌아가도 실패다)

- **특정 사용처에 맞춘 코드나 기본값이 플러그인에 들어간다.** euxp-admin 의 경로·MSW 시나리오·브랜치 규칙 같은 것은 그 프로젝트의 adapter·설정에서 해결한다. 이번 작업에서 euxp-admin 앱 코드는 바꾸지 않는다
- 검사 대상이 0건인데 "통과"로 보인다(확장자·경로를 못 맞춰 아무것도 안 본 경우)
- 목업이 빗나갔는데 통과한다
- 게이트에서 스크립트가 이미 확인한 것을 사람에게 체크리스트로 다시 묻는다

## 3. 제약

- 기한: 11월 중순(euxp-admin API 명세 도착) 전에 사용 가능 상태. 빠듯해도 범위는 줄이지 않는다(사용자). 일정은 병렬로 맞춘다
- 호환성: 유지하지 않는다. 새 구조로 교체하고 마이너 버전을 올린다. 사용처는 `e2e-init --upgrade` 와 CHANGELOG 로 옮긴다
- 스킬 문서(에이전트가 읽는 SKILL.md·references·agents)는 영어 한 벌. 원본의 한국어 문서는 번역해 옮긴다(약 70KB)
- 판정은 AI fetch 를 쓰지 않는다(기존 `ai-analyzer.js` 제거는 10-29 스펙 P3)
- CI 는 플러그인 없이 kit 만으로 돈다(10-29 스펙 목표 5)
- 스타일 주입 이식이 v0.3.0 으로 main 에 들어갔다(`6c302bd`, 태그 `v0.3.0`). 이 작업은 그 위에서 워크트리 `claude-dev-pipeline-graph-port`, 브랜치 `feat/graph-report-port` 로 한다. 플러그인 메인 작업 트리는 건드리지 않는다
- 스타일 이식이 `skills/tdd-implement/SKILL.md` 에 I-4b 절(plan-context)을 새로 넣었다. 그래프 정리 이식 때 이 절을 PLAN 노드 안으로 옮긴다(원본 dev-implement-tdd v2.1.0 의 PLAN 4번 자리)

## 4. 결정 사항

사용자가 정한 것과 내가 정한 것을 구분한다.

| # | 쟁점 | 결정 | 누가 |
|---|---|---|---|
| D1 | 범용성 | 플러그인에는 어느 프로젝트에도 맞는 것만. 프로젝트 맞춤은 adapter·설정에서 | 사용자 |
| D2 | 목업 검증 | 목업 패턴별 호출 횟수를 세어 0회 목업이 있으면 실패. 키트 Playwright 설정 템플릿에 `serviceWorkers: 'block'` 기본 | 사용자 |
| D3 | 외부 PRD | "가져오기" 단계: 서식 검사 → G1 한 번 → TC. 검사에 걸린 항목은 고칠 목록으로만 보여 주고 PRD 를 자동으로 고치지 않는다 | 사용자 |
| D4 | 언어 | 설정으로 `en`/`ko`. 산출물 머리말·검사 라벨(`locale`)과 리포트 문구(`e2e.report.locale`)를 따로 고른다 | 사용자 |
| D5 | 스킬 문서 언어 | 영어 한 벌(설정과 무관) | 내 판단 |
| D6 | 호환성·버전 | 호환 없이 교체. 플러그인 0.4.0, kit 0.1.0 → 0.2.0. 10-29 스펙 P4 의 구형 `analyze()` shim 은 두지 않는다(첫 사용처 `e2e/specs` 가 비어 있음) | 사용자(버전), 검토 판단(shim) |
| D7 | 확인 방법 | 플러그인 저장소의 예제 앱으로 자동 회귀 + euxp-admin 에서 `--upgrade`·설치·부팅 확인 | 사용자 |
| D8 | 스킬 이름 | 플러그인 기존 이름 유지(`prd-extract`·`tc-extract`·`tdd-implement`·`e2e-test`·`auto-dev-pipeline`·`auto-e2e-pipeline`). 원본의 `flow-run-*`·`spec-*` 이름 규칙은 원본 저장소 규칙이라 가져오지 않는다 | 내 판단 |
| D9 | 리포트 이식 순서 | 10-29 계획 T1–T10(kit)을 먼저, T11·T12(생성기·스킬 문서)는 그래프 정리 이식과 함께 다시 쓴다 | 사전 조사 권고, 내 판단 |
| D10 | 설정 키 이름 | 최상위 `locale`(산출물·검사), `e2e.report.locale`(리포트, 10-29 스펙 P5 그대로). `e2e.report.locale` 이 없으면 `locale` 을 따른다 | 사용자(분리), 내 판단(이름·기본) |
| D11 | 미사용 목업의 판정 | 실패(FAIL)로 두고 실패 분류에 `mock-unused` 를 추가한다. ENV 가 아니다: 원인이 spec·설정 쪽이라 다시 돌려도 안 바뀐다 | 내 판단 |
| D12 | 예제 앱 회귀 범위 | 자동 회귀는 결정적 구간(lint → 조립기 → Playwright 실행 → 판정 → 리포트)만. LLM 스킬을 포함한 PRD→G4 전체 한 바퀴는 수동 실행 1회로 확인하고 기록한다. 수동 실행의 게이트는 빌더가 추천안으로 진행하고 고른 답을 기록에 남긴다(검증 실행이라서. 게이트 설계 자체는 바꾸지 않는다) | 내 판단 |
| D13 | 미사용 목업을 세는 단위 | spec 파일 실행 전체. 조립기는 TC 여러 개가 한 `beforeEach` 의 목업을 공유하고 조건부 엔드포인트가 흔해, 테스트 단위로 세면 정상 TC 가 대량으로 실패한다. 파일 안 어느 테스트에서도 한 번도 안 쓰인 패턴이 있으면 그 파일의 테스트 전부를 `mock-unused` 로 표시한다 | 내 판단 |
| D14 | euxp-admin 테스트 설정 | 서비스 워커 차단으로 부팅이 막히면 euxp-admin 의 테스트 설정(Playwright `webServer` 환경변수로 앱 목업 끄기, `e2e.bootFixtures` 채우기)을 PR 로 바꾼다. 앱 코드는 바꾸지 않는다 | 사용자 |

## 5. 설계

### 5-1. 이식 대상 지도

원본 구성 요소를 세 갈래로 나눈다. **a** 그대로 옮김(번역만), **b** 범용화해서 옮김, **c** 옮기지 않음.

| 구성 요소 (원본 위치) | 처리 | 범용화 내용 | 크기 |
|---|---|---|---|
| 라우터·노드 계약 (`.agents/skills/auto-e2e-pipeline/references/pipeline-contract.md`, 두 라우터 SKILL.md) | b | 노드 호출 규약, 게이트, 상태 파일, 다음 세션 재개. 클립보드 명령은 OS 별 분기(없으면 출력만) | M |
| `coverage-gate --lint` (`scripts/tdd/coverage-gate.mjs`) | b | PRD·TC·계획서 라벨을 locale 라벨표에서 읽는다(5-4) | L |
| tc-format · tc-extract 확장 | b | 단위/E2E/수동 분류, 구현 담당(`구현`/`분리 <일감>`/`기구현`), CP 표 | L |
| 조립기 `spec-template.mjs` · `spec-lint.mjs` | b | 유형 DOM·Store·포커스·런타임·URL·팝업·관측만. 송신·Native 주입·딥링크는 c. 격리 부팅 판단은 "부팅 API" 대신 설정 `e2e.bootFixtures`(패턴 목록) 기준 | L |
| `red-gate` | b | 경로 별칭을 tsconfig/jsconfig `paths` 에서 읽고 설정으로 덮어쓸 수 있게. 테스트 파일 패턴·실행 명령을 설정에서 | M |
| tdd-implement 계획서 계약 | b | 원본 v2.1.0 의 계획 구조. 스타일 이식이 넣은 I-4b(plan-context)는 PLAN 노드 안으로 옮긴다 | M |
| e2e-report · G4 | b | 10-29 계획 T1–T10 + 아래 6개 갱신 | M |
| 공용 fixture 모델(`btc-test`·`cp()`) | b | 10-29 스펙 3-6 | M |
| `field-consumers` · `flag-effects` | b | 탐색 루트·확장자를 설정에서. 대상 0건이면 오류로 보고 | S |
| 에이전트(spec-writer·spec-reviewer·runtime-validator 등) | b | 번역·이름 정리 | S |
| prd-extract | b | G1 계약, 확인 필요 항목 | S |
| `request-sites`·`native-listeners`·remote-key·home-block·purchase-auth·fixture-capture·response-sign·`spec-semantic-checker`·`store-nav-advisor`·`interview.md` | c | — | — |

10-29 계획에서 사전 조사가 찾은 갱신 6건: T2 라벨, T4 수집기 settle/seen, T5 runtimeErrors, T6 tc-md 파서, T7 게이트(DATA·`undefined`·`NaN`·`[확인 필요]`), T9 폴더만 열람. 각 태스크를 원본 최신(`src/ver_5.6.2`)과 대조해 반영한다.

### 5-2. 노드와 스킬

```
PRD ─G1→ TC ─G2→ PLAN ─G3a→ IMPL ─G3→ E2E ─G4
 ↑
 └ 가져오기(외부 PRD) ─G1→
```

- `auto-dev-pipeline`: 위 전체. `-no-e2e` 면 G3 에서 끝
- `auto-e2e-pipeline`: PRD → TC → E2E (구현이 이미 있는 기능)
- 게이트에서 결정적 검사는 노드 출력에 이미 들어 있다. `lint.errors` 나 `uncovered` 가 남으면 게이트를 열지 않고 노드를 다시 돌린다
  - G1 `coverage-gate --prd --lint`
  - G2 `--prd --tc --lint`
  - G3a `--prd --tc --plan --lint`
  - G3 `red-gate --all` 감사 · `surface-gate` · `coverage-gate`
- 노드마다 새 세션으로 넘어간다. 라우터는 다음 재개 명령을 출력하고, 가능한 OS 에서는 클립보드에도 넣는다

### 5-3. 외부 PRD 가져오기 (D3)

진입: 라우터 인자로 상태 파일이 없는 `prd.md` 경로가 오면 가져오기로 판단한다.

1. `coverage-gate --prd --lint` 실행
2. `lint.errors` 가 있으면 고칠 목록(위치·기대 서식·현재 값)을 보여 주고 멈춘다. PRD 는 고치지 않는다. 사람이 고치거나 `prd-extract` 수정 모드로 고친 뒤 같은 명령으로 다시 시작한다
3. 오류가 없으면 G1 을 연다(`## Open questions`/`## 확인 필요` 중 진행을 막는 항목, slug)
4. 상태 파일에 `source: "external"` 과 원본 경로를 남기고 TC 노드로 간다

### 5-4. 언어 (D4·D5·D10)

- 설정 최상위 `locale: "en" | "ko"`, 기본 `en`. 리포트만 `e2e.report.locale` 로 따로 고를 수 있다(없으면 `locale`)
- 라벨표 하나(`kit/report/labels.mjs` 와 같은 자리 또는 `scripts/labels.mjs`)에 `{ en, ko }` 두 벌을 둔다. 대상:
  - PRD·TC·계획서 머리말과 고정 값(AC 출처 `stated/inferred` ↔ `✓명시/~추론`, 상태 값, `Scope` ↔ `기능 범위` 등)
  - coverage-gate·spec-lint 가 찾는 라벨 정규식
  - 리포트 문구(10-29 스펙 3-4) — 이것만 `e2e.report.locale` 을 따른다
- 검사 스크립트는 설정된 locale 의 라벨만 받는다. 두 locale 을 동시에 받지 않는다
- 테스트: 두 locale 의 키 집합이 같은지, 각 locale 의 예시 PRD·TC 가 lint 를 통과하는지
- 스킬 문서는 영어 한 벌이고, "머리말은 `locale` 라벨표를 따른다"고만 적는다. 템플릿 예시는 en 으로 둔다

### 5-5. 목업 검증 (D2·D11)

- `mock`·`mockByRequest`·`mockAll` 이 등록한 패턴마다 호출 횟수를 센다. 격리용 catch-all 은 세지 않는다
- 집계는 spec 파일 단위(D13). 테스트별 횟수를 결과에 남기고, 리포트 수집 단계에서 파일별로 합친다. 0회 패턴이 있으면 그 파일의 테스트를 FAIL, 실패 분류 `mock-unused` 로 바꾸고 진단에 패턴 목록을 남긴다
- 리포트에 분류 문구를 추가한다(두 locale)
- `kit/playwright.config.template.js` 의 `use` 에 `serviceWorkers: 'block'`
- `e2e-init --upgrade` 는 기존 프로젝트 Playwright 설정에 이 옵션이 없으면 넣을 스니펫과 이유를 보여 준다(파일은 고치지 않는다)
- 서비스 워커 없이는 부팅하지 못하는 앱은 부팅 실패로 드러난다. 그 대응(테스트 모드에서 앱 목업 계층 끄기 등)은 그 프로젝트 몫이고, 플러그인 문서에 이 경우를 한 단락으로 안내한다

### 5-6. 경로·확장자 범용화

`pipeline.config.json` 에 추가할 키(이름은 빌더가 정리해도 된다):

| 키 | 쓰는 곳 | 기본 |
|---|---|---|
| `locale` | 라벨 전체 | `en` |
| `source.roots` | field-consumers·flag-effects·red-gate | `["src"]` |
| `source.extensions` | 같음 | `[".js",".ts",".vue",".jsx",".tsx"]` |
| `source.aliases` | red-gate | tsconfig/jsconfig `compilerOptions.paths` 에서 읽음. 설정이 있으면 설정 우선 |
| `tdd.testFilePattern` | red-gate | `**/*.test.{js,ts}` |
| `e2e.bootFixtures` | 조립기 격리 판단 | `[]` (비면 격리하지 않음) |
| `e2e.judge.backendErrorPatterns` | judge | `[]` (10-29 스펙 P7) |

어떤 검사든 대상이 0건이면 "대상 없음" 오류로 보고한다. 통과로 내지 않는다.

### 5-7. 예제 앱과 회귀 (D7·D12)

- 위치: `tests/e2e-example/`. 정적 HTML 몇 장 + `fetch` 를 부르는 작은 스크립트 + 선택적 서비스 워커. 빌드 도구 없이 Playwright `webServer` 로 띄운다
- 함께 두는 것: 예제 `pipeline.config.json`(en·ko 두 벌), `prd.md`·`tc.md` 예시, adapter
- 자동 회귀(`node --test` 로 실행)
  1. 예시 PRD·TC 가 두 locale 모두 lint 통과
  2. 조립기가 tc.md 에서 spec 을 찍고 spec-lint 통과
  3. Playwright 실행 → judge → 리포트 생성
  4. 경우: 정상 PASS / 목업 하나 미사용 → FAIL `mock-unused` / 서비스 워커가 있는 페이지에서도 목업 적용 / 대상 0건 → 오류
- 수동 1회: 예제 앱에 `auto-dev-pipeline` 을 처음부터 돌려 G4 까지. 결과를 `docs/` 에 기록
- 10-29 계획의 T14(임시 프로젝트 실행 검증)는 이 예제 앱으로 대체한다

### 5-8. euxp-admin 확인

- euxp-admin 저장소 규칙을 따른다: `<type>/<slug>` 브랜치, PR, 사람이 병합. `--no-verify`·force push 금지. `e2e/kit` 은 `--upgrade` 로만 바꾼다
- 할 일: `e2e-init --upgrade` → 설정 갱신(새 키, `locale: "en"`, `e2e.report.locale: "ko"`) → 데모 화면 spec 1개 조립·실행 → 리포트 확인 → 기존 31개 PRD 중 1개로 가져오기 단계 G1 까지
- 앱 코드는 바꾸지 않는다. 서비스 워커 차단으로 부팅이 막히면 D14 대로 테스트 설정만 바꾼다

## 6. 순서와 병렬

```
1  kit 리포트 기반 (10-29 T1–T10 + 갱신 6건, 목업 검증 포함)
2  라벨표·설정 키 (5-4, 5-6)                         ← 1 과 병렬
3  검사 스크립트 범용화 (coverage-gate, red-gate, field-consumers, flag-effects)  ← 2 뒤
4  조립기·spec-lint·tc-format (10-29 T11 재작성)       ← 1·2 뒤
5  스킬·에이전트 문서 이식·번역 (라우터, 노드, 가져오기, 10-29 T12)  ← 3·4 뒤
6  예제 앱·자동 회귀 (5-7)                             ← 1 이후 시작, 4·5 뒤 완료
7  e2e-init 복사표·README·CHANGELOG·버전 (10-29 T13)
8  수동 한 바퀴 → euxp-admin 확인 (5-8)
```

순서대로 하면 1주를 크게 넘는다. 1·2, 3·4 를 병렬로 돌려야 기한에 맞는다.

## 7. 완료 기준

- 자동 회귀(5-7) 전부 통과, 기존 selfcheck 통과
- 두 locale 모두에서 예시 산출물이 lint 를 통과
- 수동 한 바퀴가 G4 까지 가고 기록이 남음
- euxp-admin 에서 `--upgrade` 후 spec 1개가 돌고 리포트가 열림, PRD 1개가 가져오기 G1 까지 감
- 플러그인 저장소에 B-TV 전용 식별자(경로 `app/`, `gnb/list`, Native·STB 용어)가 남지 않음 — grep 으로 확인

## 8. 위험

| 위험 | 대응 |
|---|---|
| 라벨 정규식이 locale 별로 어긋나 정상 PRD 가 막힌다 | 5-4 테스트. euxp-admin PRD 1개를 en 예시로 확인 |
| red-gate 가 별칭·TS 를 잘못 풀어 정당한 RED 를 "이유 틀림"으로 오판 | 예제 앱에 TS·별칭 경우를 넣는다 |
| 서비스 워커 차단으로 사용처 앱이 부팅하지 못한다 | 부팅 실패로 드러나므로 거짓 통과는 아니다. 문서 안내(5-5) |
| 10-29 계획이 원본 최신과 어긋난다 | 태스크마다 원본 파일과 대조(5-1 갱신 6건) |
| 번역량 70KB 가 일정을 잡아먹는다 | 5 단계를 노드별로 나눠 병렬 |
| 파일 단위 집계라 테스트 하나에만 필요한 목업의 빗나감은 같은 파일의 다른 테스트가 그 패턴을 쓰면 잡히지 않는다 | 알려진 한계로 문서에 적는다. 서비스 워커·glob 오타처럼 파일 전체에서 빗나가는 경우는 잡힌다 |
| 스타일 이식과 `tdd-implement/SKILL.md` 충돌 | v0.3.0 위에서 시작, I-4b 를 PLAN 노드로 옮김 |

## 9. 빌더에게 맡기는 것

- 파일·모듈 배치, 함수 이름, 설정 키의 최종 이름(5-6 표의 의미는 유지)
- 라벨표 파일 위치
- 예제 앱의 화면 구성
- 태스크 쪼개기와 병렬 배분
