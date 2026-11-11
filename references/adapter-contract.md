# Runtime kit and project adapter

Generated specs import runtime code. That code must live in the project (CI runs without the plugin), so `/dev-pipeline:e2e-init` copies the kit from `${CLAUDE_PLUGIN_ROOT}/kit/` into `<e2e.kitDir>/` and scaffolds an adapter at `<e2e.adapterModule>`. Specs import only two modules:

```js
import { test, expect, mockAll, captureFailureDiagnostics, captureNavigationCensus } from '<rel>/kit/index.js';   // + runtimeErrors, readWatch, watchSelectors when used
import adapter from '<rel>/e2e.adapter.js';                    // may re-export kit defaults
```

`<rel>` is computed by `spec-template.mjs` from the spec's directory to `e2e.kitDir` and `e2e.adapterModule`.

## Kit contents (`kit/`)

| File | Exports | Notes |
|---|---|---|
| `index.js` | re-exports the spec-facing modules below + `KIT_VERSION` | single import surface |
| `fixture.js` | `test`, `expect` | Playwright `test` extended with an `e2e` option and two fixtures. `collector` (auto) starts `RuntimeCollector` before the spec's `beforeEach`; after the test it filters whitelists, judges, attaches `verdict.json` and a viewport screenshot, and throws on a FAIL verdict. `cp(id, body, { soft })` runs one checkpoint as a `test.step`, marks the matching `SUCCESS_CRITERIA` entry passed and keeps the returned (or `seen(…)`) value as its actual value; `soft: true` records a failure instead of throwing |
| `services/judge.js` | `judge({ runtimeData, testMeta, testStatus, backendErrorPatterns, locale })` | rule-based verdict, `status` `PASS` / `FAIL`: client console errors and exceptions fail; API error responses fail only when `testMode` is `real-api`, and never when a fixture mock answered with that status on purpose; `e2e.judge.backendErrorPatterns` matches are excluded in fixture mode; whitelisted and resource-load errors are listed as excluded |
| `services/analyze.js` | `analyze(runtimeData, testMeta)` | reads the running test's status and applies `judge`; the `collector` fixture calls it after each test |
| `services/runtime-collector.js` | `class RuntimeCollector { start(), settle(), collect() }` | console errors/warnings, uncaught exceptions, failed requests, slow requests; `settle()` waits for the network to go quiet |
| `utils/runtime-filter.mjs` | `runtimeErrors(collector, { consoleErrorWhitelist, networkErrorWhitelist })` | errors so far through the same whitelists as the verdict (Runtime checkpoints) |
| `utils/api-mocker.js` | `mock`, `mockByRequest`, `unmock`, `mockAll(page, routeMap, { isolate, fixturesDir })`, `mockHits(page)` | `routeMap` values are fixture file names (relative to `e2e.fixturesDir`) or inline objects. `isolate: true` stubs every unmatched data request with `{}` so fixture runs never hit the network. Each registered pattern counts the requests it answered; the report fails a spec file whose pattern answered none (`mock-unused`) |
| `utils/watch-helper.js` | `watchSelectors(page, selectors)`, `readWatch(page, windowMs)` | samples short-lived elements every 250 ms (peak count, texts seen), surviving reloads (Observe checkpoints) |
| `utils/report-helper.js` | `attachAnalysisToReport(testInfo, analysisResult, runtimeData, criteria)` | attaches `verdict.json` (per-test record the report reads) |
| `utils/diagnostics-helper.js` | `captureFailureDiagnostics(page, testInfo, { step, expected, adapter })`, `captureNavigationCensus(page, testInfo, { target, candidateCount, enteredLog, visited })` | `failure-diagnostics`: url, title, active element, visible text sample, `adapter.snapshotState(page)`, screenshot. `navigation-census`: `verdictHint` `NO_CANDIDATE` / `ENTERED_BUT_REJECTED` |
| `utils/default-adapter.js` | `defaultAdapter`, `resolveTarget`, `describeActiveElement` | see contract below |
| `utils/archive-reporter.mjs` | Playwright reporter | registered last in `reporter`; copies each run to `<archiveDir>/<YYMMDD>/<tag>-<NN>/` and writes `e2e-report.html` there, plus `<worksDir>/<slug>/e2e-report.md` for an unfiltered run of a whole spec directory that has a `tc.md`. `E2E_ARCHIVE=0` skips the archive only: either way, a test the report fails while Playwright passed it (`mock-unused`) makes the run exit non-zero |
| `report/*` | `open.mjs` (CLI), `collect.mjs` (`collectRun`, `classifyFailure`), `gate.mjs`, renderers | `node <e2e.kitDir>/report/open.mjs` serves the latest `e2e-report.html` through `playwright show-report` (needed for trace links) |
| `config-loader.js` | `loadKitConfig()` | reads `.agents/pipeline.config.json` at runtime (fixtures dir, state bridge, report and judge settings) |
| `artifact-labels.mjs` | `labelsFor(locale)` | PRD / TC headings and fixed values the report parses |
| `VERSION` | semver string | `e2e-init --upgrade` compares and shows a diff before overwriting |
| `playwright.config.template.js` | — | copied to the project root only if no `playwright.config.*` exists. Sets `serviceWorkers: 'block'` (a service worker can answer requests before `page.route` sees them, so mocks would go unused), `trace: 'on'` (the report shows one frame per checkpoint), the json reporter and the archive reporter |

Runtime dependency of the kit: `@playwright/test` only.

A project config without `serviceWorkers: 'block'` lets an app's service worker bypass the mocks; the spec file then fails as `mock-unused`. An app that cannot boot without its service worker fails at boot instead — turning the worker (or its mock layer) off in test mode is the project's call.

## Adapter contract (`e2e.adapter.js`)

The adapter is a plain ES module default-exporting an object. Every member is optional; the kit's `defaultAdapter` fills gaps. Specs always call through `adapter.*` so a project can replace behaviour without touching generated code.

```js
export default {
  /** Wait until the app is usable. Default: waitForLoadState('domcontentloaded') → renderSelector (CSS, first match) visible → readyExpr (per spec, else e2e.readyExpr) true. */
  async waitForAppReady(page, { renderSelector = null, readyExpr = null, timeout = 30000 } = {}) {},

  /** Logical key name → Playwright key. Default: identity + ArrowUp/Down/Left/Right, Enter, Escape, Backspace, Tab, Space. Used by `press`. */
  keyMap: {},

  /** Press one logical key. Default: page.keyboard.press(keyMap[key] ?? key). */
  async press(page, key, { delay = 0 } = {}) {},

  /**
   * Locate a target and activate it. `target` = { by: 'testid'|'role'|'text'|'css'|'predicate', value, name?, nth? }.
   * Pointer default: resolve a Playwright locator and click it.
   * Keyboard projects MUST implement this (config check fails otherwise); it should move focus to the
   * target by key presses and press Enter. Return true on success, false if not found (spec skips or fails per plan.fallback).
   */
  async findAndEnter(page, target, { timeout = 10000 } = {}) {},

  /** Resolve a target descriptor to a Locator. Default handles testid/role/text/css; predicate requires stateBridge. */
  locator(page, target) {},

  /** Optional: extra fields merged into failure diagnostics (e.g. app focus id, current route in state). */
  async snapshotState(page) { return {}; },

  /** Optional: JS expression evaluated in the page for navigation `focusChanges` waits. Default: null → document.activeElement descriptor. */
  focusExpr: null
};
```

Focus **checkpoints** do not read `adapter.focusExpr`; they read config `ui.stateBridge.focusExpr` (else the focused element's opening tag), which the assembler compiles into the spec.

### Target descriptors

| `by` | `value` | Resolves to |
|---|---|---|
| `testid` | attribute value | `[<ui.testIdAttribute>="value"]` |
| `role` | ARIA role, `name` optional | `page.getByRole(value, { name })` |
| `text` | visible text (substring, case-insensitive) | `page.getByText(value)` |
| `css` | selector | `page.locator(value)` |
| `predicate` | JS boolean over `item` (an element of a state array named by `source`) | requires `ui.stateBridge`; the adapter decides how to reach the matched item. Pointer default: not supported → throws |

`nth` picks one match when several exist (0-based). Missing `nth` with multiple matches → the locator's strict-mode error surfaces as a FAIL with a clear message.

In TC files and assembler input, DOM checkpoint targets are written as strings: `testid:<value>`, `role:<role>[<name>]`, `text:<text>`, `css:<selector>`, or bare CSS. `renderSelector` is always plain CSS.

## Spec skeleton guarantees (what the assembler emits)

`scripts/spec-template.mjs` produces the whole file from its input (`INPUT_SCHEMA` in the script; `--help` prints it). spec-writer supplies only `slotBody` (and optionally `setupBody`). It guarantees:

1. one import line from the kit index: `test`, `expect`, `mockAll`, `captureFailureDiagnostics`, `captureNavigationCensus`, plus `runtimeErrors` (Runtime checkpoints) and `readWatch` / `watchSelectors` (Observe checkpoints); and the adapter. Nothing outside the body slot is edited by hand
2. constants `TC_NAME`, `START_URL`, `CONSOLE_ERROR_WHITELIST`, `NETWORK_ERROR_WHITELIST` (input + `e2e.networkNoiseWhitelist`), `SUCCESS_CRITERIA` (`{ id: 'cp-NN', desc }` in input order)
3. `test.use({ e2e: { tcName, screen, testMode, successCriteria, successCriteriaText, consoleErrorWhitelist, networkErrorWhitelist } })` — `testMode` is `'fixture'` when isolated, else `'real-api'`
4. `test.describe` with `test.setTimeout(N)` first (N ≥ 60000, default 120000)
5. `beforeEach`: `await mockAll(page, fixtures, { isolate })` with an explicit `isolate` — `true` exactly when a fixtures glob is listed in `e2e.bootFixtures` (never for `C2`) — then `page.goto(START_URL, { waitUntil: 'domcontentloaded' })` → `adapter.waitForAppReady(page, { renderSelector, readyExpr })`
6. `test(TC_NAME, async ({ page, cp[, collector] }[, testInfo]) => …)` with, in order: the Observe sampler (`watchSelectors`) and the popup listener (`page.on('popup')` plus a context route that answers external navigations with an empty page) → `setupBody` → `before: true` checkpoints → `slotBody` (or the `// <<< TEST_BODY >>>` marker when none was given, which lint rule 20 rejects) → the remaining checkpoints. The first Runtime checkpoint is preceded by `await collector.settle()`; the Observe window is read once with `readWatch`
7. `cases[]` → one shared file-level `beforeEach` and one `test.describe` per case, each with its own `TC_NAME`, `SUCCESS_CRITERIA` and `test.use`

No `afterEach`, no `analyze()` call, no `ACCEPTABLE_STATUSES`: the kit fixture owns the verdict, attachments and the throw. No static-analysis file, no `globalSetup` requirement, no product-specific import. `spec-lint.mjs` checks the result (rules 21: every criterion runs through `cp()`; 22: `test` comes from the kit).

## Verification compilation

| type (`ko` label) | target / path | condition | emitted inside `cp()` |
|---|---|---|---|
| `DOM` | descriptor string | `visible` (default) · `hidden` · `hasText('…')` · `not hasText('…')` · `not hasClass <c>` · locator matcher call (`toHaveCount(N)`, `toHaveAttribute('k', 'v')`, `not.toBeVisible()` …) | `await expect(adapter.locator(page, target)).<matcher>`; `hasText` → `toContainText` and the shown texts are kept as the actual value |
| `Focus` (`포커스`) | — | `includes('…')` · matcher call · plain text (substring) | `page.evaluate(() => String(<ui.stateBridge.focusExpr or the focused element's opening tag> ?? ''))` then `expect` |
| `State` (`Store`) | `<store>.<field.path>` | `truthy` (default) · `falsy` · `exists` · `matches /re/` · matcher call | `page.evaluate(() => <globalExpr>?.<store>?.<field> ?? null)` then `expect`; needs `ui.stateBridge` |
| `Runtime` (`런타임`) | `consoleErrors` / `networkErrors` | `isEmpty` (default) · `filteredCount < N` | `runtimeErrors(collector, { … })` after `collector.settle()` |
| `URL` | `pathname` / `search` / `href` | `hasText('…')` · `not hasText('…')` · `exists` · `matches /re/` · matcher call | `expect.poll` on `location.<part>` |
| `Popup` (`팝업`) | `count` / `url` | matcher call (default `toBe(1)`) / `hasText` · `not hasText` · `matches` | `expect.poll` on the windows collected since before the interaction |
| `Observe` (`관측`) | CSS selector | `peak <matcher>` · `texts hasText('…')` · `texts not hasText('…')` | assertion on the sampled `{ peak, texts }`; window `window` ms (default 3000); never `before` |

`soft: true` → `cp(id, body, { soft: true })`. Any other type, condition, URL part, popup target or runtime target stops the assembler with an error — including the retired forms `count(N)`, `length(N)`, `hasClass('…')`, `noConsoleErrors` and call-shaped Focus conditions such as `matches('<css>')`.
