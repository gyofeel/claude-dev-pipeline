# Runtime kit and project adapter

Generated specs import runtime code. That code must live in the project (CI runs without the plugin), so `/dev-pipeline:e2e-init` copies the kit from `${CLAUDE_PLUGIN_ROOT}/kit/` into `<e2e.kitDir>/` and scaffolds an adapter at `<e2e.adapterModule>`. Specs import only two modules:

```js
import { mockAll, RuntimeCollector, analyze, attachAnalysisToReport, captureFailureDiagnostics } from '<rel>/kit/index.js';
import adapter from '<rel>/e2e.adapter.js';   // may re-export kit defaults
```

`<rel>` is computed by `spec-template.mjs` from `e2e.specsDir/<slug>/` to `e2e.kitDir` and `e2e.adapterModule`.

## Kit contents (`kit/`)

| File | Exports | Notes |
|---|---|---|
| `index.js` | re-exports everything below + `defaultAdapter` | single import surface; also `KIT_VERSION` |
| `utils/api-mocker.js` | `mock`, `mockByRequest`, `unmock`, `mockAll(page, routeMap, { fixturesDir, isolate })` | `routeMap` values are fixture filenames (relative to `fixturesDir`) or inline objects. `isolate: true` (default) stubs every unmatched request so fixture runs never hit the network |
| `services/runtime-collector.js` | `class RuntimeCollector { start(), collect() }` | console errors/warnings, uncaught exceptions, failed requests, slow requests |
| `services/ai-analyzer.js` | `analyze(runtimeData, testMeta)` | provider from `e2e.ai` (openai / anthropic / none), plain `fetch`, no SDK. Returns `{ status: 'PASS'\|'WARNING'\|'FAIL', issues[], summary, analysisError, fromCache, responseTime }`. `E2E_SKIP_AI=1` or provider `none` → immediate `{ status: 'PASS', analysisError: false, skipped: true }` |
| `prompts/analyze.txt` | system prompt | generic; no product names |
| `utils/report-helper.js` | `attachAnalysisToReport(testInfo, analysisResult, runtimeData, criteria)` | HTML dashboard attached to the Playwright report |
| `utils/diagnostics-helper.js` | `captureFailureDiagnostics(page, testInfo, { step, expected })` | attaches `failure-diagnostics` JSON: url, title, `document.activeElement` descriptor, visible text sample, optional `adapter.snapshotState(page)` result, screenshot |
| `utils/default-adapter.js` | `defaultAdapter` | see contract below |
| `config-loader.js` | `loadKitConfig()` | reads `.agents/pipeline.config.json` at runtime for `fixturesDir`, `ai`, `stateBridge` |
| `VERSION` | semver string | `e2e-init --upgrade` compares and shows a diff before overwriting |
| `playwright.config.template.js` | — | copied to project root only if no `playwright.config.*` exists |

Runtime dependency of the kit: `@playwright/test` only.

## Adapter contract (`e2e.adapter.js`)

The adapter is a plain ES module default-exporting an object. Every member is optional; the kit's `defaultAdapter` fills gaps. Specs always call through `adapter.*` so a project can replace behaviour without touching generated code.

```js
export default {
  /** Wait until the app is usable. Default: waitForLoadState('domcontentloaded') → optional renderSelector visible → readyExpr (per spec, else e2e.readyExpr) true. */
  async waitForAppReady(page, { renderSelector = null, readyExpr = null, timeout = 30000 } = {}) {},

  /** Logical key name → Playwright key. Default: identity + ArrowUp/Down/Left/Right, Enter, Escape, Backspace, Tab. Used by `press`. */
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

  /** Optional: JS expression string evaluated in the page to read the focused element/area. Default: null → document.activeElement descriptor. */
  focusExpr: null
};
```

### Target descriptors

| `by` | `value` | Resolves to |
|---|---|---|
| `testid` | attribute value | `page.getByTestId(value)` (attribute name from `ui.testIdAttribute`) |
| `role` | ARIA role, `name` optional | `page.getByRole(value, { name })` |
| `text` | visible text (substring, case-insensitive) | `page.getByText(value)` |
| `css` | selector | `page.locator(value)` |
| `predicate` | JS boolean over `item` (an element of a state array named by `source`) | requires `ui.stateBridge`; the adapter decides how to reach the matched item. Pointer default: not supported → returns false |

`nth` picks one match when several exist (0-based). Missing `nth` with multiple matches → the locator's strict-mode error surfaces as a FAIL with a clear message.

## Spec skeleton guarantees (what the assembler emits)

`scripts/spec-template.mjs` produces the whole file except the body slot `// <<< TEST_BODY >>>`. It guarantees:

1. imports resolved from config; `const TC_NAME`, `START_URL`, `CONSOLE_ERROR_WHITELIST`, `NETWORK_ERROR_WHITELIST`, `ACCEPTABLE_STATUSES`, `SUCCESS_CRITERIA[]`
2. `test.describe` with `test.setTimeout(N)` first (N from input, default 120000)
3. `beforeEach`: reset criteria → `collector.start()` → `mockAll(page, fixtures)` → `page.goto(START_URL)` → `adapter.waitForAppReady(page, { renderSelector })`
4. `test(...)` with `verifications[]` compiled to `test.step('cp-NN: …')` blocks that set `SUCCESS_CRITERIA[i].passed`
5. `afterEach`: guard `if (!collector) return` → collect → whitelist filtering → `analyze()` → `attachAnalysisToReport()` → failure screenshot attach → throw when status not acceptable and not `analysisError`

There is no static-analysis file, no `globalSetup` requirement, and no product-specific import.

## Verification compilation

| type | condition | emitted |
|---|---|---|
| `DOM` | `visible` / `hidden` / `hasText('x')` / `hasClass('c')` / `not hasClass('c')` / `count(N)` | `expect(adapter.locator(page, target))…` |
| `Focus` | `matches('<css>')` / `hasText('x')` / `includes('x')` | pointer: `document.activeElement` descriptor; with `adapter.focusExpr`: evaluate it |
| `State` | `truthy` / `falsy` / `toBe(v)` / `toEqual(v)` / `matches(/re/)` / `length(N)` | `page.evaluate(() => <globalExpr>?.<path>)` |
| `Runtime` | `noConsoleErrors` / `noNetworkErrors` / `consoleErrors < N` | checked from `collector.collect()` in the body |

Targets in `DOM`/`Focus` rows are target descriptors (default `css` when given a bare selector string).
