# E2E runtime kit

Copied into your project by `/dev-pipeline:e2e-init` (default `e2e/kit/`). Generated specs import it; CI needs no plugin.

| File | Role |
|---|---|
| `index.js` | single import surface (`mockAll`, `RuntimeCollector`, `analyze`, `attachAnalysisToReport`, `captureFailureDiagnostics`, `defaultAdapter`, `KIT_VERSION`) |
| `config-loader.js` | reads `.agents/pipeline.config.json` at runtime (fixtures dir, AI provider, state bridge) |
| `utils/api-mocker.js` | `page.route` fixtures + isolation catch-all for unmatched data requests |
| `services/runtime-collector.js` | console / exception / network / slow-request collection |
| `services/ai-analyzer.js` | PASS / WARNING / FAIL verdict via OpenAI, Anthropic, or none (plain `fetch`) |
| `utils/report-helper.js` | HTML dashboard attached to the Playwright report |
| `utils/diagnostics-helper.js` | failure diagnostics + navigation census attachments |
| `utils/default-adapter.js` | pointer-interaction defaults for the adapter contract |
| `adapter.template.js` | copied to `<e2e.adapterModule>` — override members there |
| `playwright.config.template.js` | copied to the repo root when no Playwright config exists |
| `VERSION` | kit version; `e2e-init --upgrade` diffs against it |

Specs import:

```js
import { mockAll, RuntimeCollector, analyze, attachAnalysisToReport } from '../../kit/index.js';
import adapter from '../../e2e.adapter.js';
```

Dependency: `@playwright/test` only. Upgrade: re-run `/dev-pipeline:e2e-init --upgrade`; it shows a diff per file before overwriting and never touches your adapter.

Self-check (no browser): `node kit/selfcheck.mjs`.
