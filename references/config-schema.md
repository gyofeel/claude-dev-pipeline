# Pipeline config — `.agents/pipeline.config.json`

Every skill and agent in this plugin reads project facts from this one file at the repository root. Skills never hardcode paths, commands, or framework details. If the file is missing, a skill offers to run `/dev-pipeline:init` in place and continues afterwards.

Load it with the plugin script (resolves relative paths against the repo root, fills defaults, validates):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs"            # prints resolved JSON
node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs" --check    # exit 1 + errors[] if invalid
```

`${CLAUDE_PLUGIN_ROOT}` is set by Claude Code to the plugin install directory and works inside skill Bash blocks.

## Schema (version 1)

Keys marked **required** must be present. Everything else has the default shown. `null` means "feature off".

```jsonc
{
  "$schema": "dev-pipeline/1",

  // ── Artifacts ─────────────────────────────────────────────
  "language": "en",                     // "en" | "ko" — what people read: conversation, questions, guidance, E2E report UI
  "locale": "en",                       // "en" | "ko" — PRD / TC / plan headings and the labels the checks match; default: same as language
  "worksDir": ".agents/works",          // <worksDir>/<slug>/{prd.md,tc.md,<slug>-plan.md,state.json}
  "issueKeyPattern": "[A-Z]+-\\d+",     // ticket id recognised in args and branch names
  "branchPrefix": "feat/",              // tdd-implement creates <branchPrefix><slug>
  "packageManager": "npm",              // "npm" | "pnpm" | "yarn" | "bun" — install hints only (init detects from lockfile)
  "constraintsFile": null,              // project laws copied verbatim into implementation plans.
                                        // null → derive a short list from CLAUDE.md / AGENTS.md and ask the user to confirm

  // ── Commands (strings run via Bash; null = step skipped) ──
  "commands": {
    "setup": null,                      // run before the unit-test baseline (e.g. "pnpm postinstall")
    "unitTest": "npx vitest run",       // full unit suite, non-watch, exit code meaningful; null (no runner) → config-load warns, tdd-implement unusable
    "unitTestList": null,               // optional — lists collected test files (baseline count)
    "format": null,                     // e.g. "npx prettier --write"; applied to files before commit
    "lint": null,                       // e.g. "npx eslint --fix"; best-effort
    "dev": null,                        // dev server command; used by playwright.config webServer template.
                                        // Pin it to a non-production backend (env vars in the command). Playwright's
                                        // reuseExistingServer will happily reuse a server someone started against production.
    "e2eRun": "npx playwright test"     // needed by e2e-test — runs one spec path appended; null (no Playwright) → config-load warns, e2e-test stops
  },

  // ── Unit tests ────────────────────────────────────────────
  "unitTest": {
    "runner": "vitest",                 // "vitest" | "jest" — selects the red-gate result adapter
    "runnerArgs": [],                   // extra args red-gate passes (e.g. ["--silent"]). No --project here:
                                        // red-gate takes --project per test, and --all must reach every project
    "testFileGlobs": ["**/*.test.{js,ts,jsx,tsx}"],   // where the runner collects tests
    "excludedFilePatterns": [],         // filenames the runner ignores (so tc-extract never proposes them)
    "testNaming": "<name>.test.js",     // colocated file name rule shown to tc-extract
    "knownFailuresFile": null,          // baseline of pre-existing failures for --all runs
    "excludedAreas": [],                // human-readable list of things NOT unit-testable in this repo
                                        // (e.g. "focus navigation", "WebGL rendering"); tc-extract and
                                        // tdd-implement quote it when classifying
    "useWorktree": false                // true → tdd-implement uses superpowers:using-git-worktrees; false → branch only
  },

  // ── UI / app structure ────────────────────────────────────
  "ui": {
    "framework": "auto",                // "auto" | "vue" | "react" | "svelte" | "angular" | "other" — hint only
    "pagesDir": null,                   // route/page components root (screen-context scans it)
    "componentsDir": null,
    "stateStoreDir": null,              // state modules root (verification-advisor scans it)
    "routeRule": null,                  // { "strip": "app/pages", "prefix": "", "indexFile": "index" }
                                        // file path → URL: remove strip, add prefix, drop indexFile, strip extension.
                                        // Dynamic segments like [id] are kept literally and flagged.
    "stateBridge": null,                // { "globalExpr": "window.__APP_STATE__", "focusExpr": null, "forbiddenGlobals": [] }
                                        // JS expression evaluable in the page that exposes app state.
                                        // null → the State verification type is disabled everywhere.
                                        // forbiddenGlobals: expressions specs must not use (e.g. an old store global);
                                        // spec-lint rule 14 flags each one as Critical
    "registrationFiles": [],            // barrels / registries a new module must be added to (e.g. ["src/store/index.js"]); tc-extract checks them in new-implementation mode
    "selectorPriority": ["testid", "id", "class", "text"],   // order agents prefer when proposing DOM hooks
    "testIdAttribute": "data-testid"
  },

  // ── E2E ───────────────────────────────────────────────────
  "e2e": {
    "specsDir": "e2e/specs",            // <specsDir>/<slug>/<specFilePrefix>tc01-<kebab>.spec.js
    "fixturesDir": "e2e/fixtures",
    "specFilePrefix": "",               // e.g. "btc-"
    "kitDir": "e2e/kit",                // where e2e-init copies the runtime kit
    "adapterModule": "e2e/e2e.adapter.js",   // project adapter (may be absent → kit defaults)
    "resultsJson": "e2e/reports/results.json",   // Playwright json reporter output
    "baseUrl": "http://localhost:3000",
    "healthUrlPath": "/",               // GET this to decide the app is up
    "interaction": "pointer",           // "pointer" | "keyboard" — keyboard requires adapter.findAndEnter
    "readyExpr": null,                  // JS boolean expr the app must satisfy before the first interaction
    "envErrorPatterns": [               // stderr/stdout substrings that mean "environment, not spec"
      "ECONNREFUSED", "EADDRINUSE", "EACCES", "Executable doesn't exist",
      "Process from config.webServer", "Timed out waiting"
    ],
    "writableDirs": [],                 // dirs the validator checks are writable before running
    "networkNoiseWhitelist": [],        // URL substrings ignored in network-error analysis
    "consoleAllowedMethods": null,      // e.g. ["log","info","error"] → spec-lint flags other console.* calls
    "softTrack": null,                  // { "guardExpr": "<js bool: true when the real env is present>",
                                        //   "patterns": ["playStatus", "nativeCallback"] }
                                        // checkpoints touching these patterns become soft cp (recorded, never fail the test)
                                        // in every environment; guardExpr is validated but no generated spec evaluates it
    "screenCatalog": null,              // path to screens.json: [{ "name", "url", "file", "renderSelector" }]
    "archiveDir": null,                 // e2e-report.html archive; null → <dirname(resultsJson)>/archive
    "bootFixtures": [],                 // URL globs the app needs to boot (e.g. ["**/api/session*"]), written exactly as
                                        // spec fixtures map keys; a spec mocking one of them runs isolated
    "report": {
      "loopThreshold": 3                // a test needing this many regeneration loops is flagged in the report
    },
    "judge": {
      "backendErrorPatterns": []        // regex strings on a console error's first line that mark a backend-response error:
                                        // excluded from the verdict under fixtures, a failure against the real API
    }
  },

  // ── Source scanning (field-consumers, flag-effects, red-gate) ──
  "source": {
    "roots": ["src"],                   // repo-relative directories scanned for source files
    "extensions": [".js", ".ts", ".vue", ".jsx", ".tsx", ".svelte", ".mjs", ".cjs"],
    "aliases": null                     // { "@": "src" } import aliases; null → read tsconfig/jsconfig "paths"
  },

  // ── Developer style (style-extract, tdd-implement PLAN step 4 — style context) ──
  "style": {
    "layersDir": ".agents/layers",      // catalog.json + one doc per development layer (style-extract drafts it)
    "stylesDir": ".agents/styles",      // one style file per developer, committed to the project repo
    "defaultStyle": null,               // file name in stylesDir used when no file lists the runner's git email; null → no style step
    "codeRoots": null,                  // null → every tracked file; e.g. ["src/","server/"] limits the catalog check and evidence
    "codeExtensions": ["js","mjs","cjs","ts","jsx","tsx","vue","svelte","css","scss"],
    "extraCodeFiles": [],               // tracked files outside codeRoots that still count (e.g. "vite.config.js")
    "noiseSubjects": []                 // case-insensitive regexes; commits whose subject matches are never style evidence (e.g. "^bump version")
  },

  // ── Gates ─────────────────────────────────────────────────
  "surfaceGate": {                      // optional; tunes scripts/surface-gate.mjs
    "autoEntryPaths": [],               // repo-relative prefixes the framework registers by location (e.g. "app/pages/");
                                        // new files there count as reachable; nuxt / next defaults are added from ui.framework
    "specPaths": null,                  // where specs and their helpers live; null → e2e.specsDir, e2e.fixturesDir, e2e.kitDir
    "nonProductionPaths": []            // extra prefixes excluded from production code (tooling, docs, scripts)
  },
  "approvalGates": [],                  // [{ "name": "new scoped style", "check": "git diff $BASE..HEAD -- '*.vue' | grep -n '<style' || true" }]
                                        // $BASE (merge-base with the default branch) is exported when checks run
                                        // listed in the implementation-review gate; a non-empty check output needs explicit user approval

  // ── PRD interview ─────────────────────────────────────────
  "platformInterface": {
    "enabled": false,                   // true → prd-extract asks about a platform/bridge interface (native shell, SDK)
    "label": "platform bridge"
  }
}
```

## Resolution rules

- All paths are relative to the repository root (the directory containing `.agents/`). `config-load.mjs` returns them resolved to absolute paths under `resolved.*` and keeps the originals under `raw.*`.
- `commands.*` strings are executed with `bash -c` from the repo root. A skill appends arguments (a spec path, a test file) after a space.
- `ui.framework: "auto"` is resolved from `package.json` dependencies (vue/nuxt → vue, react/next → react, svelte → svelte, @angular → angular, else other). The resolved value is a one-line hint for agents, nothing more.
- `ui.stateBridge.globalExpr` is the only way the pipeline reads app state. Agents write state paths as `<store>.<field>`; the spec compiles them to `<globalExpr>?.<store>?.<field>`. The runtime probe (`scripts/state-probe.mjs`) evaluates each path once against the running app and rejects paths that resolve to `undefined`.
- `e2e.ai` was removed (verdicts are rule-based); `--check` warns when the key is still present.
- `style` is optional. Without a style file the style scripts change nothing, and they run with these defaults even when `pipeline.config.json` is missing.
- `e2e.interaction: "keyboard"` requires `adapter.findAndEnter`. `--check` only warns while the adapter file does not exist yet (init runs before e2e-init), and errors once the file exists without an uncommented `findAndEnter` — so `e2e-test` stops until the project implements it.

## Minimal valid config

```json
{ "$schema": "dev-pipeline/1", "commands": { "unitTest": "npx vitest run" } }
```

Everything else defaults. With this, State verification and keyboard navigation are off, unit tests use vitest, specs land in `e2e/specs/`.

## Example for a keyboard-driven TV app

See `examples/config/pipeline.config.btv-webui.json` — the configuration that reproduces the plugin's origin project, including a state bridge, keyboard interaction with an adapter, soft-track patterns, and approval gates.
