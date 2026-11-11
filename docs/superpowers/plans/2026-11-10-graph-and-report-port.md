# 그래프 정리 · 리포트 개편 플러그인 이식 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dev-pipeline 플러그인에 원본(B-TV WebUI)의 노드·게이트 파이프라인과 결정적 E2E 판정·결과 리포트를 범용 형태로 옮기고 v0.4.0 으로 낸다.

**Architecture:** 리포트 쪽은 10-29 리포트 이식 계획의 Task 1–10 을 원본 최신 기준으로 갱신해 kit 에 넣는다. 그래프 쪽은 원본 `scripts/tdd/*`·조립기·스킬 문서를 옮기면서 B-TV 결합(경로·확장자·한국어 라벨·Native)을 설정과 locale 라벨표로 뺀다. 검증은 플러그인 안의 예제 앱 회귀와 euxp-admin 설치 확인 두 겹이다.

**Tech Stack:** Node 22 내장 모듈(`node:test`·`node:fs`), `@playwright/test`(kit 의 유일한 런타임 의존성), Markdown 스킬 문서.

**Spec:** `docs/superpowers/specs/2026-11-10-graph-and-report-port-design.md` (이하 "설계"). 함께 읽는다: 10-29 계획 `~/orca/workspaces/webui-remaster/Report개선/.agents/specs/e2e-report-plugin-port-plan.md`(이하 "10-29 계획")와 그 스펙 `e2e-report-plugin-port.md`.

## 경로 약속

- `PLUGIN` = `~/Desktop/GyopilSeo/to-create/claude-dev-pipeline-graph-port` (워크트리, 브랜치 `feat/graph-report-port`, 기점 `6c302bd` v0.3.0)
- `ORIG` = `~/Desktop/GyopilSeo/to-create/btv_remaster/webui-remaster-before-nuxt/webui-remaster`. **기준은 `origin/src/ver_5.6.2`**. 파일은 `git -C ORIG show origin/src/ver_5.6.2:<path>` 로 읽는다. 원본은 수정하지 않는다
- 10-29 계획이 말하는 `ORIG`(Report개선 워크트리, 기준 `3046b877dd`)는 위 `ORIG` 로 바꿔 읽는다. 두 기준 사이 변경분은 각 태스크의 "10-29 대비 갱신"에 적었다
- `EUXP` = `~/Desktop/GyopilSeo/to-create/euxp-admin/euxp-admin-fe-v2` (Task 22 에서만 쓴다)
- 플러그인 메인 작업 트리(`~/Desktop/GyopilSeo/to-create/claude-dev-pipeline`)는 건드리지 않는다

## Global Constraints

- kit 런타임 의존성은 `@playwright/test` 하나. 새 npm 의존성 추가 금지. 테스트는 `node --test` (Node 22)
- 플러그인 코드·주석·로그·스킬 문서는 영어. 사용자에게 보이는 문구는 locale 라벨표의 `en`/`ko` 두 벌
- 주석은 이유·제약만 한 줄(최대 세 줄). 작업 이력·티켓 번호 금지. 기존 주석은 건드리지 않는다
- 코드 스타일은 주변 파일을 따른다: 4칸 들여쓰기, 작은따옴표, 세미콜론
- 판정 `status` 는 `'PASS' | 'FAIL'` 두 값뿐
- 아카이브 생략 신호는 `E2E_ARCHIVE=0` 하나. `E2E_SKIP_AI` 는 남기지 않는다
- 산출물 파일명: `e2e-report.html`(아카이브), `e2e-report.md`·`e2e-loops.json`(`<worksDir>/<slug>/`)
- 설정 기본값: `locale = 'en'`, `e2e.report.locale = null`(→ `locale`), `e2e.report.loopThreshold = 3`, `e2e.judge.backendErrorPatterns = []`, `e2e.archiveDir = null`(→ `dirname(resultsJson)/archive`), `e2e.bootFixtures = []`, `source.roots = ['src']`, `source.extensions = ['.js', '.ts', '.vue', '.jsx', '.tsx', '.svelte', '.mjs', '.cjs']`, `source.aliases = null`(→ tsconfig/jsconfig `paths`)
- 테스트 파일 패턴은 기존 `unitTest.testFileGlobs` 를 쓴다. 새 키를 만들지 않는다
- 버전: 플러그인 `0.4.0`, kit `0.2.0`
- B-TV 전용(Native 송신·주입, 리모컨 키, 홈 블록, 구매 인증, PRE, fixture 캡처, 응답 서명, `request-sites`, `native-listeners`, `spec-semantic-checker`, `store-nav-advisor`, `interview.md`)은 옮기지 않는다
- 어떤 검사든 대상이 0건이면 "대상 없음" 오류. 통과로 내지 않는다
- **커밋은 사용자가 요청할 때만** 한다. 각 태스크는 "테스트 통과 확인"으로 닫는다

## Review Focus

1. 설정 `locale` 과 다른 언어 머리말의 PRD·TC(예: `locale: ko` 인데 `## Acceptance Criteria`) → AC 0건으로 "uncovered 0" 통과가 나면 안 된다. "AC 없음 — 기대 머리말: <locale 라벨>" 오류여야 한다 (Task 13 테스트)
2. `mockByRequest` 의 resolver 가 `null` 을 돌려 `route.fallback()` 한 요청 → 호출로 세지 않는다. 그 패턴이 파일 전체에서 한 번도 fulfill 하지 않았으면 `mock-unused` (Task 5 테스트)
3. 주석·trailing comma 가 있는 tsconfig(JSONC), `extends` 만 있는 tsconfig → 별칭 읽기가 죽지 않고, 못 읽으면 경고 한 줄과 함께 `source.aliases` 설정만 쓴다 (Task 14 테스트)
4. `e2e.report.locale` 을 비워 두고 `locale: 'ko'` → 리포트가 ko. `fr` 같은 모르는 값 → kit 은 en, config-load 는 오류 (Task 1 테스트)
5. 목업이 하나도 없는 spec 파일(실제 API) → 미사용 검사가 아무것도 표시하지 않는다 (Task 8 테스트)

---

## 파일 구조 (작업 후, 10-29 계획의 구조에 더해)

```
PLUGIN/
  kit/
    artifact-labels.mjs     new  PRD·TC·계획서 머리말·고정 값 { en, ko } + labelsFor(locale)
    report/labels.mjs       new  (10-29 Task 2) 리포트 문구 { en, ko }
    utils/api-mocker.js          호출 횟수 집계 mockHits(page)
    playwright.config.template.js  serviceWorkers: 'block'
    ... (10-29 계획 파일 구조 그대로)
  scripts/
    lib/source-scan.mjs     new  설정의 roots·extensions 로 파일 목록 + 별칭 해석
    field-consumers.mjs     new  원본 이식(범용화)
    flag-effects.mjs        new  원본 이식(범용화)
    coverage-gate.mjs            원본 최신으로 교체(locale 라벨)
    red-gate.mjs                 원본 최신으로 교체(별칭·테스트 패턴 범용화)
    spec-template.mjs, spec-lint.mjs  원본 최신 기준 재작성(10-29 Task 11 대체)
  tests/
    kit/*.test.mjs  scripts/*.test.mjs   new
    e2e-example/            new  예제 앱 + 회귀
  skills/ agents/ references/    이식·번역
  CHANGELOG.md              new
  docs/runs/2026-11-manual-run.md  new  수동 한 바퀴 기록
```

kit 은 프로젝트로 복사되므로 kit 코드는 `scripts/` 를 import 하지 않는다. `scripts/` 는 `../kit/artifact-labels.mjs` 를 import 해도 된다.

---

## A. 설정과 라벨

### Task 1: 설정 키

**Files:**
- Modify: `scripts/config-load.mjs`, `kit/config-loader.js`, `references/config-schema.md`
- Test: `tests/scripts/config-load.test.mjs`, `tests/kit/config-loader.test.mjs`

**Interfaces:**
- Produces: `loadConfig()` 결과에 `locale`·`source.{roots,extensions,aliases}`·`e2e.bootFixtures`·`e2e.report.{locale,loopThreshold}`·`e2e.judge.backendErrorPatterns`·`e2e.archiveDir`. kit `reportSettings(config) → { locale, loopThreshold, archiveDir }` (10-29 Task 1). 여기서 `locale` 은 `e2e.report.locale ?? config.locale`, 모르는 값이면 `'en'`

10-29 계획 Task 1 을 그대로 하되 아래를 더한다.

- [ ] **Step 1: 실패 테스트**
  - `loadConfig` 기본값이 Global Constraints 의 값과 같다
  - `locale: 'fr'` → `ENUMS` 오류
  - `{ locale: 'ko' }` 만 준 설정 → `reportSettings().locale === 'ko'`
  - `{ locale: 'ko', e2e: { report: { locale: 'en' } } }` → `'en'`
  - kit 쪽 `reportSettings({ e2e: { report: { locale: 'fr' } } }).locale === 'en'`
  - `e2e.ai` 키가 있으면 경고 한 줄(삭제된 키)
- [ ] **Step 2: 실행해 실패 확인** — `node --test tests/scripts/config-load.test.mjs tests/kit/config-loader.test.mjs` → FAIL
- [ ] **Step 3: 구현** — `DEFAULTS`·`ENUMS`(`locale: ['en','ko']`) 추가. `e2e.ai` 제거(10-29 P3). `PATH_KEYS` 에 `e2e.archiveDir` 추가. `source.roots` 는 경로 해석 대상이 아니다(스캐너가 루트 기준으로 쓴다)
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS. `node scripts/selfcheck.mjs` PASS

### Task 2: 산출물 라벨표

**Files:**
- Create: `kit/artifact-labels.mjs`
- Test: `tests/kit/artifact-labels.test.mjs`

**Interfaces:**
- Produces: `ARTIFACT_LABELS: { en: Labels, ko: Labels }`, `labelsFor(locale: string) → Labels`(모르는 값 → en). `Labels` 키(최소): `prd.scope`, `prd.acHeading`, `prd.openQuestions`, `prd.provenance.stated`, `prd.provenance.inferred`, `tc.relatedAc`, `tc.owner`, `tc.owner.implement`, `tc.owner.split`, `tc.owner.existing`, `tc.acExclusions`, `tc.surface`, `tc.e2eBasis`, `tc.manualItems`, `plan.task`, `needsCheck`
- 값 출처: `en` 은 플러그인 `skills/prd-extract/references/prd-format.md`·`skills/tc-extract/references/tc-format.md` 의 현재 머리말(`Scope`, `Acceptance Criteria`, `Open Questions`, `Related AC`, `AC exclusions`, `Implementation surface`, `Manual review items`, AC 출처 `stated`/`inferred`). `ko` 는 ORIG `coverage-gate.mjs`·`spec-extract-*/references/*-format.md` 의 한국어 라벨(`기능 범위`, `관련 AC`, `구현 담당`, `구현`/`분리`/`기구현`, `AC 범위 제외`, `구현 대상 표면`, `E2E 근거`, `✓명시`/`~추론`, `[확인 필요`)
- 원본 검사 스크립트(coverage-gate·red-gate·spec-lint·tc-md)가 쓰는 한국어 리터럴을 전부 모아 키로 만든다. 빠뜨린 리터럴은 Task 13·15 에서 테스트가 잡는다

- [ ] **Step 1: 실패 테스트** — `en`·`ko` 의 키 집합이 같다(중첩 포함), 값이 빈 문자열이 아니다, `labelsFor('fr') === ARTIFACT_LABELS.en`
- [ ] **Step 2: 실패 확인** — `node --test tests/kit/artifact-labels.test.mjs` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** → PASS

### Task 3: 리포트 라벨

10-29 계획 Task 2 그대로. **10-29 대비 갱신**: 게이트 문구 키 추가 — `gate.testDataAbsent`(ko `시험 데이터 부재`), `gate.missingValue`(ko `실측값에 빈 값`), `gate.expectedNeedsCheck`(ko `기대값 확인 필요`), 실패 분류 `failure.mock-unused`(ko `목업 미사용`, en `mock never used`). 테스트는 10-29 Task 2 의 키 집합 일치 테스트에 새 키가 들어가는지로 확인한다.

- [ ] 10-29 Task 2 의 Step 전부 + 위 키
- [ ] `node --test tests/kit/labels.test.mjs` → PASS

## B. kit 판정·수집·리포트

### Task 4: 판정

10-29 계획 Task 3 그대로. **10-29 대비 갱신**: 판정 기록에 `mockHits: { [pattern: string]: number }` 를 싣는다(Task 5 의 `mockHits(page)` 결과). judge 자체는 미사용 목업으로 FAIL 을 내지 않는다(파일 단위 집계는 Task 8).

- [ ] 10-29 Task 3 의 Step 전부
- [ ] 추가 테스트: 판정 기록에 `mockHits` 가 그대로 실린다
- [ ] `node --test tests/kit/judge.test.mjs tests/kit/analyze.test.mjs` → PASS

### Task 5: 수집과 목업 집계

**Files:** 10-29 Task 4 의 파일 + `kit/utils/api-mocker.js`
**Test:** 10-29 Task 4 의 테스트 + `tests/kit/api-mocker.test.mjs`

**Interfaces:**
- Produces: `mockHits(page) → { [pattern: string]: number }`. `mock`·`mockByRequest`·`mockAll` 이 등록한 패턴만 키로 갖는다. 격리 catch-all 은 키가 아니다. 재등록(`mock` 이 같은 패턴을 다시 부름)은 횟수를 0 으로 되돌리지 않는다
- Produces (ORIG 최신): `runCheckpoint(..., body: (seen) => Promise<any>)` — `seen(v)` 로 본 값을 남기면 단언이 실패해도 마지막 값이 `actual` 로 남는다

**10-29 대비 갱신**: ORIG `playwright/utils/checkpoint.mjs` 의 `seen` 인자(diff `3046b877dd..origin/src/ver_5.6.2`)를 반영한다.

- [ ] **Step 1: 실패 테스트** (`tests/kit/api-mocker.test.mjs`, 가짜 page 객체로 `route` 핸들러를 직접 부른다)
  - `mock(page, '**/api/a', {})` 후 핸들러 2회 호출 → `mockHits(page)['**/api/a'] === 2`
  - `mockByRequest` resolver 가 `null` → `route.fallback()` 호출, 횟수 0
  - `mockAll(page, { '**/api/a': {} }, { isolate: true })` → 키는 `'**/api/a'` 하나
  - 등록 안 한 page → `{}`
  - checkpoint: `seen(5)` 후 단언 실패 → `criterion.actual === '5'`
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — page 별 `WeakMap<Page, Map<pattern, number>>`. fulfill 할 때만 증가
- [ ] **Step 4: 통과 확인** — `node --test tests/kit/` → PASS

### Task 6: fixture · report-helper · export

10-29 계획 Task 5. **10-29 대비 갱신** (ORIG `btc-test.js`·`report-helper.js` diff):
- `DEFAULT_NETWORK_ERROR_WHITELIST = []` (B-TV 광고 도메인 제거)
- `runtimeErrors(collector, { consoleErrorWhitelist, networkErrorWhitelist }) → { consoleErrors, networkErrors }` export. 판정과 같은 화이트리스트를 거친 값(런타임 cp 용)
- annotation 문구는 "런타임 판정"(라벨 `annotation.runtimeVerdict`). 단정 실패는 테스트 상태가 정본이라 섞지 않는다
- fixture teardown 이 `mockHits(page)` 를 판정 기록에 넘긴다
- 구형 inline-afterEach spec 호환 테스트는 만들지 않는다(설계 D6). `analyze`·`attachAnalysisToReport` export 는 fixture 가 쓰므로 남긴다

- [ ] 10-29 Task 5 의 Step 전부 + 위 갱신의 테스트(`runtimeErrors` 가 화이트리스트를 적용한다, 판정 기록에 `mockHits` 가 있다)
- [ ] `node --test tests/kit/` → PASS

### Task 7: tc.md 파서

10-29 계획 Task 6. **10-29 대비 갱신**:
- 셀 안의 `\|` 는 열 경계가 아니다(ORIG `tc-md.mjs` diff)
- 머리말·행 이름을 `labelsFor(locale)` 에서 읽는다. `parseTcMd(text, { locale })`

- [ ] **Step 1: 실패 테스트** — 같은 내용의 tc.md 를 en·ko 머리말로 두 벌 만들어 파싱 결과가 같다. `| a \| b |` 셀 → `'a | b'`. `## Acceptance Criteria` 가 없는 tc.md → throw 없이 AC 절만 빈다
- [ ] **Step 2–4**: 실패 확인 → 구현 → `node --test tests/kit/tc-md.test.mjs` PASS

### Task 8: 게이트와 수집 (미사용 목업 파일 단위 집계 포함)

10-29 계획 Task 7. **10-29 대비 갱신** (ORIG `e2e-report/gate.mjs` diff):
- 단정 실패의 `lastFailure` 가 `DATA:` 로 시작하면 결함이 아니라 확인 필요(`gate.testDataAbsent`)
- 실측값 문자열에 `undefined`·`NaN`(단어 경계) → 결함(`gate.missingValue`). `null` 은 제외. `DATA:` 테스트는 건너뛴다
- cp 설명에 `labelsFor(locale).needsCheck` 토큰 → 통과해도 확인 필요(`gate.expectedNeedsCheck`, 실측값 표시)
- **미사용 목업(설계 D13)**: `collect` 가 같은 spec 파일 테스트들의 `mockHits` 를 패턴별로 합친다. 합이 0 인 패턴이 있으면 그 파일의 모든 테스트를 `status: 'FAIL'`, `failure.kind: 'mock-unused'`, 진단 `unusedMocks: string[]` 로 바꾼다. `mock-unused` 는 `DEFECT_KINDS` 에 넣는다

**Interfaces:**
- Consumes: Task 4 판정 기록의 `mockHits`, Task 2 `labelsFor`, Task 3 라벨
- Produces: `collect(...)` 결과 테스트 항목의 `failure.kind` 에 `'mock-unused'` 추가, `unusedMocks`

- [ ] **Step 1: 실패 테스트** (`tests/kit/gate.test.mjs`, `tests/kit/collect.test.mjs`)
  - ORIG `gate.test.mjs` 의 `3046b877dd` 이후 추가 테스트를 옮긴다(DATA·빈 값·확인 필요)
  - 한 파일 두 테스트: A 는 `{ '**/api/a': 1, '**/api/b': 0 }`, B 는 `{ '**/api/a': 0, '**/api/b': 2 }` → 둘 다 PASS 유지
  - 한 파일 두 테스트 모두 `'**/api/b': 0` → 둘 다 FAIL `mock-unused`, `unusedMocks: ['**/api/b']`
  - `mockHits` 가 비어 있는 파일 → 표시 없음 (Review Focus 5)
  - ko 설정에서 `[확인 필요`, en 설정에서 en 토큰이 확인 필요로 올라간다
- [ ] **Step 2–4**: 실패 확인 → 구현 → `node --test tests/kit/gate.test.mjs tests/kit/collect.test.mjs` PASS

### Task 9: 화면

10-29 계획 Task 8 그대로. 추가: 실패 분류 `mock-unused` 행이 `unusedMocks` 목록과 함께 그려진다(render-html·render-md 테스트 각 1건).

- [ ] 10-29 Task 8 Step 전부 + 위 테스트 → `node --test tests/kit/render-*.test.mjs` PASS

### Task 10: 리포트 조립과 열람

10-29 계획 Task 9. **10-29 대비 갱신**: 아카이브 루트의 날짜 목록에서 파일을 거르고 폴더만 본다(ORIG `index.mjs`·`latest.mjs` diff). 테스트: 아카이브 루트에 `.DS_Store` 파일이 있어도 throw 하지 않는다.

- [ ] 10-29 Task 9 Step 전부 + 위 테스트 → PASS

### Task 11: archive-reporter 와 Playwright 설정 템플릿

10-29 계획 Task 10. **10-29 대비 갱신**: `kit/playwright.config.template.js` 의 `use` 에 `serviceWorkers: 'block'` 과 그 이유 주석 한 줄(서비스 워커가 가로챈 요청은 `page.route` 에 보이지 않는다). 테스트: 템플릿 import 결과 `use.serviceWorkers === 'block'`.

- [ ] 10-29 Task 10 Step 전부 + 위 테스트 → `node --test tests/kit/` 전체 PASS, `node kit/selfcheck.mjs` PASS

## C. 그래프 정리 — 검사 스크립트

### Task 12: 소스 스캐너 · field-consumers · flag-effects

**Files:**
- Create: `scripts/lib/source-scan.mjs`, `scripts/field-consumers.mjs`, `scripts/flag-effects.mjs`
- Test: `tests/scripts/source-scan.test.mjs`, `tests/scripts/field-consumers.test.mjs`, `tests/scripts/flag-effects.test.mjs`

**Interfaces:**
- Produces: `listSourceFiles(root: string, config) → { files: string[], error?: 'no-targets' }` (`source.roots`·`source.extensions`, `node_modules`·`.git` 제외). `resolveAlias(spec: string, fromFile: string, root: string, config) → string | null` (저장소 기준 상대 경로, 못 풀면 null). `readAliases(root, config) → { aliases: {[prefix]: string}, warning?: string }`
- Produces: `findConsumers(...)`·`findFlagEffects(...)` — ORIG 시그니처 그대로, 단 `ROOTS`·확장자 상수 대신 `listSourceFiles` 결과를 받는다. 대상 0건이면 `{ error: 'no-targets' }`
- 출처: ORIG `scripts/tdd/field-consumers.mjs`(`ROOTS = ['app','modules','shared','server']`)·`flag-effects.mjs` 와 각 테스트

- [ ] **Step 1: 실패 테스트**
  - ORIG 테스트를 옮기고 픽스처 경로를 `src/` 로 바꾼다
  - `source.roots: ['src']` 인데 `src/` 가 없음 → `error: 'no-targets'`
  - tsconfig `paths: { "@/*": ["src/*"] }` → `resolveAlias('@/a/b', ...) === 'src/a/b'`
  - 주석·trailing comma 가 있는 tsconfig → 파싱 성공. `extends` 만 있고 `paths` 없음 → `aliases: {}` + `warning` (Review Focus 3)
  - `source.aliases: { '~/': 'app/' }` 가 있으면 tsconfig 보다 우선
- [ ] **Step 2: 실패 확인** — `node --test tests/scripts/source-scan.test.mjs tests/scripts/field-consumers.test.mjs tests/scripts/flag-effects.test.mjs` → FAIL
- [ ] **Step 3: 구현** — JSONC 는 주석·trailing comma 를 정규식으로 걷어낸 뒤 `JSON.parse`. `extends` 는 따라가지 않는다(경고만)
- [ ] **Step 4: 통과 확인** → PASS

### Task 13: coverage-gate

**Files:**
- Modify: `scripts/coverage-gate.mjs` (ORIG `scripts/tdd/coverage-gate.mjs` 최신으로 교체)
- Modify: `scripts/selfcheck-coverage.mjs` (새 출력에 맞춤)
- Test: `tests/scripts/coverage-gate.test.mjs` (ORIG `coverage-gate.test.mjs` 이식)

**Interfaces:**
- Consumes: Task 2 `labelsFor`, Task 12 `findConsumers`·`findFlagEffects`, Task 1 `loadConfig`
- Produces: CLI `node scripts/coverage-gate.mjs --prd <p> [--tc <t>] [--plan <pl>] [--lint]`. `--prd` 만 주는 PRD 모드(G1)를 지원한다(플러그인 현재판은 `--tc` 필수). 출력 JSON 은 ORIG 와 같은 모양(`uncovered`·`statuses`·`lint.errors`·`lint.warnings`), exit code 항상 0
- 범용화: 라벨 리터럴은 전부 `labelsFor(config.locale)`. `native-listeners`·`request-sites` 호출과 그 lint 항목은 뺀다. "규격서 I/F 대조 표"·"퍼블리싱 정본" lint 는 en 머리말(`Spec I/F cross-check`, `Publishing source`)로 일반화해 남긴다

- [ ] **Step 1: 실패 테스트**
  - ORIG 테스트를 ko 로 옮기고, 같은 입력의 en 판을 하나씩 만든다(케이스마다 두 locale)
  - PRD 에 AC 가 0개 → `lint.errors` 에 `no-ac` 와 기대 머리말(`labelsFor(locale).prd.acHeading`) (Review Focus 1)
  - `locale: 'ko'` 로 en 머리말 PRD 를 넣으면 → `no-ac` 오류(통과 아님)
  - TC 가 0개인 tc.md → `no-tc` 오류
  - EUXP PRD 와 같은 서식(머리말 `> **Scope**`, AC 출처 `stated`/`inferred`, 영어 상태 값, 본문 한국어)으로 **새로 지어낸** PRD `tests/scripts/fixtures/prd-en-sample.md` → en 에서 `lint.errors` 0. 플러그인 저장소는 공개 저장소라 EUXP 문서 내용을 복사하지 않는다. 실제 EUXP PRD 대조는 Task 22 에서 로컬로만 한다
- [ ] **Step 2: 실패 확인** — `node --test tests/scripts/coverage-gate.test.mjs` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** → PASS, `node scripts/selfcheck-coverage.mjs` PASS

### Task 14: red-gate

**Files:**
- Modify: `scripts/red-gate.mjs` (ORIG `scripts/tdd/red-gate.mjs` 최신으로 교체), `scripts/selfcheck-redgate.mjs`
- Test: `tests/scripts/red-gate.test.mjs` (ORIG 이식)

**Interfaces:**
- Consumes: Task 12 `resolveAlias`, Task 1 `unitTest.testFileGlobs`·`commands.unitTest`
- Produces: ORIG CLI 그대로(`--all` 감사 포함). 원장 형식(`red-evidence.jsonl`)은 ORIG 와 같다
- 범용화: `resolveSpec` 의 `@/`→루트·`~/`→`app/` 하드코딩을 `resolveAlias` 로. "어떤 vitest project 에도 매칭 안 됨" 안내의 `app/** | server/** | shared/**` 를 `unitTest.testFileGlobs` 값으로. 실패 프레임 정규식은 `.test.{js,ts,jsx,tsx}` 와 `.spec.*` 를 받는다

- [ ] **Step 1: 실패 테스트**
  - ORIG 테스트를 옮긴다
  - TS 테스트 파일 `src/a.test.ts` 가 `@/lib/x` 를 import 하고 tsconfig `@/*→src/*` → 정당한 RED 가 "실패 이유 틀림"으로 분류되지 않는다
  - 매칭 안 되는 테스트 파일 안내에 설정의 `testFileGlobs` 가 그대로 들어간다
- [ ] **Step 2–4**: 실패 확인 → 구현 → `node --test tests/scripts/red-gate.test.mjs` PASS, `node scripts/selfcheck-redgate.mjs` PASS

### Task 15: 조립기와 spec-lint

**Files:**
- Modify: `scripts/spec-template.mjs`, `scripts/spec-lint.mjs`, `scripts/selfcheck-spec.mjs`
- Test: `tests/scripts/spec-template.test.mjs`, `tests/scripts/spec-lint.test.mjs` (ORIG 이식)

10-29 계획 Task 11 을 대체한다. 기준은 ORIG `playwright/utils/spec-template.mjs`·`spec-lint.mjs` 최신과 그 테스트.

**Interfaces:**
- Consumes: Task 6 kit fixture(`test`·`cp`), Task 1 `e2e.bootFixtures`·`e2e.specFilePrefix`·`ui.*`, Task 2 `labelsFor`
- Produces: `buildSpec(input) → string` (ORIG 입력 모양에서 아래 유형만). spec-lint CLI 는 현재 플러그인판 인자 그대로
- 남기는 검증 유형: DOM · Store(`ui.stateBridge` 있을 때) · Focus · Runtime(`runtimeErrors` 사용) · URL · Popup · Observe
- 빼는 것: 송신(STB)·Native 주입·딥링크 진입·`KEY_HELPERS`·`HOME_NAV_HELPERS`·`PURCHASE_AUTH_HELPERS`·`NATIVE_DATA`·`FIXTURES_DIR` 상대 경로 하드코딩(kit 설정에서 읽는다)
- 격리 판단: `input.isolate ?? fixtures 패턴 중 하나가 e2e.bootFixtures 의 패턴과 같다`. `bootFixtures` 가 비면 격리하지 않는다
- 팝업 cp: ORIG 의 외부 주소 문서 이동을 빈 문서로 답하는 `context().route` 를 그대로
- 키 입력은 `adapter.press`/`adapter.findAndEnter` 로만(포인터·키보드 무관)

- [ ] **Step 1: 실패 테스트**
  - ORIG 테스트에서 빼는 유형을 제외하고 옮긴다
  - `bootFixtures: ['**/api/boot']` + fixtures 에 그 패턴 → 출력에 `isolate: true`. 없으면 없음
  - 출력에 `app/`·`gnb/list`·`STB`·`Native` 문자열이 없다
  - 생성 spec 이 spec-lint 를 통과한다(유형별 1건씩)
- [ ] **Step 2–4**: 실패 확인 → 구현 → `node --test tests/scripts/spec-template.test.mjs tests/scripts/spec-lint.test.mjs` PASS, `node scripts/selfcheck-spec.mjs` PASS

## D. 그래프 정리 — 스킬·에이전트 문서

문서 태스크의 검증은 `node scripts/selfcheck.mjs` 와 아래 grep 이다.

```bash
grep -rnE "app/|gnb/list|STB|Native|리모컨|BPM-|BTV|B tv" skills agents references kit scripts | grep -v examples/
```
Expected: 남은 줄마다 B-TV 결합이 아님을 확인한다(예: 일반 문장 속 `app/`). B-TV 결합이면 고친다. `examples/adapters/btv-webui/` 는 대상이 아니다

### Task 16: 라우터와 노드 계약 (외부 PRD 가져오기 포함)

**Files:**
- Modify: `skills/auto-dev-pipeline/SKILL.md`, `skills/auto-e2e-pipeline/SKILL.md`, `skills/auto-e2e-pipeline/references/shared-contract.md`
- 출처: ORIG `.agents/skills/flow-run-dev-pipeline/SKILL.md`, `flow-run-e2e-pipeline/SKILL.md`, `flow-run-e2e-pipeline/references/pipeline-contract.md`

- [ ] **Step 1**: ORIG 세 문서를 영어로 옮긴다. 스킬 이름은 플러그인 이름(`dev-pipeline:prd-extract` 등). 게이트별 결정적 검사 명령은 설계 5-2 그대로
- [ ] **Step 2**: 외부 PRD 가져오기 절 추가(설계 5-3). 판단 조건 "상태 파일이 없는 `prd.md` 경로". 순서: `coverage-gate --prd --lint` → `lint.errors` 면 고칠 목록 출력 후 정지(PRD 수정 금지) → G1 → 상태 `source: "external"`, `sourcePath` → TC 노드. 상태 파일이 이미 있으면 가져오기가 아니라 재개
- [ ] **Step 3**: 다음 세션 재개 명령은 출력하고, `pbcopy`·`xclip`·`clip.exe` 중 있는 것으로 클립보드에도 넣는다. 없으면 출력만
- [ ] **Step 4**: 검증 — `node scripts/selfcheck.mjs` PASS, 위 grep 출력 없음

### Task 17: 노드 스킬과 에이전트

**Files:**
- Modify: `skills/prd-extract/SKILL.md` + `references/prd-format.md`, `skills/tc-extract/SKILL.md` + `references/tc-format.md`, `skills/tdd-implement/SKILL.md` + `references/failure-routing.md`, `skills/e2e-test/SKILL.md` + `references/{batch-mode,runtime-loop}.md`, `agents/{spec-writer,spec-reviewer,spec-runtime-validator,fixture-advisor,screen-context,verification-advisor}.md`, `references/agents-io.md`
- 유지: 플러그인 `skills/e2e-test/references/interview.md` 는 v0.3.0 판 그대로 둔다(ORIG 의 44KB `interview.md` 는 옮기지 않는다)
- 출처: ORIG `.agents/skills/spec-extract-prd`, `spec-extract-tc`, `dev-implement-tdd`, `qa-test-e2e`(+ `references/completion.md`), `.claude/agents/auto-e2e/*`

- [ ] **Step 1**: 각 문서를 ORIG 최신 구조로 옮기고 영어로 번역한다. 형식 문서(prd-format·tc-format)는 en 머리말로 쓰고 첫머리에 "headings follow `kit/artifact-labels.mjs` for the configured `locale`" 한 줄
- [ ] **Step 2**: tdd-implement — v0.3.0 의 I-4b 절(plan-context, 스타일 주입)을 PLAN 노드의 4번 자리(ORIG `dev-implement-tdd` v2.1.0 PLAN 4번)로 옮긴다. 내용은 바꾸지 않는다. `tests/style/*.test.mjs` 39건이 그대로 통과해야 한다
- [ ] **Step 3**: e2e-test·에이전트 — 10-29 계획 Task 12 의 변경(fixture + `cp()`, 판정·리포트 경로, `E2E_ARCHIVE=0`)과 설계 5-5 의 미사용 목업 안내(분류 `mock-unused` 를 만나면 fixture 패턴·서비스 워커를 먼저 의심)
- [ ] **Step 4**: 검증 — `node scripts/selfcheck.mjs` PASS, `node --test tests/style/*.test.mjs` 39 PASS, 위 grep 출력 없음

## E. 예제 앱 · 배포 준비

### Task 18: 예제 앱과 자동 회귀

**Files:**
- Create: `tests/e2e-example/app/{index.html,list.html,app.js,sw.js}`, `tests/e2e-example/.agents/pipeline.config.en.json`, `pipeline.config.ko.json`, `tests/e2e-example/e2e.adapter.js`, `tests/e2e-example/playwright.config.js`, `tests/e2e-example/works/sample/{prd.en.md,prd.ko.md,tc.en.md,tc.ko.md}`, `tests/e2e-example/run.test.mjs`
- 예제 앱: 빌드 도구 없음. `list.html` 은 `fetch('/api/items')` 로 목록을 그린다. `sw.js` 는 `/api/items` 를 가로채 고정 응답을 낸다(서비스 워커 경우). Playwright `webServer` 는 `node` 내장 `http` 로 `app/` 을 서빙하는 한 줄 스크립트

**Interfaces:**
- Consumes: Task 2·13(lint), Task 15(`buildSpec`), Task 11(설정 템플릿·리포터), Task 8(`mock-unused`)

- [ ] **Step 1: 회귀 테스트 작성** (`run.test.mjs`, 임시 폴더에 kit 를 복사해 실행)
  1. en·ko 예시 PRD·TC 가 각 설정에서 `coverage-gate --lint` 오류 0, `uncovered` 0
  2. `buildSpec` 으로 tc.md 의 TC 마다 spec 생성 → spec-lint 통과
  3. Playwright 실행 → 정상 TC PASS, `e2e-report.html` 이 생긴다
  4. 목업 하나를 쓰지 않는 패턴으로 바꾼 spec → 그 파일 테스트가 FAIL `mock-unused`
  5. 서비스 워커가 있는 `list.html` 에서 `page.route` 목업 응답이 화면에 보인다(`serviceWorkers: 'block'`)
  6. `source.roots` 가 없는 폴더를 가리킴 → field-consumers `no-targets`
- [ ] **Step 2: 실행해 실패 확인** — `node --test tests/e2e-example/run.test.mjs` → 아직 없는 조각 때문에 FAIL
- [ ] **Step 3: 예제 앱·설정·산출물 작성**
- [ ] **Step 4: 통과 확인** → PASS. 전체 `node --test tests/` PASS

### Task 19: e2e-init · init · README · CHANGELOG · 버전

10-29 계획 Task 13. **10-29 대비 갱신**:
- `.claude-plugin/plugin.json`·`marketplace.json` → `0.4.0`, `kit/VERSION` → `0.2.0`
- `skills/init/SKILL.md`: `locale` 질문 한 개 추가(en/ko, 기본 en). 리포트 언어를 따로 고르고 싶을 때만 `e2e.report.locale` 을 쓴다고 안내
- `skills/e2e-init/SKILL.md`: 복사표에 kit 새 파일(`artifact-labels.mjs`, `report/`, `fixture.js` 등). `--upgrade` 는 프로젝트 Playwright 설정에 `serviceWorkers` 가 없으면 넣을 스니펫과 이유를 보여 준다(파일은 고치지 않는다). 리포터 스니펫(10-29 리스크 2)도 같이
- `CHANGELOG.md` 새로 작성: 0.4.0 의 깨지는 변경(노드 구조, 산출물 머리말, AI 판정 제거, 설정 키 추가·삭제)과 옮기는 법
- 10-29 계획 Task 14(임시 프로젝트 실행 검증)는 Task 18 로 대체됐으니 하지 않는다

- [ ] 10-29 Task 13 Step 전부 + 위 갱신
- [ ] 검증 — `node scripts/selfcheck.mjs` PASS, `node --test tests/` PASS, grep 출력 없음

### Task 20: 리뷰 게이트

- [ ] 브랜치 전체 리뷰(superpowers:requesting-code-review). Review Focus 5개가 각각 테스트로 고정됐는지 확인
- [ ] 리뷰 지적 반영 후 `node --test tests/` PASS, selfcheck 4종 PASS

## F. 실제 실행 확인

### Task 21: 예제 앱 수동 한 바퀴

**Files:** Create `docs/runs/2026-11-manual-run.md`

- [ ] **Step 1**: 예제 앱 폴더에서 플러그인을 로컬 설치(`--plugin-dir PLUGIN`)한 새 세션으로 `/dev-pipeline:auto-dev-pipeline` 을 기능 설명 하나로 시작한다. **이 세션 안에서 `claude` CLI 를 직접 부르지 않는다** — 사용자에게 새 터미널에서 띄워 달라고 요청한다
- [ ] **Step 2**: G1–G4 를 추천안으로 진행하고(설계 D12), 노드마다 고른 답·걸린 lint·재실행 횟수를 기록한다
- [ ] **Step 3**: 외부 PRD 가져오기를 한 번 더 확인한다(`works/sample/prd.en.md` 를 넘겨 G1 까지)
- [ ] **Step 4**: 기록 문서에 결과와 발견한 결함을 남긴다. 결함은 해당 태스크로 돌아가 고친 뒤 이 태스크를 다시 한다

### Task 22: euxp-admin 확인

EUXP 저장소 규칙을 따른다: `<type>/<slug>` 브랜치, PR, 사람이 병합. `--no-verify`·force push 금지. `e2e/kit` 은 `--upgrade` 로만 바꾼다. 앱 코드(`src/`)는 바꾸지 않는다.

- [ ] **Step 1**: EUXP 에서 `chore/dev-pipeline-0-4-0` 브랜치. `/dev-pipeline:e2e-init --upgrade` (사용자가 EUXP 세션에서 실행하도록 요청한다)
- [ ] **Step 2**: `.agents/pipeline.config.json` 갱신 — `locale: "en"`, `e2e.report.locale: "ko"`, `source.roots: ["src"]`. 서비스 워커 차단으로 부팅이 막히면 Playwright `webServer.env` 에 `VITE_ENABLE_MOCK: 'false'`, `e2e.bootFixtures` 에 부팅 API 패턴(설계 D14)
- [ ] **Step 3**: 데모 화면(vod 목업) spec 1개를 `/dev-pipeline:e2e-test` 로 만들어 실행 → 리포트가 열린다
- [ ] **Step 4**: 기존 PRD 31개 전부에 `coverage-gate --prd --lint` 를 돌려 `lint.errors` 가 0 인지 본다(0 이 아니면 라벨표 누락 → Task 2·13 으로). 그중 1개로 가져오기 → G1 까지
- [ ] **Step 5**: 결과를 `docs/runs/2026-11-manual-run.md` 에 덧붙이고, EUXP PR 본문 초안을 만들어 사용자에게 넘긴다(push·PR 은 사용자 요청 시)

---

## 병렬 배분 (설계 6절)

| 묶음 | 태스크 | 선행 |
|---|---|---|
| ① | 1 → 2 → 3 | — |
| ② | 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 | ① |
| ③ | 12 → 13 → 14 | ① (2 까지) |
| ④ | 15 | ② 의 6 까지, ① |
| ⑤ | 16 · 17 (서로 병렬) | ③·④ |
| ⑥ | 18 → 19 → 20 | ②·③·④·⑤ |
| ⑦ | 21 → 22 | ⑥ |

②와 ③은 파일이 겹치지 않아 동시에 돌린다(②는 `kit/`, ③은 `scripts/`). ⑤의 두 태스크도 파일이 겹치지 않는다.

## 완료 기준

설계 7절 그대로: 자동 회귀·selfcheck 통과, 두 locale 예시 lint 통과, 수동 한 바퀴 기록, euxp-admin 에서 spec 1개 실행·리포트 열림·PRD 1개 G1 도달, 문서 태스크의 grep 으로 B-TV 식별자 없음. grep 예외는 `examples/` 하나다(B-TV 어댑터·설정 예시를 담은 곳이라 대상이 아니다).
