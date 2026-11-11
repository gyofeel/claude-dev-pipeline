# 아이템 목록 테스트 케이스

> **생성일**: 2026-11-10
> **기능 범위**: 홈 화면 > 아이템 목록 화면
> **관련 파일**: tests/e2e-example/app/index.html, tests/e2e-example/app/list.html, tests/e2e-example/app/app.js
> **PRD**: works/sample/prd.md
> **TC 수**: 3
> **생성 도구**: /dev-pipeline:tc-extract

## 개요

예제 앱 화면 검증 세 가지: 홈 제목, 목업 아이템 API 로 그린 목록, 홈에서 목록으로 가는 링크.

## 수용 기준

- [ ] **AC-01**: 홈 화면에 "Sample app" 제목이 보이고 콘솔 에러가 없다.
- [ ] **AC-02**: 아이템 목록에 API 응답의 아이템마다 항목이 하나씩 보이고, 항목 이름은 `display_name` 이다.
- [ ] **AC-03**: 홈 화면에서 "Items" 링크를 누르면 `/list.html` 로 이동하고 아이템이 보인다.

## 테스트 케이스

### TC-01: 홈 화면 제목 표시

#### 메타데이터

| 항목 | 값 |
|------|----|
| **TC ID** | TC-01 |
| **spec 파일명** | tc01-home-title.spec.js |
| **우선순위** | High |
| **유형** | 정상 흐름 |
| **관련 AC** | AC-01 |
| **E2E 적합성** | E2E 가능 |
| **E2E 근거** | 렌더링된 DOM |
| **대상 화면 (domain)** | home |
| **시작 URL** | / |
| **Fixture** | (없음 — 실제 API) |
| **AI 판정 기준** | PASS만 허용 |
| **콘솔 에러 화이트리스트** | (없음) |
| **Unit 검증 대상** | 해당 없음 |

#### 전제 조건

- 없음

#### 진입 경로 및 키 시퀀스

1. `goto('/')` — 홈 화면 열기
2. `waitForAppReady()` — 제목 대기

#### 렌더링 완료 조건

- **방식**: waitFor selector
- **표현식**: `[data-testid="home-title"]`
- **타임아웃**: 10000

#### 검수 포인트

| CP ID | 유형 | 대상 / 경로 | 조건 | 설명 |
|-------|------|-------------|------|------|
| CP-01 | DOM | `testid:home-title` | `hasText('Sample app')` | 홈 제목이 보인다 |
| CP-02 | 런타임 | `consoleErrors` | `isEmpty` | 홈 화면에 콘솔 에러가 없다 |

#### 성공 기준

> 홈 화면에 "Sample app" 제목이 보이고 콘솔 에러가 없다.

#### 예상 결과

1. 제목이 "Sample app" 이다 — CP-01
2. 콘솔 에러가 없다 — CP-02

---

### TC-02: 목업 아이템으로 목록 표시

#### 메타데이터

| 항목 | 값 |
|------|----|
| **TC ID** | TC-02 |
| **spec 파일명** | tc02-item-list.spec.js |
| **우선순위** | High |
| **유형** | 정상 흐름 |
| **관련 AC** | AC-02 |
| **E2E 적합성** | E2E 가능 |
| **E2E 근거** | 렌더링된 DOM |
| **대상 화면 (domain)** | item list |
| **시작 URL** | /list.html |
| **Fixture** | items.json |
| **AI 판정 기준** | PASS만 허용 |
| **콘솔 에러 화이트리스트** | (없음) |
| **Unit 검증 대상** | 해당 없음 |

#### 전제 조건

- **API 목업**: `**/api/items` → `items.json`

#### 진입 경로 및 키 시퀀스

1. `goto('/list.html')` — 아이템 목록 열기
2. `waitForAppReady()` — 첫 항목 대기

#### 렌더링 완료 조건

- **방식**: waitFor selector
- **표현식**: `[data-testid="item"]`
- **타임아웃**: 10000

#### 검수 포인트

| CP ID | 유형 | 대상 / 경로 | 조건 | 설명 |
|-------|------|-------------|------|------|
| CP-01 | DOM | `css:[data-testid="item"]` | `toHaveCount(2)` | 목업 아이템마다 항목이 하나씩 있다 |
| CP-02 | DOM | `testid:item-list` | `hasText('First mocked item')` | 항목 이름이 display_name 이다 |

#### 성공 기준

> 아이템 목록에 목업 아이템 두 개가 각자의 이름으로 보인다.

#### 예상 결과

1. 항목이 두 개다 — CP-01
2. 첫 항목이 "First mocked item" 이다 — CP-02

#### 비고

- list.html 은 /api/items 를 직접 응답하는 서비스 워커를 등록한다. Playwright 설정이 서비스 워커를 막아야 목업이 보인다.

---

### TC-03: 홈 링크로 목록 열기

#### 메타데이터

| 항목 | 값 |
|------|----|
| **TC ID** | TC-03 |
| **spec 파일명** | tc03-home-to-list.spec.js |
| **우선순위** | Medium |
| **유형** | 정상 흐름 |
| **관련 AC** | AC-03 |
| **E2E 적합성** | E2E 가능 |
| **E2E 근거** | 화면 전환 |
| **대상 화면 (domain)** | home |
| **시작 URL** | / |
| **Fixture** | items.json |
| **AI 판정 기준** | PASS만 허용 |
| **콘솔 에러 화이트리스트** | (없음) |
| **Unit 검증 대상** | 해당 없음 |

#### 전제 조건

- **API 목업**: `**/api/items` → `items.json`

#### 진입 경로 및 키 시퀀스

1. `goto('/')` — 홈 화면 열기
2. `waitForAppReady()` — 링크 대기
3. `click(testid:to-list)` — "Items" 링크 누르기

#### 렌더링 완료 조건

- **방식**: waitFor selector
- **표현식**: `[data-testid="to-list"]`
- **타임아웃**: 10000

#### 검수 포인트

| CP ID | 유형 | 대상 / 경로 | 조건 | 설명 |
|-------|------|-------------|------|------|
| CP-01 | URL | `pathname` | `toBe('/list.html')` | 링크가 아이템 목록으로 간다 |
| CP-02 | DOM | `testid:item-list` | `hasText('Second mocked item')` | 목록에 목업 아이템이 보인다 |

#### 성공 기준

> 홈 화면에서 "Items" 를 누르면 /list.html 이 열리고 목업 아이템이 보인다.

#### 예상 결과

1. 주소가 /list.html 이다 — CP-01
2. 목록에 "Second mocked item" 이 보인다 — CP-02

---
