# Agent I/O contracts

All agents live in `agents/` and are addressed as `dev-pipeline:<name>`. Each is a single-purpose worker: it never calls `AskUserQuestion`, never writes files unless its contract says so, and returns exactly the output block below so the calling skill can parse it. Every agent reads `.agents/pipeline.config.json` first (via `node "${CLAUDE_PLUGIN_ROOT}/scripts/config-load.mjs"`) and uses resolved paths; it never assumes a directory.

Output blocks: every section header is always present; an empty section holds a single `- none` line so callers can parse by header.

Common prompt preamble supplied by the caller: repo root (absolute), the resolved config JSON (or the fields the agent needs), and the task inputs listed here.

| Agent | Purpose | Tools |
|---|---|---|
| `ui-selector-extractor` | read given source files → DOM hook, state path, and branch-condition candidates | Read, Glob, Grep, Bash |
| `spec-scanner` | scan existing specs → overlap with a feature scope | Read, Glob, Grep, Bash |
| `fixture-advisor` | recommend existing fixtures for a screen/PRD; report gaps | Read, Glob, Bash |
| `screen-context` | screen name → page file, URL, render selector candidates | Read, Glob, Grep, Bash |
| `navigation-advisor` | scenario sentence → validated navigation plan | Read, Glob, Grep, Bash, Agent(Explore) |
| `verification-advisor` | screen + selected types → checkpoint candidates | Read, Glob, Grep, Bash, Agent(Explore) |
| `spec-writer` | assembler input → saved, linted, formatted spec | Read, Write, Bash |
| `spec-reviewer` | spec paths → merged verdict per spec from `spec-lint` + state probe + residual rules | Read, Bash |
| `spec-runtime-validator` | spec path → PASS / SKIP / FAIL / ENV with failure kind and diagnostics | Read, Bash |

## ui-selector-extractor

**Input**: `files[]` (absolute), `scopeHint` (feature/screen text), config `ui.*`.
**Procedure**: read each file; collect hooks in `ui.selectorPriority` order; for every hook note the condition that controls its rendering (quote the guard expression, whatever the framework syntax); when `ui.stateBridge` is set, list state fields the file reads/writes as `<store>.<field>` with the defining file:line; list branch conditions (guards, computed flags) that suggest TC branches.
**Output**:
```
[changed components]
- <file>: <1–2 line summary>

[DOM hook candidates]
- `<target descriptor>` — always visible | condition: `<expr>` (<file>:<line>)

[state path candidates]            ← omit section when stateBridge is null
- `<store>.<field>` — <type/example> (<file>:<line>)

[branch conditions]
- `<expr>` in <file>:<line> — <TC purpose>

[uncertain]
- <item and why>
```

## spec-scanner

**Input**: `scope` (feature name, screen, keywords), config `e2e.specsDir`.
**Procedure**: `grep -rn "const TC_NAME" <specsDir>`; compare each name and directory with the scope.
**Output**:
```
[existing specs]
- <path>: TC_NAME = "<value>"        (or "no spec files")

[overlap]
- full: <path> — <reason>
- partial: <path> — <shared area>
- none
```

## fixture-advisor

**Input**: `screen`, optional `endpoints[]` from the PRD server-interface section, config `e2e.fixturesDir`, `e2e.specsDir`, `e2e.bootFixtures`.
**Procedure**: list fixture files; read `manifest.json` if present (url→file map); grep existing specs for `mockAll(` route maps to learn url→fixture usage; list the `e2e.bootFixtures` globs first (they decide whether the spec runs isolated); match endpoints/screen keywords; open each recommended file and classify `real` (populated data) vs `skeleton` (empty arrays / placeholder values). Globs end with `*` when the request carries a query string; a glob that matches nothing fails the spec file as `mock-unused`.
**Output**:
```
[available fixtures]
- <file> → <url pattern or (unknown)>

[recommended]
1. <file> (<url pattern>) — <why> [real | skeleton]

[gaps]
- <endpoint> — no fixture; suggest name <kebab>.json

[related specs]
- <path> — TC_NAME "<value>"
```

## screen-context

**Input**: `screenName`, config `ui.pagesDir`, `ui.routeRule`, `e2e.screenCatalog`.
**Procedure**: if a catalog exists, match by name first. Otherwise list page files under `pagesDir` (`find … -name '*.vue' -o -name '*.jsx' -o -name '*.tsx' -o -name '*.svelte' -o -name 'page.*'`), score by keyword, apply `routeRule` to derive the URL, read the best file, extract up to 3 render-selector candidates as plain CSS — they become `renderSelector`, which the render wait resolves as CSS (root wrapper first, then main content container, then a conditional block with its guard).
**Output**:
```
[screen-context]
- pageFile: <path>
- url: <derived url>          (dynamic segments kept as-is and listed under notes)
- screen: <normalized name>
- renderSelectorCandidates:
  - <target> (always | condition: <expr>)
- confidence: high | medium | low
- notes: <ambiguities>
```

## navigation-advisor

**Input**: `scenario` (sentence), `screen`, `pageFile` (may be null), `interaction` (`pointer`/`keyboard`), config `ui.*`, `e2e.*`, `previousContext` (null or `{ type, diagnostics, iteration }` from a failed run).
**Procedure**: see `references/navigation-plan.md` "How the advisor fills it". Write the plan to a temp file and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/nav-plan-schema.mjs" <file>`; loop until `valid: true`. When `previousContext.diagnostics` is present, adjust the steps that the diagnostics contradict (e.g. focus never left the header → add a `loop` step) and say what changed in `notes`.
**Output**:
```
[navigation-advisor]
- plan: <the JSON, single fenced block>
- confidence: high | medium | low
- existingPattern: <spec path>   (only if a similar spec exists)
- notes: <field evidence, caveats, what changed vs previousContext>
```

## verification-advisor

**Input**: `screen`, `pageFile`, `selectedTypes[]` ⊆ {DOM, Focus, State}, optional `entrySummary`, config `ui.*`.
**Procedure**: read `pageFile` and one level of imported local files; DOM: up to 6 hooks (root wrapper, guarded blocks with their guard, main containers), never state-modifier classes; Focus: elements that receive focus after the entry (autofocus, focus() calls, tab order) or app focus ids when `ui.stateBridge.focusExpr` is configured — conditions `includes('…')` or a matcher call, never `matches('<css>')`; State (only with a bridge): fields read by the files, from the store modules under `ui.stateStoreDir`; if fewer than 2 DOM candidates, dispatch `Explore` over `ui.componentsDir`. Conditions use tc-format's Checkpoints forms. Flag candidates that are structurally rare for the chosen scenario (warning, not exclusion); mark candidates touching `e2e.softTrack.patterns` with `soft: true`.
**Output**:
```
[verification-advisor]
- DOM:
  - { target: "<descriptor>", condition: "visible", reason: "<file>:<line> …" }
- Focus:
  - { target: "focus", condition: "includes('…')", reason: "…" }
- State:                                    ← omit when stateBridge is null
  - { path: "<store>.<field>", condition: "truthy", reason: "<file>:<line>" }
- existingPattern: <spec path>
- confidence: high | medium | low
```

## spec-writer

**Input**: one assembler input JSON — the contract is `INPUT_SCHEMA` in `scripts/spec-template.mjs` (`--help` prints it):
- required: `tcName` (or `cases[]`), `outputPath` (repo-relative, `<e2e.specFilePrefix>….spec.js`), `screen`
- entry: `startUrl` (default `/`), `timeout` (≥ 60000, default 120000), `renderSelector` (CSS) / `readyExpr`, `fixtures` (`{ '<url glob>': '<file in e2e.fixturesDir>' | <inline object> }`), `navigationPlan`, `navigationStrategy` (`'A'` default; `'C2'` for live-data goal-directed navigation)
- checks: `verifications[]` — `{ type, selector? (alias target), path?, condition?, desc?, soft?, before?, window? }`, `type` one of `DOM` · `Focus` · `State` · `Runtime` · `URL` · `Popup` · `Observe` (or the locale's `tc.cp.*` label); `successCriteriaText` (alias `successCriteria`); `consoleErrorWhitelist[]`; `networkErrorWhitelist[]`; `notes`
- body: `slotBody` (interaction code; `''` = none), `setupBody` (before the `[before]` checkpoints)
- `cases[]`: `[{ tcName, verifications, successCriteriaText?, slotBody?, setupBody?, screen? }]` — TCs sharing one entry, one `describe` each
- no `isolate`: the assembler isolates exactly when a `fixtures` glob is listed in `e2e.bootFixtures`
- plus `previousContext` on retries
**Procedure**: write the input to `<scratch>/dp-spec/<spec file name>/input.json`; compile the navigation plan per `references/navigation-plan.md` into `slotBody` (pointer: locator actions; keyboard: `adapter.findAndEnter`/`adapter.press`); run `node "${CLAUDE_PLUGIN_ROOT}/scripts/spec-template.mjs" <input.json> --write`; run `node "${CLAUDE_PLUGIN_ROOT}/scripts/spec-lint.mjs" <path>` and fix the input until `pass: true`; run `commands.format <path>` and, best-effort, `commands.lint <path>`. The assembled file is never edited outside the `// <<< TEST_BODY >>>` slot; the kit import line always carries `captureFailureDiagnostics` and `captureNavigationCensus`. On a plan fallback (`skip`) the body calls `captureNavigationCensus(page, testInfo, { target, candidateCount, enteredLog })` before `test.skip` (`test.info()` when the test has no `testInfo` argument).
**Output**:
```
[spec-writer]
- path: <outputPath>
- lint: pass | fail (<n> violations)
- bodyStrategy: static | plan-pointer | plan-keyboard
- notes: <assumptions the reviewer should know>
```

## spec-reviewer

**Input**: `specs[]` — `{ specPath, verifications[], navigationPlan }` per spec (batch mode sends the whole batch in one call), `probe` (`true` when the app is reachable; default true).
**Procedure**, per spec: 1) `node "${CLAUDE_PLUGIN_ROOT}/scripts/spec-lint.mjs" <specPath>` — trust `violations[]` as-is (kit-fixture specs skip rules 1, 2, 5–7, 12, 13, 15; rules 21 and 22 apply to them); 2) if the spec contains State paths and `probe`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/state-probe.mjs" <specPath>` → `{ ok, checked: [{ path, status, sample }], errors[] }` (exit 2 + `env: true` = app unreachable → report `probe: skipped`, not a failure) — each path must resolve to a non-`undefined` value on the running app; 3) judge residual rules from `llmResidual[]` only (16: no fixed sleeps after interactions; 17: soft `cp` exactly where `softTrack.patterns` appear) plus plan fidelity.
**Output**: specs with `pass: false` listed first, then one block per spec:
```
[spec-reviewer] <specPath>
pass: true | false

[violations]
- rule <n> (<Critical|Error|Warning>): <message>
  code: `<line>`
  fix: <instruction>

[probe]                      ← omit when no State paths
- <path>: ok | undefined

[passed]
- rule <n>: OK …
```
Critical/Error → `pass: false`. Warnings alone → `pass: true`.

## spec-runtime-validator

**Input**: `specPath`, `iteration`, `previousContext`.
**Procedure**: 0) writable check on `e2e.writableDirs`; browser binary check; health `GET <e2e.baseUrl><e2e.healthUrlPath>` (non-200 = warning, not blocking — Playwright's `webServer` may start it); 1) `rm -f <resultsJson>`; `E2E_ARCHIVE=0 <commands.e2eRun> <specPath> > <scratch>/pw-stdout.txt 2>&1`; 2) parse `<resultsJson>` with the embedded Node snippet, which runs the kit's report model (`<e2e.kitDir>/report/collect.mjs` `collectRun`) for per-test status and failure kind, plus the `failure-diagnostics` / `navigation-census` attachments; 3) classify — `ENV` first (any `e2e.envErrorPatterns` hit in errors/stdout, or no results file with non-zero exit), then `FAIL` (any test the model marks failed, including `mock-unused`; or no test ran), `SKIP` (none failed, some skipped), `PASS`. The verdict inside each test is the kit's rule-based judge; no AI is called. Never modifies the environment: no `sudo`, `chown`, `rm -rf`, installs.
**Output** (JSON):
```json
{ "status": "PASS|SKIP|FAIL|ENV", "iteration": 1, "passed": 1, "failed": 0, "skipped": 0,
  "failedStep": null, "failureKind": null, "errorMessage": null, "unusedMocks": [],
  "skipReason": null, "envReason": null, "skipKind": null, "diagnostics": [] }
```
`failureKind` (FAIL only): `assertion` · `setup` · `timeout` · `judge` (rule-based verdict FAIL; the message quotes `Issues:`) · `mock-unused` (a mock in the spec file answered no request — suspect the glob or a service worker first) · `interrupted` · `other`. A test that failed for another reason keeps its kind; `unusedMocks` is filled whenever the file has unused mocks.
`skipKind`: read from the `navigation-census` attachment's `verdictHint` — `NO_CANDIDATE` (`candidateCount === 0`) or `ENTERED_BUT_REJECTED` (`candidateCount > 0`, rejections listed in `enteredLog[]`); no census → `null`.
