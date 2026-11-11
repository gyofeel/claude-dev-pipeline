# E2E runtime kit

Copied into your project by `/dev-pipeline:e2e-init` (default `e2e/kit/`). Generated specs import it; CI needs no plugin.

| File | Role |
|---|---|
| `index.js` | single import surface (`test`, `expect`, `mock`, `mockByRequest`, `unmock`, `mockAll`, `RuntimeCollector`, `judge`, `analyze`, `attachAnalysisToReport`, `runtimeErrors`, `captureFailureDiagnostics`, `captureNavigationCensus`, `watchSelectors`, `readWatch`, `defaultAdapter`, `resolveTarget`, `describeActiveElement`, `loadKitConfig`, `KIT_VERSION`) |
| `fixture.js` | `test.use({ e2e })` options, `cp()` checkpoints, auto collector → verdict → `verdict.json` → screenshot |
| `config-loader.js` | reads `.agents/pipeline.config.json` at runtime (fixtures dir, state bridge, report and judge settings) |
| `artifact-labels.mjs` | PRD / TC / plan headings and fixed values per `locale` (`en`, `ko`) |
| `services/judge.js` · `services/analyze.js` | rule-based PASS / FAIL (no LLM) |
| `services/runtime-collector.js` | console / exception / network, mock boundary, API call volume |
| `utils/api-mocker.js` | `page.route` fixtures, per-glob hit counts, isolation catch-all for unmatched data requests |
| `utils/checkpoint.mjs` · `utils/runtime-filter.mjs` · `utils/api-usage.mjs` · `utils/report-helper.js` | cp recording, whitelist filtering, call-volume summary, `verdict.json` attachment |
| `utils/watch-helper.js` | samples short-lived elements (toasts) over a window for Observe checkpoints |
| `utils/archive-reporter.mjs` | Playwright reporter: archives each run and writes the result report |
| `report/` | `e2e-report.html` / `e2e-report.md` model, gate and renderers; `open.mjs` opens the latest report |
| `utils/diagnostics-helper.js` | failure diagnostics + navigation census attachments |
| `utils/default-adapter.js` | pointer-interaction defaults for the adapter contract |
| `utils/adapter.template.js` | copied to `<e2e.adapterModule>` — override members there |
| `playwright.config.template.js` | copied to the repo root when no Playwright config exists (`serviceWorkers: 'block'`, `trace: 'on'`, archive reporter) |
| `VERSION` | kit version; `e2e-init --upgrade` diffs against it |

Specs import (the assembler writes this head):

```js
import { test, expect, mockAll, captureFailureDiagnostics, captureNavigationCensus } from '../../kit/index.js';
import adapter from '../../e2e.adapter.js';

test.use({ e2e: { tcName: TC_NAME, screen: 'search', testMode: 'fixture', successCriteria: SUCCESS_CRITERIA /* … */ } });
```

Kit 0.1 specs (`afterEach` + `analyze`) are not supported; regenerate them with `/dev-pipeline:e2e-test`.

Report: every run is archived under `e2e.archiveDir` (default `<dirname(resultsJson)>/archive`) with its `e2e-report.html`; open the latest with `node <kitDir>/report/open.mjs`. Skip archiving with `E2E_ARCHIVE=0`. Archived or not, a test the report fails while Playwright passed it (a mock no test in the file used) makes the run exit non-zero.

Dependency: `@playwright/test` only. Upgrade: re-run `/dev-pipeline:e2e-init --upgrade`; it shows a `diff -rq` summary (files added / changed / removed), then replaces the whole kit directory — files only the old kit had are deleted — and never touches your adapter or Playwright config.

Self-check (no browser): `node kit/selfcheck.mjs`; in the plugin repo also `node --test tests/kit/*.test.mjs`.
