# Runtime validation loop

Runs after `spec-reviewer` passes. Each spec is executed for real and repaired by cause. `MAX_LOOP = 5`. Variables: `iteration = 1`, `previousContext = null`.

The verdict is deterministic. The kit fixture judges every run by rules (`<e2e.kitDir>/services/judge.js`): a checkpoint assertion failure, a client console error or exception, or — on the real API — an API error response fails the test. No AI is called anywhere in the loop.

## One iteration

1. `Agent(dev-pipeline:spec-runtime-validator)` with `specPath`, `iteration`, `previousContext`. It runs `E2E_ARCHIVE=0 <commands.e2eRun> <specPath>`, reads `e2e.resultsJson`, classifies the run with the kit's report model, and returns the JSON in `agents-io.md`. The validator only observes: it never installs, deletes, or changes permissions.
2. Branch on `status`.

### PASS

Print `Runtime verification passed (iteration N).` and leave the loop. Interview mode continues with Step 7; batch mode records the result and goes to the next spec.

### ENV — environment, not the spec

Does **not** consume an iteration.

- First ENV: settle (re-check `GET <e2e.baseUrl><e2e.healthUrlPath>` or wait 3 s) and retry once automatically. A first run after a dependency change may spend minutes on a cold build; that is not a failure.
- Still ENV: stop the loop and ask.

**Question**: "The run failed for an environment reason, not the spec."
- header: `Environment`
- description: `envReason` verbatim (the matched pattern from `e2e.envErrorPatterns`, unwritable directories from `e2e.writableDirs`, or "no results file and non-zero exit"), followed by what the user can do: start the dev server, free the port, restore ownership of the listed directories, or download the browser binary with `npx playwright install chromium` (a one-time browser download after a Playwright upgrade, not a package install). The skill never runs those commands.
- options: `Fixed — retry` (re-enter with the same `iteration`) / `Keep the spec unverified` (leave the loop; result "kept unverified — ENV")

### SKIP — the spec skipped itself

Branch on `skipKind`. Do not regenerate the same navigation over and over.

- **`NO_CANDIDATE`** — a `findAndEnter` or `loop` exhausted without a match. Navigation or target problem.
  `previousContext = { type: 'SKIP', skipKind, skipReason, diagnostics, iteration }` → `Agent(dev-pipeline:navigation-advisor)` with the same scenario and `previousContext` → schema gate → `Agent(dev-pipeline:spec-writer)` with the new plan → re-verify → `iteration++`.
- **`ENTERED_BUT_REJECTED`** — the target was reached but `postEnterCondition` (or the checkpoints) did not hold there. Regenerating navigation would thrash. Stop and ask; this branch does not consume an iteration.

  **Question**: "The test reached the target, but the acceptance check did not hold there."
  - header: `Acceptance target`
  - description: `skipReason` and the census summary (what was entered, why each was rejected)
  - options: `Relax or change the checkpoint` (text → rebuild `verifications` / `postEnterCondition`, spec-writer, re-verify, continue) / `Keep the spec as is` (leave the loop; result "kept — target rejected")
- **`null`** (no census attached) — treat as `NO_CANDIDATE`.

### FAIL — read `failureKind` first

`previousContext = { type: 'FAIL', failureKind, failedStep, errorMessage, unusedMocks, diagnostics, iteration }`.

| `failureKind` | Meaning | Next |
|---|---|---|
| `assertion` | a checkpoint assertion failed | spec-writer with the failure; diagnostics pointing at navigation (URL/focus unchanged after a step, target never found) → navigation-advisor first |
| `setup` | failed before any checkpoint ran (entry, render wait, boot) | check the render-ready condition, the entry steps and the boot fixtures (`e2e.bootFixtures`) before the checkpoints |
| `timeout` | the test hit `test.setTimeout` | a wait that never resolves; replace it with a state-based wait, do not just raise the timeout |
| `judge` | every checkpoint passed but the rule-based verdict failed; the error quotes `verdict: FAIL` (`ko`: `판정 결과: FAIL`) and its `Issues:` lines | whitelist the error if it is expected noise (`consoleErrorWhitelist` / `networkErrorWhitelist`), add the missing fixture, or report an app defect — never weaken the assertions |
| `mock-unused` | a mock registered in this spec file answered no request in any of its tests | suspect the mock first, not the app: a glob that misses the request (missing trailing `*` before a query string, wrong path segment) or a service worker answering before `page.route` sees the request (the kit's config template sets `serviceWorkers: 'block'`; a project config without it lets the worker bypass mocks). Fix the glob in the TC's Preconditions and the spec input; do not delete the mock to make it pass |
| `interrupted` · `other` | the run stopped or failed outside the classes above | read `errorMessage`; re-run once before regenerating |

A test that already failed for another reason keeps its own `failureKind` and still carries `unusedMocks` — fix both. Mock use is counted per spec file, so a mock one test needs can still be missed if another test in the same file hits that glob.

**Test data absent (real API)**: when the failing checkpoint waited on a transition and the live API answered "no result" for the test's data (an error code, an empty list), the spec is not the problem and regeneration cannot fix it. Stop the loop, keep the spec, and record `lastFailure` as `DATA: <API path, key parameters> → <response gist>`. The report lists it as "needs review", not as a defect. At the gate, the options are: replace the test data with values that exist in the target environment and re-run (recommended when the API response shows such values exist), keep the spec and record the absence, or stop.

Otherwise: spec-writer (and navigation-advisor when the diagnostics point at navigation) with `previousContext` → re-verify → `iteration++`. spec-writer may fix waits, timeouts or a wrong condition; it must not delete a checkpoint.

## Re-verification inside the loop (cost control)

The initial gate before the loop was the full `spec-reviewer` agent. Inside the loop:

- **Always**: `node "${CLAUDE_PLUGIN_ROOT}/scripts/spec-lint.mjs" <specPath>` via Bash. `pass: false` → send violations to spec-writer and fix before running again (no browser run on a lint failure).
- **Only when State paths changed** (navigation-advisor was re-called, or spec-writer reports it touched a State path): `node "${CLAUDE_PLUGIN_ROOT}/scripts/state-probe.mjs" <specPath>`.
- **Never** re-spawn the `spec-reviewer` agent inside the loop; the runtime run is the backstop for residual rules.

Trade-off: a body edit that introduces a new undefined state path is caught one iteration later by the runtime run, not immediately. Acceptable — bounded by `MAX_LOOP`.

## Exhaustion (`iteration > MAX_LOOP`)

1. Analyse the five results: FAIL/SKIP ratio, the failure kinds, the step that failed most often, probable root cause (timeout, element never rendered, target predicate never true, mock never hit, a state the environment cannot reach that should have been soft-tracked).
2. Report:
   ```
   Runtime verification exhausted — 5 iterations without PASS

   Pattern:
   - most frequent failing step: <step>
   - failure kinds: <kind × n, …>
   - main error: <errorMessage summary>
   - probable cause: <analysis>

   Spec file: <specPath>
   ```
3. **Interview mode** — **Question**: "How should we proceed?"
   - header: `Next step`
   - options: `Keep the current spec` (leave as is for manual inspection) / `Give me a fix guide` (print the analysis as concrete edits, leave the file) / `Regenerate from scratch` (back to Step 1)
4. **Batch mode** — no question: keep the spec, record "exhausted after 5 runs", go to the next spec. The summary and the report show it.

## Loop record (batch mode)

Whenever a spec leaves the loop (PASS, kept, user stop, or exhausted), write `<worksDir>/<slug>/e2e-loops.json`: key = spec file name, value = `{ "loops": <iterations used>, "lastFailure": "<one-line summary of the last FAIL/SKIP, or null>" }`. Start from `{}` when the file is missing and overwrite only that key. The report flags specs at or above `e2e.report.loopThreshold` and reads a `DATA:` prefix as absent test data. Runs triggered by gate decisions (new test data, a confirmed expected value) are not loop iterations. The file is gitignored.

## Result vocabulary (batch summaries and pipeline gates)

| Result | Meaning |
|---|---|
| `PASS after N runs` | validator returned PASS on iteration N |
| `kept unverified — ENV` | user chose to keep the spec after an environment failure |
| `kept — target rejected` | user kept the spec after `ENTERED_BUT_REJECTED` |
| `kept — test data absent` | real-API data missing; `lastFailure` starts with `DATA:` |
| `exhausted after 5 runs` | loop limit hit; spec left in place |
| `generation failed` | spec-reviewer rejected twice before any run |
